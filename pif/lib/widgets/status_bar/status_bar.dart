import 'dart:async';
import 'package:flutter/material.dart';
import '../../core/plugin.dart';

class StatusBarPlugin implements PifWidgetPlugin {
  @override
  PifWidgetMeta get meta => const PifWidgetMeta(
    id: 'status_bar',
    name: 'Status',
    slot: PifSlot.status,
    core: true,
  );
  @override
  Widget build(BuildContext context, PifHost host) => _Status(host: host);
}

class _Status extends StatefulWidget {
  const _Status({required this.host});
  final PifHost host;
  @override
  State<_Status> createState() => _StatusState();
}

class _StatusState extends State<_Status> {
  late StreamSubscription connection;
  late StreamSubscription events;
  bool connected = false;
  String reload = 'idle';
  String model = 'host';
  String tokens = '—';
  @override
  void initState() {
    super.initState();
    connected = widget.host.bus.connected;
    connection = widget.host.bus.connection.listen((value) {
      if (mounted) setState(() => connected = value);
    });
    events = widget.host.bus.events.listen((event) {
      if (event.channel.startsWith('widget/reload')) {
        final value = event.payload as Map?;
        if (mounted)
          setState(() => reload = value?['ok'] == false ? 'failed' : 'ready');
      }
      if (event.channel.startsWith('session/')) {
        final payload = event.payload as Map?;
        final data = payload?['event'] as Map?;
        if (mounted && data != null)
          setState(() {
            model = '${data['model'] ?? model}';
            tokens = '${data['usage']?['totalTokens'] ?? tokens}';
          });
      }
    });
  }

  @override
  void dispose() {
    connection.cancel();
    events.cancel();
    super.dispose();
  }

  Future<void> _confirmReset(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder:
          (context) => AlertDialog(
            title: const Text('Reset layout?'),
            content: const Text(
              'Panels return to the default docking design. '
              'Your current arrangement is discarded.',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(context).pop(false),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: () => Navigator.of(context).pop(true),
                child: const Text('Reset'),
              ),
            ],
          ),
    );
    if (confirmed == true) widget.host.layout.reset();
  }

  @override
  Widget build(BuildContext context) => Container(
    color: widget.host.theme.panelRaised,
    padding: const EdgeInsets.symmetric(horizontal: 10),
    child: Row(
      children: [
        Icon(
          connected ? Icons.link : Icons.link_off,
          size: 13,
          color: connected ? widget.host.theme.accent : Colors.redAccent,
        ),
        const SizedBox(width: 5),
        Text(
          connected ? 'Hub connected' : 'Reconnecting',
          style: const TextStyle(fontSize: 11),
        ),
        const SizedBox(width: 18),
        const Icon(Icons.refresh, size: 13),
        const SizedBox(width: 4),
        Text(reload, style: const TextStyle(fontSize: 11)),
        const SizedBox(width: 14),
        Tooltip(
          message: 'Reset layout to default',
          child: InkWell(
            onTap: () => _confirmReset(context),
            child: const Padding(
              padding: EdgeInsets.symmetric(horizontal: 4),
              child: Icon(Icons.restore, size: 13),
            ),
          ),
        ),
        const Spacer(),
        Text(
          '$model · $tokens tokens',
          style: TextStyle(fontSize: 11, color: widget.host.theme.textMuted),
        ),
        const SizedBox(width: 18),
        Flexible(
          child: Text(
            widget.host.workspace,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(fontSize: 11, color: widget.host.theme.textMuted),
          ),
        ),
      ],
    ),
  );
}
