---
type: Architecture
title: Agent Subprocess Execution Model
description: How extensions spawn pi CLI agents as RPC-mode subprocesses with stdin/stdout piping, mid-execution steering, and session reuse.
resource: ./README.md
tags: [pi-extensions, architecture, rpc, subprocess, steering, session-reuse]
timestamp: 2026-06-29T15:00:00Z
status: active
---

# Agent Subprocess Execution Model

Both `req-qa` and `dev-pipeline` spawn agents as pi CLI subprocesses using pi's native RPC mode.

## Spawn Pattern

```
pi --mode rpc --no-extensions --no-skills --system-prompt '...'
```

- stdin and stdout are piped
- The task is sent via stdin as `{"type": "prompt", "message": "..."}` — not as a positional arg
- Output streams as JSON events (`message_update`, `agent_start`, `agent_end`, `tool_execution_start`, etc.)
- All output is logged to `.pi/pipeline-logs/<session-key>.log`

## RPC Commands

| Command | Effect |
|---------|--------|
| `{"type": "prompt", "message": "..."}` | Send initial task (on spawn) |
| `{"type": "steer", "message": "..."}` | Interrupt agent, deliver new instructions |
| `{"type": "follow_up", "message": "..."}` | Continue conversation after `agent_end` (if keepAlive) |
| `{"type": "abort"}` | Cancel current execution |

## Session Reuse

Uses `--session <file> -c` so agents retain conversation context across calls within a phase. A dev agent called for task 1.1 keeps its context when called again for task 1.2, reducing repeated codebase scanning.

## RPC Lifecycle

`prompt` -> `agent_start` -> `turn_start` -> `message_start` -> `message_update` (text deltas) -> `message_end` -> `tool_execution_start/end` (if tools used) -> `turn_end` -> `agent_end` -> `stdin.end()` (or keep alive for follow-up).

## Steering Sources

1. **Watchdog timer** — automatic yield summary request at timeout
2. **Web UI** — user types a message on the `/steer` page
3. **Control socket** — programmatic steering from any TCP client (port 3142)

## Process Tracking

Agents are tracked in the `agentProcesses` map by session key for steering and monitoring. The extension auto-connects to the control socket on startup and re-registers agents on reconnect.

## Related Concepts

- [Pipeline State System](./pipeline-state-system.md)
- [Watchdog Timer System](../domain/watchdog-timer-system.md)
- [RPC Mode for Subprocesses](../decisions/rpc-mode-for-subprocesses.md)
- [Pipeline Dashboard Web](../components/pipeline-dashboard-web.md)
