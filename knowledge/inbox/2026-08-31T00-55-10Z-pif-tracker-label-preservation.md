---
type: Inbox
title: pif tracker label preservation on first edit (#191)
description: Validated the tracker-board fix that loads existing GitHub labels before optional local attrs so the first title/body save does not clear untouched labels; kept the change inside tracker_board.dart and left the update contract unchanged
tags: [pi-extensions, pif, tracker, github, issues, labels, flutter, okf]
timestamp: 2026-08-31T00:55:10Z
generated_at: 2026-08-31T00:55:10Z
generated_by: governed-sprint-builder
session_id: pending
commit_sha: []
branch: codex/pif-app-builder-154
issue_refs: [191]
epic_refs: [152]
capture_tier: session
---

# What Was Done

Validated the #191 tracker-board repair in `pif/lib/widgets/tracker_board/tracker_board.dart`. The fix loads remote labels before the optional local `attr_<issue>` record, so a first edit on a fresh issue sheet preserves existing custom labels instead of sending an empty tag list.

The narrow analyzer on the touched surface passed cleanly after the existing workspace edit.

# Decisions Made

- Keep the fix inside the tracker sheet load path only.
- Preserve the existing GitHub update contract in `extensions/pif-shared.ts`; no label-protocol redesign was introduced.
- Do not add a per-task test suite for this T1 lane.

# What Was Deprecated

Nothing deprecated. The only behavioral change is the load ordering that avoids losing remote labels when no local attrs exist yet.

# Lessons Learned

- Local tracker attrs should never gate the initial read of remote labels for an issue sheet.
- A narrow static check on the changed file was enough to confirm the fix stayed within the intended surface.

# Current State

`pif/lib/widgets/tracker_board/tracker_board.dart` is the only intended code change for #191, and the analyzer is clean on that file. The lane is ready for commit handoff, with #197 next in the serial remediation order.
