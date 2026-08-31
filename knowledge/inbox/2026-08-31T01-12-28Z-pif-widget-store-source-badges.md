---
type: Inbox
title: pif widget store source badges from live snapshot state for #210
description: Recorded the widget-store fix that reads each available entry's actual source metadata instead of hardcoding the catalog badge, with a legacy fallback for older snapshots and no protocol change
tags: [pi-extensions, pif, widget-store, provenance, catalog, okf]
timestamp: 2026-08-31T01:12:28Z
generated_at: 2026-08-31T01:12:28Z
generated_by: governed-sprint-builder
session_id: pending
commit_sha: []
branch: codex/pif-app-builder-154
issue_refs: [210]
epic_refs: [152]
capture_tier: session
---

# What Was Done

Updated `pif/lib/widgets/widget_store/widget_store.dart` so the available-entry badge reads the real `source` field from the catalog snapshot when present. That makes the app archive / base source distinct from the global catalog source, while still falling back to the legacy catalog label when older snapshot data omits provenance.

The existing install payload and protocol stayed untouched. The fix is strictly a rendering change over the live snapshot state the hub already publishes.

`dart analyze` on the touched file passed cleanly.

# Decisions Made

- Reuse the existing badge helper instead of adding a new provenance model.
- Keep the fallback safe for older snapshots that do not carry `source`.
- Leave install action payloads and hub control methods unchanged.

# What Was Deprecated

Nothing deprecated. The hardcoded available-entry catalog badge was replaced by actual source-aware rendering.

# Lessons Learned

- The hub already sends enough provenance to distinguish base and global catalog items; the widget only needed to read it.
- A small helper for source extraction keeps the legacy fallback explicit and avoids spreading snapshot-shape checks through the build tree.

# Current State

`pif/lib/widgets/widget_store/widget_store.dart` is the only intended code change for #210, and `dart analyze` on that file is clean. The task is ready for coordinator handoff.
