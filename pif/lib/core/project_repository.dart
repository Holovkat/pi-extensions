import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'development_environment.dart';
import 'development_toolchain.dart';
import 'github_connection.dart';
import 'workspace_paths.dart';

/// Repository setup never adds files, commits, pushes, deletes a remote or
/// changes the user's Git identity. GitHub runs only through the native broker.
class ProjectRepositoryService {
  ProjectRepositoryService(this.github);
  final GithubConnectionService github;
  static final _active = <String>{};
  static final _target = RegExp(
    r'^[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9._-]{1,100}$',
  );

  static String? repositoryFromOrigin(String value) {
    final normalized = value.startsWith('git@github.com:')
        ? 'https://github.com/${value.substring(15)}'
        : value;
    final uri = Uri.tryParse(normalized);
    if (uri == null ||
        uri.host.toLowerCase() != 'github.com' ||
        uri.hasQuery ||
        uri.hasFragment ||
        uri.hasPort ||
        !(uri.scheme == 'https' && uri.userInfo.isEmpty ||
            uri.scheme == 'ssh' && uri.userInfo == 'git'))
      return null;
    final repo = uri.path
        .replaceFirst(RegExp(r'^/'), '')
        .replaceFirst(RegExp(r'\.git$'), '');
    return _target.hasMatch(repo) && !['.', '..'].contains(repo.split('/').last)
        ? repo
        : null;
  }

  File _stateFile(EnvironmentIdentity environment) => File(
    WorkspacePaths.child(
      environment.workspacePath,
      '.pi/pif/repository-setup.json',
    ),
  );

  Map<String, dynamic>? pending(EnvironmentIdentity environment) {
    final file = _stateFile(environment);
    final type = FileSystemEntity.typeSync(file.path, followLinks: false);
    if (type == FileSystemEntityType.notFound) return null;
    if (type != FileSystemEntityType.file || file.lengthSync() > 16384) {
      throw StateError(
        'Repository setup state is not a small regular file. It was preserved.',
      );
    }
    final value = jsonDecode(file.readAsStringSync());
    if (value is! Map<String, dynamic> ||
        value['schemaVersion'] != 1 ||
        value['environmentId'] != environment.id ||
        !['local', 'create', 'connect'].contains(value['mode']) ||
        ![
          'local',
          'requested',
          'denied',
          'remote_created',
          'linked',
        ].contains(value['phase'])) {
      throw StateError(
        'Repository setup state is invalid. It was preserved; inspect it before continuing.',
      );
    }
    if (value['mode'] != 'local' &&
        (value['target'] is! String ||
            !_target.hasMatch(value['target'] as String) ||
            value['account'] is! String ||
            value['private'] is! bool ||
            (value['repoId'] != null &&
                (value['repoId'] is! int || value['repoId'] < 1)))) {
      throw StateError(
        'Repository setup target metadata is invalid. It was preserved.',
      );
    }
    if (value['mode'] == 'create' &&
        (value['marker'] is! String ||
            !RegExp(
              r'^pif setup [a-f0-9]{32}$',
            ).hasMatch(value['marker'] as String))) {
      throw StateError(
        'Repository setup recovery marker is invalid. It was preserved.',
      );
    }
    return {
      for (final key in [
        'schemaVersion',
        'environmentId',
        'mode',
        'phase',
        'account',
        'target',
        'private',
        'repoId',
        'marker',
        'requestedAt',
      ])
        if (value.containsKey(key)) key: value[key],
    };
  }

  Future<void> _save(
    EnvironmentIdentity environment,
    Map<String, dynamic> value,
  ) async {
    final file = _stateFile(environment);
    final stage = await file.parent.createTemp('.repository-state-');
    try {
      final staged = File('${stage.path}/state.json');
      await staged.writeAsString(
        '${jsonEncode({'schemaVersion': 1, 'environmentId': environment.id, ...value})}\n',
        flush: true,
      );
      _stateFile(environment); // Recheck symlinks before atomic publication.
      await staged.rename(file.path);
    } finally {
      await stage.delete(recursive: true);
    }
  }

  Future<void> _locked(
    EnvironmentIdentity environment,
    Future<void> Function() action,
  ) async {
    final current = await EnvironmentIdentity.ensure(environment.workspacePath);
    if (current.id != environment.id)
      throw StateError('The environment identity changed. Reopen it.');
    final lock = File(
      WorkspacePaths.child(
        environment.workspacePath,
        '.pi/pif/repository-setup.lock',
      ),
    );
    final key = '${environment.id}:${environment.workspacePath}';
    if (!_active.add(key))
      throw StateError('Repository setup is already in progress.');
    RandomAccessFile? handle;
    var acquired = false;
    try {
      if (FileSystemEntity.typeSync(lock.path, followLinks: false) ==
          FileSystemEntityType.notFound) {
        try {
          await lock.create(exclusive: true);
        } on FileSystemException {
          /* Another process may have created the stable lock file. */
        }
      }
      if (FileSystemEntity.typeSync(lock.path, followLinks: false) !=
          FileSystemEntityType.file) {
        throw StateError('Repository setup lock must be a regular file.');
      }
      handle = await lock.open(mode: FileMode.append);
      try {
        await handle.lock(FileLock.exclusive);
        acquired = true;
      } on FileSystemException {
        throw StateError(
          'Another process is setting up this repository. Retry when it finishes.',
        );
      }
      await action();
    } finally {
      try {
        if (acquired) await handle?.unlock();
      } finally {
        await handle?.close();
        _active.remove(key);
      }
      // Keep the inode stable. The kernel releases this lock after a crash.
    }
  }

  void _scope(EnvironmentIdentity environment) {
    if (github.environmentId != environment.id ||
        github.workspace != environment.workspacePath ||
        !github.state.validated ||
        github.state.account == null) {
      throw StateError(
        'Validate this environment’s GitHub token in Settings before continuing.',
      );
    }
  }

  Future<ProcessResult> _git(
    EnvironmentIdentity environment,
    List<String> args,
  ) async {
    final candidates = [
      '/opt/homebrew/bin/git',
      '/usr/local/bin/git',
      '/usr/bin/git',
      for (final dir in Platform.environment['PATH']?.split(':') ?? <String>[])
        if (dir.startsWith('/')) '$dir/git',
    ];
    final binary = candidates
        .where((path) => File(path).existsSync())
        .firstOrNull;
    if (binary == null)
      throw StateError(
        'Git is missing. Install Git explicitly; your environment is already saved.',
      );
    return Process.run(
      File(binary).resolveSymbolicLinksSync(),
      args,
      workingDirectory: environment.workspacePath,
      environment: {
        for (final entry in DevelopmentToolchain.cleanEnvironment().entries)
          if (!entry.key.startsWith('GIT_')) entry.key: entry.value,
        'GIT_CONFIG_NOSYSTEM': '1',
        'GIT_CONFIG_GLOBAL': '/dev/null',
        'GIT_TERMINAL_PROMPT': '0',
      },
      includeParentEnvironment: false,
    );
  }

  Future<String?> currentRepository(EnvironmentIdentity environment) async {
    final metadata = WorkspacePaths.child(environment.workspacePath, '.git');
    if (FileSystemEntity.typeSync(metadata, followLinks: false) ==
        FileSystemEntityType.notFound)
      return null;
    final root = await _git(environment, ['rev-parse', '--show-toplevel']);
    if (root.exitCode != 0 ||
        WorkspacePaths.canonical((root.stdout as String).trim()) !=
            environment.workspacePath) {
      throw StateError(
        'Git does not belong to this workspace. Parent repository history and origin are not reused.',
      );
    }
    final origin = await _git(environment, [
      'remote',
      'get-url',
      '--all',
      'origin',
    ]);
    if (origin.exitCode != 0) return null;
    final urls = (origin.stdout as String).trim().split('\n');
    if (urls.length != 1)
      throw StateError(
        'This workspace has multiple origin URLs. Resolve them explicitly before connecting.',
      );
    final repo = repositoryFromOrigin(urls.single);
    if (repo == null)
      throw StateError(
        'The existing origin is not a credential-free github.com repository. It was preserved.',
      );
    return repo;
  }

  Future<void> _localGit(EnvironmentIdentity environment) async {
    final metadata = WorkspacePaths.child(environment.workspacePath, '.git');
    if (FileSystemEntity.typeSync(metadata, followLinks: false) ==
        FileSystemEntityType.notFound) {
      final result = await _git(environment, [
        'init',
        '--initial-branch=main',
        '--template=',
        '.',
      ]);
      if (result.exitCode != 0)
        throw StateError(
          'Could not initialize Git in this workspace. Check folder permissions and retry.',
        );
    }
    await currentRepository(environment); // Verifies the exact repository root.
    final ignore = File(
      WorkspacePaths.child(environment.workspacePath, '.gitignore'),
    );
    final text = await ignore.readAsString();
    final rules = text.split('\n').map((line) => line.trim()).toSet();
    final missing = [
      '/.pi/',
      '/.pif/builder/',
      '/pif/.dart_tool/',
      '/pif/build/',
      '/pif/macos/Pods/',
      '/pif/macos/Flutter/ephemeral/',
      '/pif/.flutter-plugins-dependencies',
    ].where((rule) => !rules.contains(rule));
    if (missing.isNotEmpty)
      await ignore.writeAsString(
        '${text.endsWith('\n') ? '' : '\n'}${missing.join('\n')}\n',
        mode: FileMode.append,
        flush: true,
      );
  }

  Future<Map<String, dynamic>> _request(
    EnvironmentIdentity environment,
    List<String> args, {
    String? input,
  }) async {
    _scope(environment);
    final account = github.state.account;
    final result = await github.run(args, input: input);
    if (github.environmentId != environment.id ||
        github.workspace != environment.workspacePath ||
        github.state.account != account) {
      throw StateError(
        'The selected GitHub environment or account changed during the request.',
      );
    }
    return result;
  }

  Map<String, dynamic> _object(Map<String, dynamic> response) {
    if (response['ok'] != true || response['status'] != 0) {
      throw StateError(
        response['message'] as String? ??
            'GitHub could not complete the request. Check Settings and retry.',
      );
    }
    final value = jsonDecode(response['stdout'] as String);
    if (value is! Map<String, dynamic>)
      throw StateError('GitHub returned an invalid repository response.');
    return value;
  }

  Future<Map<String, dynamic>?> _readRemote(
    EnvironmentIdentity environment,
    String target,
  ) async {
    final response = await _request(environment, ['api', 'repos/$target']);
    if (response['code'] == 'not_found')
      return null; // 404 may also mean inaccessible; never repeat an uncertain POST from this alone.
    return _object(response);
  }

  void _verify(Map<String, dynamic> repo, String target, {bool? private}) {
    if ((repo['full_name'] as String?)?.toLowerCase() != target.toLowerCase() ||
        (repo['owner']?['login'] as String?)?.toLowerCase() !=
            target.split('/').first.toLowerCase() ||
        repo['id'] is! int ||
        repo['has_issues'] != true ||
        (private != null && repo['private'] != private)) {
      throw StateError(
        'GitHub did not confirm the exact repository, visibility and issue support. No origin was changed.',
      );
    }
  }

  void _validateTarget(String target) {
    if (!_target.hasMatch(target) ||
        ['.', '..'].contains(target.split('/').last))
      throw ArgumentError('Enter a valid GitHub owner and repository name.');
  }

  Future<void> _link(
    EnvironmentIdentity environment,
    String target,
    Map<String, dynamic> state,
  ) async {
    _scope(environment);
    final origin = await currentRepository(environment);
    if (origin != null && origin.toLowerCase() != target.toLowerCase()) {
      throw StateError(
        'This workspace already points to $origin. Its origin was preserved.',
      );
    }
    if (origin == null) {
      final added = await _git(environment, [
        'remote',
        'add',
        'origin',
        'https://github.com/$target.git',
      ]);
      if (added.exitCode != 0)
        throw StateError(
          'The remote exists, but its local origin could not be added. Retry to reconcile it; no remote will be recreated.',
        );
    }
    if ((await currentRepository(environment))?.toLowerCase() !=
        target.toLowerCase())
      throw StateError('The local origin could not be verified.');
    final verified = await _readRemote(environment, target);
    if (verified == null)
      throw StateError(
        'The remote could not be read back. Retry verification before using the tracker.',
      );
    _verify(verified, target, private: state['private'] as bool?);
    if (state['repoId'] != null && verified['id'] != state['repoId']) {
      throw StateError(
        'The repository identity changed during setup. Review it before continuing.',
      );
    }
    await _save(environment, {
      ...state,
      'phase': 'linked',
      'repoId': verified['id'],
    });
  }

  Future<void> localOnly(
    EnvironmentIdentity environment,
  ) => _locked(environment, () async {
    final pendingState = pending(environment);
    if (pendingState != null &&
        ['requested', 'remote_created'].contains(pendingState['phase']))
      throw StateError(
        'A GitHub creation needs recovery first. No remote was deleted.',
      );
    if (await currentRepository(environment) != null)
      throw StateError(
        'This workspace already has a GitHub origin. Local-only would detach it; no origin was changed.',
      );
    await _save(environment, {'mode': 'local', 'phase': 'local'});
  });

  Future<void> connect(
    EnvironmentIdentity environment,
    String target,
  ) => _locked(environment, () async {
    _validateTarget(target);
    _scope(environment);
    final remote = await _readRemote(environment, target);
    if (remote == null)
      throw StateError(
        'That repository is missing or inaccessible to this environment’s token.',
      );
    _verify(remote, target);
    await _localGit(environment);
    final origin = await currentRepository(environment);
    if (origin != null && origin.toLowerCase() != target.toLowerCase())
      throw StateError(
        'Existing origin $origin was preserved. Connect that repository or choose another workspace.',
      );
    final state = {
      'mode': 'connect',
      'phase': 'remote_created',
      'target': target,
      'account': github.state.account,
      'private': remote['private'],
      'repoId': remote['id'],
    };
    await _save(environment, state);
    await _link(environment, target, state);
  });

  Future<void> create(
    EnvironmentIdentity environment,
    String target, {
    required bool private,
  }) => _locked(environment, () async {
    _validateTarget(target);
    _scope(environment);
    final account = github.state.account!;
    final currentAccount = _object(
      await _request(environment, ['api', 'user']),
    );
    if ((currentAccount['login'] as String?)?.toLowerCase() !=
        account.toLowerCase()) {
      throw StateError(
        'GitHub did not confirm the reviewed account. Validate this token in Settings again.',
      );
    }
    await _localGit(environment);
    final origin = await currentRepository(environment);
    if (origin != null && origin.toLowerCase() != target.toLowerCase())
      throw StateError(
        'Existing origin $origin was preserved. No GitHub creation was sent.',
      );
    var state = pending(environment);
    final recovery =
        state != null &&
        state['mode'] == 'create' &&
        ['requested', 'remote_created', 'linked'].contains(state['phase']);
    if (recovery &&
        (state['target'] != target ||
            state['account'] != account ||
            state['private'] != private)) {
      throw StateError(
        'Recover the saved target/account/visibility before creating a different repository.',
      );
    }
    final existing = await _readRemote(environment, target);
    if (recovery) {
      if (existing == null)
        throw StateError(
          'The previous request may have created this repository, but it cannot be verified yet. Retry with access to the exact target; creation was not repeated.',
        );
      _verify(existing, target, private: private);
      if (existing['description'] != state['marker'] ||
          (state['repoId'] != null && existing['id'] != state['repoId'])) {
        throw StateError(
          'An existing repository does not match this setup attempt. Review it and use Connect Existing explicitly.',
        );
      }
    } else {
      if (existing != null || origin != null)
        throw StateError(
          'That repository already exists. Use Connect Existing; nothing was overwritten or published.',
        );
      final marker =
          'pif setup ${List.generate(16, (_) => Random.secure().nextInt(256).toRadixString(16).padLeft(2, '0')).join()}';
      state = {
        'mode': 'create',
        'phase': 'requested',
        'account': account,
        'target': target,
        'private': private,
        'marker': marker,
        'requestedAt': DateTime.now().toUtc().toIso8601String(),
      };
      await _save(
        environment,
        state,
      ); // Durable before any non-idempotent POST.
      final owner = target.split('/').first;
      final endpoint = owner.toLowerCase() == account.toLowerCase()
          ? 'user/repos'
          : 'orgs/$owner/repos';
      final response = await _request(
        environment,
        ['api', '--method', 'POST', endpoint, '--input', '-'],
        input: jsonEncode({
          'name': target.split('/').last,
          'private': private,
          'has_issues': true,
          'description': marker,
        }),
      );
      if (response['ok'] != true &&
          [
            'invalid_token',
            'missing_token',
            'insufficient_permissions',
            'unsupported_operation',
            'conflict',
            'already_exists',
            'not_found',
          ].contains(response['code'])) {
        await _save(environment, {...state, 'phase': 'denied'});
      }
      final created = _object(response);
      _verify(created, target, private: private);
      state = {...state, 'phase': 'remote_created', 'repoId': created['id']};
      await _save(environment, state);
    }
    await _link(environment, target, state);
  });
}
