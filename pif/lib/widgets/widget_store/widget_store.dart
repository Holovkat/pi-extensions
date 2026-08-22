import 'dart:async';
import 'package:flutter/material.dart';
import '../../core/plugin.dart';

class WidgetStorePlugin implements PifWidgetPlugin {
  @override
  PifWidgetMeta get meta => const PifWidgetMeta(
    id: 'widget_store',
    name: 'Widget Store',
    slot: PifSlot.right,
    core: true,
  );
  @override
  Widget build(BuildContext context, PifHost host) => _Store(host: host);
}

class _Store extends StatefulWidget {
  const _Store({required this.host});
  final PifHost host;
  @override
  State<_Store> createState() => _StoreState();
}

class _StoreState extends State<_Store> {
  late StreamSubscription subscription;
  Map<String, dynamic> installed = {};
  Map<String, dynamic> catalog = {};
  String diagnostics = '';
  @override
  void initState() {
    super.initState();
    _snapshot();
    subscription = widget.host.bus.events.listen((event) {
      if (event.channel.startsWith('widget/') ||
          event.channel.startsWith('store/') ||
          event.type == 'snapshot') {
        if (event.type == 'snapshot' && event.payload is Map)
          widget.host.snapshot = Map<String, dynamic>.from(
            event.payload as Map,
          );
        _snapshot();
        if (event.type == 'reload_result') diagnostics = '${event.payload}';
        if (mounted) setState(() {});
      }
    });
  }

  void _snapshot() {
    installed = Map<String, dynamic>.from(
      widget.host.snapshot['widgets'] as Map? ?? {},
    );
    catalog = Map<String, dynamic>.from(
      widget.host.snapshot['catalog'] as Map? ?? {},
    );
  }

  @override
  void dispose() {
    subscription.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Container(
    color: widget.host.theme.panel,
    child: ListView(
      padding: const EdgeInsets.all(12),
      children: [
        const Text(
          'WIDGET STORE',
          style: TextStyle(
            fontWeight: FontWeight.w300,
            letterSpacing: 1,
            fontSize: 12,
          ),
        ),
        const SizedBox(height: 14),
        _heading('Installed', installed.length),
        for (final entry in installed.entries)
          _installed(entry.key, Map<String, dynamic>.from(entry.value as Map)),
        const SizedBox(height: 18),
        _heading('Local catalog', catalog.length),
        for (final entry in catalog.entries)
          _catalog(entry.key, Map<String, dynamic>.from(entry.value as Map)),
        if (diagnostics.isNotEmpty) ...[
          const SizedBox(height: 18),
          _heading('Compiler / reload', 0),
          Container(
            padding: const EdgeInsets.all(10),
            color: const Color(0xff10141c),
            child: SelectableText(
              diagnostics,
              style: const TextStyle(fontFamily: 'monospace', fontSize: 11),
            ),
          ),
        ],
      ],
    ),
  );
  Widget _heading(String label, int count) => Padding(
    padding: const EdgeInsets.only(bottom: 7),
    child: Text(
      '$label${count > 0 ? '  $count' : ''}',
      style: const TextStyle(
        color: Color(0xff8b96aa),
        fontSize: 11,
        fontWeight: FontWeight.w300,
      ),
    ),
  );
  Widget _installed(String id, Map<String, dynamic> item) => Card(
    child: Padding(
      padding: const EdgeInsets.all(8),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${item['name'] ?? id}',
                  style: const TextStyle(fontWeight: FontWeight.w300),
                ),
                Text(
                  '${item['description'] ?? ''}',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 11,
                    color: Color(0xff8b96aa),
                  ),
                ),
              ],
            ),
          ),
          Transform.scale(
            scale: 0.5,
            child: Switch(
              value: item['enabled'] as bool? ?? false,
              onChanged: (value) => widget.host.bus.send(
                'widget/control',
                'toggle',
                {'id': id, 'enabled': value},
              ),
            ),
          ),
          IconButton(
            onPressed: item['core'] == true
                ? null
                : () => widget.host.bus.send('widget/control', 'uninstall', {
                    'id': id,
                  }),
            tooltip: item['core'] == true
                ? 'Core widgets cannot be uninstalled'
                : 'Uninstall',
            icon: const Icon(Icons.delete_outline, size: 18),
          ),
        ],
      ),
    ),
  );
  Widget _catalog(String id, Map<String, dynamic> item) => Card(
    child: ListTile(
      title: Text('${item['name'] ?? id}'),
      subtitle: Text('${item['description'] ?? ''}', maxLines: 2),
      trailing: FilledButton.tonal(
        onPressed: () =>
            widget.host.bus.send('store/control', 'install', {'id': id}),
        child: const Text('Install'),
      ),
    ),
  );
}
