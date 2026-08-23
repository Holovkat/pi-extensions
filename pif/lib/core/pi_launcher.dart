import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';

/// Probe verdicts for a listener on the hub port.
enum HubProbe {
  /// Nothing answered — port is free or the listener is not an HTTP hub.
  absent,

  /// A pif hub answered but could not prove it holds our token (or we
  /// have no token to verify against) — never hand credentials to it.
  foreign,

  /// A pif hub answered and proved possession of the hub token.
  ours,
}

/// Manages the pi subprocess for standalone app mode.
///
/// In standalone mode, the Flutter app spawns pi with the pif extension
/// loaded. The extension auto-starts the hub (WS server) without the
/// FlutterSupervisor, and the app connects to it via WebSocket.
class PiLauncher {
  Process? _process;
  String? _workspace;
  String? _token;
  int? _port;
  final int requestedPort;

  PiLauncher({this.requestedPort = 31415});

  String? get token => _token;

  /// The port this launch actually uses: the default when free, otherwise
  /// a random ephemeral port so an occupied 31415 (orphan hub, squatter)
  /// cannot break or hijack the launch.
  int get port => _port ?? requestedPort;

  /// Per-launch hub token. The app generates it, passes it to pi via
  /// PIF_TOKEN, and connects with it — so no unauthenticated client on
  /// the machine can reach the hub's snapshot or controls.
  static String _generateToken() {
    final random = math.Random.secure();
    return List.generate(
      32,
      (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0'),
    ).join();
  }

  /// Find the Resources directory inside a packaged .app bundle.
  /// Returns null when running from source (dev mode).
  static String? _resourcesDir() {
    final exe = File(Platform.resolvedExecutable);
    // exe is at .app/Contents/MacOS/<binary>
    // Resources is at .app/Contents/Resources
    final resources = '${exe.parent.parent.path}/Resources';
    return Directory(resources).existsSync() ? resources : null;
  }

  /// Find the Node.js binary to use.
  static String _findNode() {
    final res = _resourcesDir();
    if (res != null) {
      final bundled = '$res/pi/node';
      if (File(bundled).existsSync()) return bundled;
    }
    return 'node';
  }

  /// Find the pi CLI entry point (cli.js).
  /// Returns empty string if pi should be invoked via PATH.
  static String _findPiCli() {
    final res = _resourcesDir();
    if (res != null) {
      final bundled = '$res/pi/cli/dist/cli.js';
      if (File(bundled).existsSync()) return bundled;
    }
    return '';
  }

  /// Find the pif extension to load.
  static String _findExtension() {
    final res = _resourcesDir();
    if (res != null) {
      final bundled = '$res/pi/extensions/pif.ts';
      if (File(bundled).existsSync()) return bundled;
    }
    // Dev mode — relative to repo root
    final devExt = '${Directory.current.path}/extensions/pif.ts';
    if (File(devExt).existsSync()) return devExt;
    // Installed globally via install-pif.sh
    final homeExt = '${Platform.environment['HOME']}/.pi/agent/extensions/pif.ts';
    if (File(homeExt).existsSync()) return homeExt;
    return 'extensions/pif.ts';
  }

  /// Find the Flutter app source directory (for widget scanning).
  static String _findAppDir() {
    final res = _resourcesDir();
    if (res != null) {
      final bundled = '$res/app';
      if (Directory('$bundled/lib').existsSync()) return bundled;
    }
    // Dev mode
    final devApp = '${Directory.current.path}/pif';
    if (Directory('$devApp/lib').existsSync()) return devApp;
    // Installed globally
    final globalApp = '${Platform.environment['HOME']}/.pi/pif/app';
    if (Directory('$globalApp/lib').existsSync()) return globalApp;
    return 'pif';
  }

  /// Whether an actual pif hub is answering on the given port, and if so
  /// whether it can prove it is *ours*. The hub answers GET /probe by
  /// HMAC-ing our nonce under the shared hub token; a port squatter that
  /// merely echoes `"name":"pif"` cannot produce that proof, so it is
  /// reported as running-but-foreign instead of trusted.
  static Future<HubProbe> probeHub({int port = 31415}) async {
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 2);
    try {
      final nonce = _generateToken();
      final request = await client
          .getUrl(Uri.parse('http://127.0.0.1:$port/probe?nonce=$nonce'));
      final response = await request.close();
      if (response.statusCode != 200) return HubProbe.absent;
      final body = await response.transform(utf8.decoder).join();
      if (!body.contains('"name":"pif"')) return HubProbe.absent;
      Object? proof;
      try {
        proof = (jsonDecode(body) as Map)['proof'];
      } catch (_) {
        return HubProbe.absent;
      }
      // Without a token we cannot verify identity — treat any answering
      // hub as foreign so callers never hand credentials to an unknown
      // listener.
      final token = PiLauncher._resolveHubToken();
      if (token == null) return HubProbe.foreign;
      final expected = hmacSha256HexString(
        Uint8List.fromList(utf8.encode(token)),
        Uint8List.fromList(utf8.encode(nonce)),
      );
      return proof == expected ? HubProbe.ours : HubProbe.foreign;
    } catch (_) {
      return HubProbe.absent;
    } finally {
      client.close();
    }
  }

  /// Legacy boolean check used where identity does not matter.
  static Future<bool> isHubRunning({int port = 31415}) async =>
      (await probeHub(port: port)) != HubProbe.absent;

  /// Token for the workspace we are about to launch into: env first,
  /// then the token file the hub drops next to its state.
  static String? _resolveHubToken() => resolveWorkspaceToken(
    Platform.environment['PIF_WORKSPACE'] ?? Directory.current.path,
  );

  /// Re-readable per-workspace hub token — the designed recovery path for
  /// clients whose launch outlived the hub that minted its token.
  static String? resolveWorkspaceToken(String workspace) {
    final env = Platform.environment['PIF_TOKEN'];
    if (env != null && env.isNotEmpty) return env;
    try {
      final token = File('$workspace/.pi/pif/token').readAsStringSync().trim();
      if (token.isNotEmpty) return token;
    } catch (_) {}
    return null;
  }

  /// Poll the port until a hub responds or the timeout expires.
  static Future<bool> waitForHub({
    int? port,
    Duration timeout = const Duration(seconds: 30),
  }) async {
    port ??= Platform.environment['PIF_PORT'] != null
        ? int.tryParse(Platform.environment['PIF_PORT']!)
        : null;
    port ??= 31415;
    final deadline = DateTime.now().add(timeout);
    while (DateTime.now().isBefore(deadline)) {
      if (await isHubRunning(port: port)) return true;
      await Future.delayed(const Duration(milliseconds: 200));
    }
    return false;
  }

  /// Spawn pi with the pif extension in standalone mode.
  Future<void> start({required String workspace}) async {
    _workspace = workspace;
    _token = _generateToken();
    // Claim the requested port if free; otherwise fall back to a random
    // port so a foreign listener can neither block the launch nor answer
    // the readiness probe and harvest our token.
    _port = await _pickPort();

    final nodeBin = _findNode();
    final piCli = _findPiCli();
    final extension = _findExtension();
    final appDir = _findAppDir();
    final hostSessionFile = '$workspace/.pi/pif/sessions/host.jsonl';
    final hostSession = File(hostSessionFile);
    hostSession.parent.createSync(recursive: true);
    hostSession.writeAsStringSync('', mode: FileMode.append);
    final sessionArgs = ['--session', hostSessionFile];

    // Build the command: either "node cli.js --mode rpc -e ext" or "pi --mode rpc -e ext"
    // --mode rpc is required so pi doesn't exit when stdin isn't a TTY.
    // The Flutter app keeps stdin open (Process.start pipes) so pi stays alive.
    final List<String> cmd;
    if (piCli.isNotEmpty) {
      cmd = [nodeBin, piCli, '--mode', 'rpc', '-e', extension, ...sessionArgs];
    } else {
      cmd = ['pi', '--mode', 'rpc', '-e', extension, ...sessionArgs];
    }

    final env = {
      ...Platform.environment,
      'PIF_AUTOSTART': '1',
      'PIF_NO_FLUTTER': '1',
      'PIF_PORT': port.toString(),
      'PIF_WORKSPACE': workspace,
      'PIF_APP_DIR': appDir,
      'PIF_TOKEN': _token!,
      'PIF_HOST_SESSION_FILE': hostSessionFile,
    };

    _process = await Process.start(
      cmd.first,
      cmd.skip(1).toList(),
      workingDirectory: workspace,
      environment: env,
    );

    // Capture output for debugging
    _process!.stdout.listen(
      (data) => stderr.write('[pi] ${utf8.decode(data)}'),
    );
    _process!.stderr.listen(
      (data) => stderr.write('[pi:err] ${utf8.decode(data)}'),
    );
  }

  /// Pick this launch's port: the requested one when nothing answers on
  /// it, else a random free port.
  Future<int> _pickPort() async {
    if (!(await isHubRunning(port: requestedPort))) return requestedPort;
    final server = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
    final port = server.port;
    await server.close();
    return port;
  }

  /// Gracefully stop the pi process.
  Future<void> stop() async {
    if (_process == null) return;
    _process!.kill(ProcessSignal.sigterm);
    try {
      await _process!.exitCode.timeout(
        const Duration(seconds: 5),
        onTimeout: () {
          _process!.kill(ProcessSignal.sigkill);
          return -1;
        },
      );
    } catch (_) {}
    _process = null;
  }

  bool get isRunning => _process != null;
  String? get workspace => _workspace;
}

/// HMAC-SHA256 (RFC 2104) over SHA-256 (FIPS 180-4), dependency-free —
/// used only for the hub identity probe.
Uint8List hmacSha256Hex(Uint8List key, Uint8List message) {
  var keyBytes = key;
  if (keyBytes.length > 64) keyBytes = sha256(keyBytes);
  final block = Uint8List(64)..setAll(0, keyBytes);
  final inner = Uint8List(64), outer = Uint8List(64);
  for (var i = 0; i < 64; i++) {
    inner[i] = block[i] ^ 0x36;
    outer[i] = block[i] ^ 0x5c;
  }
  final innerInput = Uint8List(64 + message.length)
    ..setAll(0, inner)
    ..setAll(64, message);
  final innerHash = sha256(innerInput);
  final outerInput = Uint8List(96)
    ..setAll(0, outer)
    ..setAll(64, innerHash);
  return sha256(outerInput);
}

String hmacSha256HexString(Uint8List key, Uint8List message) =>
    hmacSha256Hex(key, message)
        .map((b) => b.toRadixString(16).padLeft(2, '0'))
        .join();

const List<int> _sha256K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

Uint8List sha256(Uint8List data) {
  final bitLength = data.length * 8;
  final padded = Uint8List(
    ((data.length + 8) ~/ 64 + 1) * 64,
  )..setAll(0, data);
  padded[data.length] = 0x80;
  final hi = bitLength ~/ 0x100000000, lo = bitLength & 0xffffffff;
  ByteData.view(padded.buffer).setUint32(padded.length - 8, hi);
  ByteData.view(padded.buffer).setUint32(padded.length - 4, lo);

  var h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  var h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  final w = Uint32List(64);
  for (var chunk = 0; chunk < padded.length; chunk += 64) {
    final bd = ByteData.sublistView(padded, chunk, chunk + 64);
    for (var i = 0; i < 16; i++) {
      w[i] = bd.getUint32(i * 4);
    }
    for (var i = 16; i < 64; i++) {
      final s0 = _rotr(w[i - 15], 7) ^ _rotr(w[i - 15], 18) ^ (w[i - 15] >> 3);
      final s1 = _rotr(w[i - 2], 17) ^ _rotr(w[i - 2], 19) ^ (w[i - 2] >> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) & 0xffffffff;
    }
    var a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (var i = 0; i < 64; i++) {
      final s1 = _rotr(e, 6) ^ _rotr(e, 11) ^ _rotr(e, 25);
      final ch = (e & f) ^ (~e & g);
      final temp1 = (h + s1 + ch + _sha256K[i] + w[i]) & 0xffffffff;
      final s0 = _rotr(a, 2) ^ _rotr(a, 13) ^ _rotr(a, 22);
      final maj = (a & b) ^ (a & c) ^ (b & c);
      final temp2 = (s0 + maj) & 0xffffffff;
      h = g; g = f; f = e; e = (d + temp1) & 0xffffffff;
      d = c; c = b; b = a; a = (temp1 + temp2) & 0xffffffff;
    }
    h0 = (h0 + a) & 0xffffffff; h1 = (h1 + b) & 0xffffffff;
    h2 = (h2 + c) & 0xffffffff; h3 = (h3 + d) & 0xffffffff;
    h4 = (h4 + e) & 0xffffffff; h5 = (h5 + f) & 0xffffffff;
    h6 = (h6 + g) & 0xffffffff; h7 = (h7 + h) & 0xffffffff;
  }
  final out = Uint8List(32);
  ByteData.view(out.buffer)
    ..setUint32(0, h0)..setUint32(4, h1)..setUint32(8, h2)
    ..setUint32(12, h3)..setUint32(16, h4)..setUint32(20, h5)
    ..setUint32(24, h6)..setUint32(28, h7);
  return out;
}

int _rotr(int value, int bits) =>
    ((value >> bits) | (value << (32 - bits))) & 0xffffffff;
