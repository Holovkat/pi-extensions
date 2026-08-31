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

  /// Provenance badge per source layer (issue #156; values match the
  /// settled layered-sources model: base | catalog | project). Widgets
  /// from a hub without provenance render no badge.
  static const Map<String, (String, Color)> _sourceBadges = {
    'base': ('BASE', Color(0xff8b96aa)),
    'catalog': ('CATALOG', Color(0xff5b8dd9)),
    'project': ('PROJECT', Color(0xff78dba9)),
  };

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
            color: widget.host.theme.panelRaised,
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
      style: TextStyle(
        color: widget.host.theme.textMuted,
        fontSize: 11,
        fontWeight: FontWeight.w300,
      ),
    ),
  );
  Widget _sourceBadge(String source) {
    final (label, color) =
        _sourceBadges[source] ??
        (source.toUpperCase(), const Color(0xff8b96aa));
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: color.withValues(alpha: 0.55)),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 9,
          letterSpacing: 0.8,
          fontWeight: FontWeight.w400,
          color: color,
        ),
      ),
    );
  }

  String? _entrySource(Map<String, dynamic> item, {String? fallback}) {
    final source = item['source'];
    if (source is String && source.isNotEmpty) return source;
    return fallback;
  }

  Widget _installed(String id, Map<String, dynamic> item) => Card(
    child: Padding(
      padding: const EdgeInsets.all(8),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        '${item['name'] ?? id}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontWeight: FontWeight.w300),
                      ),
                    ),
                    if (_entrySource(item) case final source?) ...[
                      const SizedBox(width: 6),
                      _sourceBadge(source),
                    ],
                  ],
                ),
                Text(
                  '${item['description'] ?? ''}',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 11,
                    color: widget.host.theme.textMuted,
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
      title: Row(
        children: [
          Flexible(
            child: Text(
              '${item['name'] ?? id}',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          if (_entrySource(item, fallback: 'catalog') case final source?) ...[
            const SizedBox(width: 6),
            _sourceBadge(source),
          ],
        ],
      ),
      subtitle: Text('${item['description'] ?? ''}', maxLines: 2),
      trailing: FilledButton.tonal(
        onPressed: () =>
            widget.host.bus.send('store/control', 'install', {'id': id}),
        child: const Text('Install'),
      ),
    ),
  );
}
