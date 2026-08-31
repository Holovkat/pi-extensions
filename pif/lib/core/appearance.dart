import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';

/// Non-secret application preferences. Environment credentials never use this
/// file; exported product apps do not consume this authoring-shell preference.
class PifAppearanceService extends ChangeNotifier {
  PifAppearanceService({File? preferencesFile})
    : _file = preferencesFile ?? _defaultFile() {
    _load();
  }

  final File? _file;
  Map<String, dynamic> _preferences = {};
  ThemeMode _mode = ThemeMode.system;
  String? _persistenceError;
  Future<void> _pendingWrite = Future<void>.value();
  int _revision = 0;
  bool _disposed = false;

  ThemeMode get mode => _mode;
  String? get persistenceError => _persistenceError;
  Future<void> flush() => _pendingWrite;

  static File? _defaultFile() {
    final home = Platform.environment['HOME'];
    return home == null || home.isEmpty
        ? null
        : File('$home/.pi/pif/preferences.json');
  }

  void _load() {
    final file = _file;
    if (file == null) {
      _persistenceError =
          'Appearance preferences are unavailable on this device.';
      return;
    }
    try {
      if (!file.existsSync()) return;
      _preferences = Map<String, dynamic>.from(
        jsonDecode(file.readAsStringSync()) as Map,
      );
      _mode = ThemeMode.values.firstWhere(
        (mode) => mode.name == _preferences['appearance'],
        orElse: () => ThemeMode.system,
      );
    } catch (_) {
      _persistenceError = 'Saved appearance could not be read. Using System.';
    }
  }

  /// Apply immediately and serialize atomic writes so rapid choices cannot
  /// leave an older selection persisted after the most recent one.
  Future<void> setMode(ThemeMode mode) {
    _mode = mode;
    final revision = ++_revision;
    notifyListeners();
    _pendingWrite = _pendingWrite.then((_) async {
      try {
        final file = _file;
        if (file == null)
          throw const FileSystemException('No preferences path');
        final updated = {..._preferences, 'appearance': mode.name};
        await file.parent.create(recursive: true);
        final temporary = File('${file.path}.$pid.tmp');
        try {
          await temporary.writeAsString(
            '${jsonEncode(updated)}\n',
            flush: true,
          );
          await temporary.rename(file.path);
        } finally {
          if (await temporary.exists()) await temporary.delete();
        }
        _preferences = updated;
        if (revision == _revision) _persistenceError = null;
      } catch (_) {
        if (revision == _revision) {
          _persistenceError =
              'Appearance changed for now, but could not be saved. Try again.';
        }
      }
      if (!_disposed && revision == _revision) notifyListeners();
    });
    return _pendingWrite;
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}

class PifAppearanceScope extends InheritedWidget {
  const PifAppearanceScope({
    super.key,
    required this.service,
    required super.child,
  });

  final PifAppearanceService service;

  static PifAppearanceService? maybeOf(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<PifAppearanceScope>()?.service;

  @override
  bool updateShouldNotify(PifAppearanceScope oldWidget) =>
      service != oldWidget.service;
}
