---
type: Inbox
title: pif tracker request IDs and modal gating now correlate ticket dialog results (#216)
description: Ticket create/update/delete requests now carry per-send request IDs, dialog acknowledgements only consume the matching outstanding request when the hub echoes that ID, and the ticket sheet modal cannot be dismissed through the barrier while a save is in flight.
tags: [pi-extensions, pif, tracker-board, ticket-sheet, request-id, modal-flow, okf]
timestamp: 2026-08-31T04-19-37Z
generated_at: 2026-08-31T04-19-37Z
generated_by: orchestrated-dev-session
session_id: pending
commit_sha: []
branch: codex/pif-app-builder-154
issue_refs: [216]
capture_tier: session
---

# What Was Done

The tracker ticket sheet now assigns a unique per-send request ID to every create, update, and delete payload. The sheet stores the outstanding request ID locally and only accepts an op result when the hub echoes the same ID for the same operation. That keeps delayed results from another dialog or another retry from closing, resetting, or erroring the active ticket sheet.

The ticket dialog itself now uses a non-dismissible modal barrier, so outside clicks cannot bypass the existing Close / dirty-save flow.

## Decisions and Superseded Behavior

- Keep the transport unchanged. The widget adds a request ID to its payload and relies on the hub to echo it back.
- Require an exact request ID match before a ticket result is allowed to close or reset the active sheet; the old op-only acceptance path is superseded.
- Keep the existing move-card path untouched; this issue only covers ticket create/update/delete flows.

## Validation and Current State

- Narrow Dart analysis on `pif/lib/widgets/tracker_board/tracker_board.dart` passed with no issues.
- The owned code slice is limited to the tracker board widget plus this inbox note.
- Remaining risk is entirely on the hub side until the result payload echoes `requestId` on every success and failure path.

## Root integration and focused evidence

The hub now echoes the submitted requestId for all create/update/delete success and failure envelopes. Root regression coverage rejects unrelated and uncorrelated results, retains the busy dialog on outside clicks, ignores a stale prior retry result, and accepts the matching result. All 52 tests across core_and_widgets_test.dart and tracker_scope_test.dart pass. A Node boundary case checks identity echo on all six success/failure operation combinations. Final native UI and combined candidate acceptance remain pending.
