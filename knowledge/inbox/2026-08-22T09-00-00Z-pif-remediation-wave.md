---
type: Inbox
title: pif Remediation Wave — Security, Resilience, Layout Reset, Packaging
description: Closed the review findings from the 2026-08-22 pif epic review — hub authentication, input hardening, session spawn hygiene, bus resilience, layout reset, packaging re-signing, and workflow-docs drift
tags: [pi-extensions, pif, security, flutter, packaging, okf]
timestamp: 2026-08-22T09:00:00Z
generated_at: 2026-08-22T09:00:00Z
generated_by: dev-session
session_id: pending
commit_sha: []
branch: master
issue_refs: [131, 132, 133, 134, 135, 136, 137, 138]
epic_refs: [120]
capture_tier: session
---

# What Was Done

Implemented the full remediation wave from the 2026-08-22 epic review as tracked issues #131–#138 (plus one untracked fix), restoring a green `npm run test:pif` gate and closing sprint #121 / epic #120.

## Security (the important part)

- **Hub authentication (#134)**: the WS hub previously accepted any connection to `ws://127.0.0.1:31415/pif` — including cross-origin browser pages — and served the full snapshot (model provider configs with API keys, transcripts) plus spawn/widget/models controls. Now: per-launch crypto-random token, required on upgrade before any state is sent; browser Origin headers rejected unless allowlisted via `PIF_ALLOWED_ORIGINS`; control socket chmod 0600. Token reaches clients via supervisor env, a 0600 token file next to hub state, or the standalone launcher generating it (PIF_TOKEN env).
- **Input hardening (#132)**: `installWidget` applies the same snake_case + `assertSafeWidgetPath` boundary as create/uninstall (no more `../../x` traversal); `models/save` validates the providers shape, preserves unknown top-level keys, writes timestamped backups (pruned to 4), and honours `PIF_MODELS_PATH` so tests never touch the real `~/.pi/agent/models.json`.

## Correctness

- **Session spawn hygiene (#133)**: child sessions get a scrubbed env (`childEnvironment()`) so they no longer inherit `PIF_AUTOSTART` and try to start a second hub on the same port; `ensure()` assigns the hub only after a successful `start()` and cleans up on failure; the stop() SIGKILL escalation now keys off exit events (the old `child.killed` check never fired).
- **Bus resilience (#135)**: sends while disconnected queue (cap 200, oldest dropped with a surfaced error) and flush in order after the snapshot on reconnect; `connect()` memoizes the in-flight future (no socket leak from the existing-hub check racing a project launch); `isHubRunning` probes the hub's HTTP identity endpoint instead of any TCP listener; `dispose()` no longer races a late disconnect into closed controllers. The new real-WebSocket reconnect test caught the dispose race — writing the test was worth it.
- **Untracked fix**: `normalizeEntry` dropped `command` (prompt/steer/follow_up) and `aborted` from child events — the committed integration test had been red at HEAD because of this.

## Product

- **Layout reset (#138)**: user-reported — after drag/drop there was no way back to the default design. `shell/layout` gains `reset` (clears persisted panels, broadcasts), `pif_layout` gains `action: reset`, Status Bar has a confirmed Reset layout control.

## Packaging & docs

- **#136**: build script re-signs the .app after inserting resources (invalid seal → "damaged" app on Apple Silicon) and gates on `codesign --verify`; pi package resolves through shims via npm global root with `PI_PKG_DIR` override; install-pif.sh backs up the previous global app before `rsync --delete`; pif-builder droid uses ditto and relative paths.
- **#137**: README model drift to GPT-5.6-sol; reviewer/tester agents carry explicit model/thinking frontmatter (tester was inheriting compliance's `low` via fallback aliases); OKF inbox authorship unified on the AGENTS.md story (agent writes synthesis pre-commit; Tier 1 capture hook de-scoped as not installed); INSTALL.md dead skill refs removed; `end-session` hook alias renamed `end-session-checks`; orphaned kickoff-requirements-spec.md deleted.

# Decisions Made

- Token via `PIF_TOKEN` env + token file (not a handshake): keeps pi the entry point in every launch mode without a protocol round-trip.
- `models/save` preserves unknown top-level keys rather than rewriting the whole file — the hub owns only `providers`.
- Layout reset = clearing panels to `{}` (the default is derived from registry slots), not snapshotting a "default layout" — no second source of truth.
- Test env for models uses `PIF_MODELS_PATH` following the existing `PIF_APP_DIR`/`PIF_PORT` override pattern.

# Lessons Learned

- The Aug 15 wave committed a red test: verify the gate (`npm run test:pif`) before committing, not just the new code.
- dart:io `server.close(force: true)` does not terminate upgraded WebSockets — reconnect tests must close sockets explicitly. Broadcast-stream `firstWhere` must be subscribed before triggering the event.
- Committing generated files (widget_registry.g.dart) requires committing their inputs (workspace_clock) — generation order isn't captured by git.

# Current State

- `npm run test:pif` fully green (7 unit + 2 integration node tests, dart analyze clean, 13 Flutter tests).
- build/pif.app (293MB) rebuilt with valid signature.
- Sprint #121 and epic #120 closed; #131–#138 all closed with evidence.
