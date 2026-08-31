---
type: Inbox
title: Empty native failures no longer taint later successful transcript turns (#215)
description: A new ordinary prompt resets the previous stored turn even when its failed assistant message had no text and no agent_end was persisted.
tags: [pi-extensions, pif, agent-console, transcript, native-pi, restart, flutter]
timestamp: 2026-08-31T06:53:12Z
generated_at: 2026-08-31T06:53:12Z
generated_by: orchestrated-dev-session
session_id: pending
commit_sha: []
branch: codex/pif-app-builder-154
issue_refs: [160, 215]
capture_tier: session
---

# What Was Done

Root's exported-app walkthrough exercised an expected empty-profile provider failure followed by a configured-provider success. The successful response showed a green 11-second footer live, but after restart the preserved response acquired the earlier failure flag and a duration spanning both requests. The observed reopened state is recorded in `/tmp/pif-e2e-2026-08-31/ui/12-restarted-transcript-latest.txt` and its paired screenshot.

The reducer only finalized an earlier turn at a new ordinary prompt if assistant text or tool content had appeared. An empty terminal assistant failure sets failure state without satisfying that condition. Native stored history can omit the live `agent_end` event, so the next prompt inherited the previous failure state and start timestamp.

An ordinary input now closes and resets any previous open turn regardless of answer text. The prior error entry stays visible. The successful request starts with its own timestamp and clean terminal state. Queued `steer` and `follow_up` inputs continue to preserve the active turn. The obsolete content-seen flag and its assignments were removed.

# Decisions and Superseded Behavior

- Ordinary prompt boundaries reset turn state even after an empty failure or cancellation.
- Stored terminal errors remain visible; later successful responses must not inherit their status or elapsed time.
- Keep native message boundaries and queued-input behavior unchanged.
- The correction belongs in the transcript reducer; no hub hydration or profile/model implementation was changed by this task.

# Validation and Current State

The task writer inspected the reopened UI accessibility evidence, normalization/hydration source, and reducer transitions. `git diff --check` passes. No tests, builds, UI actions, process changes, commits, or pushes were run by the task writer. Root owns focused empty-error/empty-abort followed by successful-turn replay regressions, analysis, rebuilt-artifact restart verification, and acceptance. The native session file was not found at the initially supplied canonical workspace path, so this note does not claim a direct inspection of that file.

## Root verification

The new failure-to-success history regression fails on bdfe5bb4 and passes on this repair. All nine focused #215 widget cases pass, including queued Steer/follow-up, partial failures, reused tool IDs and reopened history. Targeted Dart analysis is clean. Rebuilt native restart proof and the final combined gate remain pending under #160.
