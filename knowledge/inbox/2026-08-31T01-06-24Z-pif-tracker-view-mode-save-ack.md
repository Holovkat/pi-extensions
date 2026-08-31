---
type: Inbox
title: pif tracker view-mode save acknowledgement for #197
description: Recorded the tracker-board fix that lets tracker/op update acknowledgements clear busy state even when the sheet is not in edit mode, while still ignoring unrelated replies and preserving the existing bus contract
tags: [pi-extensions, pif, tracker, flutter, issues, save-ack, okf]
timestamp: 2026-08-31T01:06:24Z
generated_at: 2026-08-31T01:06:24Z
generated_by: governed-sprint-builder
session_id: pending
commit_sha: []
branch: codex/pif-app-builder-154
issue_refs: [197]
epic_refs: [152]
capture_tier: session
---

# What Was Done

Updated `pif/lib/widgets/tracker_board/tracker_board.dart` so the ticket sheet tracks the in-flight tracker op separately from `_editing`. View-mode tag and image-width changes can now be saved through the close confirmation flow without getting stuck in the busy state, and the sheet still keeps unsaved changes when a save fails.

The fix stays inside the existing `tracker/op` / `op_result` contract. Matching update replies now clear the pending save even when the editor is closed, and replies for other tracker actions keep the pending save state intact.

The narrow analyzer on the touched file passed cleanly after the change.

# Decisions Made

- Keep the change local to the tracker sheet state machine.
- Preserve the current bus payload shape and reply channel names.
- Do not add a new test suite for this T1 lane.

# What Was Deprecated

Nothing deprecated. The only behavioral change is that save acknowledgements no longer depend on editor visibility.

# Lessons Learned

- `_editing` is not a safe proxy for "a save is in flight" because view-mode edits can still dirty the sheet.
- The strongest available match without a protocol change is to keep explicit pending-op state and clear it only for the expected tracker reply.

# Current State

`pif/lib/widgets/tracker_board/tracker_board.dart` is the only code file intentionally changed for #197, and `dart analyze` on that file is clean. The widget is ready for tracker handoff, with the remaining coordination work left to the owner of the task record.
