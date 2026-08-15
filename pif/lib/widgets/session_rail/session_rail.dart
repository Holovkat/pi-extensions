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
  @override
  void initState() {
    super.initState();
    subscription = widget.host.sessions.changes.listen((_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    subscription.cancel();
    super.dispose();
  }

  Future<void> create() async {
    final cwd = TextEditingController(text: widget.host.workspace);
    final prompt = TextEditingController();
    final modelController = TextEditingController();
    String? selectedModel;
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
                if (widget.host.models.isNotEmpty)
                  DropdownButtonFormField<String>(
                    decoration: const InputDecoration(labelText: 'Model'),
                    initialValue: selectedModel,
                    items: [
                      const DropdownMenuItem(
                        value: '',
                        child: Text('Default'),
                      ),
                      ...widget.host.models.map(
                        (m) => DropdownMenuItem(
                          value: m,
                          child: Text(m.split('/').last),
                        ),
                      ),
                    ],
                    onChanged: (v) =>
                        setDialogState(() => selectedModel = v),
                  )
                else
                  TextField(
                    controller: modelController,
                    decoration: const InputDecoration(
                      labelText: 'Model (optional)',
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
                final model = widget.host.models.isNotEmpty
                    ? (selectedModel?.isEmpty ?? true
                        ? null
                        : selectedModel)
                    : (modelController.text.isEmpty
                        ? null
                        : modelController.text);
                widget.host.sessions.spawn(
                  cwd: cwd.text,
                  model: model,
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
                    fontWeight: FontWeight.w700,
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
                return ListTile(
                  selected: selected,
                  selectedTileColor: const Color(0xff222c36),
                  dense: true,
                  onTap: () {
                    setState(() => widget.host.activeSessionId = session.id);
                    widget.host.sessions.select(session.id);
                    widget.host.layout.open('agent_console');
                  },
                  leading: Icon(
                    session.host ? Icons.home_filled : Icons.smart_toy_outlined,
                    size: 18,
                    color: _stateColor(session.state),
                  ),
                  title: Text(
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
