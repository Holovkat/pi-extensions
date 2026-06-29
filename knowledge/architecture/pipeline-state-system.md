---
type: Architecture
title: Pipeline State System
description: The pipeline-state.json file, terminal and web dashboards, observer mode, and TCP control socket for agent steering.
resource: ./extensions/dev-pipeline.ts
tags: [pi-extensions, architecture, state, dashboard, observer-mode, control-socket, sse]
timestamp: 2026-06-29T15:00:00Z
status: active
---

# Pipeline State System

The dev-pipeline extension writes state to `.pi/pipeline-logs/pipeline-state.json` on every state change. This state file drives the terminal dashboard, web dashboard, and observer mode.

## State File Structure

The JSON includes:
- `ts` — timestamp
- `running` — whether pipeline is active
- `branch` — current git branch
- `currentPhase` — index of active epic
- `phases` — array of epic objects with name, task lists, scores, attempts, yields, analyst actions
- `log` — recent activity log entries (color-coded)
- `activeAgent` — name, model, and hint of the currently running agent

Each task entry includes: id, title, status (passed/building/scoring/failed/pending), complianceScore, attempts, yields, and lastAnalystAction.

## Observer Mode

When a second `pi-dev` terminal is opened while a pipeline is already running:
- The widget polls `pipeline-state.json` every 3 seconds
- All mutating commands are blocked (`/pipeline-start`, `/pipeline-next`, `/pipeline-reset`, `/pipeline-approve`, `/pipeline-reject`, `/pipeline-end`)
- Read-only commands still work
- Automatically exits observer mode when the running pipeline finishes

## TCP Control Socket (port 3142)

Programmatic interface for agent registration and command forwarding:
- Extension registers agents on spawn: `{"type":"register","agentId":"...",...}`
- Web UI POSTs steer commands; socket forwards to the extension
- Extension writes commands to the agent's `proc.stdin`
- Extension auto-connects on startup and re-registers on reconnect

If the web dashboard isn't running, steering still works via watchdog timers directly through stdin.

## Checkpoint System

Save/resume support for long-running pipelines. State can be reconstructed from GitHub issue comments on restart — learnings survive crashes.

## Related Concepts

- [Agent Subprocess Execution](./agent-subprocess-execution.md)
- [Pipeline Dashboard](../components/pipeline-dashboard.md)
- [Pipeline Dashboard Web](../components/pipeline-dashboard-web.md)
- [Watchdog Timer System](../domain/watchdog-timer-system.md)
