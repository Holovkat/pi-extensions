---
type: Decision
title: RPC Mode for Subprocesses
description: Decision to use pi's native RPC mode for agent communication, enabling mid-execution steering, session reuse, and structured JSON event streams.
resource: ./README.md
tags: [pi-extensions, decision, rpc, subprocess, stdin, stdout, steering]
timestamp: 2026-06-29T15:00:00Z
status: active
---

# Decision: RPC Mode for Subprocesses

## Context

Extensions need to spawn agents as subprocesses and communicate with them. The pi CLI offers multiple modes for agent execution.

## Decision

Use pi's native RPC mode (`--mode rpc`) for all agent subprocesses.

## How It Works

- stdin and stdout are piped
- Tasks sent via stdin as `{"type": "prompt", "message": "..."}` — not as positional args
- Output streams as JSON events (`message_update`, `agent_start`, `agent_end`, etc.)
- Agents can be steered mid-execution via `{"type": "steer", "message": "..."}`
- Agents can be aborted via `{"type": "abort"}`
- Session reuse via `--session <file> -c` retains context across calls

## Rationale

- **Mid-execution steering** — watchdog timers can interrupt agents to request yield summaries; users can steer from the web UI
- **Session reuse** — a dev agent keeps its conversation context across tasks, reducing repeated codebase scanning
- **Structured events** — JSON stream enables logging, dashboard updates, and process tracking
- **Process lifecycle control** — stdin.end() or keep-alive for follow-up messages

## Alternatives Rejected

- **JSON mode (`--mode json`)** — used by req-qa specialists for simpler one-shot calls, but lacks steering and session reuse
- **Positional arg prompt** — no way to steer mid-execution or send follow-ups

## Related Concepts

- [Agent Subprocess Execution](../architecture/agent-subprocess-execution.md)
- [Watchdog Timer System](../domain/watchdog-timer-system.md)
- [Pipeline State System](../architecture/pipeline-state-system.md)
- [Pipeline Dashboard Web](../components/pipeline-dashboard-web.md)
