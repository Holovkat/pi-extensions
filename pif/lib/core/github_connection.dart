import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

/// Safe connection metadata only. A saved token is never returned by native code.
class GithubConnectionState {
  const GithubConnectionState({
    this.saved = false,
    this.validated = false,
    this.account,
    this.code = 'environment_required',
    this.message = 'Select or create a local environment to connect GitHub.',
    this.creationCapability = 'unknown',
    this.canCreateRepository = false,
    this.canCreatePrivateRepository = false,
    this.needsAuthorization = false,
  });

  final bool saved;
  final bool validated;
  final String? account;
  final String code;
  final String message;
  final String creationCapability;
  final bool canCreateRepository;
  final bool canCreatePrivateRepository;

  /// Keychain access may require an explicit OS prompt. This does not assert
  /// that a token exists when background secure storage could not be read.
  final bool needsAuthorization;

  factory GithubConnectionState.fromMap(Map<String, dynamic> value) =>
      GithubConnectionState(
        saved: value['saved'] == true,
        validated: value['validated'] == true,
        account: value['account'] is String && value['account'] != ''
            ? value['account'] as String
            : null,
        code: value['code'] as String? ?? 'unavailable',
        message:
            value['message'] as String? ?? 'GitHub connection is unavailable.',
        creationCapability: value['creationCapability'] as String? ?? 'unknown',
        canCreateRepository: value['canCreateRepository'] == true,
        canCreatePrivateRepository: value['canCreatePrivateRepository'] == true,
        needsAuthorization: value['needsAuthorization'] == true,
      );
}

/// Environment-bound native Keychain and trusted gh adapter. The UI passes a
/// transient token only to saveAndValidate, and must clear its input afterward.
/// Never serialize this service or route credential methods through PifBus.
class GithubConnectionService extends ChangeNotifier {
  GithubConnectionService({MethodChannel? channel})
    : _channel = channel ?? const MethodChannel('pif/github');

  final MethodChannel _channel;
  String? _environmentId;
  String? _workspace;
  GithubConnectionState _state = const GithubConnectionState();
  bool _busy = false;
  bool _disposed = false;
  int _revision = 0;
  int _validationRevision = 0;
  HttpServer? _bridge;
  String? _socketPath;

  String? get environmentId => _environmentId;
  String? get workspace => _workspace;
  GithubConnectionState get state => _state;
  bool get busy => _busy;

  /// Revalidation can change repository access without changing the account.
  /// Consumers must refresh access after every successful credential check.
  int get validationRevision => _validationRevision;

  Future<void> selectEnvironment({
    required String environmentId,
    required String workspace,
  }) async {
    final revision = ++_revision;
    _environmentId = environmentId.toLowerCase();
    _workspace = workspace;
    _state = const GithubConnectionState();
    _busy = true;
    _notify();
    await _closeBridge();
    if (_disposed || revision != _revision) return;
    final value = await _invoke('selectEnvironment');
    if (_disposed || revision != _revision) return;
    _state = GithubConnectionState.fromMap(value);
    _busy = false;
    _notify();
  }

  Future<void> saveAndValidate(String token) =>
      _update('saveAndValidate', {'token': token});

  /// Explicit Settings action: macOS may request Keychain authorization.
  Future<void> validate() => _update('validate');

  /// Explicit Settings action: macOS may request Keychain authorization.
  Future<void> remove() => _update('remove');

  Future<void> _update(String method, [Map<String, Object?>? arguments]) async {
    if (_busy || _disposed || _environmentId == null) return;
    final revision = _revision;
    _busy = true;
    _notify();
    final result = await _invoke(method, arguments);
    if (_disposed || revision != _revision) return;
    _state = GithubConnectionState.fromMap(result);
    if ((method == 'validate' || method == 'saveAndValidate') &&
        result['ok'] == true &&
        _state.validated) {
      _validationRevision++;
    }
    _busy = false;
    _notify();
  }

  /// Used directly by explicit repository onboarding. The native allowlist is
  /// authoritative; this is not a general command runner or secret-read API.
  Future<Map<String, dynamic>> run(List<String> args, {String? input}) async {
    if (_disposed || _environmentId == null)
      return _failure('environment_required');
    final revision = _revision;
    final result = await _invoke('run', {'args': args, 'input': input});
    if (_disposed || revision != _revision)
      return _failure('environment_changed');
    if (result['code'] == 'invalid_token' ||
        result['code'] == 'missing_token' ||
        result['needsAuthorization'] == true) {
      _state = GithubConnectionState(
        saved:
            result['code'] == 'invalid_token' ||
            (result['code'] != 'missing_token' && _state.saved),
        code: result['code'] as String,
        account: _state.account,
        needsAuthorization: result['needsAuthorization'] == true,
        message:
            result['message'] as String? ??
            'Validate your GitHub token in Settings.',
      );
      _notify();
    }
    return result;
  }

  Future<Map<String, dynamic>> _invoke(
    String method, [
    Map<String, Object?>? arguments,
  ]) async {
    try {
      final value = await _channel.invokeMapMethod<String, dynamic>(method, {
        'environmentId': _environmentId,
        'workspace': _workspace,
        ...?arguments,
      });
      return value ?? _failure('unavailable');
    } on MissingPluginException {
      return _failure('native_unavailable');
    } on PlatformException {
      // Native exception details may contain platform or input data. Only the
      // broker's intentional result dictionaries are suitable for display.
      return _failure('unavailable');
    } catch (_) {
      return _failure('unavailable');
    }
  }

  static Map<String, dynamic> _failure(String code) {
    final message = switch (code) {
      'environment_required' => 'Select or create a local environment first.',
      'environment_changed' => 'The selected environment changed. Try again.',
      'native_unavailable' =>
        'Native GitHub secure storage is unavailable in this runtime.',
      'unsupported_operation' =>
        'This GitHub operation is not available through the tracker connection.',
      _ => 'GitHub connection is unavailable. Try again.',
    };
    return {
      'ok': false,
      'status': 1,
      'stdout': '',
      'stderr': message,
      'code': code,
      'message': message,
    };
  }

  /// User-only Unix socket for the existing hub's tracker adapter. Its request
  /// scope is pinned to this selected UUID + canonical path. This is operational
  /// isolation, not a security sandbox against arbitrary code run by the user.
  /// The socket carries issue data and safe results, never a GitHub token.
  Future<void> startBridge() async {
    if (_bridge != null) return;
    final workspace = _workspace;
    final id = _environmentId;
    final revision = _revision;
    if (_disposed || workspace == null || id == null) {
      throw StateError('Select a local environment before starting GitHub.');
    }
    final path = '$workspace/.pi/pif/github.sock';
    final parent = Directory('$workspace/.pi/pif');
    if (parent.resolveSymbolicLinksSync() != parent.path) {
      throw StateError(
        'The local GitHub connection directory must stay inside this environment.',
      );
    }
    // Unix-domain socket paths have a small platform limit. Fail explicitly;
    // do not silently fall back to an unauthenticated network listener.
    if (utf8.encode(path).length >= 104) {
      throw StateError(
        'This environment path is too long for the local GitHub connection. Use a shorter folder path.',
      );
    }
    final entity = FileSystemEntity.typeSync(path, followLinks: false);
    if (entity != FileSystemEntityType.notFound) {
      if (entity != FileSystemEntityType.unixDomainSock) {
        throw StateError(
          'The GitHub connection path is occupied by another file.',
        );
      }
      Socket? existing;
      try {
        existing = await Socket.connect(
          InternetAddress(path, type: InternetAddressType.unix),
          0,
          timeout: const Duration(milliseconds: 500),
        );
      } on SocketException catch (error) {
        // Only remove a stale socket, never a user file or live listener.
        // A busy live listener or a permission error is not a stale socket.
        if (error.osError?.errorCode != 61 && error.osError?.errorCode != 2) {
          rethrow;
        }
        if (FileSystemEntity.typeSync(path, followLinks: false) ==
            FileSystemEntityType.unixDomainSock) {
          File(path).deleteSync();
        }
      } finally {
        existing?.destroy();
      }
      if (existing != null)
        throw StateError(
          'This environment already has an active GitHub connection.',
        );
    }
    if (_disposed || revision != _revision) return;
    final server = await HttpServer.bind(
      InternetAddress(path, type: InternetAddressType.unix),
      0,
      shared: false,
    );
    final permissions = await Process.run('/bin/chmod', [
      '600',
      path,
    ], includeParentEnvironment: false);
    if (permissions.exitCode != 0 || _disposed || revision != _revision) {
      await server.close(force: true);
      if (FileSystemEntity.typeSync(path, followLinks: false) ==
          FileSystemEntityType.unixDomainSock)
        File(path).deleteSync();
      throw StateError('The local GitHub connection could not be protected.');
    }
    _bridge = server;
    _socketPath = path;
    server.listen((request) async {
      Map<String, dynamic> result = _failure('unsupported_operation');
      try {
        if (_disposed || revision != _revision) {
          result = _failure('environment_changed');
        } else if (request.method == 'POST' && request.uri.path == '/github') {
          final bytes = <int>[];
          await for (final chunk in request.timeout(
            const Duration(seconds: 5),
          )) {
            if (bytes.length + chunk.length > 128 * 1024)
              throw const FormatException('Too large');
            bytes.addAll(chunk);
          }
          final body = jsonDecode(utf8.decode(bytes));
          if (body is Map<String, dynamic> &&
              body['environmentId'] == id &&
              body['workspace'] == workspace &&
              body['args'] is List) {
            final args = (body['args'] as List).cast<String>();
            if (_bridgeOperationAllowed(args)) {
              result = await run(args, input: body['input'] as String?);
            }
          }
        }
      } catch (_) {
        result = _failure('unsupported_operation');
      }
      try {
        request.response.headers.contentType = ContentType.json;
        request.response.headers.set('Cache-Control', 'no-store');
        request.response.write(jsonEncode(result));
        await request.response.close();
      } catch (_) {
        /* Disconnected hub: never log request or credential data. */
      }
    });
  }

  static bool _bridgeOperationAllowed(List<String> args) {
    if (args.length < 2) return false;
    if (args.first == 'issue') return true; // Native validates every argument.
    if (args.first != 'api') return false;
    var method = 'GET';
    String? endpoint;
    for (var i = 1; i < args.length; i++) {
      final value = args[i];
      if (value == '--method' || value == '-X') {
        if (++i >= args.length) return false;
        method = args[i];
      } else if (value == '--hostname' || value == '--input') {
        if (++i >= args.length) return false;
      } else if (value != '--include') {
        if (endpoint != null) return false;
        endpoint = value.startsWith('/') ? value.substring(1) : value;
      }
    }
    // Repository creation is available only from explicit native UI actions.
    return method == 'GET' ||
        (method == 'POST' &&
            endpoint != null &&
            (RegExp(r'^repos/[^/]+/[^/]+/labels$').hasMatch(endpoint) ||
                RegExp(
                  r'^repos/[^/]+/[^/]+/issues/[1-9][0-9]*/sub_issues$',
                ).hasMatch(endpoint)));
  }

  Future<void> _closeBridge() async {
    final bridge = _bridge;
    final path = _socketPath;
    _bridge = null;
    _socketPath = null;
    await bridge?.close(force: true);
    if (path != null &&
        FileSystemEntity.typeSync(path, followLinks: false) ==
            FileSystemEntityType.unixDomainSock) {
      File(path).deleteSync();
    }
  }

  /// Closes only this service's listener. An adopted hub/preview may have a
  /// different owner and must never have its socket removed by this instance.
  Future<void> stopBridge() => _closeBridge();

  void reportBridgeUnavailable(String message) {
    _state = GithubConnectionState(
      saved: _state.saved,
      account: _state.account,
      code: 'bridge_unavailable',
      message: message,
      creationCapability: _state.creationCapability,
    );
    _notify();
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    ++_revision;
    unawaited(_closeBridge());
    super.dispose();
  }
}

class GithubConnectionScope extends InheritedWidget {
  const GithubConnectionScope({
    super.key,
    required this.service,
    this.onConnectRepository,
    required super.child,
  });
  final GithubConnectionService service;
  final Future<void> Function()? onConnectRepository;

  static GithubConnectionService? maybeOf(BuildContext context) => context
      .dependOnInheritedWidgetOfExactType<GithubConnectionScope>()
      ?.service;

  static Future<void> Function()? connectRepositoryOf(BuildContext context) =>
      context
          .dependOnInheritedWidgetOfExactType<GithubConnectionScope>()
          ?.onConnectRepository;

  @override
  bool updateShouldNotify(GithubConnectionScope oldWidget) =>
      service != oldWidget.service ||
      onConnectRepository != oldWidget.onConnectRepository;
}
