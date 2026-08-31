---
type: Inbox
title: pif page collision rejection and scaffold rollback preserve existing directories (#196)
description: Tightened app-scaffold collision handling so init/page/widget creation fails before touching preexisting installed IDs or existing widget source directories, while partial scaffold writes clean up only the attempt-owned directory
tags: [pi-extensions, pif, scaffold, collision, rollback, diagnostics, okf]
timestamp: 2026-08-31T02:24:36Z
generated_at: 2026-08-31T02:24:36Z
generated_by: dev-session
session_id: pending
commit_sha: []
branch: codex/pif-app-builder-154
issue_refs: [196]
capture_tier: session
---

# What Was Done

Updated `extensions/pif.ts` so app-scaffold collision checks happen up front for `pif_app.init`, `pif_app.page_add`, and `pif_app.widget_add`. The new `assertWidgetScaffoldClear` helper rejects collisions before writes, `scaffoldWidget` now claims the widget directory first and removes only its own newly created directory if a write fails after the claim, and `pif_app.init` preserves the pinned-template retention behavior established by #195 while rolling back only the scaffolded home page directory and the temporary app manifest.

## Decisions Made

- Added `assertWidgetScaffoldClear` as the shared collision gate for installed IDs and existing source directories.
- Limited rollback to directories created by the current attempt so preexisting empty directories and symlinked directories remain untouched.
- Preserved the pinned template tree and `design.md` bytes on init failure, matching the #195 retry contract.
- Avoided any broader scaffold rewrite or test-suite expansion.

## What Was Deprecated

- Any cleanup that would delete a preexisting widget directory after an `EEXIST` claim failure.

## Lessons Learned

- Collision rejection needs to happen before any writes so the rollback path never has to guess whether a directory was preexisting or attempt-owned.
- A bounded write-failure cleanup inside `scaffoldWidget` is enough to protect partial writes without changing the higher-level init/page/widget flows.
- The regression surface is small enough to prove with a narrow integration filter instead of the full gate.

## Current State

- `extensions/pif.ts` is the only source file changed for this slice.
- The authorized diagnostic passed:
  - `node --test --test-concurrency=1 --test-name-pattern='app init preserves pinned template|page collision rejection' extensions/pif.integration.test.mjs`
- The checked scenarios covered init retry preservation and page collision rejection behavior without running the full analyzer/pub pipeline.
