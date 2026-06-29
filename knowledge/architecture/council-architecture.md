---
type: Architecture
title: Networked Council Architecture
description: Networked request/response council where Pi agents discover members, select by metadata, and exchange async work over a Bun HTTP/SSE hub.
resource: ./extensions/council.ts
tags: [pi-extensions, architecture, council, networked, hub, sse, async, discovery]
timestamp: 2026-06-29T15:00:00Z
status: active
---

# Networked Council Architecture

A networked request/response council for multiple Pi agents. The first agent in a project auto-starts a local council hub when needed; additional agents join the same project and advertise metadata so the questioner can choose the best member for each task.

## Hub Server

The council hub (`scripts/council-server.ts`) is a Bun HTTP/SSE server. By default, the first `council` agent auto-starts the hub on `127.0.0.1:48201` when no server is registered for the project. If the port is busy, it falls back to an OS-assigned port and writes the actual URL to `~/.pi/council/projects/<project>/server.json`.

## Member Discovery

Agents advertise lightweight metadata via CLI flags:

```bash
pi -e extensions/council.ts --name net-alice --project council-uat \
  --tags planner --capabilities planning,review --status "review-ready"
```

`council_list` returns members with name, model, purpose, status, tags, capabilities, and context usage.

## Message Lifecycle

Messages pass through stable states:
- `queued` — hub accepted, receiver not active yet
- `running` — receiver stream handed the prompt
- `complete` — response available
- `error` — message failed
- `expired` / `timeout` — TTL exceeded

## Async vs Synchronous

`council_send` is async by default — returns as soon as the hub accepts the message, terminates the follow-up LLM turn, and later delivers the reply back to the sender session. Use `synchronous=true` with `council_await` only when the user explicitly asks for blocking behavior.

## Response Modes

- `agent` (default) — sender agent handles the reply without the human answering for it
- `notify` — human should read/respond
- `none` — fire-and-forget

## Security

- Bearer token authenticates to the hub (`PI_COUNCIL_AUTH_TOKEN`)
- Hub issues per-agent session secrets on registration
- Session secret required for send, heartbeat, response, SSE, and delete operations
- One token holder cannot perform lifecycle operations as another registered session

## Mediator/Orchestrator Pattern

A third Pi agent can act as mediator, using `council_list` to pick members by purpose/tags/capabilities, then `council_send` to ask each. The orchestrator's session memory becomes the mediator's working record (not a peer-shared blackboard).

## Related Concepts

- [Council Extension](../components/council-extension.md)
- [Comms Deployment](../process/comms-deployment.md)
- [Async Council Default](../decisions/async-council-default.md)
- [System Architecture](./system-architecture.md)
