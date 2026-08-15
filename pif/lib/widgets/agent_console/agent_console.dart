import 'dart:async';
import 'package:flutter/material.dart';
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
  final entriesBySession = <String, List<Map<String, dynamic>>>{};
  final runningBySession = <String, bool>{};
  List<Map<String, dynamic>> get entries => entriesBySession.putIfAbsent(
    widget.host.activeSessionId,
    () => <Map<String, dynamic>>[],
  );
  bool get running => runningBySession[widget.host.activeSessionId] ?? false;

  @override
  void initState() {
    super.initState();
    _hydrate(widget.host.sessions.current);
    subscription = widget.host.sessions.changes.listen((sessions) {
      _hydrate(sessions);
      if (mounted) setState(() {});
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (scroll.hasClients) {
          scroll.animateTo(
            scroll.position.maxScrollExtent,
            duration: const Duration(milliseconds: 150),
            curve: Curves.easeOut,
          );
        }
      });
    });
  }

  void _hydrate(List<PifSession> sessions) {
    for (final session in sessions) {
      runningBySession[session.id] = session.state == 'running';
      entriesBySession[session.id] = _buildEntries(session.transcript);
    }
    entriesBySession.removeWhere(
      (id, _) => sessions.every((session) => session.id != id),
    );
    runningBySession.removeWhere(
      (id, _) => sessions.every((session) => session.id != id),
    );
  }

  List<Map<String, dynamic>> _buildEntries(List<dynamic> transcript) {
    final entries = <Map<String, dynamic>>[];
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
        entries.add({'kind': 'status', 'text': 'Agent started'});
      } else if (type == 'agent_end') {
        entries.add({'kind': 'status', 'text': 'Agent finished'});
      } else if (type == 'stderr' || type == 'output') {
        final text = data['data']?.toString() ?? '';
        if (text.trim().isNotEmpty) {
          entries.add({'kind': 'raw', 'text': text.trim()});
        }
      }
    }
    return entries;
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
    controller.dispose();
    scroll.dispose();
    super.dispose();
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
              Text(
                selected?.name ?? 'Host session',
                style: const TextStyle(fontWeight: FontWeight.w300),
              ),
              const Spacer(),
              // On-the-fly model selector
              SizedBox(
                width: 140,
                child: DropdownButtonHideUnderline(
                  child: DropdownButton<String>(
                    isDense: true,
                    iconSize: 14,
                    style: const TextStyle(fontSize: 11, color: Color(0xff8b96aa)),
                    value: (selected != null &&
                            selected.model.isNotEmpty &&
                            widget.host.models.contains(selected.model)
                        ? selected.model
                        : null),
                    hint: const Text('Default', style: TextStyle(fontSize: 11, color: Color(0xff69758a))),
                    items: [
                      const DropdownMenuItem(value: '', child: Text('Default')),
                      ...widget.host.models.map(
                        (m) => DropdownMenuItem(
                          value: m,
                          child: Text(m.split('/').last),
                        ),
                      ),
                    ],
                    onChanged: (v) => widget.host.sessions
                        .setModel(widget.host.activeSessionId, v ?? ''),
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
        if (widget.host.sessions.current.isNotEmpty)
          SizedBox(
            height: 34,
            child: ListView(
              scrollDirection: Axis.horizontal,
              children: widget.host.sessions.current
                  .map(
                    (session) => TextButton(
                      onPressed: () =>
                          widget.host.sessions.select(session.id),
                      style: TextButton.styleFrom(
                        backgroundColor:
                            session.id == widget.host.activeSessionId
                            ? const Color(0xff222c36)
                            : Colors.transparent,
                      ),
                      child: Text(session.name),
                    ),
                  )
                  .toList(),
            ),
          ),
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
  @override
  Widget build(BuildContext context) {
    final kind = entry['kind'] as String? ?? 'raw';
    final text = entry['text'] as String? ?? '';

    if (kind == 'user') {
      return Align(
        alignment: Alignment.centerRight,
        child: Container(
          margin: const EdgeInsets.only(bottom: 10, left: 40),
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: const Color(0xff222936),
            borderRadius: BorderRadius.circular(10),
          ),
          child: SelectableText(text),
        ),
      );
    }

    if (kind == 'assistant') {
      return Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: const Color(0xff151922),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: const Color(0xff2c3547)),
        ),
        child: MarkdownBody(data: text),
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
