---
type: Process
title: Sprint Development Workflow
description: The dev-pipeline sprint flow — pipeline start, epic auto-chaining, task execution through build/eval/fix/UAT, and final merge.
resource: ./extensions/dev-pipeline.ts
tags: [pi-extensions, process, sprint, pipeline, epic, chaining, merge, uat]
timestamp: 2026-06-29T15:00:00Z
status: active
---

# Sprint Development Workflow

The dev-pipeline workflow reads the checklist produced by req-qa and drives tasks through development, compliance, and quality gates.

## Pipeline Start

1. `/pipeline-start` parses the checklist — identifies all epics and tasks
2. Fetches full issue bodies from GitHub via `gh issue view` for complete acceptance criteria
3. Shows the plan (epics, tasks, model assignments, timeouts, compliance threshold)
4. User confirms
5. Creates the branch `feature/epic-N-<name>`

## Epic Execution (Fast Track)

Each epic runs through stages automatically:
1. **BUILD** — single model builds entire epic
2. **EVALUATE** — stronger model scores each task per acceptance criteria
3. **FIX** — tasks below 95% get surgical fixes with watchdog timers and analyst escalation
4. **UAT SCENARIOS** — evaluator generates test scenarios as GitHub issues
5. **CHECKLIST UPDATE** — passed tasks checked off, issues closed

## Epic Execution (3-Wave)

1. **Wave 1** — 3 architects in parallel, consolidated into unified spec
2. **Wave 0** — 3-step prototype (first epic only)
3. **Wave 1** — review and TODO placement
4. **Wave 2** — sequential dev sprint with compliance scoring and fix retries

## Auto-Chaining

After each epic completes:
1. Creates next branch from current HEAD (preserving previous epic's code)
2. Resets tmux panes
3. Pauses 3 seconds
4. Starts next epic automatically

Halts if an epic fails (tasks can't reach 95% after 5 fix depths).

## UAT and Merge

1. After all epics pass, Playwright runs all UAT scenarios
2. Results posted to GitHub issues
3. Pipeline halts at approval gate
4. `/pipeline-approve` -> close UAT epic -> `/pipeline-end` -> squash merge + push
5. `/pipeline-reject` -> post notes to failed issues -> `/pipeline-next` -> fix cycle

## Related Concepts

- [Fast Track Architecture](../architecture/fast-track-architecture.md)
- [Three-Wave Architecture](../architecture/three-wave-architecture.md)
- [UAT Process](../domain/uat-process.md)
- [Watchdog Timer System](../domain/watchdog-timer-system.md)
- [Fast Track Walkthrough](./fast-track-walkthrough.md)
- [Requirements Discovery Workflow](./requirements-discovery-workflow.md)
