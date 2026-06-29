---
type: Process
title: Comms Deployment Profiles
description: Deployment profiles for Pi-to-Pi comms — local coms (IPC), localhost council (auto-start hub), LAN hub (bearer token), and remote/TLS hub.
resource: ./docs/comms.md
tags: [pi-extensions, process, comms, council, deployment, lan, tls, security, profiles]
timestamp: 2026-06-29T15:00:00Z
status: active
---

# Comms Deployment Profiles

`coms` and `council` provide first-version Pi-to-Pi request/response communication. They are intentionally not chat rooms, DMs, or shared session memory.

## Local `coms` (Same-Machine IPC)

Use `extensions/coms.ts` when all agents run as the same local user on the same machine. Uses Unix sockets on POSIX and named pipes on Windows.

- Security boundary: same-user local IPC only
- Cannot fully defend against a malicious same-user process
- Do not use as a privilege boundary

## Localhost `council` (Auto-Start Hub)

The first `council` agent auto-starts the hub on `127.0.0.1:48201` when no server is registered. Falls back to OS-assigned port if busy. Generates `server.secret.json` (mode 0600) if no auth token supplied.

Set `PI_COUNCIL_AUTOSTART=0` to disable embedded startup and require an explicit server process.

## LAN Hub

```bash
PI_COUNCIL_HOST=0.0.0.0 \
PI_COUNCIL_PORT=48201 \
PI_COUNCIL_PROJECT=my-project \
PI_COUNCIL_AUTH_TOKEN='<long-random-token>' \
bun scripts/council-server.ts
```

Agents connect with `PI_COUNCIL_SERVER_URL` and `PI_COUNCIL_AUTH_TOKEN`. Bearer token authenticates to hub. Hub issues per-agent session secrets so one token holder cannot act as another session.

## Remote Hub / TLS

Put the hub behind TLS and a reverse proxy. Do not expose plain HTTP over the internet. Use long random tokens, rotate after demos, prefer private networks/VPNs.

## Environment Variables

Server: `PI_COUNCIL_HOST`, `PI_COUNCIL_PORT`, `PI_COUNCIL_PROJECT`, `PI_COUNCIL_PUBLIC_URL`, `PI_COUNCIL_AUTH_TOKEN`, `PI_COUNCIL_MESSAGE_TTL_MS`, `PI_COUNCIL_MAX_INBOX`, `PI_COUNCIL_MAX_PROMPT_BYTES`, `PI_COUNCIL_MAX_RESPONSE_BYTES`, `PI_COUNCIL_LOG_HEARTBEAT`, `PI_COUNCIL_LOG_PAYLOADS`.

Client: `PI_COUNCIL_SERVER_URL`, `PI_COUNCIL_AUTH_TOKEN`, `PI_COUNCIL_PROJECT`, `PI_COUNCIL_AUTOSTART`, `PI_COUNCIL_PORT`, `PI_COUNCIL_EMBEDDED_HOST`, `PI_COUNCIL_ASYNC_NOTIFY_GRACE_MS`, `PI_COUNCIL_INBOUND_RESPONSE_GRACE_MS`.

## When Not to Use

Do not use for: chat rooms, broadcast presence, shared live session mutation, security boundaries between hostile local processes, or durable multi-agent project memory by itself.

## Related Concepts

- [Council Architecture](../architecture/council-architecture.md)
- [Council Extension](../components/council-extension.md)
- [Async Council Default](../decisions/async-council-default.md)
