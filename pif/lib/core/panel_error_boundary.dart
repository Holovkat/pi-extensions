import 'package:flutter/material.dart';
import 'plugin.dart';

class PanelErrorBoundary extends StatefulWidget {
  const PanelErrorBoundary({
    super.key,
    required this.plugin,
    required this.host,
  });
  final PifWidgetPlugin plugin;
  final PifHost host;

  @override
  State<PanelErrorBoundary> createState() => _PanelErrorBoundaryState();
}

class _PanelErrorBoundaryState extends State<PanelErrorBoundary> {
  Object? error;

  @override
  Widget build(BuildContext context) {
    if (error != null) {
      return Card(
        color: Theme.of(context).colorScheme.errorContainer,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.error_outline, color: Colors.redAccent),
              const SizedBox(height: 8),
              Text(
                '${widget.plugin.meta.name} failed\n$error',
                textAlign: TextAlign.center,
              ),
              TextButton(
                onPressed: () => widget.host.bus.send(
                  'widget/control',
                  'toggle',
                  {'id': widget.plugin.meta.id, 'enabled': false},
                ),
                child: const Text('Disable widget'),
              ),
            ],
          ),
        ),
      );
    }
    try {
      return widget.plugin.build(context, widget.host);
    } catch (caught) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) setState(() => error = caught);
      });
      return const SizedBox.shrink();
    }
  }
}
