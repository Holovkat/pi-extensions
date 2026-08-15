import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_pty/flutter_pty.dart';
import 'package:xterm/xterm.dart';
import '../../core/plugin.dart';

class TerminalPlugin implements PifWidgetPlugin {
  @override
  PifWidgetMeta get meta => const PifWidgetMeta(
    id: 'terminal',
    name: 'Terminal',
    slot: PifSlot.bottom,
    core: true,
  );
  @override
  Widget build(BuildContext context, PifHost host) =>
      _TerminalPanel(host: host);
}

class _Term {
  _Term(this.name, this.terminal, this.pty);
  final String name;
  final Terminal terminal;
  final Pty pty;
}

class _TerminalPanel extends StatefulWidget {
  const _TerminalPanel({required this.host});
  final PifHost host;
  @override
  State<_TerminalPanel> createState() => _TerminalPanelState();
}

class _TerminalPanelState extends State<_TerminalPanel> {
  final tabs = <_Term>[];
  int selected = 0;
  String? failure;
  @override
  void initState() {
    super.initState();
    _spawn();
  }

  void _spawn() {
    try {
      final terminal = Terminal(maxLines: 10000);
      final shell = Platform.environment['SHELL'] ?? '/bin/zsh';
      final pty = Pty.start(
        shell,
        workingDirectory: widget.host.workspace.isEmpty
            ? Directory.current.path
            : widget.host.workspace,
        environment: {...Platform.environment, 'TERM': 'xterm-256color'},
      );
      pty.output
          .cast<List<int>>()
          .transform(utf8.decoder)
          .listen(
            terminal.write,
            onDone: () {
              if (mounted)
                setState(
                  () => failure = 'Shell exited. Open a new tab to restart.',
                );
            },
          );
      terminal.onOutput = (data) => pty.write(utf8.encode(data));
      terminal.onResize = (width, height, pixelWidth, pixelHeight) =>
          pty.resize(height, width);
      setState(() {
        tabs.add(_Term('zsh ${tabs.length + 1}', terminal, pty));
        selected = tabs.length - 1;
        failure = null;
      });
    } catch (error) {
      setState(() => failure = '$error');
    }
  }

  void _close(int index) {
    tabs[index].pty.kill();
    setState(() {
      tabs.removeAt(index);
      selected = tabs.isEmpty ? 0 : selected.clamp(0, tabs.length - 1);
    });
  }

  @override
  void dispose() {
    for (final tab in tabs) {
      tab.pty.kill();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Container(
    color: const Color(0xff0b0e13),
    child: Column(
      children: [
        SizedBox(
          height: 35,
          child: Row(
            children: [
              for (var i = 0; i < tabs.length; i++)
                InkWell(
                  onTap: () => setState(() => selected = i),
                  child: Container(
                    padding: const EdgeInsets.only(left: 12),
                    color: selected == i ? const Color(0xff1d2330) : null,
                    child: Row(
                      children: [
                        Text(
                          tabs[i].name,
                          style: const TextStyle(fontSize: 12),
                        ),
                        IconButton(
                          onPressed: () => _close(i),
                          icon: const Icon(Icons.close, size: 13),
                        ),
                      ],
                    ),
                  ),
                ),
              IconButton(
                onPressed: _spawn,
                tooltip: 'New terminal',
                icon: const Icon(Icons.add, size: 17),
              ),
            ],
          ),
        ),
        if (failure != null)
          SizedBox(
            height: 34,
            child: Row(
              children: [
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    failure!,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                TextButton(onPressed: _spawn, child: const Text('Restart')),
              ],
            ),
          ),
        Expanded(
          child: tabs.isEmpty
              ? const Center(child: Text('No terminal'))
              : ClipRect(
                  child: TerminalView(
                    tabs[selected].terminal,
                    autofocus: true,
                    backgroundOpacity: 0,
                    padding: const EdgeInsets.all(8),
                  ),
                ),
        ),
      ],
    ),
  );
}
