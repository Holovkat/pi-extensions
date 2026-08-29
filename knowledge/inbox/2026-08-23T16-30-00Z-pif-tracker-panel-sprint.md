---
type: Inbox
title: pif Tracker Panel Sprint — Kanban Board Shipped to Branch, Awaiting Dev UAT
description: Implemented sprint #163 end to end on codex/pif-tracker-panel — hub tracker sync layer (gh fetch, repo board config, write-back, SQLite cache), the Tracker center-stage Kanban widget with markdown detail, and full verification including a live gh real-use trial with GitHub-verified write-back
tags: [pi-extensions, pif, flutter, tracker, kanban, github, sprint]
timestamp: 2026-08-23T16:30:00Z
generated_at: 2026-08-23T16:30:00Z
generated_by: dev-session
session_id: pending
commit_sha: []
branch: codex/pif-tracker-panel
issue_refs: [163, 164, 165, 166]
epic_refs: [152]
capture_tier: session
---

# What Was Done

Implemented the tracker panel precursor sprint (#163) in a governed worktree (branch `codex/pif-tracker-panel`, ports 48180-48199), tasks #164 → #165 → #166 serially.

## Product changes

- **Hub tracker sync (#164)**: `TrackerSync` in `pif-shared.ts` — reads the workspace repo's GitHub issues via the ambient `gh` session (epic/sprint/task labels → card types, 20k body cap, 300-issue limit), writes card moves back per column rules (`gh issue edit --add-label/--remove-label`, `issue close/reopen`), caches to SQLite (`node:sqlite`) with JSON fallback under `.pi/pif/cache/`, and serves stale cache when the tracker is unreachable. Board columns come from a versioned `.pif/board.yaml` in the repo (block format: `column <id>:` + name/state/label/status rules, first-match wins, unmatched cards fall to the first column); repos without one get a default Backlog/In Progress/Done board derived from state + `status:*` labels. Hub surface: `tracker` in the snapshot, `tracker/state` + `tracker/move` events, `tracker.refresh/move/list` control methods, `pif_tracker_list` pi tool.
- **Tracker board widget (#165)**: `tracker_board` — center-stage tabbed Kanban. Columns with counts, type badges, closed indicators; drag between columns is optimistic with deep-copy revert on hub-reported failure; card detail dialog renders the body as Markdown; `cached` staleness badge, error line, manual refresh.
- **Verification (#166)**: integration coverage (models-channel regression + tracker controls against a real hub); reference config committed (`.pif/board.yaml` + `status:todo/in-progress/blocked` labels); `pif/README.md` documents the widget and board config; live real-use trial with real gh.

# Real-use trial Evidence

Real-repo read: 94 cards, epic #152 / sprints #153 #163 / tasks #164-#166 typed and columned correctly. Sandboxed move (scratch #167, deleted after): move to In Progress added `status:in-progress` (verified on GitHub); move to Done cleared the label and closed the issue (verified). Offline drill (`PIF_GH_BIN=/usr/bin/false`): refresh fails cleanly, 95 cached cards served with stale=true.

# Decisions Made

- Columns are backed by tracker state, never pif-local persistence: exact `status:*` labels + issue state; the repo is the single source of truth by construction.
- `TrackerSync` lives in `pif-shared.ts` (not `pif.ts`) so unit tests can import it without typebox/peer deps; it also cannot use constructor parameter properties (Node type-stripping rejects them) — both constraints documented by this sprint.
- Unmatched cards land in the first column (leftmost = entry column convention).
- The latent `models` channel rejection (Model Manager's `models/save` was failing envelope validation) was fixed alongside adding `tracker` to `PIF_CHANNELS` — one line, regression-tested.

# Lessons Learned

- The hub's `ensure()` sets the module-global `hub` only after `await start()`, so concurrent autostart triggers race (second start unlinks the first's control.sock → EADDRINUSE). Pre-existing, not sprint-introduced; observed only under scripted double-start; recorded on #163 for triage.
- Node 22 type-stripping rejects parameter properties in `.ts` imports — keep `pif-shared.ts` free of them.
- Widget-test broadcast streams need `pumpAndSettle()` after emitting; a single `pump()` does not flush delivery (house idiom confirmed).
- Long ad-hoc hub probes from sandboxed shells are unreliable (loopback restrictions, stdin EOF shutting RPC sessions down); the integration suite already boots real hubs — drive live real-use trials at the module level (`TrackerSync`) and leave hub boot coverage to `pif.integration.test.mjs`.

# Current State

- Branch `codex/pif-tracker-panel` pushed; full gate green (16 node + analyze + 32 Flutter tests). Tasks #164/#165 have T1 evidence comments; #166 carries the T2 verification record.
- Sprint #163 open awaiting **T3 Dev UAT** (Tony): run `/pif` from source, enable the Tracker widget if the project registry predates it, board tab → drag a card → verify on GitHub.
- Next in the epic after UAT: merge to master (T4 clean-checkout regression + T5), then the app-builder lane (#154).
