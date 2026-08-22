import 'dart:async';
import 'dart:io';
import 'package:flutter/material.dart';
import '../widget_registry.g.dart';
import 'bus.dart';
import 'panel_error_boundary.dart';
import 'plugin.dart';

class DockingShell extends StatefulWidget {
  const DockingShell({super.key, required this.bus, this.workspace});
  final PifBus bus;
  final String? workspace;
  @override
  State<DockingShell> createState() => _DockingShellState();
}

class _DockingShellState extends State<DockingShell>
    with TickerProviderStateMixin {
  late final PifHost host;
  late StreamSubscription events;
  final slotOverrides = <String, PifSlot>{};
  final hiddenPanels = <String>{};
  String? focusedWidgetId;
  Set<String> enabled = {
    'agent_console',
    'session_rail',
    'terminal',
    'widget_store',
    'status_bar',
    'diff_viewer',
  };
  bool centerSplit = false;
  Map<String, PifWidgetPlugin Function()> _factories = pifWidgetFactories();
  void _refreshFactories() => _factories = pifWidgetFactories();
  @override
  void reassemble() { super.reassemble(); _refreshFactories(); }

  @override
  void initState() {
    super.initState();
    host = PifHost(bus: widget.bus)
      ..workspace =
          widget.workspace ?? Platform.environment['PIF_WORKSPACE'] ?? Directory.current.path;
    host.storage.workspace = host.workspace;
    events = widget.bus.events.listen(_event, onError: (_) {});
    widget.bus.connect();
    // The snapshot triggered by connect() can arrive before this shell
    // subscribed (broadcast streams do not replay); ask again now that the
    // listener is attached so state always lands.
    widget.bus.send('shell/state', 'snapshot_request', const {});
  }

  void _applyLayout(Map<String, dynamic> layout) {
    final panels = Map<String, dynamic>.from(layout['panels'] as Map? ?? {});
    slotOverrides.clear();
    hiddenPanels.clear();
    focusedWidgetId = null;
    for (final entry in panels.entries) {
      final value = Map<String, dynamic>.from(entry.value as Map);
      final slot = value['slot'] as String?;
      if (value['open'] == false) hiddenPanels.add(entry.key);
      if (value['action'] == 'focus' || value['action'] == 'open') {
        focusedWidgetId = entry.key;
      }
      if (slot != null) {
        slotOverrides[entry.key] = PifSlot.values.firstWhere(
          (item) => item.name == slot,
          orElse: () => PifSlot.center,
        );
      }
    }
  }

  void _event(PifEnvelope envelope) {
    if (envelope.type == 'snapshot' && envelope.payload is Map) {
      final snapshot = Map<String, dynamic>.from(envelope.payload as Map);
      host.snapshot = snapshot;
      host.workspace =
          ((snapshot['health'] as Map?)?['workspace'] as String?) ??
          host.workspace;
      host.storage.workspace = host.workspace;
      host.models = List<String>.from(
        (snapshot['models'] as List?)?.map((e) => e as String) ?? const [],
      );
      host.modelProviders = Map<String, dynamic>.from(
        (snapshot['modelProviders'] as Map?) ?? {},
      );
      host.sessions.applySnapshot(
        Map<String, dynamic>.from(snapshot['sessions'] as Map? ?? {}),
      );
      final widgets = Map<String, dynamic>.from(
        snapshot['widgets'] as Map? ?? {},
      );
      enabled = widgets.entries
          .where((entry) => (entry.value as Map)['enabled'] == true)
          .map((entry) => entry.key)
          .where(_factories.containsKey)
          .toSet();
      _applyLayout(Map<String, dynamic>.from(snapshot['layout'] as Map? ?? {}));
      if (mounted) setState(() {});
      return;
    }
    if (envelope.channel == 'widget/registry' && envelope.payload is Map) {
      _refreshFactories();
      final widgets = Map<String, dynamic>.from(
        (envelope.payload as Map)['widgets'] as Map? ?? {},
      );
      host.snapshot['widgets'] = widgets;
      enabled = widgets.entries
          .where((entry) => (entry.value as Map)['enabled'] == true)
          .map((entry) => entry.key)
          .where(_factories.containsKey)
          .toSet();
      if (mounted) setState(() {});
    }
    if (envelope.channel == 'store/catalog' && envelope.payload is Map) {
      host.snapshot['catalog'] = Map<String, dynamic>.from(
        (envelope.payload as Map)['catalog'] as Map? ?? {},
      );
      if (mounted) setState(() {});
    }
    if (envelope.channel == 'shell/layout' && envelope.payload is Map) {
      final layout = Map<String, dynamic>.from(envelope.payload as Map);
      host.snapshot['layout'] = layout;
      _applyLayout(layout);
      if (mounted) setState(() {});
    }
    if (envelope.channel == 'session/selection' &&
        envelope.type == 'selected') {
      final payload = Map<String, dynamic>.from(envelope.payload as Map);
      host.activeSessionId = payload['sessionId'] as String? ?? 'host';
      if (mounted) setState(() {});
    } else if (envelope.channel.startsWith('session/') &&
        envelope.payload is Map) {
      host.sessions.applyEvent(
        Map<String, dynamic>.from(envelope.payload as Map),
        envelopeId: envelope.id,
      );
      if (mounted) setState(() {});
    }
  }

  @override
  void dispose() {
    events.cancel();
    widget.bus.dispose();
    super.dispose();
  }

  List<PifWidgetPlugin> inSlot(PifSlot slot) {
    final plugins = enabled
        .where((id) => !hiddenPanels.contains(id))
        .map((id) => _factories[id]?.call())
        .whereType<PifWidgetPlugin>()
        .where(
          (plugin) =>
              (slotOverrides[plugin.meta.id] ?? plugin.meta.slot) == slot,
        )
        .toList();
    plugins.sort((a, b) {
      if (a.meta.id == focusedWidgetId) return -1;
      if (b.meta.id == focusedWidgetId) return 1;
      return a.meta.name.compareTo(b.meta.name);
    });
    return plugins;
  }

  void move(String id, PifSlot slot) {
    setState(() => slotOverrides[id] = slot);
    host.layout.move(id, slot);
  }

  @override
  Widget build(BuildContext context) {
    final left = inSlot(PifSlot.left),
        center = inSlot(PifSlot.center),
        right = inSlot(PifSlot.right),
        bottom = inSlot(PifSlot.bottom),
        status = inSlot(PifSlot.status);
    return Scaffold(
      body: Column(
        children: [
          _titleBar(),
          Expanded(
            child: Row(
              children: [
                // Docks with no visible widgets collapse so adjacent
                // panels reclaim the space; a slim edge remains as the
                // drop target that re-expands the slot.
                if (left.isEmpty)
                  _collapsedEdge(PifSlot.left)
                else ...[
                  SizedBox(width: 230, child: _dock(PifSlot.left, left)),
                  const VerticalDivider(width: 1),
                ],
                Expanded(
                  child: Column(
                    children: [
                      if (center.isEmpty && bottom.isNotEmpty) ...[
                        // No center widgets: the bottom dock expands into
                        // the freed stage; a slim edge keeps the center
                        // slot droppable.
                        _collapsedEdge(PifSlot.center),
                        Expanded(child: _dock(PifSlot.bottom, bottom)),
                      ] else ...[
                        Expanded(child: _center(center)),
                        if (bottom.isEmpty)
                          _collapsedEdge(PifSlot.bottom)
                        else ...[
                          const Divider(height: 1),
                          SizedBox(
                            height: 245,
                            child: _dock(PifSlot.bottom, bottom),
                          ),
                        ],
                      ],
                    ],
                  ),
                ),
                if (right.isEmpty)
                  _collapsedEdge(PifSlot.right)
                else ...[
                  const VerticalDivider(width: 1),
                  SizedBox(width: 300, child: _dock(PifSlot.right, right)),
                ],
              ],
            ),
          ),
          if (status.isEmpty)
            _collapsedEdge(PifSlot.status)
          else
            SizedBox(
              height: 25,
              child: _dock(PifSlot.status, status, chrome: false),
            ),
        ],
      ),
    );
  }

  Widget _titleBar() => Container(
    height: 42,
    color: const Color(0xff11151d),
    padding: const EdgeInsets.only(left: 78, right: 10),
    child: Row(
      children: [
        const Text(
          'pif',
          style: TextStyle(fontWeight: FontWeight.w300, letterSpacing: 1),
        ),
        const SizedBox(width: 10),
        const Text(
          'PI-NATIVE AGENTIC IDE',
          style: TextStyle(
            fontSize: 10,
            letterSpacing: 1.4,
            color: Color(0xff69758a),
          ),
        ),
        const Spacer(),
        IconButton(
          onPressed: () {
            final visible = enabled.contains('widget_store');
            widget.bus.send(
              'widget/control',
              'toggle',
              {'id': 'widget_store', 'enabled': !visible},
            );
          },
          tooltip: enabled.contains('widget_store')
              ? 'Hide widget store'
              : 'Show widget store',
          icon: Icon(
            Icons.widgets,
            size: 18,
            color: enabled.contains('widget_store')
                ? const Color(0xff78dba9)
                : null,
          ),
        ),
        IconButton(
          onPressed: () => setState(() => centerSplit = !centerSplit),
          tooltip: centerSplit ? 'Tabbed center' : 'Split center',
          icon: Icon(centerSplit ? Icons.tab : Icons.vertical_split, size: 18),
        ),
        IconButton(
          onPressed: () =>
              widget.bus.send('shell/state', 'snapshot_request', const {}),
          tooltip: 'Resync',
          icon: const Icon(Icons.sync, size: 18),
        ),
      ],
    ),
  );

  /// A collapsed dock's slim drop edge: invisible until a drag hovers it,
  /// accepts drops into the (now empty) slot, which re-expands the dock.
  Widget _collapsedEdge(PifSlot slot) {
    final vertical = slot == PifSlot.left || slot == PifSlot.right;
    final horizontal =
        slot == PifSlot.bottom || slot == PifSlot.center ||
        slot == PifSlot.status;
    return SizedBox(
      key: Key('pif_dock_edge_${slot.name}'),
      width: vertical ? 7 : double.infinity,
      height: horizontal ? 7 : double.infinity,
      child: DragTarget<String>(
        onAcceptWithDetails: (details) => move(details.data, slot),
        builder: (context, candidates, _) => AnimatedContainer(
          duration: const Duration(milliseconds: 120),
          decoration: BoxDecoration(
            color: candidates.isNotEmpty
                ? const Color(0xff1e342b)
                : Colors.transparent,
            border: candidates.isNotEmpty
                ? Border.all(color: const Color(0xff78dba9))
                : null,
          ),
        ),
      ),
    );
  }

  Widget _dock(
    PifSlot slot,
    List<PifWidgetPlugin> plugins, {
    bool chrome = true,
  }) => DragTarget<String>(
    onAcceptWithDetails: (details) => move(details.data, slot),
    builder: (context, candidates, _) => AnimatedContainer(
      key: Key('pif_dock_${slot.name}'),
      duration: const Duration(milliseconds: 120),
      decoration: BoxDecoration(
        color: candidates.isNotEmpty
            ? const Color(0xff1e342b)
            : const Color(0xff11151d),
        border: candidates.isNotEmpty
            ? Border.all(color: const Color(0xff78dba9))
            : null,
      ),
      child: plugins.isEmpty
          ? _empty(slot)
          : plugins.length == 1
          ? _panel(plugins.first, chrome: chrome)
          : _tabs(plugins, chrome: chrome),
    ),
  );

  Widget _center(List<PifWidgetPlugin> plugins) {
    if (!centerSplit || plugins.length < 2)
      return _dock(PifSlot.center, plugins);
    return DragTarget<String>(
      onAcceptWithDetails: (details) => move(details.data, PifSlot.center),
      builder: (context, candidates, rejected) => Row(
        children: [
          for (var i = 0; i < plugins.length; i++) ...[
            if (i > 0) const VerticalDivider(width: 1),
            Expanded(child: _panel(plugins[i])),
          ],
        ],
      ),
    );
  }

  Widget _tabs(List<PifWidgetPlugin> plugins, {bool chrome = true}) =>
      DefaultTabController(
        key: ValueKey(focusedWidgetId),
        length: plugins.length,
        child: Column(
          children: [
            if (chrome)
              SizedBox(
                height: 36,
                child: TabBar(
                  isScrollable: true,
                  tabAlignment: TabAlignment.start,
                  tabs: plugins.map(_draggableTab).toList(),
                ),
              ),
            Expanded(
              child: TabBarView(
                children: plugins
                    .map((plugin) => _panel(plugin, chrome: false))
                    .toList(),
              ),
            ),
          ],
        ),
      );

  /// Tabbed panels have no panel-header chrome, so the tab itself is the
  /// drag affordance for moving the widget to another slot.
  Widget _draggableTab(PifWidgetPlugin plugin) => Draggable<String>(
    data: plugin.meta.id,
    feedback: Material(
      color: Colors.transparent,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: const Color(0xff273143),
          borderRadius: BorderRadius.circular(6),
        ),
        child: Text(
          plugin.meta.name,
          style: const TextStyle(fontSize: 12, color: Colors.white),
        ),
      ),
    ),
    childWhenDragging: Opacity(
      opacity: 0.4,
      child: _tabLabel(plugin.meta.name),
    ),
    child: _tabLabel(plugin.meta.name),
  );

  Widget _tabLabel(String name) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      const Icon(Icons.drag_indicator, size: 12, color: Color(0xff69758a)),
      const SizedBox(width: 4),
      Text(name),
    ],
  );

  Widget _panel(PifWidgetPlugin plugin, {bool chrome = true}) => Container(
    color: host.theme.panel,
    child: Column(
      children: [
        if (chrome && plugin.meta.slot != PifSlot.status) _panelHeader(plugin),
        Expanded(
          child: PanelErrorBoundary(
            key: ValueKey(plugin.meta.id),
            plugin: plugin,
            host: host,
          ),
        ),
      ],
    ),
  );

  Widget _panelHeader(PifWidgetPlugin plugin) => Draggable<String>(
    data: plugin.meta.id,
    feedback: Material(
      color: Colors.transparent,
      child: Container(
        width: 190,
        padding: const EdgeInsets.all(9),
        decoration: BoxDecoration(
          color: const Color(0xff273143),
          borderRadius: BorderRadius.circular(6),
        ),
        child: Text(plugin.meta.name),
      ),
    ),
    child: Container(
      height: 32,
      padding: const EdgeInsets.symmetric(horizontal: 10),
      decoration: BoxDecoration(
        color: host.theme.panelRaised,
        border: Border(bottom: BorderSide(color: host.theme.border)),
      ),
      child: Row(
        children: [
          const Icon(Icons.drag_indicator, size: 14, color: Color(0xff69758a)),
          const SizedBox(width: 5),
          Text(
            plugin.meta.name,
            style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w300),
          ),
          const Spacer(),
          if (!plugin.meta.core)
            IconButton(
              onPressed: () => host.layout.close(plugin.meta.id),
              icon: const Icon(Icons.close, size: 13),
            ),
        ],
      ),
    ),
  );

  Widget _empty(PifSlot slot) => Center(
    child: Text(
      'Drop widget in ${slot.name}',
      style: const TextStyle(fontSize: 11, color: Color(0xff566175)),
    ),
  );
}
