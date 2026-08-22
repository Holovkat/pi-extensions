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
class PifApp extends StatefulWidget {
  const PifApp({super.key});
  @override
  State<PifApp> createState() => _PifAppState();
}

class _PifAppState extends State<PifApp> with WidgetsBindingObserver {
  PiLauncher? _launcher;
  PifBus? _bus;
  String? _workspace;

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
  /// connect to it directly without showing the project picker.
  Future<void> _checkExistingHub() async {
    if (await PiLauncher.isHubRunning()) {
      _bus = PifBus();
      await _bus!.connect();
      if (mounted) setState(() {});
    }
  }

  /// Called when the user selects a project in the picker.
  /// Throws on failure — the picker catches and displays the error.
  Future<void> _launchProject(String workspace) async {
    _launcher = PiLauncher();
    await _launcher!.start(workspace: workspace);

    final ready = await PiLauncher.waitForHub();
    if (!ready) {
      await _launcher!.stop();
      _launcher = null;
      throw Exception('Hub did not start within 30 seconds. '
          'Make sure pi is installed and configured.');
    }

    _bus = PifBus(token: _launcher!.token);
    await _bus!.connect();
    _workspace = workspace;
    if (mounted) setState(() {});
  }

  Future<void> _cleanup() async {
    await _bus?.dispose();
    _bus = null;
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
