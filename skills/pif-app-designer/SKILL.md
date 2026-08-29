---
name: pif-app-designer
description: >
  pif app design pass: turn a brief plus a pif app template (e.g. Mercury at
  pif/templates/mercury/) into the per-project UI plan pif_app/design.md —
  page list, per-page layout, component inventory, token bindings, and the
  storage/tool-surface decision — presented for owner approval BEFORE any
  widget is built. The approved plan binds the build loop (recipe is law).
  Use when starting a pif app build, when asked to plan a pif app's UI, or
  before running pif_app_init / pif_widget_create for a new app.
---

# pif App Designer (design pass)

You are running the **design pass** of the pif agentic build flow. You do not
write widget code. You produce one artifact — `pif_app/design.md` — and get it
approved. After approval it is the law the build loop obeys: no layout
renegotiation inside the build loop.

## Inputs

1. **The brief** — what the owner asked for, in their words. Quote it.
2. **A template** — a pif app template directory (default: `mercury`,
   resolved at `pif/templates/mercury/`, global catalog
   `~/.pi/pif/catalog/templates/mercury/`, or the project's pinned
   `pif_app/template/`). Read all four layers: `design.json` (tokens),
   `rules.md` (named rules + authority chain), `components.md` (starter kit),
   `shell.md` (responsive shell pattern).
3. If no template fits and the owner has not named one, use the minimal
   unstyled path — but say so explicitly in the plan's Open Questions.

## Procedure

1. **Read the brief and restate it.** Write the owner's brief verbatim, then
   your one-paragraph restatement. Anything ambiguous becomes an Open
   Question — never a guess that silently hardens into the plan.
2. **Derive the screen list from the Screen Composition Law.** One job per
   screen. State each screen's single job in one sentence. A screen that
   needs "and" in its job sentence is two screens. Exclude screens the
   platform band cannot safely host (desktop-only tools stay desktop-only).
3. **Compose each page.** For every page: layout per width band (compact /
   intermediate / wide, per `shell.md`), the components it composes from
   `components.md` (by name, no private variants), and its navigation role.
4. **Bind tokens.** Every color, type role, spacing step, radius, elevation,
   and weight in the plan references a token from `design.json` — never a raw
   value. If the plan needs a value the template does not define, it becomes
   an Open Question or an explicitly marked extension proposal.
5. **Decide storage and tool surface.** Where the app's data lives (session
   state, project JSON file, external service) and which tools the build loop
   will use (`pif_app_init --template <id>`, `pif_app_page_add`,
   `pif_app_widget_add`, `pif_app_home_set`, `pif_widget_create`,
   `pif_widget_install`). Zero manual file edits — if a step would need one,
   the plan is wrong.
6. **Propose the manifest.** Map the plan onto `app.yaml`: `id` (kebab),
   `name`, `home`, ordered `pages`, `template: <id>`, `dependencies`.
   Page widgets are `slot: page` widgets with snake_case ids, same
   `widget.yaml` + plugin shape as any pif widget.
7. **Check the rules.** Walk the template's rule checklist (e.g. Mercury's
   ten-line check in `rules.md`) against the plan. Fix the plan until it
   passes, or raise the deviation to the owner inside the plan.
8. **Write `pif_app/design.md`** in the exact artifact shape below, and
   present it for owner approval. **Stop.** Do not run `pif_app_init`, create
   widgets, or write Dart until the owner approves (or amends) the plan.
9. **Record approval.** Note the approval date and any amendments at the top
   of `design.md`. The approved file is binding for the whole build run.

## Artifact shape (pif_app/design.md)

Every plan MUST contain these sections, in this order:

```markdown
---
title: <app name> — UI design plan
template: <template id>
status: draft | approved | amended
approved: <date, or "pending">
---

# Brief
<owner's brief verbatim, then your restatement.>

# Pages
<ordered list. For each page: widget id (snake_case), one-sentence job,
navigation role (home / primary destination / sub-page / sheet).>

# Per-Page Layout
<for each page: layout per width band (compact / intermediate / wide) per
shell.md; content structure top to bottom; navigation and back behavior.>

# Component Inventory
<every component used, by components.md name, mapped to the pages that use
it. Any proposed new primitive is explicitly marked.>

# Token Bindings
<every color/type/spacing/radius/elevation decision as a design.json token
reference. No raw values outside token definitions.>

# Storage & Tool Surface
<data storage decision; the exact tool-call sequence the build loop will run;
confirmation that no step requires manual file edits.>

# Proposed app.yaml
<the manifest the build loop will scaffold: id, name, home, pages, template,
dependencies.>

# Open Questions
<unresolved decisions the owner must answer, each with a proposed default.>

# Rule Check
<the template rule checklist walked against this plan; result per line.>
```

## The contract (what "recipe is law" means)

- **No widget before approval.** The design pass ends with the plan presented;
  the build loop begins only on explicit owner approval.
- **The approved plan binds the build loop.** Page list, layouts, components,
  tokens, storage, and tool sequence do not change mid-run. New needs become
  a new design pass — not an improvised widget.
- **Template rules outrank convenience.** If the build hits a wall that seems
  to require breaking a template rule, stop and escalate to the owner; that
  is a deviation decision, not a build decision.
- **The plan is the design record.** Screenshots, QA evidence, and drift notes
  reference the sections of `design.md` they amend.

## Worked example (abbreviated)

Brief: "a small dashboard with an overview page and a settings page."
Template: mercury. The full dry-run output lives at
`pif/templates/mercury/example-design.md`; the skeleton it produced:

- Pages: `overview_page` — "show the operator's current status at a glance"
  (home); `settings_page` — "adjust and persist app preferences" (primary
  destination). Two screens, two jobs, no "and" screens.
- Per-page layout: overview — responsive card grid (1/2/3 columns) of home
  cards with corner badges, section header per group, no in-page tabs;
  settings — one flat settings group per section (radius 20, hairline
  dividers), rows with chevron/switch trailing, centered page header with the
  48px circular back control returning to overview.
- Components: Mercury-pattern home card, corner badge, metric chip, section
  header, settings group/row, state view for empty/error. No new primitives.
- Token bindings: page/surface/raised/accent/accent_soft/divider roles from
  `design.json`; spacing 16 card padding, 24 section gaps; title/body/label
  roles; weights <= 500.
- Storage: JSON file in the project directory (read/written through a data
  widget); tool surface `pif_app_init --template mercury` → `pif_app_page_add`
  x2 → `pif_app_home_set overview_page`; no manual edits.
- Rule check: ten-line Mercury check passes; open questions flag token-drift
  reconciliation (light accent) before first build.

## Line-stops

Stop and report to the owner if:

- The brief requires a screen whose job cannot be stated in one sentence.
- The template's rules and the brief genuinely conflict (authority chain
  case 1 is needed).
- The plan would require a manual file edit at any step of the build loop.
- The template's token set cannot express the brief's needs without new
  values (extension proposals are allowed only when explicitly marked and
  owner-approved).
