# Knowledge Update Log

<!-- Entries are added in reverse chronological order by the curation agent -->
<!-- Format: ## <ISO timestamp> - <action> -->

## 2026-08-31T05:17:19Z - Recorded final native pif verification without closing acceptance gates

Aligned the current state and inbox indexes with tested code 3bc8e1fc, 27 native remediation children, actual stock/export UI evidence and unchanged signed bundles. Preserved both failed combined gates and the three owner decisions. Added the dated verification report and retained the original review. Restored index links for 35 pre-existing inbox files and corrected the inventory to 61 without changing their content or curating them. No product source or acceptance criteria were changed.

## 2026-08-31T03:38:50Z - Corrected pif handoff snapshot with live #215 and #205 review state

Updated the current pif state snapshot again to remove the stale tracker precursor claim, carry forward the live #205 review status, add #215 to the live tracker surface, and call out the #214 evidence commit and 25-child parent count. Kept the active #158/#159/#160 contract surface anchored to the live issue pages and left all source and test files untouched.

## 2026-08-31T03:32:02Z - Corrected pif handoff state and candidate links

Updated the current pif state snapshot to reflect the live remediation branch, the review slices through #214, the open owner gates, and the still-blocked #160 final verification ticket. Added the corrective #205 inbox synthesis and aligned the inbox/root counts and handoff references without changing any source or test files.

## 2026-06-29T15:05:00Z - Seeded knowledge bundle from project documentation

Initial seeding of the pi-extensions OKF knowledge bundle from existing project documentation (README.md, docs/, extension files, agent definitions, PRDs).

**Created (35 concepts):**
- `architecture/system-architecture.md` — Two-phase pipeline (req-qa -> dev-pipeline)
- `architecture/agent-subprocess-execution.md` — RPC mode, stdin/stdout, steering, session reuse
- `architecture/fast-track-architecture.md` — Fast Track mode flow, build/eval/fix/UAT
- `architecture/three-wave-architecture.md` — 3-Wave mode, council/prototype/review/dev
- `architecture/council-architecture.md` — Networked council, hub server, member discovery
- `architecture/pipeline-state-system.md` — State file, dashboard, observer mode, control socket
- `architecture/github-integration.md` — Issue publishing, learnings, enrichment, rebuild
- `architecture/model-configuration.md` — Model assignments, escalation, config UI, ping test
- `components/req-qa-extension.md` — Requirements discovery extension
- `components/dev-pipeline-extension.md` — Sprint development extension
- `components/pi-blueprint-extension.md` — Planning cockpit extension
- `components/pi-toolshed-extension.md` — Card-based workbench extension
- `components/council-extension.md` — Networked council extension
- `components/okf-extension.md` — OKF Pi extension
- `components/pipeline-dashboard.md` — Terminal dashboard
- `components/pipeline-dashboard-web.md` — Web dashboard and steer UI
- `domain/agent-capability-matrix.md` — Agent tools matrix, read-only by design
- `domain/specialist-agents.md` — req-qa specialist agents
- `domain/pipeline-agents.md` — dev-pipeline agents
- `domain/watchdog-timer-system.md` — Watchdog timers, escalation, yield summary
- `domain/uat-process.md` — UAT scenarios, Playwright, approval gate
- `domain/okf-curator-droid.md` — OKF curation droid
- `process/requirements-discovery-workflow.md` — Interview loop, consultations, sign-off
- `process/sprint-development-workflow.md` — Pipeline start, epic chaining, merge
- `process/installation-guide.md` — Installation, aliases, prerequisites
- `process/commands-reference.md` — All slash commands
- `process/fast-track-walkthrough.md` — Fast Track walkthrough
- `process/comms-deployment.md` — Comms deployment profiles
- `process/toolshed-implementation.md` — Toolshed implementation notes
- `decisions/fast-track-vs-three-wave.md` — Two pipeline modes trade-offs
- `decisions/rpc-mode-for-subprocesses.md` — RPC mode for agent communication
- `decisions/async-council-default.md` — Async council_send by default
- `decisions/read-only-agents-by-design.md` — Only dev and prd-writer have write
- `decisions/diffusion-research-basis.md` — Research context behind pipeline design
- `state/current-repo-state.md` — Current repo state from README

**Updated:**
- All `index.md` files with new concept entries and accurate counts
- `knowledge/log.md` with this seeding entry

**Merged with external concepts:**
- `process/comms-hardening-roadmap.md` (created by parallel curation, preserved)
- `state/comms-delivery-state.md` (created by parallel curation, preserved)

## 2026-06-29T15:00:00Z - Created comms hardening concepts from GitHub issues

Processed 18 closed GitHub issues (#93-#110) from the pi-extensions repo into OKF knowledge entries.

**Created:**
- `process/comms-hardening-roadmap.md` — Process concept documenting the comms epic #93, sprint progression (v1.0 -> v1.1 -> v1.2 -> v2.0), task breakdown (#98-#110), and delivery outcomes. issue_refs: [93, 94, 95, 96, 97].
- `state/comms-delivery-state.md` — State concept documenting that all sprints are complete, production-deployed, and production-approved. issue_refs: [93].

**Updated:**
- `process/index.md` — added comms-hardening-roadmap entry
- `state/index.md` — added comms-delivery-state entry
- `index.md` — updated concept counts
