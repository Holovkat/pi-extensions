---
type: Inbox
title: Mercury App Template and pif-app-designer Skill Authored (#178)
description: Executed task #178 — ran the extract-design skill over the FMS Mercury sources into a validated design.json, authored the four-layer Mercury app template at pif/templates/mercury/ (template.yaml, design.json, rules.md, components.md, shell.md), authored the pif-app-designer skill contract (brief + template -> pif_app/design.md for owner approval before any widget; recipe is law), and recorded the dry-run design plan (example-design.md) for a 2-page sample brief
tags: [pi-extensions, pif, templates, mercury, design-system, skills, extract-design]
timestamp: 2026-08-29T07:34:46Z
generated_at: 2026-08-29T07:34:46Z
generated_by: governed-sprint-builder
session_id: pending
commit_sha: []
branch: codex/pif-templates-mercury-178
issue_refs: [178, 154, 157, 158, 152]
epic_refs: [152]
capture_tier: session
---

# What Was Done

Executed task #178 (T1 scope, content + skill authoring only; no product code, no extension or pif/lib changes, no tests). Ran the `extract-design` skill against the Mercury sources (DESIGN.md, MERCURY_VISUAL_STANDARD.md, MERCURY_UI_CONTRACT.md, mercury_tokens.dart, app_theme.dart, app_spacing.dart, mercury_components.dart, mercury_shell.dart, design-qa.md authority check) and authored:

- `pif/templates/mercury/design.json` — semantic palette (paired light/dark roles), Poppins type roles with the 500 cap, 4/8/12/16/24/32 spacing, 8/12/20/28/999 radii, 1px/2px borders, the flat/ambient/decision/floating shadow vocabulary, breakpoints (600, 1024), component rules, and accessibility observations. Passes the extract-design validator clean. Observed values carry evidence notes; inferences and two flagged doc-vs-code drifts carry confidence values.
- `pif/templates/mercury/template.yaml` — manifest per the #154-settled schema: id `mercury`, name, description, the four-layer list, source attribution, and the Poppins OFL font obligation.
- `pif/templates/mercury/rules.md` — the named rules as agent-obeyable constraints (No-Bold, Signal-Not-Decoration, Paired Appearance, the ten-clause Screen Composition Law, plus supporting rules), the four-step authority chain (owner instruction > this contract > design.json + DESIGN.md/visual standard > accepted design-QA records; framework defaults below all), and a ten-line pre-completion check.
- `pif/templates/mercury/components.md` — starter kit inventory from mercury_components.dart: card primitives (home card, grouped panel, settings group/row), status badge + corner badge + inline notice, metric chip/inset metric/value row, section header, centered page header + circular back, state view, responsive grid, and theme-level buttons/chips/fields.
- `pif/templates/mercury/shell.md` — the single-codebase responsive shell recipe (rail at >=1024 always labeled + 1px divider, bottom NavigationBar below, same destinations both modes), width bands, page anatomy, pif binding notes (slot: page, app.yaml as source of truth).
- `skills/pif-app-designer/SKILL.md` — the design-pass skill: inputs (brief + template), nine-step procedure, the exact pif_app/design.md artifact shape (pages, per-page layout, component inventory, token bindings, storage + tool-surface decision, proposed app.yaml, open questions, rule check), the approval contract (no widget before owner approval; approved plan binds the build loop; deviations go to the owner), a worked example, and line-stops.
- `pif/templates/mercury/example-design.md` — the acceptance dry-run: a full design.md for the hypothetical 2-page "small dashboard" brief matching the skill contract section-for-section, with the ten-line rule check passing.

# Decisions Made

- **Doc palette binds over code drift.** design.json records both observed sets and binds the documented palette (DESIGN.md + visual standard) for new builds, because the Mercury authority chain ranks those docs above implementation defaults and the contract says to ask the owner rather than invent. Flagged as EVID-DRIFT-1: shipped MercuryThemeTokens light values differ (page #E6EBF2 vs #EEF1F8, surface #EFEFF5 vs #F8FAFE, accent #143633 vs #397C76, accentSoft #143633 vs #CFE5E2, divider #B8BEC4 vs #D9DEE8, dark accent #64CBBF vs #78B8B0); app_theme.dart derives the runtime accent by lightness override (0.14 light / 0.59 dark). Owner reconciliation required at first real use (it is Open Question 1 in example-design.md).
- **No-Bold Rule recorded with its real shape.** The cap (never above 500) is law everywhere; DESIGN.md documents 400/500, but shipped app_theme.dart pins all roles to w300 as an owner-approved field-device legibility exception (EVID-DRIFT-2). The template defaults new builds to 400/500 and does not silently copy the 300 baseline.
- **Breakpoint honesty.** 600 and 1024 are code-observed (MercuryBreakpoints); the 720/840/900 intermediate thresholds exist only in DESIGN.md prose, so design.json marks them guidance (confidence 0.6), not law.
- **Scope trims recorded, not lost.** Map-specific route/congestion palettes and the owner-approved print-world run-sheet hex literals are Mercury exceptions, deliberately out of template scope; Poppins is referenced by name with the OFL obligation on the consuming app (no font files bundled).
- **Naming follows the #154 spec exactly** (see Lessons Learned for the one addition).
- **Contrast claims are computed and labelled.** ~4.9:1 (documented light accent vs white) and ~6.7:1 (documented dark accent vs dark on-accent) are marked inferred/computed (confidence 0.8/0.7), not asserted as measured.

# What Was Deprecated

Nothing. No existing concept, doc, or template is superseded by this task; the Mercury template is new content consumed downstream by #157 (`pif_app_init --template`) and #158 (design pass + sample app).

# Lessons Learned

- The #154-settled template model and issue #178 agree on all paths and names (`pif/templates/mercury/`, five files, `skills/pif-app-designer/SKILL.md`, `pif_app/design.md`, rail >=1024px) — no naming discrepancy to report. The only delta: this task adds a sixth file, `pif/templates/mercury/example-design.md` (the skill dry-run required by #178's Development Checks). It sits beside the five template files but is not a template layer, and `template.yaml` lists only the settled four layers.
- Doc-vs-code token drift is the normal condition of a mature design system, not a defect to hide: recording both sets with an authority-chain-based default plus an explicit open question keeps the template honest and unblocks the build loop.
- Widget ids in pif are snake_case (`diff_viewer` convention) while app ids are kebab; the example plan uses `overview_page`/`settings_page` widgets under app id `ops-pulse` to model both.

# Current State

- The Mercury template is complete and validator-clean at `pif/templates/mercury/` (template.yaml + four layers + example-design.md dry-run); the pif-app-designer skill is committed at `skills/pif-app-designer/SKILL.md`. #157 and #158 can consume both at these stable paths; #158's design pass must present `pif_app/design.md` for owner approval before any widget, with the light-accent drift question resolved first.
- Evidence tier: content only; no hub, shell, or tool code touched; no product behavior changed.
