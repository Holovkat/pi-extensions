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
    final fresh = _buildEntries(rawItems);
    // A delta continues the previous assistant message rather than
    // starting a new card.
    for (final entry in fresh) {
      if ((entry['kind'] == 'assistant' ||
              entry['kind'] == 'turn_end') &&
          into.isNotEmpty &&
          into.last['kind'] == entry['kind'] &&
          entry['kind'] == 'assistant') {
        into.last['text'] = '${into.last['text']}${entry['text']}';
      } else {
        into.add(entry);
      }
    }
  }

  List<Map<String, dynamic>> _buildEntries(List<dynamic> transcript) {
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
        entries.add({
          'kind': 'user',
          'text': data['content'] ?? event['content'] ?? '',
        });
      } else if (type == 'message_update' || type == 'message_start') {
        final delta = _extractDelta(data);
        if (delta != null && delta.isNotEmpty) {
          if (entries.isNotEmpty && entries.last['kind'] == 'assistant') {
            entries.last['text'] = '${entries.last['text']}$delta';
          } else {
            entries.add({'kind': 'assistant', 'text': delta});
          }
        }
      } else if (type == 'message_end' || type == 'message') {
        final text = _extractFullText(data);
        if (text != null && text.isNotEmpty) {
          if (entries.isNotEmpty && entries.last['kind'] == 'assistant') {
            entries.last['text'] = text;
          } else {
            entries.add({'kind': 'assistant', 'text': text});
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
        turnStartTs = event['ts'] as String? ?? data['ts'] as String?;
        turnStartIndex = entries.length;
        entries.add({'kind': 'status', 'text': 'Agent started'});
      } else if (type == 'agent_end') {
        final response = entries
            .skip(turnStartIndex + 1)
            .where((entry) => entry['kind'] == 'assistant')
            .map((entry) => entry['text'] as String? ?? '')
            .where((text) => text.isNotEmpty)
            .join('\n\n');
        final endTs = event['ts'] as String? ?? data['ts'] as String?;
        entries.add({
          'kind': 'turn_end',
          if (turnStartTs != null && endTs != null)
            'duration': _durationBetween(turnStartTs, endTs),
          'response': response,
          'aborted': event['aborted'] == true || data['aborted'] == true,
        });
        turnStartIndex = -1;
        turnStartTs = null;
      } else if (type == 'stderr' || type == 'output') {
        final text = data['data']?.toString() ?? '';
        if (text.trim().isNotEmpty) {
          entries.add({'kind': 'raw', 'text': text.trim()});
        }
      }
    }
    return entries;
  }

  Duration? _durationBetween(String start, String end) {
    final duration = DateTime.tryParse(end)?.difference(DateTime.tryParse(start) ?? DateTime.now());
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
    running
        ? widget.host.sessions.steer(widget.host.activeSessionId, value)
        : widget.host.sessions.input(widget.host.activeSessionId, value);
    setState(() {
      entries.add({'kind': 'user', 'text': value});
      controller.clear();
    });
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
    return Column(
      children: [
        Container(
          height: 42,
          padding: const EdgeInsets.symmetric(horizontal: 14),
          decoration: BoxDecoration(
            color: widget.host.theme.panelRaised,
            border: Border(
              bottom: BorderSide(color: widget.host.theme.border),
            ),
          ),
          child: Row(
            children: [
              Icon(
                running ? Icons.sync : Icons.auto_awesome,
                size: 16,
                color: running ? Colors.amber : widget.host.theme.accent,
              ),
              const SizedBox(width: 8),
              // The session title; double-click renames it inline — the
              // editing field keeps the same typography, just a caret.
              if (editingName)
                SizedBox(
                  width: 220,
                  child: TextField(
                    controller: nameController,
                    focusNode: nameFocus,
                    autofocus: true,
                    style: const TextStyle(fontWeight: FontWeight.w300),
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
                  onDoubleTap:
                      selected == null
                          ? null
                          : () => _startRename(selected.name),
                  child: Text(
                    selected?.name ?? 'Host session',
                    style: const TextStyle(fontWeight: FontWeight.w300),
                  ),
                ),
              const Spacer(),
              // On-the-fly model selector
              SizedBox(
                width: 140,
                child: DropdownButtonHideUnderline(
                  child: Builder(
                    builder: (context) {
                      final resolved = _resolvedModelValue(selected);
                      return DropdownButton<String>(
                        isDense: true,
                        iconSize: 14,
                        style: const TextStyle(fontSize: 11, color: Color(0xff8b96aa)),
                        value: resolved,
                        hint: const Text('Default', style: TextStyle(fontSize: 11, color: Color(0xff69758a))),
                        items: [
                          const DropdownMenuItem(value: '', child: Text('Default')),
                          ...widget.host.models.map(
                            (m) => DropdownMenuItem(
                              value: m,
                              child: Text(m.split('/').last),
                            ),
                          ),
                          if (resolved != null &&
                              !widget.host.models.contains(resolved))
                            DropdownMenuItem(
                              value: resolved,
                              child: Text(resolved.split('/').last),
                            ),
                        ],
                        onChanged: (v) => widget.host.sessions
                            .setModel(widget.host.activeSessionId, v ?? ''),
                      );
                    },
                  ),
                ),
              ),
              const SizedBox(width: 8),
              // On-the-fly thinking selector
              SizedBox(
                width: 90,
                child: DropdownButtonHideUnderline(
                  child: DropdownButton<String>(
                    isDense: true,
                    iconSize: 14,
                    style: const TextStyle(fontSize: 11, color: Color(0xff8b96aa)),
                    value: selected?.thinking ?? 'medium',
                    items: const [
                      DropdownMenuItem(value: 'none', child: Text('None')),
                      DropdownMenuItem(value: 'low', child: Text('Low')),
                      DropdownMenuItem(value: 'medium', child: Text('Medium')),
                      DropdownMenuItem(value: 'high', child: Text('High')),
                      DropdownMenuItem(value: 'max', child: Text('Max')),
                    ],
                    onChanged: (v) => widget.host.sessions
                        .setThinking(widget.host.activeSessionId, v ?? 'medium'),
                  ),
                ),
              ),
              if (running) ...[
                const SizedBox(width: 8),
                TextButton.icon(
                  onPressed: () =>
                      widget.host.sessions.abort(widget.host.activeSessionId),
                  icon: const Icon(Icons.stop_circle_outlined, size: 16),
                  label: const Text('Abort'),
                ),
              ],
            ],
          ),
        ),
        // No per-session strip: the Session Rail switches sessions; the
        // header title carries the active name.
        Expanded(
          child: entries.isEmpty
              ? const _ConsoleEmpty()
              : ListView.builder(
                  controller: scroll,
                  padding: const EdgeInsets.all(18),
                  itemCount: entries.length,
                  itemBuilder: (_, index) =>
                      _EntryCard(entry: entries[index]),
                ),
        ),
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: widget.host.theme.panelRaised,
            border: Border(
              top: BorderSide(color: widget.host.theme.border),
            ),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Expanded(
                child: TextField(
                  controller: controller,
                  minLines: 1,
                  maxLines: 6,
                  onSubmitted: (_) => submit(),
                  decoration: InputDecoration(
                    hintText: running
                        ? 'Steer the running agent…'
                        : 'Ask Pi anything…',
                    filled: true,
                    fillColor: widget.host.theme.panel,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10),
                      borderSide: BorderSide.none,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              IconButton.filled(
                onPressed: submit,
                icon: Icon(
                  running ? Icons.turn_right : Icons.arrow_upward,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
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

  /// Conversation text: small, light, and unboxed — no paneling around
  /// host-session messages.
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
        child: Padding(
          padding: const EdgeInsets.only(bottom: 10, left: 40),
          child: SelectableText(text, style: _conversationStyle),
        ),
      );
    }

    if (kind == 'assistant') {
      return Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: MarkdownBody(
          data: text,
          styleSheet: MarkdownStyleSheet.fromTheme(
            Theme.of(context),
          ).copyWith(
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
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: const Color(0xff17241f),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: const Color(0xff315844)),
        ),
        child: ExpansionTile(
          tilePadding: EdgeInsets.zero,
          leading: Icon(
            Icons.build_outlined,
            size: 18,
            color: status == 'done'
                ? const Color(0xff78dba9)
                : Colors.amber,
          ),
          title: Text(
            name,
            style: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w300,
            ),
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
              style: const TextStyle(
                fontFamily: 'monospace',
                fontSize: 11,
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
            const Icon(Icons.circle, size: 6, color: Color(0xff78dba9)),
            const SizedBox(width: 6),
            Text(
              text,
              style: const TextStyle(
                fontSize: 11,
                color: Color(0xff8b96aa),
              ),
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

  @override
  Widget build(BuildContext context) {
    final entry = widget.entry;
    final duration = entry['duration'] as Duration?;
    final response = entry['response'] as String? ?? '';
    final aborted = entry['aborted'] == true;
    final codeBlocks = _codeBlocks(response);
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        children: [
          Icon(
            aborted ? Icons.stop_outlined : Icons.check_circle,
            size: 13,
            color: aborted ? Colors.amber : const Color(0xff78dba9),
          ),
          if (duration != null) ...[
            const SizedBox(width: 6),
            Text(
              _formatDuration(duration),
              style: const TextStyle(fontSize: 11, color: Color(0xff8b96aa)),
            ),
          ],
          if (aborted) ...[
            const SizedBox(width: 6),
            const Text(
              'aborted',
              style: TextStyle(fontSize: 11, color: Colors.amber),
            ),
          ],
          const Spacer(),
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
