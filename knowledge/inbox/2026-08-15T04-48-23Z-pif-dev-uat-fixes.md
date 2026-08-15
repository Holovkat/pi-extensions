---
type: Inbox
title: pif Dev UAT Fixes — Console Rendering, Model Selection, Hot Reload, Packaging
description: Fixed four Dev UAT issues on the pif shell (agent console raw JSON, model selection, widget install requiring restart, global packaging) and created a packaging task
tags: [pi-extensions, pif, flutter, dev-uat, fixes, packaging]
timestamp: 2026-08-15T04:48:23Z
generated_at: 2026-08-15T04:48:23Z
generated_by: dev-uat-session
session_id: pending
commit_sha: []
branch: feat/pif-phase1
issue_refs: [120, 121, 130]
epic_refs: [120]
capture_tier: session
---

# What Was Done

Drove the running pif shell through the control socket (panel focus, hot reload, child session spawn with prompt/steer/abort round-trip) and ran the baseline test suites (5 Node tests, 11 Flutter tests, dart analyze clean). Then fixed four Dev UAT issues and set up global packaging.

## Fixes

1. **Agent Console rendering** (issue 2): Rewrote `agent_console.dart` with a transcript normalizer that coalesces `message_update` deltas into streaming assistant text, renders tool calls as cards with status indicators, user input as right-aligned bubbles, and agent lifecycle as status rows. Hub-side `normalizeEntry` in `pif.ts` now converts raw pi events to compact entries before storing and broadcasting, so the console never sees raw JSON.

2. **Model selection** (issue 3): Hub now populates `state.models` from `ctx.modelRegistry.getAvailable()` and includes it in the snapshot. Session Rail replaced the free-text model field with a `DropdownButtonFormField` populated from `host.models`, with a free-text fallback when the models list is empty (old hub compatibility).

3. **Widget install requiring restart** (issue 4): Root cause was `pifWidgetFactories` as a top-level `final Map` that hot reload does not reinitialize. Changed the codegen (`pif-shared.ts` `generateWidgetRegistry`) to emit a function `pifWidgetFactories()` instead. `docking_shell.dart` now caches the result in a field, refreshes it on `reassemble()` (hot reload) and on `widget/registry` events (install/toggle), so newly installed widgets appear without an app restart.

4. **Packaging** (issue 5): Created `scripts/install-pif.sh` that copies the Flutter shell to `~/.pi/pif/app/` and the hub extension to `~/.pi/agent/extensions/`. Hub `appDir` resolution now checks `PIF_APP_DIR` env, then workspace-local `pif/`, then falls back to the global install. After install, `pi` in any project + `/pif` launches the shell with that project as the workspace. Created task #130 for remaining packaging work.

## Additional fixes
- Hub `scanWidgets` now filters catalog entries that are already installed (dedup).
- Hub `normalizeEntry` caps stored transcript entries at 500 chars to keep snapshots small.

# Decisions Made

- Normalize transcripts hub-side (single source of truth) rather than client-side only. The console has a fallback normalizer for backward compatibility with the old hub during the transition period.
- Use a function-based registry instead of a final Map so hot reload picks up new widgets. The `reassemble()` lifecycle hook refreshes the cached factories map.
- Global app at `~/.pi/pif/app/` shared across projects; per-project state stays in `.pi/pif/`. This is the simplest model that meets the "install once, use anywhere" goal.
- Created task #130 for the remaining packaging work (clean-project test, global catalog, `pif init` command) rather than blocking this session on it.

# What Was Deprecated

The top-level `final Map<String, PifWidgetPlugin Function()> pifWidgetFactories` declaration is superseded by the function `Map<String, PifWidgetPlugin Function()> pifWidgetFactories()`. The old form will cause a compile error in docking_shell.dart since it now calls `pifWidgetFactories()` with parentheses.

# Lessons Learned

- Flutter hot reload does NOT reinitialize top-level `final` variables. A function that returns a fresh map is the correct pattern for generated registries that change at runtime.
- The `reassemble()` callback on `State` fires on hot reload and is the right place to refresh generated resources.
- `DropdownButtonFormField.value` is deprecated in Flutter 3.44.8; use `initialValue` instead.
- The pif control socket (`.pi/pif/control.sock`) is a convenient test harness for driving the shell programmatically without a WebSocket client.

# Current State

All fixes are on branch `feat/pif-phase1`, tests pass (5 Node, 11 Flutter, dart analyze clean). The running shell was hot-restarted to apply Dart-side fixes. Hub-side fixes (models list, transcript normalization, appDir resolution, catalog dedup) require a pi session restart to take effect. Task #130 tracks remaining packaging work. Epic #120 sprint #121 is ready for Dev UAT sign-off.
