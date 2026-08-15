import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pif/core/bus.dart';
import 'package:pif/core/docking_shell.dart';

class MockHubBus extends PifBus {
  MockHubBus() : super(uri: Uri.parse('ws://mock.invalid/pif'));
  final eventController = StreamController<PifEnvelope>.broadcast();
  final connectionController = StreamController<bool>.broadcast();
  final sent = <String>[];
  bool online = false;
  @override
  Stream<PifEnvelope> get events => eventController.stream;
  @override
  Stream<PifEnvelope> channel(String prefix) =>
      events.where((event) => event.channel.startsWith(prefix));
  @override
  Stream<bool> get connection => connectionController.stream;
  @override
  bool get connected => online;
  @override
  Future<void> connect() async {
    online = true;
    connectionController.add(true);
    send('shell/state', 'snapshot_request', const {});
  }

  @override
  void send(String channel, String type, Object? payload) =>
      sent.add('$channel:$type');
  void emitSnapshot() => eventController.add(
    PifEnvelope(
      v: 1,
      id: 'snapshot',
      ts: DateTime.now(),
      channel: 'shell/state',
      type: 'snapshot',
      payload: {
        'sessions': {
          'host': {
            'id': 'host',
            'name': 'Mock Host',
            'host': true,
            'state': 'idle',
            'model': 'mock',
            'cwd': '/tmp',
          },
        },
        'widgets': {
          'agent_console': {'enabled': true},
          'session_rail': {'enabled': true},
          'widget_store': {'enabled': true},
          'status_bar': {'enabled': true},
        },
        'catalog': {},
        'layout': {'panels': {}},
        'health': {'workspace': '/tmp'},
      },
    ),
  );
  void emitLayout(Map<String, dynamic> layout) => eventController.add(
    PifEnvelope(
      v: 1,
      id: 'layout-${sent.length}',
      ts: DateTime.now(),
      channel: 'shell/layout',
      type: 'layout_state',
      payload: layout,
    ),
  );
  void disconnectAndReconnect() {
    online = false;
    connectionController.add(false);
    online = true;
    connectionController.add(true);
    send('shell/state', 'snapshot_request', const {});
    emitSnapshot();
  }

  @override
  Future<void> dispose() async {
    await eventController.close();
    await connectionController.close();
  }
}

void main() {
  testWidgets('mock hub snapshot boots shell and reconnect resyncs', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(1400, 900));
    final bus = MockHubBus();
    await tester.pumpWidget(MaterialApp(home: DockingShell(bus: bus)));
    bus.emitSnapshot();
    await tester.pump();
    expect(find.text('Mock Host'), findsWidgets);
    expect(find.text('WIDGET STORE'), findsOneWidget);
    bus.emitLayout({
      'panels': {
        'widget_store': {'open': false, 'action': 'close'},
      },
    });
    await tester.pump();
    expect(find.text('WIDGET STORE'), findsNothing);
    bus.emitLayout({
      'panels': {
        'widget_store': {'open': true, 'action': 'open'},
      },
    });
    await tester.pumpAndSettle();
    expect(find.text('WIDGET STORE'), findsOneWidget);
    expect(
      bus.sent.where((event) => event == 'shell/state:snapshot_request'),
      hasLength(1),
    );
    bus.disconnectAndReconnect();
    await tester.pump();
    expect(find.text('Mock Host'), findsWidgets);
    expect(
      bus.sent.where((event) => event == 'shell/state:snapshot_request'),
      hasLength(2),
    );
    await tester.pumpWidget(const SizedBox());
    await tester.binding.setSurfaceSize(null);
  });
}
