import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import '../../core/plugin.dart';

class TrackerBoardPlugin implements PifWidgetPlugin {
  @override
  PifWidgetMeta get meta => const PifWidgetMeta(
    id: 'tracker_board',
    name: 'Tracker',
    slot: PifSlot.center,
    core: true,
    description:
        'Repo-synced Kanban board for the workspace\'s GitHub issues, sprints, and epics',
  );
  @override
  Widget build(BuildContext context, PifHost host) => _Board(host: host);
}

class _Board extends StatefulWidget {
  const _Board({required this.host});
  final PifHost host;
  @override
  State<_Board> createState() => _BoardState();
}

class _BoardState extends State<_Board> {
  late StreamSubscription subscription;
  List<Map<String, dynamic>> columns = const [];
  List<Map<String, dynamic>> cards = const [];
  String repo = '';
  bool stale = false;
  String? error;
  List<Map<String, dynamic>>? _revertOnFailure;
  // Scope (issue #188): "All work" is the original board; the Epics overview
  // lists one card per epic; _scopedEpic drills into a single epic's family
  // (the epic pinned as a header card above lanes containing only its own
  // sprints and tasks — the notes-app project board view).
  bool _epicsView = false;
  int? _scopedEpic;
  @override
  void initState() {
    super.initState();
    _readTrackerState(widget.host.snapshot['tracker']);
    subscription = widget.host.bus.events.listen((event) {
      if (event.type == 'snapshot' && event.payload is Map) {
        widget.host.snapshot = Map<String, dynamic>.from(event.payload as Map);
        _readTrackerState(widget.host.snapshot['tracker']);
      } else if (event.channel == 'tracker/state') {
        _revertOnFailure = null;
        _readTrackerState(event.payload);
      } else if (event.channel == 'tracker/move' &&
          event.type == 'move_result' &&
          event.payload is Map &&
          (event.payload as Map)['ok'] == false) {
        _revert();
      } else {
        return;
      }
      if (mounted) setState(() {});
    });
  }

  /// Assign tracker fields without setState; callers decide when to rebuild.
  void _readTrackerState(Object? state) {
    if (state is! Map) return;
    columns = (state['columns'] as List? ?? const [])
        .whereType<Map>()
        .map((column) => Map<String, dynamic>.from(column))
        .toList();
    cards = (state['cards'] as List? ?? const [])
        .whereType<Map>()
        .map((card) => Map<String, dynamic>.from(card))
        .toList();
    repo = '${state['repo'] ?? ''}';
    stale = state['stale'] as bool? ?? false;
    error = state['error'] as String?;
  }

  void _revert() {
    final revert = _revertOnFailure;
    if (revert == null) return;
    _revertOnFailure = null;
    cards = revert;
  }

  /// Optimistic move: apply locally, send to the hub, revert to the deep
  /// copy if the hub reports a failed write-back.
  void _moveCard(int number, String columnId) {
    final index = cards.indexWhere((card) => card['number'] == number);
    if (index < 0 || cards[index]['column'] == columnId) return;
    _revertOnFailure = cards
        .map((card) => Map<String, dynamic>.from(card))
        .toList();
    final moved = Map<String, dynamic>.from(cards[index])
      ..['column'] = columnId;
    setState(() => cards = [...cards]..[index] = moved);
    widget.host.bus.send('tracker/control', 'move', {
      'number': number,
      'column': columnId,
    });
  }

  @override
  void dispose() {
    subscription.cancel();
    super.dispose();
  }

  void _openSheet({Map<String, dynamic>? card}) {
    showDialog<void>(
      context: context,
      builder: (dialogContext) => _TicketSheet(
        host: widget.host,
        card: card,
        columns: columns,
        onMove: _moveCard,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = widget.host.theme;
    return Container(
      color: theme.panel,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _header(theme),
          if (error != null && error!.isNotEmpty)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
              child: Text(
                error!,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(color: Color(0xffe2a4a4), fontSize: 11),
              ),
            ),
          Expanded(
            child: columns.isEmpty
                ? _empty(theme)
                : _scopedEpic != null
                ? _scopedBoard(context, theme)
                : _epicsView
                ? _epicsOverview(theme)
                : _board(theme),
          ),
        ],
      ),
    );
  }

  Widget _header(PifTheme theme) => Padding(
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
    child: Row(
      children: [
        if (_scopedEpic != null)
          IconButton(
            tooltip: 'Back to epics',
            icon: const Icon(Icons.arrow_back, size: 18),
            onPressed: () => setState(() => _scopedEpic = null),
          ),
        Text(
          repo.isEmpty ? 'TRACKER' : repo.toUpperCase(),
          style: TextStyle(
            color: theme.textMuted,
            fontWeight: FontWeight.w300,
            letterSpacing: 1,
            fontSize: 12,
          ),
        ),
        if (stale) ...[
          const SizedBox(width: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
            decoration: BoxDecoration(
              color: const Color(0xff4a3f1d),
              borderRadius: BorderRadius.circular(4),
            ),
            child: const Text(
              'cached',
              style: TextStyle(color: Color(0xffe6c86e), fontSize: 10),
            ),
          ),
        ],
        const Spacer(),
        if (_scopedEpic == null) _scopeSwitch(theme),
        IconButton(
          tooltip: 'New ticket',
          icon: const Icon(Icons.add, size: 20),
          onPressed: columns.isEmpty ? null : () => _openSheet(card: null),
        ),
        IconButton(
          tooltip: 'Refresh board',
          icon: const Icon(Icons.refresh, size: 18),
          onPressed: () =>
              widget.host.bus.send('tracker/control', 'refresh', const {}),
        ),
      ],
    ),
  );

  /// Scope switch (#188): "All work" is today's board, untouched; "Epics"
  /// opens the overview that drills into per-epic project boards.
  Widget _scopeSwitch(PifTheme theme) => Padding(
    padding: const EdgeInsets.only(right: 6),
    child: ToggleButtons(
      isSelected: [!_epicsView, _epicsView],
      onPressed: (index) => setState(() => _epicsView = index == 1),
      borderRadius: BorderRadius.circular(6),
      constraints: const BoxConstraints(minHeight: 28, minWidth: 60),
      textStyle: const TextStyle(fontSize: 11),
      color: theme.textMuted,
      selectedColor: theme.accent,
      children: const [
        Padding(padding: EdgeInsets.symmetric(horizontal: 10), child: Text('All work')),
        Padding(padding: EdgeInsets.symmetric(horizontal: 10), child: Text('Epics')),
      ],
    ),
  );

  Widget _empty(PifTheme theme) => Center(
    child: Text(
      'No board yet — open a GitHub repo and refresh',
      style: TextStyle(color: theme.textMuted, fontSize: 12),
    ),
  );

  Widget _board(PifTheme theme) => ListView.builder(
    scrollDirection: Axis.horizontal,
    padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
    itemCount: columns.length,
    itemBuilder: (context, index) => _column(context, columns[index], theme),
  );

  /// Cards belonging to an epic's family: the epic itself, its direct
  /// children, and children of its sprints. Parent links come from the hub
  /// sync (#188); anything without a resolvable parent stays out of scoped
  /// views — ambiguity must never place a card under the wrong epic.
  bool _inEpicFamily(Map<String, dynamic> card, int epicNumber) {
    if (card['number'] == epicNumber) return true;
    if (card['parent'] == epicNumber) return true;
    final sprintNumbers = cards
        .where((candidate) =>
            '${candidate['type']}' == 'sprint' &&
            candidate['parent'] == epicNumber)
        .map((candidate) => candidate['number'])
        .toSet();
    return sprintNumbers.contains(card['parent']);
  }

  /// The Epics overview (#188): one content card per epic with per-column
  /// counts of its family; tap drills into the epic's own board.
  Widget _epicsOverview(PifTheme theme) {
    final epics = cards.where((card) => '${card['type']}' == 'epic').toList()
      ..sort(
        (a, b) => '${b['updatedAt'] ?? ''}'.compareTo('${a['updatedAt'] ?? ''}'),
      );
    if (epics.isEmpty) {
      return Center(
        child: Text(
          'No epics on this board',
          style: TextStyle(color: theme.textMuted, fontSize: 12),
        ),
      );
    }
    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(12, 4, 12, 12),
      itemCount: epics.length,
      itemBuilder: (context, index) {
        final epic = epics[index];
        final epicNumber = epic['number'] as int;
        final perColumn = <String, int>{};
        for (final card in cards) {
          if (card['number'] == epicNumber) continue;
          if (!_inEpicFamily(card, epicNumber)) continue;
          final columnId = '${card['column']}';
          perColumn[columnId] = (perColumn[columnId] ?? 0) + 1;
        }
        final summary = columns
            .map((column) {
              final count = perColumn['${column['id']}'] ?? 0;
              return count > 0 ? '${column['name']} $count' : null;
            })
            .whereType<String>()
            .join('  ·  ');
        return _contentCard(
          context,
          card: epic,
          theme: theme,
          countsSummary: summary,
          onTap: () => setState(() => _scopedEpic = epicNumber),
        );
      },
    );
  }

  /// The epic-scoped board (#188): the epic pinned as a header card at the
  /// top, lanes containing only that epic's family. Drags write back to the
  /// tracker exactly like the All-work view.
  Widget _scopedBoard(BuildContext context, PifTheme theme) {
    final epicNumber = _scopedEpic!;
    final epicCards = cards
        .where((card) => card['number'] == epicNumber)
        .toList();
    if (epicCards.isEmpty) {
      return Center(
        child: Text(
          'Epic #$epicNumber is no longer on the board',
          style: TextStyle(color: theme.textMuted, fontSize: 12),
        ),
      );
    }
    // The epic renders as the pinned header card — not duplicated as a
    // lane card — so the lanes hold only its sprints and tasks.
    final family = cards
        .where(
          (card) => card['number'] != epicNumber && _inEpicFamily(card, epicNumber),
        )
        .toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 4, 12, 0),
          child: _contentCard(
            context,
            card: epicCards.first,
            theme: theme,
            countsSummary: 'tap for details',
            onTap: () => _openSheet(card: epicCards.first),
          ),
        ),
        Expanded(
          child: ListView.builder(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
            itemCount: columns.length,
            itemBuilder: (context, index) => _column(
              context,
              columns[index],
              theme,
              pool: family,
              contentCards: true,
              width: 300,
            ),
          ),
        ),
      ],
    );
  }

  /// Content card anatomy (#188, macOS Reminders reference): `#NNN — Title`
  /// header, quiet body excerpt cropped at five lines, theme tokens only —
  /// no status line (the lane carries status) and no hardcoded colours.
  Widget _contentCard(
    BuildContext context, {
    required Map<String, dynamic> card,
    required PifTheme theme,
    String? countsSummary,
    double? width,
    required VoidCallback onTap,
  }) {
    final number = card['number'] as int;
    final type = '${card['type'] ?? 'issue'}';
    final excerpt = '${card['excerpt'] ?? ''}';
    final surface = Container(
      width: width,
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: theme.panelRaised,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: theme.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                decoration: BoxDecoration(
                  color: _typeColor(type),
                  borderRadius: BorderRadius.circular(3),
                ),
                child: Text(
                  type.toUpperCase(),
                  style: const TextStyle(fontSize: 9, letterSpacing: 0.5),
                ),
              ),
              if (card['state'] == 'closed')
                Padding(
                  padding: const EdgeInsets.only(left: 6),
                  child: Icon(
                    Icons.check_circle_outline,
                    size: 11,
                    color: theme.accent,
                  ),
                ),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  '#$number — ${card['title'] ?? ''}',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
            ],
          ),
          if (excerpt.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(
              excerpt,
              maxLines: 5,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 10, color: theme.textMuted),
            ),
          ],
          if (countsSummary != null && countsSummary.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(
              countsSummary,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 10, color: theme.textMuted),
            ),
          ],
        ],
      ),
    );
    return InkWell(onTap: onTap, child: surface);
  }

  Widget _column(
    BuildContext context,
    Map<String, dynamic> column,
    PifTheme theme, {
    List<Map<String, dynamic>>? pool,
    bool contentCards = false,
    double width = 260,
  }) {
    final columnId = '${column['id']}';
    final source = pool ?? cards;
    final columnCards =
        source.where((card) => '${card['column']}' == columnId).toList();
    return DragTarget<Map>(
      onWillAcceptWithDetails: (details) => true,
      onAcceptWithDetails: (details) =>
          _moveCard(details.data['number'] as int, columnId),
      builder: (context, candidates, rejected) => Container(
        width: width,
        margin: const EdgeInsets.only(right: 10),
        decoration: BoxDecoration(
          color: theme.panelRaised,
          borderRadius: BorderRadius.circular(6),
          border: Border.all(
            color: candidates.isNotEmpty ? theme.accent : theme.border,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(10, 8, 10, 6),
              child: Text(
                '${column['name']}  ${columnCards.length}',
                style: TextStyle(
                  color: theme.textMuted,
                  fontSize: 11,
                  fontWeight: FontWeight.w300,
                  letterSpacing: 0.5,
                ),
              ),
            ),
            Expanded(
              child: ListView.builder(
                padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
                itemCount: columnCards.length,
                itemBuilder: (context, index) => contentCards
                    ? _contentCard(
                        context,
                        card: columnCards[index],
                        theme: theme,
                        onTap: () => _openSheet(card: columnCards[index]),
                      )
                    : _card(context, columnCards[index], theme),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _card(
    BuildContext context,
    Map<String, dynamic> card,
    PifTheme theme,
  ) {
    final number = card['number'] as int;
    final type = '${card['type'] ?? 'issue'}';
    return Draggable<Map>(
      data: card,
      feedback: SizedBox(
        width: 236,
        child: Card(
          color: theme.panelRaised,
          child: Padding(
            padding: const EdgeInsets.all(8),
            child: Text(
              '#$number  ${card['title'] ?? ''}',
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 12),
            ),
          ),
        ),
      ),
      childWhenDragging: Opacity(
        opacity: 0.4,
        child: _cardSurface(card, theme, number, type),
      ),
      child: InkWell(
        onTap: () => _openSheet(card: card),
        child: _cardSurface(card, theme, number, type),
      ),
    );
  }

  Widget _cardSurface(
    Map<String, dynamic> card,
    PifTheme theme,
    int number,
    String type,
  ) => Card(
    color: const Color(0xff10141c),
    margin: const EdgeInsets.only(bottom: 6),
    child: Padding(
      padding: const EdgeInsets.all(8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                decoration: BoxDecoration(
                  color: _typeColor(type),
                  borderRadius: BorderRadius.circular(3),
                ),
                child: Text(
                  type.toUpperCase(),
                  style: const TextStyle(fontSize: 9, letterSpacing: 0.5),
                ),
              ),
              const SizedBox(width: 6),
              Text(
                '#$number',
                style: TextStyle(color: theme.textMuted, fontSize: 10),
              ),
              if (card['state'] == 'closed')
                Padding(
                  padding: const EdgeInsets.only(left: 6),
                  child: Icon(
                    Icons.check_circle_outline,
                    size: 11,
                    color: theme.accent,
                  ),
                ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            '${card['title'] ?? ''}',
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w300),
          ),
        ],
      ),
    ),
  );

  Color _typeColor(String type) => switch (type) {
    'epic' => const Color(0x669b6dff),
    'sprint' => const Color(0x665bb3d4),
    'task' => const Color(0x6678dba9),
    _ => const Color(0x668b96aa),
  };
}

/// Resizable, draggable ticket sheet: view / edit / create a card, move it
/// between lanes, or delete it. Drag the title bar to reposition; drag the
/// corner handle to resize. Every operation is optimistic locally and
/// reverted when the hub reports a failure via `tracker/op` op_result.
class _TicketSheet extends StatefulWidget {
  const _TicketSheet({
    required this.host,
    required this.card,
    required this.columns,
    required this.onMove,
  });
  final PifHost host;
  final Map<String, dynamic>? card;
  final List<Map<String, dynamic>> columns;
  final void Function(int number, String column) onMove;
  @override
  State<_TicketSheet> createState() => _TicketSheetState();
}

class _TicketSheetState extends State<_TicketSheet> {
  late final Map<String, dynamic>? _card;
  late final bool _creating;
  bool _editing = false;
  bool _busy = false;
  String? _error;
  late final TextEditingController _title;
  late final TextEditingController _body;
  String _type = 'task';
  late String _createColumn;
  Size _size = const Size(660, 560);
  String? _revertColumn;
  Offset? _position;
  final GlobalKey _boxKey = GlobalKey();
  late StreamSubscription _subscription;
  static const _minSize = Size(460, 360);

  @override
  void initState() {
    super.initState();
    _card = widget.card == null
        ? null
        : Map<String, dynamic>.from(widget.card!);
    _creating = _card == null;
    _editing = _creating;
    _title = TextEditingController(text: '${_card?['title'] ?? ''}');
    _body = TextEditingController(text: '${_card?['body'] ?? ''}');
    final openColumns = widget.columns
        .where((column) => column['id'] != null)
        .toList();
    _createColumn = openColumns.isNotEmpty ? '${openColumns.first['id']}' : '';
    _type = '${_card?['type'] ?? 'task'}';
    _restoreSize();
    _subscription = widget.host.bus.events.listen((event) {
      if (event.channel == 'tracker/op' && event.type == 'op_result') {
        _onOpResult(event.payload);
      } else if (event.channel == 'tracker/move' &&
          event.type == 'move_result') {
        _onMoveResult(event.payload);
      }
    });
  }

  void _restoreSize() {
    final width = widget.host.storage.read('tracker_board', 'sheet_w');
    final height = widget.host.storage.read('tracker_board', 'sheet_h');
    _size = Size(
      width is num ? width.toDouble() : _size.width,
      height is num ? height.toDouble() : _size.height,
    );
  }

  void _persistSize() {
    widget.host.storage
        .write('tracker_board', 'sheet_w', _size.width)
        .catchError((Object _) {});
    widget.host.storage
        .write('tracker_board', 'sheet_h', _size.height)
        .catchError((Object _) {});
  }

  void _onOpResult(Object? payload) {
    if (!mounted || payload is! Map) return;
    final op = '${payload['op'] ?? ''}';
    final ok = payload['ok'] == true;
    if (op == 'create' && _creating) {
      if (ok) return Navigator.of(context).pop();
      setState(() {
        _busy = false;
        _error = '${payload['error'] ?? 'create failed'}';
      });
    } else if (op == 'update' && _editing && !_creating) {
      if (ok) {
        setState(() {
          _card!['title'] = _title.text.trim();
          _card['body'] = _body.text;
          _busy = false;
          _editing = false;
        });
      } else {
        setState(() {
          _busy = false;
          _error = '${payload['error'] ?? 'update failed'}';
        });
      }
    } else if (op == 'delete' && !_creating) {
      if (ok) return Navigator.of(context).pop();
      setState(() {
        _busy = false;
        _error = '${payload['error'] ?? 'delete failed'}';
      });
    }
  }

  void _onMoveResult(Object? payload) {
    if (!mounted || payload is! Map || _card == null) return;
    if (payload['number'] != _card['number']) return;
    if (payload['ok'] == true) {
      setState(() => _revertColumn = null);
    } else if (_revertColumn != null) {
      setState(() {
        _card['column'] = _revertColumn;
        _revertColumn = null;
        _error = '${payload['error'] ?? 'move failed'}';
      });
    }
  }

  @override
  void dispose() {
    _subscription.cancel();
    _title.dispose();
    _body.dispose();
    super.dispose();
  }

  void _send(String op, Map<String, Object?> payload) {
    setState(() {
      _busy = true;
      _error = null;
    });
    widget.host.bus.send('tracker/control', op, payload);
  }

  void _submitCreate() {
    if (_title.text.trim().isEmpty) {
      setState(() => _error = 'Title is required');
      return;
    }
    _send('create', {
      'title': _title.text.trim(),
      'body': _body.text,
      'type': _type,
      'column': _createColumn,
    });
  }

  void _submitUpdate() {
    if (_title.text.trim().isEmpty) {
      setState(() => _error = 'Title cannot be empty');
      return;
    }
    _send('update', {
      'number': _card!['number'],
      'title': _title.text.trim(),
      'body': _body.text,
    });
  }

  void _moveTo(String columnId) {
    if (_card == null || columnId == '${_card['column']}') return;
    _revertColumn = '${_card['column']}';
    setState(() => _card['column'] = columnId);
    widget.onMove(_card['number'] as int, columnId);
  }

  void _confirmDelete() {
    showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: widget.host.theme.panelRaised,
        title: const Text('Delete ticket?', style: TextStyle(fontSize: 15)),
        content: Text(
          '#${_card!['number']} will be permanently deleted from GitHub.',
          style: const TextStyle(fontSize: 12),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton.tonal(
            onPressed: () {
              Navigator.of(dialogContext).pop();
              _send('delete', {'number': _card['number']});
            },
            child: const Text('Delete'),
          ),
        ],
      ),
    );
  }

  /// Dragging the title bar repositions the sheet; the first drag anchors
  /// from wherever the centered sheet currently sits. Clamps keep part of
  /// the header and the resize corner reachable on screen.
  void _beginDrag(DragStartDetails details) {
    if (_position != null) return;
    final box = _boxKey.currentContext?.findRenderObject() as RenderBox?;
    if (box != null) _position = box.localToGlobal(Offset.zero);
  }

  void _updateDrag(Offset delta) {
    final screen = MediaQuery.of(context).size;
    final start = _position ?? Offset.zero;
    setState(() {
      _position = Offset(
        (start.dx + delta.dx).clamp(-(_size.width - 160), screen.width - 160),
        (start.dy + delta.dy).clamp(8.0, screen.height - 80),
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = widget.host.theme;
    final maxSize = Size(
      MediaQuery.of(context).size.width - 80,
      MediaQuery.of(context).size.height - 80,
    );
    final sheet = Material(
      color: Colors.transparent,
      child: Container(
        key: _boxKey,
        decoration: BoxDecoration(
          color: theme.panelRaised,
          borderRadius: BorderRadius.circular(12),
        ),
        child: SizedBox(
          key: const Key('tracker_sheet_box'),
          width: _size.width.clamp(_minSize.width, maxSize.width),
          height: _size.height.clamp(_minSize.height, maxSize.height),
          child: Stack(
            children: [
              Positioned.fill(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _topBar(theme),
                    if (_error != null)
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        child: Text(
                          _error!,
                          style: const TextStyle(
                            color: Color(0xffe2a4a4),
                            fontSize: 11,
                          ),
                        ),
                      ),
                    Expanded(child: _content(theme)),
                    if (_creating || _editing) _footer(theme),
                  ],
                ),
              ),
              Positioned(bottom: 4, right: 4, child: _resizeHandle()),
            ],
          ),
        ),
      ),
    );
    return Stack(
      children: [
        if (_position != null)
          Positioned(left: _position!.dx, top: _position!.dy, child: sheet)
        else
          Center(child: sheet),
      ],
    );
  }

  Widget _topBar(PifTheme theme) => MouseRegion(
    cursor: SystemMouseCursors.move,
    child: GestureDetector(
      key: const Key('tracker_sheet_titlebar'),
      onPanStart: _beginDrag,
      onPanUpdate: (details) => _updateDrag(details.delta),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 8, 0),
        child: Row(
          children: [
            Expanded(
              child: Text(
                _creating
                    ? 'New ticket'
                    : '#${_card!['number']}  ${_card['title'] ?? ''}',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w300,
                ),
              ),
            ),
            if (!_creating) ...[
              if (!_editing) _moveDropdown(theme),
              IconButton(
                tooltip: _editing ? 'Cancel editing' : 'Edit',
                icon: Icon(
                  _editing ? Icons.close : Icons.edit_outlined,
                  size: 17,
                ),
                onPressed: _busy
                    ? null
                    : () {
                        setState(() {
                          _editing = !_editing;
                          if (!_editing) {
                            _title.text = '${_card!['title'] ?? ''}';
                            _body.text = '${_card['body'] ?? ''}';
                          }
                        });
                      },
              ),
              IconButton(
                tooltip: 'Delete ticket',
                icon: const Icon(Icons.delete_outline, size: 18),
                onPressed: _busy ? null : _confirmDelete,
              ),
            ],
            IconButton(
              icon: const Icon(Icons.close, size: 18),
              onPressed: () => Navigator.of(context).pop(),
            ),
          ],
        ),
      ),
    ),
  );

  Widget _moveDropdown(PifTheme theme) => SizedBox(
    key: const Key('tracker_sheet_move'),
    width: 130,
    height: 34,
    child: DropdownButtonHideUnderline(
      child: DropdownButton<String>(
        value: '${_card!['column']}',
        items: widget.columns
            .map(
              (column) => DropdownMenuItem(
                value: '${column['id']}',
                child: Text(
                  '${column['name']}',
                  style: const TextStyle(fontSize: 12),
                ),
              ),
            )
            .toList(),
        onChanged: (value) {
          if (value != null) _moveTo(value);
        },
      ),
    ),
  );

  Widget _content(PifTheme theme) => Padding(
    padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
    child: _creating || _editing
        ? SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (_creating)
                  Row(
                    children: [
                      _typeDropdown(theme),
                      const SizedBox(width: 12),
                      Expanded(child: _columnDropdown(theme)),
                    ],
                  ),
                const SizedBox(height: 8),
                TextField(
                  key: const Key('tracker_sheet_title'),
                  controller: _title,
                  style: const TextStyle(fontSize: 13),
                  decoration: const InputDecoration(
                    labelText: 'Title',
                    isDense: true,
                  ),
                ),
                const SizedBox(height: 10),
                SizedBox(
                  height: 240,
                  child: TextField(
                    key: const Key('tracker_sheet_body'),
                    controller: _body,
                    maxLines: null,
                    expands: true,
                    textAlignVertical: TextAlignVertical.top,
                    style: const TextStyle(fontSize: 12),
                    decoration: const InputDecoration(
                      labelText: 'Body (Markdown)',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                ),
              ],
            ),
          )
        : Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Text(
                  [
                    '${_card!['type'] ?? 'issue'} · ${_card['state'] ?? 'open'}',
                    if ((_card['labels'] as List?)?.isNotEmpty == true)
                      ...(_card['labels'] as List).map((label) => '$label'),
                  ].join('  ·  '),
                  style: TextStyle(color: theme.textMuted, fontSize: 11),
                ),
              ),
              const Divider(height: 8),
              Expanded(
                child: SingleChildScrollView(
                  child: SelectionArea(
                    child: MarkdownBody(data: '${_card['body'] ?? ''}'),
                  ),
                ),
              ),
            ],
          ),
  );

  Widget _typeDropdown(PifTheme theme) => SizedBox(
    key: const Key('tracker_sheet_type'),
    height: 34,
    child: DropdownButtonHideUnderline(
      child: DropdownButton<String>(
        value: _type,
        items: const ['epic', 'sprint', 'task', 'issue']
            .map(
              (type) => DropdownMenuItem(
                value: type,
                child: Text(type.toUpperCase(), style: TextStyle(fontSize: 12)),
              ),
            )
            .toList(),
        onChanged: (value) {
          if (value != null) setState(() => _type = value);
        },
      ),
    ),
  );

  Widget _columnDropdown(PifTheme theme) => SizedBox(
    key: const Key('tracker_sheet_column'),
    height: 34,
    child: DropdownButtonHideUnderline(
      child: DropdownButton<String>(
        value: _createColumn,
        items: widget.columns
            .map(
              (column) => DropdownMenuItem(
                value: '${column['id']}',
                child: Text(
                  '${column['name']}',
                  style: const TextStyle(fontSize: 12),
                ),
              ),
            )
            .toList(),
        onChanged: (value) {
          if (value != null) setState(() => _createColumn = value);
        },
      ),
    ),
  );

  Widget _footer(PifTheme theme) => Padding(
    padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
    child: Row(
      mainAxisAlignment: MainAxisAlignment.end,
      children: [
        if (_creating)
          TextButton(
            onPressed: _busy ? null : () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
        const SizedBox(width: 8),
        FilledButton.tonal(
          key: const Key('tracker_sheet_submit'),
          onPressed: _busy ? null : (_creating ? _submitCreate : _submitUpdate),
          child: Text(_busy ? 'Saving…' : (_creating ? 'Create' : 'Save')),
        ),
      ],
    ),
  );

  Widget _resizeHandle() => MouseRegion(
    cursor: SystemMouseCursors.resizeDownRight,
    child: GestureDetector(
      key: const Key('tracker_sheet_resize'),
      onPanUpdate: (details) {
        setState(() {
          _size = Size(
            (_size.width + details.delta.dx).clamp(_minSize.width, 4000),
            (_size.height + details.delta.dy).clamp(_minSize.height, 4000),
          );
        });
      },
      onPanEnd: (_) => _persistSize(),
      child: Padding(
        padding: const EdgeInsets.all(4),
        child: Transform.rotate(
          angle: -0.785398,
          child: Icon(
            Icons.drag_indicator,
            size: 15,
            color: widget.host.theme.textMuted,
          ),
        ),
      ),
    ),
  );
}
