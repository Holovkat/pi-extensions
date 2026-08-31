---
type: State
title: Current Repo State
description: Current state of the pi-extensions repository — baseline extensions, blueprint, toolshed, council, pif hub/shell/SQLite persistence, and the live pif remediation candidate state as of 31 August 2026.
resource: ./README.md
tags: [pi-extensions, state, current, repo, status, roadmap, pif]
timestamp: 2026-08-31T09:18:03Z
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
- Tested and pushed code candidate: `dc45ff40` on `codex/pif-app-builder-154`. Documentation handoff does not change the built revision.
- The earlier E2E checkpoint had 27 native remediation children. Following the owner requirement extension below, #160 now has 33: 24 in Review, seven To Do, and #206/#212 blocked on independent sample design/appearance approval. Canonical requirements remain #158/#159/#160 with the explicit #152 extension.
- Fresh full gate passes at dc45ff40: 66 Node tests, clean Dart analysis and 81 Flutter tests in one clean-checkout run. Prior failed gates and the earlier bdfe5bb4 pass are preserved in the report.
- This E2E run additionally fixed native model setup/selection, empty-failure history contamination and URI-encoded filesystem paths. Existing legacy host history is preserved by a verified no-overwrite copy into the canonical path.
- Stock at `/Applications/pif.app` passed real child/Steer/Abort/tool recovery and widget checks, then reopened at the clean picker as PID 81004. Export `/tmp/pif160-ui-31x_h8mg/build/UI Workflow Check.app` passed empty-profile guidance, configured write/read, migration and restart persistence; final PID 80355 normally quit. Both bundles remain unchanged and pass strict signatures.
- The owner has resolved the export support boundary: installed authoring/export is required. #160 remains open for its implementation/verification, approved Mercury sample/appearance implementation and owner acceptance. Native folder chooser completion and new OAuth/denied-permission provisioning are not proven. The technical scaffold export is not Mercury sample acceptance.
- [Current report](../../docs/reviews/2026-08-31-remediation-verification.md) links final evidence and remaining gates. Historical owner approvals #154/#155/#156/#157/#178/#188/#189 and the original review remain unchanged.

### Installed Builder and GitHub Setup Requirement (31 August 2026)
- Owner direction extends existing epic [#152](https://github.com/Holovkat/pi-extensions/issues/152): installed pif must build apps and create local development environments which can create more environments, without this repository checkout. A follow-up adds GitHub repository creation and secure application Settings; the earlier repository-creation deferral is superseded.
- Native children of #160: #218 bundled builder resources → #219 repeatable development environments → #220 installed export. #223 central Settings/Appearance may be prepared independently; #221 environment-token integration follows #219 identity and #223; #222 repository creation/tracker binding follows #219/#221. These tasks are To Do, not implemented.
- #204 moves from Blocked to To Do: the owner decision is settled; canonical spec/support-matrix reconciliation remains. #160 stays the sole verification gate and must prove the installed-app and two-generation environment workflow. The previous passing dc45ff40 candidate does not prove added scope.
- Latest owner simplification: #221 is token-only, stored in macOS Keychain per environment UUID; no browser/device/OAuth flow, global-login fallback or automatic credential sharing. #223 adds one central Settings tab with just Appearance (Light/Dark/System) and GitHub; it borrows Mercury’s grouping without advanced sliders or unrelated sections. Allocate local environment identity before token/GitHub setup.
- GitHub is the ticket authority; local-only mode remains explicitly disconnected. Secrets stay in secure OS storage and out of projects/exports; created environments do not copy parent runtime state or tickets. Ordinary AOT exports and the deferred RFW lane remain distinct from editable environments. #190 runtime self-management remains related backlog.

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
