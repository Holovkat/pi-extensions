---
type: State
title: Current Repo State
description: Current state of the pi-extensions repository — baseline extensions, blueprint, toolshed, council, pif hub/shell/SQLite persistence, and the live pif remediation candidate state as of 31 August 2026.
resource: ./README.md
tags: [pi-extensions, state, current, repo, status, roadmap, pif]
timestamp: 2026-08-31T05:17:19Z
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
- Tracker precursor sprint #163–#166 (repo-synced Kanban tracker panel v0.1: sprint, hub sync layer, board widget, verification) is historical shipped context and no longer the active planning surface for this snapshot.

### pif App Builder Remediation Snapshot (#160, 31 August 2026)
- Tested code candidate: `3bc8e1fc` on `codex/pif-app-builder-154`; the final documentation handoff does not change that built code revision.
- Canonical requirements remain GitHub #158/#159/#160. There are 27 native remediation children: 24 implementation tasks in Review and owner-gated #204/#206/#212 blocked. #215 and #217 have final rebuilt UI evidence.
- Both actual artifacts launch and obtain real answers using the existing native Pi profile. Installed stock passed valid New Session, Send, Steer, Abort/recovery, replay and widget toggles. Export passed Settings-home restart, a tool response, and widget toggles. Both signed bundles remained byte-for-byte unchanged after the checks.
- Stock is installed at `/Applications/pif.app`, left at the clean project picker as PID 52706. Export `/tmp/pif160-ui-31x_h8mg/build/UI Workflow Check.app` was normally quit after testing. This technical fixture does not establish Mercury sample acceptance or clean-machine authentication provisioning.
- Two combined gate attempts failed. Separate Node 63/63, clean analysis and Flutter 77/77 evidence exists on `4972a603`; final `3bc8e1fc` has eight passing focused transcript cases and live UI proof. No combined full gate has passed at tip.
- #160 remains blocked on the export support-boundary decision, approved Mercury sample/appearance work and final combined acceptance. Historical seven-task owner approvals (#154/#155/#156/#157/#178/#188/#189) are preserved.
- [Current report](../../docs/reviews/2026-08-31-remediation-verification.md) distinguishes final UI proof, earlier checks, operational incidents and remaining acceptance gaps. The dated baseline review is retained separately.

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
