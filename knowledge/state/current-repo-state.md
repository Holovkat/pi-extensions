---
type: State
title: Current Repo State
description: Current state of the pi-extensions repository — baseline extensions, blueprint, toolshed, council, pif hub/shell/SQLite persistence, and the live pif remediation candidate state as of 31 August 2026.
resource: ./README.md
tags: [pi-extensions, state, current, repo, status, roadmap, pif]
timestamp: 2026-08-31T10:36:58Z
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
- **Distribution**: `scripts/install-pif.sh` installs globally to `~/.pi/pif/app` + `~/.pi/agent/extensions`; `scripts/build-pif-app.sh` produces a self-contained ~526MB `.app` including Node.js, Pi, extensions, Flutter and the immutable builder kit. Runtime and authoring prerequisites are distinct.

## Asset Management

Blueprint assets are committed in `agents/pi-blueprint/` and `skills/pi-blueprint/`; use `/blueprint-sync-assets` to mirror them into a project-local `.pi` runtime.

## Roadmap Status

### Pi-to-Pi Comms (Complete)
- Comms v1.0-v2.0: production approved / release complete
- Includes local coms, networked council, packaging, deployment profiles

### pif App Builder (#152, Active)
- Epic #152 "pif app builder" is open and active: agentic applications composed on the pif foundation.
- Tracker precursor sprint #163–#166 (repo-synced Kanban tracker panel v0.1: sprint, hub sync layer, board widget, verification) is historical shipped context and no longer the active planning surface for this snapshot.

### Earlier pif App Builder Remediation Snapshot (#160, 31 August 2026)
- Tested and pushed code candidate: `dc45ff40` on `codex/pif-app-builder-154`. Documentation handoff does not change the built revision.
- The earlier E2E checkpoint had 27 native remediation children. The owner extension brought #160 to 33; at planning time 24 were in Review, seven To Do and #206/#212 blocked on independent sample design/appearance approval. The added implementation is described below. Canonical requirements remain #158/#159/#160 with the explicit #152 extension.
- Fresh full gate passes at dc45ff40: 66 Node tests, clean Dart analysis and 81 Flutter tests in one clean-checkout run. Prior failed gates and the earlier bdfe5bb4 pass are preserved in the report.
- This E2E run additionally fixed native model setup/selection, empty-failure history contamination and URI-encoded filesystem paths. Existing legacy host history is preserved by a verified no-overwrite copy into the canonical path.
- Earlier stock passed real child/Steer/Abort/tool recovery and widget checks as PID 81004. It has since been replaced by the installed-builder candidate below; those UI results do not transfer automatically. Export `/tmp/pif160-ui-31x_h8mg/build/UI Workflow Check.app` passed empty-profile guidance, configured write/read, migration and restart persistence; final PID 80355 normally quit.
- The owner resolved the export support boundary in favor of installed authoring/export, subsequently narrowed authentication to secure tokens only and added central Settings. Native folder chooser completion and live Keychain/permission provisioning are not proven by the earlier candidate. The technical scaffold export is not Mercury sample acceptance.
- [Earlier report](../../docs/reviews/2026-08-31-remediation-verification.md) preserves baseline evidence. Historical owner approvals #154/#155/#156/#157/#178/#188/#189 and the original review remain unchanged.

### Installed Builder and GitHub Integration Candidate (31 August 2026)
- Owner direction extends existing epic [#152](https://github.com/Holovkat/pi-extensions/issues/152): installed pif must build apps and create local development environments which can create more environments, without this repository checkout. A follow-up adds GitHub repository creation and secure application Settings; the earlier repository-creation deferral is superseded.
- Native children #218–#223 are implemented as an integrated candidate: bundled immutable resources, writable repeatable environments, installed export, secure environment tokens, repository/tracker onboarding and central Settings. #204 now has a canonical six-contract disposition matrix. Their execution evidence and remaining gates belong to #160; implementation is not acceptance.
- Current automated evidence: clean Dart analysis, **129 Flutter tests** and **79 affected Node tests** pass. The native repeat-build failure caused by readonly kit directories was fixed by staged publication with rollback and safe owned cleanup. Repaired and repeat stock builds pass.
- Final installed `/Applications/pif.app` launched as **PID 53246**; strict signature passes, 51 source comparisons match and all 10,333 kit files validate. Builder version `b0b9f4ff418e6cde292e3b7f47cd602a702419ebd3b13b95724edf02ad599465`. Previous stock is preserved at `/tmp/pif160-installed.oHQBm9/previous-pif.app`.
- Native filesystem/build checks found and repaired runtime copy filtering, fresh host dependency setup and retained-kit source contamination. Eight focused packaging checks and fresh headless app-init pass. Fresh installed-resource first/child provisioning, identity/edits isolation, independent reopen and a signed two-page export pass without manual dependency preparation; evidence is in `service-proof-v3` under the same fixture parent. The exported kit matches its 10,333 inputs exactly and provisions a third independent environment which reopens without the creator. These non-UI checks do not establish native acceptance; generic native export naming also remains to be checked.
- Computer Use could not start because macOS was locked; the user was asked to unlock it. Live token/repository fixtures also require explicit authorization. These are outstanding native evidence gates, not passing UI results. Separate #206/#212 sample approvals remain unchanged.
- [Current installed-builder report](../../docs/reviews/2026-08-31-installed-builder-verification.md) records this candidate, failure/repair history and subsequent evidence. The earlier passing dc45ff40 baseline does not prove added scope.
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
