import 'dart:async';
import 'dart:ui' show AppExitResponse;
import 'package:flutter/material.dart';
import 'core/bus.dart';
import 'core/docking_shell.dart';
import 'core/pi_launcher.dart';
import 'core/project_picker.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const PifApp());
}

/// Root widget that manages the standalone app lifecycle:
/// project picker → spawn pi → connect to hub → show shell.
///
/// The app owns the pi session: a watchdog restarts it when the hub does
/// not deliver state or the connection drops, rather than requiring the
/// user to clean up manually.
class PifApp extends StatefulWidget {
  const PifApp({super.key});
  @override
  State<PifApp> createState() => _PifAppState();
}

class _PifAppState extends State<PifApp> with WidgetsBindingObserver {
  PiLauncher? _launcher;
  PifBus? _bus;
  String? _workspace;
  String? _adoptedWorkspace;
  StreamSubscription<PifEnvelope>? _busEvents;
  StreamSubscription<bool>? _connectionEvents;
  Timer? _watchdog;
  bool _snapshotSeen = false;
  int _recoverAttempts = 0;
  static const int _maxRecoverAttempts = 3;
  static const Duration _watchdogTimeout = Duration(seconds: 12);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _checkExistingHub();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _cleanup();
    super.dispose();
  }

  @override
  Future<AppExitResponse> didRequestAppExit() async {
    await _cleanup();
    return AppExitResponse.exit;
  }

  /// If a hub is already running (e.g. from a terminal pi session),
  /// connect to it directly without showing the project picker. Only a
  /// hub that proves possession of this workspace's token is adopted —
  /// a foreign listener on the port is left alone entirely.
  Future<void> _checkExistingHub() async {
    if ((await PiLauncher.probeHub()) != HubProbe.ours) return;
    final bus = PifBus();
    _bus = bus;
    _watchBus(bus);
    await bus.connect();
    if (mounted) setState(() {});
    _armWatchdog();
  }

  /// Called when the user selects a project in the picker.
  /// Throws on failure — the picker catches and displays the error.
  Future<void> _launchProject(String workspace) async {
    _workspace = workspace;
    await _startPiSession();
  }

  Future<void> _startPiSession() async {
    final workspace = _workspace;
    if (workspace == null) return;
    _launcher = PiLauncher();
    await _launcher!.start(workspace: workspace);
    final ready = await PiLauncher.waitForHub(port: _launcher!.port);
    if (!ready) {
      await _cleanup();
      return _recover('hub did not start within 20 seconds');
    }
    // The token file is the designed recovery path when an orphaned hub
    // from a previous launch still holds the requested port and answers
    // with its own token — resolve fresh instead of caching the minted
    // one so upgrades never 401 against a hub we cannot restart.
    final bus = PifBus(
      tokenResolver: () => PiLauncher.resolveWorkspaceToken(workspace),
    );
    _bus = bus;
    _watchBus(bus);
    await bus.connect();
    if (mounted) setState(() {});
    _armWatchdog();
  }

  void _watchBus(PifBus bus) {
    _busEvents?.cancel();
    _snapshotSeen = false;
    _busEvents = bus.events.listen((event) {
      if (event.type == 'snapshot') {
        _snapshotSeen = true;
        _recoverAttempts = 0;
        _watchdog?.cancel();
        final health = (event.payload as Map?)?['health'] as Map?;
        if (health?['origin'] == 'standalone') {
          _adoptedWorkspace = health?['workspace'] as String?;
        }
        if (mounted) setState(() {});
      }
    }, onError: (_) {});
    // The hub can die long after startup: re-arm on every disconnect so
    // recovery stays armed for the whole session, not just launch.
    _connectionEvents?.cancel();
    _connectionEvents = bus.connection.listen((connected) {
      if (connected) return;
      _snapshotSeen = false;
      if (_launcher != null || _adoptedWorkspace != null) _armWatchdog();
    });
  }

  /// The pi session is unhealthy if we are connected but no snapshot has
  /// arrived (state never delivered), or if the connection itself dropped.
  void _armWatchdog() {
    _watchdog?.cancel();
    _watchdog = Timer(_watchdogTimeout, () {
      final connected = _bus?.connected ?? false;
      if (connected && _snapshotSeen) return;
      _recover(
        connected
            ? 'hub did not deliver state'
            : 'hub connection lost',
      );
    });
  }

  Future<void> _recover(String reason) async {
    if (!mounted) return;
    if (_recoverAttempts >= _maxRecoverAttempts) {
      debugPrint('pif: giving up after $_recoverAttempts recovery attempts ($reason)');
      await _cleanup();
      if (mounted) setState(() {}); // back to the project picker
      return;
    }
    _recoverAttempts++;
    debugPrint(
      'pif: restarting pi session — $reason '
      '(attempt $_recoverAttempts/$_maxRecoverAttempts)',
    );
    await _cleanup();
    if (!mounted) return;
    await _startPiSession();
  }

  Future<void> _cleanup() async {
    _watchdog?.cancel();
    _watchdog = null;
    await _busEvents?.cancel();
    _busEvents = null;
    await _connectionEvents?.cancel();
    _connectionEvents = null;
    // An adopted standalone hub (we connected, never spawned) is asked to
    // stop itself over the authenticated bus so it does not leak as an
    // orphan holding the port. Terminal-origin hubs are never touched.
    if (_launcher == null && _adoptedWorkspace != null) {
      _bus?.send('shell/state', 'shutdown_request', const {});
      await Future<void>.delayed(const Duration(milliseconds: 150));
    }
    await _bus?.dispose();
    _bus = null;
    _adoptedWorkspace = null;
    _snapshotSeen = false;
    await _launcher?.stop();
    _launcher = null;
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'pif',
      theme: ThemeData.dark(useMaterial3: true).copyWith(
        scaffoldBackgroundColor: const Color(0xff0e1117),
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xff78dba9),
          brightness: Brightness.dark,
        ),
        dividerColor: const Color(0xff2c3547),
      ),
      home: _bus != null
          ? DockingShell(bus: _bus!, workspace: _workspace)
          : ProjectPicker(onLaunch: _launchProject),
    );
  }
}
