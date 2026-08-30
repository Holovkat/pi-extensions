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
      final seen = processedEvents[session.id] ?? 0;
      final transcript = session.transcript;
      if (seen > transcript.length) {
        // History was replaced (snapshot) — rebuild this session.
        processedEvents[session.id] = transcript.length;
        entriesBySession[session.id] = _buildEntries(transcript);
        continue;
      }
      if (transcript.length == seen) continue;
      final target = entriesBySession.putIfAbsent(
        session.id,
        () => <Map<String, dynamic>>[],
      );
      _appendEntries(transcript.sublist(seen), target);
      processedEvents[session.id] = transcript.length;
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
  }

  void _rebuildAll(List<PifSession> sessions) {
    for (final session in sessions) {
      runningBySession[session.id] = session.state == 'running';
      processedEvents[session.id] = session.transcript.length;
      entriesBySession[session.id] = _buildEntries(session.transcript);
    }
  }

  /// Extend already-built entries with new raw transcript items.
  void _appendEntries(List<dynamic> rawItems, List<Map<String, dynamic>> into) {
    final fresh = _buildEntries(rawItems, finalizeOpenTurn: false);
    // Streaming deltas continue the current assistant card. A final
    // message/message_end is authoritative and replaces the streamed text
    // instead of duplicating it.
    for (final entry in fresh) {
      if (entry['kind'] == 'assistant' &&
          into.isNotEmpty &&
          into.last['kind'] == 'assistant') {
        if (entry['replace'] == true) {
          into.last['text'] = entry['text'];
        } else {
          into.last['text'] = '${into.last['text']}${entry['text']}';
        }
        if (entry['ts'] != null) into.last['ts'] = entry['ts'];
      } else {
        into.add(entry);
      }
    }
    if (fresh.any(
          (entry) => entry['kind'] == 'assistant' && entry['replace'] == true,
        ) &&
        !fresh.any((entry) => entry['kind'] == 'turn_end')) {
      _finalizeOpenTurn(into);
    }
  }

  void _finalizeOpenTurn(List<Map<String, dynamic>> entries) {
    final assistantIndex = _lastAssistantIndex(entries);
    if (assistantIndex < 0 || assistantIndex != entries.length - 1) return;
    final userIndex = entries
        .sublist(0, assistantIndex)
        .lastIndexWhere((entry) => entry['kind'] == 'user');
    if (userIndex < 0) return;
    _appendTurnEnd(
      entries,
      startIndex: userIndex,
      startTs: entries[userIndex]['ts'] as String?,
      endTs: entries[assistantIndex]['ts'] as String?,
    );
  }

  List<Map<String, dynamic>> _buildEntries(
    List<dynamic> transcript, {
    bool finalizeOpenTurn = true,
  }) {
    final entries = <Map<String, dynamic>>[];
    var turnStartIndex = -1;
    String? turnStartTs;
    for (final raw in transcript) {
      if (raw is! Map) continue;
      final event = Map<String, dynamic>.from(raw);
      final type = event['type'] as String? ?? 'event';
      final data = event['payload'] is Map
          ? event['payload'] as Map<String, dynamic>
          : event;

      if (type == 'input') {
        if (turnStartTs != null && _lastAssistantIndex(entries) >= 0) {
          _appendTurnEnd(
            entries,
            startIndex: turnStartIndex,
            startTs: turnStartTs,
            endTs: _lastAssistantTimestamp(entries),
          );
        }
        final timestamp = _eventTimestamp(event, data);
        turnStartTs = timestamp;
        turnStartIndex = entries.length;
        entries.add({
          'kind': 'user',
          'text': data['content'] ?? event['content'] ?? '',
          ..._timestampEntry(timestamp),
        });
      } else if (type == 'message_update' || type == 'message_start') {
        final delta = _extractDelta(data);
        final timestamp = _eventTimestamp(event, data);
        if (delta != null && delta.isNotEmpty) {
          if (entries.isNotEmpty && entries.last['kind'] == 'assistant') {
            entries.last['text'] = '${entries.last['text']}$delta';
            if (timestamp != null) entries.last['ts'] = timestamp;
          } else {
            entries.add({
              'kind': 'assistant',
              'text': delta,
              'replace': false,
              ..._timestampEntry(timestamp),
            });
          }
        }
      } else if (type == 'message_end' || type == 'message') {
        final text = _extractFullText(data);
        final timestamp = _eventTimestamp(event, data);
        if (text != null && text.isNotEmpty) {
          if (entries.isNotEmpty && entries.last['kind'] == 'assistant') {
            entries.last['text'] = text;
            entries.last['replace'] = true;
            if (timestamp != null) entries.last['ts'] = timestamp;
          } else {
            entries.add({
              'kind': 'assistant',
              'text': text,
              'replace': true,
              ..._timestampEntry(timestamp),
            });
          }
        }
      } else if (type.contains('tool')) {
        entries.add({
          'kind': 'tool',
          'name': data['toolName'] ?? data['name'] ?? type,
          'status': type.contains('end') ? 'done' : 'running',
          'detail': data['args'] ?? data['result'] ?? '',
        });
      } else if (type == 'agent_start') {
        turnStartTs = _eventTimestamp(event, data) ?? turnStartTs;
        turnStartIndex = entries.length;
        entries.add({'kind': 'status', 'text': 'Agent started'});
      } else if (type == 'agent_end') {
        _appendTurnEnd(
          entries,
          startIndex: turnStartIndex,
          startTs: turnStartTs,
          endTs: _eventTimestamp(event, data),
          aborted: event['aborted'] == true || data['aborted'] == true,
        );
        turnStartIndex = -1;
        turnStartTs = null;
      } else if (type == 'stderr' || type == 'output') {
        final text = data['data']?.toString() ?? '';
        if (text.trim().isNotEmpty) {
          entries.add({'kind': 'raw', 'text': text.trim()});
        }
      }
    }
    if (finalizeOpenTurn && turnStartTs != null) {
      _appendTurnEnd(
        entries,
        startIndex: turnStartIndex,
        startTs: turnStartTs,
        endTs: _lastAssistantTimestamp(entries),
      );
    }
    return entries;
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
  }) {
    if (entries.isEmpty || entries.last['kind'] == 'turn_end') return;
    final response = entries
        .skip(startIndex + 1)
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
      color: const Color(0xff171717),
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
            color: const Color(0xff242424),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: const Color(0xff343434)),
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
                  style: const TextStyle(fontSize: 14, color: Colors.white),
                  decoration: InputDecoration(
                    hintText: selected == null
                        ? 'Create a session to begin…'
                        : running
                        ? 'Steer the running agent…'
                        : 'Ask Pi anything…',
                    hintStyle: const TextStyle(
                      fontSize: 14,
                      color: Color(0xff8d8d8d),
                    ),
                    isDense: true,
                    border: InputBorder.none,
                  ),
                ),
                const SizedBox(height: 5),
                Row(
                  children: [
                    Tooltip(
                      message: 'Attachments are not available yet',
                      child: IconButton(
                        key: const Key('agent_console_add'),
                        onPressed: null,
                        icon: const Icon(Icons.add, size: 18),
                        color: const Color(0xffb0b0b0),
                        visualDensity: VisualDensity.compact,
                      ),
                    ),
                    const SizedBox(width: 4),
                    const Icon(
                      Icons.lock_open_outlined,
                      size: 14,
                      color: Color(0xffcf8d55),
                    ),
                    const SizedBox(width: 4),
                    // Shrinks before the send button can clip (#160 dogfood:
                    // the 440px console overlay overflowed this row).
                    Flexible(
                      child: Text(
                        'Workspace access',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 11, color: Color(0xffcf8d55)),
                      ),
                    ),
                    const Spacer(),
                    if (selected != null) ...[
                      Flexible(child: _modelSelector(selected)),
                      const SizedBox(width: 5),
                      Flexible(child: _thinkingSelector(selected)),
                      const SizedBox(width: 5),
                    ],
                    if (running)
                      TextButton.icon(
                        key: const Key('agent_console_steer'),
                        onPressed: submit,
                        icon: const Icon(Icons.arrow_upward, size: 14),
                        label: const Text('Steer'),
                        style: TextButton.styleFrom(
                          foregroundColor: const Color(0xffb0b0b0),
                          padding: const EdgeInsets.symmetric(horizontal: 7),
                          minimumSize: const Size(0, 30),
                        ),
                      ),
                    const Tooltip(
                      message: 'Voice input is not available yet',
                      child: IconButton(
                        onPressed: null,
                        icon: Icon(Icons.mic_none, size: 17),
                        visualDensity: VisualDensity.compact,
                      ),
                    ),
                    IconButton.filled(
                      key: const Key('agent_console_send'),
                      onPressed: selected == null
                          ? null
                          : running
                          ? () => widget.host.sessions.abort(
                              widget.host.activeSessionId,
                            )
                          : submit,
                      tooltip: running ? 'Abort agent' : 'Send message',
                      style: IconButton.styleFrom(
                        backgroundColor: running
                            ? const Color(0xff9c5b5b)
                            : widget.host.theme.accent,
                        foregroundColor: const Color(0xff10141c),
                        disabledBackgroundColor: const Color(0xff3b3b3b),
                        disabledForegroundColor: const Color(0xff777777),
                      ),
                      icon: Icon(
                        running ? Icons.stop_rounded : Icons.arrow_upward,
                        size: 18,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    ),
  );

  Widget _modelSelector(PifSession selected) {
    final resolved = _resolvedModelValue(selected);
    return SizedBox(
      width: 136,
      child: DropdownButtonHideUnderline(
        child: DropdownButton<String>(
          isDense: true,
          iconSize: 14,
          style: const TextStyle(fontSize: 11, color: Color(0xffb0b0b0)),
          value: resolved,
          hint: const Text('Model', style: TextStyle(fontSize: 11)),
          items: [
            const DropdownMenuItem(value: '', child: Text('Default')),
            ...widget.host.models.map(
              (model) => DropdownMenuItem(
                value: model,
                child: Text(model.split('/').last),
              ),
            ),
            if (resolved != null && !widget.host.models.contains(resolved))
              DropdownMenuItem(
                value: resolved,
                child: Text(resolved.split('/').last),
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
        iconSize: 14,
        style: const TextStyle(fontSize: 11, color: Color(0xffb0b0b0)),
        value: selected.thinking,
        items: const [
          DropdownMenuItem(value: 'none', child: Text('None')),
          DropdownMenuItem(value: 'low', child: Text('Low')),
          DropdownMenuItem(value: 'medium', child: Text('Medium')),
          DropdownMenuItem(value: 'high', child: Text('High')),
          DropdownMenuItem(value: 'max', child: Text('Max')),
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
  Widget build(BuildContext context) => const Center(
    child: SingleChildScrollView(
      padding: EdgeInsets.all(8),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.auto_awesome, size: 34, color: Color(0xff78dba9)),
          SizedBox(height: 12),
          Text(
            'Build the workspace with Pi',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w300),
          ),
          SizedBox(height: 4),
          Text(
            'Messages, tool calls, and live output appear here.',
            style: TextStyle(color: Color(0xff8b96aa)),
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
    color: Color(0xffc9d3df),
  );

  @override
  Widget build(BuildContext context) {
    final kind = entry['kind'] as String? ?? 'raw';
    final text = entry['text'] as String? ?? '';

    if (kind == 'user') {
      return Align(
        alignment: Alignment.centerRight,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 620),
          child: Container(
            key: const Key('agent_console_user_bubble'),
            margin: const EdgeInsets.only(bottom: 16, left: 40),
            padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 11),
            decoration: const BoxDecoration(
              color: Color(0xff2b2b2b),
              borderRadius: BorderRadius.only(
                topLeft: Radius.circular(16),
                topRight: Radius.circular(16),
                bottomLeft: Radius.circular(16),
                bottomRight: Radius.circular(5),
              ),
            ),
            child: SelectableText(text, style: _conversationStyle),
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
            p: _conversationStyle,
            listBullet: _conversationStyle,
            blockquote: _conversationStyle.copyWith(
              color: const Color(0xff8b96aa),
            ),
          ),
        ),
      );
    }

    if (kind == 'tool') {
      final name = entry['name'] as String? ?? 'tool';
      final status = entry['status'] as String? ?? 'running';
      final detail = entry['detail'] as String? ?? '';
      return Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 2),
        decoration: BoxDecoration(
          color: const Color(0xff20241f),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: const Color(0xff303b34)),
        ),
        child: ExpansionTile(
          tilePadding: EdgeInsets.zero,
          leading: Icon(
            Icons.build_outlined,
            size: 18,
            color: status == 'done' ? const Color(0xff78dba9) : Colors.amber,
          ),
          title: Text(
            name,
            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w300),
          ),
          trailing: status == 'done'
              ? const Icon(
                  Icons.check_circle,
                  size: 16,
                  color: Color(0xff78dba9),
                )
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
      );
    }

    if (kind == 'status') {
      return Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Row(
          children: [
            const Icon(Icons.circle, size: 6, color: Color(0xff78dba9)),
            const SizedBox(width: 6),
            Text(
              text,
              style: const TextStyle(fontSize: 11, color: Color(0xff8b96aa)),
            ),
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
        color: const Color(0xff10141c),
        borderRadius: BorderRadius.circular(6),
      ),
      child: SelectableText(
        text,
        style: const TextStyle(
          fontFamily: 'monospace',
          fontSize: 11,
          color: Color(0xff8b96aa),
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
    final duration = entry['duration'] as Duration?;
    final response = entry['response'] as String? ?? '';
    final aborted = entry['aborted'] == true;
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
                    aborted ? Icons.stop_outlined : Icons.check_circle,
                    size: 13,
                    color: aborted ? Colors.amber : const Color(0xff78dba9),
                  ),
                  const SizedBox(width: 7),
                  const Text(
                    'Worked for',
                    style: TextStyle(fontSize: 11, color: Color(0xff8b96aa)),
                  ),
                  if (duration != null) ...[
                    const SizedBox(width: 4),
                    Text(
                      _formatDuration(duration),
                      style: const TextStyle(
                        fontSize: 11,
                        color: Color(0xff8b96aa),
                      ),
                    ),
                  ],
                  if (aborted) ...[
                    const SizedBox(width: 6),
                    const Text(
                      'aborted',
                      style: TextStyle(fontSize: 11, color: Colors.amber),
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
          color: const Color(0xff8b96aa),
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
