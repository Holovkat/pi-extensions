---
type: State
title: Current Repo State
description: Current state of the pi-extensions repository — baseline extensions, blueprint, toolshed, council, and roadmap status as of June 2026.
resource: ./README.md
tags: [pi-extensions, state, current, repo, status, roadmap]
timestamp: 2026-06-29T15:00:00Z
status: active
---

# Current Repo State

## Baseline Extensions

- `req-qa` and `dev-pipeline` remain the baseline discovery and delivery workflow extensions.
- `pi-blueprint.ts` is the current GitHub-backed planning cockpit, with transcript search, alignment checks, issue rebuilds, asset sync, and a dedicated web mirror.
- `pi-toolshed.ts` is the current card/workspace shell, with frontier packets, workspace presets, quick actions, and blueprint-aware web surfaces.
- `council.ts` is the networked Pi-to-Pi council layer: agents discover council members, select by purpose/tags/capabilities, and exchange async request/response work over `scripts/council-server.ts`.

## Asset Management

Blueprint assets are committed in `agents/pi-blueprint/` and `skills/pi-blueprint/`; use `/blueprint-sync-assets` to mirror them into a project-local `.pi` runtime.

## Roadmap Status

### Pi-to-Pi Comms (Complete)
- Comms v1.0-v2.0: production approved / release complete
- Includes local coms, networked council, packaging, deployment profiles

### Pi Builder (Planned)
- `pi-builder` does not exist yet on master
- Planned as a task-first execution engine alongside `dev-pipeline`
- 7-phase roadmap: spec recovery, extension standup, task-first intake, warm builder, narrow review/testing, sync/stop, end-to-end pilots
- Complexity gate: reject tasks above 5/10 before execution

### Pi Council Mediation (Planned)
- `pi-council` is a mediator/orchestrator layer above local coms and networked council
- Will use an explicit lightweight JSONL blackboard for shared collaboration memory
- 6 tasks across extension shell, blackboard tools, registry, mediated rounds, records, and documentation

## Supporting Extensions

- `themeMap.ts` — maps extensions to default themes
- `theme-cycler.ts` — runtime theme switching
- `ollama-provider.ts` — local and cloud-proxied Ollama models
- `apfel-provider.ts` — Apple FoundationModels via `apfel --serve`

## Related Concepts

- [System Architecture](../architecture/system-architecture.md)
- [Pi-Blueprint Extension](../components/pi-blueprint-extension.md)
- [Pi-Toolshed Extension](../components/pi-toolshed-extension.md)
- [Council Extension](../components/council-extension.md)
- [Comms Deployment](../process/comms-deployment.md)
