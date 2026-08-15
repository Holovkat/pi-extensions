import 'package:flutter/material.dart';
import 'core/bus.dart';
import 'core/docking_shell.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const PifApp());
}

class PifApp extends StatelessWidget {
  const PifApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
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
    home: DockingShell(bus: PifBus()),
  );
}
