---
type: Inbox
title: Native pif transcript boundaries and tool cards corrected (#215)
description: Native event normalization and session-local console reduction preserve distinct assistant messages, coalesce correlated tool updates, and show failures and cancellation without duplicate prompt bubbles.
tags: [pi-extensions, pif, agent-console, transcript, native-pi, flutter, okf]
timestamp: 2026-08-31T03:58:19Z
generated_at: 2026-08-31T03:58:19Z
generated_by: orchestrated-dev-session
session_id: pending
commit_sha: []
branch: codex/pif-app-builder-154
issue_refs: [215]
capture_tier: session
---

# What Was Done

The early native UI walkthrough exposed duplicate prompt/reply rendering and raw non-text deltas. Native Pi events are now normalized by role and event type: explicit user input is retained, live custom-input boundary echoes are omitted, only text deltas enter the answer, and tool execution keeps its correlation ID and readable result/error details. Stored native custom messages and tool results hydrate with the same roles. Empty provider failures and abort reasons survive normalization.

The Flutter reducer tracks the active assistant message within each session and resets it at actual message boundaries. Separate assistant messages around tool calls remain separate. Correlated tool updates share one card; partial results stay running until an end event. A Material ancestor fixes the ExpansionTile runtime assertion. Reopening an active session does not manufacture a completion footer.

## Decisions and Superseded Behavior

- Do not suppress an assistant answer because it equals the prompt or lacks a preceding agent_start. Role and native boundaries are authoritative.
- Preserve failure and cancellation surfaces; a clean normal workflow must not be achieved by hiding errors.
- Replace the earlier draft heuristic that discarded legitimate stored assistant replies and the draft lookup that overwrote prior assistant messages around tool calls.

## Validation and Current State

The first root Flutter run found three failures: dropped stored reply, lost earlier assistant message, and a missing Material ancestor for tool cards. Root corrected those defects, then restored the missing explicit child prompt publication path before native user echo events are filtered. Fifteen Node cases now pass across `#215` and `#187` in `215-integrated-child-root.log`; five focused Flutter cases pass; and 39 file tests already pass in the root-held logs. Raw evidence is in `/tmp/pif-remediation-2026-08-31/215-console-failure-root.log`, `215-native-failure-root.log`, and `215-integrated-child-root.log`.

This is focused implementation evidence. The complete gate, final artifact UI walkthrough, export/provider proof, and owner acceptance remain separate. Independent review is still pending and no final UI or release acceptance is asserted here.

## Independent review corrections before the complete gate

The independent review found two further cases: a provider may reuse a tool-call ID in a later turn, and stored partial terminal answers may lack a separate agent_end. Root scoped the tool-card map to each turn and retained terminal abort/failure metadata in synthesized footers. A failed or aborted partial answer no longer displays a green completion footer after reopening. Two regression cases cover reused call_0 across turns and both partial failure/abort across repeated reopening without agent_end. All seven focused #215 Flutter cases pass in 215-review-corrections-root.log. The full gate still has not run at this point.
