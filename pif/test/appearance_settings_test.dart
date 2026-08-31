import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pif/core/appearance.dart';
import 'package:pif/core/bus.dart';
import 'package:pif/core/docking_shell.dart';
import 'package:pif/core/github_connection.dart';
import 'package:pif/core/plugin.dart';
import 'package:pif/widgets/agent_console/agent_console.dart';
import 'package:pif/widgets/pif_settings/pif_settings.dart';
import 'package:pif/widgets/tracker_board/tracker_board.dart';

const _environmentA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const _environmentB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const _channel = MethodChannel('pif/test/settings_github');
const _tokenKey = Key('pif_github_token');
const _validateKey = Key('pif_github_validate');
const _removeKey = Key('pif_github_remove');
const _composerKey = Key('agent_console_composer');

/// A transport fixture only: no sockets, credential files, processes or native
/// services. Layout acknowledgements follow the hub's public wire contract.
class _SettingsBus extends PifBus {
  _SettingsBus(this.workspace)
    : super(uri: Uri.parse('ws://127.0.0.1:1/pif'), token: 'fixture-only');

  final String workspace;
  final _events = StreamController<PifEnvelope>.broadcast();
  final sent = <Map<String, Object?>>[];
  final panels = <String, Map<String, Object?>>{};
  int _sequence = 0;

  @override
  Stream<PifEnvelope> get events => _events.stream;
  @override
  Stream<bool> get connection => const Stream.empty();
  @override
  bool get connected => true;
  @override
  Future<void> connect() async {}

  void emit(String channel, String type, Object? payload) => _events.add(
    PifEnvelope(
      v: 1,
      id: 'fixture-${_sequence++}',
      ts: DateTime.utc(2026, 8, 31),
      channel: channel,
      type: type,
      payload: payload,
    ),
  );

  @override
  void send(String channel, String type, Object? payload) {
    sent.add({'channel': channel, 'type': type, 'payload': payload});
    if (channel != 'shell/layout' || payload is! Map) return;
    final id = payload['widgetId'] as String?;
    if (id == null) return;
    for (final panel in panels.values) {
      panel.remove('action');
    }
    panels[id] = {
      ...?panels[id],
      'slot': payload['slot'] ?? panels[id]?['slot'] ?? 'center',
      'open': type != 'close',
      'action': type,
    };
    emit('shell/layout', 'changed', {'panels': panels});
  }

  void snapshot({bool tracker = true, Map<String, Object?>? app}) =>
      emit('shell/state', 'snapshot', {
        'health': {'workspace': workspace},
        'sessions': {
          'host': {
            'id': 'host',
            'name': 'Workspace session',
            'host': true,
            'state': 'idle',
            'model': 'fixture',
            'cwd': workspace,
          },
        },
        'models': ['fixture'],
        'widgets': {
          'agent_console': {'enabled': true},
          'pif_settings': {'enabled': true},
          if (tracker) 'tracker_board': {'enabled': true},
          if (app != null) 'settings': {'enabled': true},
        },
        'layout': {'panels': panels},
        'tracker': {
          'repo': 'fixture/project',
          'writable': true,
          'columns': [
            {'id': 'todo', 'name': 'To Do'},
          ],
          'cards': [
            {
              'number': 1,
              'title': 'Scope survives',
              'type': 'epic',
              'state': 'open',
              'column': 'todo',
              'excerpt': 'Preserved tracker scope',
            },
          ],
        },
        'app': ?app,
        'devMode': app == null,
      });

  @override
  Future<void> dispose() async {
    if (!_events.isClosed) await _events.close();
    await super.dispose();
  }
}

class _ObservedPlugin implements PifWidgetPlugin {
  _ObservedPlugin(this.plugin, this.hosts);
  final PifWidgetPlugin plugin;
  final Set<PifHost> hosts;
  @override
  PifWidgetMeta get meta => plugin.meta;
  @override
  Widget build(BuildContext context, PifHost host) {
    hosts.add(host);
    return plugin.build(context, host);
  }
}

class _ProductSettingsPlugin implements PifWidgetPlugin {
  @override
  PifWidgetMeta get meta => const PifWidgetMeta(
    id: 'settings',
    name: 'Product Settings',
    slot: PifSlot.page,
  );
  @override
  Widget build(BuildContext context, PifHost host) => Theme(
    data: ThemeData.light(),
    child: Builder(
      builder: (context) => Text(
        'Pinned product ${Theme.of(context).brightness.name}',
        key: const Key('product_settings_page'),
      ),
    ),
  );
}

Widget _app(
  PifAppearanceService appearance, {
  GithubConnectionService? github,
  Future<void> Function()? connectRepository,
  Widget child = const PifSettingsPage(),
}) {
  final themed = PifAppearanceScope(
    service: appearance,
    child: ListenableBuilder(
      listenable: appearance,
      builder: (context, _) => MaterialApp(
        theme: const PifTheme(brightness: Brightness.light).materialTheme,
        darkTheme: const PifTheme().materialTheme,
        themeMode: appearance.mode,
        home: child is DockingShell ? child : Scaffold(body: child),
      ),
    ),
  );
  return github == null
      ? themed
      : GithubConnectionScope(
          service: github,
          onConnectRepository: connectRepository,
          child: themed,
        );
}

void main() {
  final binding = TestWidgetsFlutterBinding.ensureInitialized();
  late Directory temporary;
  late File preferences;
  late PifAppearanceService appearance;
  late GithubConnectionService github;
  late List<MethodCall> calls;

  void native(Future<Object?> Function(MethodCall) handler) {
    binding.defaultBinaryMessenger.setMockMethodCallHandler(_channel, (call) {
      calls.add(call);
      return handler(call);
    });
  }

  Future<void> select(String id) => github.selectEnvironment(
    environmentId: id,
    workspace: '/isolated/${id == _environmentA ? 'alpha' : 'beta'}',
  );

  setUp(() {
    temporary = Directory.systemTemp.createTempSync('pif-settings-test-');
    preferences = File('${temporary.path}/preferences.json');
    appearance = PifAppearanceService(preferencesFile: preferences);
    github = GithubConnectionService(channel: _channel);
    calls = [];
    native(
      (_) async => {
        'saved': false,
        'code': 'missing_token',
        'message': 'No token saved.',
      },
    );
  });

  tearDown(() {
    appearance.dispose();
    github.dispose();
    binding.defaultBinaryMessenger.setMockMethodCallHandler(_channel, null);
    binding.platformDispatcher.clearPlatformBrightnessTestValue();
    temporary.deleteSync(recursive: true);
  });

  test(
    'appearance defaults to System without creating preferences and survives restart',
    () async {
      expect(appearance.mode, ThemeMode.system);
      expect(preferences.existsSync(), isFalse);
      for (final mode in [ThemeMode.light, ThemeMode.dark, ThemeMode.system]) {
        final saving = appearance.setMode(mode);
        expect(
          appearance.mode,
          mode,
          reason: 'Selection applies before the write completes.',
        );
        await saving;
        final restarted = PifAppearanceService(preferencesFile: preferences);
        expect(restarted.mode, mode);
        restarted.dispose();
      }
      expect(appearance.persistenceError, isNull);
    },
  );

  test(
    'rapid appearance choices persist the last choice and preserve unrelated preferences',
    () async {
      preferences.writeAsStringSync(
        jsonEncode({'unrelated': 'keep-me', 'appearance': 'dark'}),
      );
      appearance.dispose();
      appearance = PifAppearanceService(preferencesFile: preferences);
      final choices = [
        ThemeMode.light,
        ThemeMode.dark,
        ThemeMode.system,
      ].map(appearance.setMode).toList();
      await Future.wait(choices);
      await appearance.flush();
      expect(jsonDecode(preferences.readAsStringSync()), {
        'unrelated': 'keep-me',
        'appearance': 'system',
      });
      expect(temporary.listSync().whereType<File>().map((file) => file.path), [
        preferences.path,
      ]);
    },
  );

  test(
    'unreadable or unsavable appearance reports failure without claiming persistence',
    () async {
      preferences.writeAsStringSync('not json');
      appearance.dispose();
      appearance = PifAppearanceService(preferencesFile: preferences);
      expect(appearance.mode, ThemeMode.system);
      expect(appearance.persistenceError, isNotNull);

      final blocker = File('${temporary.path}/not-a-directory')
        ..writeAsStringSync('preserve');
      appearance.dispose();
      appearance = PifAppearanceService(
        preferencesFile: File('${blocker.path}/preferences.json'),
      );
      await appearance.setMode(ThemeMode.light);
      expect(appearance.mode, ThemeMode.light);
      expect(appearance.persistenceError, contains('could not be saved'));
      expect(blocker.readAsStringSync(), 'preserve');
    },
  );

  testWidgets(
    'Light Dark and System update the shared theme and System follows OS brightness',
    (tester) async {
      binding.platformDispatcher.platformBrightnessTestValue = Brightness.dark;
      await tester.pumpWidget(_app(appearance));
      Brightness current() =>
          Theme.of(tester.element(find.byType(PifSettingsPage))).brightness;
      expect(current(), Brightness.dark);

      Future<void> choose(String label) async {
        await tester.runAsync(() async {
          await tester.tap(find.text(label));
          await appearance.flush();
        });
        await tester.pumpAndSettle();
      }

      await choose('Light');
      expect(current(), Brightness.light);
      expect(
        PifAppearanceService(preferencesFile: preferences).mode,
        ThemeMode.light,
      );
      binding.platformDispatcher.platformBrightnessTestValue = Brightness.dark;
      await tester.pumpAndSettle();
      expect(
        current(),
        Brightness.light,
        reason: 'An explicit choice ignores OS brightness.',
      );
      await choose('Dark');
      expect(current(), Brightness.dark);
      binding.platformDispatcher.platformBrightnessTestValue = Brightness.light;
      await tester.pumpAndSettle();
      expect(current(), Brightness.dark);
      await choose('System');
      expect(current(), Brightness.light);
      binding.platformDispatcher.platformBrightnessTestValue = Brightness.dark;
      await tester.pumpAndSettle();
      expect(current(), Brightness.dark);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'Appearance choices can be reached and selected with the keyboard',
    (tester) async {
      await tester.pumpWidget(_app(appearance));
      await tester.runAsync(() async {
        await tester.sendKeyEvent(LogicalKeyboardKey.tab);
        await tester.sendKeyEvent(LogicalKeyboardKey.space);
        await appearance.flush();
      });
      await tester.pumpAndSettle();
      expect(appearance.mode, ThemeMode.light);
      await tester.runAsync(() async {
        await tester.sendKeyEvent(LogicalKeyboardKey.tab);
        await tester.sendKeyEvent(LogicalKeyboardKey.enter);
        await appearance.flush();
      });
      await tester.pumpAndSettle();
      expect(appearance.mode, ThemeMode.dark);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'Settings keeps two groups and hides credential actions without a project',
    (tester) async {
      await tester.pumpWidget(_app(appearance, github: github));
      expect(find.text('Settings'), findsOneWidget);
      expect(find.text('Appearance'), findsOneWidget);
      expect(find.text('GitHub'), findsOneWidget);
      expect(tester.widget<TextField>(find.byKey(_tokenKey)).enabled, isFalse);
      expect(find.byKey(_validateKey), findsNothing);
      expect(find.byKey(_removeKey), findsNothing);
      expect(find.text('Connect repository'), findsNothing);
      expect(calls, isEmpty);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'empty token shows guidance and typing reveals only right-aligned Validate',
    (tester) async {
      await select(_environmentA);
      await tester.pumpWidget(_app(appearance, github: github));
      final field = find.byKey(_tokenKey);
      expect(
        find.text(
          'Token access for repositories is stored securely in macOS Keychain.',
        ),
        findsOneWidget,
      );
      expect(find.textContaining('Environment:'), findsNothing);
      expect(find.textContaining(_environmentA), findsNothing);
      expect(find.textContaining('/isolated/alpha'), findsNothing);
      expect(
        tester.widget<TextField>(field).decoration!.hintText,
        'Enter a GitHub token',
      );
      expect(tester.widget<TextField>(field).obscureText, isTrue);
      expect(
        find.text('Enter a GitHub token to save it securely in Keychain.'),
        findsOneWidget,
      );
      expect(find.byKey(_validateKey), findsNothing);
      expect(find.byKey(_removeKey), findsNothing);

      await tester.enterText(field, '   ');
      await tester.pumpAndSettle();
      expect(find.byKey(_validateKey), findsNothing);
      await tester.enterText(field, 'fixture-token');
      await tester.pumpAndSettle();
      final validate = find.byKey(_validateKey);
      expect(find.widgetWithText(FilledButton, 'Validate'), findsOneWidget);
      expect(tester.widget<FilledButton>(validate).onPressed, isNotNull);
      expect(find.byKey(_removeKey), findsNothing);
      expect(
        tester.getRect(validate).right,
        closeTo(tester.getRect(field).right, 0.1),
      );
      expect(
        tester.getRect(validate).top,
        greaterThan(tester.getRect(field).bottom),
      );
      expect(
        tester
            .widget<InputDecorator>(
              find.descendant(of: field, matching: find.byType(InputDecorator)),
            )
            .isEmpty,
        isFalse,
        reason: 'A typed value replaces the empty-input watermark.',
      );

      await tester.enterText(field, '');
      await tester.pumpAndSettle();
      expect(find.byKey(_validateKey), findsNothing);
      expect(find.byKey(_removeKey), findsNothing);
      expect(calls.map((call) => call.method), ['selectEnvironment']);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'saved token is only a watermark and Validate uses Keychain without onboarding',
    (tester) async {
      var repositoryConnections = 0;
      native(
        (call) async => call.method == 'selectEnvironment'
            ? {
                'saved': true,
                'code': 'saved',
                'message': 'Native saved metadata.',
              }
            : {
                'ok': true,
                'saved': true,
                'validated': true,
                'account': 'fixture-account',
                'code': 'connected',
                'message': 'Native validated metadata.',
              },
      );
      await select(_environmentA);
      await tester.pumpWidget(
        _app(
          appearance,
          github: github,
          connectRepository: () async {
            repositoryConnections++;
          },
        ),
      );
      final field = find.byKey(_tokenKey);
      expect(tester.widget<TextField>(field).controller!.text, isEmpty);
      expect(
        tester.widget<TextField>(field).decoration!.hintText,
        '••••••••••••••••',
      );
      expect(
        find.text('Token saved securely. Validate to check GitHub access.'),
        findsOneWidget,
      );
      expect(find.text('Replacement token'), findsNothing);
      expect(find.text('Replace and validate'), findsNothing);
      expect(find.text('Save and validate'), findsNothing);
      expect(find.text('Connect repository'), findsNothing);
      expect(find.byKey(_removeKey), findsOneWidget);
      await tester.tap(find.byKey(_validateKey));
      await tester.pumpAndSettle();
      expect(calls.last.method, 'validate');
      expect((calls.last.arguments as Map).containsKey('token'), isFalse);
      expect(calls.last.arguments['environmentId'], _environmentA);
      expect(tester.widget<TextField>(field).controller!.text, isEmpty);
      expect(
        find.text('Connected to GitHub as fixture-account.'),
        findsOneWidget,
      );
      expect(find.textContaining('Account:'), findsNothing);
      expect(repositoryConnections, 0);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'Enter saves a typed token once and clears transient text before native completion',
    (tester) async {
      final saved = Completer<Object?>();
      native(
        (call) => call.method == 'saveAndValidate'
            ? saved.future
            : Future.value({
                'saved': false,
                'code': 'missing_token',
                'message': 'No token saved.',
              }),
      );
      await select(_environmentA);
      await tester.pumpWidget(_app(appearance, github: github));
      final field = find.byKey(_tokenKey);
      expect(tester.widget<TextField>(field).obscureText, isTrue);
      await tester.enterText(field, '  fixture-only-token  ');
      await tester.pump();
      final submit = tester.widget<TextField>(field).onSubmitted!;
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pump();
      expect(tester.widget<TextField>(field).controller!.text, isEmpty);
      expect(tester.widget<TextField>(field).enabled, isFalse);
      expect(find.byType(LinearProgressIndicator), findsOneWidget);
      submit('fixture-only-token');
      await tester.pump();
      expect(
        calls.where((call) => call.method == 'saveAndValidate'),
        hasLength(1),
      );
      expect(calls.last.arguments['token'], 'fixture-only-token');
      saved.complete({
        'ok': true,
        'saved': true,
        'validated': true,
        'account': 'fixture-account',
        'code': 'connected',
        'message': 'Token validated.',
      });
      await tester.pumpAndSettle();
      expect(
        find.text('Connected to GitHub as fixture-account.'),
        findsOneWidget,
      );
      expect(tester.widget<TextField>(field).enabled, isTrue);
      expect(find.byKey(_removeKey), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'replacement failure preserves saved-token actions and reports the safe failure',
    (tester) async {
      native(
        (call) async => switch (call.method) {
          'selectEnvironment' => {
            'saved': true,
            'code': 'saved',
            'message': 'Saved.',
          },
          'saveAndValidate' => {
            'ok': false,
            'saved': true,
            'validated': true,
            'account': 'previous-account',
            'code': 'invalid_token',
            'message': 'GitHub rejected this token. Check its access.',
          },
          'validate' => {
            'ok': true,
            'saved': true,
            'validated': true,
            'account': 'fixture-account',
            'code': 'connected',
          },
          _ => throw StateError('Unexpected native method: ${call.method}'),
        },
      );
      await select(_environmentA);
      await tester.pumpWidget(_app(appearance, github: github));
      final field = find.byKey(_tokenKey);
      await tester.enterText(field, 'replacement-fixture');
      await tester.pump();
      await tester.tap(find.byKey(_validateKey));
      await tester.pumpAndSettle();
      expect(calls.last.method, 'saveAndValidate');
      expect(calls.last.arguments['token'], 'replacement-fixture');
      expect(tester.widget<TextField>(field).controller!.text, isEmpty);
      expect(
        find.text('GitHub rejected this token. Check its access.'),
        findsOneWidget,
      );
      expect(
        find.text('Connected to GitHub as previous-account.'),
        findsNothing,
      );
      expect(find.byKey(_removeKey), findsOneWidget);
      expect(
        tester.widget<FilledButton>(find.byKey(_validateKey)).onPressed,
        isNotNull,
      );
      await tester.tap(find.byKey(_validateKey));
      await tester.pumpAndSettle();
      expect(calls.last.method, 'validate');
      expect((calls.last.arguments as Map).containsKey('token'), isFalse);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'inline Remove clears draft and disables actions until Keychain confirms removal',
    (tester) async {
      final removed = Completer<Object?>();
      native(
        (call) => call.method == 'remove'
            ? removed.future
            : Future.value({
                'saved': true,
                'code': 'saved',
                'message': 'Saved.',
              }),
      );
      await select(_environmentA);
      await tester.pumpWidget(_app(appearance, github: github));
      final field = find.byKey(_tokenKey);
      final remove = find.byKey(_removeKey);
      expect(find.byTooltip('Remove saved token'), findsOneWidget);
      expect(tester.getRect(field).contains(tester.getCenter(remove)), isTrue);
      expect(
        tester.getCenter(remove).dx,
        greaterThan(tester.getCenter(field).dx),
      );
      final removeWidget = tester.widget<IconButton>(remove);
      expect((removeWidget.icon as Icon).icon, Icons.close);
      expect(
        removeWidget.color ?? (removeWidget.icon as Icon).color,
        Theme.of(tester.element(remove)).colorScheme.error,
      );
      await tester.enterText(field, 'discard-this-draft');
      await tester.pump();
      await tester.tap(remove);
      await tester.pump();
      expect(tester.widget<TextField>(field).controller!.text, isEmpty);
      expect(tester.widget<TextField>(field).enabled, isFalse);
      expect(tester.widget<IconButton>(remove).onPressed, isNull);
      expect(
        tester.widget<FilledButton>(find.byKey(_validateKey)).onPressed,
        isNull,
      );
      removeWidget.onPressed!();
      await tester.pump();
      expect(calls.where((call) => call.method == 'remove'), hasLength(1));
      removed.complete({
        'saved': false,
        'code': 'missing_token',
        'message': 'Removed.',
      });
      await tester.pumpAndSettle();
      expect(tester.widget<TextField>(field).enabled, isTrue);
      expect(find.byKey(_removeKey), findsNothing);
      expect(find.byKey(_validateKey), findsNothing);
      expect(
        find.text('Enter a GitHub token to save it securely in Keychain.'),
        findsOneWidget,
      );
      expect(calls.map((call) => call.method), ['selectEnvironment', 'remove']);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'switching projects clears unsaved tokens and account status without resetting appearance',
    (tester) async {
      final selectedB = Completer<Object?>();
      native(
        (call) => call.arguments['environmentId'] == _environmentB
            ? selectedB.future
            : Future.value({
                'saved': true,
                'validated': true,
                'account': 'fixture-account',
                'code': 'connected',
              }),
      );
      await select(_environmentA);
      await tester.pumpWidget(_app(appearance, github: github));
      final appearanceElement = tester.element(
        find.byKey(const Key('pif_appearance_mode')),
      );
      final field = find.byKey(_tokenKey);
      expect(
        find.text('Connected to GitHub as fixture-account.'),
        findsOneWidget,
      );

      await tester.enterText(field, 'unsaved-replacement');
      final switching = select(_environmentB);
      await tester.pump();
      expect(tester.widget<TextField>(field).controller!.text, isEmpty);
      expect(tester.widget<TextField>(field).enabled, isFalse);
      expect(
        find.text('Connected to GitHub as fixture-account.'),
        findsNothing,
      );
      selectedB.complete({
        'saved': false,
        'code': 'missing_token',
        'message': 'No token saved.',
      });
      await switching;
      await tester.pumpAndSettle();
      expect(tester.widget<TextField>(field).controller!.text, isEmpty);
      expect(
        find.text('Connected to GitHub as fixture-account.'),
        findsNothing,
      );
      expect(find.textContaining(_environmentB), findsNothing);
      expect(find.byKey(_validateKey), findsNothing);
      expect(find.byKey(_removeKey), findsNothing);
      expect(
        tester.element(find.byKey(const Key('pif_appearance_mode'))),
        same(appearanceElement),
      );
      expect(appearance.mode, ThemeMode.system);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'locked Keychain allows explicit Validate without claiming a saved removable token',
    (tester) async {
      native(
        (_) async => {
          'saved': false,
          'validated': false,
          'needsAuthorization': true,
          'code': 'keychain_locked',
          'message': 'Authorize Keychain access to continue.',
        },
      );
      await select(_environmentA);
      await tester.pumpWidget(_app(appearance, github: github));
      expect(
        tester.widget<TextField>(find.byKey(_tokenKey)).decoration!.hintText,
        'Enter a GitHub token',
      );
      expect(
        find.text('Authorize Keychain access to continue.'),
        findsOneWidget,
      );
      expect(
        tester.widget<FilledButton>(find.byKey(_validateKey)).onPressed,
        isNotNull,
      );
      expect(find.byKey(_removeKey), findsNothing);
      expect(find.text('••••••••••••••••'), findsNothing);
      expect(find.textContaining('Account:'), findsNothing);
      await tester.ensureVisible(find.text('Validate'));
      await tester.tap(find.text('Validate'));
      await tester.pumpAndSettle();
      expect(calls.last.method, 'validate');
      expect((calls.last.arguments as Map).containsKey('token'), isFalse);
      expect(find.byKey(_removeKey), findsNothing);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets('Settings scrolls and its controls fit a narrow window', (
    tester,
  ) async {
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await select(_environmentA);
    for (final width in [240.0, 420.0, 900.0]) {
      await tester.binding.setSurfaceSize(Size(width, 460));
      await tester.pumpWidget(_app(appearance, github: github));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byKey(_tokenKey));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull, reason: 'Settings width $width');
    }
    await tester.pumpWidget(const SizedBox());
  });

  for (final withTracker in [false, true]) {
    testWidgets(
      'Settings open focus close retains the ${withTracker ? 'console and tracker tabs' : 'single console panel'}',
      (tester) async {
        await tester.binding.setSurfaceSize(const Size(1280, 850));
        addTearDown(() => tester.binding.setSurfaceSize(null));
        final bus = _SettingsBus(temporary.path);
        final hosts = <PifHost>{};
        await tester.pumpWidget(
          _app(
            appearance,
            child: DockingShell(
              bus: bus,
              workspace: temporary.path,
              factories: {
                'agent_console': () =>
                    _ObservedPlugin(AgentConsolePlugin(), hosts),
                'tracker_board': () =>
                    _ObservedPlugin(TrackerBoardPlugin(), hosts),
                'pif_settings': PifSettingsPlugin.new,
              },
            ),
          ),
        );
        bus.snapshot(tracker: withTracker);
        await tester.pumpAndSettle();
        final originalHost = hosts.single;
        final sessions = originalHost.sessions;
        await tester.enterText(
          find.byKey(_composerKey),
          'Keep this unsent console draft',
        );
        final composer = tester
            .widget<TextField>(find.byKey(_composerKey))
            .controller;
        if (withTracker) {
          await tester.tap(find.text('Tracker'));
          await tester.pumpAndSettle();
          await tester.tap(find.text('Epics'));
          await tester.pumpAndSettle();
          expect(
            tester.widget<ToggleButtons>(find.byType(ToggleButtons)).isSelected,
            [false, true],
          );
        }
        for (var cycle = 0; cycle < 2; cycle++) {
          await tester.tap(find.byKey(const Key('pif_open_settings')));
          await tester.pumpAndSettle();
          expect(find.byType(PifSettingsPage), findsOneWidget);
          if (withTracker) {
            expect(
              tester
                  .widget<ToggleButtons>(
                    find.byType(ToggleButtons, skipOffstage: false),
                  )
                  .isSelected,
              [false, true],
              reason: 'Opening Settings must retain the hidden Tracker scope.',
            );
          }
          await tester.tap(find.byKey(const Key('pif_open_settings')));
          await tester.pumpAndSettle();
          expect(
            find.byType(PifSettingsPage, skipOffstage: false),
            findsOneWidget,
          );
          expect(hosts, {originalHost});
          expect(originalHost.sessions, same(sessions));
          bus.emit('session/state', 'updated', {
            'id': 'host',
            'name': 'Session still live',
          });
          await tester.pumpAndSettle();
          expect(
            originalHost.sessions.current.single.name,
            'Session still live',
          );
          await tester.tap(find.byTooltip('Close Settings'));
          await tester.pumpAndSettle();
          expect(
            find.byType(PifSettingsPage, skipOffstage: false),
            findsNothing,
          );
          if (withTracker) {
            await tester.tap(find.text('Tracker'));
            await tester.pumpAndSettle();
            expect(
              tester
                  .widget<ToggleButtons>(find.byType(ToggleButtons))
                  .isSelected,
              [false, true],
            );
            await tester.tap(find.text('Agent Console'));
            await tester.pumpAndSettle();
          }
          expect(
            tester.widget<TextField>(find.byKey(_composerKey)).controller,
            same(composer),
          );
          expect(composer!.text, 'Keep this unsent console draft');
        }
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
      },
    );
  }

  testWidgets(
    'opening Settings beside one split console preserves its live draft',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(1280, 850));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final bus = _SettingsBus(temporary.path);
      await tester.pumpWidget(
        _app(
          appearance,
          child: DockingShell(
            bus: bus,
            workspace: temporary.path,
            factories: {
              'agent_console': AgentConsolePlugin.new,
              'pif_settings': PifSettingsPlugin.new,
            },
          ),
        ),
      );
      bus.snapshot(tracker: false);
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Split center'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(_composerKey),
        'Split console draft survives',
      );
      final controller = tester
          .widget<TextField>(find.byKey(_composerKey))
          .controller;
      for (var cycle = 0; cycle < 2; cycle++) {
        await tester.tap(find.byKey(const Key('pif_open_settings')));
        await tester.pumpAndSettle();
        expect(find.byType(PifSettingsPage), findsOneWidget);
        expect(
          tester.widget<TextField>(find.byKey(_composerKey)).controller,
          same(controller),
        );
        expect(controller!.text, 'Split console draft survives');
        await tester.tap(find.byTooltip('Close Settings'));
        await tester.pumpAndSettle();
        expect(
          tester.widget<TextField>(find.byKey(_composerKey)).controller,
          same(controller),
        );
      }
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'a product settings page keeps its own ID slot and pinned theme',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(1280, 850));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      binding.platformDispatcher.platformBrightnessTestValue = Brightness.dark;
      final bus = _SettingsBus(temporary.path);
      await tester.pumpWidget(
        _app(
          appearance,
          child: DockingShell(
            bus: bus,
            workspace: temporary.path,
            factories: {
              'agent_console': AgentConsolePlugin.new,
              'pif_settings': PifSettingsPlugin.new,
              'settings': _ProductSettingsPlugin.new,
            },
          ),
        ),
      );
      bus.snapshot(
        tracker: false,
        app: {
          'id': 'product',
          'name': 'Product',
          'home': 'settings',
          'pages': ['settings'],
        },
      );
      await tester.pumpAndSettle();
      expect(find.text('Pinned product light'), findsOneWidget);
      expect(find.byType(PifSettingsPage), findsNothing);
      await tester.runAsync(() => appearance.setMode(ThemeMode.light));
      await tester.pumpAndSettle();
      await tester.runAsync(() => appearance.setMode(ThemeMode.dark));
      await tester.pumpAndSettle();
      expect(find.text('Pinned product light'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );
}
