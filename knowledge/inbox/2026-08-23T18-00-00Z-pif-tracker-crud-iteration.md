---
type: Inbox
title: pif Tracker CRUD Iteration — Full Ticket Lifecycle, Resizable Sheet
description: Task #168 on codex/pif-tracker-panel — create/edit/delete tickets through gh, a resizable persisted ticket sheet, explicit lane moves, op_result failure surfacing, and agent-facing pif_tracker_* CRUD tools; app rebuilt and redeployed
tags: [pi-extensions, pif, flutter, tracker, crud, github, sprint]
timestamp: 2026-08-23T18:00:00Z
generated_at: 2026-08-23T18:00:00Z
generated_by: dev-session
session_id: pending
commit_sha: []
branch: codex/pif-tracker-panel
issue_refs: [168]
epic_refs: [152]
capture_tier: session
---

# What Was Done

Tony's UAT follow-up on the tracker panel, shipped as task #168 on the sprint branch: full CRUD for tickets, a resizable detail sheet, and guaranteed lane moves.

## Product changes

- **Create** (+ button on the board): type → epic/sprint/task label, starting lane → column label, title + Markdown body → `gh issue create`; repos missing the labels get an automatic no-label fallback so creation never hard-fails.
- **Update**: edit mode in the sheet patches title/body via `gh issue edit`; optimistic locally, reverted or errored via `tracker/op` `op_result`.
- **Delete**: confirmed from the sheet → `gh issue delete --yes`; sheet closes on success.
- **Resizable sheet**: corner drag handle (min 460×360, screen-clamped), size persisted per-widget via `PifStorage` (`sheet_w`/`sheet_h`).
- **Lane moves**: drag-and-drop plus an explicit lane dropdown in the sheet; both optimistic with revert on failed write-back.
- **Agent surface**: `pif_tracker_create` / `pif_tracker_update` / `pif_tracker_delete` pi tools alongside `pif_tracker_list`.
- Tracker widget made `core: true` so existing projects see it without a registry toggle.

# Decisions Made

- Operation results broadcast as `tracker/op` `op_result` (op, ok, number, error) — WS actions have no request/response pairing, so the shell needs an event to close sheets on success and surface failures inline.
- Create falls back to label-less creation when the repo lacks the labels (foreign repos) rather than failing; the card lands in the first column per fallback rules.
- Update does not carry state/label changes — those ride the existing column move rules, keeping one write-back semantic.

# Lessons Learned

- Dialog sizing is constrained by the route's inset padding, not just the surface — widget-test assertions on grown height can be clamped silently; assert the axis with headroom.
- Self-review before running caught a real bug class worth remembering: guard conditions like `if (_busy) return` on event listeners silently swallow the results of the very operation that set the flag.

# Current State

- Branch `codex/pif-tracker-panel` at b3555f8, pushed; full gate green (19 node + analyze + 38 Flutter).
- Live CRUD round-trip verified against GitHub (create #169 → rename → delete).
- build/pif.app rebuilt (294MB, signature verified), installed to /Applications, launched for Tony's UAT.
- Sprint #163 still open: awaiting UAT acceptance of #164/#165/#166/#168, then merge to master (T4/T5) and the app-builder lane (#154).
