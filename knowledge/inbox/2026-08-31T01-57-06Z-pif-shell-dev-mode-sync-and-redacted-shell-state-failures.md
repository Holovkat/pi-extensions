---
type: Inbox
title: pif shell dev mode sync, fresh-state persistence, and redacted shell-state failures (#208)
description: Proved the hub-owned shell dev/app mode contract now accepts only { enabled: boolean }, creates shell.json from a fresh workspace, preserves unrelated fields, reloads devMode on restart, and rejects malformed or unreadable existing state with redacted errors
tags: [pi-extensions, pif, shell, dev-mode, websocket, diagnostics, okf]
timestamp: 2026-08-31T01:57:06Z
generated_at: 2026-08-31T01:57:06Z
generated_by: dev-session
session_id: pending
commit_sha: []
branch: codex/pif-app-builder-154
issue_refs: [208]
capture_tier: session
---

# What Was Done

Updated `extensions/pif.ts` and `pif/lib/core/docking_shell.dart` so the hub is the sole writer for shell dev/app mode state and the frontend button, control socket, and websocket snapshot all agree on the same `devMode` value. The contract now accepts only `{ enabled: boolean }` for both `shell.dev_mode` and `shell/control` `dev_mode_set`. The frontend slice was carried by tracker_dev and the hub slice by hub_dev. Root's diagnostic used a real `PifHub` instance with a fake peer and exercised control/receive in process; it did not open a real control socket, real WebSocket, or boot the app.

The shell-state path now behaves correctly in fresh and broken workspaces:

- a missing `shell.json` is treated as empty state for save, so the first toggle in a fresh workspace creates the file instead of failing
- startup still defaults `devMode` to `false` when no shell state exists
- saving preserves unrelated keys already present in `shell.json`
- malformed or unreadable existing shell state fails on save with a redacted error instead of echoing parser snippets

## Decisions Made

- Kept the tool/input contract narrow and object-shaped: `{ enabled: boolean }` only.
- Kept `shell.json` as the hub-owned persistence file and updated it atomically through a temp file + rename.
- Preserved existing shell-state fields by merging the current parsed object with the new `devMode` value.
- Treated ENOENT as empty state for the save path so first-run toggles work in a blank workspace.
- Kept malformed or unreadable existing shell-state files as hard failures during save, with redacted messages.

## Lessons Learned

- The hub can prove the dev-mode contract with a bounded live-hub diagnostic and does not need the real Flutter app to exercise the control path.
- Fresh-workspace behavior matters here: save-time ENOENT handling is separate from startup defaulting.
- Redacting the shell-state read error is important because the failure path should be useful without surfacing parser internals.

## Current State

- `extensions/pif.ts` and `pif/lib/core/docking_shell.dart` are the source files changed for this slice.
- Bounded evidence:
  - tool schema is `Type.Object({ enabled: Type.Boolean() })`
  - the Flutter toggle now sends `shell/control` `dev_mode_set` and waits for the acknowledged snapshot
  - fresh workspace starts with `devMode: false` and no `shell.json`
  - `shell.dev_mode` true/false toggles succeed and broadcast snapshots
  - fake-peer `shell/control` updates broadcast the same `devMode`
  - unrelated shell-state fields survive a later toggle
  - restart was simulated with a fresh hub plus `loadShellState()` and reloads the persisted `devMode`
  - malformed existing shell-state JSON fails on save without parser snippets; unreadable-file permissions remain with #160
- Independent diagnostic artifact: `/tmp/pif-remediation-2026-08-31/check-dev-mode.mjs` and `dev-mode-check.json`
- No real Flutter app or full suite was run; real socket/reconnect and permission-fixture coverage remain with #160.
