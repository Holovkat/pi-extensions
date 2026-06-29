---
type: Architecture
title: Fast Track Pipeline Architecture
description: The default lean pipeline mode — single model builds, stronger model evaluates, surgical fixes with watchdog timers, automated Playwright UAT.
resource: ./extensions/dev-pipeline.ts
tags: [pi-extensions, architecture, fast-track, build, evaluate, fix, uat, playwright]
timestamp: 2026-06-29T15:00:00Z
status: active
---

# Fast Track Pipeline Architecture

Activated with `/pipeline-start` (no flags). A streamlined pipeline for faster iteration.

## Pipeline Stages

1. **BUILD** — A single model (Gemini 3 Pro) receives all tasks for the epic in one prompt. Builds from scratch for epic 1; extends existing code for subsequent epics.
2. **EVALUATE** — A stronger model (Opus 4.6) reads the code and scores each task independently against acceptance criteria. Returns structured JSON with per-task scores and issues.
3. **FIX** — Tasks below 95% get surgical fixes under watchdog timers. Each fix attempt runs with a timeout; if the agent can't finish, it's steered to yield a structured summary and an analyst decides how to proceed.
4. **UAT SCENARIOS** — The evaluator generates test scenarios for the epic. Each scenario becomes a GitHub issue under a UAT parent epic.
5. **UAT EXECUTION** — After all epics, Playwright runs all scenarios via browser, posts results to GitHub issues.
6. **APPROVAL GATE** — Dashboard flashes "AWAITING UAT APPROVAL". User runs `/pipeline-approve` or `/pipeline-reject`.

## Watchdog Timer Progression

| Depth | Timeout | Model |
|-------|---------|-------|
| 1 | 10 min | Base fixer (Qwen 3.5+) |
| 2 | 15 min | Escalation 1 (Sonnet 4.6) |
| 3 | 20 min | Escalation 2 (Opus 4.6 xhigh) |
| 4 | 25 min | Escalation 2 (clamped) |
| 5 | 30 min | Escalation 2 (clamped) |

At T-30 seconds, the watchdog steers the agent to yield. At T, the agent is aborted and killed.

## Stage Widget Bar

A horizontal status bar shows real-time progress: `Build check | Eval dot | Fix circle | UAT Auto circle | UAT circle` with the active model and task name.

## Auto-Chaining

After each epic completes, the pipeline creates the next branch from current HEAD, resets tmux panes, pauses, and starts the next epic automatically. Halts if an epic fails after 5 fix depths.

## Performance

A 7-task epic with 2 fix depths typically takes 5-10 minutes. Full UAT across all epics adds 5-15 minutes.

## Related Concepts

- [Three-Wave Architecture](./three-wave-architecture.md)
- [Watchdog Timer System](../domain/watchdog-timer-system.md)
- [Fast Track vs Three-Wave](../decisions/fast-track-vs-three-wave.md)
- [Fast Track Walkthrough](../process/fast-track-walkthrough.md)
- [Sprint Development Workflow](../process/sprint-development-workflow.md)
