import 'dart:convert';
import 'package:flutter/material.dart';
import '../../core/plugin.dart';

/// Opens the model manager as a dialog from the Session Rail.
void showModelManagerDialog(BuildContext context, PifHost host) {
  showDialog<void>(
    context: context,
    builder: (context) => _ModelManagerDialog(host: host),
  );
}

class _ModelManagerDialog extends StatefulWidget {
  const _ModelManagerDialog({required this.host});
  final PifHost host;
  @override
  State<_ModelManagerDialog> createState() => _ModelManagerDialogState();
}

class _ModelManagerDialogState extends State<_ModelManagerDialog> {
  late Map<String, dynamic> _providers;
  final _newProviderName = TextEditingController();
  final _newProviderUrl = TextEditingController();
  final _newProviderKey = TextEditingController();
  final _newProviderApi = TextEditingController(text: 'openai-completions');
  bool _adding = false;

  @override
  void initState() {
    super.initState();
    _providers = _deepCopy(widget.host.modelProviders);
  }

  Map<String, dynamic> _deepCopy(Map<String, dynamic> src) {
    return jsonDecode(jsonEncode(src)) as Map<String, dynamic>;
  }

  void _addProvider() {
    final name = _newProviderName.text.trim();
    if (name.isEmpty) return;
    setState(() {
      _providers[name] = {
        'baseUrl': _newProviderUrl.text.trim(),
        'apiKey': _newProviderKey.text.trim(),
        'api': _newProviderApi.text.trim(),
        'models': [],
      };
      _newProviderName.clear();
      _newProviderUrl.clear();
      _newProviderKey.clear();
      _newProviderApi.text = 'openai-completions';
      _adding = false;
    });
  }

  void _removeProvider(String name) {
    setState(() => _providers.remove(name));
  }

  void _addModel(String providerName, String id, String displayName) {
    setState(() {
      final provider = _providers[providerName] as Map<String, dynamic>;
      (provider['models'] as List).add({
        'id': id,
        'name': displayName.isEmpty ? id : displayName,
        'reasoning': false,
        'input': ['text'],
        'contextWindow': 32768,
        'maxTokens': 8192,
        'compat': {
          'supportsStore': false,
          'supportsDeveloperRole': false,
          'supportsReasoningEffort': false,
          'supportsUsageInStreaming': false,
          'supportsStrictMode': false,
          'maxTokensField': 'max_tokens',
        },
      });
    });
  }

  void _removeModel(String providerName, int index) {
    setState(() {
      final provider = _providers[providerName] as Map<String, dynamic>;
      (provider['models'] as List).removeAt(index);
    });
  }

  void _save() {
    widget.host.bus.send('models/save', 'save', {'providers': _providers});
    Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Model Manager'),
      content: SizedBox(
        width: 520,
        height: 600,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Available models (read-only)
            const Text(
              'AVAILABLE MODELS',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w300,
                letterSpacing: 1.2,
                color: Color(0xff8b96aa),
              ),
            ),
            const SizedBox(height: 6),
            Expanded(
              flex: widget.host.models.isEmpty ? 1 : 2,
              child: widget.host.models.isEmpty
                  ? const Text(
                      'No models available. Restart pi after adding providers.',
                      style: TextStyle(fontSize: 12, color: Color(0xff566175)),
                    )
                  : ListView(
                      children: widget.host.models.map((m) {
                        final parts = m.split('/');
                        return Padding(
                          padding: const EdgeInsets.symmetric(vertical: 2),
                          child: Row(
                            children: [
                              const Icon(Icons.memory, size: 14, color: Color(0xff78dba9)),
                              const SizedBox(width: 8),
                              Text(parts.first, style: const TextStyle(fontSize: 11, color: Color(0xff69758a))),
                              const SizedBox(width: 4),
                              Text(parts.last, style: const TextStyle(fontSize: 12)),
                            ],
                          ),
                        );
                      }).toList(),
                    ),
            ),
            const Divider(),
            // Custom providers (editable)
            const Text(
              'CUSTOM PROVIDERS',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w300,
                letterSpacing: 1.2,
                color: Color(0xff8b96aa),
              ),
            ),
            const SizedBox(height: 6),
            Expanded(
              flex: 4,
              child: ListView(
                children: [
                  ..._providers.entries.map((entry) => _providerCard(entry.key, entry.value as Map<String, dynamic>)),
                  if (_adding) _addProviderForm(),
                  if (!_adding)
                    TextButton.icon(
                      onPressed: () => setState(() => _adding = true),
                      icon: const Icon(Icons.add, size: 16),
                      label: const Text('Add Provider'),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 8),
            // Note
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: const Color(0xff1a1f2a),
                borderRadius: BorderRadius.circular(6),
              ),
              child: const Row(
                children: [
                  Icon(Icons.info_outline, size: 14, color: Color(0xff69758a)),
                  SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      'Restart pi for new providers to take effect in the model registry.',
                      style: TextStyle(fontSize: 11, color: Color(0xff69758a)),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        FilledButton(onPressed: _save, child: const Text('Save')),
      ],
    );
  }

  Widget _providerCard(String name, Map<String, dynamic> provider) {
    final models = (provider['models'] as List?) ?? [];
    return Card(
      color: const Color(0xff1a1f2a),
      margin: const EdgeInsets.only(bottom: 8),
      child: ExpansionTile(
        title: Text(name, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w300)),
        subtitle: Text(
          '${provider['api'] ?? 'unknown'} · ${models.length} model${models.length == 1 ? '' : 's'}',
          style: const TextStyle(fontSize: 11, color: Color(0xff69758a)),
        ),
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Base URL: ${provider['baseUrl'] ?? ''}',
                    style: const TextStyle(fontSize: 11, color: Color(0xff69758a))),
                const SizedBox(height: 4),
                Text('API Key: ${provider['apiKey'] != null && provider['apiKey'] != '' ? '•••••' : '(none)'}',
                    style: const TextStyle(fontSize: 11, color: Color(0xff69758a))),
                const SizedBox(height: 8),
                ...models.asMap().entries.map((e) => Padding(
                      padding: const EdgeInsets.symmetric(vertical: 2),
                      child: Row(
                        children: [
                          const Icon(Icons.memory, size: 12, color: Color(0xff69758a)),
                          const SizedBox(width: 6),
                          Text((e.value as Map)['id'] ?? '?', style: const TextStyle(fontSize: 12)),
                          const Spacer(),
                          IconButton(
                            icon: const Icon(Icons.close, size: 14),
                            onPressed: () => _removeModel(name, e.key),
                          ),
                        ],
                      ),
                    )),
                _AddModelForm(onAdd: (id, displayName) => _addModel(name, id, displayName)),
                const SizedBox(height: 8),
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton(
                    onPressed: () => _removeProvider(name),
                    style: TextButton.styleFrom(foregroundColor: Colors.redAccent),
                    child: const Text('Remove Provider', style: TextStyle(fontSize: 12)),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _addProviderForm() {
    return Card(
      color: const Color(0xff1a1f2a),
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('New Provider', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w300)),
            const SizedBox(height: 12),
            TextField(
              controller: _newProviderName,
              decoration: const InputDecoration(labelText: 'Provider name', isDense: true),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _newProviderUrl,
              decoration: const InputDecoration(labelText: 'Base URL', isDense: true, hintText: 'http://127.0.0.1:48080/v1'),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _newProviderKey,
              decoration: const InputDecoration(labelText: 'API Key', isDense: true),
              obscureText: true,
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _newProviderApi,
              decoration: const InputDecoration(labelText: 'API type', isDense: true, hintText: 'openai-completions'),
            ),
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(
                  onPressed: () => setState(() => _adding = false),
                  child: const Text('Cancel'),
                ),
                FilledButton(onPressed: _addProvider, child: const Text('Add')),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _AddModelForm extends StatefulWidget {
  const _AddModelForm({required this.onAdd});
  final void Function(String id, String name) onAdd;
  @override
  State<_AddModelForm> createState() => _AddModelFormState();
}

class _AddModelFormState extends State<_AddModelForm> {
  final _id = TextEditingController();
  final _name = TextEditingController();
  bool _show = false;

  @override
  Widget build(BuildContext context) {
    if (!_show) {
      return TextButton.icon(
        onPressed: () => setState(() => _show = true),
        icon: const Icon(Icons.add, size: 14),
        label: const Text('Add Model', style: TextStyle(fontSize: 12)),
      );
    }
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Row(
        children: [
          Expanded(
            flex: 2,
            child: TextField(
              controller: _id,
              decoration: const InputDecoration(labelText: 'Model ID', isDense: true),
              style: const TextStyle(fontSize: 12),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            flex: 2,
            child: TextField(
              controller: _name,
              decoration: const InputDecoration(labelText: 'Name', isDense: true),
              style: const TextStyle(fontSize: 12),
            ),
          ),
          const SizedBox(width: 8),
          IconButton(
            icon: const Icon(Icons.check, size: 18),
            onPressed: () {
              if (_id.text.trim().isNotEmpty) {
                widget.onAdd(_id.text.trim(), _name.text.trim());
                _id.clear();
                _name.clear();
                setState(() => _show = false);
              }
            },
          ),
        ],
      ),
    );
  }
}
