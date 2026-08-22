import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'bus.dart';

abstract class PifWidgetPlugin {
  PifWidgetMeta get meta;
  Widget build(BuildContext context, PifHost host);
}

enum PifSlot { left, center, right, bottom, status }

class PifWidgetMeta {
  const PifWidgetMeta({
    required this.id,
    required this.name,
    required this.slot,
    this.core = false,
    this.description = '',
  });
  final String id;
  final String name;
  final PifSlot slot;
  final bool core;
  final String description;
}

class PifSession {
  const PifSession({
    required this.id,
    required this.name,
    required this.host,
    required this.state,
    required this.model,
    required this.thinking,
    required this.cwd,
    this.transcript = const [],
  });
  final String id;
  final String name;
  final bool host;
  final String state;
  final String model;
  final String thinking;
  final String cwd;
  final List<dynamic> transcript;

  factory PifSession.fromJson(Map<String, dynamic> json) => PifSession(
    id: json['id'] as String,
    name: json['name'] as String? ?? json['id'] as String,
    host: json['host'] as bool? ?? false,
    state: json['state'] as String? ?? 'idle',
    model: json['model'] as String? ?? 'default',
    thinking: json['thinking'] as String? ?? 'medium',
    cwd: json['cwd'] as String? ?? '',
    transcript: json['transcript'] as List<dynamic>? ?? const [],
  );
}

class PifSessions {
  PifSessions(this.bus);
  final PifBus bus;
  final _state = StreamController<List<PifSession>>.broadcast();
  final Set<String> _processedEnvelopeIds = {};
  List<PifSession> current = const [];
  Stream<List<PifSession>> get changes => _state.stream;

  void applySnapshot(Map<String, dynamic> json) {
    current =
        json.values
            .map(
              (value) =>
                  PifSession.fromJson(Map<String, dynamic>.from(value as Map)),
            )
            .toList()
          ..sort(
            (a, b) => a.host
                ? -1
                : b.host
                ? 1
                : a.name.compareTo(b.name),
          );
    _state.add(current);
  }

  void applyEvent(Map<String, dynamic> payload, {String? envelopeId}) {
    if (envelopeId != null) {
      if (!_processedEnvelopeIds.add(envelopeId)) return;
      if (_processedEnvelopeIds.length > 10000) {
        _processedEnvelopeIds.remove(_processedEnvelopeIds.first);
      }
    }
    final id = payload['sessionId'] as String? ?? payload['id'] as String?;
    if (id == null) return;
    final existing = current.where((session) => session.id == id).firstOrNull;
    final source = payload.containsKey('id')
        ? payload
        : <String, dynamic>{
            if (existing != null) ...{
              'id': existing.id,
              'name': existing.name,
              'host': existing.host,
              'model': existing.model,
              'cwd': existing.cwd,
              'transcript': [
                ...existing.transcript,
                if (payload['event'] != null) payload['event'],
              ],
            },
            'id': id,
            'state': payload['state'] ?? existing?.state ?? 'idle',
          };
    final replacement = PifSession.fromJson(source);
    current = [...current.where((session) => session.id != id), replacement]
      ..sort(
        (a, b) => a.host
            ? -1
            : b.host
            ? 1
            : a.name.compareTo(b.name),
      );
    _state.add(current);
  }

  void spawn({required String cwd, String? model, String? thinking, String? prompt}) => bus.send(
    'session/control',
    'spawn',
    {'cwd': cwd, 'model': model, 'thinking': thinking, 'prompt': prompt},
  );
  void input(String sessionId, String content) => bus.send(
    'session/control',
    'input',
    {'sessionId': sessionId, 'content': content},
  );
  void steer(String sessionId, String content) => bus.send(
    'session/control',
    'steer',
    {'sessionId': sessionId, 'content': content},
  );
  void abort(String sessionId) =>
      bus.send('session/control', 'abort', {'sessionId': sessionId});
  void select(String sessionId) =>
      bus.send('session/control', 'select', {'sessionId': sessionId});
  void rename(String sessionId, String name) => bus.send(
    'session/control',
    'rename',
    {'sessionId': sessionId, 'name': name},
  );
  void setModel(String sessionId, String model) => bus.send(
    'session/control',
    'setModel',
    {'sessionId': sessionId, 'model': model},
  );
  void setThinking(String sessionId, String thinking) => bus.send(
    'session/control',
    'setThinking',
    {'sessionId': sessionId, 'thinking': thinking},
  );
}

class PifLayout {
  PifLayout(this.bus);
  final PifBus bus;
  void open(String widgetId, {PifSlot? slot}) => bus.send(
    'shell/layout',
    'open',
    {'widgetId': widgetId, if (slot != null) 'slot': slot.name},
  );
  void focus(String widgetId) =>
      bus.send('shell/layout', 'focus', {'widgetId': widgetId});
  void move(String widgetId, PifSlot slot) => bus.send('shell/layout', 'move', {
    'widgetId': widgetId,
    'slot': slot.name,
  });
  void close(String widgetId) =>
      bus.send('shell/layout', 'close', {'widgetId': widgetId});
  /// Discard the persisted arrangement and return every panel to its
  /// default slot from the widget registry.
  void reset() => bus.send('shell/layout', 'reset', const {});
  void changed(Map<String, dynamic> layout) =>
      bus.send('shell/layout', 'layout_change', layout);
}

class PifStorage {
  String workspace = Directory.current.path;
  final Map<String, Map<String, Object?>> _values = {};
  final Set<String> _loaded = {};
  File _file(String widgetId) =>
      File('$workspace/.pi/pif/storage/$widgetId.json');
  void _load(String widgetId) {
    if (_loaded.contains(widgetId)) return;
    _loaded.add(widgetId);
    try {
      _values[widgetId] = Map<String, Object?>.from(
        jsonDecode(_file(widgetId).readAsStringSync()) as Map,
      );
    } catch (_) {
      _values[widgetId] = {};
    }
  }

  Object? read(String widgetId, String key) {
    _load(widgetId);
    return _values[widgetId]?[key];
  }

  Future<void> write(String widgetId, String key, Object? value) async {
    _load(widgetId);
    (_values[widgetId] ??= {})[key] = value;
    final file = _file(widgetId);
    await file.parent.create(recursive: true);
    await file.writeAsString(
      '${const JsonEncoder.withIndent('  ').convert(_values[widgetId])}\n',
    );
  }
}

class PifTheme {
  const PifTheme();
  Color get panel => const Color(0xff151922);
  Color get panelRaised => const Color(0xff1d2330);
  Color get accent => const Color(0xff78dba9);
  Color get border => const Color(0xff2c3547);
  Color get textMuted => const Color(0xff8b96aa);
}

class PifHost {
  PifHost({
    required this.bus,
    PifSessions? sessions,
    PifLayout? layout,
    PifStorage? storage,
    this.theme = const PifTheme(),
  }) : sessions = sessions ?? PifSessions(bus),
       layout = layout ?? PifLayout(bus),
       storage = storage ?? PifStorage();
  final PifBus bus;
  final PifSessions sessions;
  final PifLayout layout;
  final PifStorage storage;
  final PifTheme theme;
  String activeSessionId = 'host';
  String workspace = '';
  List<String> models = const [];
  Map<String, dynamic> modelProviders = {};
  Map<String, dynamic> snapshot = {};
}
