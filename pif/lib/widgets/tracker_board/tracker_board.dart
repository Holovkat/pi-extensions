import 'dart:async';
import 'dart:io';
import 'package:markdown/markdown.dart' as md;
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

/// Resizable, draggable ticket sheet (#189): a chrome-free reading and
/// editing surface. One X means "leave" (dirty state prompts to save); the
/// title and body edit inline — same look as the rendered document, cursor
/// exactly where you tap; pill tabs split Body | Attachments | Attributes;
/// images embed as paragraph-width blocks, resizable in place; attributes
/// (dates, urgent, flag, priority, tags) persist in the tracker's local
/// store, with tags syncing to GitHub labels.
enum _Pane { body, attachments, attributes }

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
  bool _closeAfterSave = false;
  _Pane _pane = _Pane.body;
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
  static const _minSize = Size(520, 420);
  // Attributes overlay (tracker-local metadata; tags map to GitHub labels).
  DateTime? _attrDate;
  TimeOfDay? _attrTime;
  bool _urgent = false;
  bool _flag = false;
  String _priority = 'none';
  List<String> _tags = [];
  final _tagInput = TextEditingController();
  late String _originalTitle;
  late String _originalBody;

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
    _originalTitle = _title.text;
    _originalBody = _body.text;
    final openColumns = widget.columns
        .where((column) => column['id'] != null)
        .toList();
    _createColumn = openColumns.isNotEmpty ? '${openColumns.first['id']}' : '';
    _type = '${_card?['type'] ?? 'task'}';
    _loadAttributes();
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

  void _loadAttributes() {
    if (_card == null) return;
    final stored = widget.host.storage.read(
      'tracker_board',
      'attr_${_card['number']}',
    );
    if (stored is! Map) return;
    _attrDate = stored['date'] is String
        ? DateTime.tryParse(stored['date'] as String)
        : null;
    final time = stored['time'];
    if (time is String && time.contains(':')) {
      final parts = time.split(':');
      _attrTime = TimeOfDay(
        hour: int.tryParse(parts[0]) ?? 0,
        minute: int.tryParse(parts[1]) ?? 0,
      );
    }
    _urgent = stored['urgent'] == true;
    _flag = stored['flag'] == true;
    _priority = '${stored['priority'] ?? 'none'}';
    _tags = [
      for (final label in (_card['labels'] as List? ?? const []))
        if ('$label' != _type && !label.startsWith('status:')) '$label',
    ];
  }

  /// Attributes persist on every change — local metadata must never
  /// silently disappear (#189).
  void _persistAttributes() {
    if (_card == null) return;
    widget.host.storage.write('tracker_board', 'attr_${_card['number']}', {
      'date': _attrDate?.toIso8601String(),
      'time': _attrTime == null
          ? null
          : '${_attrTime!.hour.toString().padLeft(2, '0')}:${_attrTime!.minute.toString().padLeft(2, '0')}',
      'urgent': _urgent,
      'flag': _flag,
      'priority': _priority,
      'tags': _tags,
    }).catchError((Object _) {});
  }

  bool get _dirty =>
      _title.text != _originalTitle || _body.text != _originalBody;

  /// The single exit (#189): a clean sheet closes; a dirty one asks.
  void _handleClose() {
    if (!_dirty || _busy) return Navigator.of(context).pop();
    showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: widget.host.theme.panelRaised,
        title: const Text('Save changes?', style: TextStyle(fontSize: 15)),
        content: const Text(
          'You have unsaved changes.',
          style: TextStyle(fontSize: 12),
        ),
        actions: [
          TextButton(
            key: const Key('tracker_sheet_discard'),
            onPressed: () {
              Navigator.of(dialogContext).pop();
              Navigator.of(context).pop();
            },
            child: const Text('No'),
          ),
          FilledButton.tonal(
            key: const Key('tracker_sheet_save_close'),
            onPressed: () {
              Navigator.of(dialogContext).pop();
              setState(() => _closeAfterSave = true);
              if (_creating) {
                _submitCreate();
              } else {
                _submitUpdate();
              }
            },
            child: const Text('Yes'),
          ),
        ],
      ),
    );
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
        _closeAfterSave = false;
        _error = '${payload['error'] ?? 'create failed'}';
      });
    } else if (op == 'update' && _editing && !_creating) {
      if (ok) {
        setState(() {
          _card!['title'] = _title.text.trim();
          _card['body'] = _body.text;
          _busy = false;
          _originalTitle = _title.text;
          _originalBody = _body.text;
          if (_closeAfterSave) {
            _closeAfterSave = false;
            Navigator.of(context).pop();
          } else {
            _editing = false;
          }
        });
      } else {
        setState(() {
          _busy = false;
          _closeAfterSave = false;
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
    _tagInput.dispose();
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
      'labels': _tags,
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
                    _pillTabs(theme),
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
                _creating ? 'New ticket' : '#${_card!['number']}',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w300,
                  color: theme.textMuted,
                ),
              ),
            ),
            if (!_creating) ...[
              if (!_editing) _moveDropdown(theme),
              if (!_editing)
                IconButton(
                  tooltip: 'Edit',
                  icon: const Icon(Icons.edit_outlined, size: 17),
                  onPressed: _busy
                      ? null
                      : () => setState(() => _editing = true),
                ),
              IconButton(
                tooltip: 'Delete ticket',
                icon: const Icon(Icons.delete_outline, size: 18),
                onPressed: _busy ? null : _confirmDelete,
              ),
            ],
            // The single exit (#189): one X, dirty state prompts to save.
            IconButton(
              tooltip: 'Close',
              icon: const Icon(Icons.close, size: 18),
              onPressed: _busy ? null : _handleClose,
            ),
          ],
        ),
      ),
    ),
  );

  Widget _pillTabs(PifTheme theme) {
    Widget pill(String label, _Pane pane) => InkWell(
      key: Key('tracker_pill_${pane.name}'),
      onTap: () => setState(() => _pane = pane),
      borderRadius: BorderRadius.circular(14),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 5),
        decoration: BoxDecoration(
          color: _pane == pane ? theme.accent.withValues(alpha: 0.16) : null,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color: _pane == pane
                ? theme.accent.withValues(alpha: 0.6)
                : theme.border,
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 11,
            color: _pane == pane ? theme.accent : theme.textMuted,
          ),
        ),
      ),
    );
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 6, 16, 2),
      child: Row(
        children: [
          pill('Body', _Pane.body),
          const SizedBox(width: 6),
          pill('Attachments', _Pane.attachments),
          const SizedBox(width: 6),
          pill('Attributes', _Pane.attributes),
        ],
      ),
    );
  }

  Widget _content(PifTheme theme) {
    if (_pane == _Pane.attachments) return _attachmentsPane(theme);
    if (_pane == _Pane.attributes) return _attributesPane(theme);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
      child: _creating || _editing
          ? Column(
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
                const SizedBox(height: 4),
                // Inline title (#189): no border, no label — bold in edit
                // mode, cursor exactly where the user taps.
                TextField(
                  key: const Key('tracker_sheet_title'),
                  controller: _title,
                  style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
                  maxLines: 2,
                  minLines: 1,
                  textInputAction: TextInputAction.next,
                  decoration: const InputDecoration(
                    isDense: true,
                    border: InputBorder.none,
                    hintText: 'Title',
                  ),
                ),
                const SizedBox(height: 4),
                Row(
                  children: [
                    TextButton.icon(
                      key: const Key('tracker_sheet_insert_image'),
                      onPressed: _insertImage,
                      icon: const Icon(Icons.image_outlined, size: 15),
                      label: const Text(
                        'Insert image',
                        style: TextStyle(fontSize: 11),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      'Markdown',
                      style: TextStyle(
                        fontSize: 10,
                        color: theme.textMuted,
                      ),
                    ),
                  ],
                ),
                // The editor fills the entire remaining panel; newlines are
                // preserved exactly (#189 §6).
                Expanded(
                  child: TextField(
                    key: const Key('tracker_sheet_body'),
                    controller: _body,
                    maxLines: null,
                    expands: true,
                    textAlignVertical: TextAlignVertical.top,
                    style: const TextStyle(fontSize: 12.5),
                    decoration: const InputDecoration(
                      isDense: true,
                      border: InputBorder.none,
                    ),
                  ),
                ),
              ],
            )
          : Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // The title renders as part of the page (#189) — the top
                // bar carries only the number.
                Padding(
                  padding: const EdgeInsets.only(bottom: 4),
                  child: Text(
                    _title.text,
                    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w500),
                  ),
                ),
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
                // View mode renders the live body text — a resize in the
                // preview is real content, not a throwaway preview (#189).
                Expanded(
                  child: SingleChildScrollView(
                    child: SelectionArea(
                      child: MarkdownBody(
                        data: _body.text,
                        builders: {
                          'img': _SheetImageBuilder(onWidthChange: _setImageWidth),
                        },
                      ),
                    ),
                  ),
                ),
              ],
            ),
    );
  }

  /// Insert `![image|<width>](source)` at the cursor; the width lives in
  /// the markdown so position and size survive save/reload (#189).
  Future<void> _insertImage() async {
    final controller = TextEditingController();
    final source = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: widget.host.theme.panelRaised,
        title: const Text(
          'Insert image',
          style: TextStyle(fontSize: 15),
        ),
        content: TextField(
          key: const Key('tracker_image_source'),
          controller: controller,
          autofocus: true,
          style: const TextStyle(fontSize: 12),
          decoration: const InputDecoration(
            hintText: 'File path or https:// URL',
            isDense: true,
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton.tonal(
            onPressed: () =>
                Navigator.of(dialogContext).pop(controller.text.trim()),
            child: const Text('Insert'),
          ),
        ],
      ),
    );
    if (source == null || source.isEmpty) return;
    final position = _body.selection.baseOffset.clamp(0, _body.text.length);
    final insertion = '\n![image|800]($source)\n';
    final text =
        '${_body.text.substring(0, position)}$insertion${_body.text.substring(position)}';
    setState(() => _body.text = text);
  }

  /// Rewrite the width encoded in an image's markdown (`![alt|N](src)`) so
  /// a drag-resize is real, persisted content (#189).
  void _setImageWidth(String source, int width) {
    final escaped = RegExp.escape(source);
    final pattern = RegExp('(!\\[[^\\]]*)\\]\\($escaped\\)');
    final updated = pattern.firstMatch(_body.text) == null
        ? _body.text
        : _body.text.replaceAllMapped(
            pattern,
            (match) => '${match.group(1)}|$width]($source)',
          );
    if (updated != _body.text) setState(() => _body.text = updated);
  }

  Widget _attachmentsPane(PifTheme theme) {
    final assets = RegExp(r'!?\[([^\]]*)\]\(([^)]+)\)')
        .allMatches(_body.text)
        .map((match) => match.group(2)!)
        .toSet()
        .toList();
    if (assets.isEmpty) {
      return Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'No attachments.',
              style: TextStyle(fontSize: 12, color: theme.textMuted),
            ),
            const SizedBox(height: 6),
            Text(
              'Insert images from the Body tab — they embed inline in the '
              'document and are listed here. Files stay on this machine '
              '(tracker-local store); GitHub upload parity is planned.',
              style: TextStyle(fontSize: 11, color: theme.textMuted),
            ),
          ],
        ),
      );
    }
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        for (final asset in assets)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Row(
              children: [
                Icon(
                  asset.startsWith('http')
                      ? Icons.link
                      : Icons.image_outlined,
                  size: 15,
                  color: theme.textMuted,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    asset,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 11),
                  ),
                ),
                Text(
                  asset.startsWith('http') ? 'link' : 'local file',
                  style: TextStyle(fontSize: 10, color: theme.textMuted),
                ),
              ],
            ),
          ),
      ],
    );
  }

  Widget _attributesPane(PifTheme theme) {
    if (_creating) {
      return Padding(
        padding: const EdgeInsets.all(16),
        child: Text(
          'Save the ticket first, then set attributes.',
          style: TextStyle(fontSize: 12, color: theme.textMuted),
        ),
      );
    }
    final parentCard = () {
      final parent = _card!['parent'];
      if (parent == null) return null;
      final cards = (widget.host.snapshot['tracker'] as Map? ?? {})['cards'];
      if (cards is! List) return null;
      for (final candidate in cards) {
        if (candidate is Map && candidate['number'] == parent) {
          return '${candidate['title'] ?? 'Epic #$parent'}';
        }
      }
      return 'Epic #$parent';
    }();
    Widget toggleRow(
      String label,
      IconData icon,
      bool value,
      ValueChanged<bool> onChanged, {
      Widget? trailing,
      String? caption,
    }) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 16, color: theme.textMuted),
              const SizedBox(width: 10),
              Expanded(child: Text(label, style: const TextStyle(fontSize: 12.5))),
              if (trailing != null) ...[trailing, const SizedBox(width: 10)],
              Switch(value: value, onChanged: onChanged),
            ],
          ),
          if (caption != null)
            Padding(
              padding: const EdgeInsets.only(left: 26),
              child: Text(
                caption,
                style: TextStyle(fontSize: 10, color: theme.textMuted),
              ),
            ),
        ],
      ),
    );
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
      children: [
        Text(
          'DATE & TIME',
          style: TextStyle(
            fontSize: 10,
            letterSpacing: 1,
            color: theme.textMuted,
          ),
        ),
        toggleRow(
          'Date',
          Icons.event_outlined,
          _attrDate != null,
          (on) => setState(() {
            _attrDate = on ? DateTime.now() : null;
            _persistAttributes();
          }),
          trailing: _attrDate == null
              ? null
              : OutlinedButton(
                  onPressed: () async {
                    final picked = await showDatePicker(
                      context: context,
                      initialDate: _attrDate ?? DateTime.now(),
                      firstDate: DateTime(2020),
                      lastDate: DateTime(2100),
                    );
                    if (picked != null) {
                      setState(() => _attrDate = picked);
                      _persistAttributes();
                    }
                  },
                  child: Text(
                    '${_attrDate!.year}-${_attrDate!.month.toString().padLeft(2, '0')}-${_attrDate!.day.toString().padLeft(2, '0')}',
                    style: const TextStyle(fontSize: 11),
                  ),
                ),
        ),
        toggleRow(
          'Time',
          Icons.schedule_outlined,
          _attrTime != null,
          (on) => setState(() {
            _attrTime = on ? const TimeOfDay(hour: 9, minute: 0) : null;
            _persistAttributes();
          }),
          trailing: _attrTime == null
              ? null
              : OutlinedButton(
                  onPressed: () async {
                    final picked = await showTimePicker(
                      context: context,
                      initialTime: _attrTime!,
                    );
                    if (picked != null) {
                      setState(() => _attrTime = picked);
                      _persistAttributes();
                    }
                  },
                  child: Text(_attrTime!.format(context), style: const TextStyle(fontSize: 11)),
                ),
        ),
        toggleRow(
          'Urgent',
          Icons.notification_important_outlined,
          _urgent,
          (on) {
            setState(() => _urgent = on);
            _persistAttributes();
          },
          caption: 'Mark this ticket as urgent.',
        ),
        const Divider(height: 16),
        Text(
          'ORGANISATION',
          style: TextStyle(
            fontSize: 10,
            letterSpacing: 1,
            color: theme.textMuted,
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Row(
            children: [
              Icon(Icons.list_outlined, size: 16, color: theme.textMuted),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  parentCard ?? 'No parent epic',
                  style: const TextStyle(fontSize: 12.5),
                ),
              ),
            ],
          ),
        ),
        Text(
          'TAGS',
          style: TextStyle(
            fontSize: 10,
            letterSpacing: 1,
            color: theme.textMuted,
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final tag in _tags)
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 3,
                  ),
                  decoration: BoxDecoration(
                    color: theme.accent.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(tag, style: const TextStyle(fontSize: 11)),
                      const SizedBox(width: 4),
                      InkWell(
                        onTap: () {
                          setState(() => _tags = [..._tags]..remove(tag));
                          _persistAttributes();
                        },
                        child: const Icon(Icons.close, size: 12),
                      ),
                    ],
                  ),
                ),
              SizedBox(
                width: 120,
                child: TextField(
                  controller: _tagInput,
                  key: const Key('tracker_tag_input'),
                  style: const TextStyle(fontSize: 11),
                  decoration: const InputDecoration(
                    hintText: 'add tag',
                    isDense: true,
                    border: InputBorder.none,
                  ),
                  onSubmitted: (value) {
                    final tag = value.trim();
                    if (tag.isEmpty || _tags.contains(tag)) return;
                    setState(() {
                      _tags = [..._tags, tag];
                      _tagInput.clear();
                    });
                    _persistAttributes();
                  },
                ),
              ),
            ],
          ),
        ),
        const Divider(height: 16),
        toggleRow(
          'Flag',
          Icons.flag_outlined,
          _flag,
          (on) {
            setState(() => _flag = on);
            _persistAttributes();
          },
        ),
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Row(
            children: [
              Icon(Icons.low_priority_outlined, size: 16, color: theme.textMuted),
              const SizedBox(width: 10),
              const Expanded(
                child: Text('Priority', style: TextStyle(fontSize: 12.5)),
              ),
              DropdownButtonHideUnderline(
                child: DropdownButton<String>(
                  key: const Key('tracker_priority'),
                  value: _priority,
                  items: const ['none', 'low', 'medium', 'high']
                      .map(
                        (level) => DropdownMenuItem(
                          value: level,
                          child: Text(level, style: TextStyle(fontSize: 12)),
                        ),
                      )
                      .toList(),
                  onChanged: (value) {
                    if (value == null) return;
                    setState(() => _priority = value);
                    _persistAttributes();
                  },
                ),
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Text(
            'Attributes are stored with this tracker (local metadata); tags '
            'also sync to GitHub labels on save.',
            style: TextStyle(fontSize: 10, color: theme.textMuted),
          ),
        ),
      ],
    );
  }

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

  Widget _footer(PifTheme theme) => Padding(
    padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
    child: Row(
      mainAxisAlignment: MainAxisAlignment.end,
      children: [
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

/// Renders `![alt](src)` markdown images inside the sheet (#189): local
/// files and http(s) URLs, width from the alt text (`|NNN`), constrained to
/// the pane, with a drag handle that rewrites the width in the body —
/// resizing is content, not a view trick.
class _SheetImageBuilder extends MarkdownElementBuilder {
  _SheetImageBuilder({required this.onWidthChange});
  final void Function(String source, int width) onWidthChange;
  @override
  @override
  Widget? visitElementAfter(md.Element element, TextStyle? preferredStyle) {
    final source = element.attributes['src'] ?? '';
    final match = RegExp(r'\|\s*(\d+)').firstMatch(element.textContent);
    final requested = (match != null ? int.parse(match.group(1)!) : 800)
        .toDouble();
    final isNetwork = source.startsWith('http');
    Widget image = isNetwork
        ? Image.network(
            source,
            fit: BoxFit.contain,
            errorBuilder: (_, _, _) => _imagePlaceholder(),
          )
        : Image.file(
            File(source),
            fit: BoxFit.contain,
            errorBuilder: (_, _, _) => _imagePlaceholder(),
          );
    return LayoutBuilder(
      builder: (context, constraints) {
        final width = requested.clamp(160.0, constraints.maxWidth);
        return SizedBox(
          width: width,
          child: Stack(
            children: [
              image,
              Positioned(
                right: 0,
                top: 0,
                bottom: 0,
                child: GestureDetector(
                  key: const Key('tracker_image_resize'),
                  behavior: HitTestBehavior.opaque,
                  onHorizontalDragUpdate: (details) => onWidthChange(
                    source,
                    (width + details.delta.dx).round().clamp(160, 2000),
                  ),
                  child: const SizedBox(
                    width: 14,
                    child: MouseRegion(
                      cursor: SystemMouseCursors.resizeLeftRight,
                      child: Center(
                        child: Icon(Icons.drag_indicator, size: 12),
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _imagePlaceholder() => Container(
    height: 110,
    color: const Color(0x228b96aa),
    alignment: Alignment.center,
    child: const Icon(Icons.broken_image_outlined, size: 20),
  );
}
