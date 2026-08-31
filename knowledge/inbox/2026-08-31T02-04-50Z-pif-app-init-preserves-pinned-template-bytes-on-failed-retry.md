---
type: Inbox
title: pif app init preserves pinned template bytes on failed retry (#195)
description: Proved the app-init template copy no longer removes the pinned template when the source and destination are the same directory, so a failed retry keeps design.md and the full template tree intact while leaving no app manifest behind
tags: [pi-extensions, pif, app-init, template, retry, diagnostics, okf]
timestamp: 2026-08-31T02:04:50Z
generated_at: 2026-08-31T02:04:50Z
generated_by: dev-session
session_id: pending
commit_sha: []
branch: codex/pif-app-builder-154
issue_refs: [195]
capture_tier: session
---

# What Was Done

Updated `extensions/pif.ts` so `pif_app.init` keeps the pinned template tree intact when the template source resolves to the same directory as the destination copy. The copy step now skips `rmSync` and `cpSync` in that same-directory case instead of deleting the existing pinned template before the retry runs. The frontend slice was carried by tracker_dev and the hub slice by hub_dev.

That fixes the failed-retry path for a template that was already pinned in `pif_app/template/`: after the first analyzer-gate failure, the retry reuses the existing pinned copy instead of removing it. The scaffold rollback still removes the scaffolded home widget and the incomplete `pif_app/app.yaml`, so the workspace can retry cleanly.

## Decisions Made

- Kept the existing template lookup order unchanged.
- Avoided a broader scaffold refactor; only the same-directory copy guard changed.
- Preserved rollback behavior for the manifest and scaffolded home widget.
- Left the pinned template tree and `design.md` bytes untouched across retry failures.

## Lessons Learned

- The bug only appears when the retry source is the already-pinned template directory, so the fix needs a path equality guard rather than a new scaffold flow.
- A disposable forced-failure diagnostic is enough to prove the retry behavior without running the full app-init gate or Flutter toolchain.
- The same-directory guard preserves the pinned template bytes, including `design.md`, across failed retries.

## Current State

- `extensions/pif.ts` is the only source file changed for this slice.
- Bounded evidence:
  - first init copied the template from a distinct source path into `pif_app/template`
  - second init resolved `pif_app/template` as its source
  - template byte maps matched before and after both forced failures
  - `pif_app/app.yaml` was absent after each failure
  - the scaffolded `pif_app/widgets/home` directory was cleaned up after each failure
- Diagnostic artifact: `/tmp/pif-remediation-2026-08-31/check-pif-init-template-retry.mjs`
- No full gate, no real Flutter app, and no repository tests were run.
