import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pif/core/bus.dart';
import 'package:pif/core/panel_error_boundary.dart';
import 'package:pif/core/plugin.dart';
import 'package:pif/widgets/agent_console/agent_console.dart';
import 'package:pif/widgets/diff_viewer/diff_viewer.dart';
import 'package:pif/widgets/session_rail/session_rail.dart';
import 'package:pif/widgets/status_bar/status_bar.dart';
import 'package:pif/widgets/terminal/terminal.dart';
import 'package:pif/widgets/widget_store/widget_store.dart';

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

Widget wrap(PifWidgetPlugin plugin, PifHost host) => MaterialApp(
  theme: ThemeData.dark(),
  home: Scaffold(
    body: SizedBox(
      width: 1000,
      height: 700,
      child: plugin.build(navigatorKey.currentContext!, host),
    ),
  ),
);
final navigatorKey = GlobalKey<NavigatorState>();
Widget panel(PifWidgetPlugin plugin, PifHost host) => MaterialApp(
  navigatorKey: navigatorKey,
  theme: ThemeData.dark(),
  home: Scaffold(
    body: SizedBox(
      width: 1000,
      height: 700,
      child: Builder(builder: (context) => plugin.build(context, host)),
    ),
  ),
);

void main() {
  test('envelope validates and round-trips JSON', () {
    final value = PifEnvelope.fromJson({
      'v': 1,
      'id': 'a',
      'ts': '2026-01-01T00:00:00.000Z',
      'channel': 'shell/state',
      'type': 'snapshot',
      'payload': {},
    });
    expect(value.channel, 'shell/state');
    expect(value.toJson()['v'], 1);
  });
  test('contract host applies authoritative sessions snapshot', () {
    final bus = FakeBus();
    final host = PifHost(bus: bus);
    host.sessions.applySnapshot({
      'child': {
        'id': 'child',
        'name': 'Child',
        'host': false,
        'state': 'running',
        'model': 'test',
        'cwd': '/tmp',
      },
      'host': {
        'id': 'host',
        'name': 'Host',
        'host': true,
        'state': 'idle',
        'model': 'test',
        'cwd': '/tmp',
      },
    });
    expect(host.sessions.current.first.id, 'host');
    expect(host.sessions.current.last.state, 'running');
  });
  testWidgets('Agent Console renders streams and emits input', (tester) async {
    final bus = FakeBus();
    final host = PifHost(bus: bus);
    host.sessions.applySnapshot({
      'host': {
        'id': 'host',
        'name': 'Host',
        'host': true,
        'state': 'idle',
        'model': 'test',
        'cwd': '/tmp',
        'transcript': [
          {'type': 'message_update', 'delta': 'restored from snapshot'},
        ],
      },
    });
    await tester.pumpWidget(panel(AgentConsolePlugin(), host));
    expect(find.text('restored from snapshot'), findsOneWidget);
    await tester.enterText(find.byType(TextField), 'hello');
    await tester.tap(find.byIcon(Icons.arrow_upward));
    expect(bus.sent.single['type'], 'input');
    await bus.dispose();
  });
  testWidgets('Agent Console shows one start tag and a duration footer with copy actions', (
    tester,
  ) async {
    final bus = FakeBus();
    final host = PifHost(bus: bus);
    host.sessions.applySnapshot({
      'host': {
        'id': 'host',
        'name': 'Host',
        'host': true,
        'state': 'idle',
        'model': 'test',
        'cwd': '/tmp',
        'transcript': [
          {'type': 'input', 'content': 'build it'},
          {'type': 'agent_start', 'ts': '2026-08-22T10:00:00.000Z'},
          {'type': 'message_update', 'delta': 'here is the code'},
          {'type': 'message', 'text': 'here is the code\n```dart\nvoid main() {}\n```'},
          {'type': 'agent_end', 'ts': '2026-08-22T10:01:23.000Z'},
        ],
      },
    });
    await tester.pumpWidget(panel(AgentConsolePlugin(), host));
    expect(find.text('Agent started'), findsOneWidget);
    expect(find.text('Agent finished'), findsNothing);
    expect(find.text('1m 23s'), findsOneWidget);
    expect(find.byIcon(Icons.content_copy), findsOneWidget);
    expect(find.byIcon(Icons.code), findsOneWidget);
    await bus.dispose();
  });
  test('session deltas are idempotent by envelope id', () {
    final bus = FakeBus();
    final sessions = PifSessions(bus);
    sessions.applySnapshot({
      'host': {
        'id': 'host',
        'name': 'Host',
        'host': true,
        'state': 'idle',
        'model': 'test',
        'cwd': '/tmp',
        'transcript': <dynamic>[],
      },
    });
    final payload = {
      'sessionId': 'host',
      'state': 'running',
      'event': {'type': 'message_update', 'delta': 'once'},
    };
    sessions.applyEvent(payload, envelopeId: 'same');
    sessions.applyEvent(payload, envelopeId: 'same');
    expect(sessions.current.single.transcript, hasLength(1));
  });
  testWidgets('Session Rail pins host and exposes New Session', (tester) async {
    final bus = FakeBus();
    final host = PifHost(bus: bus);
    host.sessions.applySnapshot({
      'host': {
        'id': 'host',
        'name': 'Host session',
        'host': true,
        'state': 'idle',
        'model': 'test',
        'cwd': '/tmp',
      },
    });
    await tester.pumpWidget(panel(SessionRailPlugin(), host));
    expect(find.text('Host session'), findsOneWidget);
    expect(find.text('New Session'), findsOneWidget);
    await bus.dispose();
  });
  testWidgets('Status Bar reflects connection and workspace', (tester) async {
    final bus = FakeBus();
    final host = PifHost(bus: bus)..workspace = '/workspace';
    await tester.pumpWidget(panel(StatusBarPlugin(), host));
    expect(find.text('Hub connected'), findsOneWidget);
    expect(find.text('/workspace'), findsOneWidget);
    await bus.dispose();
  });
  testWidgets('Status Bar reset confirms then emits layout reset', (
    tester,
  ) async {
    final bus = FakeBus();
    final host = PifHost(bus: bus);
    await tester.pumpWidget(panel(StatusBarPlugin(), host));
    await tester.tap(find.byIcon(Icons.restore));
    await tester.pumpAndSettle();
    expect(find.text('Reset layout?'), findsOneWidget);
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(
      bus.sent.where((event) => event['type'] == 'reset'),
      isEmpty,
      reason: 'cancel must not reset',
    );
    await tester.tap(find.byIcon(Icons.restore));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Reset'));
    await tester.pumpAndSettle();
    final reset = bus.sent.singleWhere((event) => event['type'] == 'reset');
    expect(reset['channel'], 'shell/layout');
    await bus.dispose();
  });
  testWidgets('Widget Store renders installed and catalog records', (
    tester,
  ) async {
    final bus = FakeBus();
    final host = PifHost(bus: bus);
    host.snapshot = {
      'widgets': {
        'agent_console': {
          'name': 'Agent Console',
          'enabled': true,
          'core': true,
        },
      },
      'catalog': {
        'clock': {'name': 'Clock', 'description': 'Example'},
      },
    };
    await tester.pumpWidget(panel(WidgetStorePlugin(), host));
    expect(find.text('Agent Console'), findsOneWidget);
    expect(find.text('Clock'), findsOneWidget);
    await bus.dispose();
  });
  testWidgets('Diff Viewer dogfood renders and updates a usable comparison', (
    tester,
  ) async {
    final bus = FakeBus();
    final host = PifHost(bus: bus);
    await tester.pumpWidget(panel(DiffViewerPlugin(), host));
    expect(find.text('Phase 1 dogfood'), findsOneWidget);
    expect(find.byType(TextField), findsNWidgets(2));
    await tester.enterText(
      find.byType(TextField).last,
      'everything on screen is a widget\nFlutter shell\nagent console\nnew panel',
    );
    await tester.pump();
    expect(find.text('new panel'), findsWidgets);
    await bus.dispose();
  });
  test('Terminal is an ordinary core bottom-slot plugin', () {
    final plugin = TerminalPlugin();
    expect(plugin.meta.core, isTrue);
    expect(plugin.meta.slot, PifSlot.bottom);
  });
  testWidgets('panel error boundary contains a throwing widget', (
    tester,
  ) async {
    final bus = FakeBus();
    final host = PifHost(bus: bus);
    await tester.pumpWidget(
      MaterialApp(
        home: PanelErrorBoundary(plugin: _ThrowingPlugin(), host: host),
      ),
    );
    await tester.pump();
    expect(find.textContaining('failed'), findsOneWidget);
    expect(find.text('Disable widget'), findsOneWidget);
    await bus.dispose();
  });
}

class _ThrowingPlugin implements PifWidgetPlugin {
  @override
  PifWidgetMeta get meta =>
      const PifWidgetMeta(id: 'thrower', name: 'Thrower', slot: PifSlot.center);
  @override
  Widget build(BuildContext context, PifHost host) =>
      throw StateError('contained');
}
