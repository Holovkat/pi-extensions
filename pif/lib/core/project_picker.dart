import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';

import 'development_environment.dart';
import 'development_toolchain.dart';

/// The installed shell and editable source shell use this same entry point.
class ProjectPicker extends StatefulWidget {
  const ProjectPicker({
    super.key,
    required this.onLaunch,
    this.onCreateProject,
    this.onEnvironmentSelected,
    this.onOpenSettings,
    this.environments,
    this.chooseFolder,
    this.recentProjectsFile,
  });

  final Future<void> Function(String workspace) onLaunch;

  /// The central GitHub/local creation wizard can replace the local fallback.
  final Future<EnvironmentIdentity?> Function()? onCreateProject;
  final Future<void> Function()? onOpenSettings;

  /// Runs immediately after identity allocation, before prerequisites or auth.
  final Future<void> Function(EnvironmentIdentity identity)?
  onEnvironmentSelected;
  final DevelopmentEnvironmentService? environments;
  final Future<String?> Function(String prompt)? chooseFolder;
  final File? recentProjectsFile;

  @override
  State<ProjectPicker> createState() => _ProjectPickerState();
}

class _ProjectPickerState extends State<ProjectPicker> {
  List<String> _recent = [];
  bool _busy = false;
  bool _cancelled = false;
  bool _provisioning = false;
  String _progress = 'Starting pi and connecting…';
  String? _error;
  EnvironmentIdentity? _pending;
  EnvironmentReadiness? _readiness;
  late final DevelopmentEnvironmentService _environments =
      widget.environments ?? DevelopmentEnvironmentService();

  @override
  void initState() {
    super.initState();
    try {
      final data = jsonDecode(_recentFile.readAsStringSync()) as List;
      _recent = data.whereType<String>().take(10).toList();
    } catch (_) {
      /* No usable recent-project inventory. */
    }
  }

  File get _recentFile =>
      widget.recentProjectsFile ??
      File(
        '${Platform.environment['HOME'] ?? '/'}/.pi/pif/recent_projects.json',
      );

  void _saveRecent(String path) {
    final updated = [
      path,
      ..._recent.where((p) => p != path),
    ].take(10).toList();
    _recentFile.parent.createSync(recursive: true);
    _recentFile.writeAsStringSync('${jsonEncode(updated)}\n');
    if (mounted) setState(() => _recent = updated);
  }

  Future<String?> _chooseFolder(String prompt) async {
    if (widget.chooseFolder != null) return widget.chooseFolder!(prompt);
    final result = await Process.run('/usr/bin/osascript', [
      '-e',
      'on run argv',
      '-e',
      'POSIX path of (choose folder with prompt (item 1 of argv))',
      '-e',
      'end run',
      prompt,
    ]);
    if (result.exitCode != 0) {
      if ((result.stderr as String).contains('(-128)')) return null;
      throw StateError('Folder selection is unavailable: ${result.stderr}');
    }
    final path = (result.stdout as String).trim();
    return path.isEmpty ? null : path;
  }

  Future<void> _run(Future<void> Function() action, {String? progress}) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _cancelled = false;
      _error = null;
      _progress = progress ?? 'Starting pi and connecting…';
    });
    try {
      await action();
    } catch (error) {
      if (mounted && !_cancelled) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<EnvironmentIdentity> _select(String path) async {
    final identity = await EnvironmentIdentity.ensure(path);
    _pending = identity;
    _readiness = null;
    _saveRecent(identity.workspacePath);
    await widget.onEnvironmentSelected?.call(identity);
    return identity;
  }

  Future<void> _launch(String path) => _run(() async {
    final identity = await _select(path);
    await _openReady(identity);
  });

  Future<void> _openReady(EnvironmentIdentity identity) async {
    // A saved identity/repository is not yet an editable workspace. Continue
    // that local step automatically without repeating account/repo setup.
    if (!identity.hasEditableSource) {
      await _prepare(identity);
      return;
    }
    final readiness = await _environments.inspect(identity);
    if (!mounted) return;
    setState(() => _readiness = readiness);
    if (readiness.canBuild) {
      setState(() => _progress = 'Opening your project…');
      await widget.onLaunch(identity.workspacePath);
    }
  }

  Future<void> _openFolder() => _run(() async {
    final path = await _chooseFolder(
      'Open a development environment or project',
    );
    if (path == null || !mounted) return;
    final identity = await _select(path);
    await _openReady(identity);
  });

  Future<void> _createProject() async {
    if (widget.onCreateProject != null) {
      return _run(() async {
        final identity = await widget.onCreateProject!();
        if (identity == null || !mounted) return;
        await _openReady(await _select(identity.workspacePath));
      }, progress: 'Creating your project…');
    }
    var draftName = '';
    final name = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('New Project'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Create a workspace for your application.'),
            const SizedBox(height: 16),
            TextField(
              onChanged: (value) => draftName = value,
              autofocus: true,
              decoration: const InputDecoration(labelText: 'Project name'),
              onSubmitted: (value) =>
                  Navigator.pop(dialogContext, value.trim()),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, draftName.trim()),
            child: const Text('Choose location'),
          ),
        ],
      ),
    );
    if (name == null || !mounted) return;
    await _run(() async {
      final parent = await _chooseFolder('Choose where to create $name');
      if (parent == null || !mounted) return;
      final identity = await _environments.create(
        parentPath: parent,
        name: name,
      );
      _pending = identity;
      _saveRecent(identity.workspacePath);
      await widget.onEnvironmentSelected?.call(identity);
      await _prepare(identity);
    }, progress: 'Saving the new environment identity…');
  }

  Future<void> _prepare(EnvironmentIdentity identity) async {
    if (mounted)
      setState(() {
        _provisioning = true;
        _readiness = null;
        _progress = 'Preparing your workspace…';
      });
    try {
      final prepared = await _environments.provision(
        identity,
        onProgress: (message) {
          if (mounted) setState(() => _progress = message);
        },
        isCancelled: () => _cancelled || !mounted,
      );
      _pending = prepared;
      final readiness = await _environments.inspect(prepared);
      if (!mounted) return;
      setState(() => _readiness = readiness);
      if (readiness.canBuild && !_cancelled) {
        setState(() => _progress = 'Opening your project…');
        await widget.onLaunch(prepared.workspacePath);
      }
    } finally {
      if (mounted) setState(() => _provisioning = false);
    }
  }

  Future<void> _selectSdk() => _run(() async {
    final identity = _pending;
    if (identity == null) return;
    final sdk = await _chooseFolder('Select the prepared Flutter SDK folder');
    if (sdk == null) return;
    await DevelopmentToolchain.selectFlutterSdk(identity.workspacePath, sdk);
    await _openReady(identity);
  }, progress: 'Checking the selected Flutter SDK…');

  Future<void> _reviewSetup() async {
    final readiness = _readiness;
    final needsFlutter =
        readiness != null &&
        (readiness.tools.flutter == null ||
            readiness.tools.dart == null ||
            readiness.tools.issues.any(
              (issue) => issue.startsWith('The saved Flutter SDK'),
            ));
    final proceed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Finish project setup'),
        content: SizedBox(
          width: 480,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Your project and saved connection are preserved.'),
                const SizedBox(height: 16),
                for (final issue in [
                  ?_error,
                  ...?readiness?.allIssues,
                ])
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: SelectableText(issue),
                  ),
                if (needsFlutter)
                  const Text(
                    'PIF could not find a usable Flutter installation automatically. '
                    'If it is installed elsewhere, choose the Flutter SDK folder containing '
                    'bin/flutter. You do not need to select an individual file.',
                  ),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Back'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(needsFlutter ? 'Locate Flutter SDK' : 'Check again'),
          ),
        ],
      ),
    );
    if (proceed != true || !mounted || _pending == null) return;
    if (needsFlutter) {
      await _selectSdk();
    } else {
      await _run(
        () => _openReady(_pending!),
        progress: 'Checking project setup…',
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final needsAttention =
        _pending != null && (_error != null || _readiness?.canBuild == false);
    final projectName = _pending?.workspacePath.split('/').last;
    return Scaffold(
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(40),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 560),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Expanded(
                      child: Text(
                        'pif',
                        style: TextStyle(
                          fontSize: 32,
                          fontWeight: FontWeight.w300,
                          letterSpacing: 1,
                        ),
                      ),
                    ),
                    if (widget.onOpenSettings != null)
                      IconButton(
                        tooltip: 'Settings',
                        onPressed: _busy ? null : widget.onOpenSettings,
                        icon: const Icon(Icons.settings_outlined),
                      ),
                  ],
                ),
                Text(
                  'PI-NATIVE AGENTIC IDE',
                  style: TextStyle(
                    fontSize: 11,
                    letterSpacing: 1.4,
                    color: colors.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 32),
                if (_busy) ...[
                  const LinearProgressIndicator(),
                  const SizedBox(height: 16),
                  Text(_progress),
                  if (_provisioning)
                    TextButton(
                      onPressed: () => setState(() => _cancelled = true),
                      child: const Text('Cancel'),
                    ),
                ] else if (needsAttention) ...[
                  Text(
                    'Finish setting up $projectName',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const SizedBox(height: 12),
                  Text(
                    _readiness?.tools.ready == false
                        ? 'A build tool needs attention before your project can open.'
                        : 'PIF could not finish preparing this workspace.',
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'Your project and saved connection are preserved.',
                  ),
                  const SizedBox(height: 20),
                  FilledButton(
                    onPressed: _reviewSetup,
                    child: const Text('Review setup'),
                  ),
                  TextButton(
                    onPressed: () => setState(() {
                      _pending = null;
                      _readiness = null;
                      _error = null;
                    }),
                    child: const Text('Back to projects'),
                  ),
                ] else ...[
                  SizedBox(
                    width: double.infinity,
                    height: 48,
                    child: FilledButton.icon(
                      onPressed: _createProject,
                      icon: const Icon(Icons.add),
                      label: const Text('New Project'),
                    ),
                  ),
                  const SizedBox(height: 12),
                  SizedBox(
                    width: double.infinity,
                    height: 48,
                    child: OutlinedButton.icon(
                      onPressed: _openFolder,
                      icon: const Icon(Icons.folder_open),
                      label: const Text('Open Project'),
                    ),
                  ),
                  if (_recent.isNotEmpty) ...[
                    const SizedBox(height: 28),
                    Text(
                      'Recent Projects',
                      style: TextStyle(
                        fontSize: 12,
                        color: colors.onSurfaceVariant,
                      ),
                    ),
                    const SizedBox(height: 8),
                    for (final path in _recent)
                      ListTile(
                        dense: true,
                        contentPadding: const EdgeInsets.symmetric(
                          horizontal: 8,
                        ),
                        leading: Icon(
                          Icons.folder_outlined,
                          size: 20,
                          color: colors.onSurfaceVariant,
                        ),
                        title: Text(
                          path.split('/').where((part) => part.isNotEmpty).last,
                          style: const TextStyle(fontSize: 14),
                        ),
                        subtitle: Text(
                          path,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 11,
                            color: colors.onSurfaceVariant,
                          ),
                        ),
                        onTap: () => _launch(path),
                      ),
                  ],
                  if (_error != null) ...[
                    const SizedBox(height: 16),
                    Text(_error!, style: TextStyle(color: colors.error)),
                  ],
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
