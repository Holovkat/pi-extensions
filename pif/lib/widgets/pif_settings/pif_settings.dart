import 'dart:async';
import 'package:flutter/material.dart';
import '../../core/appearance.dart';
import '../../core/github_connection.dart';
import '../../core/plugin.dart';

class PifSettingsPlugin implements PifWidgetPlugin {
  @override
  PifWidgetMeta get meta => const PifWidgetMeta(
    id: 'pif_settings',
    name: 'Settings',
    slot: PifSlot.center,
    core: true,
  );

  @override
  Widget build(BuildContext context, PifHost host) => const PifSettingsPage();
}

/// Application settings only. A product page named `settings` keeps its own
/// registry ID and page slot, independently of this central shell tab.
class PifSettingsPage extends StatelessWidget {
  const PifSettingsPage({super.key});

  @override
  Widget build(BuildContext context) {
    return FocusTraversalGroup(
      child: SingleChildScrollView(
        key: const PageStorageKey('pif_settings_scroll'),
        padding: const EdgeInsets.all(16),
        child: Align(
          alignment: Alignment.topCenter,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 760),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Semantics(
                  header: true,
                  child: const Text(
                    'Settings',
                    style: TextStyle(fontSize: 24, fontWeight: FontWeight.w300),
                  ),
                ),
                const SizedBox(height: 20),
                _AppearanceSection(
                  service: PifAppearanceScope.maybeOf(context),
                ),
                const SizedBox(height: 16),
                _GithubSection(service: GithubConnectionScope.maybeOf(context)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _SettingsGroup extends StatelessWidget {
  const _SettingsGroup({
    required this.icon,
    required this.title,
    required this.help,
    required this.child,
    this.inline = false,
  });

  final IconData icon;
  final String title;
  final String help;
  final Widget child;
  final bool inline;

  @override
  Widget build(BuildContext context) {
    final theme = PifTheme(brightness: Theme.of(context).brightness);
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: theme.panelRaised,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: theme.border),
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final heading = Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(icon, size: 20, color: theme.accent),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Semantics(
                      header: true,
                      child: Text(
                        title,
                        style: const TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      help,
                      style: TextStyle(fontSize: 12, color: theme.textMuted),
                    ),
                  ],
                ),
              ),
            ],
          );
          if (inline && constraints.maxWidth >= 560) {
            return Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(child: heading),
                const SizedBox(width: 20),
                SizedBox(width: 240, child: child),
              ],
            );
          }
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [heading, const SizedBox(height: 16), child],
          );
        },
      ),
    );
  }
}

class _AppearanceSection extends StatelessWidget {
  const _AppearanceSection({required this.service});
  final PifAppearanceService? service;

  @override
  Widget build(BuildContext context) {
    final appearance = service;
    if (appearance == null) {
      return const _SettingsGroup(
        icon: Icons.contrast,
        title: 'Appearance',
        help: 'Choose how pif looks on this device.',
        child: Text('Appearance preferences are unavailable in this app.'),
      );
    }
    return ListenableBuilder(
      listenable: appearance,
      builder: (context, child) => _SettingsGroup(
        inline: true,
        icon: Icons.contrast,
        title: 'Appearance',
        help: 'Choose how pif looks. System follows your device’s appearance.',
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SegmentedButton<ThemeMode>(
              key: const Key('pif_appearance_mode'),
              showSelectedIcon: false,
              style: const ButtonStyle(
                visualDensity: VisualDensity.compact,
                padding: WidgetStatePropertyAll(
                  EdgeInsets.symmetric(horizontal: 8),
                ),
                minimumSize: WidgetStatePropertyAll(Size(0, 40)),
              ),
              segments: const [
                ButtonSegment(value: ThemeMode.light, label: Text('Light')),
                ButtonSegment(value: ThemeMode.dark, label: Text('Dark')),
                ButtonSegment(value: ThemeMode.system, label: Text('System')),
              ],
              selected: {appearance.mode},
              onSelectionChanged: (modes) =>
                  unawaited(appearance.setMode(modes.single)),
            ),
            if (appearance.persistenceError case final error?) ...[
              const SizedBox(height: 10),
              Semantics(liveRegion: true, child: Text(error)),
            ],
          ],
        ),
      ),
    );
  }
}

class _GithubSection extends StatefulWidget {
  const _GithubSection({required this.service});
  final GithubConnectionService? service;

  @override
  State<_GithubSection> createState() => _GithubSectionState();
}

class _GithubSectionState extends State<_GithubSection> {
  final _token = TextEditingController();
  String? _environmentId;

  @override
  void initState() {
    super.initState();
    _environmentId = widget.service?.environmentId;
    widget.service?.addListener(_connectionChanged);
  }

  @override
  void didUpdateWidget(_GithubSection oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.service == widget.service) return;
    oldWidget.service?.removeListener(_connectionChanged);
    widget.service?.addListener(_connectionChanged);
    _environmentId = widget.service?.environmentId;
    _token.clear();
  }

  void _connectionChanged() {
    if (_environmentId != widget.service?.environmentId) {
      _environmentId = widget.service?.environmentId;
      _token.clear();
    }
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    widget.service?.removeListener(_connectionChanged);
    _token.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final service = widget.service;
    if (service == null || service.busy || _token.text.trim().isEmpty) return;
    final token = _token.text.trim();
    _token.clear();
    await service.saveAndValidate(token);
  }

  @override
  Widget build(BuildContext context) {
    final service = widget.service;
    final hasEnvironment = service?.environmentId?.isNotEmpty == true;
    final busy = service?.busy == true;
    final state = service?.state;
    final theme = PifTheme(brightness: Theme.of(context).brightness);
    final workspace = service?.workspace;
    final connectRepository = GithubConnectionScope.connectRepositoryOf(
      context,
    );
    final name = workspace == null || workspace.isEmpty
        ? 'Local environment'
        : workspace.split('/').where((part) => part.isNotEmpty).lastOrNull ??
              'Local environment';
    return _SettingsGroup(
      icon: Icons.code,
      title: 'GitHub',
      help: hasEnvironment
          ? 'Token access for $name only. Stored securely in macOS Keychain.'
          : 'Select/create an environment before adding a GitHub token.',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (hasEnvironment) ...[
            Text(
              'Environment: ${service!.environmentId}',
              style: TextStyle(fontSize: 11, color: theme.textMuted),
            ),
            const SizedBox(height: 14),
          ],
          TextField(
            key: const Key('pif_github_token'),
            controller: _token,
            enabled: hasEnvironment && !busy,
            obscureText: true,
            autocorrect: false,
            enableSuggestions: false,
            decoration: InputDecoration(
              labelText: state?.saved == true
                  ? 'Replacement token'
                  : 'Personal access token',
              hintText: 'Enter a GitHub token',
              border: const OutlineInputBorder(),
            ),
            onSubmitted: (_) => unawaited(_save()),
          ),
          const SizedBox(height: 12),
          ListenableBuilder(
            listenable: _token,
            builder: (context, child) => Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                FilledButton(
                  onPressed:
                      hasEnvironment && !busy && _token.text.trim().isNotEmpty
                      ? _save
                      : null,
                  child: Text(
                    state?.saved == true
                        ? 'Replace and validate'
                        : 'Save and validate',
                  ),
                ),
                OutlinedButton(
                  onPressed:
                      hasEnvironment &&
                          !busy &&
                          (state?.saved == true ||
                              state?.needsAuthorization == true)
                      ? service!.validate
                      : null,
                  child: const Text('Validate'),
                ),
                TextButton(
                  onPressed:
                      hasEnvironment &&
                          !busy &&
                          (state?.saved == true ||
                              state?.needsAuthorization == true)
                      ? service!.remove
                      : null,
                  child: const Text('Remove'),
                ),
                if (connectRepository != null)
                  OutlinedButton.icon(
                    onPressed: hasEnvironment && !busy
                        ? connectRepository
                        : null,
                    icon: const Icon(Icons.link),
                    label: const Text('Connect repository'),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          if (busy) ...[
            const LinearProgressIndicator(minHeight: 2),
            const SizedBox(height: 8),
          ],
          Semantics(
            liveRegion: true,
            child: Text(
              !hasEnvironment
                  ? 'GitHub is disconnected. No environment selected.'
                  : state?.message ??
                        'GitHub connection status is unavailable.',
              style: TextStyle(fontSize: 12, color: theme.textMuted),
            ),
          ),
          if (hasEnvironment &&
              state?.validated == true &&
              state?.account != null) ...[
            const SizedBox(height: 4),
            Text(
              'Account: ${state!.account}',
              style: const TextStyle(fontSize: 12),
            ),
          ],
        ],
      ),
    );
  }
}
