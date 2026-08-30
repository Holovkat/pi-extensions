import 'package:flutter/material.dart';
import 'package:pif/core/plugin.dart';

class HomePlugin implements PifWidgetPlugin {
  const HomePlugin();
  @override
  PifWidgetMeta get meta => const PifWidgetMeta(id: 'home', name: 'Home', slot: PifSlot.page);
  @override
  Widget build(BuildContext context, PifHost host) => Scaffold(
    body: Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text('Home', style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: 8),
          Text('Scaffolded by pif_app_init — ready for its content.', style: Theme.of(context).textTheme.bodySmall),
        ],
      ),
    ),
  );
}
