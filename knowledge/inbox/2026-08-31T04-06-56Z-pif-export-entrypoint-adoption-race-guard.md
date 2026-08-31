---
type: Inbox
title: pif export entrypoint adoption race guard and local bus cleanup (#211)
description: Tightened the app main/export lifecycle so export mode still boots through the dedicated entrypoint, source mode keeps existing hub adoption, and in-flight adoption cannot race a user project launch or leak a pre-connect bus
tags: [pi-extensions, pif, main, export, lifecycle, adoption, okf]
timestamp: 2026-08-31T04:06:56Z
generated_at: 2026-08-31T04:06:56Z
generated_by: dev-session
session_id: pending
commit_sha: []
branch: main
issue_refs: [211]
capture_tier: session
---

# What Was Done

Updated the owned Dart surface for #211 in `pif/lib/main.dart` and verified the thin export shim in `pif/lib/export_main.dart` remains the explicit export entrypoint:

- `main.dart` now keeps the existing source-mode adoption path and the export-mode startup path separate.
- `main.dart` now guards `_checkExistingHub()` with a startup generation check and `mounted` so a hub adoption attempt cannot race a later project launch or disposal.
- `main.dart` now cleans up a pre-connect `PifBus` if `connect()` fails, so the temporary bus is not leaked when adoption fails.
- `main.dart` now invalidates any in-flight adoption before explicit project launch by bumping a local startup generation and cleaning up existing session state first.
- `main.dart` now attaches bus listeners only after ownership is accepted, then requests a fresh `snapshot_request` so a non-replaying bus still feeds the new listeners with current state.
- `export_main.dart` stays as the explicit `runPifApp(exportMode: true)` shim and does not widen scope.

## Decisions Made

- Source mode continues to allow adoption of an already-running hub when it proves the current workspace token.
- Export mode continues to skip adoption entirely and boot through the dedicated export entrypoint.
- The main-file fix stays intentionally local; it does not alter the shared script, hub, or launcher surface owned by other lanes.
- Cleanup for discarded adoption now disconnects only; it does not send a shutdown request to a hub that this lane did not spawn.
- Port selection remains driven by the existing environment/configured-port path; no new port policy was introduced here.

## What Was Deprecated

- The unguarded adoption path that could continue after a later project launch is superseded.
- The pre-connect bus lifetime that depended on successful connect without explicit cleanup is superseded.

## Lessons Learned

- This lifecycle needs a generation guard, not just `mounted` checks, because `initState` launches adoption asynchronously while the user can still initiate a separate startup path.
- Keeping the export entrypoint separate is sufficient; the race was in the runtime ownership check, not in the export shim itself.
- Narrow static analysis on just the two owned Dart files is enough to validate the local fix without pulling the rest of the application through the task loop.

## Current State

- `pif/lib/main.dart` passes `dart analyze` together with `pif/lib/export_main.dart`.
- The main/export surface is now aligned with the root review: source adoption is preserved, export skips adoption, and a failed pre-connect adoption no longer leaves a leaked local bus behind.
- The bus watcher now comes up only after acceptance, and the follow-up snapshot request compensates for the bus stream's lack of replay.
- Remaining export composition work stays with the already-prepared script lane and later verification task; this note only covers the Dart-owned main surface.

## Export composition integration

The canonical exporter now compiles lib/export_main.dart and generates a registry from project widgets, explicitly resolved required widgets, and required base-core widgets. Other base widget implementations are pruned; helper directories without widget manifests remain. Selected widget Dart dependencies are collected from the staged manifests and resolved separately with flutter pub add/get. Base core flags and relative staged imports are preserved. Export startup begins in app mode even when a prior runtime preference enabled IDE mode; later explicit toggles remain supported.

Static analysis and bounded source/behavior checks are implementation evidence. A final public-tool export, actual pinned artifact inspection, launch and native UI walkthrough are still required.
