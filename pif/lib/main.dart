import 'dart:async';
import 'dart:io' show Platform;
import 'dart:ui' show AppExitResponse;
import 'package:flutter/material.dart';
import 'core/appearance.dart';
import 'core/bus.dart';
import 'core/docking_shell.dart';
import 'core/development_environment.dart';
import 'core/github_connection.dart';
import 'core/pi_launcher.dart';
import 'core/plugin.dart';
import 'core/project_picker.dart';
import 'core/project_onboarding.dart';
import 'widgets/pif_settings/pif_settings.dart';

void main() {
  runPifApp();
}

void runPifApp({bool exportMode = false}) {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(PifApp(exportMode: exportMode));
}

/// Root widget that manages the standalone app lifecycle:
/// project picker → spawn pi → connect to hub → show shell.
///
/// The app owns the pi session: a watchdog restarts it when the hub does
/// not deliver state or the connection drops, rather than requiring the
/// user to clean up manually.
class PifApp extends StatefulWidget {
  const PifApp({super.key, this.exportMode = false});

  final bool exportMode;

  @override
  State<PifApp> createState() => _PifAppState();
}

class _PifAppState extends State<PifApp> with WidgetsBindingObserver {
  final _github = GithubConnectionService();
  final _environments = DevelopmentEnvironmentService();
  final _navigatorKey = GlobalKey<NavigatorState>();
  String? _githubStateKey;
  bool _onboardingInFlight = false;
  PifAppearanceService? _appearance;
  PiLauncher? _launcher;
  PifBus? _bus;
  String? _workspace;
  String? _adoptedWorkspace;
  StreamSubscription<PifEnvelope>? _busEvents;
  StreamSubscription<bool>? _connectionEvents;
  Timer? _watchdog;
  bool _snapshotSeen = false;
  int _recoverAttempts = 0;
  int _startupGeneration = 0;
  bool _startupInFlight = false;
  String? _startupError;
  static const int _maxRecoverAttempts = 3;
  static const Duration _watchdogTimeout = Duration(seconds: 12);

  @override
  void initState() {
    super.initState();
    _github.addListener(_githubChanged);
    if (!widget.exportMode) _appearance = PifAppearanceService();
    WidgetsBinding.instance.addObserver(this);
    if (widget.exportMode) {
      // Exported apps boot straight into their bundled workspace, skipping
      // the project picker and ambient-hub adoption path.
      final exportedWorkspace = Platform.environment['PIF_WORKSPACE'];
      if (exportedWorkspace != null && exportedWorkspace.isNotEmpty) {
        unawaited(_launchExportWorkspace(exportedWorkspace));
      } else {
        _startupError = 'missing PIF_WORKSPACE for exported app';
      }
    } else {
      _checkExistingHub();
    }
  }

  @override
  void dispose() {
    _appearance?.dispose();
    _github.dispose();
    WidgetsBinding.instance.removeObserver(this);
    _cleanup();
    super.dispose();
  }

  @override
  Future<AppExitResponse> didRequestAppExit() async {
    await _appearance?.flush();
    await _cleanup();
    return AppExitResponse.exit;
  }

  /// If a hub is already running (e.g. from a terminal pi session),
  /// connect to it directly without showing the project picker. Only a
  /// hub that proves possession of this workspace's token is adopted —
  /// a foreign listener on the port is left alone entirely.
  Future<void> _checkExistingHub() async {
    final generation = _startupGeneration;
    final port = _configuredPort();
    if ((await PiLauncher.probeHub(port: port)) != HubProbe.ours) return;
    if (!mounted || generation != _startupGeneration) return;
    final bus = PifBus(uri: Uri.parse('ws://127.0.0.1:$port/pif'));
    try {
      await bus.connect();
      if (!mounted || generation != _startupGeneration) {
        await bus.dispose();
        return;
      }
      _bus = bus;
      final inheritedWorkspace = Platform.environment['PIF_WORKSPACE'];
      if (inheritedWorkspace != null && inheritedWorkspace.isNotEmpty) {
        final identity = await EnvironmentIdentity.ensure(inheritedWorkspace);
        if (!mounted || generation != _startupGeneration) {
          if (_bus == bus) _bus = null;
          await bus.dispose();
          return;
        }
        _workspace = inheritedWorkspace;
        await _selectEnvironment(identity);
      }
      if (!_watchBus(bus, generation)) {
        if (_bus == bus) _bus = null;
        await bus.dispose();
        return;
      }
      bus.send('shell/state', 'snapshot_request', const {});
      if (mounted) setState(() {});
      _armWatchdog();
    } catch (error) {
      await bus.dispose();
      debugPrint('pif: failed to adopt existing hub: $error');
    }
  }

  /// Called when the user selects a project in the picker or when export
  /// mode seeds its bundled workspace.
  Future<void> _launchProject(String workspace) async {
    if (_startupInFlight) return;
    _startupGeneration++;
    _workspace = workspace;
    _startupInFlight = true;
    try {
      await _cleanup();
      if (!mounted) return;
      await _selectEnvironment(await EnvironmentIdentity.ensure(workspace));
      await _startPiSession();
    } finally {
      _startupInFlight = false;
      if (mounted) setState(() {});
    }
  }

  Future<void> _launchExportWorkspace(String workspace) async {
    if (_startupInFlight) return;
    _startupGeneration++;
    _workspace = workspace;
    _startupError = null;
    _startupInFlight = true;
    if (mounted) setState(() {});
    try {
      await _startPiSession();
      _startupError = null;
    } catch (error) {
      _startupError = error.toString();
      await _cleanup();
      if (mounted) setState(() {});
    } finally {
      _startupInFlight = false;
      if (mounted) setState(() {});
    }
  }

  Future<void> _startPiSession() async {
    final workspace = _workspace;
    if (workspace == null) return;
    final generation = _startupGeneration;
    final launcher = PiLauncher(requestedPort: _configuredPort());
    _launcher = launcher;
    PifBus? bus;
    try {
      final identity = await EnvironmentIdentity.ensure(workspace);
      if (_github.environmentId != identity.id ||
          _github.workspace != identity.workspacePath) {
        await _selectEnvironment(identity);
      }
      try {
        await _github.startBridge();
      } catch (error) {
        // Local authoring remains available if the optional tracker bridge
        // cannot start. Settings shows the actionable connection diagnostic.
        _github.reportBridgeUnavailable(
          error is StateError
              ? error.message.toString()
              : 'The local GitHub connection could not start. Check folder permissions and reopen this environment.',
        );
      }
      final development = widget.exportMode
          ? null
          : await _environments.inspect(identity);
      await launcher.start(
        workspace: workspace,
        development: development,
        launchPreview: development?.canBuild == true,
      );
      if (!mounted || _launcher != launcher) {
        await launcher.stop();
        return;
      }
      final ready = await PiLauncher.waitForHub(port: launcher.port);
      if (!mounted || _launcher != launcher) {
        await launcher.stop();
        return;
      }
      if (!ready) {
        throw StateError('hub did not start within 20 seconds');
      }
      // This launcher owns a fresh port and token. A sibling opening the same
      // folder may replace the recovery file, but cannot replace our identity.
      bus = PifBus(
        uri: Uri.parse('ws://127.0.0.1:${launcher.port}/pif'),
        tokenResolver: () =>
            launcher.token ?? PiLauncher.resolveWorkspaceToken(workspace),
      );
      await bus.connect();
      if (!mounted ||
          _launcher != launcher ||
          generation != _startupGeneration) {
        await bus.dispose();
        await launcher.stop();
        return;
      }
      _bus = bus;
      if (!_watchBus(bus, generation)) {
        if (_bus == bus) _bus = null;
        await bus.dispose();
        await launcher.stop();
        return;
      }
      bus.send('shell/state', 'snapshot_request', const {});
      _startupError = null;
      if (mounted) setState(() {});
      _armWatchdog();
    } catch (_) {
      if (bus != null) {
        await bus.dispose();
      }
      await _cleanup();
      rethrow;
    }
  }

  int _configuredPort() {
    final configuredPort = int.tryParse(Platform.environment['PIF_PORT'] ?? '');
    if (configuredPort != null &&
        configuredPort > 0 &&
        configuredPort < 65536) {
      return configuredPort;
    }
    return 31415;
  }

  bool _watchBus(PifBus bus, int generation) {
    if (!mounted || generation != _startupGeneration) return false;
    _busEvents?.cancel();
    _snapshotSeen = false;
    _busEvents = bus.events.listen((event) {
      if (!mounted || generation != _startupGeneration) return;
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
      if (!mounted || generation != _startupGeneration) return;
      if (connected) return;
      _snapshotSeen = false;
      if (_launcher != null || _adoptedWorkspace != null) _armWatchdog();
    });
    return true;
  }

  /// The pi session is unhealthy if we are connected but no snapshot has
  /// arrived (state never delivered), or if the connection itself dropped.
  void _armWatchdog() {
    _watchdog?.cancel();
    _watchdog = Timer(_watchdogTimeout, () {
      final connected = _bus?.connected ?? false;
      if (connected && _snapshotSeen) return;
      _recover(connected ? 'hub did not deliver state' : 'hub connection lost');
    });
  }

  Future<void> _recover(String reason) async {
    if (!mounted || _startupInFlight) return;
    _startupInFlight = true;
    var currentReason = reason;
    try {
      while (mounted) {
        _startupError = widget.exportMode ? currentReason : null;
        if (_recoverAttempts >= _maxRecoverAttempts) {
          debugPrint(
            'pif: giving up after $_recoverAttempts recovery attempts ($currentReason)',
          );
          await _cleanup();
          if (mounted) setState(() {}); // back to the picker or export surface
          return;
        }
        _recoverAttempts++;
        debugPrint(
          'pif: restarting pi session — $currentReason '
          '(attempt $_recoverAttempts/$_maxRecoverAttempts)',
        );
        await _cleanup();
        if (!mounted) return;
        setState(() {});
        try {
          await _startPiSession();
          _startupError = null;
          if (mounted) setState(() {});
          return;
        } catch (error) {
          currentReason = error.toString();
          if (widget.exportMode) {
            _startupError = currentReason;
            if (mounted) setState(() {});
          }
        }
      }
    } finally {
      _startupInFlight = false;
      if (mounted) setState(() {});
    }
  }

  Future<void> _retryExportStartup() async {
    final workspace = _workspace;
    if (workspace == null || _startupInFlight) return;
    _recoverAttempts = 0;
    _startupError = null;
    if (mounted) setState(() {});
    await _launchExportWorkspace(workspace);
  }

  Future<void> _cleanup() async {
    _watchdog?.cancel();
    _watchdog = null;
    await _busEvents?.cancel();
    _busEvents = null;
    await _connectionEvents?.cancel();
    _connectionEvents = null;
    await _bus?.dispose();
    _bus = null;
    _adoptedWorkspace = null;
    _snapshotSeen = false;
    await _launcher?.stop();
    _launcher = null;
    await _github.stopBridge();
  }

  Future<void> _selectEnvironment(EnvironmentIdentity identity) async {
    if (_github.environmentId == identity.id &&
        _github.workspace == identity.workspacePath)
      return;
    await _github.selectEnvironment(
      environmentId: identity.id,
      workspace: identity.workspacePath,
    );
  }

  Future<void> _openSettingsPage() async {
    final context = _navigatorKey.currentContext;
    if (context == null) return;
    await showDialog<void>(
      context: context,
      builder: (context) => Dialog(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 820, maxHeight: 720),
          child: Column(
            children: [
              Align(
                alignment: Alignment.centerRight,
                child: IconButton(
                  tooltip: 'Close Settings',
                  icon: const Icon(Icons.close),
                  onPressed: () => Navigator.pop(context),
                ),
              ),
              const Expanded(child: PifSettingsPage()),
            ],
          ),
        ),
      ),
    );
  }

  Future<EnvironmentIdentity?> _newProject() async {
    if (_onboardingInFlight) return null;
    final context = _navigatorKey.currentContext;
    if (context == null) return null;
    _onboardingInFlight = true;
    try {
      return await showProjectOnboarding(
        context,
        environments: _environments,
        github: _github,
        onEnvironmentSelected: _selectEnvironment,
        onOpenSettings: _openSettingsPage,
      );
    } finally {
      _onboardingInFlight = false;
    }
  }

  Future<void> _connectRepository() async {
    if (_onboardingInFlight) return;
    final context = _navigatorKey.currentContext;
    final workspace = _github.workspace;
    if (context == null || workspace == null) return;
    _onboardingInFlight = true;
    try {
      final identity = await EnvironmentIdentity.ensure(workspace);
      if (!context.mounted) return;
      await showProjectOnboarding(
        context,
        environment: identity,
        repositoryOnly: true,
        environments: _environments,
        github: _github,
        onEnvironmentSelected: _selectEnvironment,
        onOpenSettings: _openSettingsPage,
      );
      _bus?.send('tracker/control', 'refresh', const {});
    } finally {
      _onboardingInFlight = false;
    }
  }

  void _githubChanged() {
    final state = _github.state;
    final key =
        '${_github.environmentId}:${state.saved}:${state.validated}:'
        '${state.code}:${state.account}:${state.creationCapability}';
    if (_githubStateKey == key) return;
    _githubStateKey = key;
    _bus?.send('tracker/control', 'refresh', const {});
  }

  Future<void> _openProjectPicker() async {
    if (_startupInFlight) return;
    _startupGeneration++;
    await _cleanup();
    _workspace = null;
    _startupError = null;
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final appearance = _appearance;
    // Exported products retain their own pinned theme path. A preference in
    // the authoring app must not silently restyle a generated product.
    if (appearance == null) return _application(ThemeMode.dark);
    return PifAppearanceScope(
      service: appearance,
      child: ListenableBuilder(
        listenable: appearance,
        builder: (context, child) => _application(appearance.mode),
      ),
    );
  }

  Widget _application(ThemeMode mode) {
    return GithubConnectionScope(
      service: _github,
      onConnectRepository: widget.exportMode ? null : _connectRepository,
      child: MaterialApp(
        navigatorKey: _navigatorKey,
        debugShowCheckedModeBanner: false,
        title: 'pif',
        theme: const PifTheme(brightness: Brightness.light).materialTheme,
        darkTheme: const PifTheme().materialTheme,
        themeMode: mode,
        home: _bus != null
            ? DockingShell(
                bus: _bus!,
                workspace: _workspace,
                onOpenProject: widget.exportMode ? null : _openProjectPicker,
              )
            : widget.exportMode
            ? _exportStartupSurface()
            : ProjectPicker(
                onLaunch: _launchProject,
                onCreateProject: _newProject,
                onOpenSettings: _openSettingsPage,
                environments: _environments,
                onEnvironmentSelected: _selectEnvironment,
              ),
      ),
    );
  }

  Widget _exportStartupSurface() {
    final error = _startupError;
    final workspace = _workspace;
    final launching = _startupInFlight;
    final canRetry = workspace != null && error != null;
    return Scaffold(
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520),
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.launch, size: 48, color: Color(0xff78dba9)),
                const SizedBox(height: 18),
                Text(
                  error == null
                      ? 'Launching exported app…'
                      : 'Exported app needs attention',
                  style: Theme.of(context).textTheme.titleLarge,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 10),
                Text(
                  launching
                      ? 'Starting the bundled workspace and waiting for the hub.'
                      : error ??
                            'Starting the bundled workspace and waiting for the hub.',
                  textAlign: TextAlign.center,
                ),
                if (launching) ...[
                  const SizedBox(height: 22),
                  const CircularProgressIndicator(),
                ],
                if (canRetry) ...[
                  const SizedBox(height: 22),
                  FilledButton(
                    onPressed: _startupInFlight ? null : _retryExportStartup,
                    child: const Text('Retry'),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
