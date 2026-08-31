import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pif/core/development_environment.dart';
import 'package:pif/core/development_toolchain.dart';
import 'package:pif/core/project_picker.dart';

class _WorkspaceService extends DevelopmentEnvironmentService {
  int provisions = 0;
  bool failPreparation = false;
  final prepared = Completer<void>();
  final inspected = Completer<void>();
  DevelopmentToolchain tools = const DevelopmentToolchain(
    flutter: '/fixture/flutter',
    dart: '/fixture/dart',
    issues: [],
  );

  @override
  Future<EnvironmentIdentity> provision(
    EnvironmentIdentity identity, {
    void Function(String)? onProgress,
    bool Function()? isCancelled,
  }) async {
    provisions++;
    if (!prepared.isCompleted) prepared.complete();
    if (failPreparation)
      throw StateError('Fixture: workspace is not writable.');
    Directory('${identity.appDir}/macos').createSync(recursive: true);
    File('${identity.appDir}/pubspec.yaml').writeAsStringSync('name: pif\n');
    return identity;
  }

  @override
  Future<EnvironmentReadiness> inspect(EnvironmentIdentity identity) async {
    if (!inspected.isCompleted) inspected.complete();
    return EnvironmentReadiness(
      identity: identity,
      tools: tools,
      issues: const [],
      kitRoot: '/fixture/builder',
    );
  }
}

void main() {
  late Directory temp;
  late EnvironmentIdentity identity;
  late _WorkspaceService service;
  late File recents;
  late Completer<void> launched;
  late List<String> launches;
  late int settingsOpens;
  late int folderPrompts;

  setUp(() async {
    temp = Directory.systemTemp.createTempSync('pif-picker-workflow-');
    final project = Directory('${temp.path}/my-app')..createSync();
    identity = await EnvironmentIdentity.ensure(project.path);
    recents = File('${temp.path}/recent.json')
      ..writeAsStringSync(jsonEncode([identity.workspacePath]));
    service = _WorkspaceService();
    launched = Completer<void>();
    launches = [];
    settingsOpens = 0;
    folderPrompts = 0;
  });
  tearDown(() => temp.deleteSync(recursive: true));

  Future<void> open(
    WidgetTester tester, {
    Future<EnvironmentIdentity?> Function()? create,
  }) async {
    await tester.binding.setSurfaceSize(const Size(1000, 800));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      MaterialApp(
        home: ProjectPicker(
          environments: service,
          recentProjectsFile: recents,
          onCreateProject: create,
          chooseFolder: (_) async {
            folderPrompts++;
            return identity.workspacePath;
          },
          onOpenSettings: () async {
            settingsOpens++;
          },
          onLaunch: (workspace) async {
            launches.add(workspace);
            if (!launched.isCompleted) launched.complete();
          },
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  void expectNoRecoveryPile() {
    expect(find.text('Retry setup'), findsNothing);
    expect(find.text('Select Flutter SDK'), findsNothing);
    expect(find.text('Open without preview'), findsNothing);
    expect(find.byTooltip('Settings'), findsOneWidget);
  }

  testWidgets(
    'saved project prepares automatically and preserves its repository decision',
    (tester) async {
      final saved = File('${identity.stateDir}/repository-setup.json')
        ..writeAsStringSync('{"phase":"linked","target":"fixture/my-app"}\n');
      final before = saved.readAsStringSync();
      await open(tester);
      expectNoRecoveryPile();
      await tester.runAsync(() async {
        await tester.tap(find.text('my-app'));
        await launched.future;
      });
      await tester.pumpAndSettle();
      expect(service.provisions, 1);
      expect(launches, [identity.workspacePath]);
      expect(saved.readAsStringSync(), before);
      expect(EnvironmentIdentity.read(identity.workspacePath)?.id, identity.id);
      expect(folderPrompts, 0);
      expectNoRecoveryPile();
    },
  );

  testWidgets(
    'ready project opens without provisioning or prompting for tools',
    (tester) async {
      await service.provision(identity);
      service.provisions = 0;
      File('${identity.appDir}/my-edit.txt').writeAsStringSync('preserve');
      await open(tester);
      await tester.runAsync(() async {
        await tester.tap(find.text('Open Project'));
        await launched.future;
      });
      await tester.pumpAndSettle();
      expect(service.provisions, 0);
      expect(launches, [identity.workspacePath]);
      expect(folderPrompts, 1); // The project folder, never a tool location.
      expect(
        File('${identity.appDir}/my-edit.txt').readAsStringSync(),
        'preserve',
      );
      expectNoRecoveryPile();
    },
  );

  testWidgets(
    'only a real missing Flutter issue offers SDK location inside setup help',
    (tester) async {
      service.tools = const DevelopmentToolchain(
        issues: ['Flutter is missing.'],
      );
      await open(tester);
      await tester.runAsync(() async {
        await tester.tap(find.text('my-app'));
        await service.inspected.future;
      });
      await tester.pumpAndSettle();
      expect(launches, isEmpty);
      expect(find.text('Review setup'), findsOneWidget);
      expect(find.text('Locate Flutter SDK'), findsNothing);
      expect(find.text('New Project'), findsNothing);
      expectNoRecoveryPile();
      await tester.tap(find.byTooltip('Settings'));
      await tester.pumpAndSettle();
      expect(settingsOpens, 1);
      await tester.tap(find.text('Review setup'));
      await tester.pumpAndSettle();
      expect(find.text('Locate Flutter SDK'), findsOneWidget);
      expect(
        find.textContaining('not need to select an individual file'),
        findsOneWidget,
      );
      expect(folderPrompts, 0);
      await tester.tap(find.text('Back'));
      await tester.pumpAndSettle();
      expectNoRecoveryPile();
    },
  );

  testWidgets('other tool failures never offer an irrelevant Flutter chooser', (
    tester,
  ) async {
    service.tools = const DevelopmentToolchain(
      flutter: '/fixture/flutter',
      dart: '/fixture/dart',
      issues: ['Complete Xcode setup.'],
    );
    await open(tester);
    await tester.runAsync(() async {
      await tester.tap(find.text('my-app'));
      await service.inspected.future;
    });
    await tester.pumpAndSettle();
    await tester.tap(find.text('Review setup'));
    await tester.pumpAndSettle();
    expect(find.text('Complete Xcode setup.'), findsOneWidget);
    expect(find.text('Locate Flutter SDK'), findsNothing);
    expect(find.text('Check again'), findsOneWidget);
    expect(folderPrompts, 0);
  });

  testWidgets(
    'a real preparation failure retries the saved project through one action',
    (tester) async {
      service.failPreparation = true;
      await open(tester);
      await tester.runAsync(() async {
        await tester.tap(find.text('my-app'));
        await service.prepared.future;
      });
      await tester.pumpAndSettle();
      expect(find.text('Review setup'), findsOneWidget);
      expect(launches, isEmpty);
      expectNoRecoveryPile();
      await tester.tap(find.text('Review setup'));
      await tester.pumpAndSettle();
      service.failPreparation = false;
      await tester.tap(find.text('Check again'));
      await tester.pumpAndSettle();
      expect(launches, [identity.workspacePath]);
      expect(service.provisions, 2);
      expect(find.text('Review setup'), findsNothing);
    },
  );

  testWidgets(
    'New Project completion follows the same readiness and recent-project path',
    (tester) async {
      recents.writeAsStringSync('[]');
      await open(tester, create: () async => identity);
      await tester.tap(find.byTooltip('Settings'));
      await tester.pumpAndSettle();
      expect(settingsOpens, 1);
      await tester.runAsync(() async {
        await tester.tap(find.text('New Project'));
        await launched.future;
      });
      await tester.pumpAndSettle();
      expect(service.provisions, 1);
      expect(launches, [identity.workspacePath]);
      expect(jsonDecode(recents.readAsStringSync()), [identity.workspacePath]);
      expectNoRecoveryPile();
    },
  );
}
