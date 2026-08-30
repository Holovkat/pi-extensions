import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pif/core/bus.dart';
import 'package:pif/core/plugin.dart';
import 'package:pif/widgets/tracker_board/tracker_board.dart';

class FakeBus extends PifBus {
  FakeBus() : super(uri: Uri.parse('ws://127.0.0.1:1/pif'));
  final sent = <Map<String, Object?>>[];
  final controller = StreamController<PifEnvelope>.broadcast();
  @override
  Stream<PifEnvelope> get events => controller.stream;
  @override
  Stream<PifEnvelope> channel(String prefix) =>
      events.where((event) => event.channel.startsWith(prefix));
  @override
  Stream<bool> get connection => const Stream.empty();
  @override
  bool get connected => true;
  @override
  Future<void> connect() async {}
  @override
  void send(String channel, String type, Object? payload) =>
      sent.add({'channel': channel, 'type': type, 'payload': payload});
  void emit(String channel, String type, Object? payload) => controller.add(
    PifEnvelope(
      v: 1,
      id: 'test',
      ts: DateTime(2026),
      channel: channel,
      type: type,
      payload: payload,
    ),
  );
  @override
  Future<void> dispose() => controller.close();
}

Map<String, dynamic> _card(
  int number,
  String title,
  String type,
  String column, {
  int? parent,
  String excerpt = '',
  bool closed = false,
}) => {
  'number': number,
  'title': title,
  'type': type,
  'state': closed ? 'closed' : 'open',
  'labels': [type],
  'body': 'Body of #$number',
  'excerpt': excerpt,
  'parent': parent,
  'updatedAt': '2026-08-30T0$number:00:00Z',
  'url': 'https://github.com/acme/widgets/issues/$number',
  'column': column,
};

Map<String, dynamic> _fixture() => {
  'repo': 'acme/widgets',
  'stale': false,
  'fetchedAt': '2026-08-30T01:00:00Z',
  'error': null,
  'columns': [
    {'id': 'todo', 'name': 'To Do'},
    {'id': 'review', 'name': 'Review'},
    {'id': 'done', 'name': 'Done'},
  ],
  'cards': [
    _card(
      10,
      'Epic: notes trial',
      'epic',
      'todo',
      excerpt: 'Prove the app builder with a real notes app built by agents.',
    ),
    _card(13, 'Sprint: notes build', 'sprint', 'todo', parent: 10),
    _card(
      11,
      'Task: design pass',
      'task',
      'todo',
      parent: 10,
      excerpt: 'Design the notes app against the Mercury template.',
    ),
    _card(14, 'Task: cards page', 'task', 'review', parent: 13),
    _card(12, 'Unrelated thing', 'issue', 'done', closed: true),
    _card(
      15,
      'Epic: finished long ago',
      'epic',
      'done',
      closed: true,
      excerpt: 'This epic is closed and must not appear in the Epics overview.',
    ),
  ],
};

Widget _panel(PifWidgetPlugin plugin, PifHost host) => MaterialApp(
  theme: ThemeData.dark(),
  home: Scaffold(
    body: SizedBox(
      width: 1200,
      height: 800,
      child: Builder(builder: (context) => plugin.build(context, host)),
    ),
  ),
);

Future<(FakeBus, PifHost)> _pump(WidgetTester tester) async {
  final bus = FakeBus();
  final host = PifHost(bus: bus);
  host.snapshot = {'tracker': _fixture()};
  await tester.pumpWidget(_panel(TrackerBoardPlugin(), host));
  await tester.pump();
  return (bus, host);
}

void main() {
  testWidgets('All work view stays the default and shows every card', (
    tester,
  ) async {
    final (bus, _) = await _pump(tester);
    expect(find.text('All work'), findsOneWidget);
    expect(find.text('Epics'), findsOneWidget);
    expect(find.textContaining('Unrelated thing'), findsOneWidget);
    expect(find.textContaining('Task: design pass'), findsOneWidget);
    expect(find.textContaining('#10 — Epic: notes trial'), findsOneWidget);
    await bus.dispose();
  });

  testWidgets('Epics overview lists epics with excerpts and family counts', (
    tester,
  ) async {
    final (bus, _) = await _pump(tester);
    await tester.tap(find.text('Epics'));
    await tester.pump();
    expect(find.text('#10 — Epic: notes trial'), findsOneWidget);
    expect(
      find.text('Prove the app builder with a real notes app built by agents.'),
      findsOneWidget,
    );
    // Family: sprint #13 + tasks #11 (To Do) and #14 (Review).
    expect(find.textContaining('To Do 2'), findsOneWidget);
    expect(find.textContaining('Review 1'), findsOneWidget);
    // The overview is per-epic: unrelated work stays out, and closed epics
    // are done — hidden from the "what's next" list (owner, 2026-08-30).
    expect(find.text('Unrelated thing'), findsNothing);
    expect(find.text('#15 — Epic: finished long ago'), findsNothing);
    await bus.dispose();
  });

  testWidgets('drilling into an epic shows only its family, with a way back', (
    tester,
  ) async {
    final (bus, _) = await _pump(tester);
    await tester.tap(find.text('Epics'));
    await tester.pump();
    await tester.tap(find.text('#10 — Epic: notes trial'));
    await tester.pump();
    // Epic pinned as header card above the lanes.
    expect(find.text('#10 — Epic: notes trial'), findsOneWidget);
    expect(find.text('tap for details'), findsOneWidget);
    // Family members render in their lanes.
    expect(find.text('#11 — Task: design pass'), findsOneWidget);
    expect(find.text('#14 — Task: cards page'), findsOneWidget);
    // Anything outside the family is invisible here.
    expect(find.text('Unrelated thing'), findsNothing);
    // Breadcrumb back lands on the Epics overview — still per-epic scoped.
    await tester.tap(find.byTooltip('Back to epics'));
    await tester.pump();
    expect(find.text('#10 — Epic: notes trial'), findsOneWidget);
    expect(find.text('Unrelated thing'), findsNothing);
    // All work remains available and shows everything again.
    await tester.tap(find.text('All work'));
    await tester.pump();
    expect(find.textContaining('Unrelated thing'), findsOneWidget);
    await bus.dispose();
  });

  testWidgets('tapping the pinned epic header opens its detail sheet', (
    tester,
  ) async {
    final (bus, _) = await _pump(tester);
    await tester.tap(find.text('Epics'));
    await tester.pump();
    await tester.tap(find.text('#10 — Epic: notes trial'));
    await tester.pump();
    await tester.tap(find.text('tap for details'));
    await tester.pump();
    expect(find.byKey(const Key('tracker_sheet_box')), findsOneWidget);
    expect(find.text('Body of #10'), findsOneWidget);
    await bus.dispose();
  });

  testWidgets('moving a family card in the scoped view writes back to the tracker', (
    tester,
  ) async {
    final (bus, _) = await _pump(tester);
    await tester.tap(find.text('Epics'));
    await tester.pump();
    await tester.tap(find.text('#10 — Epic: notes trial'));
    await tester.pump();
    await tester.tap(find.text('#11 — Task: design pass'));
    await tester.pump();
    await tester.tap(find.byKey(const Key('tracker_sheet_move')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Review').last);
    await tester.pump();
    expect(
      bus.sent.where(
        (event) =>
            event['channel'] == 'tracker/control' &&
            event['type'] == 'move' &&
            (event['payload'] as Map)['number'] == 11 &&
            (event['payload'] as Map)['column'] == 'review',
      ),
      isNotEmpty,
    );
    await bus.dispose();
  });

  // (board scope tests above)

  testWidgets('clean sheet closes on X without prompting', (tester) async {
    final (bus, _) = await _pump(tester);
    await tester.tap(find.textContaining('Task: design pass'));
    await tester.pump();
    await tester.tap(find.byTooltip('Close'));
    await tester.pump();
    expect(find.byKey(const Key('tracker_sheet_box')), findsNothing);
    expect(find.text('Save changes?'), findsNothing);
    await bus.dispose();
  });

  testWidgets('dirty X prompts: No discards, Yes saves and closes', (
    tester,
  ) async {
    final (bus, _) = await _pump(tester);
    await tester.tap(find.textContaining('Task: design pass'));
    await tester.pump();
    await tester.tap(find.byIcon(Icons.edit_outlined));
    await tester.pump();
    await tester.enterText(
      find.byKey(const Key('tracker_sheet_title')),
      'Task: renamed again',
    );
    await tester.tap(find.byTooltip('Close'));
    await tester.pump();
    expect(find.text('Save changes?'), findsOneWidget);
    // No discards: sheet closes, nothing sent.
    await tester.tap(find.byKey(const Key('tracker_sheet_discard')));
    await tester.pump();
    expect(find.byKey(const Key('tracker_sheet_box')), findsNothing);
    expect(
      bus.sent.where((event) => event['type'] == 'update'),
      isEmpty,
    );
    // Reopen, edit, and confirm the save path.
    await tester.tap(find.textContaining('Task: design pass'));
    await tester.pump();
    await tester.tap(find.byIcon(Icons.edit_outlined));
    await tester.pump();
    await tester.enterText(
      find.byKey(const Key('tracker_sheet_title')),
      'Task: renamed again',
    );
    await tester.tap(find.byTooltip('Close'));
    await tester.pump();
    await tester.tap(find.byKey(const Key('tracker_sheet_save_close')));
    await tester.pump();
    expect(
      bus.sent.where(
        (event) =>
            event['type'] == 'update' &&
            (event['payload'] as Map)['title'] == 'Task: renamed again',
      ),
      isNotEmpty,
    );
    bus.emit('tracker/op', 'op_result', {
      'op': 'update',
      'ok': true,
      'number': 11,
    });
    await tester.pump();
    expect(find.byKey(const Key('tracker_sheet_box')), findsNothing);
    await bus.dispose();
  });

  testWidgets('editor preserves newlines and fills the remaining panel', (
    tester,
  ) async {
    final (bus, _) = await _pump(tester);
    await tester.tap(find.textContaining('Task: design pass'));
    await tester.pump();
    await tester.tap(find.byIcon(Icons.edit_outlined));
    await tester.pump();
    final sheetHeight = tester
        .getSize(find.byKey(const Key('tracker_sheet_box')))
        .height;
    final editorHeight = tester
        .getSize(find.byKey(const Key('tracker_sheet_body')))
        .height;
    expect(editorHeight, greaterThan(sheetHeight * 0.4));
    await tester.enterText(
      find.byKey(const Key('tracker_sheet_body')),
      'line one\n\nline two',
    );
    await tester.tap(find.byKey(const Key('tracker_sheet_submit')));
    await tester.pump();
    expect(
      bus.sent.where(
        (event) =>
            event['type'] == 'update' &&
            '((event.payload) as Map)'.contains('never') == false &&
            (event['payload'] as Map)['body'] == 'line one\n\nline two',
      ),
      isNotEmpty,
    );
    await bus.dispose();
  });

  testWidgets('pill tabs switch between body, attachments, and attributes', (
    tester,
  ) async {
    final (bus, _) = await _pump(tester);
    await tester.tap(find.textContaining('Task: design pass'));
    await tester.pump();
    await tester.tap(find.byKey(const Key('tracker_pill_attachments')));
    await tester.pump();
    expect(find.text('No attachments.'), findsOneWidget);
    await tester.tap(find.byKey(const Key('tracker_pill_attributes')));
    await tester.pump();
    expect(find.text('DATE & TIME'), findsOneWidget);
    expect(find.text('Urgent'), findsOneWidget);
    expect(find.text('Flag'), findsOneWidget);
    expect(find.text('Priority'), findsOneWidget);
    await tester.tap(find.byKey(const Key('tracker_pill_body')));
    await tester.pump();
    expect(find.text('DATE & TIME'), findsNothing);
    await bus.dispose();
  });

  testWidgets('images insert as width-tagged markdown and render inline', (
    tester,
  ) async {
    final (bus, _) = await _pump(tester);
    await tester.tap(find.textContaining('Task: design pass'));
    await tester.pump();
    await tester.tap(find.byIcon(Icons.edit_outlined));
    await tester.pump();
    await tester.tap(find.byKey(const Key('tracker_sheet_insert_image')));
    await tester.pump();
    await tester.enterText(
      find.byKey(const Key('tracker_image_source')),
      '/tmp/notes-sketch.png',
    );
    await tester.tap(find.text('Insert'));
    await tester.pump();
    expect(
      find.textContaining('![image|800](/tmp/notes-sketch.png)'),
      findsOneWidget,
    );
    await bus.dispose();
  });

  testWidgets('tags added in attributes sync as labels on save', (tester) async {
    final (bus, _) = await _pump(tester);
    await tester.tap(find.textContaining('Task: design pass'));
    await tester.pump();
    await tester.tap(find.byKey(const Key('tracker_pill_attributes')));
    await tester.pump();
    await tester.enterText(find.byKey(const Key('tracker_tag_input')), 'design');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pump();
    expect(find.text('design'), findsOneWidget);
    await tester.tap(find.byIcon(Icons.edit_outlined));
    await tester.pump();
    await tester.tap(find.byKey(const Key('tracker_sheet_submit')));
    await tester.pump();
    expect(
      bus.sent.where(
        (event) =>
            event['type'] == 'update' &&
            ((event['payload'] as Map)['labels'] as List).contains('design'),
      ),
      isNotEmpty,
    );
    await bus.dispose();
  });
}
