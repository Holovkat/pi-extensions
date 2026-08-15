import 'package:flutter/material.dart';
import '../../core/plugin.dart';

/// Phase 1 dogfood widget: scaffolded with pif_widget_create, implemented as
/// ordinary Dart, analyze-gated, registered, and opened through pif_layout.
class DiffViewerPlugin implements PifWidgetPlugin {
  @override
  PifWidgetMeta get meta => const PifWidgetMeta(
    id: 'diff_viewer',
    name: 'Diff Viewer',
    slot: PifSlot.center,
    description: 'Compare two text revisions',
  );
  @override
  Widget build(BuildContext context, PifHost host) => const _DiffViewer();
}

class _DiffViewer extends StatefulWidget {
  const _DiffViewer();
  @override
  State<_DiffViewer> createState() => _DiffViewerState();
}

class _DiffViewerState extends State<_DiffViewer> {
  final before = TextEditingController(
    text: 'everything on screen is a widget\nterminal only',
  );
  final after = TextEditingController(
    text: 'everything on screen is a widget\nFlutter shell\nagent console',
  );
  @override
  void dispose() {
    before.dispose();
    after.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final left = before.text.split('\n');
    final right = after.text.split('\n');
    final rows = <Widget>[];
    for (
      var i = 0;
      i < (left.length > right.length ? left.length : right.length);
      i++
    ) {
      final oldLine = i < left.length ? left[i] : '';
      final newLine = i < right.length ? right[i] : '';
      final changed = oldLine != newLine;
      rows.add(
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: _line(
                oldLine,
                changed ? const Color(0xff3b2028) : Colors.transparent,
                changed ? '-' : ' ',
              ),
            ),
            const VerticalDivider(width: 1),
            Expanded(
              child: _line(
                newLine,
                changed ? const Color(0xff16372a) : Colors.transparent,
                changed ? '+' : ' ',
              ),
            ),
          ],
        ),
      );
    }
    return Column(
      children: [
        Container(
          height: 42,
          padding: const EdgeInsets.symmetric(horizontal: 14),
          child: const Row(
            children: [
              Icon(Icons.difference_outlined, size: 18),
              SizedBox(width: 8),
              Text(
                'Diff Viewer',
                style: TextStyle(fontWeight: FontWeight.w600),
              ),
              Spacer(),
              Text(
                'Phase 1 dogfood',
                style: TextStyle(fontSize: 11, color: Color(0xff8b96aa)),
              ),
            ],
          ),
        ),
        Expanded(
          flex: 2,
          child: Row(
            children: [
              Expanded(
                child: TextField(
                  controller: before,
                  expands: true,
                  maxLines: null,
                  onChanged: (_) => setState(() {}),
                  decoration: const InputDecoration(
                    labelText: 'Before',
                    alignLabelWithHint: true,
                    filled: true,
                  ),
                ),
              ),
              Expanded(
                child: TextField(
                  controller: after,
                  expands: true,
                  maxLines: null,
                  onChanged: (_) => setState(() {}),
                  decoration: const InputDecoration(
                    labelText: 'After',
                    alignLabelWithHint: true,
                    filled: true,
                  ),
                ),
              ),
            ],
          ),
        ),
        const Divider(height: 1),
        Expanded(flex: 3, child: ListView(children: rows)),
      ],
    );
  }

  Widget _line(String value, Color color, String marker) => Container(
    color: color,
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 18,
          child: Text(marker, style: const TextStyle(fontFamily: 'monospace')),
        ),
        Expanded(
          child: SelectableText(
            value,
            style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
          ),
        ),
      ],
    ),
  );
}
