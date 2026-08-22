import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

class PifEnvelope {
  const PifEnvelope({
    required this.v,
    required this.id,
    required this.ts,
    required this.channel,
    required this.type,
    required this.payload,
  });
  final int v;
  final String id;
  final DateTime ts;
  final String channel;
  final String type;
  final Object? payload;

  factory PifEnvelope.fromJson(Map<String, dynamic> json) {
    if (json['v'] != 1 ||
        json['id'] is! String ||
        json['channel'] is! String ||
        json['type'] is! String ||
        !json.containsKey('payload')) {
      throw const FormatException('Invalid pif envelope');
    }
    return PifEnvelope(
      v: 1,
      id: json['id'] as String,
      ts: DateTime.parse(json['ts'] as String),
      channel: json['channel'] as String,
      type: json['type'] as String,
      payload: json['payload'],
    );
  }

  Map<String, dynamic> toJson() => {
    'v': v,
    'id': id,
    'ts': ts.toUtc().toIso8601String(),
    'channel': channel,
    'type': type,
    'payload': payload,
  };
}

class PifBus {
  PifBus({Uri? uri, String? token})
    : uri =
          uri ??
          Uri.parse(
            'ws://127.0.0.1:${Platform.environment['PIF_PORT'] ?? '31415'}/pif',
          ) {
    _token = token ?? _resolveToken();
  }
  final Uri uri;
  String? _token;

  /// Per-launch hub token: env first, then the token file the hub drops
  /// next to its state for clients the supervisor did not launch.
  static String? _resolveToken() {
    final env = Platform.environment['PIF_TOKEN'];
    if (env != null && env.isNotEmpty) return env;
    final workspace = Platform.environment['PIF_WORKSPACE'];
    final candidates = <String>[
      if (workspace != null && workspace.isNotEmpty) workspace,
      Directory.current.path,
      '${Directory.current.path}/..',
    ];
    for (final base in candidates) {
      try {
        final token = File('$base/.pi/pif/token').readAsStringSync().trim();
        if (token.isNotEmpty) return token;
      } catch (_) {}
    }
    return null;
  }

  Uri get connectUri =>
      _token == null
          ? uri
          : uri.replace(queryParameters: {
            ...uri.queryParameters,
            'token': _token,
          });
  final _events = StreamController<PifEnvelope>.broadcast();
  final _connection = StreamController<bool>.broadcast();
  WebSocket? _socket;
  Timer? _retry;
  int _attempt = 0;
  bool _disposed = false;

  Stream<PifEnvelope> get events => _events.stream;
  Stream<bool> get connection => _connection.stream;
  bool get connected => _socket != null;
  Stream<PifEnvelope> channel(String prefix) =>
      events.where((event) => event.channel.startsWith(prefix));

  Future<void> connect() async {
    if (_disposed || _socket != null) return;
    try {
      final socket = await WebSocket.connect(connectUri.toString());
      if (_disposed) return socket.close();
      _socket = socket;
      _attempt = 0;
      _connection.add(true);
      socket.listen(
        _receive,
        onDone: _disconnected,
        onError: (_) => _disconnected(),
        cancelOnError: true,
      );
      send('shell/state', 'snapshot_request', const {});
    } catch (_) {
      _scheduleReconnect();
    }
  }

  void _receive(dynamic raw) {
    try {
      final decoded = jsonDecode(raw as String) as Map<String, dynamic>;
      _events.add(PifEnvelope.fromJson(decoded));
    } catch (error, stack) {
      _events.addError(error, stack);
    }
  }

  void _disconnected() {
    if (_socket == null) return;
    _socket = null;
    _connection.add(false);
    _scheduleReconnect();
  }

  void _scheduleReconnect() {
    if (_disposed || _retry?.isActive == true) return;
    final delay = min(8000, 250 * pow(2, _attempt++).toInt());
    _retry = Timer(Duration(milliseconds: delay), connect);
  }

  void send(String channel, String type, Object? payload) {
    final envelope = PifEnvelope(
      v: 1,
      id: '${DateTime.now().microsecondsSinceEpoch}-${Random().nextInt(1 << 32)}',
      ts: DateTime.now().toUtc(),
      channel: channel,
      type: type,
      payload: payload,
    );
    _socket?.add(jsonEncode(envelope.toJson()));
  }

  Future<void> dispose() async {
    _disposed = true;
    _retry?.cancel();
    await _socket?.close();
    await _events.close();
    await _connection.close();
  }
}
