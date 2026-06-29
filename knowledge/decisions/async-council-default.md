---
type: Decision
title: Async Council Send by Default
description: Decision that council_send is async by default, with synchronous=true reserved for explicit blocking/chained behavior.
resource: ./docs/comms.md
tags: [pi-extensions, decision, council, async, synchronous, response-mode]
timestamp: 2026-06-29T15:00:00Z
status: active
---

# Decision: Async Council Send by Default

## Context

The council extension needs a default communication pattern between Pi agents. The choice between async and synchronous affects how agents coordinate and whether they block.

## Decision

`council_send` is async by default. The sender should not call `council_await` unless the user explicitly asks for synchronous/blocking/chained behavior.

## How It Works

- Async send returns as soon as the hub accepts or queues the message
- Terminates the follow-up LLM turn
- Later delivers `[council response from <member>]` back to the sender session when the member replies
- Default `response_mode="agent"` lets the sender agent handle the reply without the human answering for it
- If a model mistakenly calls `council_await` for an async send, the await returns immediately with guidance instead of blocking

## Response Modes

- `agent` (default) — sender agent handles the reply autonomously
- `notify` — human should read/respond
- `none` — fire-and-forget

## Rationale

- **Non-blocking** — agents can continue working while waiting for responses
- **Offline mailbox** — Alice can continue after seeing `queued`; Bob's response is relayed when he reconnects
- **Agent autonomy** — default `response_mode="agent"` means the human doesn't need to answer for the agent
- **Simplicity** — async is the common case; synchronous is the exception that requires opt-in

## Alternatives Rejected

- **Synchronous by default** — would block agents unnecessarily and complicate orchestrator workflows
- **Always synchronous with timeout** — adds complexity without benefit for the common case

## Related Concepts

- [Council Architecture](../architecture/council-architecture.md)
- [Council Extension](../components/council-extension.md)
- [Comms Deployment](../process/comms-deployment.md)
