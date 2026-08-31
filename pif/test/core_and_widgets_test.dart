import 'dart:async';
import 'dart:io';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
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

late Directory _workspace;

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

void expectNoFlutterErrors(WidgetTester tester) {
  final errors = <Object?>[];
  Object? error;
  while ((error = tester.takeException()) != null) {
    errors.add(error);
  }
  expect(errors, isEmpty);
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
Widget panel(
  PifWidgetPlugin plugin,
  PifHost host, {
  double width = 1000,
  double height = 700,
}) => MaterialApp(
  navigatorKey: navigatorKey,
  theme: ThemeData.dark(),
  home: Scaffold(
    body: SizedBox(
      width: width,
      height: height,
      child: Builder(builder: (context) => plugin.build(context, host)),
    ),
  ),
);

PifHost _host(FakeBus bus, {String? workspace}) {
  final host = PifHost(bus: bus);
  host.workspace = workspace ?? _workspace.path;
  host.storage.workspace = _workspace.path;
  return host;
}

void main() {
  setUp(() {
    _workspace = Directory.systemTemp.createTempSync('pif_core_and_widgets_test');
  });

  tearDown(() {
    if (_workspace.existsSync()) {
      _workspace.deleteSync(recursive: true);
    }
  });

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
    final host = _host(bus);
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
    host.requestTranscript('host');
    expect(bus.sent.single['type'], 'transcript');
  });
  test('host follows a created session and falls back after deletion', () {
    final bus = FakeBus();
    final host = _host(bus);
    host.sessions.applySnapshot({
      'host': {
        'id': 'host',
        'name': 'Host',
        'host': true,
        'state': 'idle',
        'model': 'test',
        'cwd': '/tmp',
      },
    });
    host.sessions.applyEvent({
      'id': 'child',
      'name': 'Agent',
      'host': false,
      'state': 'idle',
      'model': 'test',
      'cwd': '/tmp',
    });
    host.activateSession('child');
    expect(host.activeSessionId, 'child');
    expect(
      bus.sent.any(
        (message) =>
            message['channel'] == 'session/control' &&
            message['type'] == 'select',
      ),
      isTrue,
    );

    host.sessions.remove('child');
    host.activateFallbackSession('child');
    expect(host.activeSessionId, 'host');

    host.sessions.remove('host');
    host.activateFallbackSession('host');
    expect(host.activeSessionId, isEmpty);
    host.activateSession('missing');
    expect(host.activeSessionId, isEmpty);
  });
  testWidgets('Agent Console renders streams and emits input', (tester) async {
    final bus = FakeBus();
    final host = _host(bus);
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
  testWidgets('Agent Console renders authoritative turns once', (tester) async {
    final bus = FakeBus();
    final host = _host(bus);
    host.sessions.applySnapshot({
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
    await tester.pumpWidget(panel(AgentConsolePlugin(), host));
    await tester.enterText(find.byType(TextField), 'hi');
    await tester.tap(find.byIcon(Icons.arrow_upward));
    expect(bus.sent.single['type'], 'input');

    // The hub echoes the input, streams a delta, then sends the final
    // authoritative message. The console must render one copy of each.
    host.sessions.applyEvent({
      'sessionId': 'host',
      'state': 'running',
      'event': {'type': 'input', 'content': 'hi'},
    }, envelopeId: 'input');
    host.sessions.applyEvent({
      'sessionId': 'host',
      'state': 'running',
      'event': {'type': 'message_update', 'delta': 'Hi!'},
    }, envelopeId: 'delta');
    host.sessions.applyEvent({
      'sessionId': 'host',
      'state': 'running',
      'event': {'type': 'message', 'text': 'Hi! How can I help?'},
    }, envelopeId: 'final');
    await tester.pump();

    expect(find.widgetWithText(SelectableText, 'hi'), findsOneWidget);
    expect(find.byType(MarkdownBody), findsOneWidget);
    expect(
      tester.widget<MarkdownBody>(find.byType(MarkdownBody)).data,
      'Hi! How can I help?',
    );
    await bus.dispose();
  });
  testWidgets('Agent Console exposes steer and abort controls while running', (
    tester,
  ) async {
    final bus = FakeBus();
    final host = _host(bus);
    host.sessions.applySnapshot({
      'host': {
        'id': 'host',
        'name': 'Host',
        'host': true,
        'state': 'running',
        'model': 'test',
        'thinking': 'medium',
        'cwd': '/tmp',
        'transcript': <dynamic>[],
      },
    });
    await tester.pumpWidget(panel(AgentConsolePlugin(), host));

    expect(find.byKey(const Key('agent_console_steer')), findsOneWidget);
    expect(find.byIcon(Icons.stop_rounded), findsOneWidget);
    await tester.tap(find.byKey(const Key('agent_console_send')));

    expect(bus.sent.single['type'], 'abort');
    await bus.dispose();
  });

  testWidgets(
    'Agent Console composer stays usable across narrow and wide widths while idle',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(1440, 960));
      addTearDown(() async => tester.binding.setSurfaceSize(null));
      for (final width in [288.0, 320.0, 440.0, 1000.0]) {
        final bus = FakeBus();
        final host = _host(bus)
          ..models = [
            'fixture/fast',
            'openai-codex/gpt-5.6-sol',
          ];
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
        await tester.pumpWidget(panel(AgentConsolePlugin(), host, width: width));
        await tester.pumpAndSettle();
        expectNoFlutterErrors(tester);

        expect(find.byKey(const Key('agent_console_composer')), findsOneWidget);
        expect(find.byKey(const Key('agent_console_send')), findsOneWidget);
        expect(find.byKey(const Key('agent_console_steer')), findsNothing);
        expect(find.text('fast'), findsOneWidget);
        expect(find.text('Low'), findsOneWidget);

        await tester.tap(find.text('fast'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('gpt-5.6-sol').last);
        await tester.pumpAndSettle();
        expectNoFlutterErrors(tester);
        expect(bus.sent.last['type'], 'setModel');
        expect((bus.sent.last['payload'] as Map)['model'], 'openai-codex/gpt-5.6-sol');

        bus.sent.clear();
        await tester.tap(find.text('Low'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('High').last);
        await tester.pumpAndSettle();
        expectNoFlutterErrors(tester);
        expect(bus.sent.last['type'], 'setThinking');
        expect((bus.sent.last['payload'] as Map)['thinking'], 'high');

        bus.sent.clear();
        await tester.enterText(
          find.byKey(const Key('agent_console_composer')),
          'idle prompt',
        );
        await tester.tap(find.byKey(const Key('agent_console_send')));
        await tester.pumpAndSettle();
        expectNoFlutterErrors(tester);
        expect(bus.sent.last['type'], 'input');
        expect((bus.sent.last['payload'] as Map)['content'], 'idle prompt');

        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pumpAndSettle();
        expectNoFlutterErrors(tester);
        await bus.dispose();
      }
    },
  );

  testWidgets(
    'Agent Console composer stays usable across narrow and wide widths while running',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(1440, 960));
      addTearDown(() async => tester.binding.setSurfaceSize(null));
      for (final width in [288.0, 320.0, 440.0, 1000.0]) {
        final bus = FakeBus();
        final host = _host(bus)
          ..models = [
            'fixture/fast',
            'openai-codex/gpt-5.6-sol',
          ];
        host.sessions.applySnapshot({
          'host': {
            'id': 'host',
            'name': 'Host',
            'host': true,
            'state': 'running',
            'model': 'fixture/fast',
            'thinking': 'medium',
            'cwd': '/tmp',
            'transcript': <dynamic>[],
          },
        });
        await tester.pumpWidget(panel(AgentConsolePlugin(), host, width: width));
        await tester.pumpAndSettle();
        expectNoFlutterErrors(tester);

        expect(find.byKey(const Key('agent_console_send')), findsOneWidget);
        expect(find.byKey(const Key('agent_console_steer')), findsOneWidget);
        expect(find.text('fast'), findsOneWidget);
        expect(find.text('Medium'), findsOneWidget);

        await tester.tap(find.text('fast'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('gpt-5.6-sol').last);
        await tester.pumpAndSettle();
        expectNoFlutterErrors(tester);
        expect(bus.sent.last['type'], 'setModel');
        expect((bus.sent.last['payload'] as Map)['model'], 'openai-codex/gpt-5.6-sol');

        await tester.enterText(
          find.byKey(const Key('agent_console_composer')),
          'please rewrite this',
        );
        await tester.tap(find.byKey(const Key('agent_console_steer')));
        await tester.pumpAndSettle();
        expectNoFlutterErrors(tester);
        expect(bus.sent.last['type'], 'steer');
        expect((bus.sent.last['payload'] as Map)['content'], 'please rewrite this');

        bus.sent.clear();
        await tester.tap(find.text('Medium'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('High').last);
        await tester.pumpAndSettle();
        expectNoFlutterErrors(tester);
        expect(bus.sent.last['type'], 'setThinking');
        expect((bus.sent.last['payload'] as Map)['thinking'], 'high');

        bus.sent.clear();
        await tester.enterText(
          find.byKey(const Key('agent_console_composer')),
          'stop now',
        );
        await tester.tap(find.byKey(const Key('agent_console_send')));
        await tester.pumpAndSettle();
        expectNoFlutterErrors(tester);
        expect(bus.sent.last['type'], 'abort');
        expect((bus.sent.last['payload'] as Map)['sessionId'], 'host');

        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pumpAndSettle();
        expectNoFlutterErrors(tester);
        await bus.dispose();
      }
    },
  );

  testWidgets(
    'native live turns finalize once and match reopened history (#215)',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(1440, 960));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final bus = FakeBus();
      final host = _host(bus);
      final history = <Map<String, dynamic>>[];
      host.sessions.applySnapshot({
        'host': {
          'id': 'host',
          'name': 'Host',
          'host': true,
          'state': 'idle',
          'model': 'fixture',
          'thinking': 'low',
          'cwd': '/tmp',
          'transcript': <dynamic>[],
        },
      });
      await tester.pumpWidget(panel(AgentConsolePlugin(), host));
      Future<void> deliver(
        Map<String, dynamic> event, {
        String state = 'running',
      }) async {
        history.add(event);
        host.sessions.applyEvent({
          'sessionId': 'host',
          'state': state,
          'event': event,
        }, envelopeId: 'native-${history.length}');
        await tester.pump();
        expectNoFlutterErrors(tester);
      }

      await deliver({
        'type': 'input',
        'content': 'Hello fixture',
        'ts': '2026-08-31T03:00:00.000Z',
      });
      await deliver({'type': 'agent_start', 'ts': '2026-08-31T03:00:00.000Z'});
      await deliver({
        'type': 'message_update',
        'delta': 'Hel',
        'ts': '2026-08-31T03:00:00.100Z',
      });
      await deliver({
        'type': 'message_update',
        'delta': 'lo',
        'ts': '2026-08-31T03:00:00.200Z',
      });
      await deliver({
        'type': 'message',
        'text': 'Hello',
        'ts': '2026-08-31T03:00:01.000Z',
      });
      expect(find.byIcon(Icons.content_copy), findsNothing);
      await deliver({
        'type': 'agent_end',
        'ts': '2026-08-31T03:00:02.000Z',
      }, state: 'idle');
      await tester.pumpAndSettle();
      expect(
        find.widgetWithText(SelectableText, 'Hello fixture'),
        findsOneWidget,
      );
      expect(find.byType(MarkdownBody), findsOneWidget);
      expect(
        tester.widget<MarkdownBody>(find.byType(MarkdownBody)).data,
        'Hello',
      );
      expect(find.byIcon(Icons.content_copy), findsOneWidget);
      expect(find.text('2s'), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
      await tester.pumpWidget(panel(AgentConsolePlugin(), host));
      await tester.pumpAndSettle();
      expect(find.byType(MarkdownBody), findsOneWidget);
      expect(
        tester.widget<MarkdownBody>(find.byType(MarkdownBody)).data,
        'Hello',
      );
      expect(find.byIcon(Icons.content_copy), findsOneWidget);
      expect(find.text('2s'), findsOneWidget);
      expectNoFlutterErrors(tester);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
      await bus.dispose();
    },
  );

  testWidgets(
    'native tool updates render one execution and keep failure visible (#215)',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(1440, 960));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final bus = FakeBus();
      final host = _host(bus);
      host.sessions.applySnapshot({
        'host': {
          'id': 'host',
          'name': 'Host',
          'host': true,
          'state': 'running',
          'model': 'fixture',
          'thinking': 'low',
          'cwd': '/tmp',
          'transcript': <dynamic>[],
        },
      });
      await tester.pumpWidget(panel(AgentConsolePlugin(), host));
      final events = <Map<String, dynamic>>[
        {'type': 'input', 'content': 'Read the fixture'},
        {'type': 'agent_start'},
        {
          'type': 'tool_execution_start',
          'toolCallId': 'call-one',
          'toolName': 'fixture_read',
          'args': '{"path":"fixture.txt"}',
        },
        {
          'type': 'tool_execution_update',
          'toolCallId': 'call-one',
          'toolName': 'fixture_read',
          'result': 'Opening fixture',
        },
        {
          'type': 'tool_execution_end',
          'toolCallId': 'call-one',
          'toolName': 'fixture_read',
          'isError': true,
          'result': 'Fixture access denied',
        },
        {'type': 'agent_end'},
      ];
      for (var i = 0; i < events.length; i++) {
        host.sessions.applyEvent({
          'sessionId': 'host',
          'state': i == events.length - 1 ? 'idle' : 'running',
          'event': events[i],
        }, envelopeId: 'tool-$i');
        await tester.pump();
        if (events[i]['type'] == 'tool_execution_update') {
          expect(find.byIcon(Icons.check_circle), findsNothing);
          expect(find.byType(CircularProgressIndicator), findsWidgets);
        }
        expectNoFlutterErrors(tester);
      }
      await tester.pumpAndSettle();
      expect(find.text('fixture_read'), findsOneWidget);
      expect(find.byType(ExpansionTile), findsOneWidget);
      expect(find.byIcon(Icons.check_circle), findsNothing);
      expect(find.byType(CircularProgressIndicator), findsNothing);
      await tester.tap(find.text('fixture_read'));
      await tester.pumpAndSettle();
      expect(find.textContaining('Fixture access denied'), findsOneWidget);
      expectNoFlutterErrors(tester);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
      await bus.dispose();
    },
  );

  testWidgets(
    'native tool turns retain distinct assistant messages across a running reopen (#215)',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(1440, 960));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final bus = FakeBus();
      final host = _host(bus);
      host.sessions.applySnapshot({
        'host': {
          'id': 'host',
          'name': 'Host',
          'host': true,
          'state': 'running',
          'model': 'fixture',
          'cwd': '/tmp',
          'transcript': <dynamic>[],
        },
      });
      await tester.pumpWidget(panel(AgentConsolePlugin(), host, height: 850));
      var sequence = 0;
      Future<void> deliver(
        Map<String, dynamic> event, {
        String state = 'running',
      }) async {
        host.sessions.applyEvent({
          'sessionId': 'host',
          'state': state,
          'event': event,
        }, envelopeId: 'boundary-${sequence++}');
        await tester.pump();
      }

      await deliver({'type': 'input', 'content': 'Check fixture'});
      await deliver({'type': 'agent_start'});
      await deliver({'type': 'message_start'});
      await deliver({'type': 'message_update', 'delta': 'Checking'});
      await deliver({
        'type': 'message',
        'role': 'assistant',
        'text': 'Checking the fixture.',
      });
      await deliver({
        'type': 'tool_execution_start',
        'toolCallId': 'read-one',
        'toolName': 'fixture_read',
        'args': '{}',
      });
      await deliver({
        'type': 'tool_execution_end',
        'toolCallId': 'read-one',
        'toolName': 'fixture_read',
        'result': 'one record',
      });
      expect(find.byIcon(Icons.content_copy), findsNothing);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump();
      await tester.pumpWidget(panel(AgentConsolePlugin(), host, height: 850));
      await tester.pump();
      expect(
        find.byIcon(Icons.content_copy),
        findsNothing,
        reason: 'reopening an active turn does not mark it complete',
      );
      await deliver({'type': 'message_start'});
      await deliver({'type': 'message_update', 'delta': 'One'});
      await deliver({'type': 'message_update', 'delta': ' record.'});
      await deliver({
        'type': 'message',
        'role': 'assistant',
        'text': 'One record.',
      });
      await deliver({'type': 'agent_end'}, state: 'idle');
      await tester.pumpAndSettle();
      expect(
        tester
            .widgetList<MarkdownBody>(find.byType(MarkdownBody))
            .map((widget) => widget.data)
            .toList(),
        ['Checking the fixture.', 'One record.'],
      );
      expect(find.byType(ExpansionTile), findsOneWidget);
      expect(find.byIcon(Icons.content_copy), findsOneWidget);
      expectNoFlutterErrors(tester);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
      await bus.dispose();
    },
  );

  testWidgets(
    'stored assistant replies retain their role without live agent boundaries (#215)',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(1440, 960));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final bus = FakeBus();
      final host = _host(bus);
      host.sessions.applySnapshot({
        'host': {
          'id': 'host',
          'name': 'Host',
          'host': true,
          'state': 'ended',
          'model': 'fixture',
          'cwd': '/tmp',
          'transcript': [
            {
              'type': 'input',
              'content': 'Repeat me',
              'ts': '2026-08-31T03:00:00Z',
            },
            {
              'type': 'message',
              'role': 'assistant',
              'text': 'Repeat me',
              'ts': '2026-08-31T03:00:01Z',
            },
          ],
        },
      });
      await tester.pumpWidget(panel(AgentConsolePlugin(), host));
      await tester.pumpAndSettle();
      expect(find.byType(MarkdownBody), findsOneWidget);
      expect(
        tester.widget<MarkdownBody>(find.byType(MarkdownBody)).data,
        'Repeat me',
      );
      expect(find.widgetWithText(SelectableText, 'Repeat me'), findsOneWidget);
      expect(find.byIcon(Icons.content_copy), findsOneWidget);
      expectNoFlutterErrors(tester);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
      await bus.dispose();
    },
  );

  testWidgets('empty native failures and cancellations remain visible (#215)', (tester) async {
    await tester.binding.setSurfaceSize(const Size(1440, 960));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    for (final reason in ['error', 'aborted']) {
      final bus = FakeBus();
      final host = _host(bus);
      host.sessions.applySnapshot({
        'host': {
          'id': 'host', 'name': 'Host', 'host': true, 'state': 'idle',
          'model': 'fixture', 'cwd': '/tmp',
          'transcript': [
            {'type': 'input', 'content': 'Run fixture'},
            {'type': 'agent_start'},
            {'type': 'message', 'role': 'assistant', 'text': '',
             'stopReason': reason, 'errorMessage': reason == 'error' ? 'Fixture provider unavailable' : 'Request was aborted'},
            {'type': 'agent_end', 'aborted': reason == 'aborted'},
          ],
        },
      });
      await tester.pumpWidget(panel(AgentConsolePlugin(), host));
      await tester.pumpAndSettle();
      expect(find.text(reason == 'error' ? 'Error' : 'Canceled'), findsWidgets);
      expect(find.textContaining(reason == 'error' ? 'Fixture provider unavailable' : 'Request was aborted'), findsOneWidget);
      expect(find.byType(MarkdownBody), findsNothing);
      expect(find.byType(CircularProgressIndicator), findsNothing);
      expectNoFlutterErrors(tester);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
      await bus.dispose();
    }
  });

  testWidgets('reused native tool IDs stay scoped to their own turns (#215)', (tester) async {
    await tester.binding.setSurfaceSize(const Size(1440, 1000));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final bus = FakeBus();
    final host = _host(bus);
    host.sessions.applySnapshot({'host': {
      'id': 'host', 'name': 'Host', 'host': true, 'state': 'ended',
      'model': 'fixture', 'cwd': '/tmp', 'transcript': [
        for (final turn in ['First', 'Second']) ...[
          {'type': 'input', 'content': '$turn request'},
          {'type': 'tool_execution_end', 'toolCallId': 'call_0', 'toolName': 'fixture_read', 'result': '$turn tool result'},
          {'type': 'message', 'role': 'assistant', 'text': '$turn answer'},
          {'type': 'agent_end'},
        ],
      ],
    }});
    await tester.pumpWidget(panel(AgentConsolePlugin(), host, height: 950));
    await tester.pumpAndSettle();
    expect(find.byType(ExpansionTile), findsNWidgets(2));
    await tester.tap(find.byType(ExpansionTile).first);
    await tester.pumpAndSettle();
    expect(find.text('First tool result'), findsOneWidget);
    await tester.tap(find.byType(ExpansionTile).last);
    await tester.pumpAndSettle();
    expect(find.text('Second tool result'), findsOneWidget);
    expectNoFlutterErrors(tester);
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpAndSettle();
    await bus.dispose();
  });

  testWidgets('reopened partial terminal answers never receive a success footer (#215)', (tester) async {
    await tester.binding.setSurfaceSize(const Size(1440, 1000));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    for (final reason in ['error', 'aborted']) {
      final bus = FakeBus();
      final host = _host(bus);
      host.sessions.applySnapshot({'host': {
        'id': 'host', 'name': 'Host', 'host': true, 'state': 'ended',
        'model': 'fixture', 'cwd': '/tmp', 'transcript': [
          {'type': 'input', 'content': 'Run fixture'},
          {'type': 'message', 'role': 'assistant', 'text': 'Partial answer',
           'stopReason': reason, 'errorMessage': 'Fixture $reason'},
        ],
      }});
      for (var reopen = 0; reopen < 2; reopen++) {
        await tester.pumpWidget(panel(AgentConsolePlugin(), host, height: 950));
        await tester.pumpAndSettle();
        expect(tester.widget<MarkdownBody>(find.byType(MarkdownBody)).data, 'Partial answer');
        expect(find.byIcon(Icons.check_circle), findsNothing);
        expect(find.text(reason == 'error' ? 'failed' : 'aborted'), findsOneWidget);
        await tester.tap(find.byKey(const Key('agent_console_turn_summary')));
        await tester.pumpAndSettle();
        expect(find.textContaining('Turn complete.'), findsNothing);
        expectNoFlutterErrors(tester);
        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pumpAndSettle();
      }
      await bus.dispose();
    }
  });

  testWidgets('empty failed history cannot taint a later successful turn (#215)', (tester) async {
    await tester.binding.setSurfaceSize(const Size(1440, 1000));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    for (final reason in ['error', 'aborted']) {
      final bus = FakeBus();
      final host = _host(bus);
      host.sessions.applySnapshot({'host': {
        'id': 'host', 'name': 'Host', 'host': true, 'state': 'idle',
        'model': 'fixture', 'cwd': '/tmp', 'transcript': [
          {'type': 'input', 'content': 'Unconfigured request', 'ts': '2026-08-31T06:00:00Z'},
          {'type': 'message', 'role': 'assistant', 'text': '',
           'stopReason': reason, 'errorMessage': 'Fixture $reason', 'ts': '2026-08-31T06:00:01Z'},
          {'type': 'input', 'content': 'Configured request', 'ts': '2026-08-31T06:03:00Z'},
          {'type': 'message', 'role': 'assistant', 'text': 'Recovered answer',
           'stopReason': 'stop', 'ts': '2026-08-31T06:03:11Z'},
        ],
      }});
      for (var reopen = 0; reopen < 2; reopen++) {
        await tester.pumpWidget(panel(AgentConsolePlugin(), host, height: 950));
        await tester.pumpAndSettle();
        expect(find.text('Fixture $reason'), findsOneWidget);
        expect(tester.widget<MarkdownBody>(find.byType(MarkdownBody)).data, 'Recovered answer');
        expect(find.byIcon(Icons.check_circle), findsOneWidget);
        expect(find.text('11s'), findsOneWidget);
        expect(find.text(reason == 'error' ? 'failed' : 'aborted'), findsNothing,
            reason: 'the successful answer must not inherit an earlier empty failure');
        expectNoFlutterErrors(tester);
        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pumpAndSettle();
      }
      await bus.dispose();
    }
  });

  testWidgets('queued input preserves a streamed assistant through live and reopened rendering (#215)', (tester) async {
    await tester.binding.setSurfaceSize(const Size(1440, 1000));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    for (final mode in ['steer', 'follow_up']) {
      final bus = FakeBus();
      final host = _host(bus);
      host.sessions.applySnapshot({'host': {
        'id': 'host', 'name': 'Host', 'host': true, 'state': 'running',
        'model': 'fixture', 'cwd': '/tmp', 'transcript': <dynamic>[],
      }});
      await tester.pumpWidget(panel(AgentConsolePlugin(), host, height: 950));
      var sequence = 0;
      Future<void> deliver(Map<String, dynamic> event, {String state = 'running'}) async {
        host.sessions.applyEvent({
          'sessionId': 'host', 'state': state,
          'event': {...event, 'ts': DateTime.utc(2026, 8, 31, 5, 0, sequence).toIso8601String()},
        }, envelopeId: 'queued-$mode-${sequence++}');
        await tester.pump();
      }
      await deliver({'type': 'input', 'mode': 'prompt', 'content': 'Count four'});
      await deliver({'type': 'agent_start'});
      await deliver({'type': 'message_start'});
      await deliver({'type': 'message_update', 'delta': '1 2'});
      await deliver({'type': 'input', 'mode': mode, 'content': 'Then acknowledge'});
      expect(find.byIcon(Icons.content_copy), findsNothing,
          reason: 'a queued directive cannot finalize the still-streaming turn');
      await deliver({'type': 'message_update', 'delta': ' 3 4'});
      await deliver({'type': 'message', 'role': 'assistant', 'text': '1 2 3 4'});
      await deliver({'type': 'message_start'});
      await deliver({'type': 'message_update', 'delta': 'Acknowledged'});
      await deliver({'type': 'message', 'role': 'assistant', 'text': 'Acknowledged'});
      await deliver({'type': 'agent_end'}, state: 'idle');
      for (var reopen = 0; reopen < 2; reopen++) {
        await tester.pumpAndSettle();
        expect(tester.widgetList<MarkdownBody>(find.byType(MarkdownBody))
            .map((widget) => widget.data).toList(), ['1 2 3 4', 'Acknowledged']);
        expect(find.widgetWithText(SelectableText, 'Then acknowledge'), findsOneWidget);
        expect(find.byIcon(Icons.content_copy), findsOneWidget);
        expectNoFlutterErrors(tester);
        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pumpAndSettle();
        if (reopen == 0) await tester.pumpWidget(panel(AgentConsolePlugin(), host, height: 950));
      }
      await bus.dispose();
    }
  });

  testWidgets('model dropdown lists available models and reflects selection', (
    tester,
  ) async {
    final bus = FakeBus();
    final host = _host(bus)
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
    final host = _host(bus);
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
    final host = _host(bus);
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

    // The default host card exposes the same delete action as every child.
    await tester.tap(find.text('Host'), buttons: kSecondaryButton);
    await tester.pumpAndSettle();
    expect(find.text('Delete'), findsOneWidget);
    await tester.tap(find.text('Delete').last);
    await tester.pumpAndSettle();
    expect(find.textContaining('Delete Host?'), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, 'Delete'));
    await tester.pumpAndSettle();
    expect(
      bus.sent.any(
        (entry) =>
            entry['type'] == 'delete' &&
            (entry['payload'] as Map)['sessionId'] == 'host',
      ),
      isTrue,
    );

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
    final host = _host(bus)
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

  testWidgets('Agent Console uses a Codex-style user bubble and light text', (
    tester,
  ) async {
    final bus = FakeBus();
    final host = _host(bus);
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
      tester
          .widget<SelectableText>(
            find.widgetWithText(SelectableText, 'plain question'),
          )
          .style,
      isNotNull,
    );
    expect(find.byKey(const Key('agent_console_user_bubble')), findsOneWidget);
    final assistantLane = find.byKey(
      const Key('agent_console_assistant_lane'),
    );
    expect(tester.getSize(assistantLane).width, 760);
    expect(tester.getTopLeft(assistantLane).dx, lessThan(150));
    await bus.dispose();
  });

  testWidgets(
    'Agent Console shows one start tag and a duration footer with copy actions',
    (tester) async {
      final bus = FakeBus();
      final host = _host(bus);
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
            {
              'type': 'message',
              'text': 'here is the code\n```dart\nvoid main() {}\n```',
            },
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
    },
  );
  testWidgets('Agent Console derives duration and copy action from history', (
    tester,
  ) async {
    final bus = FakeBus();
    final host = _host(bus);
    host.sessions.applySnapshot({
      'host': {
        'id': 'host',
        'name': 'Host',
        'host': true,
        'state': 'idle',
        'model': 'test',
        'cwd': '/tmp',
        'transcript': [
          {
            'type': 'input',
            'content': 'history request',
            'ts': '2026-08-22T10:00:00.000Z',
          },
          {
            'type': 'message',
            'text': 'history response',
            'ts': '2026-08-22T10:01:57.000Z',
          },
        ],
      },
    });
    await tester.pumpWidget(panel(AgentConsolePlugin(), host));

    expect(find.text('Worked for'), findsOneWidget);
    expect(find.text('1m 57s'), findsOneWidget);
    expect(find.byIcon(Icons.content_copy), findsOneWidget);
    await bus.dispose();
  });
  test('session deltas are idempotent by envelope id', () async {
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
    var emissions = 0;
    sessions.changes.listen((_) => emissions++);
    // Snapshots ship rail metadata; transcripts stream separately, so a
    // pure delta event updates state without touching the transcript.
    final payload = {
      'sessionId': 'host',
      'state': 'running',
      'event': {'type': 'message_update', 'delta': 'once'},
    };
    sessions.applyEvent(payload, envelopeId: 'same');
    sessions.applyEvent(payload, envelopeId: 'same');
    await Future<void>.delayed(Duration.zero);
    expect(emissions, 1, reason: 'duplicate envelope must be dropped');
    expect(sessions.current.single.transcript, hasLength(1));
    expect((sessions.current.single.transcript.single as Map)['delta'], 'once');
    // Metadata patches rename without duplicating the session card.
    sessions.applyEvent({'id': 'host', 'name': 'Renamed', 'state': 'idle'});
    await Future<void>.delayed(Duration.zero);
    expect(sessions.current.single.name, 'Renamed');
    expect(sessions.current, hasLength(1));
    expect(sessions.current.single.transcript, hasLength(1));
  });
  testWidgets('Session Rail pins host and exposes New Session', (tester) async {
    final bus = FakeBus();
    final host = _host(bus);
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
    final host = _host(bus, workspace: '/workspace');
    await tester.pumpWidget(panel(StatusBarPlugin(), host));
    expect(find.text('Hub connected'), findsOneWidget);
    expect(find.text('/workspace'), findsOneWidget);
    await bus.dispose();
  });
  testWidgets('Status Bar reset confirms then emits layout reset', (
    tester,
  ) async {
    final bus = FakeBus();
    final host = _host(bus);
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
  testWidgets('Widget Store renders base, catalog, and legacy provenance badges', (
    tester,
  ) async {
    final bus = FakeBus();
    final host = _host(bus);
    host.snapshot = {
      'widgets': {
        'agent_console': {
          'name': 'Agent Console',
          'enabled': true,
          'core': true,
          'source': 'base',
        },
        'legacy_helper': {
          'name': 'Legacy Helper',
          'enabled': true,
        },
      },
      'catalog': {
        'clock': {
          'name': 'Clock',
          'description': 'Example',
          'source': 'catalog',
        },
        'archived_clock': {
          'name': 'Archived Clock',
          'description': 'Base archive example',
          'source': 'base',
        },
        'legacy_clock': {
          'name': 'Legacy Clock',
          'description': 'Legacy available entry',
        },
      },
    };
    await tester.pumpWidget(panel(WidgetStorePlugin(), host));
    expect(find.text('Agent Console'), findsOneWidget);
    expect(find.text('Clock'), findsOneWidget);
    expect(find.text('BASE'), findsNWidgets(2));
    expect(find.text('CATALOG'), findsNWidgets(2));
    expect(find.text('LEGACY'), findsNothing);
    expect(find.text('Legacy Helper'), findsOneWidget);
    final archiveRow = find.ancestor(
      of: find.text('Archived Clock'),
      matching: find.byType(ListTile),
    );
    expect(find.descendant(of: archiveRow, matching: find.text('BASE')), findsOneWidget);
    expect(find.descendant(of: archiveRow, matching: find.text('CATALOG')), findsNothing);
    final legacyRow = find.ancestor(
      of: find.text('Legacy Clock'),
      matching: find.byType(ListTile),
    );
    expect(find.descendant(of: legacyRow, matching: find.text('CATALOG')), findsOneWidget);
    await tester.tap(find.descendant(of: archiveRow, matching: find.text('Install')));
    expect(bus.sent.last['channel'], 'store/control');
    expect(bus.sent.last['type'], 'install');
    expect(bus.sent.last['payload'], {'id': 'archived_clock'});
    expect(tester.takeException(), isNull);
    await bus.dispose();
  });
  testWidgets('Diff Viewer real-use trial renders and updates a usable comparison', (
    tester,
  ) async {
    final bus = FakeBus();
    final host = _host(bus);
    await tester.pumpWidget(panel(DiffViewerPlugin(), host));
    expect(find.text('Phase 1 real-use trial'), findsOneWidget);
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
    final host = _host(bus);
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
    final host = _host(bus);
    host.snapshot = {'tracker': _trackerFixture()};
    await tester.pumpWidget(panel(TrackerBoardPlugin(), host));
    await tester.pump();
    await tester.tap(find.textContaining('Epic: tracker panel'));
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
    final host = _host(bus);
    host.snapshot = {'tracker': _trackerFixture()};
    await tester.pumpWidget(panel(TrackerBoardPlugin(), host));
    await tester.pump();
    final card = find.textContaining('Task: build board');
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
    final host = _host(bus);
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
    final host = _host(bus);
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
    bus.emit('tracker/op', 'op_result', {'requestId': (bus.sent.last['payload'] as Map)['requestId'],'op': 'create', 'ok': true, 'number': 21});
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('tracker_sheet_box')), findsNothing);
    await bus.dispose();
  });

  testWidgets('ticket sheet isolates create results and retries by request (#216)', (tester) async {
    final bus = FakeBus();
    final host = _host(bus);
    host.snapshot = {'tracker': _trackerFixture()};
    await tester.pumpWidget(panel(TrackerBoardPlugin(), host));
    await tester.pump();
    await tester.tap(find.byIcon(Icons.add));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('tracker_sheet_title')), 'Doomed ticket');
    await tester.tap(find.byKey(const Key('tracker_sheet_submit')));
    await tester.pump();
    final firstRequestId = (bus.sent.last['payload'] as Map)['requestId'];
    expect(firstRequestId, isA<String>());
    await tester.tapAt(const Offset(1, 1));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('tracker_sheet_box')), findsOneWidget);
    for (final wrongResult in [
      {'op': 'create', 'ok': true, 'number': 99, 'requestId': 'other-dialog'},
      {'op': 'create', 'ok': false, 'error': 'FOREIGN_FAILURE', 'requestId': 'other-dialog'},
      {'op': 'create', 'ok': false, 'error': 'UNCORRELATED_FAILURE'},
    ]) {
      bus.emit('tracker/op', 'op_result', wrongResult);
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('tracker_sheet_box')), findsOneWidget);
      expect(find.textContaining('FOREIGN_FAILURE'), findsNothing);
      expect(find.textContaining('UNCORRELATED_FAILURE'), findsNothing);
      expect(tester.widget<FilledButton>(find.byKey(const Key('tracker_sheet_submit'))).onPressed, isNull);
    }
    bus.emit('tracker/op', 'op_result', {'requestId': (bus.sent.last['payload'] as Map)['requestId'],'op': 'create', 'ok': false, 'error': 'gh: label not found'});
    await tester.pumpAndSettle();
    expect(find.textContaining('gh: label not found'), findsOneWidget);
    expect(find.byKey(const Key('tracker_sheet_box')), findsOneWidget);
    await tester.tap(find.byKey(const Key('tracker_sheet_submit')));
    await tester.pump();
    final retryRequestId = (bus.sent.last['payload'] as Map)['requestId'];
    expect(retryRequestId, isNot(firstRequestId));
    bus.emit('tracker/op', 'op_result', {'requestId': firstRequestId, 'op': 'create', 'ok': true, 'number': 21});
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('tracker_sheet_box')), findsOneWidget);
    bus.emit('tracker/op', 'op_result', {'requestId': retryRequestId, 'op': 'create', 'ok': true, 'number': 22});
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('tracker_sheet_box')), findsNothing);
    expectNoFlutterErrors(tester);
    await bus.dispose();
  });

  testWidgets('ticket sheet edits a card and returns to view mode on success', (tester) async {
    final bus = FakeBus();
    final host = _host(bus);
    host.snapshot = {'tracker': _trackerFixture()};
    await tester.pumpWidget(panel(TrackerBoardPlugin(), host));
    await tester.pump();
    await tester.tap(find.textContaining('Task: build board'));
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
    bus.emit('tracker/op', 'op_result', {'requestId': (bus.sent.last['payload'] as Map)['requestId'],'op': 'update', 'ok': true, 'number': 11});
    await tester.pumpAndSettle();
    expect(find.textContaining('Task: renamed'), findsOneWidget);
    expect(find.byKey(const Key('tracker_sheet_title')), findsNothing);
    await bus.dispose();
  });

  testWidgets('ticket sheet preserves remote labels on a title-only save', (tester) async {
    final bus = FakeBus();
    final host = _host(bus);
    host.snapshot = {
      'tracker': _trackerFixture(
        card11Labels: const ['task', 'status:todo', 'keep-me'],
      ),
    };
    await tester.pumpWidget(panel(TrackerBoardPlugin(), host));
    await tester.pump();
    await tester.tap(find.textContaining('Task: build board'));
    await tester.pumpAndSettle();
    await tester.tap(find.byIcon(Icons.edit_outlined));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('tracker_sheet_title')), 'Task: renamed');
    await tester.tap(find.byKey(const Key('tracker_sheet_submit')));
    await tester.pump();
    expect(
      bus.sent.where((sent) {
        if (sent['channel'] != 'tracker/control' || sent['type'] != 'update') return false;
        final payload = sent['payload'] as Map;
        return payload['number'] == 11 &&
            (payload['labels'] as List).contains('keep-me') &&
            !(payload['labels'] as List).contains('status:todo');
      }),
      isNotEmpty,
    );
    bus.emit('tracker/op', 'op_result', {'requestId': (bus.sent.last['payload'] as Map)['requestId'],'op': 'update', 'ok': true, 'number': 11});
    await tester.pumpAndSettle();
    expect(find.textContaining('Task: renamed'), findsOneWidget);
    expect(find.byKey(const Key('tracker_sheet_title')), findsNothing);
    await bus.dispose();
  });

  testWidgets('ticket sheet moves a card via the lane dropdown', (tester) async {
    final bus = FakeBus();
    final host = _host(bus);
    host.snapshot = {'tracker': _trackerFixture()};
    await tester.pumpWidget(panel(TrackerBoardPlugin(), host));
    await tester.pump();
    await tester.tap(find.textContaining('Task: build board'));
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
    final host = _host(bus);
    host.snapshot = {'tracker': _trackerFixture()};
    await tester.pumpWidget(panel(TrackerBoardPlugin(), host));
    await tester.pump();
    await tester.tap(find.textContaining('Shipped thing'));
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
    bus.emit('tracker/op', 'op_result', {'requestId': (bus.sent.last['payload'] as Map)['requestId'],'op': 'delete', 'ok': true, 'number': 12});
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('tracker_sheet_box')), findsNothing);
    await bus.dispose();
  });

  testWidgets('ticket sheet resizes from the corner handle', (tester) async {
    final bus = FakeBus();
    final host = _host(bus);
    host.snapshot = {'tracker': _trackerFixture()};
    await tester.pumpWidget(panel(TrackerBoardPlugin(), host));
    await tester.pump();
    await tester.tap(find.textContaining('Task: build board'));
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
    final host = _host(bus);
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

Map<String, dynamic> _trackerFixture({
  bool stale = false,
  String? error,
  List<String>? card11Labels,
}) => {
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
      'labels': card11Labels ?? ['task', 'status:todo'],
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
