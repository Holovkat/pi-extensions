# Pi-to-Pi Comms

`coms` and `coms-net` provide a first-version Pi-to-Pi request/response workflow. One Pi agent sends a prompt to another Pi agent, then polls or awaits the receiver's final assistant response.

They are intentionally not chat rooms, DMs, or shared session memory. Use an orchestrator/mediator agent when you want coordinated multi-agent work.

## Tool surfaces

Local same-machine extension:

- `coms_list`
- `coms_send`
- `coms_get`
- `coms_await`
- `/coms`

Networked hub extension:

- `coms_net_list`
- `coms_net_send`
- `coms_net_get`
- `coms_net_await`
- `/coms-net`

## Same-machine quick start

Start two Pi terminals in the same checkout:

```bash
pi --no-extensions -e ./extensions/coms.ts --name alice --project comms-uat --tags planner --capabilities planning,review
pi --no-extensions -e ./extensions/coms.ts --name bob --project comms-uat --tags implementer --capabilities coding,test
```

In Alice:

```text
Use coms_list. Then use coms_send to send bob: "Reply exactly LOCAL-PONG". Await the returned msg_id with coms_await.
```

Bob should receive the injected prompt and reply normally. Bob should not call `coms_send` to answer an inbound request; the extension captures Bob's normal assistant response and returns it to Alice.

## Localhost `coms-net` quick start

Start the hub:

```bash
PI_COMS_NET_PROJECT=comms-net-uat PI_COMS_NET_PORT=48201 bun scripts/coms-net-server.ts
```

Start agents:

```bash
pi --no-extensions -e ./extensions/coms-net.ts --name net-alice --project comms-net-uat --tags planner --capabilities planning,review
pi --no-extensions -e ./extensions/coms-net.ts --name net-bob --project comms-net-uat --tags implementer --capabilities coding,test
```

In net-alice:

```text
Use coms_net_list. Then use coms_net_send to send net-bob: "Reply exactly NET-PONG". Await the returned msg_id with coms_net_await.
```

## Mediator/orchestrator workflow

A third Pi agent can act as mediator:

```bash
pi --no-extensions -e ./extensions/coms-net.ts --name orchestrator --project comms-net-uat --tags chair --capabilities orchestration
```

Prompt the orchestrator:

```text
Use coms_net_list to find alice and bob. Send alice a planning question and bob an implementation-risk question. Await both msg_ids, then synthesize the result.
```

The orchestrator's Pi session memory becomes the mediator's working record. It is not a peer-shared blackboard; use explicit repo files, issues, or a future `pi-council` blackboard when all agents need shared durable memory.

## Lifecycle states

`*_get` returns a stable status for known messages:

- `queued` — the hub accepted the message but the receiver has no active stream yet.
- `running` — the receiver stream has been handed the prompt and a response is expected.
- `complete` — a response is available.
- `error` — the message failed, including explicit receiver errors.
- `expired` / `timeout` — the sender waited too long or the message exceeded its TTL.

Use `*_await` when you want to block for the reply. Use `*_get` when an orchestrator wants to poll several outstanding messages.

## Metadata

Agents can advertise lightweight selection metadata:

```bash
--status "review-ready" --tags reviewer,backend --capabilities code-review,typescript
```

`*_list` returns this metadata in its details object and renders a compact subset in the widget/list output. This borrows the useful metadata/status idea from `agent-comms` without adopting rooms or chat semantics.

## Deployment profiles

### Local `coms`

Use `extensions/coms.ts` when all agents run as the same local user on the same machine. It uses Unix sockets on POSIX and named pipes on Windows.

Security boundary: local `coms` is same-user local IPC. It validates sender registry ownership where practical, but it cannot fully defend against a malicious same-user process with filesystem/socket access. Do not use local `coms` as a privilege boundary.

### Localhost `coms-net`

Use the hub on `127.0.0.1` for multiple local terminals or tmux panes. If no `PI_COMS_NET_AUTH_TOKEN` is supplied on loopback, the server generates `server.secret.json` with mode `0600` under `~/.pi/coms-net/projects/<project>/`.

### LAN hub

For a LAN hub, set an explicit bearer token and bind host:

```bash
PI_COMS_NET_HOST=0.0.0.0 \
PI_COMS_NET_PORT=48201 \
PI_COMS_NET_PROJECT=my-project \
PI_COMS_NET_AUTH_TOKEN='<long-random-token>' \
bun scripts/coms-net-server.ts
```

Agents connect with:

```bash
PI_COMS_NET_SERVER_URL=http://host:48201 \
PI_COMS_NET_AUTH_TOKEN='<long-random-token>' \
pi --no-extensions -e ./extensions/coms-net.ts --name alice --project my-project
```

The bearer token authenticates to the hub. The hub also issues a per-agent session secret on registration and requires that secret for send, heartbeat, response, SSE, and delete operations so one token holder cannot perform lifecycle operations as another registered session.

### Remote hub / TLS

For remote networks, put the hub behind TLS and a reverse proxy. Do not expose a plain HTTP hub over the internet. Use long random `PI_COMS_NET_AUTH_TOKEN` values, rotate tokens after demos, and prefer private networks/VPNs when possible.

## Environment variables

Common server variables:

- `PI_COMS_NET_HOST`
- `PI_COMS_NET_PORT`
- `PI_COMS_NET_PROJECT`
- `PI_COMS_NET_PUBLIC_URL`
- `PI_COMS_NET_AUTH_TOKEN`
- `PI_COMS_NET_MESSAGE_TTL_MS`
- `PI_COMS_NET_MAX_INBOX`
- `PI_COMS_NET_MAX_PROMPT_BYTES`
- `PI_COMS_NET_MAX_RESPONSE_BYTES`
- `PI_COMS_NET_MAX_SCHEMA_BYTES`
- `PI_COMS_NET_LOG_HEARTBEAT=1`
- `PI_COMS_NET_LOG_PAYLOADS=1` — explicit debug mode for prompt previews; off by default.

Client variables:

- `PI_COMS_NET_SERVER_URL`
- `PI_COMS_NET_AUTH_TOKEN`
- `PI_COMS_NET_PROJECT`

Local `coms` limits:

- `PI_COMS_MAX_PROMPT_BYTES`
- `PI_COMS_MAX_RESPONSE_BYTES`
- `PI_COMS_MAX_SCHEMA_BYTES`
- `PI_COMS_REPLY_RETENTION_MS`

## Structured responses

Both send tools accept an optional `response_schema`. The current MVP enforces size caps and requires the receiver output to be parseable JSON when a schema is present. Full JSON Schema validation is intentionally deferred; a future task can add TypeBox/AJV validation if operators need strict structured-response enforcement.

## When not to use this

Do not use this extension when you need:

- chat rooms or long-lived group conversations
- broadcast presence/read receipts in model context
- shared live Pi session mutation
- a security boundary between hostile local same-user processes
- durable multi-agent project memory by itself

For shared durable collaboration memory, use repo files/GitHub issues today or a future blackboard-style layer such as `pi-council`.

## UAT smoke checklist

1. Same-machine `coms`: Alice lists Bob, sends `LOCAL-PONG`, and awaits the reply.
2. Localhost `coms-net`: hub starts, net-alice lists net-bob, sends `NET-PONG`, and awaits the reply.
3. Reconnect: stop a receiver stream, send a message, reconnect receiver, and confirm the queued message moves to `running` then `complete`.
4. Safety: a forged session secret cannot send/delete/respond for another `coms-net` session.
5. Redaction: hub logs show ids, agent names, sizes, hops, and statuses, not prompt bodies, unless `PI_COMS_NET_LOG_PAYLOADS=1` is set.
6. Packaging: `npm run build` creates `dist/comms-package`; `pi install /absolute/path/to/dist/comms-package` exposes `coms` and `coms-net` entrypoints.
