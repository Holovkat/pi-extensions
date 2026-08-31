---
type: Inbox
title: pif export process-group cleanup now drains descendants before stop teardown (#192)
description: Changed app/build to spawn a detached export group, start group cleanup on exit, keep the async-error code -1 contract, and wait for cleanup to finish before stop tears down peers
tags: [pi-extensions, pif, export, process-group, cleanup, stop, diagnostics]
timestamp: 2026-08-31T02:43:22Z
generated_at: 2026-08-31T02:43:22Z
generated_by: dev-session
session_id: pending
commit_sha: []
branch: codex/pif-app-builder-154
issue_refs: [192]
capture_tier: session
---

# What Was Done

Updated `extensions/pif.ts` so `pif_app.build` now launches the export wrapper in its own detached POSIX process group and tracks that export separately from regular session children. Cleanup is started when the wrapper exits, and the close path waits for that cleanup to finish before publishing the normal `app/build build_result`. The async-error fixture path still publishes immediately with synthetic code `-1`, but the detached export group cleanup continues in the background and the stop path waits for it before peer teardown. Shutdown now waits for `stop()` to settle instead of forcing a fixed 250 ms exit.

The manual spawn timeout now shares the same export-group cleanup path instead of relying on Node’s direct-child timeout behavior. A synchronous spawn failure now goes through the same settled result path instead of leaving the export record unresolved.

## Decisions Made

- Keep the export cleanup scope isolated to the build record and its recorded PGID.
- Use negative PGID signals only for the export group; do not broaden shutdown to unrelated children.
- Preserve the existing `build_result` contract for success, nonzero exit, and async-error cases.
- Let `stop()` wait for export cleanup before peers are closed so the final `build_result` can still be delivered.

## What Was Deprecated

- The fixed 250 ms `shutdown()` exit timer.
- Relying on `spawn({ timeout })` for export cleanup.
- Direct-child-only cleanup for export builds.

## Lessons Learned

- Close-only cleanup can stall when a descendant keeps inherited stdio open after the wrapper exits; cleanup has to start on `exit`, not after `close`.
- The async-error fixture still needs the immediate `-1` build-result shape, so publication timing has to differ from the normal exit path.
- A detached group plus bounded TERM→KILL cleanup is enough to clear the leaked descendants without touching unrelated processes.

## Current State

- `extensions/pif.ts` is the only source file changed for this slice.
- Focused validation passed:
  - `node --test --test-name-pattern='pif_app.build publishes correlated build_result envelopes' extensions/pif.test.mjs`
  - `/tmp/pif-remediation-2026-08-31/export-process-tree-diagnostic.mjs`
- Diagnostic evidence now shows the detached, inherited-stdio, and timeout variants all finish with no live descendants and no lingering owned PIDs.
- The variant diagnostic used a fresh hub for the timeout run so the build_result could still reach peers after the stop scenario had torn down the original hub.
- The pre-fix JSON and log were preserved at:
  - `/tmp/pif-remediation-2026-08-31/export-process-tree-diagnostic.before-cleanup.json`
  - `/tmp/pif-remediation-2026-08-31/export-process-tree-diagnostic.before-cleanup.log`
  - `/tmp/pif-remediation-2026-08-31/export-process-tree-diagnostic-variant.json`
  - `/tmp/pif-remediation-2026-08-31/export-process-tree-diagnostic-variant.log`
