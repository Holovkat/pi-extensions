import 'dart:io';
import 'package:flutter/material.dart';
import 'development_environment.dart';
import 'github_connection.dart';
import 'project_repository.dart';

/// Prepares a new or resumed project, preserving its saved repository choice.
/// [repositoryOnly] instead edits the current repository connection without
/// requiring builder setup. [chooseFolder] defaults to the native chooser.
Future<EnvironmentIdentity?> showProjectOnboarding(
  BuildContext context, {
  required DevelopmentEnvironmentService environments,
  required GithubConnectionService github,
  required Future<void> Function(EnvironmentIdentity) onEnvironmentSelected,
  required Future<void> Function() onOpenSettings,
  EnvironmentIdentity? environment,
  bool repositoryOnly = false,
  Future<String?> Function(String prompt)? chooseFolder,
}) => showDialog<EnvironmentIdentity>(
  context: context,
  barrierDismissible: false,
  builder: (_) => _ProjectOnboarding(
    environments: environments,
    github: github,
    onEnvironmentSelected: onEnvironmentSelected,
    onOpenSettings: onOpenSettings,
    environment: environment,
    repositoryOnly: repositoryOnly,
    chooseFolder: chooseFolder,
  ),
);

class _ProjectOnboarding extends StatefulWidget {
  const _ProjectOnboarding({
    required this.environments,
    required this.github,
    required this.onEnvironmentSelected,
    required this.onOpenSettings,
    this.environment,
    required this.repositoryOnly,
    this.chooseFolder,
  });
  final DevelopmentEnvironmentService environments;
  final GithubConnectionService github;
  final Future<void> Function(EnvironmentIdentity) onEnvironmentSelected;
  final Future<void> Function() onOpenSettings;
  final EnvironmentIdentity? environment;
  final bool repositoryOnly;
  final Future<String?> Function(String prompt)? chooseFolder;
  @override
  State<_ProjectOnboarding> createState() => _ProjectOnboardingState();
}

class _ProjectOnboardingState extends State<_ProjectOnboarding> {
  final _name = TextEditingController();
  final _location = TextEditingController();
  final _owner = TextEditingController();
  final _repo = TextEditingController();
  late final _repositories = ProjectRepositoryService(widget.github);
  EnvironmentIdentity? _identity;
  String _mode = 'create';
  bool _locationEdited = false;
  String? _error;
  String? _notice;
  bool _private = true;
  bool _busy = false;
  bool _showingSettings = false;
  bool _repositorySaved = false;
  bool _recovering = false;
  String _progress = '';

  @override
  void initState() {
    super.initState();
    widget.github.addListener(_connectionChanged);
    if (widget.environment != null) {
      _mode = widget.repositoryOnly ? 'connect' : 'create';
      WidgetsBinding.instance.addPostFrameCallback(
        (_) => _run(() => _activate(widget.environment!)),
      );
    }
  }

  @override
  void dispose() {
    widget.github.removeListener(_connectionChanged);
    _name.dispose();
    _location.dispose();
    _owner.dispose();
    _repo.dispose();
    super.dispose();
  }

  void _connectionChanged() {
    if (!mounted) return;
    if (_githubVerified && _owner.text.isEmpty)
      _owner.text = widget.github.state.account!;
    setState(() {});
  }

  bool get _githubVerified =>
      _identity != null &&
      widget.github.environmentId == _identity!.id &&
      widget.github.workspace == _identity!.workspacePath &&
      widget.github.state.validated &&
      widget.github.state.account != null;

  Future<void> _run(Future<void> Function() action) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } catch (error) {
      if (mounted) {
        setState(
          () => _error = error is StateError ? error.message : error.toString(),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<String?> _folder(String prompt) async {
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
    if (saved != null &&
        (!widget.repositoryOnly ||
            !['local', 'linked'].contains(saved['phase']))) {
      _mode = saved['mode'] as String;
      _repositorySaved = ['local', 'linked'].contains(saved['phase']);
      _recovering = ['requested', 'remote_created'].contains(saved['phase']);
      if (saved['target'] is String) {
        final target = (saved['target'] as String).split('/');
        _owner.text = target.first;
        _repo.text = target.last;
        _private = saved['private'] == true;
      }
      _notice = _repositorySaved
          ? 'Your repository choice is saved. Continue preparing this project.'
          : _recovering
          ? 'A saved request needs verification. The exact repository will be checked before continuing.'
          : 'The previous request was declined. Review the repository details before continuing.';
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
    final path = await _folder('Choose the parent folder for the new project');
    if (path == null || path.isEmpty || !mounted) return;
    setState(() {
      _location.text = path;
      _locationEdited = true;
    });
  });

  String? get _locationError {
    final path = _location.text.trim();
    if (path.isEmpty) return 'Enter the parent folder for the new project.';
    if (!path.startsWith('/'))
      return 'Enter the full folder path beginning with /.';
    return switch (FileSystemEntity.typeSync(path, followLinks: true)) {
      FileSystemEntityType.directory => null,
      FileSystemEntityType.notFound => 'This folder does not exist.',
      _ => 'This path is not a folder.',
    };
  }

  Future<void> _allocate() => _run(() async {
    final locationError = _locationError;
    if (locationError != null) {
      setState(() => _locationEdited = true);
      return;
    }
    final identity = await widget.environments.create(
      parentPath: _location.text.trim(),
      name: _name.text.trim(),
    );
    await _activate(identity);
  });
  Future<void> _settings() async {
    if (_busy || _showingSettings) return;
    setState(() => _showingSettings = true);
    try {
      final identity = _identity;
      if (identity != null &&
          (widget.github.environmentId != identity.id ||
              widget.github.workspace != identity.workspacePath)) {
        await widget.onEnvironmentSelected(identity);
      }
      await widget.onOpenSettings();
      _connectionChanged();
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _showingSettings = false);
    }
  }

  Future<void> _complete() => _run(() async {
    final identity = _identity!;
    if (!_repositorySaved) {
      final target = '${_owner.text.trim()}/${_repo.text.trim()}';
      setState(() => _progress = 'Saving the repository decision…');
      try {
        switch (_mode) {
          case 'local':
            await _repositories.localOnly(identity);
          case 'connect':
            await _repositories.connect(identity, target);
          case 'create':
            await _repositories.create(identity, target, private: _private);
        }
      } catch (_) {
        _recovering = [
          'requested',
          'remote_created',
        ].contains(_repositories.pending(identity)?['phase']);
        rethrow;
      }
      _repositorySaved = true;
      _recovering = false;
    }
    if (!mounted) return;
    if (widget.repositoryOnly) {
      Navigator.pop(context, identity);
      return;
    }

    setState(() {
      _notice = 'Your project and repository choice are saved.';
      _progress = 'Preparing the project…';
    });
    var ready = identity;
    if (!identity.hasEditableSource) {
      ready = await widget.environments.provision(
        identity,
        onProgress: (message) {
          if (mounted) setState(() => _progress = message);
        },
        isCancelled: () => !mounted,
      );
    }
    _identity = ready;
    final status = await widget.environments.inspect(ready);
    if (!status.canBuild) {
      throw StateError(
        'Project setup needs attention:\n${status.allIssues.join('\n')}',
      );
    }
    if (mounted) Navigator.pop(context, ready);
  });

  @override
  Widget build(BuildContext context) {
    final github = widget.github.state;
    final selected = _identity != null;
    final verified = _githubVerified;
    final needsConnection =
        selected && !_repositorySaved && _mode != 'local' && !verified;
    final primaryLabel = !selected
        ? 'Continue'
        : _repositorySaved
        ? 'Continue setup'
        : needsConnection
        ? 'Connect GitHub'
        : _recovering
        ? 'Check repository setup'
        : switch (_mode) {
            'local' =>
              widget.repositoryOnly ? 'Use local only' : 'Create project',
            'connect' => 'Connect existing repository',
            _ => 'Create on GitHub',
          };
    final canContinue =
        selected || (_locationError == null && _name.text.trim().isNotEmpty);
    return PopScope(
      canPop: !_busy,
      child: AlertDialog(
        title: Row(
          children: [
            Expanded(
              child: Text(
                widget.repositoryOnly ? 'Connect Repository' : 'New Project',
              ),
            ),
            IconButton(
              tooltip: 'Settings',
              onPressed: _busy || _showingSettings ? null : _settings,
              icon: const Icon(Icons.settings_outlined, size: 20),
            ),
          ],
        ),
        content: SizedBox(
          width: 540,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (selected && !_repositorySaved)
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
                          'Local project',
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ],
                    onChanged: _busy || _recovering
                        ? null
                        : (value) => setState(() {
                            _mode = value!;
                            _error = null;
                            _notice = null;
                          }),
                  ),
                const SizedBox(height: 16),
                if (!selected) ...[
                  TextField(
                    controller: _name,
                    enabled: !_busy,
                    decoration: const InputDecoration(
                      labelText: 'Project name',
                    ),
                    onChanged: (_) => setState(() {}),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _location,
                    enabled: !_busy,
                    decoration: InputDecoration(
                      labelText: 'Parent folder',
                      hintText: '/Users/you/workspace',
                      errorText: _locationEdited ? _locationError : null,
                      suffixIcon: TextButton(
                        onPressed: _busy ? null : _selectLocation,
                        child: const Text('Browse'),
                      ),
                    ),
                    onChanged: (_) => setState(() {
                      _locationEdited = true;
                      _error = null;
                    }),
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'Choose a name and location. You can connect GitHub in the next step.',
                  ),
                ] else ...[
                  SelectableText(_identity!.workspacePath),
                  const SizedBox(height: 12),
                  if (!_repositorySaved && _mode != 'local') ...[
                    Text(
                      'Account: ${verified ? github.account : 'not connected for this project'}',
                    ),
                    if (needsConnection)
                      const Text(
                        'Connect this project’s GitHub token in Settings, or choose local only.',
                      ),
                  ],
                  if (!_repositorySaved && _mode != 'local' && verified) ...[
                    TextField(
                      controller: _owner,
                      enabled: !_busy && !_recovering,
                      decoration: const InputDecoration(
                        labelText: 'GitHub owner or organization',
                      ),
                      onChanged: (_) => setState(() {}),
                    ),
                    TextField(
                      controller: _repo,
                      enabled: !_busy && !_recovering,
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
                        onChanged: _busy || _recovering
                            ? null
                            : (value) => setState(() => _private = value),
                      ),
                    const SizedBox(height: 12),
                    Text(
                      'Review: ${github.account ?? 'unverified account'} → github.com/${_owner.text.trim()}/${_repo.text.trim()}${_mode == 'create' ? (_private ? ' (private)' : ' (public)') : ' (existing visibility preserved)'}.',
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                    const Text('No files are committed or pushed.'),
                  ],
                  if (!_repositorySaved && _mode == 'local')
                    const Text(
                      'GitHub and the tracker can be connected later.',
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
          FilledButton(
            onPressed: _busy || _showingSettings || !canContinue
                ? null
                : !selected
                ? _allocate
                : needsConnection
                ? _settings
                : _complete,
            child: Text(primaryLabel),
          ),
        ],
      ),
    );
  }
}
