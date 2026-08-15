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
  final eventsBySession = <String, List<Map<String, dynamic>>>{};
  final runningBySession = <String, bool>{};
  List<Map<String, dynamic>> get events => eventsBySession.putIfAbsent(
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
      eventsBySession[session.id] = session.transcript.whereType<Map>().map((
        entry,
      ) {
        final value = Map<String, dynamic>.from(entry);
        final event = value['payload'] ?? value;
        return <String, dynamic>{
          'type': value['type'] as String? ?? 'event',
          'payload': <String, dynamic>{'sessionId': session.id, 'event': event},
        };
      }).toList();
    }
    eventsBySession.removeWhere(
      (id, _) => sessions.every((session) => session.id != id),
    );
    runningBySession.removeWhere(
      (id, _) => sessions.every((session) => session.id != id),
    );
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
      events.add({
        'type': 'input',
        'payload': {'content': value},
      });
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
            border: Border(bottom: BorderSide(color: widget.host.theme.border)),
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
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
              const Spacer(),
              if (running)
                TextButton.icon(
                  onPressed: () =>
                      widget.host.sessions.abort(widget.host.activeSessionId),
                  icon: const Icon(Icons.stop_circle_outlined, size: 16),
                  label: const Text('Abort'),
                ),
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
                      onPressed: () => widget.host.sessions.select(session.id),
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
          child: events.isEmpty
              ? const _ConsoleEmpty()
              : ListView.builder(
                  controller: scroll,
                  padding: const EdgeInsets.all(18),
                  itemCount: events.length,
                  itemBuilder: (_, index) => _EventCard(event: events[index]),
                ),
        ),
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: widget.host.theme.panelRaised,
            border: Border(top: BorderSide(color: widget.host.theme.border)),
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
                icon: Icon(running ? Icons.turn_right : Icons.arrow_upward),
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
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
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

class _EventCard extends StatelessWidget {
  const _EventCard({required this.event});
  final Map<String, dynamic> event;
  @override
  Widget build(BuildContext context) {
    final type = event['type'] as String;
    final payload = event['payload'] as Map<String, dynamic>;
    final data = payload['event'] ?? payload['content'] ?? payload;
    final isTool = type.contains('tool');
    final content = data is String
        ? data
        : data is Map && data['delta'] is String
        ? data['delta'] as String
        : data.toString();
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: isTool
            ? const Color(0xff17241f)
            : type == 'input'
            ? const Color(0xff222936)
            : const Color(0xff151922),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: isTool ? const Color(0xff315844) : const Color(0xff2c3547),
        ),
      ),
      child: isTool
          ? ExpansionTile(
              tilePadding: EdgeInsets.zero,
              leading: const Icon(Icons.build_outlined, size: 18),
              title: Text(
                type,
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
              children: [SelectableText(content)],
            )
          : MarkdownBody(data: content),
    );
  }
}
