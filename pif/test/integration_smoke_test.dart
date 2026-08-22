import 'dart:async';
import 'dart:convert';
import 'dart:io';

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
  void emit(String channel, String type, Object? payload) => eventController.add(
    PifEnvelope(
      v: 1,
      id: 'event-${DateTime.now().microsecondsSinceEpoch}',
      ts: DateTime.now(),
      channel: channel,
      type: type,
      payload: payload,
    ),
  );

  void emitSnapshot({Map<String, dynamic>? widgets, Map<String, dynamic>? layout}) => eventController.add(
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
        'widgets':
            widgets ??
            {
              'agent_console': {'enabled': true},
              'session_rail': {'enabled': true},
              'widget_store': {'enabled': true},
              'status_bar': {'enabled': true},
            },
        'catalog': {},
        'layout': layout ?? {'panels': {}},
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

/// Minimal hub-like WebSocket server used by the reconnect test.
/// dart:io's server.close(force) does not terminate upgraded sockets, so
/// kill() closes them explicitly.
class HubLikeServer {
  HubLikeServer(this.server);
  final HttpServer server;
  final List<WebSocket> sockets = [];
  Future<void> kill() async {
    for (final socket in sockets) {
      await socket.close();
    }
    await server.close(force: true);
  }
}

Future<HubLikeServer> startHubLikeServer(int port, List<String> received) async {
  final server = await HttpServer.bind(InternetAddress.loopbackIPv4, port);
  final hub = HubLikeServer(server);
  server.listen((request) async {
    if (request.uri.path != '/pif') {
      request.response.statusCode = 404;
      await request.response.close();
      return;
    }
    final socket = await WebSocketTransformer.upgrade(request);
    hub.sockets.add(socket);
    socket.listen(
      (raw) {
        received.add(raw as String);
        if (socket.readyState == WebSocket.open) {
          try {
            socket.add(
              jsonEncode({
                'v': 1,
                'id': 'ack-${received.length}',
                'ts': DateTime.now().toUtc().toIso8601String(),
                'channel': 'shell/state',
                'type': 'ack',
                'payload': {},
              }),
            );
          } catch (_) {/* client closed mid-ack */}
        }
      },
      onDone: () => hub.sockets.remove(socket),
    );
  });
  return hub;
}

void main() {
  test('PifBus queues sends while disconnected and flushes in order on reconnect', () async {
    const port = 31877;
    var server = await startHubLikeServer(port, []);
    final received = <String>[];
    final errors = <Object>[];
    final bus = PifBus(
      uri: Uri.parse('ws://127.0.0.1:$port/pif'),
      token: 'reconnect-test-token',
    );
    bus.events.listen(null, onError: errors.add);
    await bus.connect();
    expect(bus.connected, true);

    final offline = bus.connection.firstWhere((online) => !online);
    await server.kill();
    await offline;
    expect(bus.connected, false);

    // Input typed during the outage is queued, never dropped silently.
    bus.send('session/control', 'input', {'content': 'queued-1'});
    bus.send('session/control', 'input', {'content': 'queued-2'});
    for (var i = 3; i <= 210; i++) {
      bus.send('session/control', 'input', {'content': 'queued-$i'});
    }
    await Future<void>.delayed(const Duration(milliseconds: 50));
    expect(errors, isNotEmpty, reason: 'queue overflow should surface an error');

    server = await startHubLikeServer(port, received);
    final online = bus.connection.firstWhere((value) => value);
    await online;
    await Future.doWhile(() async {
      await Future<void>.delayed(const Duration(milliseconds: 20));
      return received.length < 201; // snapshot request + 200 queued envelopes
    });
    final payloads =
        received
            .map((raw) => (jsonDecode(raw) as Map<String, dynamic>)['payload'] as Map)
            .map((payload) => payload['content'] as String?)
            .whereType<String>()
            .toList();
    expect(payloads.length, 200, reason: 'overflow should keep the newest 200');
    final indexes = payloads.map((content) => int.parse(content.split('-')[1])).toList();
    for (var i = 1; i < indexes.length; i++) {
      expect(indexes[i], indexes[i - 1] + 1, reason: 'queued envelopes flush in order');
    }
    expect(indexes.first, 11, reason: 'overflow drops the oldest');

    await bus.dispose();
    await server.kill();
  });

  test('PifBus re-reads the token between reconnect attempts', () async {
    const port = 31878;
    var currentToken = 'stale-token';
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, port);
    server.listen((request) async {
      if (request.uri.queryParameters['token'] != 'good-token') {
        request.response.statusCode = 401;
        await request.response.close();
        return;
      }
      final socket = await WebSocketTransformer.upgrade(request);
      socket.add(
        jsonEncode({
          'v': 1,
          'id': 'snapshot',
          'ts': DateTime.now().toUtc().toIso8601String(),
          'channel': 'shell/state',
          'type': 'snapshot',
          'payload': const {},
        }),
      );
    });
    final bus = PifBus(
      uri: Uri.parse('ws://127.0.0.1:$port/pif'),
      tokenResolver: () => currentToken,
    );
    await bus.connect();
    await Future<void>.delayed(const Duration(milliseconds: 400));
    expect(bus.connected, isFalse, reason: 'stale token must be rejected');
    currentToken = 'good-token';
    await bus.connection
        .firstWhere((online) => online)
        .timeout(const Duration(seconds: 5));
    expect(bus.connected, isTrue, reason: 'corrected token self-heals');
    await bus.dispose();
    await server.close(force: true);
  });

  testWidgets('tabbed panels drag into collapsed dock edges', (tester) async {
    await tester.binding.setSurfaceSize(const Size(1400, 900));
    final bus = MockHubBus();
    await tester.pumpWidget(MaterialApp(home: DockingShell(bus: bus)));
    bus.emitSnapshot(
      widgets: {
        'agent_console': {'enabled': true},
        'diff_viewer': {'enabled': true},
        'session_rail': {'enabled': true},
        'terminal': {'enabled': true},
        'widget_store': {'enabled': true},
        'status_bar': {'enabled': true},
      },
      layout: {
        'panels': {'session_rail': {'open': false, 'action': 'close'}},
      },
    );
    await tester.pumpAndSettle();
    // Center holds Agent Console + Diff Viewer as tabs; the empty left
    // dock has collapsed to its drop edge.
    expect(find.text('Diff Viewer'), findsOneWidget);
    expect(find.byKey(const Key('pif_dock_left')), findsNothing);
    final edge = find.byKey(const Key('pif_dock_edge_left'));
    expect(edge, findsOneWidget);

    final tab = find.text('Diff Viewer');
    await tester.drag(tab, tester.getCenter(edge) - tester.getCenter(tab));
    await tester.pumpAndSettle();

    expect(bus.sent, contains('shell/layout:move'));
    expect(
      find.byKey(const Key('pif_dock_left')),
      findsOneWidget,
      reason: 'dropping on the edge re-expands the dock',
    );
    await tester.pumpWidget(const SizedBox());
    await tester.binding.setSurfaceSize(null);
  });

  testWidgets('empty docks collapse and restore when widgets return', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(1400, 900));
    final bus = MockHubBus();
    await tester.pumpWidget(MaterialApp(home: DockingShell(bus: bus)));
    final widgets = {
      'agent_console': {'enabled': true},
      'terminal': {'enabled': true},
      'widget_store': {'enabled': true},
      'status_bar': {'enabled': true},
    };
    bus.emitSnapshot(widgets: widgets);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('pif_dock_bottom')), findsOneWidget);
    expect(find.byKey(const Key('pif_dock_edge_bottom')), findsNothing);

    // Terminal toggled off — bottom dock collapses, no reserved space.
    bus.emit('widget/registry', 'registry_state', {
      'widgets': {
        ...widgets,
        'terminal': {'enabled': false},
      },
    });
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('pif_dock_bottom')), findsNothing);
    expect(find.byKey(const Key('pif_dock_edge_bottom')), findsOneWidget);

    // Terminal toggled back on — the dock re-expands at default size.
    bus.emit('widget/registry', 'registry_state', {'widgets': widgets});
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('pif_dock_bottom')), findsOneWidget);
    expect(find.byKey(const Key('pif_dock_edge_bottom')), findsNothing);
    await tester.pumpWidget(const SizedBox());
    await tester.binding.setSurfaceSize(null);
  });

  testWidgets('shell recovers state emitted before it subscribed', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(1400, 900));
    final bus = MockHubBus();
    // Connect and emit a snapshot BEFORE the shell exists — the shell must
    // re-request after subscribing instead of missing it forever.
    await bus.connect();
    bus.emitSnapshot();
    await tester.pumpWidget(MaterialApp(home: DockingShell(bus: bus)));
    expect(
      bus.sent.where((event) => event == 'shell/state:snapshot_request').length,
      greaterThanOrEqualTo(2),
      reason: 'initState re-requests after subscribing',
    );
    bus.emitSnapshot(); // the hub's reply to the re-request
    await tester.pump();
    expect(find.text('Mock Host'), findsWidgets);
    await tester.pumpWidget(const SizedBox());
    await tester.binding.setSurfaceSize(null);
  });

  testWidgets('bottom dock expands into an empty center stage', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(1400, 900));
    final bus = MockHubBus();
    await tester.pumpWidget(MaterialApp(home: DockingShell(bus: bus)));
    // No center widgets (agent console off): terminal takes the stage.
    bus.emitSnapshot(
      widgets: {
        'terminal': {'enabled': true},
        'widget_store': {'enabled': true},
        'status_bar': {'enabled': true},
      },
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('pif_dock_center')), findsNothing);
    expect(find.byKey(const Key('pif_dock_edge_center')), findsOneWidget);
    final bottom = find.byKey(const Key('pif_dock_bottom'));
    expect(bottom, findsOneWidget);
    expect(
      tester.getSize(bottom).height,
      greaterThan(600),
      reason: 'terminal expands into the freed center space',
    );
    await tester.pumpWidget(const SizedBox());
    await tester.binding.setSurfaceSize(null);
  });

  testWidgets('status slot collapses and the title bar recovers the store', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(1400, 900));
    final bus = MockHubBus();
    await tester.pumpWidget(MaterialApp(home: DockingShell(bus: bus)));
    final widgets = {
      'agent_console': {'enabled': true},
      'status_bar': {'enabled': true},
    };
    bus.emitSnapshot(widgets: widgets);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('pif_dock_status')), findsOneWidget);

    // All status widgets off: the strip collapses to an edge.
    bus.emit('widget/registry', 'registry_state', {
      'widgets': {'agent_console': widgets['agent_console']},
    });
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('pif_dock_status')), findsNothing);
    expect(find.byKey(const Key('pif_dock_edge_status')), findsOneWidget);

    // The widget store (off) is recoverable from the title bar button.
    await tester.tap(find.byIcon(Icons.widgets));
    await tester.pumpAndSettle();
    expect(bus.sent, contains('widget/control:toggle'));
    await tester.pumpWidget(const SizedBox());
    await tester.binding.setSurfaceSize(null);
  });

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
      hasLength(2),
      reason: 'connect() plus the initState re-request',
    );
    bus.disconnectAndReconnect();
    await tester.pump();
    expect(find.text('Mock Host'), findsWidgets);
    expect(
      bus.sent.where((event) => event == 'shell/state:snapshot_request'),
      hasLength(3),
    );
    await tester.pumpWidget(const SizedBox());
    await tester.binding.setSurfaceSize(null);
  });
}
