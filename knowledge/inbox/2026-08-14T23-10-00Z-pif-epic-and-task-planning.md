---
type: Inbox
title: pif Epic and Task Planning Published
description: Created the pif tracker structure on GitHub — epic 120, sprint 121, tasks 122-129 — from the approved pif design spec, with delivery gates and a single epic verification task
tags: [pi-extensions, pif, flutter, planning, epic, github, issues]
timestamp: 2026-08-14T23:10:00Z
generated_at: 2026-08-14T23:10:00Z
generated_by: planning-session
session_id: pending
commit_sha: []
branch: master
issue_refs: [120, 121, 122, 123, 124, 125, 126, 127, 128, 129]
epic_refs: [120]
capture_tier: session
---

# What Was Done

Published the pif project to the GitHub tracker from the approved design spec (`docs/superpowers/specs/2026-08-15-pif-design.md`), following the repo's pi-council issue conventions (Epic/Sprint/Task title prefixes, `epic`/`sprint`/`task` labels, per-project area label, Reference Index headers). Created the `pif` area label.

Structure: Epic #120 (pif Pi-hosted Flutter agentic IDE) → Sprint #121 (v0.1 Phase 1 primitives) → Tasks #122 (bus protocol + hub skeleton), #123 (session manager: host mirror + rpc children), #124 (Flutter supervisor + widget install pipeline), #125 (shell scaffold: docking, bus client, widget contract), #126 (Agent Console + Session Rail), #127 (Terminal + Status Bar), #128 (Widget Store + pif_* tools), #129 (epic verification: tests, integration, review, diff-viewer dogfood).

# Decisions Made

- One epic for the whole pif project; only Phase 1 (Primitives) gets executable tasks now. Phases 2 (Ecosystem) and 3 (Platform) are recorded on the epic as deferred scope for future sprints rather than invented as premature tasks.
- Two parallel lanes with disjoint ownership: Lane A hub/TypeScript (#123, #124) and Lane B shell/Dart (#125, #126, #127), joined by #128, after the shared protocol foundation (#122). Task #124 owns the `widget_registry.g.dart` codegen format; #125 consumes it.
- Exactly one epic verification task (#129) owns all test additions, integration checks, acceptance validation, combined code+spec review, and the diff-viewer dogfood (Phase 1 exit). Implementation tasks carry only narrow T1 development checks.
- Delivery gates mapped on the epic: canonical Dev surface is the local macOS shell run from source via `/pif`; T4 QA readiness is full suites plus end-to-end regression on a clean checkout; T5 release is merge to master with no hosted deployment vectors.
- All task complexity scores kept at or below 5.0/10, matching the pi-builder complexity gate convention.

# What Was Deprecated

Nothing. Planning artifacts only; no code or concepts superseded.

# Lessons Learned

- macOS bash 3.2 mis-parses apostrophes inside heredocs nested in command substitution; writing issue bodies to temp files and using `gh issue create --body-file` is the reliable pattern for scripted issue creation in this repo.
- The pi-council issue tree (#112-#119) is the cleanest existing template for epic/sprint/task publication and was mirrored for pif.

# Current State

Epic #120 with sprint #121 and tasks #122-#129 are open and cross-referenced; the design spec now back-references the tracker. Planning compliance review passed with no missing must-have scope. Next action: start Task #122 (bus protocol + hub skeleton) in a governed sprint workspace.
