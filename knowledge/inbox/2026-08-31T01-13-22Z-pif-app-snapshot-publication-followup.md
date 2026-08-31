---
type: Inbox
title: pif app snapshot publication follow-up for #194
description: Recorded the hub follow-up that defers app manifest publication until init succeeds, keeps snapshot().app from exposing a pending app during install, and resets the initialization guard after success or failure
tags: [pi-extensions, pif, hub, app-mode, snapshot, manifest, okf]
timestamp: 2026-08-31T01:13:22Z
generated_at: 2026-08-31T01:13:22Z
generated_by: governed-sprint-builder
session_id: pending
commit_sha: []
branch: codex/pif-app-builder-154
issue_refs: [194]
epic_refs: [152]
capture_tier: session
---

# What Was Done

Prepared the #194 follow-up for commit on `extensions/pif.ts`. The change keeps a newly initializing app from publishing its manifest early: `assertNoApp()` now rejects concurrent initialization attempts, `appInitializing` marks the in-flight install, and `writeAppManifest()` happens only after the init/install gate succeeds. The guard is cleared in `finally`, so retries remain possible after success or failure.

The follow-up preserves the existing snapshot/event contract while avoiding a pending-app leak to already connected shells.

# Decisions Made

- Keep the repair inside the hub's existing app-manifest lifecycle.
- Do not add a parallel app-state store or a new publish channel.
- Preserve the earlier #192 hub groundwork and keep the follow-up atomic.

# What Was Deprecated

Nothing deprecated. The only behavioral change is delaying manifest publication until after the initialization gate passes.

# Lessons Learned

- App publication should follow the successful install gate, not lead it.
- A transient initialization flag is enough to prevent concurrent retry noise without broadening the app-state model.

# Current State

The #194 follow-up is ready to stage and commit as a small hub-only fix. Related tracker-board, widget-store, and test work in the worktree remains untouched and will stay outside this atomic slice.
