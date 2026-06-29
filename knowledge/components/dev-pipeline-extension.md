---
type: Component
title: dev-pipeline Extension
description: Command-driven sprint development lifecycle extension with Fast Track and 3-Wave modes, compliance scoring, watchdog timers, and automated UAT.
resource: ./extensions/dev-pipeline.ts
tags: [pi-extensions, component, dev-pipeline, sprint, fast-track, three-wave, compliance, uat]
timestamp: 2026-06-29T15:00:00Z
status: active
---

# dev-pipeline Extension

**File:** `extensions/dev-pipeline.ts` (~3630 lines)
**Alias:** `pi-dev`
**Theme:** midnight-ocean

A command-driven sprint development lifecycle with two execution modes. Both read the checklist produced by req-qa and drive tasks through development, compliance, and quality gates.

## Dual-Mode Architecture

- **Fast Track (default)** — `/pipeline-start`: single model builds, stronger model evaluates, surgical fixes with watchdog timers, automated Playwright UAT.
- **3-Wave** — `/pipeline-start --multiwave`: council architecture, 3-step prototype build, sequential dev sprint with compliance scoring.

## Shared Infrastructure

Both modes share:
- Checklist parser (handles both `### Phase N:` and `## Epic N:` headers, multiple task formats)
- GitHub issue enrichment (`gh issue view` for full acceptance criteria)
- GitHub issue learnings (structured comments, read back on restart)
- RPC agent steering (stdin piped, mid-execution steering)
- Watchdog timers (per-depth timeout with steer-for-summary)
- Auto-chaining (epics chain automatically with branch creation)
- Tmux log panes (live agent output, auto-closing)
- Pipeline state file (`pipeline-state.json` for dashboard)
- Branch management (each epic gets its own branch)
- Checkpoint system (save/resume for long-running pipelines)
- Configurable models (`/pipeline-config`)

## Commands

| Command | Description |
|---------|-------------|
| `/pipeline-start` | Initialize pipeline in Fast Track mode (default) |
| `/pipeline-start --multiwave` | Initialize pipeline in 3-Wave mode |
| `/pipeline-next` | Run next phase (uses active mode) |
| `/pipeline-approve` | Approve UAT results (Fast Track) |
| `/pipeline-reject` | Reject UAT with notes, loop back (Fast Track) |
| `/pipeline-reset` | Full reset — checkout main, delete branches, uncheck, reopen |
| `/pipeline-end` | UAT sign-off, squash merge to main, push, clean up |
| `/pipeline-config` | Configure model assignments for each role |
| `/pipeline-status` | Show current pipeline progress |
| `/pipeline-dashboard` | Open live dashboard in tmux pane |
| `/pipeline-logs` | Open all agent logs in tmux panes |
| `/pipeline-watch <name>` | Tail a specific agent's log |
| `/pipeline-close-panes` | Close all tmux/dashboard panes |

## Related Concepts

- [Fast Track Architecture](../architecture/fast-track-architecture.md)
- [Three-Wave Architecture](../architecture/three-wave-architecture.md)
- [Pipeline State System](../architecture/pipeline-state-system.md)
- [Model Configuration](../architecture/model-configuration.md)
- [Sprint Development Workflow](../process/sprint-development-workflow.md)
