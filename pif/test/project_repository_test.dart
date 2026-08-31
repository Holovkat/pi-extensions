import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pif/core/development_environment.dart';
import 'package:pif/core/github_connection.dart';
import 'package:pif/core/project_repository.dart';

const _channel = MethodChannel('pif/test/project_repository');
const _target = 'fixture/new-project';

Map<String, dynamic> _ok(Map<String, dynamic> value) => {
  'ok': true,
  'status': 0,
  'stdout': jsonEncode(value),
  'stderr': '',
};
Map<String, dynamic> _missing() => {
  'ok': false,
  'status': 1,
  'code': 'not_found',
  'message': 'Not found',
};
Map<String, dynamic> _remote(
  String target, {
  int id = 101,
  bool private = true,
  String description = '',
}) => {
  'id': id,
  'full_name': target,
  'owner': {'login': target.split('/').first},
  'private': private,
  'has_issues': true,
  'description': description,
};

/// Synthetic GitHub responses through the production MethodChannel adapter.
/// Local Git below is real, restricted to disposable directories and never
/// invokes fetch/push or changes user/system Git configuration.
class _GithubFixture {
  final remotes = <String, Map<String, dynamic>>{};
  final requests = <({List<String> args, String? input})>[];
  Future<Map<String, dynamic>> Function(List<String>, String?)? override;
  String account = 'fixture';

  Future<Object?> native(MethodCall call) async {
    if (call.method == 'selectEnvironment') {
      return {
        'saved': true,
        'validated': false,
        'message': 'Saved, not validated.',
      };
    }
    if (call.method == 'validate') {
      return {
        'saved': true,
        'validated': true,
        'account': account,
        'message': 'Validated.',
      };
    }
    if (call.method != 'run')
      throw StateError('Unexpected native call ${call.method}');
    final args = List<String>.from(call.arguments['args'] as List);
    final input = call.arguments['input'] as String?;
    requests.add((args: args, input: input));
    return override?.call(args, input) ?? respond(args, input);
  }

  Map<String, dynamic> respond(List<String> args, String? input) {
    if (args.length == 2 && args[1] == 'user') return _ok({'login': account});
    if (args.contains('POST')) {
      final body = jsonDecode(input!) as Map<String, dynamic>;
      final endpoint = args[args.indexOf('POST') + 1];
      final owner = endpoint == 'user/repos' ? account : endpoint.split('/')[1];
      final target = '$owner/${body['name']}';
      final created = _remote(
        target,
        private: body['private'] as bool,
        description: body['description'] as String,
      );
      remotes[target] = created;
      return _ok(created);
    }
    final target = args[1].substring('repos/'.length);
    final existing = remotes[target];
    return existing == null ? _missing() : _ok(existing);
  }

  Iterable<({List<String> args, String? input})> get posts =>
      requests.where((request) => request.args.contains('POST'));
}

void main() {
  final binding = TestWidgetsFlutterBinding.ensureInitialized();
  late Directory temporary;
  late EnvironmentIdentity environment;
  late GithubConnectionService github;
  late ProjectRepositoryService repositories;
  late _GithubFixture remote;

  Future<ProcessResult> git(String workspace, List<String> args) => Process.run(
    '/usr/bin/git',
    args,
    workingDirectory: workspace,
    environment: {
      'PATH': '/usr/bin:/bin',
      'GIT_CONFIG_NOSYSTEM': '1',
      'GIT_CONFIG_GLOBAL': '/dev/null',
      'GIT_TERMINAL_PROMPT': '0',
    },
    includeParentEnvironment: false,
  );

  Future<void> gitOk(String workspace, List<String> args) async {
    final result = await git(workspace, args);
    expect(result.exitCode, 0, reason: '${args.join(' ')}: ${result.stderr}');
  }

  Future<void> authenticated(EnvironmentIdentity identity) async {
    await github.selectEnvironment(
      environmentId: identity.id,
      workspace: identity.workspacePath,
    );
    await github.validate();
  }

  Future<void> expectUnpublished(EnvironmentIdentity identity) async {
    expect(
      (await git(identity.workspacePath, [
        'rev-parse',
        '--verify',
        'HEAD',
      ])).exitCode,
      isNot(0),
    );
    expect((await git(identity.workspacePath, ['ls-files'])).stdout, isEmpty);
    expect(
      (await git(identity.workspacePath, [
        'diff',
        '--cached',
        '--name-only',
      ])).stdout,
      isEmpty,
    );
    expect(
      (await git(identity.workspacePath, [
        'for-each-ref',
        'refs/remotes',
      ])).stdout,
      isEmpty,
    );
    expect(
      (await git(identity.workspacePath, [
        'config',
        '--local',
        '--get',
        'user.name',
      ])).exitCode,
      isNot(0),
    );
    expect(
      (await git(identity.workspacePath, [
        'config',
        '--local',
        '--get',
        'user.email',
      ])).exitCode,
      isNot(0),
    );
  }

  setUp(() async {
    temporary = Directory.systemTemp.createTempSync('pif-repository-test-');
    environment = await EnvironmentIdentity.ensure(
      temporary.resolveSymbolicLinksSync(),
    );
    github = GithubConnectionService(channel: _channel);
    repositories = ProjectRepositoryService(github);
    remote = _GithubFixture();
    binding.defaultBinaryMessenger.setMockMethodCallHandler(
      _channel,
      remote.native,
    );
  });

  tearDown(() {
    github.dispose();
    binding.defaultBinaryMessenger.setMockMethodCallHandler(_channel, null);
    temporary.deleteSync(recursive: true);
  });

  test('only credential-free github.com origins are accepted', () {
    for (final url in [
      'https://github.com/owner/repo.git',
      'git@github.com:owner/repo.git',
      'ssh://git@github.com/owner/repo',
    ]) {
      expect(ProjectRepositoryService.repositoryFromOrigin(url), 'owner/repo');
    }
    for (final url in [
      'https://token@github.com/owner/repo',
      'https://github.com.evil.invalid/owner/repo',
      'https://github.com:8443/owner/repo',
      'https://github.com/owner/repo?token=fixture',
      'https://github.com/owner/repo#secret',
      'file:///tmp/repo',
      'https://gitlab.com/owner/repo',
      'https://github.com/owner/..',
    ]) {
      expect(
        ProjectRepositoryService.repositoryFromOrigin(url),
        isNull,
        reason: url,
      );
    }
  });

  test(
    'local-only saves disconnected state without a token or a Git repository',
    () async {
      await repositories.localOnly(environment);
      expect(repositories.pending(environment), containsPair('phase', 'local'));
      expect(github.environmentId, isNull);
      expect(remote.requests, isEmpty);
      expect(
        Directory('${environment.workspacePath}/.git').existsSync(),
        isFalse,
      );
      expect(await repositories.currentRepository(environment), isNull);
    },
  );

  test(
    'create persists intent before POST, verifies origin and leaves files unpublished',
    () async {
      File(
        '${environment.workspacePath}/draft.txt',
      ).writeAsStringSync('unpublished user content');
      await authenticated(environment);
      remote.override = (args, input) async {
        if (args.contains('POST')) {
          final recorded = repositories.pending(environment)!;
          expect(recorded['phase'], 'requested');
          expect(recorded['target'], _target);
          expect(recorded['private'], isTrue);
          final body = jsonDecode(input!) as Map;
          expect(body['description'], recorded['marker']);
          expect(body['has_issues'], isTrue);
        }
        return remote.respond(args, input);
      };
      await repositories.create(environment, _target, private: true);
      expect(remote.posts, hasLength(1));
      expect(remote.posts.single.args, [
        'api',
        '--method',
        'POST',
        'user/repos',
        '--input',
        '-',
      ]);
      expect(await repositories.currentRepository(environment), _target);
      expect(
        repositories.pending(environment),
        allOf(containsPair('phase', 'linked'), containsPair('repoId', 101)),
      );
      await expectUnpublished(environment);
      expect(
        File('${environment.workspacePath}/draft.txt').readAsStringSync(),
        'unpublished user content',
      );
      final ignored = await git(environment.workspacePath, [
        'check-ignore',
        '.pi/pif/environment.json',
        '.pif/builder/runtime/node',
        'pif/build/artifact',
      ]);
      expect(ignored.exitCode, 0);
      expect((ignored.stdout as String).trim().split('\n'), hasLength(3));
    },
  );

  test(
    'connect existing verifies twice and never sends repository creation',
    () async {
      await authenticated(environment);
      remote.remotes[_target] = _remote(_target, private: false);
      await repositories.connect(environment, _target);
      expect(await repositories.currentRepository(environment), _target);
      expect(remote.posts, isEmpty);
      expect(
        remote.requests.where(
          (request) => request.args.contains('repos/$_target'),
        ),
        hasLength(2),
      );
      expect(
        repositories.pending(environment),
        allOf(
          containsPair('mode', 'connect'),
          containsPair('phase', 'linked'),
          containsPair('private', false),
        ),
      );
      await expectUnpublished(environment);
    },
  );

  test(
    'uncertain creation reconciles matching remote without repeating POST after restart',
    () async {
      await authenticated(environment);
      var loseResponse = true;
      remote.override = (args, input) async {
        final result = remote.respond(args, input);
        if (args.contains('POST') && loseResponse) {
          loseResponse = false;
          return {
            'ok': false,
            'status': 1,
            'code': 'timeout',
            'message': 'Response was lost.',
          };
        }
        return result;
      };
      await expectLater(
        repositories.create(environment, _target, private: true),
        throwsStateError,
      );
      expect(repositories.pending(environment)!['phase'], 'requested');
      expect(await repositories.currentRepository(environment), isNull);
      repositories = ProjectRepositoryService(github);
      await repositories.create(environment, _target, private: true);
      expect(remote.posts, hasLength(1));
      expect(repositories.pending(environment)!['phase'], 'linked');
      expect(await repositories.currentRepository(environment), _target);
      await expectUnpublished(environment);
    },
  );

  test(
    'uncertain 404 never repeats creation or silently switches to local-only',
    () async {
      await authenticated(environment);
      remote.override = (args, input) async => args.contains('POST')
          ? {
              'ok': false,
              'status': 1,
              'code': 'timeout',
              'message': 'Unknown creation outcome.',
            }
          : remote.respond(args, input);
      await expectLater(
        repositories.create(environment, _target, private: true),
        throwsStateError,
      );
      final saved = File(
        '${environment.stateDir}/repository-setup.json',
      ).readAsStringSync();
      await expectLater(
        repositories.create(environment, _target, private: true),
        throwsStateError,
      );
      await expectLater(repositories.localOnly(environment), throwsStateError);
      expect(remote.posts, hasLength(1));
      expect(
        File(
          '${environment.stateDir}/repository-setup.json',
        ).readAsStringSync(),
        saved,
      );
    },
  );

  test(
    'definitive creation denial allows local-only and a corrected target retry',
    () async {
      await authenticated(environment);
      var denyFirst = true;
      remote.override = (args, input) async {
        if (args.contains('POST') && denyFirst) {
          denyFirst = false;
          return {
            'ok': false,
            'status': 1,
            'code': 'conflict',
            'message': 'Repository name is unavailable.',
          };
        }
        return remote.respond(args, input);
      };
      await expectLater(
        repositories.create(environment, _target, private: true),
        throwsStateError,
      );
      expect(repositories.pending(environment)!['phase'], 'denied');
      await repositories.localOnly(environment);
      expect(repositories.pending(environment)!['phase'], 'local');
      await repositories.create(
        environment,
        'fixture/corrected-name',
        private: true,
      );
      expect(
        await repositories.currentRepository(environment),
        'fixture/corrected-name',
      );
      expect(remote.posts, hasLength(2));
      expect(repositories.pending(environment)!['phase'], 'linked');
      await expectUnpublished(environment);
    },
  );

  test(
    'recovery rejects a same-name remote with a different marker or reviewed visibility',
    () async {
      await authenticated(environment);
      remote.override = (args, input) async => args.contains('POST')
          ? {
              'ok': false,
              'status': 1,
              'code': 'timeout',
              'message': 'Unknown creation outcome.',
            }
          : remote.respond(args, input);
      await expectLater(
        repositories.create(environment, _target, private: true),
        throwsStateError,
      );
      remote.remotes[_target] = _remote(
        _target,
        description: 'a different creator',
      );
      await expectLater(
        repositories.create(environment, _target, private: true),
        throwsStateError,
      );
      await expectLater(
        repositories.create(environment, _target, private: false),
        throwsStateError,
      );
      expect(remote.posts, hasLength(1));
      expect(await repositories.currentRepository(environment), isNull);
    },
  );

  test(
    'wrong local origin is preserved for create, connect and local-only',
    () async {
      await authenticated(environment);
      await gitOk(environment.workspacePath, [
        'init',
        '--initial-branch=main',
        '--template=',
        '.',
      ]);
      await gitOk(environment.workspacePath, [
        'remote',
        'add',
        'origin',
        'https://github.com/fixture/existing.git',
      ]);
      remote.remotes[_target] = _remote(_target);
      await expectLater(
        repositories.create(environment, _target, private: true),
        throwsStateError,
      );
      await expectLater(
        repositories.connect(environment, _target),
        throwsStateError,
      );
      await expectLater(repositories.localOnly(environment), throwsStateError);
      expect(
        await repositories.currentRepository(environment),
        'fixture/existing',
      );
      expect(remote.posts, isEmpty);
      expect(repositories.pending(environment), isNull);
      await expectUnpublished(environment);
    },
  );

  test('child workspace never adopts a parent origin or history', () async {
    await gitOk(environment.workspacePath, [
      'init',
      '--initial-branch=main',
      '--template=',
      '.',
    ]);
    File(
      '${environment.workspacePath}/parent.txt',
    ).writeAsStringSync('parent history');
    await gitOk(environment.workspacePath, ['add', 'parent.txt']);
    await gitOk(environment.workspacePath, [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '-m',
      'Parent fixture',
    ]);
    await gitOk(environment.workspacePath, [
      'remote',
      'add',
      'origin',
      'https://github.com/fixture/parent.git',
    ]);
    final head = (await git(environment.workspacePath, [
      'rev-parse',
      'HEAD',
    ])).stdout;
    final child = await DevelopmentEnvironmentService().create(
      parentPath: environment.workspacePath,
      name: 'child',
    );
    expect(await repositories.currentRepository(child), isNull);
    await repositories.localOnly(child);
    await authenticated(child);
    remote.remotes[_target] = _remote(_target);
    await repositories.connect(child, _target);
    expect(await repositories.currentRepository(child), _target);
    expect(
      (await git(child.workspacePath, ['rev-parse', '--show-toplevel'])).stdout,
      '${child.workspacePath}\n',
    );
    await expectUnpublished(child);
    expect(
      (await git(environment.workspacePath, ['rev-parse', 'HEAD'])).stdout,
      head,
    );
    expect(await repositories.currentRepository(environment), 'fixture/parent');
    expect(
      (await git(environment.workspacePath, [
        'show',
        'HEAD:parent.txt',
      ])).stdout,
      'parent history',
    );
  });

  test(
    'account mismatch and foreign environment scope stop before any creation',
    () async {
      await authenticated(environment);
      remote.account = 'different-account';
      await expectLater(
        repositories.create(environment, _target, private: true),
        throwsStateError,
      );
      expect(remote.posts, isEmpty);
      expect(
        Directory('${environment.workspacePath}/.git').existsSync(),
        isFalse,
      );
      final other = await DevelopmentEnvironmentService().create(
        parentPath: environment.workspacePath,
        name: 'other',
      );
      await expectLater(repositories.connect(other, _target), throwsStateError);
      expect(Directory('${other.workspacePath}/.git').existsSync(), isFalse);
    },
  );

  test(
    'overlapping creation is rejected while one POST remains in flight',
    () async {
      await authenticated(environment);
      final entered = Completer<void>();
      final released = Completer<void>();
      remote.override = (args, input) async {
        if (args.contains('POST')) {
          entered.complete();
          await released.future;
        }
        return remote.respond(args, input);
      };
      final first = repositories.create(environment, _target, private: true);
      await entered.future;
      await expectLater(
        ProjectRepositoryService(
          github,
        ).create(environment, _target, private: true),
        throwsStateError,
      );
      released.complete();
      await first;
      expect(remote.posts, hasLength(1));
      expect(repositories.pending(environment)!['phase'], 'linked');
    },
  );

  test(
    'malformed and symlinked setup state is preserved instead of reinitialised',
    () async {
      final file = File('${environment.stateDir}/repository-setup.json');
      for (final value in [
        'not json',
        jsonEncode({
          'schemaVersion': 1,
          'environmentId': 'foreign',
          'mode': 'local',
          'phase': 'local',
        }),
      ]) {
        file.writeAsStringSync(value);
        await expectLater(
          repositories.localOnly(environment),
          throwsA(anyOf(isA<FormatException>(), isA<StateError>())),
        );
        expect(file.readAsStringSync(), value);
      }
      file.deleteSync();
      final target = File('${environment.workspacePath}/preserve.json')
        ..writeAsStringSync('unchanged');
      Link(file.path).createSync(target.path);
      await expectLater(
        repositories.localOnly(environment),
        throwsA(isA<FileSystemException>()),
      );
      expect(target.readAsStringSync(), 'unchanged');
      expect(remote.requests, isEmpty);
    },
  );
}
