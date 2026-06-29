---
type: Process
title: Fast Track Walkthrough
description: Step-by-step guide to running the fast track pipeline from a freshly generated PRD to a finished, UAT-approved project.
resource: ./docs/walkthrough-fasttrack.md
tags: [pi-extensions, process, fast-track, walkthrough, guide, uat, playwright]
timestamp: 2026-06-29T15:00:00Z
status: active
---

# Fast Track Walkthrough

A step-by-step guide to running the fast track pipeline from a freshly generated PRD to a finished, UAT-approved project.

## Prerequisites

- PRD and implementation checklist generated via `pi-req`
- GitHub issues published for all tasks
- `pi-dev` alias configured
- tmux running

## Step 1: Start the Pipeline

```bash
pi-dev
/pipeline-start
```

The extension parses the checklist, fetches GitHub issue bodies, shows the plan (tasks, model assignments, timeouts), and asks for confirmation. Creates the branch `feature/epic-1-<name>`.

## Step 2: Automatic Epic Execution

Each epic runs through four stages:
1. **BUILD** — Gemini 3 Pro builds entire epic in one prompt
2. **EVALUATE** — Opus 4.6 scores each task against acceptance criteria
3. **FIX** — tasks below 95% get surgical fixes with watchdog timers and analyst escalation
4. **UAT SCENARIOS** — evaluator generates test scenarios as GitHub issues

Passed tasks are checked off in the checklist and their GitHub issues closed.

## Step 3: Auto-Chain Through All Epics

After each epic: creates next branch from current HEAD, resets tmux panes, pauses 3 seconds, starts next epic. Halts if an epic fails after 5 fix depths — manually fix and run `/pipeline-next` to resume.

## Step 4: UAT Execution

1. Server startup (`python3 -m http.server 8080`)
2. Playwright executes each scenario (navigate, click, type, verify)
3. Results posted as comments on each scenario issue
4. Labels updated (`uat-pending` -> `uat-pass` or `uat-fail`)

## Step 5: Approval Gate

Dashboard flashes "AWAITING UAT APPROVAL". Review results, then:

- **Approve** (`/pipeline-approve`): closes UAT epic, then `/pipeline-end` for squash merge + push
- **Reject** (`/pipeline-reject`): provide notes, failed scenarios reset, run `/pipeline-next` for fix cycle

## Typical Timeline

| Phase | Duration |
|-------|----------|
| Build (per epic) | 2-4 min |
| Evaluate | 1-2 min |
| Fix (per failed task) | 1-10 min |
| Analyst review | 1-3 min |
| UAT execution (all) | 5-15 min |
| Total (9 epics + UAT) | ~45-120 min |

## Related Concepts

- [Fast Track Architecture](../architecture/fast-track-architecture.md)
- [Sprint Development Workflow](./sprint-development-workflow.md)
- [Watchdog Timer System](../domain/watchdog-timer-system.md)
- [UAT Process](../domain/uat-process.md)
- [Model Configuration](../architecture/model-configuration.md)
