---
type: Component
title: council Extension
description: Networked Pi-to-Pi council client over a Bun HTTP/SSE hub with member discovery, async request/response, and offline mailbox.
resource: ./extensions/council.ts
tags: [pi-extensions, component, council, networked, hub, async, discovery]
timestamp: 2026-06-29T15:00:00Z
status: active
---

# council Extension

**File:** `extensions/council.ts`
**Server:** `scripts/council-server.ts`
**Package:** `@holovkat/pi-council` via `npm run build` -> `dist/council-package`

A networked request/response council for multiple Pi agents. Drop-in successor to `coms.ts` whose substrate is a dedicated Bun HTTP/SSE hub. Both can be loaded together without identifier collision.

## Tools

| Tool | Purpose |
|------|---------|
| `council_list` | List available council members with name, model, purpose, status, tags, capabilities, context usage |
| `council_send` | Ask/assign work to a selected council member by exact name. Async by default |
| `council_get` | Non-blocking poll for a known `msg_id` |
| `council_await` | Blocking wait, only for sends created with `synchronous=true` |

## Slash Commands

| Command | Purpose |
|---------|---------|
| `/council` | Refresh the council panel |
| `/council --server` | Show hub URL, PID, queue/status counts, recent events |
| `/council --reconnect` | Re-register and reopen the event stream |
| `/council --project <name>` | View another project/council pool |

## Quick Start

```bash
pi --no-extensions -e ./extensions/council.ts --name net-alice --project council-uat --tags planner
pi --no-extensions -e ./extensions/council.ts --name net-bob --project council-uat --tags implementer
```

The first agent auto-starts a localhost hub on port 48201. Use `council_list` first, then `council_send` with the exact member name.

## Defaults

- `council_send` is async by default
- Default `response_mode="agent"` lets the sender agent handle replies without the human
- Environment variables: `PI_COUNCIL_*` for host, port, project, auth token, limits, autostart

## Related Concepts

- [Council Architecture](../architecture/council-architecture.md)
- [Comms Deployment](../process/comms-deployment.md)
- [Async Council Default](../decisions/async-council-default.md)
