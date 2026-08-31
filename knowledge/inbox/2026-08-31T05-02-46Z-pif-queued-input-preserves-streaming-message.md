---
type: Inbox
title: Queued console input preserves the active native message (#215)
description: Steer and follow-up input remain visible without splitting the assistant message or manufacturing a completion footer.
tags: [pi-extensions, pif, agent-console, transcript, native-pi, steer, flutter]
timestamp: 2026-08-31T05:02:46Z
generated_at: 2026-08-31T05:02:46Z
generated_by: orchestrated-dev-session
session_id: pending
commit_sha: []
branch: codex/pif-app-builder-154
issue_refs: [160, 215]
capture_tier: session
---

# What Was Done

The installed candidate UI walkthrough found that submitting Steer during a native assistant stream split that answer into its partial prefix and a second full snapshot. Reopening the console also displayed a false completion footer at the queued user input. Evidence is recorded in `/tmp/pif-remediation-2026-08-31/ui-evidence/32-stock-reopened.txt`.

The console reducer now reads the input event's native queue mode. `steer` and `follow_up` append the user message without finalizing an open turn or clearing its active assistant entry. Subsequent deltas and the terminal snapshot therefore update the existing message. If no turn is open, queued input still starts one through the existing prompt path.

# Decisions and Superseded Behavior

- A queued user instruction is not a native assistant message or turn boundary.
- Keep ordinary prompt handling and actual message/agent boundaries unchanged.
- Preserve active tool correlation and terminal cancellation/failure state while a queued instruction is waiting; do not hide error surfaces.
- Supersede the assumption that every input event may finalize a partly streamed answer.

# Validation and Current State

The task writer inspected the final UI evidence, hub input modes, and reducer paths. `git diff --check` passes for the scoped change. The writer did not run tests, builds, or UI actions and made no commit. Root owns focused regression tests for interleaved Steer/follow-up, final snapshot replacement, replay, and cancellation, followed by replacement artifact UI verification. No final workflow or release acceptance is asserted here.

Root regression evidence: the new interleaved queued-input case fails on the pre-fix abd1ea78 source and passes after the correction. All eight #215 Flutter cases pass, including live/reopened queued steer and follow_up, tool boundaries, error and cancellation replay. Targeted Dart analysis is clean. Real rebuilt-artifact repeat remains pending.
