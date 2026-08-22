import 'dart:async';
import 'package:flutter/material.dart';
// This folder is copied to lib/widgets/workspace_clock before analysis.
import '../../core/plugin.dart';

class WorkspaceClockPlugin implements PifWidgetPlugin {
  @override PifWidgetMeta get meta => const PifWidgetMeta(id: 'workspace_clock', name: 'Workspace Clock', slot: PifSlot.right);
  @override Widget build(BuildContext context, PifHost host) => _Clock(workspace: host.workspace);
}
class _Clock extends StatefulWidget { const _Clock({required this.workspace}); final String workspace; @override State<_Clock> createState() => _ClockState(); }
class _ClockState extends State<_Clock> { Timer? timer; @override void initState() { super.initState(); timer = Timer.periodic(const Duration(seconds: 1), (_) { if (mounted) setState(() {}); }); } @override void dispose() { timer?.cancel(); super.dispose(); } @override Widget build(BuildContext context) => Center(child: Column(mainAxisSize: MainAxisSize.min, children: [Text(TimeOfDay.now().format(context), style: Theme.of(context).textTheme.displaySmall), const SizedBox(height: 8), Text(widget.workspace, textAlign: TextAlign.center)])); }
