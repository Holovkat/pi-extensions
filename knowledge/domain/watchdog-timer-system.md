---
type: Domain
title: Watchdog Timer System
description: Per-depth timeout system for fix agents with steer-for-summary at T-30s, hard yield at T, analyst escalation, and learnings persistence.
resource: ./extensions/dev-pipeline.ts
tags: [pi-extensions, domain, watchdog, timeout, escalation, analyst, learnings, yield]
timestamp: 2026-06-29T15:00:00Z
status: active
---

# Watchdog Timer System

When a task scores below 95% in Fast Track mode, each fix attempt runs under a watchdog timer. If the agent can't finish in time, it's steered to yield a structured summary, and an analyst agent decides how to proceed.

## Timeout Progression

| Depth | Timeout | Model | Thinking |
|-------|---------|-------|----------|
| 1 | 10 min | Qwen 3.5+ (base fixer) | high |
| 2 | 15 min | Claude Sonnet 4.6 (escalation 1) | high |
| 3 | 20 min | Claude Opus 4.6 (escalation 2) | xhigh |
| 4 | 25 min | Claude Opus 4.6 (clamped) | xhigh |
| 5 | 30 min | Claude Opus 4.6 (clamped) | xhigh |

## Yield Mechanism

- At **T-30 seconds**, the watchdog steers the agent: "TIMEOUT WARNING: yield NOW and provide a JSON summary of blockers, attempted approaches, and suggestions."
- At **T**, the agent is aborted and killed.
- The captured yield summary includes: `{blockers, attempted, suggestion}`.

## Analyst Decisions

| Action | Effect |
|--------|--------|
| `decompose` | Breaks the task into smaller sub-tasks for the next fix depth |
| `simplify` | Reduces the task scope — overwrites requirements with a simpler version |
| `deprecate` | Marks the task as infeasible — stops trying, moves on |
| `skip` | Skips for now — records conditions under which to retry |

## Learnings Flow

1. Each fix attempt records an `AgentLearning` (blockers, attempted approaches, suggestion, analyst decision)
2. Learnings are posted as structured comments on the task's GitHub issue
3. Subsequent fix agents receive all prior learnings with "DO NOT repeat approaches that have already been tried"
4. On pipeline restart, learnings are seeded from issue comments — they survive crashes

## Existing Code Preservation

Fixes are additive or corrective, never destructive. Existing working code is always preserved.

## Related Concepts

- [Fast Track Architecture](../architecture/fast-track-architecture.md)
- [GitHub Integration](../architecture/github-integration.md)
- [Agent Subprocess Execution](../architecture/agent-subprocess-execution.md)
- [Model Configuration](../architecture/model-configuration.md)
- [Fast Track Walkthrough](../process/fast-track-walkthrough.md)
