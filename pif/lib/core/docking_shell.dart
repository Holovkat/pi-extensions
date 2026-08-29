import 'dart:async';
import 'dart:io';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../widget_registry.g.dart';
import 'bus.dart';
import 'panel_error_boundary.dart';
import 'plugin.dart';

class DockingShell extends StatefulWidget {
  const DockingShell({
    super.key,
    required this.bus,
    this.workspace,
    this.factories,
  });
  final PifBus bus;
  final String? workspace;

  /// Widget factory override (test seam). Defaults to the generated
  /// registry; app mode resolves page widgets from the same table.
  final Map<String, PifWidgetPlugin Function()>? factories;
  @override
  State<DockingShell> createState() => _DockingShellState();
}

class _DockingShellState extends State<DockingShell>
    with TickerProviderStateMixin {
  late final PifHost host;
  late StreamSubscription events;
  late StreamSubscription errors;
  final slotOverrides = <String, PifSlot>{};
  final hiddenPanels = <String>{};
  // Unpinned panels leave the layout (neighbours reclaim the space) and
  // live as slide-in overlays with an edge grabber instead.
  final unpinnedIds = <String>{};
  final slidIn = <String>{};
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
  // App runtime mode (issue #156): active only when the hub snapshot
  // carries a usable app manifest (pif_app/app.yaml parsed by the hub —
  // `app` = {id, name, home, pages}). A project without a manifest keeps
  // the IDE shell below byte-for-byte in behaviour.
  Map<String, dynamic>? _appManifest;
  List<String> _pageIds = const [];
  String? _activePageId;
  // Dev toggle: false renders the page stage (app mode), true exposes the
  // full IDE docking. Persisted as a shell setting; the hub-side control
  // method is the hub lane's surface.
  bool _devMode = false;
  bool _consoleOpen = false;
  // Dock sizes — user-resizable via the dividers, persisted per project
  // through the shell/layout resize action.
  static const double _minSide = 140;
  static const double _minBottom = 80;
  static const double _defaultLeft = 230;
  static const double _defaultRight = 300;
  static const double _defaultBottom = 245;
  // Center stage reserved between the side docks and above the bottom
  // dock; below these surface sizes the clamps would invert.
  static const double _centerMinWidth = 240;
  static const double _bottomTopGap = 120;
  static const double _maxOverlayWidth = 520;
  double _left = _defaultLeft;
  double _right = _defaultRight;
  double _bottom = _defaultBottom;
  Map<String, PifWidgetPlugin Function()> _factories = pifWidgetFactories();
  void _refreshFactories() =>
      _factories = widget.factories ?? pifWidgetFactories();
  @override
  void reassemble() {
    super.reassemble();
    _refreshFactories();
  }

  @override
  void initState() {
    super.initState();
    // Apply the injected factory seam before the FIRST build — the field
    // initialiser otherwise leaves the real generated registry active for
    // frame one, and the pre-snapshot default `enabled` set would build
    // real widgets (console overflow) in tests.
    _refreshFactories();
    host = PifHost(bus: widget.bus)
      ..workspace =
          widget.workspace ??
          Platform.environment['PIF_WORKSPACE'] ??
          Directory.current.path;
    host.storage.workspace = host.workspace;
    _devMode = host.storage.read('shell', 'devMode') == true;
    events = widget.bus.events.listen(_event, onError: (_) {});
    errors = widget.bus.errors.listen(_showError);
    widget.bus.connect();
    // The snapshot triggered by connect() can arrive before this shell
    // subscribed (broadcast streams do not replay); ask again now that the
    // listener is attached so state always lands.
    widget.bus.send('shell/state', 'snapshot_request', const {});
  }

  /// Hub rejections (failed resume, unknown session, rejected save…) were
  /// previously invisible; surface each one as actionable feedback.
  void _showError(PifRequestError error) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..clearSnackBars()
      ..showSnackBar(
        SnackBar(
          content: Text(error.message, style: const TextStyle(fontSize: 12)),
          behavior: SnackBarBehavior.floating,
          duration: const Duration(seconds: 4),
        ),
      );
  }

  void _applyLayout(Map<String, dynamic> layout) {
    final panels = Map<String, dynamic>.from(layout['panels'] as Map? ?? {});
    final sizes = layout['sizes'] as Map?;
    if (sizes != null) {
      final left = (sizes['left'] as num?)?.toDouble();
      final right = (sizes['right'] as num?)?.toDouble();
      final bottom = (sizes['bottom'] as num?)?.toDouble();
      if (left != null) _left = left.clamp(_minSide, 2000);
      if (right != null) _right = right.clamp(_minSide, 2000);
      if (bottom != null) _bottom = bottom.clamp(_minBottom, 2000);
    }
    slotOverrides.clear();
    hiddenPanels.clear();
    focusedWidgetId = null;
    for (final entry in panels.entries) {
      final value = Map<String, dynamic>.from(entry.value as Map);
      final slot = value['slot'] as String?;
      if (value['open'] == false) hiddenPanels.add(entry.key);
      if (value['pinned'] == false) {
        // Only side-slot widgets have overlays and grabbers; a persisted
        // unpinned flag on any other widget would strand it invisibly.
        final slot = value['slot'] as String?;
        final pinnableSlot = slot == 'left' || slot == 'right' || slot == null;
        if (pinnableSlot && _pinnableIds.contains(entry.key)) {
          unpinnedIds.add(entry.key);
        }
      } else {
        unpinnedIds.remove(entry.key);
        slidIn.remove(entry.key);
      }
      if (value['action'] == 'focus' || value['action'] == 'open') {
        focusedWidgetId = entry.key;
      }
      if (slot != null) {
        // Unknown slot names keep the widget's manifest slot instead of
        // silently forcing center — a persisted `slot: page` must never
        // strand a page widget inside a dock.
        final parsed = PifSlot.values
            .where((item) => item.name == slot)
            .firstOrNull;
        if (parsed != null) slotOverrides[entry.key] = parsed;
      }
    }
  }

  /// App runtime mode contract (issue #156): the hub parses
  /// `pif_app/app.yaml` into the snapshot as `app` = {id, name, home,
  /// pages}. The declared home page is the boot page; a snapshot without
  /// a usable manifest (or with no declared pages) keeps IDE mode.
  void _applyAppManifest(Object? raw) {
    final pages = <String>[];
    String? home;
    if (raw is Map) {
      home = raw['home'] as String?;
      for (final page in raw['pages'] as List? ?? const []) {
        if (page is String && page.isNotEmpty) pages.add(page);
      }
    }
    if (pages.isEmpty) {
      _appManifest = null;
      _pageIds = const [];
      _activePageId = null;
      _consoleOpen = false;
      return;
    }
    _appManifest = Map<String, dynamic>.from(raw as Map);
    _pageIds = pages;
    // Navigation state survives resyncs; it only resets when the active
    // page disappeared from the manifest. Each boot starts on the home
    // page (_activePageId is null until the first snapshot arrives).
    if (_activePageId == null || !_pageIds.contains(_activePageId)) {
      _activePageId = (home != null && _pageIds.contains(home))
          ? home
          : _pageIds.first;
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
      host.requestTranscript(host.activeSessionId);
      final widgets = Map<String, dynamic>.from(
        snapshot['widgets'] as Map? ?? {},
      );
      enabled = widgets.entries
          .where((entry) => (entry.value as Map)['enabled'] == true)
          .map((entry) => entry.key)
          .where(_factories.containsKey)
          .toSet();
      _applyLayout(Map<String, dynamic>.from(snapshot['layout'] as Map? ?? {}));
      _applyAppManifest(snapshot['app']);
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
    if (envelope.channel == 'session/state' &&
        envelope.type == 'created' &&
        envelope.payload is Map) {
      final payload = Map<String, dynamic>.from(envelope.payload as Map);
      host.sessions.applyEvent(payload, envelopeId: envelope.id);
      final created = payload['id'] as String?;
      if (created != null) host.activateSession(created);
      if (mounted) setState(() {});
    } else if (envelope.channel == 'session/selection' &&
        envelope.type == 'selected') {
      final payload = Map<String, dynamic>.from(envelope.payload as Map);
      host.activeSessionId = payload['sessionId'] as String? ?? 'host';
      host.requestTranscript(host.activeSessionId);
      if (mounted) setState(() {});
    } else if (envelope.channel == 'session/transcript' &&
        envelope.type == 'history') {
      // Lazy hydration: the hub read the authoritative `.jsonl` for us.
      final payload = Map<String, dynamic>.from(envelope.payload as Map);
      final sessionId = payload['sessionId'] as String? ?? '';
      final transcript = (payload['transcript'] as List?) ?? const [];
      host.sessions.replaceTranscript(sessionId, transcript);
      if (mounted) setState(() {});
    } else if (envelope.channel == 'session/state' &&
        envelope.type == 'removed') {
      final payload = Map<String, dynamic>.from(envelope.payload as Map);
      final removed = payload['sessionId'] as String? ?? '';
      host.sessions.remove(removed);
      host.activateFallbackSession(removed);
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
    errors.cancel();
    _escapeFocus.dispose();
    widget.bus.dispose();
    super.dispose();
  }

  List<PifWidgetPlugin> inSlot(PifSlot slot) {
    final plugins = enabled
        .where((id) => !hiddenPanels.contains(id))
        .where((id) => !unpinnedIds.contains(id))
        .map((id) => _factories[id]?.call())
        .whereType<PifWidgetPlugin>()
        // Line-stop guard (issue #156): page widgets render only in the
        // app-mode page stage — never in a dock slot, whatever a stale
        // persisted layout says.
        .where((plugin) => plugin.meta.slot != PifSlot.page)
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

  bool _isPageWidget(String id) =>
      _factories[id]?.call().meta.slot == PifSlot.page;

  void move(String id, PifSlot slot) {
    // The status dock renders chromeless: a second widget dropped there
    // would be unreachable (no tab strip, no header). Reject instead.
    if (slot == PifSlot.status && inSlot(PifSlot.status).isNotEmpty) return;
    // Page widgets live only in the page stage; they cannot be docked.
    if (slot != PifSlot.page && _isPageWidget(id)) return;
    setState(() => slotOverrides[id] = slot);
    host.layout.move(id, slot);
  }

  static const _pinnableIds = {'widget_store', 'session_rail'};

  bool _pinnable(PifWidgetPlugin plugin) {
    if (!_pinnableIds.contains(plugin.meta.id)) return false;
    final slot = slotOverrides[plugin.meta.id] ?? plugin.meta.slot;
    return slot == PifSlot.left || slot == PifSlot.right;
  }

  PifSlot _effectiveSlot(String id, PifSlot fallback) =>
      slotOverrides[id] ?? fallback;

  void pin(String id, bool pinned) {
    setState(() {
      if (pinned) {
        unpinnedIds.remove(id);
        slidIn.remove(id);
      } else {
        unpinnedIds.add(id);
        slidIn.remove(id);
      }
    });
    widget.bus.send('shell/layout', 'pin', {'widgetId': id, 'pinned': pinned});
  }

  void _saveSizes() {
    widget.bus.send('shell/layout', 'resize', {
      'sizes': {'left': _left, 'right': _right, 'bottom': _bottom},
    });
  }

  /// Draggable divider between two visible docks: a 6px hit area with a
  /// hairline, a resize cursor, and the neighbour (the center stage)
  /// absorbing whatever is added or released. Double-click snaps the dock
  /// back to its default size.
  Widget _divider({
    required Key key,
    required bool horizontal,
    required void Function(double delta) onDelta,
    required VoidCallback onReset,
  }) => GestureDetector(
    key: key,
    onDoubleTap: () {
      onReset();
      _saveSizes();
    },
    onHorizontalDragUpdate: horizontal
        ? null
        : (details) => onDelta(details.delta.dx),
    onVerticalDragUpdate: horizontal
        ? (details) => onDelta(details.delta.dy)
        : null,
    onHorizontalDragEnd: (_) => _saveSizes(),
    onVerticalDragEnd: (_) => _saveSizes(),
    child: MouseRegion(
      cursor: horizontal
          ? SystemMouseCursors.resizeRow
          : SystemMouseCursors.resizeColumn,
      child: SizedBox(
        width: horizontal ? double.infinity : 6,
        height: horizontal ? 6 : double.infinity,
        child: Center(
          child: Container(
            width: horizontal ? double.infinity : 1,
            height: horizontal ? 1 : double.infinity,
            color: host.theme.border,
          ),
        ),
      ),
    ),
  );

  @override
  Widget build(BuildContext context) {
    return KeyboardListener(
      focusNode: _escapeFocus,
      autofocus: true,
      onKeyEvent: _handleEscapeKey,
      child: _pageIds.isEmpty
          ? _ideScaffold()
          // App runtime mode: both shells stay in the tree (Offstage keeps
          // them laid out but invisible), so flipping the dev toggle never
          // loses docking state or page state.
          : Stack(
              children: [
                Offstage(offstage: _devMode, child: _appScaffold()),
                Offstage(offstage: !_devMode, child: _ideScaffold()),
              ],
            ),
    );
  }

  /// The IDE docking shell — the pre-app-mode tree, unchanged for
  /// projects without a manifest (drag/dock, collapse, resize, pin).
  Widget _ideScaffold() {
    final leftWidgets = inSlot(PifSlot.left),
        centerWidgets = inSlot(PifSlot.center),
        rightWidgets = inSlot(PifSlot.right),
        bottomWidgets = inSlot(PifSlot.bottom),
        statusWidgets = inSlot(PifSlot.status);
    return Scaffold(
      body: Column(
        children: [
          _titleBar(),
          Expanded(
            child: Stack(
              children: [
                LayoutBuilder(
                  builder: (context, constraints) {
                    // Keep the center stage livable no matter how far the
                    // dividers are dragged. Upper bounds are floored at the
                    // minimums so a tiny window can never produce reversed
                    // (min > max) clamps, which throw inside build().
                    final maxSide = math.max(
                      _minSide,
                      (constraints.maxWidth - _centerMinWidth) / 2,
                    );
                    final maxBottom = math.max(
                      _minBottom,
                      constraints.maxHeight - _bottomTopGap,
                    );
                    final left = _left.clamp(_minSide, maxSide);
                    final right = _right.clamp(_minSide, maxSide);
                    final bottom = _bottom.clamp(_minBottom, maxBottom);
                    return Row(
                      children: [
                        // Docks with no visible widgets collapse so adjacent
                        // panels reclaim the space; a slim edge remains as the
                        // drop target that re-expands the slot.
                        if (leftWidgets.isEmpty)
                          _collapsedEdge(PifSlot.left)
                        else ...[
                          SizedBox(
                            width: left,
                            child: _dock(PifSlot.left, leftWidgets),
                          ),
                          _divider(
                            key: const Key('pif_divider_left'),
                            horizontal: false,
                            onDelta: (dx) => setState(
                              () =>
                                  _left = (_left + dx).clamp(_minSide, maxSide),
                            ),
                            onReset: () => setState(() => _left = _defaultLeft),
                          ),
                        ],
                        Expanded(
                          child: Column(
                            children: [
                              if (centerWidgets.isEmpty &&
                                  bottomWidgets.isNotEmpty) ...[
                                // No center widgets: the bottom dock expands
                                // into the freed stage; a slim edge keeps the
                                // center slot droppable.
                                _collapsedEdge(PifSlot.center),
                                Expanded(
                                  child: _dock(PifSlot.bottom, bottomWidgets),
                                ),
                              ] else ...[
                                Expanded(child: _center(centerWidgets)),
                                if (bottomWidgets.isEmpty)
                                  _collapsedEdge(PifSlot.bottom)
                                else if (centerWidgets.isEmpty)
                                  SizedBox(
                                    height: bottom,
                                    child: _dock(PifSlot.bottom, bottomWidgets),
                                  )
                                else ...[
                                  _divider(
                                    key: const Key('pif_divider_bottom'),
                                    horizontal: true,
                                    onDelta: (dy) => setState(
                                      () => _bottom = (_bottom - dy).clamp(
                                        _minBottom,
                                        maxBottom,
                                      ),
                                    ),
                                    onReset: () => setState(
                                      () => _bottom = _defaultBottom,
                                    ),
                                  ),
                                  SizedBox(
                                    height: bottom,
                                    child: _dock(PifSlot.bottom, bottomWidgets),
                                  ),
                                ],
                              ],
                            ],
                          ),
                        ),
                        if (rightWidgets.isEmpty)
                          _collapsedEdge(PifSlot.right)
                        else ...[
                          _divider(
                            key: const Key('pif_divider_right'),
                            horizontal: false,
                            onDelta: (dx) => setState(
                              () => _right = (_right - dx).clamp(
                                _minSide,
                                maxSide,
                              ),
                            ),
                            onReset: () =>
                                setState(() => _right = _defaultRight),
                          ),
                          SizedBox(
                            width: right,
                            child: _dock(PifSlot.right, rightWidgets),
                          ),
                        ],
                      ],
                    );
                  },
                ),
                // Tapping outside an open overlay slides it back out.
                if (slidIn.isNotEmpty)
                  Positioned.fill(
                    key: const Key('pif_overlay_barrier'),
                    child: GestureDetector(
                      behavior: HitTestBehavior.opaque,
                      onTap: () => setState(slidIn.clear),
                    ),
                  ),
                ..._overlayPanels(),
                ..._edgeGrabbers(),
              ],
            ),
          ),
          if (statusWidgets.isEmpty)
            _collapsedEdge(PifSlot.status)
          else
            SizedBox(
              height: 25,
              child: _dock(PifSlot.status, statusWidgets, chrome: false),
            ),
        ],
      ),
    );
  }

  /// The app-mode shell: the active page renders full-viewport in the
  /// page stage with responsive navigation (rail at >=1024px width, a
  /// bottom bar below). The Agent Console slides in as an overlay so an
  /// app stays operable without leaving app mode.
  Widget _appScaffold() {
    final statusWidgets = inSlot(PifSlot.status);
    return Scaffold(
      body: Column(
        children: [
          _titleBar(),
          Expanded(
            child: LayoutBuilder(
              builder: (context, constraints) {
                final wide = constraints.maxWidth >= 1024;
                final stage = _pageStage();
                return Stack(
                  children: [
                    Positioned.fill(
                      child: wide
                          ? Row(
                              children: [
                                _navRail(),
                                const VerticalDivider(width: 1),
                                Expanded(child: stage),
                              ],
                            )
                          : Column(
                              children: [
                                Expanded(child: stage),
                                _navBottomBar(),
                              ],
                            ),
                    ),
                    if (_consoleOpen && !_devMode) _consoleOverlay(),
                  ],
                );
              },
            ),
          ),
          if (statusWidgets.isEmpty)
            _collapsedEdge(PifSlot.status)
          else
            SizedBox(
              height: 25,
              child: _dock(PifSlot.status, statusWidgets, chrome: false),
            ),
        ],
      ),
    );
  }

  int _selectedPageIndex() {
    final index = _pageIds.indexWhere((id) => id == _activePageId);
    return index < 0 ? 0 : index;
  }

  String _pageName(String id) => _factories[id]?.call().meta.name ?? id;

  void _navigateTo(int index) =>
      setState(() => _activePageId = _pageIds[index]);

  Widget _navRail() => NavigationRail(
    selectedIndex: _selectedPageIndex(),
    onDestinationSelected: _navigateTo,
    labelType: NavigationRailLabelType.all,
    destinations: [
      for (final id in _pageIds)
        NavigationRailDestination(
          icon: const Icon(Icons.circle, size: 10),
          label: Text(
            _pageName(id),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
    ],
  );

  Widget _navBottomBar() => NavigationBar(
    selectedIndex: _selectedPageIndex(),
    onDestinationSelected: _navigateTo,
    destinations: [
      for (final id in _pageIds)
        NavigationDestination(
          icon: const Icon(Icons.circle, size: 10),
          label: _pageName(id),
        ),
    ],
  );

  /// The active page, full-viewport, inside the error boundary like any
  /// other widget surface. Only page widgets ever render here.
  Widget _pageStage() {
    final id = _activePageId;
    final plugin = id == null ? null : _factories[id]?.call();
    if (plugin == null) {
      return Center(
        child: Text(
          'Page "$id" is not installed',
          style: const TextStyle(fontSize: 12, color: Color(0xff8b96aa)),
        ),
      );
    }
    return PanelErrorBoundary(
      key: ValueKey('pif_page_stage_$id'),
      plugin: plugin,
      host: host,
    );
  }

  Widget _consoleOverlay() {
    final plugin = _factories['agent_console']?.call();
    return Positioned(
      key: const Key('pif_app_console'),
      top: 0,
      bottom: 0,
      right: 0,
      width: 440,
      child: Material(
        color: host.theme.panel,
        elevation: 14,
        child: Column(
          children: [
            Container(
              height: 32,
              padding: const EdgeInsets.symmetric(horizontal: 10),
              decoration: BoxDecoration(
                color: host.theme.panelRaised,
                border: Border(bottom: BorderSide(color: host.theme.border)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.smart_toy_outlined, size: 14),
                  const SizedBox(width: 5),
                  const Text(
                    'AGENT CONSOLE',
                    style: TextStyle(fontSize: 11, fontWeight: FontWeight.w300),
                  ),
                  const Spacer(),
                  IconButton(
                    onPressed: () => setState(() => _consoleOpen = false),
                    tooltip: 'Close Agent Console',
                    icon: const Icon(Icons.close, size: 13),
                  ),
                ],
              ),
            ),
            Expanded(
              child: plugin == null
                  ? const Center(
                      child: Text(
                        'Agent Console is not installed',
                        style: TextStyle(
                          fontSize: 12,
                          color: Color(0xff8b96aa),
                        ),
                      ),
                    )
                  : PanelErrorBoundary(
                      key: const ValueKey('pif_app_console_host'),
                      plugin: plugin,
                      host: host,
                    ),
            ),
          ],
        ),
      ),
    );
  }

  void _toggleDevMode() {
    setState(() => _devMode = !_devMode);
    // Persisted shell setting; the hub control method for the toggle is
    // the hub lane's surface (issue #156).
    unawaited(host.storage.write('shell', 'devMode', _devMode));
  }

  final FocusNode _escapeFocus = FocusNode();

  /// Esc cancels the transient UI states: open overlays slide back out,
  /// and widgets with active inline renames are told to cancel via the
  /// bus-scoped escape stream.
  void _handleEscapeKey(KeyEvent event) {
    if (event is! KeyDownEvent ||
        event.logicalKey != LogicalKeyboardKey.escape) {
      return;
    }
    if (slidIn.isNotEmpty) setState(slidIn.clear);
    host.escape();
  }

  /// Slide-in overlay panels for unpinned widgets, anchored to the edge
  /// they were docked on and floating over the other panels.
  List<Widget> _overlayPanels() {
    final overlays = <Widget>[];
    for (final id in unpinnedIds) {
      final factory = _factories[id];
      if (factory == null) continue;
      final plugin = factory();
      final side = _effectiveSlot(id, plugin.meta.slot);
      if (side != PifSlot.left && side != PifSlot.right) continue;
      final open = slidIn.contains(id);
      final width = (side == PifSlot.left ? _left : _right)
          .clamp(_minSide, math.max(_minSide, _maxOverlayWidth))
          .toDouble();
      overlays.add(
        Positioned(
          key: Key('pif_overlay_$id'),
          top: 0,
          bottom: 0,
          left: side == PifSlot.left ? 0 : null,
          right: side == PifSlot.right ? 0 : null,
          width: width,
          child: AnimatedSlide(
            duration: const Duration(milliseconds: 200),
            curve: Curves.easeOutCubic,
            offset: open
                ? Offset.zero
                : side == PifSlot.left
                ? const Offset(-1.05, 0)
                : const Offset(1.05, 0),
            child: Container(
              decoration: BoxDecoration(
                color: host.theme.panel,
                border: Border(
                  left: side == PifSlot.right
                      ? BorderSide(color: host.theme.border)
                      : BorderSide.none,
                  right: side == PifSlot.left
                      ? BorderSide(color: host.theme.border)
                      : BorderSide.none,
                ),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.5),
                    blurRadius: 18,
                    offset: side == PifSlot.left
                        ? const Offset(6, 0)
                        : const Offset(-6, 0),
                  ),
                ],
              ),
              child: Column(
                children: [
                  _overlayHeader(plugin, side),
                  Expanded(
                    child: PanelErrorBoundary(
                      key: ValueKey('overlay-${plugin.meta.id}'),
                      plugin: plugin,
                      host: host,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      );
    }
    return overlays;
  }

  Widget _overlayHeader(PifWidgetPlugin plugin, PifSlot side) => Container(
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
        IconButton(
          onPressed: () => pin(plugin.meta.id, true),
          tooltip: 'Pin panel back into the layout',
          icon: Transform.rotate(
            angle: math.pi / 4,
            child: const Icon(Icons.push_pin, size: 13),
          ),
        ),
        IconButton(
          onPressed: () => setState(() => slidIn.remove(plugin.meta.id)),
          tooltip: 'Slide out',
          icon: Icon(
            side == PifSlot.left
                ? Icons.keyboard_double_arrow_left
                : Icons.keyboard_double_arrow_right,
            size: 14,
          ),
        ),
      ],
    ),
  );

  /// Grabber tabs on the viewport border, one per unpinned panel, on the
  /// side it was docked. Tapping slides the panel in over the others.
  List<Widget> _edgeGrabbers() {
    final grabbers = <Widget>[];
    for (final side in [PifSlot.left, PifSlot.right]) {
      var row = 0;
      for (final id in unpinnedIds) {
        if (slidIn.contains(id)) continue;
        final factory = _factories[id];
        if (factory == null) continue;
        final slot = _effectiveSlot(id, factory().meta.slot);
        if (slot != side) continue;
        grabbers.add(
          Positioned(
            key: Key('pif_grabber_${side.name}_$id'),
            top: 120 + row * 72,
            left: side == PifSlot.left ? 0 : null,
            right: side == PifSlot.right ? 0 : null,
            child: Material(
              elevation: 6,
              color: host.theme.panelRaised,
              borderRadius: BorderRadius.horizontal(
                left: side == PifSlot.right
                    ? const Radius.circular(6)
                    : Radius.zero,
                right: side == PifSlot.left
                    ? const Radius.circular(6)
                    : Radius.zero,
              ),
              child: InkWell(
                onTap: () => setState(() => slidIn.add(id)),
                child: SizedBox(
                  width: 18,
                  height: 60,
                  child: Icon(
                    side == PifSlot.left
                        ? Icons.keyboard_double_arrow_right
                        : Icons.keyboard_double_arrow_left,
                    size: 15,
                    color: const Color(0xff8b96aa),
                  ),
                ),
              ),
            ),
          ),
        );
        row++;
      }
    }
    return grabbers;
  }

  Widget _titleBar() {
    // App runtime mode surfaces the dev toggle (and the console overlay
    // button); a project without a manifest keeps the IDE title bar.
    final appMode = _pageIds.isNotEmpty;
    final ideVisible = !appMode || _devMode;
    final appName = (_appManifest?['name'] as String?) ?? 'app';
    return Container(
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
          Flexible(
            child: Text(
              appMode ? appName.toUpperCase() : 'PI-NATIVE AGENTIC IDE',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 10,
                letterSpacing: 1.4,
                color: Color(0xff69758a),
              ),
            ),
          ),
          const Spacer(),
          if (appMode && !ideVisible)
            IconButton(
              onPressed: () => setState(() => _consoleOpen = !_consoleOpen),
              tooltip: _consoleOpen
                  ? 'Hide Agent Console'
                  : 'Show Agent Console',
              icon: Icon(
                Icons.smart_toy_outlined,
                size: 18,
                color: _consoleOpen ? const Color(0xff78dba9) : null,
              ),
            ),
          if (ideVisible) ...[
            IconButton(
              onPressed: () {
                final visible = enabled.contains('widget_store');
                widget.bus.send('widget/control', 'toggle', {
                  'id': 'widget_store',
                  'enabled': !visible,
                });
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
              icon: Icon(
                centerSplit ? Icons.tab : Icons.vertical_split,
                size: 18,
              ),
            ),
          ],
          if (appMode)
            IconButton(
              key: const Key('pif_dev_toggle'),
              onPressed: _toggleDevMode,
              tooltip: _devMode
                  ? 'Return to app mode'
                  : 'Show IDE docking (dev)',
              icon: Icon(
                Icons.developer_mode,
                size: 18,
                color: _devMode ? const Color(0xff78dba9) : null,
              ),
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
  }

  /// A collapsed dock's slim drop edge: invisible until a drag hovers it,
  /// accepts drops into the (now empty) slot, which re-expands the dock.
  Widget _collapsedEdge(PifSlot slot) {
    final vertical = slot == PifSlot.left || slot == PifSlot.right;
    final horizontal =
        slot == PifSlot.bottom ||
        slot == PifSlot.center ||
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
          Flexible(
            child: Text(
              plugin.meta.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w300),
            ),
          ),
          const Spacer(),
          if (_pinnable(plugin))
            IconButton(
              onPressed: () => pin(plugin.meta.id, false),
              tooltip: 'Unpin panel (slides to the edge)',
              icon: const Icon(Icons.push_pin, size: 13),
            ),
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
