import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pif/core/bus.dart';
import 'package:pif/core/docking_shell.dart';
import 'package:pif/core/plugin.dart';
import 'package:pif/core/pi_launcher.dart';
import 'package:pif/widgets/widget_store/widget_store.dart';

/// Fake bus: never touches a socket; the shell's connect() is a no-op so
/// no reconnect timers are left behind.
class FakeBus extends PifBus {
  FakeBus() : super(uri: Uri.parse('ws://127.0.0.1:1/pif'));
  final sent = <Map<String, Object?>>[];
  final controller = StreamController<PifEnvelope>.broadcast();
  @override
  Stream<PifEnvelope> get events => controller.stream;
  @override
  Stream<PifEnvelope> channel(String prefix) =>
      events.where((event) => event.channel.startsWith(prefix));
  @override
  Stream<bool> get connection => const Stream.empty();
  @override
  bool get connected => true;
  @override
  Future<void> connect() async {}
  @override
  void send(String channel, String type, Object? payload) =>
      sent.add({'channel': channel, 'type': type, 'payload': payload});
  void emit(String channel, String type, Object? payload) => controller.add(
    PifEnvelope(
      v: 1,
      id: 'test',
      ts: DateTime(2026),
      channel: channel,
      type: type,
      payload: payload,
    ),
  );
  @override
  Future<void> dispose() => controller.close();
}

/// Shell bus with snapshot fakes for the app runtime mode. `app` mirrors
/// the settled hub contract: pif_app/app.yaml parsed into the snapshot
/// ({id, name, home, pages}). Lane A's layered-sources work (#155) is
/// faked here with widget `source` provenance fields.
class FakeHubBus extends FakeBus {
  String workspacePath = '/tmp';

  void emitSnapshot({
    Map<String, dynamic>? app,
    Map<String, dynamic>? layout,
    bool devMode = false,
  }) => emit('shell/state', 'snapshot', {
    'sessions': {
      'host': {
        'id': 'host',
        'name': 'Host',
        'host': true,
        'state': 'idle',
        'model': 'fake',
        'cwd': workspacePath,
      },
    },
    'widgets': const {
      'page_home': {'enabled': true},
      'page_about': {'enabled': true},
      'fake_dock': {'enabled': true},
    },
    'catalog': const {},
    'layout': layout ?? const {'panels': {}},
    'health': {'workspace': workspacePath},
    'app': app,
    'devMode': devMode,
  });
}

/// A declared page widget: full-screen, `slot: page`, and carrying local
/// state (a text field) so tests can prove the dev toggle preserves it.
class FakePagePlugin implements PifWidgetPlugin {
  FakePagePlugin(this.id, this.name);
  final String id;
  final String name;
  @override
  PifWidgetMeta get meta =>
      PifWidgetMeta(id: id, name: name, slot: PifSlot.page);
  @override
  Widget build(BuildContext context, PifHost host) => FakePageBody(name: name);
}

class FakePageBody extends StatefulWidget {
  const FakePageBody({super.key, required this.name});
  final String name;
  @override
  State<FakePageBody> createState() => _FakePageBodyState();
}

class _FakePageBodyState extends State<FakePageBody> {
  final _note = TextEditingController();
  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Column(
    children: [
      Text('${widget.name} body', key: Key('page_body_${widget.name}')),
      TextField(controller: _note, key: Key('page_field_${widget.name}')),
    ],
  );
}

class FakeDockPlugin implements PifWidgetPlugin {
  const FakeDockPlugin();
  @override
  PifWidgetMeta get meta => const PifWidgetMeta(
    id: 'fake_dock',
    name: 'Fake Dock',
    slot: PifSlot.center,
  );
  @override
  Widget build(BuildContext context, PifHost host) => const Text('Dock body');
}

const _demoApp = {
  'id': 'demo',
  'name': 'Demo App',
  'home': 'page_home',
  'pages': ['page_home', 'page_about'],
};

Future<Directory> _pumpShell(
  WidgetTester tester,
  FakeHubBus bus, {
  Map<String, dynamic>? app,
  Map<String, dynamic>? layout,
}) async {
  // Temp workspace so the persisted dev-toggle shell setting never
  // leaks between tests (or into the repo checkout). Sync I/O only:
  // awaited real-async I/O never completes inside the FakeAsync zone.
  final workspace = Directory.systemTemp.createTempSync('pif_app_mode_test');
  bus.workspacePath = workspace.path;
  await tester.pumpWidget(
    MaterialApp(
      home: DockingShell(
        bus: bus,
        workspace: workspace.path,
        factories: {
          'page_home': () => FakePagePlugin('page_home', 'Home'),
          'page_about': () => FakePagePlugin('page_about', 'About'),
          'fake_dock': () => const FakeDockPlugin(),
        },
      ),
    ),
  );
  bus.emitSnapshot(app: app, layout: layout);
  await tester.pumpAndSettle();
  return workspace;
}

Future<void> _teardown(WidgetTester tester, Directory workspace) async {
  await tester.pumpWidget(const SizedBox());
  workspace.deleteSync(recursive: true);
}

void main() {
  test('launcher keeps literal filesystem names and rejects bundle aliases (#201)', () {
    final root = Directory.systemTemp.createTempSync('pif-literal-path-');
    addTearDown(() => root.deleteSync(recursive: true));
    final canonicalRoot = root.resolveSymbolicLinksSync();
    final path = '$canonicalRoot/Application Support/100% # café/session.jsonl';
    expect(PiLauncher.debugResolveCanonicalPath(path), path);
    Directory('$canonicalRoot/Application Support').createSync();
    expect(PiLauncher.debugResolveCanonicalPath(path), path);
    final bundle = Directory('$canonicalRoot/Test App.app/Contents')..createSync(recursive: true);
    final link = Link('$canonicalRoot/bundle alias')..createSync(bundle.path);
    expect(() => PiLauncher.debugEnsureWritableDestination('${link.path}/new file', role: 'fixture'), throwsArgumentError);
    expect(File('${bundle.path}/new file').existsSync(), isFalse);
  });

  test('legacy host history migration preserves both sources and existing destinations (#201)', () async {
    final root = Directory.systemTemp.createTempSync('pif-history-migration-');
    addTearDown(() => root.deleteSync(recursive: true));
    final canonicalRoot = root.resolveSymbolicLinksSync();
    final workspace = Directory('$canonicalRoot/Application Support/Test Workspace')..createSync(recursive: true);
    final target = File('${workspace.path}/.pi/pif/sessions/host.jsonl');
    final legacy = File(Uri.file(target.path).path);
    legacy.parent.createSync(recursive: true);
    final transcript = '${jsonEncode({'type': 'session', 'version': 3, 'cwd': workspace.path})}\n'
        '${jsonEncode({'type': 'message', 'message': {'role': 'assistant', 'content': 'KEEP_HISTORY'}})}\n';
    legacy.writeAsStringSync(transcript);
    expect(await PiLauncher.debugMigrateLegacyHostSession(workspace: workspace.path, sessionFile: target.path), isTrue);
    expect(target.readAsStringSync(), transcript);
    expect(legacy.readAsStringSync(), transcript);
    target.writeAsStringSync('NEW_CANONICAL_HISTORY');
    expect(await PiLauncher.debugMigrateLegacyHostSession(workspace: workspace.path, sessionFile: target.path), isFalse);
    expect(target.readAsStringSync(), 'NEW_CANONICAL_HISTORY');
    expect(legacy.readAsStringSync(), transcript);
    expect(target.parent.listSync().map((entry) => entry.path), [target.path]);

    final foreignWorkspace = Directory('$canonicalRoot/Other Workspace')..createSync();
    final foreignTarget = File('${foreignWorkspace.path}/.pi/pif/sessions/host.jsonl');
    final foreignLegacy = File(Uri.file(foreignTarget.path).path);
    foreignLegacy.parent.createSync(recursive: true);
    foreignLegacy.writeAsStringSync(transcript); // Header belongs to the first workspace.
    expect(await PiLauncher.debugMigrateLegacyHostSession(workspace: foreignWorkspace.path, sessionFile: foreignTarget.path), isFalse);
    expect(foreignTarget.existsSync(), isFalse);
    expect(foreignLegacy.readAsStringSync(), transcript);
  });

  testWidgets(
    'app manifest boots into the page stage on the declared home page',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(1400, 900));
      final bus = FakeHubBus();
      final workspace = await _pumpShell(tester, bus, app: _demoApp);
      try {
        expect(find.text('Home body'), findsOneWidget);
        // Only the active page renders — never every declared page.
        expect(find.text('About body'), findsNothing);
        // Responsive navigation at >=1024px width is a rail.
        expect(find.byType(NavigationRail), findsOneWidget);
        // IDE docking stays hidden in app mode.
        expect(find.byKey(const Key('pif_dock_center')), findsNothing);
        expect(find.text('PI-NATIVE AGENTIC IDE'), findsNothing);
        expect(find.text('DEMO APP'), findsOneWidget);
        expect(find.byKey(const Key('pif_dev_toggle')), findsOneWidget);
      } finally {
        await _teardown(tester, workspace);
        await tester.binding.setSurfaceSize(null);
      }
    },
  );

  testWidgets(
    'navigation switches between the home page and declared pages and survives a resync',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(1400, 900));
      final bus = FakeHubBus();
      final workspace = await _pumpShell(tester, bus, app: _demoApp);
      try {
        await tester.tap(find.text('About'));
        await tester.pumpAndSettle();
        expect(find.text('About body'), findsOneWidget);
        expect(find.text('Home body'), findsNothing);
        await tester.tap(find.text('Home'));
        await tester.pumpAndSettle();
        expect(find.text('Home body'), findsOneWidget);

        // A snapshot resync must not reset navigation back to the home page.
        await tester.tap(find.text('About'));
        await tester.pumpAndSettle();
        bus.emitSnapshot(app: _demoApp);
        await tester.pumpAndSettle();
        expect(find.text('About body'), findsOneWidget);
      } finally {
        await _teardown(tester, workspace);
        await tester.binding.setSurfaceSize(null);
      }
    },
  );

  testWidgets('narrow viewports navigate with a bottom bar instead of a rail', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(900, 700));
    final bus = FakeHubBus();
    final workspace = await _pumpShell(tester, bus, app: _demoApp);
    try {
      expect(find.byType(NavigationBar), findsOneWidget);
      expect(find.byType(NavigationRail), findsNothing);
      await tester.tap(find.text('About'));
      await tester.pumpAndSettle();
      expect(find.text('About body'), findsOneWidget);
    } finally {
      await _teardown(tester, workspace);
      await tester.binding.setSurfaceSize(null);
    }
  });

  testWidgets(
    'single-page app mode stays chrome-free at 720, 1023, and 1024 before a second page adds navigation, console, and dev access',
    (tester) async {
      final bus = FakeHubBus();
      final workspace = await _pumpShell(
        tester,
        bus,
        app: {
          'id': 'demo',
          'name': 'Demo App',
          'home': 'page_home',
          'pages': ['page_home'],
        },
      );
      try {
        for (final width in [720.0, 1023.0, 1024.0]) {
          await tester.binding.setSurfaceSize(Size(width, 700));
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
          expect(find.text('Home body'), findsOneWidget);
          expect(find.byType(NavigationBar), findsNothing);
          expect(find.byType(NavigationRail), findsNothing);
          expect(find.byKey(const Key('pif_dev_toggle')), findsOneWidget);
          expect(find.byTooltip('Show Agent Console'), findsOneWidget);
        }

        bus.emitSnapshot(app: _demoApp, devMode: false);
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);

        for (final width in [720.0, 1023.0, 1024.0]) {
          await tester.binding.setSurfaceSize(Size(width, 700));
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
          expect(find.text('Home body'), findsOneWidget);
          expect(find.byKey(const Key('pif_dev_toggle')), findsOneWidget);
          expect(find.byTooltip('Show Agent Console'), findsOneWidget);
          if (width >= 1024) {
            expect(find.byType(NavigationRail), findsOneWidget);
            expect(find.byType(NavigationBar), findsNothing);
          } else {
            expect(find.byType(NavigationBar), findsOneWidget);
            expect(find.byType(NavigationRail), findsNothing);
          }
          await tester.tap(find.text('About'));
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
          expect(find.text('About body'), findsOneWidget);
          await tester.tap(find.text('Home'));
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
          expect(find.text('Home body'), findsOneWidget);
          await tester.tap(find.byTooltip('Show Agent Console'));
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
          expect(find.byKey(const Key('pif_app_console')), findsOneWidget);
          await tester.tap(find.byTooltip('Hide Agent Console'));
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
          expect(find.byKey(const Key('pif_app_console')), findsNothing);
        }
      } finally {
        await _teardown(tester, workspace);
        await tester.binding.setSurfaceSize(null);
      }
    },
  );

  testWidgets('dev toggle exposes the IDE docking and preserves page state', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(1400, 900));
    final bus = FakeHubBus();
    final workspace = await _pumpShell(tester, bus, app: _demoApp);
    try {
      // Work on the About page and type something on it.
      await tester.tap(find.text('About'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('page_field_About')),
        'state survives',
      );

      // Dev toggle: the full IDE docking is reachable again.
      await tester.tap(find.byKey(const Key('pif_dev_toggle')));
      await tester.pump();
      expect(
        bus.sent.where(
          (event) =>
              event['channel'] == 'shell/control' &&
              event['type'] == 'dev_mode_set' &&
              (event['payload'] as Map)['enabled'] == true,
        ),
        isNotEmpty,
      );
      expect(find.byKey(const Key('pif_dock_center')), findsNothing);
      expect(find.text('About body'), findsOneWidget);
      bus.emitSnapshot(app: _demoApp, devMode: true);
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('pif_dock_center')), findsOneWidget);
      expect(find.text('Dock body'), findsOneWidget);
      // The page stage is hidden but still alive.
      expect(find.text('About body'), findsNothing);
      expect(find.text('About body', skipOffstage: false), findsOneWidget);
      final field = tester.widget<TextField>(
        find.byKey(const Key('page_field_About'), skipOffstage: false),
      );
      expect(field.controller!.text, 'state survives');

      // Toggling back restores the page stage on the same page — not the
      // home page — with the page's state intact.
      await tester.tap(find.byKey(const Key('pif_dev_toggle')));
      await tester.pump();
      expect(
        bus.sent.where(
          (event) =>
              event['channel'] == 'shell/control' &&
              event['type'] == 'dev_mode_set' &&
              (event['payload'] as Map)['enabled'] == false,
        ),
        isNotEmpty,
      );
      expect(find.byKey(const Key('pif_dock_center')), findsOneWidget);
      bus.emitSnapshot(app: _demoApp, devMode: false);
      await tester.pumpAndSettle();
      expect(find.text('About body'), findsOneWidget);
      expect(find.text('Home body'), findsNothing);
      expect(find.byKey(const Key('pif_dock_center')), findsNothing);
      final restored = tester.widget<TextField>(
        find.byKey(const Key('page_field_About')),
      );
      expect(restored.controller!.text, 'state survives');
    } finally {
      await _teardown(tester, workspace);
      await tester.binding.setSurfaceSize(null);
    }
  });

  testWidgets('a project without a manifest keeps IDE mode', (tester) async {
    await tester.binding.setSurfaceSize(const Size(1400, 900));
    final bus = FakeHubBus();
    final workspace = await _pumpShell(tester, bus);
    try {
      expect(find.byKey(const Key('pif_dock_center')), findsOneWidget);
      expect(find.text('Dock body'), findsOneWidget);
      expect(find.text('PI-NATIVE AGENTIC IDE'), findsOneWidget);
      expect(find.byType(NavigationRail), findsNothing);
      expect(find.byType(NavigationBar), findsNothing);
      expect(find.byKey(const Key('pif_dev_toggle')), findsNothing);
      expect(find.byKey(const Key('pif_app_console')), findsNothing);
    } finally {
      await _teardown(tester, workspace);
      await tester.binding.setSurfaceSize(null);
    }
  });

  testWidgets('a manifest without declared pages keeps IDE mode', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(1400, 900));
    final bus = FakeHubBus();
    final workspace = await _pumpShell(
      tester,
      bus,
      app: {'id': 'demo', 'name': 'Demo App', 'home': 'page_home', 'pages': []},
    );
    try {
      expect(find.byKey(const Key('pif_dock_center')), findsOneWidget);
      expect(find.byType(NavigationRail), findsNothing);
      expect(find.byKey(const Key('pif_dev_toggle')), findsNothing);
    } finally {
      await _teardown(tester, workspace);
      await tester.binding.setSurfaceSize(null);
    }
  });

  testWidgets('page widgets never render in dock slots', (tester) async {
    await tester.binding.setSurfaceSize(const Size(1400, 900));
    final bus = FakeHubBus();
    // A stale persisted layout tries to force the page widget into the
    // center dock; the shell must refuse.
    final workspace = await _pumpShell(
      tester,
      bus,
      app: _demoApp,
      layout: {
        'panels': {
          'page_about': {'slot': 'center', 'open': true, 'action': 'open'},
        },
      },
    );
    try {
      final shell = tester.state(find.byType(DockingShell)) as dynamic;
      expect(
        shell
            .inSlot(PifSlot.center)
            .where((plugin) => plugin.meta.id == 'page_about'),
        isEmpty,
      );
      // A programmatic drop is rejected too — no override, no hub write.
      shell.move('page_about', PifSlot.center);
      await tester.pumpAndSettle();
      expect(
        shell
            .inSlot(PifSlot.center)
            .where((plugin) => plugin.meta.id == 'page_about'),
        isEmpty,
      );
      expect(bus.sent.where((event) => event['type'] == 'move'), isEmpty);
      // The page widget's content exists only under the page stage.
      final dockCenter = find.byKey(
        const Key('pif_dock_center'),
        skipOffstage: false,
      );
      expect(dockCenter, findsOneWidget);
      expect(
        find.descendant(
          of: dockCenter,
          matching: find.text('About body'),
          skipOffstage: false,
        ),
        findsNothing,
      );
      // Contract (same as the boot test): only the ACTIVE page mounts.
      // A refused dock move must not strand the inactive page anywhere.
      expect(find.text('About body', skipOffstage: false), findsNothing);
      expect(find.text('Home body', skipOffstage: false), findsOneWidget);
    } finally {
      await _teardown(tester, workspace);
      await tester.binding.setSurfaceSize(null);
    }
  });

  testWidgets('Widget Store renders source badges from snapshot provenance', (
    tester,
  ) async {
    final bus = FakeBus();
    final host = PifHost(bus: bus);
    host.snapshot = {
      'widgets': {
        'console': {
          'name': 'Console',
          'enabled': true,
          'core': true,
          'source': 'base',
        },
        'notes': {'name': 'Notes', 'enabled': true, 'source': 'project'},
      },
      'catalog': {
        'clock': {'name': 'Clock', 'description': 'Example'},
      },
    };
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => WidgetStorePlugin().build(context, host),
          ),
        ),
      ),
    );
    expect(find.text('BASE'), findsOneWidget);
    expect(find.text('PROJECT'), findsOneWidget);
    expect(find.text('CATALOG'), findsOneWidget);
    // Legacy available entries retain their catalog fallback badge.
    expect(find.text('Notes'), findsOneWidget);
    await bus.dispose();
  });
}
