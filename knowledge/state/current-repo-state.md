---
type: State
title: Current Repo State
description: Current state of the pi-extensions repository — baseline extensions, blueprint, toolshed, council, pif hub/shell/SQLite persistence, and the live pif remediation candidate state as of 31 August 2026.
resource: ./README.md
tags: [pi-extensions, state, current, repo, status, roadmap, pif]
timestamp: 2026-08-31T12:03:49Z
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
- Latest owner-authorized **development checkpoint** closes **32 implementation tickets**: 31 remediation children plus #159. Product source is `fd0b8149`, already committed/pushed; this closure adds no new code or test-run claim. See the [current checkpoint disposition](../../docs/reviews/2026-08-31-installed-builder-verification.md#development-checkpoint--owner-authorized-closeout).
- Remaining work is real: #158/#206 need the designed Team Pulse sample/child workflow; #212 needs its pinned-template appearance implementation and specific approval. #160 retains final installed/live credential/GitHub/child/export/restart, native accessibility/naming and combined-gate acceptance. #152/#153 stay open. No Supabase dependency applies; the sample uses demo data. Separate #179–#186/#190 backlog is untouched.
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
- At the earlier integration checkpoint, native children #218–#223 were implemented as an integrated candidate: bundled immutable resources, writable repeatable environments, installed export, secure environment tokens, repository/tracker onboarding and central Settings. #204 now has a canonical six-contract disposition matrix. Their execution evidence and remaining gates belong to #160; implementation is not acceptance.
- Current automated evidence: clean Dart analysis, **129 Flutter tests** and **79 affected Node tests** pass. The native repeat-build failure caused by readonly kit directories was fixed by staged publication with rollback and safe owned cleanup. Repaired and repeat stock builds pass.
- Final installed `/Applications/pif.app` launched as **PID 53246**; strict signature passes, 51 source comparisons match and all 10,333 kit files validate. Builder version `b0b9f4ff418e6cde292e3b7f47cd602a702419ebd3b13b95724edf02ad599465`. Previous stock is preserved at `/tmp/pif160-installed.oHQBm9/previous-pif.app`.
- Native filesystem/build checks found and repaired runtime copy filtering, fresh host dependency setup and retained-kit source contamination. Eight focused packaging checks and fresh headless app-init pass. Fresh installed-resource first/child provisioning, identity/edits isolation, independent reopen and a signed two-page export pass without manual dependency preparation; evidence is in `service-proof-v3` under the same fixture parent. The exported kit matches its 10,333 inputs exactly and provisions a third independent environment which reopens without the creator. These non-UI checks do not establish native acceptance; generic native export naming also remains to be checked.
- Computer Use could not start because macOS was locked; the user was asked to unlock it. Live token/repository fixtures also require explicit authorization. These are outstanding native evidence gates, not passing UI results. Separate #206/#212 sample approvals remain unchanged.
- [Current installed-builder report](../../docs/reviews/2026-08-31-installed-builder-verification.md) records this candidate, failure/repair history and subsequent evidence. The earlier passing dc45ff40 baseline does not prove added scope.
- Latest owner simplification: #221 is token-only, stored in macOS Keychain per environment UUID; no browser/device/OAuth flow, global-login fallback or automatic credential sharing. #223 adds one central Settings tab with just Appearance (Light/Dark/System) and GitHub; it borrows Mercury’s grouping without advanced sliders or unrelated sections. Allocate local environment identity before token/GitHub setup.
- GitHub is the ticket authority; local-only mode remains explicitly disconnected. Secrets stay in secure OS storage and out of projects/exports; created environments do not copy parent runtime state or tickets. Ordinary AOT exports and the deferred RFW lane remain distinct from editable environments. #190 runtime self-management remains related backlog.

### New Project workflow correction (31 August 2026)
- Owner follow-up simplifies setup to the relevant next step. Saved projects automatically finish local preparation; saved repository decisions and credentials are not recreated. Settings stays in the header. Routine SDK selection/retry/preview-bypass choices are removed; actual failures expose specific recovery.
- That workflow candidate was signed and installed as **PID69833**, builder `eba148290911035dff9d53479eb5abf0ccd0ae37b858ab71027bc5467fde84d2`. It is superseded by the Settings candidate below. Clean analysis, **142 Flutter tests** and **15 Node integration tests** passed.
- Native saved-project setup/open passed for `pif-test-app-1` with unchanged identity/repository decision. New Project first-step/Settings return was observed; the separate native folder chooser was confirmed by the owner but is not addressable by Computer Use. Fresh-project GUI completion and wider #160 acceptance remain distinct from these results.

### GitHub Settings workflow correction (31 August 2026)

- Current installed `/Applications/pif.app` is signed and running as **PID83021**, builder `51b92859504060b1ffb80475d8ecf9447446a0ff72a45c6e16cb2e2787f47ba1` (10,333 files). **151 Flutter tests**, **15 Node integration tests** and clean analysis pass; changed product sources match the installation.
- GitHub Settings now has a masked placeholder, inline Remove only when saved, one right-aligned Validate and plain status guidance. Empty actions are hidden; locked/unknown Keychain retains explicit validation. Same-account validation refreshes tracker access, while repository setup remains only in the unlinked Tracker state.
- The owner's saved token validated successfully in the installed UI and the repository fetch timestamp advanced. No token was extracted, changed or removed; project identity/link hashes are unchanged. Flutter AXTree/Computer Use errors limited repeat native clicking, so this is not error-free automation or full #160 credential/chooser/sample acceptance. See the canonical verification report.

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
