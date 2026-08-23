import 'dart:async';
import 'dart:collection';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

/// A hub-side rejection (shell/error envelope), correlated with the
/// request that caused it when the hub echoed a known request id.
class PifRequestError {
  const PifRequestError({
    required this.kind,
    required this.message,
    this.requestId,
  });
  final String kind;
  final String message;
  final String? requestId;
}

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
  PifBus({Uri? uri, String? token, String? Function()? tokenResolver})
    : uri =
          uri ??
          Uri.parse(
            'ws://127.0.0.1:${Platform.environment['PIF_PORT'] ?? '31415'}/pif',
          ),
      _fixedToken = token,
      _tokenSource = tokenResolver {
    _token = _fixedToken ?? _resolveToken();
  }
  final Uri uri;
  final String? _fixedToken;
  final String? Function()? _tokenSource;
  String? _token;

  /// Per-launch hub token: env first, then the token file the hub drops
  /// next to its state for clients the supervisor did not launch.
  String? _resolveToken() {
    final fromSource = _tokenSource?.call();
    if (fromSource != null && fromSource.isNotEmpty) return fromSource;
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
  /// Hub rejections (shell/error envelopes) correlated by the id of the
  /// request envelope that caused them; uncorrelated errors surface with
  /// a null request id.
  final _errors = StreamController<PifRequestError>.broadcast();
  WebSocket? _socket;
  Timer? _retry;
  int _attempt = 0;
  bool _disposed = false;
  Future<void>? _connecting;
  final List<String> _pending = [];
  static const int _maxPending = 200;

  Stream<PifEnvelope> get events => _events.stream;
  Stream<bool> get connection => _connection.stream;
  Stream<PifRequestError> get errors => _errors.stream;
  bool get connected => _socket != null;
  Stream<PifEnvelope> channel(String prefix) =>
      events.where((event) => event.channel.startsWith(prefix));

  Future<void> connect() {
    if (_disposed || _socket != null) return Future.value();
    // Memoize so concurrent callers share one connection attempt instead
    // of racing WebSocket.connect and leaking a socket.
    return _connecting ??= _connect().whenComplete(() => _connecting = null);
  }

  Future<void> _connect() async {
    try {
      // Re-resolve the token each attempt: a launch can outlive the hub
      // that minted its token, and the token file is the recovery path.
      if (_fixedToken == null) _token = _resolveToken();
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
      _flushPending();
    } catch (_) {
      _scheduleReconnect();
    }
  }

  void _flushPending() {
    if (_pending.isEmpty) return;
    final queued = List.of(_pending);
    _pending.clear();
    for (final raw in queued) {
      _socket?.add(raw);
    }
  }

  void _receive(dynamic raw) {
    try {
      final decoded = jsonDecode(raw as String) as Map<String, dynamic>;
      final envelope = PifEnvelope.fromJson(decoded);
      if (envelope.channel == 'shell/error') {
        _errors.add(
          PifRequestError(
            kind: envelope.type,
            message: _errorMessage(envelope.payload),
            requestId:
                (envelope.payload as Map?)?['requestId'] as String?,
          ),
        );
      }
      _events.add(envelope);
    } catch (error, stack) {
      _events.addError(error, stack);
    }
  }

  static String _errorMessage(Object? payload) {
    if (payload is Map && payload['error'] is String) {
      return payload['error'] as String;
    }
    return 'hub request failed';
  }

  void _disconnected() {
    if (_socket == null || _disposed) return;
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
    final raw = jsonEncode(envelope.toJson());
    _sentRequestIds.add(envelope.id);
    if (_sentRequestIds.length > 200) _sentRequestIds.removeFirst();
    final socket = _socket;
    if (socket != null) {
      socket.add(raw);
    } else {
      _enqueue(raw);
    }
  }

  /// Ids of recently sent request envelopes, bounded, so shell/error
  /// payloads can be correlated back to what the user asked for.
  final ListQueue<String> _sentRequestIds = ListQueue();

  /// Envelopes sent while disconnected are queued and flushed in order on
  /// reconnect, so user input typed during a hub restart is never lost
  /// silently. Overflow drops the oldest and surfaces an error.
  void _enqueue(String raw) {
    if (_disposed) return;
    if (_pending.length >= _maxPending) {
      _pending.removeAt(0);
      _events.addError(
        StateError('pif bus queue overflow: $_maxPending pending envelopes, oldest dropped'),
      );
    }
    _pending.add(raw);
  }

  Future<void> dispose() async {
    _disposed = true;
    _retry?.cancel();
    final socket = _socket;
    _socket = null;
    await socket?.close();
    await _events.close();
    await _connection.close();
    await _errors.close();
  }
}
