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
  @override
  void initState() {
    super.initState();
    _readTrackerState(widget.host.snapshot['tracker']);
    subscription = widget.host.bus.events.listen((event) {
      if (event.type == 'snapshot' && event.payload is Map) {
        widget.host.snapshot = Map<String, dynamic>.from(
          event.payload as Map,
        );
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
    columns =
        (state['columns'] as List? ?? const [])
            .whereType<Map>()
            .map((column) => Map<String, dynamic>.from(column))
            .toList();
    cards =
        (state['cards'] as List? ?? const [])
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
          Expanded(child: columns.isEmpty ? _empty(theme) : _board(theme)),
        ],
      ),
    );
  }

  Widget _header(PifTheme theme) => Padding(
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
    child: Row(
      children: [
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
        IconButton(
          tooltip: 'Refresh board',
          icon: const Icon(Icons.refresh, size: 18),
          onPressed: () =>
              widget.host.bus.send('tracker/control', 'refresh', const {}),
        ),
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

  Widget _column(BuildContext context, Map<String, dynamic> column, PifTheme theme) {
    final columnId = '${column['id']}';
    final columnCards = cards
        .where((card) => '${card['column']}' == columnId)
        .toList();
    return DragTarget<Map>(
      onWillAcceptWithDetails: (details) => true,
      onAcceptWithDetails: (details) =>
          _moveCard(details.data['number'] as int, columnId),
      builder: (context, candidates, rejected) => Container(
        width: 260,
        margin: const EdgeInsets.only(right: 10),
        decoration: BoxDecoration(
          color: theme.panelRaised,
          borderRadius: BorderRadius.circular(6),
          border: Border.all(
            color: candidates.isNotEmpty
                ? theme.accent
                : theme.border,
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
                itemBuilder: (context, index) =>
                    _card(context, columnCards[index], theme),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _card(BuildContext context, Map<String, dynamic> card, PifTheme theme) {
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
        onTap: () => _openDetail(context, card),
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

  void _openDetail(BuildContext context, Map<String, dynamic> card) {
    showDialog<void>(
      context: context,
      builder: (context) => Dialog(
        backgroundColor: widget.host.theme.panelRaised,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 640, maxHeight: 640),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 8, 0),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        '#${card['number']}  ${card['title'] ?? ''}',
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w300,
                        ),
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.close, size: 18),
                      onPressed: () => Navigator.of(context).pop(),
                    ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Text(
                  [
                    '${card['type'] ?? 'issue'} · ${card['state'] ?? 'open'}',
                    if ((card['labels'] as List?)?.isNotEmpty == true)
                      ...((card['labels'] as List)
                          .map((label) => '$label')),
                  ].join('  ·  '),
                  style: TextStyle(
                    color: widget.host.theme.textMuted,
                    fontSize: 11,
                  ),
                ),
              ),
              const Divider(height: 12),
              Expanded(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                  child: SelectionArea(
                    child: MarkdownBody(data: '${card['body'] ?? ''}'),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
