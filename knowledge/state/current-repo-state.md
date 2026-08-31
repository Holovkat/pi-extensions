---
type: State
title: Current Repo State
description: Current state of the pi-extensions repository — baseline extensions, blueprint, toolshed, council, pif hub/shell/SQLite persistence, and the live pif remediation candidate state as of 31 August 2026.
resource: ./README.md
tags: [pi-extensions, state, current, repo, status, roadmap, pif]
timestamp: 2026-08-31T03:32:02Z
status: active
---

# Current Repo State

## Baseline Extensions

- `req-qa` and `dev-pipeline` remain the baseline discovery and delivery workflow extensions.
- `pi-blueprint.ts` is the current GitHub-backed planning cockpit, with transcript search, alignment checks, issue rebuilds, asset sync, and a dedicated web mirror.
- `pi-toolshed.ts` is the current card/workspace shell, with frontier packets, workspace presets, quick actions, and blueprint-aware web surfaces.
- `council.ts` is the networked Pi-to-Pi council layer: agents discover council members, select by purpose/tags/capabilities, and exchange async request/response work over `scripts/council-server.ts`.

## pif — Flutter macOS Agentic IDE Shell

The pif epic (#120, closed) delivered a native macOS shell on top of the pi CLI:

- **Hub** (`extensions/pif.ts` + `pif-shared.ts`) owns sessions (host + `pi --mode rpc` children), the widget registry/catalog/layout, model configuration against `~/.pi/agent/models.json`, and health state.
- **Shell** (`pif/`, Flutter macOS app) is a stateless renderer over a docking shell; widgets live in `pif/lib/widgets/<id>/` with `widget.yaml` manifests, available-but-uninstalled sources in `pif/catalog/`.
- **Bus**: token-authenticated WebSocket on `ws://127.0.0.1:31415/pif` (protocol v1 envelopes, channels `session/widget/store/shell/models`), plus a Unix control socket at `.pi/pif/control.sock`.
- **Persistence**: per-project SQLite session store at `.pi/pif/sessions.db` via `node:sqlite` (JSON fallback); child sessions reload as read-only ended sessions when a project is reopened. Resume of live host sessions remains terminal-side.
- **Distribution**: `scripts/install-pif.sh` installs globally to `~/.pi/pif/app` + `~/.pi/agent/extensions`; `scripts/build-pif-app.sh` produces a self-contained ~290MB `.app` bundling Node.js + pi CLI + pif extensions + the Flutter app.

## Asset Management

Blueprint assets are committed in `agents/pi-blueprint/` and `skills/pi-blueprint/`; use `/blueprint-sync-assets` to mirror them into a project-local `.pi` runtime.

## Roadmap Status

### Pi-to-Pi Comms (Complete)
- Comms v1.0-v2.0: production approved / release complete
- Includes local coms, networked council, packaging, deployment profiles

### pif App Builder (#152, Active)
- Epic #152 "pif app builder" is open and active: agentic applications composed on the pif foundation.
- Tracker precursor sprint #163–#166 (repo-synced Kanban tracker panel v0.1: sprint, hub sync layer, board widget, verification) is open but planned ahead of execution.

### pif App Builder Remediation Snapshot (#160 / #205)
- Live branch: `codex/pif-app-builder-154` at `f4bfe769`.
- Review slices on branch: `#191`, `#192`, `#193`, `#194`, `#195`, `#196`, `#197`, `#198`, `#199`, `#200`, `#202`, `#203`, `#208`, `#210`, `#214`.
- Supporting harness commits: `6891a1b3`, `a2172be8`, `a010db15`.
- `#160` remains the blocked final verification ticket; focused Flutter, Node, and native UI diagnostics exist, but `complete_gate_runs = 0` and the final `npm run test:pif`, install/launch, export/signature/provider, and clean-candidate acceptance evidence remain pending.
- Owner-gated rows `#204`, `#206`, and `#212` remain blocked. Coordination items `#187` and `#211` are in progress; `#201`, `#205`, `#207`, and `#209` are still todo.
- The historical seven-task approvals (`#154`, `#155`, `#156`, `#157`, `#178`, `#188`, `#189`) remain preserved and are not treated as final candidate acceptance.
- The live handoff records now point at the current review slice set in `knowledge/inbox/index.md` and the corrective log entry in `knowledge/log.md`.

### pif Remediation Wave 2 (#170, In Flight)
- Current sprint: crash handling, data integrity around persistence, auth containment on the bus, performance, and documentation.
- Deliverable C1 of this wave is `docs/PI_EXTENSIONS_ARCHITECTURE_RUNBOOK.html`, the verified architecture/environment runbook (sections 01–13).

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
- Provider bridges in `extensions/` (11 files): ollama, ollama-manager, lmstudio, llamasrv, apfel, gemini, glm, qwen, bailian, inception, factory-droid

## Related Concepts

- [System Architecture](../architecture/system-architecture.md)
- [Pi-Blueprint Extension](../components/pi-blueprint-extension.md)
- [Pi-Toolshed Extension](../components/pi-toolshed-extension.md)
- [Council Extension](../components/council-extension.md)
- [Comms Deployment](../process/comms-deployment.md)
