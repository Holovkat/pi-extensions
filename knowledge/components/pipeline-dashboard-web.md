---
type: Component
title: Pipeline Control Center (Web)
description: Multi-page web application for monitoring and steering agents from a browser — SSE dashboard, interactive steer UI, and TCP control socket.
resource: ./bin/pipeline-dashboard-web
tags: [pi-extensions, component, web, dashboard, steer, sse, control-socket, browser]
timestamp: 2026-06-29T15:00:00Z
status: active
---

# Pipeline Control Center (Web)

**File:** `bin/pipeline-dashboard-web`
**Alias:** `pi-web`
**Port:** 3141 (web), 3142 (TCP control socket)

A multi-page web application for monitoring and steering agents from a browser.

## Pages

### Home (`/`)
Navigation cards linking to Dashboard and Steer pages.

### Dashboard (`/dashboard`)
Live SSE-powered view of pipeline state — same data as the terminal dashboard but rendered in HTML with the Claude/shadcn oklch theme. Supports dark/light toggle.

### Steer (`/steer`)
Interactive agent steering page:
- Active agent list (auto-refreshes every 3s)
- Message textarea with Steer / Follow-up / Abort buttons
- Live steer log via SSE showing command history

## Steering Flow

1. Browser POSTs to `/api/steer` with agent ID and message
2. Web server forwards over TCP control socket (port 3142) to `dev-pipeline.ts`
3. Extension writes the command as JSON to the agent's `proc.stdin` (pi RPC mode)
4. Pi interrupts the agent mid-execution and delivers the message
5. Agent responds to the steer before continuing

## Use Cases

- Tell a stuck builder to "focus only on the collision logic"
- Ask a fixer to "try a completely different approach"
- Abort a runaway agent that's rewriting the entire file

## TCP Control Socket (port 3142)

Programmatic interface for agent registration and command forwarding. The extension auto-connects on startup and re-registers agents on reconnect. If the web dashboard isn't running, steering still works via watchdog timers.

## Related Concepts

- [Pipeline State System](../architecture/pipeline-state-system.md)
- [Agent Subprocess Execution](../architecture/agent-subprocess-execution.md)
- [Pipeline Terminal Dashboard](./pipeline-dashboard.md)
- [Watchdog Timer System](../domain/watchdog-timer-system.md)
