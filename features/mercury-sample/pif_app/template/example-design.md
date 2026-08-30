---
title: Ops Pulse — UI design plan (dry-run)
template: mercury
status: draft
approved: pending
---

> Dry-run of `skills/pif-app-designer/SKILL.md` (Task #178 acceptance). Brief:
> "a small dashboard with an overview page and a settings page." This is the
> artifact shape a real design pass produces; no widget was built.

# Brief

Owner's brief, verbatim: "a small dashboard with an overview page and a
settings page."

Restatement: a two-page pif app. The overview is the home screen giving an
at-a-glance picture of a small set of tracked items and their status. The
settings page adjusts preferences that persist between runs. Navigation is
only between these two pages. Template: Mercury (`pif/templates/mercury/`),
which brings the paired light/dark palette, the No-Bold cap, the starter
component kit, and the responsive shell recipe.

# Pages

1. `overview_page` — **job:** show the operator's tracked items and their
   current status at a glance. Role: home page and sole primary destination.
2. `settings_page` — **job:** adjust and persist app preferences. Role:
   primary destination (reachable from navigation in both bands).

No other screens. No "and" in either job sentence, so no screen splits are
needed. Secondary jobs discovered mid-build (detail views, editors) are new
design-pass decisions, not additions to these pages.

# Per-Page Layout

## `overview_page`

- **Compact (< 600):** page background (`tokens.colors.roles.page`), 32px
  (`tokens.spacing.named.page`) screen padding; section header ("Tracked
  items") then a 1-column responsive grid of home cards, each with a status
  corner badge; bottom navigation (Overview, Settings); footer area unused
  (no operational quick actions in this brief).
- **Intermediate (600–1023):** same stack at 2 columns; bottom navigation
  remains below 1024.
- **Wide (>= 1024):** shell renders the always-labeled navigation rail
  (Overview, Settings) plus 1px divider; card grid goes 3 columns; content
  column caps at 1280px, centered.
- **Navigation/behavior:** shell owns navigation — no in-page tabs or rails.
  Tapping a card's corner badge region is not an action (badges are
  non-interactive). Empty and error states use the shared state view with
  Retry. Back: none (home has no back control — one in, one out).

## `settings_page`

- **All bands:** content column capped at 1280px; sections composed as one
  flat settings group each (radius 20, surface role, hairline dividers
  indented 16): "General" (rows with switch trailing) and "Data" (rows with
  chevron trailing). Section headers between groups.
- **Compact:** bottom navigation (Settings active); rows min height 48.
- **Wide:** navigation rail; identical content column — settings does not
  gain density by stretching (Real-Estate Rule).
- **Navigation/behavior:** reached from shell navigation in both bands; no
  circular back control (it is a shell destination, not a pushed task page —
  one way in, one way out via the shell). Changes save on toggle (back
  saves); no Save button, no confirm dialogs for safe drafts.

# Component Inventory

| Component (components.md name) | Used by |
|---|---|
| Card (home card pattern) | overview — one per tracked item |
| Corner badge | overview — status count/summary per card |
| Status badge | settings — one inline notice row placeholder if sync errors appear |
| Metric chip | overview — compact supporting values on cards |
| Section header | overview + settings — one per content section |
| Settings group + row | settings — all preference rows |
| State view | overview — empty/error states |
| Responsive grid | overview — card grid (1/2/3 columns) |
| Inline notice | overview — non-blocking load warnings, if needed |

No new primitives proposed. No private card/badge/gutter variants. Buttons
(theme-level kit: primary/outlined/text) appear only if a state view needs
Retry (already built in).

# Token Bindings

All from `pif/templates/mercury/design.json` (`tokens.*`):

- **Surfaces:** page → `colors.roles.page`; cards/groups →
  `colors.roles.surface`; input/raised (none in this app yet) →
  `colors.roles.surfaceRaised`; navigation chrome → `colors.roles.navigation`.
- **Signal:** active navigation + focus → `colors.roles.accent`;
  card icons → `colors.roles.accent`; metric chip / tonal fills →
  `colors.roles.accentSoft` (metric chips at 42% opacity per kit spec).
- **Status:** success/warning/error/disabled → `colors.roles.success|warning|error|disabled`, always icon + text.
- **Text:** high emphasis → `colors.roles.text_high`; secondary →
  `colors.roles.text_secondary`; on accent → `colors.roles.text_on_accent`.
- **Type:** section headers → `typography.roles.title`; card titles → title
  role (M3 small); body values → `typography.roles.body`; row/label text →
  `typography.roles.label`. Weights only 400/500 (No-Bold cap 500).
- **Spacing:** card padding 16 (`spacing.named.group`); section gaps 24
  (`spacing.named.section`); screen padding 32 (`spacing.named.page`); chip
  internals 8/4 (`related`/`compact`).
- **Radii:** cards/settings groups 20 (`radii.group`); metric chips 12
  (`radii.control`); status badges 999 (`radii.circular`).
- **Elevation:** cards and groups `shadows.vocabulary.ambient_card` (2, 10%
  black); everything else flat. No arbitrary shadows.
- **Fonts:** Poppins (OFL) vendored by the app; sans-serif fallback accepted
  otherwise; text scaling passes through, no max.

No token outside `design.json` is used. Any value the build discovers it
needs that is not above is an Open Question or amendment, never an inline
literal.

# Storage & Tool Surface

- **Storage:** app data is a JSON file in the project directory
  (`data/pulse.json`): tracked items (id, label, status, updated) and
  settings (theme preference, refresh interval). Read/written through the
  data widget's plugin surface; no external service, no secrets.
- **Tool surface (exact sequence, zero manual edits):**
  1. `pif_app_init --template mercury` — scaffold `pif_app/`, pin the four
     template layers into `pif_app/template/`, create the home page.
  2. `pif_app_page_add settings_page` — create the settings page widget.
  3. `pif_app_home_set overview_page` — confirm the manifest home.
  4. Child sessions then write each page's Dart against this plan;
     `pif_widget_create` / `pif_widget_install` gate every piece through
     `dart analyze`.
- No step requires manual file editing. Diagnostics round-trip visibly
  through the install gate.

# Proposed app.yaml

```yaml
id: ops-pulse
name: "Ops Pulse"
version: 0.1.0
home: overview_page
pages: [overview_page, settings_page]
template: mercury
dependencies: []
```

# Open Questions

1. **Light-accent drift (EVID-DRIFT-1):** `design.json` records that Mercury's
   shipped code uses a near-black light accent (#143633) while the documented
   palette says Mercury Teal #397C76; the template binds the documented
   palette. **Proposed default:** documented #397C76. Owner confirms or picks
   the code value before first build.
2. **Refresh behavior:** does overview auto-refresh (loading strobe on cards)
   or refresh on demand only? **Proposed default:** on demand (calm system).
3. **Item count ceiling:** if tracked items grow past ~12, do we split into a
   master-detail workspace (wide) — new design pass — or keep scrolling?
   **Proposed default:** keep scrolling for this brief.

# Rule Check (pif/templates/mercury/rules.md)

1. Job sentences: overview = at-a-glance status; settings = preferences.
   Everything in each layout serves its sentence. PASS
2. One in, one out: shell navigation only; no back controls on destination
   pages; no duplicate affordances. PASS
3. Back saves: settings toggles save immediately; no Save buttons or
   confirms. PASS
4. Navigation: no in-page rails/tabs; shell owns destinations. PASS
5. Stages: no linear workflow in this brief. N/A
6. Components: all from components.md; no private variants. PASS
7. Tokens: every value above is a design.json reference; weights <= 500. PASS
8. Density: state views carry empty/error; no speculative rows. PASS
9. Reuse first: kit inventory reused; no new primitives. PASS
10. Deviation: none; Open Question 1 is an owner decision, not a deviation.
    PASS
