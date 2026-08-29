---
type: Inbox
title: pif App-Builder Model Settled in the Design Spec — QA Alignment Audit and Roadmap Realignment (#154)
description: Executed task #154 — ran the pif gate at HEAD (pass), audited the last two weeks of pif work against the app-builder vision (reuse/missing/conflicts), settled every open app-builder decision (project layout, app.yaml schema, layered sources with id shadowing, slot:page semantics, app runtime mode, export composition, secrets policy, template composition and storage) in the design spec, rewrote the Phase 2/3 phasing to epic #152's Roadmap Realignment, and mapped #130's remainder onto tasks #155/#157
tags: [pi-extensions, pif, flutter, app-builder, design-spec, qa-audit, roadmap, templates]
timestamp: 2026-08-29T00:00:00Z
generated_at: 2026-08-29T00:00:00Z
generated_by: governed-sprint-builder
session_id: pending
commit_sha: []
branch: codex/pif-app-builder-154
issue_refs: [154, 130, 152, 155, 156, 157, 158, 159, 178]
epic_refs: [152]
capture_tier: session
---

# What Was Done

Executed task #154 (T1 scope, read-only review + spec edits only): ran the full gate `npm run test:pif` at HEAD (`7237e0b`, branch `codex/pif-app-builder-154`) — PASS (node suites green, `dart analyze` clean, flutter test 45/45; `npm install` was needed first because `node_modules` was absent). Audited the last two weeks of pif work (hub, bus, docking shell, standalone launcher, packaging) against the app-builder vision and wrote a reuse-as-is / missing / conflicts map into a new QA alignment audit section of `docs/superpowers/specs/2026-08-15-pif-design.md`. Settled every open app-builder decision in a new "App-builder model" section, rewrote the spec's Phasing into the epic's Roadmap Realignment, and mapped #130's remaining checklist onto #155/#157. No product code or test files touched.

# Decisions Made

All settled with rationale in the spec's App-builder model table; downstream tasks consume these names exactly.

- **Project layout**: `pif_app/` at the project root — `app.yaml`, `design.md`, `template/` (pinned copy of scaffolded template layers), `widgets/` (same `widget.yaml` + `PifWidgetPlugin` shape as the shell's own tree). One scan/analyze/registry pipeline serves both roots; `.pi/pif/` stays hub state.
- **`app.yaml` schema**: `id`, `name`, `version`, `home`, `pages` (ordered), `template` (optional), `dependencies` (widget ids from any layer). Manifest is the single source of truth for home + navigation order.
- **Layered widget sources**: base (`pif/lib/widgets/`) → global catalog (`~/.pi/pif/catalog/`) → project overlay (`pif_app/widgets/`); the Widget Store distinguishes and installs/uninstalls per source.
- **Id shadowing**: later layer shadows an earlier id wholesale (no merging); provenance (`base|catalog|project`) carried in `widget.list`, snapshot, Store, and generated registry.
- **`slot: page` semantics**: pages are full-screen widgets, excluded from docking, rendered only in the app-mode page stage (IDE mode may open one in center stage for debugging).
- **Home selection**: declared once in `app.yaml` (`home:`), never in the widget manifest; navigation order = `pages` order.
- **App runtime mode**: workspace with `pif_app/app.yaml` boots in app mode (page stage, responsive navigation rail ≥1024px / bottom bar below, Agent Console available); IDE docking behind a dev toggle; exported apps always boot in app mode — no project picker.
- **Export composition (recommended)**: template app consuming the shell core — second `main` entrypoint inside the pif package importing `pif/lib/core/` plus a pinned registry over the project's widget set; hub stages, generates the pinned registry, `flutter build macos --release -t <entry>`, reuses standalone bundling + re-signing. A `pif_core` package extraction is not pursued; if forced, it stays the epic's recorded line-stop.
- **Secrets policy**: exported apps bundle Node + pi + pif extensions but never dev `models.json`/API keys/tokens; first-run provisioning on the target machine (model manager); WS token stays per-launch; secrets scan is part of #159 export acceptance.
- **Template composition (owner decision 2026-08-29)**: four layers — `design.json` (machine-readable tokens, extract-design output), `rules.md` (named agent-obeyable rules + authority chain), `components.md` (starter kit), `shell.md` (responsive shell pattern); manifest `template.yaml` declares `id`, `name`, `description`, layer list.
- **Template storage**: global-catalog entry type at `~/.pi/pif/catalog/templates/<id>/`; repo ships Mercury at `pif/templates/mercury/` (five files) and the hub syncs repo templates into the catalog at hub start; `pif_app_init --template <name>` resolves project → catalog → repo fallback, pins the four layers into `pif_app/template/`; the UI plan lands at `pif_app/design.md` via `skills/pif-app-designer/SKILL.md`, owner-approved before any widget is built (recipe is law).

# What Was Deprecated

- The spec's original **Phase 2 — Ecosystem / Phase 3 — Platform** sections are retired; replaced by the Roadmap realignment (done: layout presets + diff viewer; pulled forward: packaging → #159; precursor lanes: tracker panel #163–#166 shipped, app templates + design-first build #178 added 2026-08-29; subsumed: on-demand builds → #158; Sprint 2 — Ecosystem and Sprint 3 — Platform & sharing). Sprint 2's theming item is absorbed by templates.
- The v1 non-goals "no packaged/release build" and "no remote or networked store" are marked superseded in the spec.
- No OKF concept files were deprecated — spec-internal retirement only; curation may later record the Phase 2/3 phasing as superseded at the concept level.

# Lessons Learned

- The audit's reuse map was almost entirely green: the widget engine, hub hardening, bus, session manager, and standalone packaging carry over untouched — the real gaps are narrow (page concept, layered sources, app model, templates), which is why the epic decomposes cleanly into #155–#159.
- Two naming collisions surfaced that would have bitten later: local `pif/catalog/` (uninstall archive) vs the global catalog (source layer), and `core: true` meaning IDE chrome while shipped apps need core console surfaces — both disambiguated in the audit section and owned by #155/#156.
- Reading issue #130 before mapping its checklist prevented a miss: its "test the install script in a clean project" item maps to verification work in #155/#157 rather than a new task.

# Current State

- Spec `docs/superpowers/specs/2026-08-15-pif-design.md` carries: Roadmap realignment (2026-08-29), QA alignment audit with gate result + reuse/missing/conflicts map + #130 mapping, and the settled App-builder model (11 decisions + `pif_app_*` tool surface).
- No conflict was found between the amended template decisions and any already-settled owner decision (notably "built apps always bundle the agentic runtime") — no line-stop triggered.
- Gate at HEAD is green; next tasks (#178 template authoring can start in parallel; then #155 ∥ #156, then #157, then #158/#159, then #160) consume the settled names verbatim.
