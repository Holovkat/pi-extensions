import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pif/core/development_environment.dart';
import 'package:pif/core/development_toolchain.dart';
import 'package:pif/core/github_connection.dart';
import 'package:pif/core/project_onboarding.dart';
import 'package:pif/core/project_repository.dart';

const _channel = MethodChannel('pif/test/onboarding_widget');

/// Only identity allocation uses the real filesystem service. These UI tests
/// never discover host toolchains or copy the installed builder kit.
class _Environments extends DevelopmentEnvironmentService {
  final created = <EnvironmentIdentity>[];
  Completer<void> inspected = Completer<void>();
  final provisioned = <String>[];
  bool ready = false;

  @override
  Future<EnvironmentIdentity> create({
    required String parentPath,
    required String name,
  }) async {
    final identity = await super.create(parentPath: parentPath, name: name);
    created.add(identity);
    return identity;
  }

  @override
  Future<EnvironmentIdentity> provision(
    EnvironmentIdentity identity, {
    void Function(String)? onProgress,
    bool Function()? isCancelled,
  }) async {
    provisioned.add(identity.id);
    onProgress?.call('Preparing fixture workspace…');
    Directory('${identity.appDir}/macos').createSync(recursive: true);
    File(
      '${identity.appDir}/pubspec.yaml',
    ).writeAsStringSync('name: fixture\n');
    return identity;
  }

  @override
  Future<EnvironmentReadiness> inspect(EnvironmentIdentity identity) async {
    if (!inspected.isCompleted) inspected.complete();
    return EnvironmentReadiness(
      identity: identity,
      kitRoot: identity.kitDir,
      tools: DevelopmentToolchain(
        issues: ready ? const [] : ['Fixture: Flutter is not prepared.'],
      ),
      issues: const [],
    );
  }
}

void main() {
  final binding = TestWidgetsFlutterBinding.ensureInitialized();
  late Directory temporary;
  late GithubConnectionService github;
  late List<MethodCall> calls;
  late _Environments environments;
  late String? selectedFolder;
  late bool savedToken;
  late Map<String, Map<String, Object>> remotes;
  late int settingsOpened;

  Map<String, Object> response(Map<String, Object> value) => {
    'ok': true,
    'status': 0,
    'stdout': jsonEncode(value),
    'stderr': '',
  };

  setUp(() {
    temporary = Directory.systemTemp.createTempSync('pif-onboarding-ui-');
    github = GithubConnectionService(channel: _channel);
    calls = [];
    environments = _Environments();
    selectedFolder = temporary.resolveSymbolicLinksSync();
    savedToken = false;
    remotes = {};
    settingsOpened = 0;
    binding.defaultBinaryMessenger.setMockMethodCallHandler(_channel, (
      call,
    ) async {
      calls.add(call);
      if (call.method == 'run') {
        final args = List<String>.from((call.arguments as Map)['args'] as List);
        if (args.length == 2 && args.last == 'user')
          return response({'login': 'fixture'});
        if (args.length == 2 && args.last.startsWith('repos/')) {
          final remote = remotes[args.last.substring(6)];
          return remote == null ? {'code': 'not_found'} : response(remote);
        }
        return {'code': 'request_failed', 'message': 'Response was lost.'};
      }
      final validated = call.method == 'validate';
      if (validated) savedToken = true;
      return {
        'saved': savedToken,
        'validated': validated,
        if (validated) 'account': 'fixture',
        'canCreateRepository': validated,
        'canCreatePrivateRepository': validated,
        'creationCapability': validated ? 'all' : 'unknown',
        'message': validated ? 'Token validated.' : 'No token validated.',
      };
    });
  });

  tearDown(() {
    github.dispose();
    binding.defaultBinaryMessenger.setMockMethodCallHandler(_channel, null);
    temporary.deleteSync(recursive: true);
  });

  Finder primary(String label) => find.widgetWithText(FilledButton, label);
  Finder field(String label) => find.byWidgetPredicate(
    (widget) => widget is TextField && widget.decoration?.labelText == label,
  );

  Future<void> open(
    WidgetTester tester, {
    EnvironmentIdentity? identity,
    bool repositoryOnly = false,
    ValueChanged<EnvironmentIdentity?>? onCompleted,
  }) async {
    await tester.binding.setSurfaceSize(const Size(1000, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => TextButton(
              onPressed: () async {
                final result = await showProjectOnboarding(
                  context,
                  environments: environments,
                  github: github,
                  environment: identity,
                  repositoryOnly: repositoryOnly,
                  chooseFolder: (_) async => selectedFolder,
                  onEnvironmentSelected: (selected) => github.selectEnvironment(
                    environmentId: selected.id,
                    workspace: selected.workspacePath,
                  ),
                  onOpenSettings: () async {
                    settingsOpened++;
                    await showDialog<void>(
                      context: context,
                      builder: (context) => AlertDialog(
                        title: const Text('Settings fixture'),
                        actions: [
                          TextButton(
                            onPressed: () async {
                              await github.validate();
                              if (context.mounted) Navigator.pop(context);
                            },
                            child: const Text('Validate saved token'),
                          ),
                          TextButton(
                            onPressed: () => Navigator.pop(context),
                            child: const Text('Close Settings'),
                          ),
                        ],
                      ),
                    );
                  },
                );
                onCompleted?.call(result);
              },
              child: const Text('Start setup'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Start setup'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  }

  Future<EnvironmentIdentity> allocate(WidgetTester tester) async {
    late EnvironmentIdentity identity;
    await tester.runAsync(() async {
      identity = await EnvironmentIdentity.ensure(
        temporary.resolveSymbolicLinksSync(),
      );
    });
    return identity;
  }

  Future<void> chooseMode(WidgetTester tester, String label) async {
    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text(label).last);
    await tester.pumpAndSettle();
  }

  Future<void> prepare(WidgetTester tester, String label) async {
    await tester.runAsync(() async {
      environments.inspected = Completer<void>();
      await tester.tap(primary(label));
      await environments.inspected.future.timeout(const Duration(seconds: 5));
    });
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  }

  Future<void> close(WidgetTester tester) async {
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    await tester.pumpWidget(const SizedBox());
  }

  Future<void> selectAndValidate(EnvironmentIdentity identity) async {
    await github.selectEnvironment(
      environmentId: identity.id,
      workspace: identity.workspacePath,
    );
    await github.validate();
  }

  testWidgets('local details are the first step and survive Settings', (
    tester,
  ) async {
    await open(tester);
    expect(find.byType(FilledButton), findsOneWidget);
    expect(tester.widget<FilledButton>(primary('Continue')).onPressed, isNull);
    expect(find.byType(DropdownButtonFormField<String>), findsNothing);
    expect(field('Repository name'), findsNothing);
    expect(find.byType(SwitchListTile), findsNothing);
    expect(find.text('Create local environment'), findsNothing);
    await tester.enterText(field('Project name'), 'First project');
    await tester.tap(find.byTooltip('Settings'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Close Settings'));
    await tester.pumpAndSettle();
    expect(
      tester.widget<TextField>(field('Project name')).controller!.text,
      'First project',
    );
    expect(settingsOpened, 1);
    expect(calls, isEmpty);
    expect(temporary.listSync(), isEmpty);
    await close(tester);
  });

  testWidgets('Continue allocates once before showing repository choices', (
    tester,
  ) async {
    await open(tester);
    await tester.enterText(field('Project name'), 'Fresh project');
    selectedFolder = null;
    await tester.tap(find.text('Choose project location'));
    await tester.pumpAndSettle();
    expect(tester.widget<FilledButton>(primary('Continue')).onPressed, isNull);
    selectedFolder = temporary.resolveSymbolicLinksSync();
    await tester.tap(find.text('Choose project location'));
    await tester.pumpAndSettle();
    // Await the button's complete filesystem + platform action, rather than
    // advancing the fake animation clock while real work is still pending.
    final continueAction =
        tester.widget<FilledButton>(primary('Continue')).onPressed!
            as Future<void> Function();
    await tester.runAsync(continueAction);
    await tester.pumpAndSettle();
    final identity = environments.created.single;
    expect(github.environmentId, identity.id);
    expect(EnvironmentIdentity.read(identity.workspacePath)!.id, identity.id);
    expect(field('Project name'), findsNothing);
    expect(find.byType(DropdownButtonFormField<String>), findsOneWidget);
    expect(primary('Connect GitHub'), findsOneWidget);
    expect(field('Repository name'), findsNothing);
    expect(environments.provisioned, isEmpty);
    expect(calls.map((call) => call.method), ['selectEnvironment']);
    expect(ProjectRepositoryService(github).pending(identity), isNull);
    await close(tester);
  });

  testWidgets('GitHub details appear after validation and survive Settings', (
    tester,
  ) async {
    final identity = await allocate(tester);
    await open(tester, identity: identity);
    await chooseMode(tester, 'Create on GitHub');
    expect(primary('Connect GitHub'), findsOneWidget);
    expect(field('GitHub owner or organization'), findsNothing);
    expect(field('Repository name'), findsNothing);
    expect(find.byType(SwitchListTile), findsNothing);
    expect(find.text('Open GitHub Settings'), findsNothing);
    final headerPosition = tester.getTopLeft(find.byTooltip('Settings'));
    await tester.tap(primary('Connect GitHub'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Validate saved token'));
    await tester.pumpAndSettle();
    expect(primary('Create on GitHub'), findsOneWidget);
    expect(
      tester.widget<SwitchListTile>(find.byType(SwitchListTile)).value,
      isTrue,
    );
    expect(github.environmentId, identity.id);
    await tester.enterText(field('GitHub owner or organization'), 'my-org');
    await tester.enterText(field('Repository name'), 'my-draft');
    await tester.tap(find.byType(SwitchListTile));
    await tester.pumpAndSettle();
    final controller = tester
        .widget<TextField>(field('Repository name'))
        .controller;
    await tester.tap(find.byTooltip('Settings'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Close Settings'));
    await tester.pumpAndSettle();
    expect(
      tester.widget<TextField>(field('Repository name')).controller,
      same(controller),
    );
    expect(controller!.text, 'my-draft');
    expect(
      tester
          .widget<TextField>(field('GitHub owner or organization'))
          .controller!
          .text,
      'my-org',
    );
    expect(
      tester.widget<SwitchListTile>(find.byType(SwitchListTile)).value,
      isFalse,
    );
    expect(tester.getTopLeft(find.byTooltip('Settings')).dx, headerPosition.dx);
    expect(calls.map((call) => call.method), ['selectEnvironment', 'validate']);
    expect(ProjectRepositoryService(github).pending(identity), isNull);
    await close(tester);
  });

  testWidgets(
    'local preparation waits for readiness and retries only the unfinished work',
    (tester) async {
      final identity = await allocate(tester);
      EnvironmentIdentity? completed;
      await open(
        tester,
        identity: identity,
        onCompleted: (value) => completed = value,
      );
      await chooseMode(tester, 'Local project');
      expect(field('Repository name'), findsNothing);
      await prepare(tester, 'Create project');
      final saved = File(
        '${identity.stateDir}/repository-setup.json',
      ).readAsStringSync();
      expect(
        ProjectRepositoryService(github).pending(identity)!['phase'],
        'local',
      );
      expect(completed, isNull);
      expect(find.byType(AlertDialog), findsOneWidget);
      expect(primary('Continue setup'), findsOneWidget);
      expect(find.byType(FilledButton), findsOneWidget);
      expect(find.byType(DropdownButtonFormField<String>), findsNothing);
      expect(
        find.textContaining('Fixture: Flutter is not prepared.'),
        findsOneWidget,
      );
      expect(find.text('Open project'), findsNothing);
      expect(find.text('Open without preview'), findsNothing);
      await tester.tap(find.byTooltip('Settings'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Close Settings'));
      await tester.pumpAndSettle();
      expect(
        find.textContaining('Fixture: Flutter is not prepared.'),
        findsOneWidget,
      );
      expect(primary('Continue setup'), findsOneWidget);
      environments.ready = true;
      await prepare(tester, 'Continue setup');
      expect(completed?.id, identity.id);
      expect(environments.provisioned, [identity.id]);
      expect(
        File('${identity.stateDir}/repository-setup.json').readAsStringSync(),
        saved,
      );
      expect(Directory('${identity.workspacePath}/.git').existsSync(), isFalse);
      expect(calls.map((call) => call.method), ['selectEnvironment']);
      await tester.pumpWidget(const SizedBox());
    },
  );

  for (final linked in [false, true]) {
    testWidgets(
      'resumed ${linked ? 'linked' : 'local'} decision prepares missing source without another repository operation',
      (tester) async {
        final identity = await allocate(tester);
        final repository = ProjectRepositoryService(github);
        await tester.runAsync(() async {
          if (linked) {
            await selectAndValidate(identity);
            remotes['fixture/existing'] = {
              'id': 42,
              'full_name': 'fixture/existing',
              'owner': {'login': 'fixture'},
              'private': true,
              'has_issues': true,
            };
            await repository.connect(identity, 'fixture/existing');
          } else {
            await repository.localOnly(identity);
          }
        });
        calls.clear();
        final saved = File(
          '${identity.stateDir}/repository-setup.json',
        ).readAsStringSync();
        expect(identity.hasEditableSource, isFalse);
        EnvironmentIdentity? completed;
        environments.ready = true;
        await open(
          tester,
          identity: identity,
          onCompleted: (value) => completed = value,
        );
        expect(primary('Continue setup'), findsOneWidget);
        expect(find.byType(DropdownButtonFormField<String>), findsNothing);
        expect(field('Repository name'), findsNothing);
        await prepare(tester, 'Continue setup');
        expect(completed?.id, identity.id);
        expect(identity.hasEditableSource, isTrue);
        expect(environments.provisioned, [identity.id]);
        expect(calls.where((call) => call.method == 'run'), isEmpty);
        expect(
          File('${identity.stateDir}/repository-setup.json').readAsStringSync(),
          saved,
        );
        await tester.pumpWidget(const SizedBox());
      },
    );
  }

  testWidgets(
    'resuming prepared source preserves edits and skips provisioning',
    (tester) async {
      final identity = await allocate(tester);
      await tester.runAsync(
        () => ProjectRepositoryService(github).localOnly(identity),
      );
      Directory('${identity.appDir}/macos').createSync(recursive: true);
      final source = File('${identity.appDir}/pubspec.yaml')
        ..writeAsStringSync('name: user_edits\n');
      environments.ready = true;
      await open(tester, identity: identity);
      await prepare(tester, 'Continue setup');
      expect(environments.provisioned, isEmpty);
      expect(source.readAsStringSync(), 'name: user_edits\n');
      expect(find.byType(AlertDialog), findsNothing);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'repository-only entry still permits a saved local project to connect',
    (tester) async {
      final identity = await allocate(tester);
      await tester.runAsync(() async {
        await ProjectRepositoryService(github).localOnly(identity);
        await selectAndValidate(identity);
      });
      await open(tester, identity: identity, repositoryOnly: true);
      expect(find.text('Connect Repository'), findsOneWidget);
      expect(find.byType(DropdownButtonFormField<String>), findsOneWidget);
      expect(primary('Connect existing repository'), findsOneWidget);
      expect(field('Repository name'), findsOneWidget);
      expect(primary('Continue setup'), findsNothing);
      expect(environments.provisioned, isEmpty);
      await close(tester);
    },
  );

  testWidgets(
    'uncertain saved creation keeps its reviewed target and exposes verification only',
    (tester) async {
      final identity = await allocate(tester);
      await tester.runAsync(() async {
        await selectAndValidate(identity);
        await expectLater(
          ProjectRepositoryService(
            github,
          ).create(identity, 'fixture/pending', private: true),
          throwsStateError,
        );
      });
      final saved = File(
        '${identity.stateDir}/repository-setup.json',
      ).readAsStringSync();
      calls.clear();
      await open(tester, identity: identity);
      expect(primary('Check repository setup'), findsOneWidget);
      expect(
        tester
            .widget<DropdownButtonFormField<String>>(
              find.byType(DropdownButtonFormField<String>),
            )
            .onChanged,
        isNull,
      );
      expect(
        tester.widget<TextField>(field('GitHub owner or organization')).enabled,
        isFalse,
      );
      expect(
        tester.widget<TextField>(field('Repository name')).controller!.text,
        'pending',
      );
      expect(
        tester.widget<TextField>(field('Repository name')).enabled,
        isFalse,
      );
      expect(
        tester.widget<SwitchListTile>(find.byType(SwitchListTile)).onChanged,
        isNull,
      );
      expect(calls, isEmpty);
      expect(
        File('${identity.stateDir}/repository-setup.json').readAsStringSync(),
        saved,
      );
      await close(tester);
    },
  );

  testWidgets(
    'a different environment validation never enables this project confirmation',
    (tester) async {
      final identity = await allocate(tester);
      await selectAndValidate(identity);
      await open(tester, identity: identity);
      expect(field('Repository name'), findsOneWidget);
      await github.selectEnvironment(
        environmentId: '22222222-2222-4222-8222-222222222222',
        workspace: '/tmp/other-onboarding-fixture',
      );
      await github.validate();
      await tester.pumpAndSettle();
      expect(field('Repository name'), findsNothing);
      expect(primary('Create on GitHub'), findsNothing);
      expect(primary('Connect GitHub'), findsOneWidget);
      await tester.tap(primary('Connect GitHub'));
      await tester.pumpAndSettle();
      expect(github.environmentId, identity.id);
      expect(github.state.validated, isFalse);
      await tester.tap(find.text('Close Settings'));
      await tester.pumpAndSettle();
      expect(primary('Connect GitHub'), findsOneWidget);
      expect(calls.where((call) => call.method == 'run'), isEmpty);
      await close(tester);
    },
  );
}
