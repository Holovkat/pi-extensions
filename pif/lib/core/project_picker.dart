import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';

/// Project selection screen shown when no hub is running.
///
/// Lets the user pick a project directory, then spawns pi with the
/// pif extension and connects to the hub.
class ProjectPicker extends StatefulWidget {
  const ProjectPicker({
    super.key,
    required this.onLaunch,
  });

  /// Called with the selected project path.
  final Future<void> Function(String workspace) onLaunch;

  @override
  State<ProjectPicker> createState() => _ProjectPickerState();
}

class _ProjectPickerState extends State<ProjectPicker> {
  List<String> _recent = [];
  bool _launching = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadRecent();
  }

  File _recentFile() {
    final home = Platform.environment['HOME'] ?? '/';
    return File('$home/.pi/pif/recent_projects.json');
  }

  void _loadRecent() {
    try {
      final data = jsonDecode(_recentFile().readAsStringSync()) as List;
      setState(() => _recent = data.cast<String>());
    } catch (_) {
      // No recent projects yet
    }
  }

  void _saveRecent(String path) {
    final updated = [path, ..._recent.where((p) => p != path)].take(10).toList();
    _recentFile().parent.createSync(recursive: true);
    _recentFile().writeAsStringSync('${jsonEncode(updated)}\n');
    if (mounted) setState(() => _recent = updated);
  }

  Future<void> _pickFolder() async {
    try {
      final result = await Process.run('osascript', [
        '-e',
        'POSIX path of (choose folder with prompt "Select a project folder")',
      ]);
      if (result.exitCode == 0) {
        final path = (result.stdout as String).trim();
        if (path.isNotEmpty) await _launch(path);
      }
    } catch (_) {
      // User cancelled or osascript unavailable
    }
  }

  Future<void> _launch(String workspace) async {
    setState(() {
      _launching = true;
      _error = null;
    });
    try {
      await widget.onLaunch(workspace);
      _saveRecent(workspace);
    } catch (e) {
      setState(() {
        _launching = false;
        _error = e.toString();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Container(
          constraints: const BoxConstraints(maxWidth: 520),
          padding: const EdgeInsets.all(48),
          child: _launching ? _buildLaunching() : _buildPicker(),
        ),
      ),
    );
  }

  Widget _buildPicker() {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Header
        const Text(
          'pif',
          style: TextStyle(
            fontSize: 32,
            fontWeight: FontWeight.w800,
            letterSpacing: 1,
          ),
        ),
        const SizedBox(height: 4),
        const Text(
          'PI-NATIVE AGENTIC IDE',
          style: TextStyle(
            fontSize: 11,
            letterSpacing: 1.4,
            color: Color(0xff69758a),
          ),
        ),
        const SizedBox(height: 40),

        // Select button
        SizedBox(
          width: double.infinity,
          height: 48,
          child: FilledButton.icon(
            onPressed: _pickFolder,
            icon: const Icon(Icons.folder_open),
            label: const Text('Select Project Folder'),
          ),
        ),

        // Recent projects
        if (_recent.isNotEmpty) ...[
          const SizedBox(height: 32),
          const Text(
            'Recent Projects',
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: Color(0xff69758a),
            ),
          ),
          const SizedBox(height: 8),
          ..._recent.map((path) {
            final name = path.split('/').last;
            return ListTile(
              dense: true,
              leading: const Icon(
                Icons.folder_outlined,
                size: 20,
                color: Color(0xff69758a),
              ),
              title: Text(name, style: const TextStyle(fontSize: 14)),
              subtitle: Text(
                path,
                style: const TextStyle(fontSize: 11, color: Color(0xff566175)),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              onTap: () => _launch(path),
            );
          }),
        ],

        // Error
        if (_error != null) ...[
          const SizedBox(height: 24),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: const Color(0xff2a1518),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: const Color(0xff5a2a30)),
            ),
            child: Row(
              children: [
                const Icon(Icons.error_outline, color: Color(0xffe57373), size: 18),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    _error!,
                    style: const TextStyle(fontSize: 12, color: Color(0xffe57373)),
                  ),
                ),
              ],
            ),
          ),
        ],
      ],
    );
  }

  Widget _buildLaunching() {
    return const Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        SizedBox(
          width: 32,
          height: 32,
          child: CircularProgressIndicator(strokeWidth: 2),
        ),
        SizedBox(height: 24),
        Text(
          'Starting pi and connecting…',
          style: TextStyle(fontSize: 14, color: Color(0xff69758a)),
        ),
      ],
    );
  }
}
