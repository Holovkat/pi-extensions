import 'dart:async';
import 'package:flutter/gestures.dart';
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
import 'package:pif/widgets/tracker_board/tracker_board.dart';
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
  testWidgets('model dropdown lists available models and reflects selection', (
    tester,
  ) async {
    final bus = FakeBus();
    final host = PifHost(bus: bus)
      ..models = ['openai-codex/gpt-5.6-sol', 'fixture/fast'];
    host.sessions.applySnapshot({
      'host': {
        'id': 'host',
        'name': 'Host',
        'host': true,
        'state': 'idle',
        'model': 'fixture/fast',
        'thinking': 'low',
        'cwd': '/tmp',
        'transcript': <dynamic>[],
      },
    });
    await tester.pumpWidget(panel(AgentConsolePlugin(), host));
    // Selected model shown by its short name.
    expect(find.text('fast'), findsOneWidget);
    // Opening the dropdown lists every available model.
    await tester.tap(find.text('fast'));
    await tester.pumpAndSettle();
    expect(find.text('gpt-5.6-sol'), findsOneWidget);
    expect(find.text('Default'), findsOneWidget);
    await bus.dispose();
  });

  testWidgets('console title renames inline on double-click', (tester) async {
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
        'transcript': <dynamic>[],
      },
    });
    await tester.pumpWidget(panel(AgentConsolePlugin(), host));
    expect(find.text('Host session'), findsOneWidget);

    await tester.tap(find.text('Host session'));
    await tester.pump(const Duration(milliseconds: 100));
    await tester.tap(find.text('Host session'));
    await tester.pump();
    final field = find.widgetWithText(TextField, 'Host session');
    expect(field, findsOneWidget, reason: 'double-click enters edit mode');

    await tester.enterText(field, 'Renamed');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pump();
    expect(
      bus.sent.any((entry) => entry['type'] == 'rename'),
      isTrue,
      reason: 'rename envelope sent',
    );
    expect((bus.sent.last['payload'] as Map)['name'], 'Renamed');
    await tester.pump(const Duration(milliseconds: 400));
    await bus.dispose();
  });

  testWidgets('session cards context menu renames and deletes', (tester) async {
    final bus = FakeBus();
    final host = PifHost(bus: bus)..workspace = '/tmp';
    host.sessions.applySnapshot({
      'host': {
        'id': 'host',
        'name': 'Host',
        'host': true,
        'state': 'idle',
        'model': 'test',
        'cwd': '/tmp',
      },
      'child': {
        'id': 'child',
        'name': 'Researcher',
        'host': false,
        'state': 'ended',
        'model': 'test',
        'cwd': '/tmp',
      },
    });
    await tester.pumpWidget(panel(SessionRailPlugin(), host));

    // Right-click the child card: rename, resume (ended), delete offered.
    await tester.tap(find.text('Researcher'), buttons: kSecondaryButton);
    await tester.pumpAndSettle();
    expect(find.text('Rename'), findsOneWidget);
    expect(find.text('Resume'), findsOneWidget);
    expect(find.text('Delete'), findsOneWidget);

    // Resume sends the resume envelope.
    await tester.tap(find.text('Resume').last);
    await tester.pumpAndSettle();
    expect(bus.sent.any((entry) => entry['type'] == 'resume'), isTrue);

    // Delete confirms first, then sends the delete envelope.
    await tester.tap(find.text('Researcher'), buttons: kSecondaryButton);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Delete').last);
    await tester.pumpAndSettle();
    expect(find.textContaining('Delete Researcher?'), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, 'Delete'));
    await tester.pumpAndSettle();
    expect(bus.sent.any((entry) => entry['type'] == 'delete'), isTrue);

    // Rename edits the card inline and commits on submit.
    await tester.tap(find.text('Researcher'), buttons: kSecondaryButton);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Rename').last);
    await tester.pump();
    final field = find.widgetWithText(TextField, 'Researcher');
    expect(field, findsOneWidget);
    await tester.enterText(field, 'Historian');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pump();
    expect(bus.sent.any((entry) => entry['type'] == 'rename'), isTrue);
    expect((bus.sent.last['payload'] as Map)['name'], 'Historian');
    await tester.pump(const Duration(milliseconds: 400));
    await bus.dispose();
  });

  testWidgets('model dropdown resolves provider-less session model', (
    tester,
  ) async {
    final bus = FakeBus();
    final host = PifHost(bus: bus)
      ..models = ['openai-codex/gpt-5.6-sol', 'fixture/fast'];
    host.sessions.applySnapshot({
      'host': {
        'id': 'host',
        'name': 'Host',
        'host': true,
        'state': 'idle',
        'model': 'gpt-5.6-sol',
        'thinking': 'low',
        'cwd': '/tmp',
        'transcript': <dynamic>[],
      },
    });
    await tester.pumpWidget(panel(AgentConsolePlugin(), host));
    expect(find.text('gpt-5.6-sol'), findsOneWidget);
    expect(find.text('Default'), findsNothing);
    await bus.dispose();
  });

  testWidgets('Agent Console conversation is unboxed and light', (tester) async {
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
          {'type': 'input', 'content': 'plain question'},
          {'type': 'message_update', 'delta': 'plain answer'},
        ],
      },
    });
    await tester.pumpWidget(panel(AgentConsolePlugin(), host));
    final userText = tester.widget<SelectableText>(
      find.widgetWithText(SelectableText, 'plain question'),
    );
    expect(userText.style?.fontSize, 13);
    expect(userText.style?.fontWeight, FontWeight.w300);
    expect(userText.style?.color, const Color(0xffc9d3df));
    expect(
      tester.widget<SelectableText>(find.widgetWithText(SelectableText, 'plain question')).style,
      isNotNull,
    );
    // No decorated container wraps the conversation entries anymore.
    expect(
      find.descendant(
        of: find.widgetWithText(Align, 'plain question'),
        matching: find.byType(Container),
      ),
      findsNothing,
    );
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
  testWidgets('tracker board renders columns, counts, badges, and stale state', (
    tester,
  ) async {
    final bus = FakeBus();
    final host = PifHost(bus: bus);
    host.snapshot = {'tracker': _trackerFixture(stale: true)};
    await tester.pumpWidget(panel(TrackerBoardPlugin(), host));
    await tester.pump();
    expect(find.text('ACME/WIDGETS'), findsOneWidget);
    expect(find.text('To Do  2'), findsOneWidget);
    expect(find.text('Doing  0'), findsOneWidget);
    expect(find.text('Shipped  1'), findsOneWidget);
    expect(find.text('EPIC'), findsOneWidget);
    expect(find.text('TASK'), findsOneWidget);
    expect(find.text('cached'), findsOneWidget);
    await bus.dispose();
  });

  testWidgets('tracker board opens a markdown detail for a card', (
    tester,
  ) async {
    final bus = FakeBus();
    final host = PifHost(bus: bus);
    host.snapshot = {'tracker': _trackerFixture()};
    await tester.pumpWidget(panel(TrackerBoardPlugin(), host));
    await tester.pump();
    await tester.tap(find.text('Epic: tracker panel'));
    await tester.pumpAndSettle();
    expect(find.textContaining('acme/widgets/issues/10'), findsNothing);
    expect(find.text('Epic body heading'), findsOneWidget);
    expect(find.textContaining('Detailed epic description'), findsOneWidget);
    await tester.tap(find.byIcon(Icons.close));
    await tester.pumpAndSettle();
    expect(find.text('Epic body heading'), findsNothing);
    await bus.dispose();
  });

  testWidgets('tracker board moves a card optimistically and reverts on failure', (
    tester,
  ) async {
    final bus = FakeBus();
    final host = PifHost(bus: bus);
    host.snapshot = {'tracker': _trackerFixture()};
    await tester.pumpWidget(panel(TrackerBoardPlugin(), host));
    await tester.pump();
    final card = find.text('Task: build board');
    final doing = find.text('Doing  0');
    await tester.drag(card, tester.getCenter(doing) - tester.getCenter(card));
    await tester.pumpAndSettle();
    expect(find.text('To Do  1'), findsOneWidget);
    expect(find.text('Doing  1'), findsOneWidget);
    expect(
      bus.sent.where((sent) {
        if (sent['channel'] != 'tracker/control' || sent['type'] != 'move') {
          return false;
        }
        final payload = sent['payload'] as Map;
        return payload['number'] == 11 && payload['column'] == 'doing';
      }),
      isNotEmpty,
    );
    bus.emit('tracker/move', 'move_result', {'ok': false});
    await tester.pumpAndSettle();
    expect(find.text('To Do  2'), findsOneWidget);
    expect(find.text('Doing  0'), findsOneWidget);
    await bus.dispose();
  });

  testWidgets('tracker board replaces state from hub tracker events and refreshes', (
    tester,
  ) async {
    final bus = FakeBus();
    final host = PifHost(bus: bus);
    host.snapshot = {'tracker': _trackerFixture()};
    await tester.pumpWidget(panel(TrackerBoardPlugin(), host));
    await tester.pump();
    bus.emit('tracker/state', 'state', _trackerFixture(stale: false, error: 'gh offline'));
    await tester.pumpAndSettle();
    expect(find.text('cached'), findsNothing);
    expect(find.textContaining('gh offline'), findsOneWidget);
    await tester.tap(find.byIcon(Icons.refresh));
    await tester.pump();
    expect(
      bus.sent.where(
        (sent) => sent['channel'] == 'tracker/control' && sent['type'] == 'refresh',
      ),
      isNotEmpty,
    );
    await bus.dispose();
  });

  testWidgets('ticket sheet creates a ticket through the hub', (tester) async {
    final bus = FakeBus();
    final host = PifHost(bus: bus);
    host.snapshot = {'tracker': _trackerFixture()};
    await tester.pumpWidget(panel(TrackerBoardPlugin(), host));
    await tester.pump();
    await tester.tap(find.byIcon(Icons.add));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('tracker_sheet_box')), findsOneWidget);
    await tester.enterText(find.byKey(const Key('tracker_sheet_title')), 'Fresh ticket');
    await tester.tap(find.byKey(const Key('tracker_sheet_submit')));
    await tester.pump();
    expect(
      bus.sent.where((sent) {
        if (sent['channel'] != 'tracker/control' || sent['type'] != 'create') return false;
        final payload = sent['payload'] as Map;
        return payload['title'] == 'Fresh ticket' && payload['type'] == 'task' && payload['column'] == 'todo';
      }),
      isNotEmpty,
    );
    bus.emit('tracker/op', 'op_result', {'op': 'create', 'ok': true, 'number': 21});
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('tracker_sheet_box')), findsNothing);
    await bus.dispose();
  });

  testWidgets('ticket sheet surfaces create failures and stays open', (tester) async {
    final bus = FakeBus();
    final host = PifHost(bus: bus);
    host.snapshot = {'tracker': _trackerFixture()};
    await tester.pumpWidget(panel(TrackerBoardPlugin(), host));
    await tester.pump();
    await tester.tap(find.byIcon(Icons.add));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('tracker_sheet_title')), 'Doomed ticket');
    await tester.tap(find.byKey(const Key('tracker_sheet_submit')));
    await tester.pump();
    bus.emit('tracker/op', 'op_result', {'op': 'create', 'ok': false, 'error': 'gh: label not found'});
    await tester.pumpAndSettle();
    expect(find.textContaining('gh: label not found'), findsOneWidget);
    expect(find.byKey(const Key('tracker_sheet_box')), findsOneWidget);
    await bus.dispose();
  });

  testWidgets('ticket sheet edits a card and returns to view mode on success', (tester) async {
    final bus = FakeBus();
    final host = PifHost(bus: bus);
    host.snapshot = {'tracker': _trackerFixture()};
    await tester.pumpWidget(panel(TrackerBoardPlugin(), host));
    await tester.pump();
    await tester.tap(find.text('Task: build board'));
    await tester.pumpAndSettle();
    expect(find.text('Task body'), findsOneWidget);
    await tester.tap(find.byIcon(Icons.edit_outlined));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('tracker_sheet_title')), 'Task: renamed');
    await tester.tap(find.byKey(const Key('tracker_sheet_submit')));
    await tester.pump();
    expect(
      bus.sent.where((sent) {
        if (sent['channel'] != 'tracker/control' || sent['type'] != 'update') return false;
        final payload = sent['payload'] as Map;
        return payload['number'] == 11 && payload['title'] == 'Task: renamed';
      }),
      isNotEmpty,
    );
    bus.emit('tracker/op', 'op_result', {'op': 'update', 'ok': true, 'number': 11});
    await tester.pumpAndSettle();
    expect(find.textContaining('Task: renamed'), findsOneWidget);
    expect(find.byKey(const Key('tracker_sheet_title')), findsNothing);
    await bus.dispose();
  });

  testWidgets('ticket sheet moves a card via the lane dropdown', (tester) async {
    final bus = FakeBus();
    final host = PifHost(bus: bus);
    host.snapshot = {'tracker': _trackerFixture()};
    await tester.pumpWidget(panel(TrackerBoardPlugin(), host));
    await tester.pump();
    await tester.tap(find.text('Task: build board'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('tracker_sheet_move')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Doing').last);
    await tester.pumpAndSettle();
    expect(find.text('To Do  1'), findsOneWidget);
    expect(find.text('Doing  1'), findsOneWidget);
    expect(
      bus.sent.where((sent) {
        if (sent['channel'] != 'tracker/control' || sent['type'] != 'move') return false;
        final payload = sent['payload'] as Map;
        return payload['number'] == 11 && payload['column'] == 'doing';
      }),
      isNotEmpty,
    );
    await bus.dispose();
  });

  testWidgets('ticket sheet deletes a card after confirmation', (tester) async {
    final bus = FakeBus();
    final host = PifHost(bus: bus);
    host.snapshot = {'tracker': _trackerFixture()};
    await tester.pumpWidget(panel(TrackerBoardPlugin(), host));
    await tester.pump();
    await tester.tap(find.text('Shipped thing'));
    await tester.pumpAndSettle();
    await tester.tap(find.byIcon(Icons.delete_outline));
    await tester.pumpAndSettle();
    expect(find.textContaining('permanently deleted'), findsOneWidget);
    await tester.tap(find.text('Delete'));
    await tester.pump();
    expect(
      bus.sent.where((sent) {
        if (sent['channel'] != 'tracker/control' || sent['type'] != 'delete') return false;
        return (sent['payload'] as Map)['number'] == 12;
      }),
      isNotEmpty,
    );
    bus.emit('tracker/op', 'op_result', {'op': 'delete', 'ok': true, 'number': 12});
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('tracker_sheet_box')), findsNothing);
    await bus.dispose();
  });

  testWidgets('ticket sheet resizes from the corner handle', (tester) async {
    final bus = FakeBus();
    final host = PifHost(bus: bus);
    host.snapshot = {'tracker': _trackerFixture()};
    await tester.pumpWidget(panel(TrackerBoardPlugin(), host));
    await tester.pump();
    await tester.tap(find.text('Task: build board'));
    await tester.pumpAndSettle();
    final before = tester.getSize(find.byKey(const Key('tracker_sheet_box')));
    await tester.drag(find.byKey(const Key('tracker_sheet_resize')), const Offset(90, 60));
    await tester.pump();
    final after = tester.getSize(find.byKey(const Key('tracker_sheet_box')));
    expect(after.width, greaterThan(before.width));
    await bus.dispose();
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

Map<String, dynamic> _trackerFixture({bool stale = false, String? error}) => {
  'repo': 'acme/widgets',
  'stale': stale,
  'fetchedAt': '2026-08-23T01:00:00Z',
  'error': error,
  'columns': [
    {'id': 'todo', 'name': 'To Do'},
    {'id': 'doing', 'name': 'Doing'},
    {'id': 'shipped', 'name': 'Shipped'},
  ],
  'cards': [
    {
      'number': 10,
      'title': 'Epic: tracker panel',
      'type': 'epic',
      'state': 'open',
      'labels': ['epic'],
      'body': '# Epic body heading\n\nDetailed epic description',
      'updatedAt': '2026-08-23T01:00:00Z',
      'url': 'https://github.com/acme/widgets/issues/10',
      'column': 'todo',
    },
    {
      'number': 11,
      'title': 'Task: build board',
      'type': 'task',
      'state': 'open',
      'labels': ['task', 'status:todo'],
      'body': 'Task body',
      'updatedAt': '2026-08-23T02:00:00Z',
      'url': 'https://github.com/acme/widgets/issues/11',
      'column': 'todo',
    },
    {
      'number': 12,
      'title': 'Shipped thing',
      'type': 'issue',
      'state': 'closed',
      'labels': [],
      'body': '',
      'updatedAt': '2026-08-22T00:00:00Z',
      'url': 'https://github.com/acme/widgets/issues/12',
      'column': 'shipped',
    },
  ],
};

class _ThrowingPlugin implements PifWidgetPlugin {
  @override
  PifWidgetMeta get meta =>
      const PifWidgetMeta(id: 'thrower', name: 'Thrower', slot: PifSlot.center);
  @override
  Widget build(BuildContext context, PifHost host) =>
      throw StateError('contained');
}
