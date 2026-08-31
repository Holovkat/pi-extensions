import 'dart:async';
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

/// Existing-environment UI tests must not discover or run host toolchains.
class _MissingTools extends DevelopmentEnvironmentService {
  final inspected = Completer<void>();

  @override
  Future<EnvironmentReadiness> inspect(EnvironmentIdentity identity) async {
    if (!inspected.isCompleted) inspected.complete();
    return EnvironmentReadiness(
      identity: identity,
      tools: const DevelopmentToolchain(
        issues: ['Fixture: Flutter is not prepared.'],
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
  late _MissingTools environments;

  setUp(() {
    temporary = Directory.systemTemp.createTempSync('pif-onboarding-ui-');
    github = GithubConnectionService(channel: _channel);
    calls = [];
    environments = _MissingTools();
    binding.defaultBinaryMessenger.setMockMethodCallHandler(_channel, (
      call,
    ) async {
      calls.add(call);
      return {'saved': false, 'validated': false, 'message': 'No token saved.'};
    });
  });

  tearDown(() {
    github.dispose();
    binding.defaultBinaryMessenger.setMockMethodCallHandler(_channel, null);
    temporary.deleteSync(recursive: true);
  });

  Future<void> open(
    WidgetTester tester, {
    EnvironmentIdentity? identity,
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
                  onEnvironmentSelected: (selected) => github.selectEnvironment(
                    environmentId: selected.id,
                    workspace: selected.workspacePath,
                  ),
                  onOpenSettings: () async {},
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

  testWidgets(
    'New Project starts with local allocation before any remote confirmation',
    (tester) async {
      await open(tester);
      expect(find.text('New Project'), findsOneWidget);
      expect(
        tester
            .widget<DropdownButtonFormField<String>>(
              find.byType(DropdownButtonFormField<String>),
            )
            .initialValue,
        'create',
      );
      expect(find.text('Local project name'), findsOneWidget);
      expect(find.text('Create local environment'), findsOneWidget);
      expect(
        find.widgetWithText(FilledButton, 'Create on GitHub'),
        findsNothing,
      );
      expect(
        find.textContaining('local environment is created first'),
        findsOneWidget,
      );
      expect(calls, isEmpty);
      expect(temporary.listSync(), isEmpty);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'creating a repository defaults to private and waits for token validation',
    (tester) async {
      final identity = await allocate(tester);
      await open(tester, identity: identity);
      await chooseMode(tester, 'Create on GitHub');
      expect(find.text('Private repository'), findsOneWidget);
      expect(
        tester.widget<SwitchListTile>(find.byType(SwitchListTile)).value,
        isTrue,
      );
      expect(find.textContaining('(private)'), findsOneWidget);
      expect(
        tester
            .widget<FilledButton>(
              find.widgetWithText(FilledButton, 'Create on GitHub'),
            )
            .onPressed,
        isNull,
      );
      expect(calls.map((call) => call.method), ['selectEnvironment']);
      expect(ProjectRepositoryService(github).pending(identity), isNull);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'local-only completes without a token and remains openable when tools are missing',
    (tester) async {
      final identity = await allocate(tester);
      EnvironmentIdentity? completed;
      await open(
        tester,
        identity: identity,
        onCompleted: (value) => completed = value,
      );
      await chooseMode(tester, 'Local only — tracker disconnected');
      expect(
        find.textContaining('No GitHub account or remote is required'),
        findsOneWidget,
      );
      expect(
        tester
            .widget<FilledButton>(
              find.widgetWithText(FilledButton, 'Use local only'),
            )
            .onPressed,
        isNotNull,
      );
      await tester.runAsync(() async {
        await tester.tap(find.text('Use local only'));
        await environments.inspected.future;
      });
      await tester.pumpAndSettle();
      expect(
        ProjectRepositoryService(github).pending(identity)!['phase'],
        'local',
      );
      expect(
        find.textContaining('Fixture: Flutter is not prepared.'),
        findsOneWidget,
      );
      expect(find.text('Open project'), findsOneWidget);
      expect(Directory('${identity.workspacePath}/.git').existsSync(), isFalse);
      expect(calls.map((call) => call.method), ['selectEnvironment']);
      await tester.tap(find.text('Open project'));
      await tester.pumpAndSettle();
      expect(completed?.id, identity.id);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );
}
