import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import '../../core/plugin.dart';

class AgentConsolePlugin implements PifWidgetPlugin {
  @override
  PifWidgetMeta get meta => const PifWidgetMeta(
    id: 'agent_console',
    name: 'Agent Console',
    slot: PifSlot.center,
    core: true,
    description: 'Streaming Pi conversation',
  );
  @override
  Widget build(BuildContext context, PifHost host) => _AgentConsole(host: host);
}

class _AgentConsole extends StatefulWidget {
  const _AgentConsole({required this.host});
  final PifHost host;
  @override
  State<_AgentConsole> createState() => _AgentConsoleState();
}

class _SessionTranscriptState {
  int turnStartIndex = -1;
  String? turnStartTs;
  int activeAssistantIndex = -1;
  bool turnAborted = false;
  bool turnFailed = false;
  final Map<String, int> toolIndexByCallId = {};
  String? firstSignature;
  String? lastSignature;

  void resetTurn() {
    turnStartIndex = -1;
    turnStartTs = null;
    activeAssistantIndex = -1;
    turnAborted = false;
    turnFailed = false;
    toolIndexByCallId.clear();
  }

  void resetAll() {
    resetTurn();
    firstSignature = null;
    lastSignature = null;
  }
}

class _AgentConsoleState extends State<_AgentConsole> {
  static const _conversationMaxWidth = 760.0;
  final controller = TextEditingController();
  final scroll = ScrollController();
  late StreamSubscription subscription;
  late StreamSubscription escapes;
  bool editingName = false;
  // The session being renamed is captured when the edit starts, so a
  // hub-driven active-session change mid-edit cannot retarget the commit.
  String? renamingSessionId;
  final nameController = TextEditingController();
  final nameFocus = FocusNode();
  // Incremental entry state: built entries are kept per session and
  // extended by streaming deltas; a full rebuild happens only when a
  // snapshot replaces history or the selection changes.
  final entriesBySession = <String, List<Map<String, dynamic>>>{};
  final runningBySession = <String, bool>{};
  final processedEvents = <String, int>{};
  final transcriptStates = <String, _SessionTranscriptState>{};
  Timer? _coalesce;
  List<Map<String, dynamic>> get entries => entriesBySession.putIfAbsent(
    widget.host.activeSessionId,
    () => <Map<String, dynamic>>[],
  );
  bool get running => runningBySession[widget.host.activeSessionId] ?? false;

  @override
  void initState() {
    super.initState();
    _rebuildAll(widget.host.sessions.current);
    nameFocus.addListener(() {
      if (!nameFocus.hasFocus && editingName) _commitName();
    });
    // Esc cancels the rename instead of the focus-loss commit path.
    escapes = widget.host.escapes.listen((_) {
      if (editingName) _cancelName();
    });
    subscription = widget.host.sessions.changes.listen((sessions) {
      _consume(sessions);
      if (mounted) setState(() {});
      _scheduleAutoScroll();
    });
  }

  /// Coalesced auto-scroll: many deltas in one frame scroll once.
  void _scheduleAutoScroll() {
    _coalesce ??= Timer(const Duration(milliseconds: 32), () {
      _coalesce = null;
      if (!mounted || !scroll.hasClients) return;
      scroll.animateTo(
        scroll.position.maxScrollExtent,
        duration: const Duration(milliseconds: 150),
        curve: Curves.easeOut,
      );
    });
  }

  /// Apply new events incrementally: only unseen transcript events for a
  /// session are appended to its already-built entries — no full rescan
  /// of every session's history per token.
  void _consume(List<PifSession> sessions) {
    for (final session in sessions) {
      runningBySession[session.id] = session.state == 'running';
      final state = transcriptStates.putIfAbsent(
        session.id,
        _SessionTranscriptState.new,
      );
      final seen = processedEvents[session.id] ?? 0;
      final transcript = session.transcript;
      final firstSignature = transcript.isEmpty
          ? null
          : _entrySignature(transcript.first);
      final lastSignature = transcript.isEmpty
          ? null
          : _entrySignature(transcript.last);
      final needsRebuild =
          seen > transcript.length ||
          (seen == transcript.length &&
              (state.firstSignature != firstSignature ||
                  state.lastSignature != lastSignature));
      if (needsRebuild) {
        // History was replaced (snapshot/trim) — rebuild this session.
        state.resetAll();
        processedEvents[session.id] = transcript.length;
        entriesBySession[session.id] = _buildEntries(
          transcript,
          state: state,
          finalizeOpenTurn: session.state != 'running',
        );
        state.firstSignature = firstSignature;
        state.lastSignature = lastSignature;
        continue;
      }
      if (transcript.length == seen) continue;
      final target = entriesBySession.putIfAbsent(
        session.id,
        () => <Map<String, dynamic>>[],
      );
      _appendEntries(transcript.sublist(seen), target, state);
      processedEvents[session.id] = transcript.length;
      state.firstSignature ??= firstSignature;
      state.lastSignature = lastSignature;
    }
    entriesBySession.removeWhere(
      (id, _) => sessions.every((session) => session.id != id),
    );
    runningBySession.removeWhere(
      (id, _) => sessions.every((session) => session.id != id),
    );
    processedEvents.removeWhere(
      (id, _) => sessions.every((session) => session.id != id),
    );
    transcriptStates.removeWhere(
      (id, _) => sessions.every((session) => session.id != id),
    );
  }

  void _rebuildAll(List<PifSession> sessions) {
    for (final session in sessions) {
      runningBySession[session.id] = session.state == 'running';
      final state = transcriptStates.putIfAbsent(
        session.id,
        _SessionTranscriptState.new,
      );
      state.resetAll();
      processedEvents[session.id] = session.transcript.length;
      entriesBySession[session.id] = _buildEntries(
        session.transcript,
        state: state,
        finalizeOpenTurn: session.state != 'running',
      );
      state.firstSignature = session.transcript.isEmpty
          ? null
          : _entrySignature(session.transcript.first);
      state.lastSignature = session.transcript.isEmpty
          ? null
          : _entrySignature(session.transcript.last);
    }
  }

  /// Extend already-built entries with new raw transcript items.
  void _appendEntries(
    List<dynamic> rawItems,
    List<Map<String, dynamic>> into,
    _SessionTranscriptState state,
  ) {
    for (final raw in rawItems) {
      if (raw is! Map) continue;
      _ingestTranscriptEvent(
        Map<String, dynamic>.from(raw),
        into,
        state,
        finalizeOpenTurn: false,
      );
    }
  }

  List<Map<String, dynamic>> _buildEntries(
    List<dynamic> transcript, {
    required _SessionTranscriptState state,
    bool finalizeOpenTurn = true,
  }) {
    final entries = <Map<String, dynamic>>[];
    for (final raw in transcript) {
      if (raw is! Map) continue;
      _ingestTranscriptEvent(
        Map<String, dynamic>.from(raw),
        entries,
        state,
        finalizeOpenTurn: false,
      );
    }
    if (finalizeOpenTurn) {
      _finalizeOpenTurn(
        entries,
        state,
        endTs: _lastAssistantTimestamp(entries),
      );
    }
    return entries;
  }

  void _ingestTranscriptEvent(
    Map<String, dynamic> event,
    List<Map<String, dynamic>> entries,
    _SessionTranscriptState state, {
    required bool finalizeOpenTurn,
  }) {
    final type = event['type'] as String? ?? 'event';
    final data = event['payload'] is Map
        ? Map<String, dynamic>.from(event['payload'] as Map)
        : event;
    final timestamp = _eventTimestamp(event, data);

    if (type == 'input') {
      final mode = data['mode'] ?? event['mode'];
      final queued = mode == 'steer' || mode == 'follow_up';
      // Stored native history may omit agent_end, including after an empty
      // failure. A new prompt must close that turn even without answer text.
      if (!queued) {
        _finalizeOpenTurn(
          entries,
          state,
          endTs: _lastAssistantTimestamp(entries),
        );
      }
      _appendPromptLikeEntry(
        entries,
        state,
        data['content'] ?? event['content'] ?? '',
        timestamp,
        queued: queued,
      );
      return;
    }

    if (type == 'message_update' || type == 'message_start') {
      if (type == 'message_start') state.activeAssistantIndex = -1;
      final delta = _extractDelta(data);
      if (delta == null || delta.isEmpty) return;
      _beginTurnIfNeeded(entries, state, timestamp);
      final assistantIndex = state.activeAssistantIndex;
      if (assistantIndex >= 0) {
        final entry = entries[assistantIndex];
        entry['text'] = '${entry['text'] as String? ?? ''}$delta';
        entry['replace'] = false;
        if (timestamp != null) entry['ts'] = timestamp;
      } else {
        state.activeAssistantIndex = entries.length;
        entries.add({
          'kind': 'assistant',
          'text': delta,
          'replace': false,
          ..._timestampEntry(timestamp),
        });
      }
      return;
    }

    if (type == 'message_end' || type == 'message') {
      final text = _extractFullText(data);
      final failure = _turnFailure(data);
      if (failure != null) {
        state.turnAborted = failure.status == 'canceled';
        state.turnFailed = failure.status == 'failed';
      }
      if (failure != null &&
          (failure.status == 'failed' || text == null || text.isEmpty)) {
        _appendFailureEntry(entries, failure, timestamp);
      }
      if (text == null || text.isEmpty) {
        state.activeAssistantIndex = -1;
        return;
      }
      _beginTurnIfNeeded(entries, state, timestamp);
      final assistantIndex = state.activeAssistantIndex;
      if (assistantIndex >= 0) {
        final entry = entries[assistantIndex];
        entry['text'] = text;
        entry['replace'] = true;
        if (timestamp != null) entry['ts'] = timestamp;
      } else {
        state.activeAssistantIndex = entries.length;
        entries.add({
          'kind': 'assistant',
          'text': text,
          'replace': true,
          ..._timestampEntry(timestamp),
        });
      }
      state.activeAssistantIndex = -1;
      return;
    }

    if (type.contains('tool')) {
      _beginTurnIfNeeded(entries, state, timestamp);
      _upsertToolEntry(entries, state, type, data, timestamp);
      return;
    }

    if (type == 'agent_start') {
      _beginTurnIfNeeded(entries, state, timestamp);
      if (_hasVisibleStatus(entries, 'Agent started')) {
        if (timestamp != null) entries.last['ts'] = timestamp;
      } else {
        entries.add({
          'kind': 'status',
          'text': 'Agent started',
          ..._timestampEntry(timestamp),
        });
      }
      return;
    }

    if (type == 'agent_end') {
      _finalizeOpenTurn(
        entries,
        state,
        endTs: timestamp,
        aborted: event['aborted'] == true || data['aborted'] == true,
      );
      return;
    }

    if (type == 'turn_end') {
      final failure = _turnFailure(data);
      if (failure != null) {
        _appendFailureEntry(entries, failure, timestamp);
        state.resetTurn();
        return;
      }
      if (finalizeOpenTurn) {
        _finalizeOpenTurn(entries, state, endTs: timestamp);
      }
      return;
    }

    if (type == 'stderr' || type == 'output') {
      final text = data['data']?.toString() ?? '';
      if (text.trim().isNotEmpty) {
        entries.add({'kind': 'raw', 'text': text.trim()});
      }
      return;
    }

    if (finalizeOpenTurn) {
      _finalizeOpenTurn(entries, state, endTs: timestamp);
    }
  }

  void _beginTurnIfNeeded(
    List<Map<String, dynamic>> entries,
    _SessionTranscriptState state,
    String? timestamp,
  ) {
    if (state.turnStartIndex < 0) {
      state.turnStartIndex = entries.length;
      state.turnStartTs = timestamp;
      return;
    }
    state.turnStartTs ??= timestamp;
  }

  void _appendPromptLikeEntry(
    List<Map<String, dynamic>> entries,
    _SessionTranscriptState state,
    Object? rawText,
    String? timestamp, {
    bool queued = false,
  }) {
    final text = rawText?.toString() ?? '';
    if (text.isEmpty) return;
    final continuingTurn = queued && state.turnStartIndex >= 0;
    _beginTurnIfNeeded(entries, state, timestamp);
    entries.add({'kind': 'user', 'text': text, ..._timestampEntry(timestamp)});
    // Queued input does not end the native message currently streaming.
    // Its remaining deltas and final snapshot must update the same entry.
    if (continuingTurn) return;
    state.turnStartIndex = entries.length - 1;
    state.turnStartTs ??= timestamp;
    state.activeAssistantIndex = -1;
  }

  void _finalizeOpenTurn(
    List<Map<String, dynamic>> entries,
    _SessionTranscriptState state, {
    required String? endTs,
    bool aborted = false,
  }) {
    if (state.turnStartIndex < 0) return;
    _appendTurnEnd(
      entries,
      startIndex: state.turnStartIndex,
      startTs: state.turnStartTs,
      endTs: endTs,
      aborted: aborted || state.turnAborted,
      failed: state.turnFailed,
    );
    state.resetTurn();
  }

  void _upsertToolEntry(
    List<Map<String, dynamic>> entries,
    _SessionTranscriptState state,
    String type,
    Map<String, dynamic> data,
    String? timestamp,
  ) {
    final callId = _toolCallId(data);
    final name = _toolName(type, data);
    final status = _toolStatus(type, data);
    final detail = _toolDetail(type, data);
    if (callId.isNotEmpty) {
      final existingIndex = state.toolIndexByCallId[callId];
      if (existingIndex != null && existingIndex < entries.length) {
        final entry = entries[existingIndex];
        if (name.isNotEmpty) entry['name'] = name;
        entry['status'] = _mergeToolStatus(
          entry['status'] as String? ?? 'running',
          status,
        );
        if (detail.isNotEmpty) {
          entry['detail'] = detail;
        }
        if (timestamp != null) entry['ts'] = timestamp;
        entry['callId'] = callId;
        return;
      }
    }
    entries.add({
      'kind': 'tool',
      'name': name,
      'status': status,
      'detail': detail,
      if (callId.isNotEmpty) 'callId': callId,
      ..._timestampEntry(timestamp),
    });
    if (callId.isNotEmpty) {
      state.toolIndexByCallId[callId] = entries.length - 1;
    }
  }

  void _appendFailureEntry(
    List<Map<String, dynamic>> entries,
    ({String status, String title, String detail}) failure,
    String? timestamp,
  ) {
    if (entries.isNotEmpty &&
        entries.last['kind'] == 'error' &&
        entries.last['status'] == failure.status &&
        entries.last['detail'] == failure.detail) {
      if (timestamp != null) entries.last['ts'] = timestamp;
      return;
    }
    entries.add({
      'kind': 'error',
      'status': failure.status,
      'title': failure.title,
      'detail': failure.detail,
      ..._timestampEntry(timestamp),
    });
  }

  bool _hasVisibleStatus(List<Map<String, dynamic>> entries, String text) {
    return entries.isNotEmpty &&
        entries.last['kind'] == 'status' &&
        entries.last['text'] == text;
  }

  String _toolCallId(Map<String, dynamic> data) =>
      data['toolCallId']?.toString() ?? data['id']?.toString() ?? '';

  String _toolName(String type, Map<String, dynamic> data) {
    final name = data['toolName'] ?? data['name'];
    if (name is String && name.isNotEmpty) return name;
    return type;
  }

  String _toolStatus(String type, Map<String, dynamic> data) {
    final lowered = type.toLowerCase();
    if (lowered.contains('cancel') ||
        lowered.contains('abort') ||
        data['aborted'] == true) {
      return 'canceled';
    }
    if (lowered.contains('fail') ||
        lowered.contains('error') ||
        data['error'] != null ||
        data['isError'] == true) {
      return 'failed';
    }
    if (lowered.contains('end')) return 'done';
    return 'running';
  }

  String _toolDetail(String type, Map<String, dynamic> data) {
    final lowered = type.toLowerCase();
    final failure = data['error'] ?? data['result'] ?? data['args'];
    if (lowered.contains('cancel') ||
        lowered.contains('abort') ||
        lowered.contains('fail') ||
        lowered.contains('error') ||
        data['isError'] == true) {
      return failure?.toString() ?? '';
    }
    if (lowered.contains('end') && data['result'] != null) {
      return data['result'].toString();
    }
    if (data['args'] != null && data['args'].toString().isNotEmpty) {
      return data['args'].toString();
    }
    if (data['result'] != null && data['result'].toString().isNotEmpty) {
      return data['result'].toString();
    }
    if (data['error'] != null && data['error'].toString().isNotEmpty) {
      return data['error'].toString();
    }
    return '';
  }

  String _mergeToolStatus(String current, String next) {
    const priority = {'running': 0, 'done': 1, 'canceled': 2, 'failed': 3};
    final currentPriority = priority[current.toLowerCase()] ?? 0;
    final nextPriority = priority[next.toLowerCase()] ?? 0;
    return nextPriority >= currentPriority ? next : current;
  }

  ({String status, String title, String detail})? _turnFailure(
    dynamic rawData,
  ) {
    final data = rawData is Map
        ? Map<String, dynamic>.from(rawData)
        : <String, dynamic>{'data': rawData?.toString() ?? ''};
    final raw =
        data['data']?.toString() ??
        data['message']?.toString() ??
        data['errorMessage']?.toString() ??
        '';
    final stopReason = _jsonStringField(data, raw, 'stopReason');
    final rawStopReason = _jsonStringField(data, raw, 'rawStopReason');
    final errorMessage = _jsonStringField(data, raw, 'errorMessage');
    final stoppedByAbort =
        data['aborted'] == true ||
        (stopReason?.toLowerCase().contains('abort') ?? false) ||
        (rawStopReason?.toLowerCase().contains('abort') ?? false) ||
        raw.contains('"aborted":true');
    final stoppedByError =
        (stopReason?.toLowerCase().contains('error') ?? false) ||
        raw.contains('"stopReason":"error"') ||
        raw.contains('"errorMessage"') ||
        data['isError'] == true ||
        data['error'] != null;
    if (!stoppedByAbort && !stoppedByError) return null;
    final detail = errorMessage?.trim().isNotEmpty == true
        ? errorMessage!.trim()
        : rawStopReason?.trim().isNotEmpty == true
        ? rawStopReason!.trim()
        : stopReason?.trim().isNotEmpty == true
        ? stopReason!.trim()
        : stoppedByAbort
        ? 'Request was aborted'
        : 'Assistant turn failed';
    return (
      status: stoppedByAbort ? 'canceled' : 'failed',
      title: stoppedByAbort ? 'Canceled' : 'Error',
      detail: detail,
    );
  }

  String? _jsonStringField(
    Map<String, dynamic> data,
    String raw,
    String field,
  ) {
    final direct = data[field];
    if (direct is String && direct.isNotEmpty) return direct;
    final match = RegExp(
      '"$field"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"',
    ).firstMatch(raw);
    if (match == null) return null;
    return match
        .group(1)
        ?.replaceAll(r'\"', '"')
        .replaceAll(r'\\n', '\n')
        .replaceAll(r'\\t', '\t')
        .replaceAll(r'\\\\', '\\');
  }

  String _entrySignature(dynamic raw) {
    if (raw is! Map) return raw.toString();
    final event = Map<String, dynamic>.from(raw);
    final payload = event['payload'] is Map
        ? Map<String, dynamic>.from(event['payload'] as Map)
        : const <String, dynamic>{};
    final data = payload.isEmpty ? event : payload;
    final bits = <String>[
      event['type']?.toString() ?? '',
      data['id']?.toString() ?? '',
      data['sessionId']?.toString() ?? '',
      data['role']?.toString() ?? '',
      data['customType']?.toString() ?? '',
      data['toolCallId']?.toString() ?? '',
      data['toolName']?.toString() ?? '',
      data['state']?.toString() ?? '',
      data['text']?.toString() ?? '',
      data['content']?.toString() ?? '',
      data['delta']?.toString() ?? '',
      data['result']?.toString() ?? '',
      data['args']?.toString() ?? '',
      data['aborted']?.toString() ?? '',
      data['ts']?.toString() ?? '',
      data['timestamp']?.toString() ?? '',
    ];
    return bits.join('\u001f');
  }

  String? _eventTimestamp(
    Map<String, dynamic> event,
    Map<String, dynamic> data,
  ) {
    final value =
        event['ts'] ?? event['timestamp'] ?? data['ts'] ?? data['timestamp'];
    if (value is String && value.isNotEmpty) return value;
    if (value is num) {
      return DateTime.fromMillisecondsSinceEpoch(
        value.toInt(),
      ).toIso8601String();
    }
    return null;
  }

  Map<String, dynamic> _timestampEntry(String? timestamp) =>
      timestamp == null ? const {} : {'ts': timestamp};

  int _lastAssistantIndex(List<Map<String, dynamic>> entries) =>
      entries.lastIndexWhere((entry) => entry['kind'] == 'assistant');

  String? _lastAssistantTimestamp(List<Map<String, dynamic>> entries) {
    final index = _lastAssistantIndex(entries);
    return index < 0 ? null : entries[index]['ts'] as String?;
  }

  void _appendTurnEnd(
    List<Map<String, dynamic>> entries, {
    required int startIndex,
    required String? startTs,
    required String? endTs,
    bool aborted = false,
    bool failed = false,
  }) {
    if (entries.isEmpty || entries.last['kind'] == 'turn_end') return;
    final safeStart = startIndex.clamp(0, entries.length - 1).toInt();
    final responseStart = entries[safeStart]['kind'] == 'assistant'
        ? safeStart
        : safeStart + 1;
    if (responseStart >= entries.length) return;
    final response = entries
        .skip(responseStart)
        .where((entry) => entry['kind'] == 'assistant')
        .map((entry) => entry['text'] as String? ?? '')
        .where((text) => text.isNotEmpty)
        .join('\n\n');
    if (response.isEmpty) return;
    final duration = startTs == null || endTs == null
        ? null
        : _durationBetween(startTs, endTs);
    entries.add({
      'kind': 'turn_end',
      ..._durationEntry(duration),
      'response': response,
      'aborted': aborted,
      'failed': failed,
    });
  }

  Map<String, dynamic> _durationEntry(Duration? duration) =>
      duration == null ? const {} : {'duration': duration};

  Duration? _durationBetween(String start, String end) {
    final duration = DateTime.tryParse(
      end,
    )?.difference(DateTime.tryParse(start) ?? DateTime.now());
    return duration == null || duration.isNegative ? null : duration;
  }

  String? _extractDelta(Map<String, dynamic> data) {
    if (data['delta'] is String) return data['delta'] as String;
    final ame = data['assistantMessageEvent'];
    if (ame is Map && ame['delta'] is String) return ame['delta'] as String;
    final msg = data['message'];
    if (msg is Map) {
      final content = msg['content'];
      if (content is List) {
        return content
            .whereType<Map>()
            .where((c) => c['type'] == 'text')
            .map((c) => c['text'] as String? ?? '')
            .join();
      }
    }
    return null;
  }

  String? _extractFullText(Map<String, dynamic> data) {
    if (data['text'] is String) return data['text'] as String;
    return _extractDelta(data);
  }

  @override
  void dispose() {
    subscription.cancel();
    escapes.cancel();
    _coalesce?.cancel();
    controller.dispose();
    nameController.dispose();
    nameFocus.dispose();
    scroll.dispose();
    super.dispose();
  }

  void _startRename(String current) {
    nameController.text = current;
    renamingSessionId = widget.host.activeSessionId;
    setState(() => editingName = true);
  }

  void _commitName() {
    final name = nameController.text.trim();
    final id = renamingSessionId;
    setState(() => editingName = false);
    renamingSessionId = null;
    if (name.isNotEmpty && id != null) {
      widget.host.sessions.rename(id, name);
    }
  }

  void _cancelName() {
    setState(() => editingName = false);
    renamingSessionId = null;
    nameController.clear();
  }

  void submit() {
    final value = controller.text.trim();
    if (value.isEmpty) return;
    final selected = widget.host.sessions.current
        .where((session) => session.id == widget.host.activeSessionId)
        .firstOrNull;
    if (selected == null) return;
    running
        ? widget.host.sessions.steer(widget.host.activeSessionId, value)
        : widget.host.sessions.input(widget.host.activeSessionId, value);
    // The hub echoes the authoritative input event back through the session
    // stream. Do not add a second optimistic copy here.
    controller.clear();
  }

  /// The session's model as a dropdown value: session ids sometimes lack
  /// the provider prefix (gpt-5.6-sol vs openai-codex/gpt-5.6-sol), so a
  /// unique suffix match resolves to the full id; a set-but-unknown model
  /// still displays instead of silently falling back to "Default".
  String? _resolvedModelValue(dynamic selected) {
    final model = selected?.model as String? ?? '';
    if (model.isEmpty) return null;
    if (widget.host.models.contains(model)) return model;
    final matches = widget.host.models
        .where((m) => m.endsWith('/$model'))
        .toList();
    if (matches.length == 1) return matches.single;
    return model;
  }

  @override
  Widget build(BuildContext context) {
    final selected = widget.host.sessions.current
        .where((s) => s.id == widget.host.activeSessionId)
        .firstOrNull;
    return Container(
      color: widget.host.theme.isDark
          ? const Color(0xff171717)
          : widget.host.theme.panel,
      child: Column(
        children: [
          _header(selected),
          // No per-session strip: the Session Rail switches sessions; the
          // header title carries the active name.
          Expanded(
            child: entries.isEmpty
                ? const _ConsoleEmpty()
                : ListView.builder(
                    controller: scroll,
                    padding: const EdgeInsets.fromLTRB(20, 24, 20, 28),
                    itemCount: entries.length,
                    itemBuilder: (_, index) => Align(
                      alignment: Alignment.center,
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(
                          maxWidth: _conversationMaxWidth,
                        ),
                        child: SizedBox(
                          width: double.infinity,
                          child: _EntryCard(entry: entries[index]),
                        ),
                      ),
                    ),
                  ),
          ),
          _composer(selected),
        ],
      ),
    );
  }

  Widget _header(PifSession? selected) => Container(
    height: 48,
    padding: const EdgeInsets.symmetric(horizontal: 18),
    decoration: BoxDecoration(
      color: widget.host.theme.panel,
      border: Border(bottom: BorderSide(color: widget.host.theme.border)),
    ),
    child: Row(
      children: [
        AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          width: 8,
          height: 8,
          decoration: BoxDecoration(
            color: running ? Colors.amber : widget.host.theme.accent,
            shape: BoxShape.circle,
            boxShadow: running
                ? const [BoxShadow(color: Colors.amber, blurRadius: 6)]
                : null,
          ),
        ),
        const SizedBox(width: 10),
        if (editingName)
          SizedBox(
            width: 240,
            child: TextField(
              controller: nameController,
              focusNode: nameFocus,
              autofocus: true,
              style: const TextStyle(fontWeight: FontWeight.w400),
              decoration: const InputDecoration(
                isDense: true,
                isCollapsed: true,
                border: InputBorder.none,
              ),
              onSubmitted: (_) => _commitName(),
            ),
          )
        else
          GestureDetector(
            onDoubleTap: selected == null
                ? null
                : () => _startRename(selected.name),
            child: Text(
              selected?.name ?? 'No session selected',
              style: const TextStyle(fontWeight: FontWeight.w400),
            ),
          ),
        const Spacer(),
        if (running)
          const Text(
            'Working',
            style: TextStyle(fontSize: 11, color: Color(0xffb9a26a)),
          ),
      ],
    ),
  );

  Widget _composer(PifSession? selected) => Container(
    padding: const EdgeInsets.fromLTRB(18, 10, 18, 16),
    decoration: BoxDecoration(
      color: widget.host.theme.panel,
      border: Border(top: BorderSide(color: widget.host.theme.border)),
    ),
    child: Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: _conversationMaxWidth),
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: widget.host.theme.isDark
                ? const Color(0xff242424)
                : widget.host.theme.panelRaised,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: widget.host.theme.border),
          ),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(14, 8, 8, 7),
            child: Column(
              children: [
                TextField(
                  key: const Key('agent_console_composer'),
                  controller: controller,
                  minLines: 1,
                  maxLines: 6,
                  onSubmitted: (_) => submit(),
                  enabled: selected != null,
                  style: TextStyle(
                    fontSize: 14,
                    color: widget.host.theme.textPrimary,
                  ),
                  decoration: InputDecoration(
                    hintText: selected == null
                        ? 'Create a session to begin…'
                        : running
                        ? 'Steer the running agent…'
                        : 'Ask Pi anything…',
                    hintStyle: TextStyle(
                      fontSize: 14,
                      color: widget.host.theme.textMuted,
                    ),
                    isDense: true,
                    border: InputBorder.none,
                  ),
                ),
                const SizedBox(height: 5),
                LayoutBuilder(
                  builder: (context, constraints) {
                    final narrow = constraints.maxWidth < 560;
                    if (narrow) {
                      return Wrap(
                        spacing: 4,
                        runSpacing: 4,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          _attachmentsButton(),
                          const Icon(
                            Icons.lock_open_outlined,
                            size: 14,
                            color: Color(0xffcf8d55),
                          ),
                          SizedBox(width: 112, child: _workspaceAccessLabel()),
                          if (selected != null) ...[
                            SizedBox(
                              width: 136,
                              child: _modelSelector(selected),
                            ),
                            SizedBox(
                              width: 90,
                              child: _thinkingSelector(selected),
                            ),
                          ],
                          if (running) _steerButton(),
                          _voiceButton(),
                          _sendButton(selected),
                        ],
                      );
                    }
                    return Row(
                      children: [
                        _attachmentsButton(),
                        const SizedBox(width: 4),
                        const Icon(
                          Icons.lock_open_outlined,
                          size: 14,
                          color: Color(0xffcf8d55),
                        ),
                        const SizedBox(width: 4),
                        // Shrinks before the send button can clip (#160 dogfood:
                        // the 440px console overlay overflowed this row).
                        Flexible(child: _workspaceAccessLabel()),
                        const Spacer(),
                        if (selected != null) ...[
                          Flexible(child: _modelSelector(selected)),
                          const SizedBox(width: 5),
                          Flexible(child: _thinkingSelector(selected)),
                          const SizedBox(width: 5),
                        ],
                        if (running) _steerButton(),
                        _voiceButton(),
                        _sendButton(selected),
                      ],
                    );
                  },
                ),
              ],
            ),
          ),
        ),
      ),
    ),
  );

  Widget _attachmentsButton() => Tooltip(
    message: 'Attachments are not available yet',
    child: IconButton(
      key: const Key('agent_console_add'),
      onPressed: null,
      icon: const Icon(Icons.add, size: 18),
      color: widget.host.theme.textMuted,
      visualDensity: VisualDensity.compact,
    ),
  );

  Widget _workspaceAccessLabel() => const Text(
    'Workspace access',
    maxLines: 1,
    overflow: TextOverflow.ellipsis,
    style: TextStyle(fontSize: 11, color: Color(0xffcf8d55)),
  );

  Widget _steerButton() => TextButton.icon(
    key: const Key('agent_console_steer'),
    onPressed: submit,
    icon: const Icon(Icons.arrow_upward, size: 14),
    label: const Text('Steer'),
    style: TextButton.styleFrom(
      foregroundColor: widget.host.theme.textMuted,
      padding: const EdgeInsets.symmetric(horizontal: 7),
      minimumSize: const Size(0, 30),
    ),
  );

  Widget _voiceButton() => const Tooltip(
    message: 'Voice input is not available yet',
    child: IconButton(
      onPressed: null,
      icon: Icon(Icons.mic_none, size: 17),
      visualDensity: VisualDensity.compact,
    ),
  );

  Widget _sendButton(PifSession? selected) => IconButton.filled(
    key: const Key('agent_console_send'),
    onPressed: selected == null
        ? null
        : running
        ? () => widget.host.sessions.abort(widget.host.activeSessionId)
        : submit,
    tooltip: running ? 'Abort agent' : 'Send message',
    style: IconButton.styleFrom(
      backgroundColor: running
          ? const Color(0xff9c5b5b)
          : widget.host.theme.accent,
      foregroundColor: widget.host.theme.isDark
          ? const Color(0xff10141c)
          : Colors.white,
      disabledBackgroundColor: widget.host.theme.panelRaised,
      disabledForegroundColor: widget.host.theme.textMuted,
    ),
    icon: Icon(running ? Icons.stop_rounded : Icons.arrow_upward, size: 18),
  );

  Widget _modelSelector(PifSession selected) {
    final resolved = _resolvedModelValue(selected);
    return SizedBox(
      width: 136,
      child: DropdownButtonHideUnderline(
        child: DropdownButton<String>(
          isDense: true,
          isExpanded: true,
          iconSize: 14,
          style: TextStyle(fontSize: 11, color: widget.host.theme.textMuted),
          value: resolved,
          hint: const Text(
            'Model',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(fontSize: 11),
          ),
          items: [
            const DropdownMenuItem(
              value: '',
              child: Text(
                'Default',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            ...widget.host.models.map(
              (model) => DropdownMenuItem(
                value: model,
                child: Text(
                  model.split('/').last,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ),
            if (resolved != null && !widget.host.models.contains(resolved))
              DropdownMenuItem(
                value: resolved,
                child: Text(
                  resolved.split('/').last,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
          ],
          onChanged: (value) => widget.host.sessions.setModel(
            widget.host.activeSessionId,
            value ?? '',
          ),
        ),
      ),
    );
  }

  Widget _thinkingSelector(PifSession selected) => SizedBox(
    width: 90,
    child: DropdownButtonHideUnderline(
      child: DropdownButton<String>(
        isDense: true,
        isExpanded: true,
        iconSize: 14,
        style: TextStyle(fontSize: 11, color: widget.host.theme.textMuted),
        value: selected.thinking,
        items: const [
          DropdownMenuItem(
            value: 'none',
            child: Text('None', maxLines: 1, overflow: TextOverflow.ellipsis),
          ),
          DropdownMenuItem(
            value: 'low',
            child: Text('Low', maxLines: 1, overflow: TextOverflow.ellipsis),
          ),
          DropdownMenuItem(
            value: 'medium',
            child: Text('Medium', maxLines: 1, overflow: TextOverflow.ellipsis),
          ),
          DropdownMenuItem(
            value: 'high',
            child: Text('High', maxLines: 1, overflow: TextOverflow.ellipsis),
          ),
          DropdownMenuItem(
            value: 'max',
            child: Text('Max', maxLines: 1, overflow: TextOverflow.ellipsis),
          ),
        ],
        onChanged: (value) => widget.host.sessions.setThinking(
          widget.host.activeSessionId,
          value ?? 'medium',
        ),
      ),
    ),
  );
}

class _ConsoleEmpty extends StatelessWidget {
  const _ConsoleEmpty();
  @override
  Widget build(BuildContext context) => Center(
    child: SingleChildScrollView(
      padding: const EdgeInsets.all(8),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.auto_awesome,
            size: 34,
            color: Theme.of(context).colorScheme.primary,
          ),
          const SizedBox(height: 12),
          const Text(
            'Build the workspace with Pi',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w300),
          ),
          const SizedBox(height: 4),
          Text(
            'Messages, tool calls, and live output appear here.',
            style: TextStyle(
              color: PifTheme(
                brightness: Theme.of(context).brightness,
              ).textMuted,
            ),
          ),
        ],
      ),
    ),
  );
}

class _EntryCard extends StatelessWidget {
  const _EntryCard({required this.entry});
  final Map<String, dynamic> entry;

  /// Conversation text: small and light, with the user turn separated by a
  /// restrained bubble and assistant output left open for scanning.
  static const TextStyle _conversationStyle = TextStyle(
    fontSize: 13,
    fontWeight: FontWeight.w300,
  );

  @override
  Widget build(BuildContext context) {
    final kind = entry['kind'] as String? ?? 'raw';
    final text = entry['text'] as String? ?? '';
    final theme = PifTheme(brightness: Theme.of(context).brightness);
    final conversationStyle = _conversationStyle.copyWith(
      color: theme.isDark ? const Color(0xffc9d3df) : theme.textPrimary,
    );

    if (kind == 'user') {
      return Align(
        alignment: Alignment.centerRight,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 620),
          child: Container(
            key: const Key('agent_console_user_bubble'),
            margin: const EdgeInsets.only(bottom: 16, left: 40),
            padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 11),
            decoration: BoxDecoration(
              color: theme.isDark ? const Color(0xff2b2b2b) : theme.panelRaised,
              borderRadius: const BorderRadius.only(
                topLeft: Radius.circular(16),
                topRight: Radius.circular(16),
                bottomLeft: Radius.circular(16),
                bottomRight: Radius.circular(5),
              ),
            ),
            child: SelectableText(text, style: conversationStyle),
          ),
        ),
      );
    }

    if (kind == 'assistant') {
      return Padding(
        key: const Key('agent_console_assistant_lane'),
        padding: const EdgeInsets.only(bottom: 16, right: 22),
        child: MarkdownBody(
          data: text,
          styleSheet: MarkdownStyleSheet.fromTheme(Theme.of(context)).copyWith(
            p: conversationStyle,
            listBullet: conversationStyle,
            blockquote: conversationStyle.copyWith(color: theme.textMuted),
          ),
        ),
      );
    }

    if (kind == 'tool') {
      final name = entry['name'] as String? ?? 'tool';
      final status = entry['status'] as String? ?? 'running';
      final detail = entry['detail'] as String? ?? '';
      final trailingIcon = status == 'done'
          ? Icons.check_circle
          : status == 'failed'
          ? Icons.error_outline
          : status == 'canceled'
          ? Icons.cancel_outlined
          : null;
      final trailingColor = status == 'done'
          ? theme.accent
          : status == 'failed'
          ? Theme.of(context).colorScheme.error
          : theme.isDark
          ? Colors.amber
          : const Color(0xff805600);
      return Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 2),
        decoration: BoxDecoration(
          color: theme.isDark ? const Color(0xff20241f) : theme.panelRaised,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: theme.border),
        ),
        child: Material(
          type: MaterialType.transparency,
          child: ExpansionTile(
            tilePadding: EdgeInsets.zero,
            leading: Icon(Icons.build_outlined, size: 18, color: trailingColor),
            title: Text(
              name,
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w300),
            ),
            trailing: trailingIcon != null
                ? Icon(trailingIcon, size: 16, color: trailingColor)
                : const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
            children: [
              SelectableText(
                detail,
                style: const TextStyle(fontFamily: 'monospace', fontSize: 11),
              ),
            ],
          ),
        ),
      );
    }

    if (kind == 'error') {
      final title = entry['title'] as String? ?? 'Error';
      final detail = entry['detail'] as String? ?? '';
      final status = entry['status'] as String? ?? 'failed';
      final color = status == 'canceled'
          ? Colors.amber
          : const Color(0xfff28b82);
      return Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 8),
        decoration: BoxDecoration(
          color: const Color(0xff26191b),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: const Color(0xff5d2c31)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              status == 'canceled'
                  ? Icons.cancel_outlined
                  : Icons.error_outline,
              size: 18,
              color: color,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w300,
                      color: Color(0xfff28b82),
                    ),
                  ),
                  if (detail.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    SelectableText(
                      detail,
                      style: const TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 11,
                        color: Color(0xfff2c7c9),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      );
    }

    if (kind == 'status') {
      return Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Row(
          children: [
            Icon(Icons.circle, size: 6, color: theme.accent),
            const SizedBox(width: 6),
            Text(text, style: TextStyle(fontSize: 11, color: theme.textMuted)),
          ],
        ),
      );
    }

    if (kind == 'turn_end') {
      return _TurnEndCard(entry: entry);
    }

    // raw
    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: theme.isDark ? const Color(0xff10141c) : theme.panelRaised,
        borderRadius: BorderRadius.circular(6),
      ),
      child: SelectableText(
        text,
        style: TextStyle(
          fontFamily: 'monospace',
          fontSize: 11,
          color: theme.textMuted,
        ),
      ),
    );
  }
}

/// Compact footer at the end of an agent turn: ✓ + duration + copy actions
/// for the turn's response, Codex-style.
class _TurnEndCard extends StatefulWidget {
  const _TurnEndCard({required this.entry});
  final Map<String, dynamic> entry;
  @override
  State<_TurnEndCard> createState() => _TurnEndCardState();
}

class _TurnEndCardState extends State<_TurnEndCard> {
  String? copied;
  bool expanded = false;

  @override
  Widget build(BuildContext context) {
    final entry = widget.entry;
    final theme = PifTheme(brightness: Theme.of(context).brightness);
    final duration = entry['duration'] as Duration?;
    final response = entry['response'] as String? ?? '';
    final aborted = entry['aborted'] == true;
    final failed = entry['failed'] == true;
    final codeBlocks = _codeBlocks(response);
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          InkWell(
            key: const Key('agent_console_turn_summary'),
            borderRadius: BorderRadius.circular(6),
            onTap: () => setState(() => expanded = !expanded),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 3),
              child: Row(
                children: [
                  Icon(
                    aborted
                        ? Icons.stop_outlined
                        : failed
                        ? Icons.error_outline
                        : Icons.check_circle,
                    size: 13,
                    color: aborted
                        ? Colors.amber
                        : failed
                        ? const Color(0xfff28b82)
                        : theme.accent,
                  ),
                  const SizedBox(width: 7),
                  Text(
                    'Worked for',
                    style: TextStyle(fontSize: 11, color: theme.textMuted),
                  ),
                  if (duration != null) ...[
                    const SizedBox(width: 4),
                    Text(
                      _formatDuration(duration),
                      style: TextStyle(fontSize: 11, color: theme.textMuted),
                    ),
                  ],
                  if (aborted || failed) ...[
                    const SizedBox(width: 6),
                    Text(
                      aborted ? 'aborted' : 'failed',
                      style: TextStyle(
                        fontSize: 11,
                        color: aborted ? Colors.amber : const Color(0xfff28b82),
                      ),
                    ),
                  ],
                  Icon(
                    expanded ? Icons.keyboard_arrow_down : Icons.chevron_right,
                    size: 15,
                    color: const Color(0xff737373),
                  ),
                  const SizedBox(width: 8),
                  if (response.isNotEmpty)
                    _copyAction(
                      key: 'response',
                      tooltip: 'Copy response',
                      icon: Icons.content_copy,
                      onCopy: () => response,
                    ),
                  if (codeBlocks != null && codeBlocks.isNotEmpty)
                    _copyAction(
                      key: 'code',
                      tooltip: 'Copy code blocks',
                      icon: Icons.code,
                      onCopy: () => codeBlocks,
                    ),
                ],
              ),
            ),
          ),
          if (expanded)
            Padding(
              padding: const EdgeInsets.only(left: 27, top: 4),
              child: Text(
                aborted
                    ? 'The agent was stopped before the turn completed.'
                    : failed
                    ? 'The agent failed before the turn completed.'
                    : 'Turn complete. Tap the response actions to copy output.',
                style: const TextStyle(fontSize: 11, color: Color(0xff737373)),
              ),
            ),
        ],
      ),
    );
  }

  Widget _copyAction({
    required String key,
    required String tooltip,
    required IconData icon,
    required String Function() onCopy,
  }) => Tooltip(
    message: tooltip,
    child: InkWell(
      borderRadius: BorderRadius.circular(4),
      onTap: () {
        Clipboard.setData(ClipboardData(text: onCopy()));
        setState(() => copied = key);
        Future.delayed(const Duration(seconds: 1), () {
          if (mounted) setState(() => copied = null);
        });
      },
      child: Padding(
        padding: const EdgeInsets.all(4),
        child: Icon(
          copied == key ? Icons.check : icon,
          size: 13,
          color: PifTheme(brightness: Theme.of(context).brightness).textMuted,
        ),
      ),
    ),
  );

  String? _codeBlocks(String markdown) {
    final blocks = RegExp(r'```[^\n]*\n([\s\S]*?)```')
        .allMatches(markdown)
        .map((match) => match.group(1)?.trim() ?? '')
        .where((block) => block.isNotEmpty)
        .toList();
    return blocks.isEmpty ? null : blocks.join('\n\n');
  }

  String _formatDuration(Duration duration) {
    if (duration.inSeconds < 60) return '${duration.inSeconds}s';
    if (duration.inMinutes < 60) {
      return '${duration.inMinutes}m ${duration.inSeconds % 60}s';
    }
    return '${duration.inHours}h ${duration.inMinutes % 60}m';
  }
}
