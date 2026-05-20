# Pi-to-Pi Comms

`coms` and `council` provide a first-version Pi-to-Pi request/response workflow. One Pi agent sends a prompt to another Pi agent, then polls or awaits the receiver's final assistant response.

They are intentionally not chat rooms, DMs, or shared session memory. Use an orchestrator/mediator agent when you want coordinated multi-agent work.

## Tool surfaces

Local same-machine extension:

- `coms_list`
- `coms_send`
- `coms_get`
- `coms_await`
- `/coms`

Networked hub extension preferred council tools:

- `council_list`
- `council_send`
- `council_get`
- `council_await`
- `/council`

## Discovery-first usage

Agents should list peers/council members before the first send in a task:

- local `coms`: call `coms_list`, then use the exact returned name in `coms_send.target`
- networked council: call `council_list`, review each member's purpose/tags/capabilities/status/context, choose who can answer the question or complete the task, then use the exact returned name in `council_send.target`

Do not guess casual aliases, and do not use `msg_id`, thread/conversation names, model names, or display labels as targets. Once a fresh list is visible in the conversation, follow-up sends can reuse those exact peer names.

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

## Localhost `council` quick start

Start the first agent. If no hub is already registered for the project, the extension auto-starts an embedded localhost hub on `127.0.0.1:48201` by running `bun scripts/council-server.ts` in the background.

```bash
pi --no-extensions -e ./extensions/council.ts --name net-alice --project council-uat --tags planner --capabilities planning,review
```

Start additional agents normally; they discover the embedded hub from `~/.pi/council/projects/<project>/server.json`:

```bash
pi --no-extensions -e ./extensions/council.ts --name net-bob --project council-uat --tags implementer --capabilities coding,test
```

Manual hub startup is still supported when you want to choose host/port/token yourself:

```bash
PI_COUNCIL_PROJECT=council-uat PI_COUNCIL_PORT=48201 bun scripts/council-server.ts
```

In net-alice:

```text
Use council_list to inspect the council members. Then use council_send to ask net-bob: "Reply exactly NET-PONG".
```

Normal council sends are async; use `synchronous=true` and `council_await` only when the user explicitly wants a blocking/chained answer.

## Mediator/orchestrator workflow

A third Pi agent can act as mediator:

```bash
pi --no-extensions -e ./extensions/council.ts --name orchestrator --project council-uat --tags chair --capabilities orchestration
```

Prompt the orchestrator:

```text
Use council_list to inspect the council members. Pick the best members by purpose/tags/capabilities: ask alice a planning question and bob an implementation-risk question with council_send. Use async responses by default, or set synchronous=true only if you need to block before synthesis.
```

The orchestrator's Pi session memory becomes the mediator's working record. It is not a peer-shared blackboard; use explicit repo files, issues, or a future `pi-council` blackboard when all agents need shared durable memory.

## Lifecycle states

`*_get` returns a stable status for known messages:

- `queued` — the hub accepted the message but the receiver has no active stream yet, or the message is waiting in a name-addressed mailbox for that agent to return.
- `running` — the receiver stream has been handed the prompt and a response is expected.
- `complete` — a response is available.
- `error` — the message failed, including explicit receiver errors.
- `expired` / `timeout` — the sender waited too long or the message exceeded its TTL.

Use `*_get` when an orchestrator wants to poll several outstanding messages. Use `*_await` only for sends that explicitly set `synchronous=true`.

## Async/background sends

`council_send` is async by default: it returns as soon as the hub accepts or queues the message, terminates the follow-up LLM turn, and later delivers `[council response from <member>]` back to the sender session when the member replies. Do not call `council_await` for normal sends.

Async sends default to `response_mode="agent"`: the sender agent handles the council member reply itself. If Bob asks Alice a question, Alice should answer Bob with another `council_send` using Bob's name as `target`. The hub names the thread after the member names by default (for example `net-alice↔net-bob`); pass that value only as the optional `conversation_id` field when continuing a thread, never as `target`. The human does not need to answer for Alice. Use `response_mode="notify"` only when the human should read/respond, and `response_mode="none"` for fire-and-forget.

Default async example:

```text
Use council_send to ask net-bob: "Reply exactly ASYNC-PONG".
```

Synchronous/chained example:

```text
Use council_send with synchronous=true to ask net-bob: "Reply exactly SYNC-PONG". Then await the returned msg_id with council_await.
```

This is useful for offline mailbox flow: Alice can continue after seeing `queued`, and Bob's eventual response is relayed back into Alice's session after Bob reconnects and reads the message. If a model mistakenly calls `council_await` for an async send, the await call returns immediately with guidance instead of blocking.

If a receiver turn only runs tools or a tool/transport error such as a WebSocket error prevents final assistant text, the extension now nudges the receiver to recover and produce a final response instead of immediately returning `no assistant response captured`.

## Hub status

The `council` panel includes a hub status line with local URL, agent count, stream count, queue depth, running count, and the last server event kind. You can also ask an agent to run:

```text
/council --server
```

That reports the current hub PID/URL, queue statistics, and the most recent server events.

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

### Localhost `council`

Use the hub on `127.0.0.1` for multiple local terminals or tmux panes. By default, the first `council` agent auto-starts the hub on port `48201` when no server is registered for the project. If no `PI_COUNCIL_AUTH_TOKEN` is supplied on loopback, the server generates `server.secret.json` with mode `0600` under `~/.pi/council/projects/<project>/`.

Set `PI_COUNCIL_AUTOSTART=0` to disable embedded startup and require an explicit server process.

### LAN hub

For a LAN hub, set an explicit bearer token and bind host:

```bash
PI_COUNCIL_HOST=0.0.0.0 \
PI_COUNCIL_PORT=48201 \
PI_COUNCIL_PROJECT=my-project \
PI_COUNCIL_AUTH_TOKEN='<long-random-token>' \
bun scripts/council-server.ts
```

Agents connect with:

```bash
PI_COUNCIL_SERVER_URL=http://host:48201 \
PI_COUNCIL_AUTH_TOKEN='<long-random-token>' \
pi --no-extensions -e ./extensions/council.ts --name alice --project my-project
```

The bearer token authenticates to the hub. The hub also issues a per-agent session secret on registration and requires that secret for send, heartbeat, response, SSE, and delete operations so one token holder cannot perform lifecycle operations as another registered session.

### Remote hub / TLS

For remote networks, put the hub behind TLS and a reverse proxy. Do not expose a plain HTTP hub over the internet. Use long random `PI_COUNCIL_AUTH_TOKEN` values, rotate tokens after demos, and prefer private networks/VPNs when possible.

## Environment variables

Common server variables:

- `PI_COUNCIL_HOST`
- `PI_COUNCIL_PORT`
- `PI_COUNCIL_PROJECT`
- `PI_COUNCIL_PUBLIC_URL`
- `PI_COUNCIL_AUTH_TOKEN`
- `PI_COUNCIL_MESSAGE_TTL_MS`
- `PI_COUNCIL_MAX_INBOX`
- `PI_COUNCIL_MAX_PROMPT_BYTES`
- `PI_COUNCIL_MAX_RESPONSE_BYTES`
- `PI_COUNCIL_MAX_SCHEMA_BYTES`
- `PI_COUNCIL_LOG_HEARTBEAT=1`
- `PI_COUNCIL_LOG_PAYLOADS=1` — explicit debug mode for prompt previews; off by default.

Client/autostart variables:

- `PI_COUNCIL_SERVER_URL`
- `PI_COUNCIL_AUTH_TOKEN`
- `PI_COUNCIL_PROJECT`
- `PI_COUNCIL_AUTOSTART=0` — disable first-agent hub startup.
- `PI_COUNCIL_PORT` — embedded hub port; defaults to `48201`.
- `PI_COUNCIL_EMBEDDED_HOST` — embedded hub host; defaults to `127.0.0.1`.
- `PI_COUNCIL_ASYNC_NOTIFY_GRACE_MS` — delay before displaying async responses, allowing an immediate `*_await` call to suppress duplicate notifications; defaults to `1200`.
- `PI_COUNCIL_INBOUND_RESPONSE_GRACE_MS` — time to recover/nudge a receiver when no assistant text is captured after tool-only or failed-tool turns; defaults to `120000`.

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
2. Localhost council/council: hub starts, net-alice uses `council_list`, picks net-bob, sends `NET-PONG` with `council_send`, and receives the async reply. For synchronous UAT, set `synchronous=true` and use `council_await`.
3. Reconnect/offline mailbox: stop a receiver, send to its agent name, restart the receiver with the same name/project, and confirm the queued message is popped automatically and moves to `running` then `complete`.
4. Safety: a forged session secret cannot send/delete/respond for another `council` session.
5. Redaction: hub logs show ids, agent names, sizes, hops, and statuses, not prompt bodies, unless `PI_COUNCIL_LOG_PAYLOADS=1` is set.
6. Packaging: `npm run build` creates `dist/council-package`; `pi install /absolute/path/to/dist/council-package` exposes `coms` and `council` entrypoints.
