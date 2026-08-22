import 'dart:async';
import 'package:flutter/material.dart';
import '../../core/plugin.dart';
import '../model_manager/model_manager.dart';

class SessionRailPlugin implements PifWidgetPlugin {
  @override
  PifWidgetMeta get meta => const PifWidgetMeta(
    id: 'session_rail',
    name: 'Sessions',
    slot: PifSlot.left,
    core: true,
  );
  @override
  Widget build(BuildContext context, PifHost host) => _SessionRail(host: host);
}

class _SessionRail extends StatefulWidget {
  const _SessionRail({required this.host});
  final PifHost host;
  @override
  State<_SessionRail> createState() => _SessionRailState();
}

class _SessionRailState extends State<_SessionRail> {
  late StreamSubscription subscription;
  String? renamingId;
  final renameController = TextEditingController();
  final renameFocus = FocusNode();
  @override
  void initState() {
    super.initState();
    renameFocus.addListener(() {
      if (!renameFocus.hasFocus && renamingId != null) _commitRename();
    });
    subscription = widget.host.sessions.changes.listen((_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    subscription.cancel();
    renameController.dispose();
    renameFocus.dispose();
    super.dispose();
  }

  void _commitRename() {
    final name = renameController.text.trim();
    final id = renamingId;
    setState(() => renamingId = null);
    if (id != null && name.isNotEmpty) {
      widget.host.sessions.rename(id, name);
    }
  }

  Future<void> _cardMenu(Offset position, PifSession session) async {
    final overlay = Overlay.of(context).context.findRenderObject() as RenderBox;
    final selected = await showMenu<String>(
      context: context,
      position: RelativeRect.fromLTRB(
        position.dx,
        position.dy,
        overlay.size.width - position.dx,
        overlay.size.height - position.dy,
      ),
      items: [
        const PopupMenuItem(value: 'rename', child: Text('Rename')),
        if (session.state == 'ended')
          const PopupMenuItem(value: 'resume', child: Text('Resume')),
        if (!session.host)
          const PopupMenuItem(value: 'delete', child: Text('Delete')),
      ],
    );
    if (!mounted) return;
    if (selected == 'rename') {
      renameController.text = session.name;
      setState(() => renamingId = session.id);
    } else if (selected == 'resume') {
      widget.host.sessions.resume(session.id);
    } else if (selected == 'delete') {
      await _confirmDelete(session);
    }
  }

  Future<void> _confirmDelete(PifSession session) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder:
          (context) => AlertDialog(
            title: Text('Delete ${session.name}?'),
            content: const Text(
              'This permanently removes the session — its transcript and '
              'history cannot be recovered.',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(context).pop(false),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: () => Navigator.of(context).pop(true),
                child: const Text('Delete'),
              ),
            ],
          ),
    );
    if (confirmed == true) widget.host.sessions.delete(session.id);
  }

  Future<void> create() async {
    final cwd = TextEditingController(text: widget.host.workspace);
    final prompt = TextEditingController();
    String? selectedModel;
    String selectedThinking = 'medium';
    await showDialog<void>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text('New session'),
          content: SizedBox(
            width: 420,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: cwd,
                  decoration: const InputDecoration(
                    labelText: 'Working directory',
                  ),
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  decoration: const InputDecoration(labelText: 'Model'),
                  initialValue: selectedModel,
                  items: [
                    const DropdownMenuItem(value: '', child: Text('Default')),
                    ...widget.host.models.map(
                      (m) => DropdownMenuItem(
                        value: m,
                        child: Text(m.split('/').last),
                      ),
                    ),
                  ],
                  onChanged: (v) => setDialogState(() => selectedModel = v),
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  decoration: const InputDecoration(labelText: 'Thinking'),
                  initialValue: selectedThinking,
                  items: const [
                    DropdownMenuItem(value: 'none', child: Text('None')),
                    DropdownMenuItem(value: 'low', child: Text('Low')),
                    DropdownMenuItem(value: 'medium', child: Text('Medium')),
                    DropdownMenuItem(value: 'high', child: Text('High')),
                    DropdownMenuItem(value: 'max', child: Text('Max')),
                  ],
                  onChanged: (v) => setDialogState(
                    () => selectedThinking = v ?? 'medium',
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: prompt,
                  maxLines: 3,
                  decoration: const InputDecoration(labelText: 'Prompt preset'),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () {
                widget.host.sessions.spawn(
                  cwd: cwd.text,
                  model: selectedModel?.isEmpty == true
                      ? null
                      : selectedModel,
                  thinking: selectedThinking,
                  prompt: prompt.text.isEmpty ? null : prompt.text,
                );
                Navigator.pop(context);
              },
              child: const Text('Spawn'),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final sessions = widget.host.sessions.current;
    return Material(
      color: widget.host.theme.panel,
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 14, 8, 8),
            child: Row(
              children: [
                const Text(
                  'SESSIONS',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w300,
                    letterSpacing: 1.2,
                    color: Color(0xff8b96aa),
                  ),
                ),
                const Spacer(),
                IconButton(
                  onPressed: () => showModelManagerDialog(context, widget.host),
                  tooltip: 'Model Manager',
                  icon: const Icon(Icons.tune, size: 18),
                ),
                IconButton(
                  onPressed: create,
                  tooltip: 'New session',
                  icon: const Icon(Icons.add, size: 19),
                ),
              ],
            ),
          ),
          Expanded(
            child: ListView(
              children: sessions.map((session) {
                final selected = session.id == widget.host.activeSessionId;
                return GestureDetector(
                  onSecondaryTapUp:
                      (details) => _cardMenu(details.globalPosition, session),
                  child: ListTile(
                    selected: selected,
                    selectedTileColor: const Color(0xff222c36),
                    dense: true,
                    onTap: () {
                      setState(() => widget.host.activeSessionId = session.id);
                      widget.host.sessions.select(session.id);
                      widget.host.layout.open('agent_console');
                    },
                    leading: Icon(
                      session.host
                          ? Icons.home_filled
                          : Icons.smart_toy_outlined,
                      size: 18,
                      color: _stateColor(session.state),
                    ),
                    title:
                        renamingId == session.id
                            ? TextField(
                              controller: renameController,
                              focusNode: renameFocus,
                              autofocus: true,
                              style: const TextStyle(fontSize: 14),
                              decoration: const InputDecoration(
                                isDense: true,
                                isCollapsed: true,
                                border: InputBorder.none,
                              ),
                              onSubmitted: (_) => _commitRename(),
                            )
                            : Text(
                              session.name,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                    subtitle: Text(
                      session.model,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 11),
                    ),
                    trailing: Container(
                      width: 7,
                      height: 7,
                      decoration: BoxDecoration(
                        color: _stateColor(session.state),
                        shape: BoxShape.circle,
                      ),
                    ),
                  ),
                );
              }).toList(),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(10),
            child: SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: create,
                icon: const Icon(Icons.add, size: 16),
                label: const Text('New Session'),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Color _stateColor(String state) => switch (state) {
    'running' => Colors.amber,
    'awaiting-input' => Colors.lightBlueAccent,
    'ended' => Colors.redAccent,
    _ => const Color(0xff78dba9),
  };
}
