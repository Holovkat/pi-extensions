---
type: Process
title: "Pi-to-Pi Comms Hardening Roadmap"
description: Epic #93 roadmap for vendoring and hardening first-version Pi-to-Pi request/response communication, delivered across four sprints through production approval.
resource: ./docs/comms.md
tags: [pi-extensions, comms, council, github, issues]
timestamp: 2026-06-29T15:00:00Z
status: active
issue_refs: [93, 94, 95, 96, 97]
---

# Pi-to-Pi Comms Hardening Roadmap

## Overview

Epic #93 brought the first-version Pi-to-Pi communication paradigm into this repo and hardened it without changing its core shape: one Pi agent sends a prompt to a peer Pi agent, then polls or awaits the peer's final assistant response. The upstream prototype from `disler/pi-vs-claude-code` was vendored as a local copy and evolved in-repo only. All four sprints shipped, passed UAT and QA, and were production-deployed and production-approved.

**Epic issue:** #93
**Labels:** epic, comms, uat-approved, qa-approved, production-deployed, production-approved
**Closed:** 2026-05-20

## Deliverables

The epic produced three extension artefacts:

- `extensions/coms.ts` — same-machine peer discovery and request/response over local IPC (Unix socket / named pipe).
- `extensions/council.ts` — networked request/response client over the Bun hub server.
- `scripts/council-server.ts` — the networked hub server for council member discovery and message routing.
- `docs/comms.md` — deployment profiles, security notes, lifecycle states, async behavior, and UAT scenarios.
- Package: `@holovkat/pi-council` via `npm run build` producing `dist/council-package`.

The four-tool request/response model is preserved across both local and networked surfaces: `council_list` (discover peers), `council_send` (ask/assign work), `council_get` (non-blocking poll), `council_await` (blocking wait for synchronous sends).

## Sprint Progression

### Sprint v1.0 Hardening — #94

**Focus:** Turn-bound response capture, queued delivery replay, pending reply TTL, truncation/body caps, path/lifecycle hardening.

**Tasks delivered:**
- #98 — Add first-version Pi-to-Pi comms baseline (vendored local and networked extension surfaces, complexity 4.0)
- #99 — Bind inbound replies to the triggered assistant turn (response capture ignores stale messages, complexity 4.5)
- #100 — Replay queued coms-net messages on reconnect (flush queued messages on SSE re-register, complexity 4.0)
- #101 — Bound pending replies and payload sizes (TTL cleanup, size limits with truncation, complexity 4.0)
- #102 — Harden registry paths and shutdown lifecycle (path traversal guards, idempotent shutdown, complexity 3.5)

**Outcomes:** Core local and networked extension surfaces present. Receiver responses bound to correct inbound-triggered turn. Queued network messages replay after reconnect. Pending reply state bounded. Registry paths and shutdown lifecycle hardened.

### Sprint v1.1 Safety — #95

**Focus:** Per-agent ownership, spoofing guardrails, redacted audit logging, abuse-case tests.

**Tasks delivered:**
- #103 — Add per-agent ownership to coms-net (session-bound credential for lifecycle operations, complexity 4.5)
- #104 — Harden local coms spoofing boundary (local envelope validation, trust-boundary docs, complexity 4.0)
- #105 — Redact audit logging and add abuse tests (no prompt bodies in default logs, abuse coverage, complexity 3.5)

**Outcomes:** Networked agents cannot impersonate other sessions. Local comms trust boundary explicit and documented. Prompt bodies not logged by default. Security abuse tests cover spoofing, oversized payloads, and unauthorized lifecycle operations.

### Sprint v1.2 Ergonomics — #96

**Focus:** Peer metadata, lifecycle states in tool output, operator documentation.

**Tasks delivered:**
- #106 — Add peer status, tags, and capabilities metadata (CLI flags/config for metadata, complexity 3.5)
- #107 — Expose message lifecycle states in get/list/widget (queued/delivered/running/complete/error/expired, complexity 3.5)
- #108 — Document first-version workflows and non-goals (same-machine and networked quick starts, non-goals, complexity 2.5)

**Outcomes:** Peer metadata includes useful status/tags/capabilities. List/widget output helps agents choose the right peer. `*_get` reports useful lifecycle states. Operator docs explain first-version workflows and non-goals with planner/reviewer/coder examples.

### Sprint v2.0 Packaging and Deployment — #97

**Focus:** Installable Pi package, deployment profile documentation, optional structured-response validation.

**Tasks delivered:**
- #109 — Package comms as an installable Pi package (package manifest, build output, `pi install` path, complexity 4.0)
- #110 — Document deployment profiles and optional structured responses (local/LAN/remote/TLS profiles, complexity 3.5)

**Outcomes:** Package manifest and dist entrypoints exist. Local, LAN, and remote-hub deployment notes documented. Optional structured-response validation path specified. Smoke tests prove packaged install path.

## Non-goals (preserved throughout)

- Do not turn this into rooms, DMs, or cross-harness chat.
- Do not replicate all peer state across the network.
- Do not push routine presence/read events into model context.

## Definition of Done (all met)

- `coms` and `coms-net` (now `council`) retain the simple prompt/response API.
- Inbound replies are correlated to the correct triggered turn.
- Networked delivery survives temporary SSE disconnects.
- Security-sensitive logs and credentials do not expose prompt contents or cross-agent impersonation paths.
- Long-lived sessions do not leak unbounded pending reply state.
- The extension can be installed and documented as a Pi package.

## Complete Issue List

| Issue | Title | Sprint |
|-------|-------|--------|
| #93 | Epic: Pi-to-Pi comms request/response hardening roadmap | — |
| #94 | Sprint: comms v1.0 hardening | v1.0 |
| #95 | Sprint: comms v1.1 safety | v1.1 |
| #96 | Sprint: comms v1.2 ergonomics | v1.2 |
| #97 | Sprint: comms v2.0 packaging and deployment | v2.0 |
| #98 | Task: add first-version Pi-to-Pi comms baseline | v1.0 |
| #99 | Task: bind inbound replies to the triggered assistant turn | v1.0 |
| #100 | Task: replay queued coms-net messages on reconnect | v1.0 |
| #101 | Task: bound pending replies and payload sizes | v1.0 |
| #102 | Task: harden registry paths and shutdown lifecycle | v1.0 |
| #103 | Task: add per-agent ownership to coms-net | v1.1 |
| #104 | Task: harden local coms spoofing boundary | v1.1 |
| #105 | Task: redact audit logging and add abuse tests | v1.1 |
| #106 | Task: add peer status, tags, and capabilities metadata | v1.2 |
| #107 | Task: expose message lifecycle states in get/list/widget | v1.2 |
| #108 | Task: document first-version workflows and non-goals | v1.2 |
| #109 | Task: package comms as an installable Pi package | v2.0 |
| #110 | Task: document deployment profiles and optional structured responses | v2.0 |
