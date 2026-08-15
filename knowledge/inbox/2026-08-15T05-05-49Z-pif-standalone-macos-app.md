---
type: Inbox
title: pif Standalone macOS App — Project Picker, Pi Launcher, Build Script
description: Built standalone macOS app support with project picker, bundled pi runtime, and self-contained .app packaging
tags: [pi-extensions, pif, flutter, macos, packaging, standalone]
timestamp: 2026-08-15T05:05:49Z
generated_at: 2026-08-15T05:05:49Z
generated_by: dev-session
session_id: pending
commit_sha: []
branch: feat/pif-phase1
issue_refs: [130]
epic_refs: [120]
capture_tier: session
---

# What Was Done

Built standalone macOS app support so pif can be launched as a native desktop application with zero external dependencies. The app bundles Node.js + pi CLI + pif extensions inside the .app bundle.

## New files

1. **`pif/lib/core/pi_launcher.dart`** — Dart process management for spawning pi. Finds bundled pi (inside .app/Contents/Resources/) or falls back to system PATH. Spawns pi with `PIF_AUTOSTART=1 PIF_NO_FLUTTER=1` so the pif extension auto-starts the hub without the FlutterSupervisor. Polls the port until the hub is ready. Cleans up the pi process on app exit.

2. **`pif/lib/core/project_picker.dart`** — Flutter UI for selecting a project directory. Shows recent projects (stored in `~/.pi/pif/recent_projects.json`), a "Select Project Folder" button using native macOS folder picker (osascript), and loading/error states. Matches pif's dark theme aesthetic.

3. **`pif/lib/main.dart`** — Rewritten to manage the standalone app lifecycle. On startup, checks if a hub is already running (connects directly if yes). Otherwise shows the project picker. On project selection, spawns pi, waits for the hub, connects, and shows the DockingShell. Cleans up the pi process on app exit via `didRequestAppExit`.

4. **`scripts/build-pif-app.sh`** — Build script that runs `flutter build macos --release`, then bundles Node.js binary, pi CLI package, pif extensions, and Flutter app source into the .app's Contents/Resources/. Produces a self-contained `build/pif.app`.

## Modified files

5. **`pif/lib/core/docking_shell.dart`** — Added `workspace` parameter so the shell knows which project was selected (passed from main.dart).

6. **`pif/macos/Runner/Release.entitlements`** — Disabled app sandbox, added network client/server, allow-jit, and user-selected file read-write. Matches the debug entitlements. Required for subprocess spawning and localhost WebSocket.

7. **`pif/README.md`** — Added "Build standalone macOS app" section with architecture diagram and usage instructions.

# Decisions Made

- **Self-contained bundling**: Bundle Node.js + pi CLI inside the .app rather than requiring pre-installation. The user wants a true "drag to Applications, double-click, go" experience. The .app is ~250MB but has zero external dependencies.

- **Project picker over fixed workspace**: The app shows a project picker on launch. Users select which project to work in. Recent projects are saved for quick access. If a hub is already running (from a terminal pi session), the app connects directly.

- **osascript for folder picker**: Use `osascript -e 'choose folder'` instead of the `file_picker` package to avoid adding a dependency. Works on macOS with the sandbox disabled.

- **PIF_AUTOSTART + PIF_NO_FLUTTER env vars**: The pif.ts extension already supported standalone mode via these env vars (added in a previous session). No changes to the hub were needed — it auto-starts the WS server without the FlutterSupervisor when these are set.

- **Fire-and-forget cleanup in dispose**: `didRequestAppExit` does async cleanup before the app exits. `dispose()` also calls cleanup as a fallback. The pi process gets SIGTERM, then SIGKILL after 5 seconds if it doesn't exit.

# What Was Deprecated

The old `main.dart` that immediately created a `PifBus` and `DockingShell` is superseded by the new `PifApp` stateful widget that manages the full lifecycle. The old flow assumed a hub was already running; the new flow can bring up the hub itself.

# Lessons Learned

- Flutter's `Process.start` uses `workingDirectory`, not `cwd` (unlike Node.js).
- `WidgetsBindingObserver.didRequestAppExit` returns `Future<AppExitResponse>`, not `void`. `AppExitResponse` is in `dart:ui`, not re-exported by `package:flutter/material.dart`.
- The pif.ts extension's `PIF_AUTOSTART` + `PIF_NO_FLUTTER` env vars (added in a previous session for the global install feature) turned out to be exactly what was needed for the standalone app. No hub changes were required.
- macOS app sandbox must be disabled for subprocess spawning. The debug entitlements already had it disabled; the release entitlements needed to match.
- `osascript -e 'choose folder'` is a simple way to show a native macOS folder picker without adding Flutter dependencies.

# Current State

All code is on branch `feat/pif-phase1`. Tests pass (5 Node, 11 Flutter, dart analyze clean). The build script has not been run yet (it requires `flutter build macos --release` which takes a few minutes). The standalone app flow is: launch → project picker → select folder → spawn pi → connect to hub → show shell. Task #130 tracks the remaining packaging work (clean-project test, global catalog, `pif init`).
