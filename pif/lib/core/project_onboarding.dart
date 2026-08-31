import 'dart:io';
import 'package:flutter/material.dart';
import 'development_environment.dart';
import 'github_connection.dart';
import 'project_repository.dart';

/// Returns an environment after an explicit repository decision. The caller
/// launches a new workspace, or refreshes the current tracker without restart.
Future<EnvironmentIdentity?> showProjectOnboarding(
  BuildContext context, {
  required DevelopmentEnvironmentService environments,
  required GithubConnectionService github,
  required Future<void> Function(EnvironmentIdentity) onEnvironmentSelected,
  required Future<void> Function() onOpenSettings,
  EnvironmentIdentity? environment,
}) => showDialog<EnvironmentIdentity>(
  context: context,
  barrierDismissible: false,
  builder: (_) => _ProjectOnboarding(
    environments: environments,
    github: github,
    onEnvironmentSelected: onEnvironmentSelected,
    onOpenSettings: onOpenSettings,
    environment: environment,
  ),
);

class _ProjectOnboarding extends StatefulWidget {
  const _ProjectOnboarding({
    required this.environments,
    required this.github,
    required this.onEnvironmentSelected,
    required this.onOpenSettings,
    this.environment,
  });
  final DevelopmentEnvironmentService environments;
  final GithubConnectionService github;
  final Future<void> Function(EnvironmentIdentity) onEnvironmentSelected;
  final Future<void> Function() onOpenSettings;
  final EnvironmentIdentity? environment;
  @override
  State<_ProjectOnboarding> createState() => _ProjectOnboardingState();
}

class _ProjectOnboardingState extends State<_ProjectOnboarding> {
  final _name = TextEditingController();
  final _owner = TextEditingController();
  final _repo = TextEditingController();
  late final _repositories = ProjectRepositoryService(widget.github);
  EnvironmentIdentity? _identity;
  String _mode = 'create';
  String? _location;
  String? _error;
  String? _notice;
  bool _private = true;
  bool _busy = false;
  bool _createdHere = false;
  bool _finished = false;
  String _progress = '';

  @override
  void initState() {
    super.initState();
    widget.github.addListener(_connectionChanged);
    if (widget.environment != null) {
      _mode = 'connect';
      WidgetsBinding.instance.addPostFrameCallback(
        (_) => _run(() => _activate(widget.environment!)),
      );
    }
  }

  @override
  void dispose() {
    widget.github.removeListener(_connectionChanged);
    _name.dispose();
    _owner.dispose();
    _repo.dispose();
    super.dispose();
  }

  void _connectionChanged() {
    if (!mounted) return;
    if (_owner.text.isEmpty && widget.github.state.account != null)
      _owner.text = widget.github.state.account!;
    setState(() {});
  }

  Future<void> _run(Future<void> Function() action) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<String?> _folder(String prompt) async {
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
      throw StateError('The folder chooser is unavailable. ${result.stderr}');
    }
    return (result.stdout as String).trim();
  }

  Future<void> _activate(EnvironmentIdentity identity) async {
    _identity =
        identity; // Identity exists before token setup or tool discovery.
    if (widget.github.environmentId != identity.id ||
        widget.github.workspace != identity.workspacePath) {
      await widget.onEnvironmentSelected(identity);
    }
    final saved = _repositories.pending(identity);
    if (saved?['mode'] == 'create' &&
        ['requested', 'remote_created', 'denied'].contains(saved?['phase'])) {
      _mode = 'create';
      final target = (saved!['target'] as String).split('/');
      _owner.text = target.first;
      _repo.text = target.last;
      _private = saved['private'] == true;
      _notice =
          'A saved creation request needs review. Retry checks the exact target before any further action.';
    } else {
      final origin = await _repositories.currentRepository(identity);
      if (origin != null) {
        _mode = 'connect';
        _owner.text = origin.split('/').first;
        _repo.text = origin.split('/').last;
      }
    }
    if (_repo.text.isEmpty)
      _repo.text = identity.workspacePath
          .split('/')
          .last
          .replaceAll(RegExp(r'[^A-Za-z0-9._-]'), '-');
    _connectionChanged();
  }

  Future<void> _selectLocation() => _run(() async {
    final path = await _folder(
      _mode == 'connect'
          ? 'Select an existing local workspace'
          : 'Choose the parent folder for the new project',
    );
    if (path == null || path.isEmpty || !mounted) return;
    setState(() => _location = path);
    if (_mode == 'connect')
      await _activate(await EnvironmentIdentity.ensure(path));
  });
  Future<void> _allocate() => _run(() async {
    if (_location == null)
      throw StateError('Choose the local project location first.');
    final identity = await widget.environments.create(
      parentPath: _location!,
      name: _name.text.trim(),
    );
    _createdHere = true;
    await _activate(identity);
  });
  Future<void> _settings() => _run(() async {
    if (_identity == null) return;
    await widget.onOpenSettings();
    _connectionChanged();
  });
  Future<void> _complete() => _run(() async {
    final identity = _identity!;
    final target = '${_owner.text.trim()}/${_repo.text.trim()}';
    setState(() => _progress = 'Saving the repository decision…');
    switch (_mode) {
      case 'local':
        await _repositories.localOnly(identity);
      case 'connect':
        await _repositories.connect(identity, target);
      case 'create':
        await _repositories.create(identity, target, private: _private);
    }
    var ready = identity;
    String? notice;
    if (_createdHere) {
      try {
        ready = await widget.environments.provision(
          identity,
          onProgress: (message) {
            if (mounted) setState(() => _progress = message);
          },
          isCancelled: () => !mounted,
        );
      } catch (error) {
        notice =
            'The environment and repository decision are saved. Builder setup needs attention: $error';
      }
    }
    try {
      final status = await widget.environments.inspect(ready);
      if (!status.canBuild)
        notice =
            '${notice == null ? '' : '$notice\n'}Build prerequisites need attention:\n${status.allIssues.join('\n')}';
    } catch (error) {
      notice =
          'The environment is saved. Build readiness could not be checked: $error';
    }
    if (!mounted) return;
    _identity = ready;
    if (notice == null) {
      Navigator.pop(context, ready);
      return;
    }
    setState(() {
      _notice = '$notice\nYou can open the project and use Settings now.';
      _finished = true;
    });
  });

  @override
  Widget build(BuildContext context) {
    final github = widget.github.state;
    final selected = _identity != null;
    final canConfirm = selected && (_mode == 'local' || github.validated);
    return PopScope(
      canPop: !_busy,
      child: AlertDialog(
        title: Text(
          widget.environment == null ? 'New Project' : 'Connect Repository',
        ),
        content: SizedBox(
          width: 540,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (!_finished)
                  DropdownButtonFormField<String>(
                    initialValue: _mode,
                    isExpanded: true,
                    key: ValueKey('mode-$_mode'),
                    decoration: const InputDecoration(labelText: 'Repository'),
                    items: const [
                      DropdownMenuItem(
                        value: 'create',
                        child: Text(
                          'Create on GitHub',
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      DropdownMenuItem(
                        value: 'connect',
                        child: Text(
                          'Connect Existing GitHub Repository',
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      DropdownMenuItem(
                        value: 'local',
                        child: Text(
                          'Local only — tracker disconnected',
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ],
                    onChanged: _busy
                        ? null
                        : (value) => setState(() {
                            _mode = value!;
                            _error = null;
                            if (!selected) _location = null;
                          }),
                  ),
                const SizedBox(height: 16),
                if (!selected) ...[
                  if (_mode != 'connect')
                    TextField(
                      controller: _name,
                      enabled: !_busy,
                      decoration: const InputDecoration(
                        labelText: 'Local project name',
                      ),
                    ),
                  const SizedBox(height: 12),
                  OutlinedButton.icon(
                    onPressed: _busy ? null : _selectLocation,
                    icon: const Icon(Icons.folder_open),
                    label: Text(
                      _location ??
                          (_mode == 'connect'
                              ? 'Select existing workspace'
                              : 'Choose project location'),
                    ),
                  ),
                  if (_mode != 'connect')
                    FilledButton(
                      onPressed: _busy ? null : _allocate,
                      child: const Text('Create local environment'),
                    ),
                  const SizedBox(height: 8),
                  const Text(
                    'The local environment is created first. This step never creates a remote repository.',
                  ),
                ] else ...[
                  SelectableText(_identity!.workspacePath),
                  const SizedBox(height: 12),
                  if (!_finished && _mode != 'local') ...[
                    Text(
                      'Account: ${github.validated ? github.account : 'not verified for this environment'}',
                    ),
                    Text(github.message),
                    TextButton(
                      onPressed: _busy ? null : _settings,
                      child: const Text('Open GitHub Settings'),
                    ),
                    TextField(
                      controller: _owner,
                      enabled: !_busy,
                      decoration: const InputDecoration(
                        labelText: 'GitHub owner or organization',
                      ),
                      onChanged: (_) => setState(() {}),
                    ),
                    TextField(
                      controller: _repo,
                      enabled: !_busy,
                      decoration: const InputDecoration(
                        labelText: 'Repository name',
                      ),
                      onChanged: (_) => setState(() {}),
                    ),
                    if (_mode == 'create')
                      SwitchListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text(
                          _private ? 'Private repository' : 'Public repository',
                        ),
                        value: _private,
                        onChanged: _busy
                            ? null
                            : (value) => setState(() => _private = value),
                      ),
                    const SizedBox(height: 12),
                    Text(
                      'Review: ${github.account ?? 'unverified account'} → github.com/${_owner.text.trim()}/${_repo.text.trim()}${_mode == 'create' ? (_private ? ' (private)' : ' (public)') : ' (existing visibility preserved)'}.',
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                    const Text(
                      'Confirming may initialize Git in this folder and add a matching origin. Existing origins and history are preserved. No files are committed or pushed.',
                    ),
                    if (_mode == 'create')
                      const Text(
                        'Issues will be enabled. A random, non-secret recovery marker is stored in the repository description so an uncertain request can be reconciled safely.',
                      ),
                  ],
                  if (!_finished && _mode == 'local')
                    const Text(
                      'No GitHub account or remote is required. The tracker stays disconnected; connect this environment later in Settings.',
                    ),
                ],
                if (_notice != null) ...[
                  const SizedBox(height: 12),
                  SelectableText(_notice!),
                ],
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  Text(
                    _error!,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                ],
                if (_busy) ...[
                  const SizedBox(height: 12),
                  const LinearProgressIndicator(),
                  Text(_progress),
                ],
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: _busy ? null : () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          if (_finished)
            FilledButton(
              onPressed: () => Navigator.pop(context, _identity),
              child: const Text('Open project'),
            )
          else if (selected)
            FilledButton(
              onPressed: !_busy && canConfirm ? _complete : null,
              child: Text(
                _mode == 'local'
                    ? 'Use local only'
                    : _mode == 'connect'
                    ? 'Connect existing repository'
                    : 'Create on GitHub',
              ),
            ),
        ],
      ),
    );
  }
}
