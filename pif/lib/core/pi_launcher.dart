import 'dart:async';
import 'dart:convert';
import 'dart:io';

/// Manages the pi subprocess for standalone app mode.
///
/// In standalone mode, the Flutter app spawns pi with the pif extension
/// loaded. The extension auto-starts the hub (WS server) without the
/// FlutterSupervisor, and the app connects to it via WebSocket.
class PiLauncher {
  Process? _process;
  String? _workspace;
  final int port;

  PiLauncher({this.port = 31415});

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

  /// Quick check whether a hub is already listening on the given port.
  static Future<bool> isHubRunning({int port = 31415}) async {
    try {
      final socket = await Socket.connect('127.0.0.1', port);
      socket.destroy();
      return true;
    } catch (_) {
      return false;
    }
  }

  /// Poll the port until a hub responds or the timeout expires.
  static Future<bool> waitForHub({
    int port = 31415,
    Duration timeout = const Duration(seconds: 30),
  }) async {
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

    final nodeBin = _findNode();
    final piCli = _findPiCli();
    final extension = _findExtension();
    final appDir = _findAppDir();

    // Build the command: either "node cli.js --mode rpc -e ext" or "pi --mode rpc -e ext"
    // --mode rpc is required so pi doesn't exit when stdin isn't a TTY.
    // The Flutter app keeps stdin open (Process.start pipes) so pi stays alive.
    final List<String> cmd;
    if (piCli.isNotEmpty) {
      cmd = [nodeBin, piCli, '--mode', 'rpc', '-e', extension];
    } else {
      cmd = ['pi', '--mode', 'rpc', '-e', extension];
    }

    final env = {
      ...Platform.environment,
      'PIF_AUTOSTART': '1',
      'PIF_NO_FLUTTER': '1',
      'PIF_PORT': port.toString(),
      'PIF_WORKSPACE': workspace,
      'PIF_APP_DIR': appDir,
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
