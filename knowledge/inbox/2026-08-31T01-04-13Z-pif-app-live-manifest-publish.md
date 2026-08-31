---
type: Inbox
title: pif app tools publish live manifest state after successful mutations (#194)
description: Published app manifest state through the existing snapshot contract after successful init, page-add, and home-set operations so the already-connected shell updates live without a manual reconnect
tags: [pi-extensions, pif, hub, flutter, manifest, snapshot, app-mode, issues, okf]
timestamp: 2026-08-31T01:04:13Z
generated_at: 2026-08-31T01:04:13Z
generated_by: governed-sprint-builder
session_id: pending
commit_sha: []
branch: codex/pif-app-builder-154
issue_refs: [194]
epic_refs: [152, 153]
capture_tier: session
---

# What Was Done

Implemented the #194 hub-side publish fix in `extensions/pif.ts`. After successful `pif_app.init`, `pif_app.page_add`, and `pif_app.home_set` operations, the hub now broadcasts the updated snapshot so a shell that is already connected sees the new app manifest immediately.

The change stays within the existing snapshot/event contract. It does not add a parallel app-state store or alter the manifest schema.

# Decisions Made

- Publish only after each successful mutation return point, not inside the shared manifest-write helper, so `pif_app.init` can still roll back safely on later failure.
- Keep the fix hub-side; the shell already consumes `snapshot.app` and did not need a listener rewrite.
- Reuse the existing snapshot path rather than introducing a new event channel.

# What Was Deprecated

Nothing was deprecated. The only removed behavior is the silent gap between a successful manifest mutation and the next snapshot.

# Lessons Learned

- The hub already owns the authoritative app manifest; the missing step was broadcasting that state after success.
- Publishing from the shared write helper would have been too early for init because the operation can still fail and roll back.
- The existing shell snapshot path is sufficient for live app-mode entry once the hub publishes the updated state.

# Current State

`extensions/pif.ts` is the only intended code change for #194, and the bounded diagnostic confirmed live publication plus rollback behavior. The lane is ready for commit handoff, with #195 next in the serial remediation order.
