---
type: Inbox
title: pif Flutter Agentic IDE Design
description: Brainstormed and approved the design for pif, a Pi-hosted Flutter desktop shell where every panel is a widget-extension, with a widget store and Pi-driven widget creation
tags: [pi-extensions, pif, flutter, ide, widgets, rpc, design, spec]
timestamp: 2026-08-14T22:53:14Z
generated_at: 2026-08-14T22:53:14Z
generated_by: brainstorming-session
session_id: pending
commit_sha: []
branch: master
issue_refs: []
epic_refs: []
capture_tier: session
---

# What Was Done

Brainstormed and approved the full design for **pif**, the next-generation agentic IDE: a Pi-native, Flutter-first desktop shell replacing the terminal surface. The approved spec lives at `docs/superpowers/specs/2026-08-15-pif-design.md` and covers the full platform in one spec, phased into Primitives, Ecosystem, and Platform.

Core concept: fuse Pi's modularity (extensions) with Flutter's modularity (widgets). Everything on screen is a widget, every widget is an extension that can be toggled, the app contains a widget store, and Pi builds new widgets into the running shell conversationally. Codex-style paneling with a central stage and any number of dockable widget windows.

# Decisions Made

- **Pi hosts the UI (not the reverse).** `extensions/pif.ts` is a hub that launches the Flutter shell; the shell connects back over a local WebSocket (default port 31415). Rejected: Flutter app spawning pi internally; a standalone daemon in the middle.
- **Widgets are real Dart source, run from source.** The shell runs via `flutter run --machine` (JIT); installing a widget means dropping a Dart folder into `lib/widgets/`, regenerating a registry file, and hot-reloading, driven programmatically by the hub over the machine JSON-RPC. Rejected: RFW interpreted widgets as the primary mechanism (kept as a Phase 3 option for release builds); dart_eval; hybrid-first.
- **v1 base widgets:** Agent Console, Session Rail, Terminal (pty), Widget Store panel, Status Bar. Diff Viewer and File Explorer deliberately deferred to become the first real-use proven widgets Pi builds through pif itself; the diff-viewer real-use trial is the Phase 1 exit criterion.
- **Single repo:** extension in `extensions/pif.ts`, Flutter app in `pif/` at the repo root. Rejected: separate shell repo.
- **Hub is the source of truth**; shell is a renderer with snapshot/resync on reconnect. Pi tools (`pif_widget_create/install/toggle/uninstall/list`, `pif_layout`, `pif_shell_status`, `pif_reload`) connect over the hub's local socket so any pi session can drive the shell. `pif_widget_install` runs a `dart analyze` gate and returns compiler diagnostics to the calling agent for the fix loop.
- Host session mirroring reuses proven patterns: `pi.on(...)` events plus `pi.sendMessage(..., { deliverAs: "followUp", triggerTurn: true })` (coms.ts); child sessions reuse the dev-pipeline `pi --mode rpc --session <file>` pattern.

# What Was Deprecated

Nothing shipped was deprecated. Rejected design paths recorded above so they are not re-derived: Flutter-as-host topology, daemon-in-the-middle topology, RFW-only and hybrid widget runtimes, separate shell repo.

# Lessons Learned

- `flutter run --machine` exposes a JSON-RPC control channel over stdin/stdout that is the structural twin of pi's `--mode rpc`; the hub can supervise hot reload/restart the same way extensions supervise agents. This symmetry is what makes "Pi writes a widget and it appears live" a closed loop.
- Flutter release builds are AOT, so a run-from-source JIT shell is the honest v1 for runtime widget installation; a frozen-widget-set release build and an RFW lane are the release-mode answers, deferred to Phase 3.
- Toolchain verified on this machine: Flutter 3.44.8 stable, Dart 3.12.2, macOS arm64.

# Current State

Design approved section by section and committed as `docs/superpowers/specs/2026-08-15-pif-design.md`. No implementation exists yet. Next step: write the Phase 1 implementation plan (hub, bus, shell frame, base five widgets, widget contract + registry + reload loop, pi tools, local catalog store), then execute.
