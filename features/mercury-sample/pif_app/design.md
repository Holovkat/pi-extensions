---
title: Team Pulse — UI design plan
template: mercury
status: approved
approved: 2026-09-01
---

# Brief

Owner brief from #158:

> "A small multi-page app, e.g. a dashboard with 2–3 pages, built from the
> Mercury template — the sample app that proves the agentic build flow end to
> end."

Team Pulse is a compact two-page dashboard built from the pinned Mercury
template. Home gives an immediate, useful reading of the team's current week;
Metrics explains the same four indicators in more detail. The application uses
one shared local demo snapshot, has no backend, and remains deliberately small
enough to prove the complete PIF design, child-agent, analyzer, export, launch,
and restart workflow without adding speculative product scope.

The owner delegated the final revision on 1 September 2026 after accepting the
recommended correction: Home is the actual dashboard, Metrics is the detailed
destination, and the unsupported About route is removed.

# Pages

1. `home` — **job:** show the team's current weekly status at a glance.
   Navigation role: home and primary destination.
2. `metrics` — **job:** explain the four weekly indicators in enough detail to
   assess progress and risk. Navigation role: primary destination.

The shell exposes exactly two destinations, in this order: Home and Metrics.
There is no About page, Overview alias, or duplicate in-page navigation.

# Per-Page Layout

## `home`

- **All bands:** the shell identifies Home as the active destination. Content
  starts with a MercurySectionHeader (`This week`), followed by four
  MercuryInsetMetric components for Tasks done, In review, Cycle time, and
  Open risks. A second MercurySectionHeader (`Current status`) introduces one
  MercuryInlineNotice that states the overall condition in plain language and
  pairs the warning/success tone with an icon and text. The page contains no
  link to Metrics because the shell already provides that route.
- **Compact (<600):** the metrics form one vertical sequence. The notice sits
  below them, and the shell uses bottom navigation.
- **Intermediate (600–1023):** the metrics form a two-column, two-row layout;
  the notice spans the content width. Bottom navigation remains active.
- **Wide (>=1024):** the metrics form one four-column row within a centered,
  capped content area. The notice stays below the row and the shell replaces
  bottom navigation with the always-labelled navigation rail.
- **Navigation and back behavior:** Home is a top-level shell destination, so
  it has no back control or in-page navigation. Metrics is reached only through
  the shell.

## `metrics`

- **All bands:** content starts with a MercurySectionHeader (`This week`). Each
  of the four indicators is rendered as a MercuryMetricValueRow with its value,
  followed by a MercuryStatusBadge for the week-on-week direction and one
  short secondary-text explanation. Dividers use the template divider role.
  No row opens another page and there are no filters or settings in this
  sample.
- **Compact (<600):** the four metric details form one vertical reading order.
  The shell uses bottom navigation.
- **Intermediate (600–1023):** the metric details form two balanced columns,
  preserving Tasks done, In review, Cycle time, Open risks reading order.
- **Wide (>=1024):** the same two-column composition sits inside a centered,
  capped content area beside the always-labelled navigation rail. The layout
  gains useful parallel context without stretching the detail rows.
- **Navigation and back behavior:** Metrics is a top-level shell destination,
  so it has no page-level back control. Home is reached only through the shell.

## `team_pulse_status` widget-extension

This real status-slot extension reads the same demo snapshot as both pages and
shows one concise, non-interactive status such as `Team Pulse · 2 open risks`.
It uses the MercuryStatusBadge pattern, including icon, text, semantics, and
the appropriate success or warning token. It adds no route or duplicate action.

# Component Inventory

| Component from `components.md` | Used by |
|---|---|
| MercurySectionHeader | Home and Metrics section structure |
| MercuryInsetMetric | Home's four at-a-glance values |
| MercuryInlineNotice | Home's current-status explanation |
| MercuryMetricValueRow | Metrics' four detailed indicator rows |
| MercuryStatusBadge | Metrics trends and `team_pulse_status` |

No new primitive, private card, badge, rail, gutter, or navigation component
is proposed. Standard layout widgets may arrange the shared components by
width band but may not introduce visual values outside the pinned tokens.

# Token Bindings

- **Surfaces:** the page uses `tokens.colors.roles.page`; metric/detail content
  uses `surface`; raised controls, if supplied by the shell, use
  `surface_raised`; rail and bottom navigation use `navigation`.
- **Interaction and status:** the active shell destination, focus, and live
  interaction use `accent`; tonal metric fills use `accent_soft`; structural
  separators use `divider`. Success, warning, and error meaning use their
  matching semantic roles and are always paired with icon and text.
- **Text:** high-emphasis values use `text_high`; explanations and demo labels
  use `text_secondary`; any foreground on accent uses `text_on_accent`.
- **Typography:** Poppins roles come from `tokens.typography.roles`; page and
  section hierarchy use the supplied headline/title roles, values and copy use
  body, and compact metric/status labels use label. Only the allowed 400 and
  500 weights are used.
- **Spacing:** component gaps and insets use
  `tokens.spacing.named.compact|related|control|group|section|page` according
  to their documented jobs. No screen-local spacing value is introduced.
- **Shape and lift:** inset metrics use `tokens.radii.control`; grouped content
  uses `tokens.radii.group`; status uses `tokens.radii.circular`. Page
  structure remains flat; any shared raised component uses only
  `tokens.shadows.vocabulary.ambient_card` where the kit already requires it.
- **Appearance:** the pinned template's documented `accent` token is binding.
  Both light and dark semantic values are used deliberately, with System as
  the initial appearance. The binding applies to generated app-mode surfaces,
  including navigation and status, and does not alter PIF's IDE appearance.

# Storage & Tool Surface

Team Pulse uses one immutable, shared in-memory demo snapshot in an approved
project foundation source. The pages and status extension consume the same
model so values cannot disagree. The initial fixture values are Tasks done 24,
In review 6, Cycle time 2.4 days, and Open risks 2, with corresponding
week-on-week demo directions. There is no write flow, account, secret, network
service, database, or Supabase dependency in v0.1.

The conversational build uses this exact sequence:

1. `pif_app_init --template mercury` scaffolds Team Pulse and pins the four
   template layers.
2. `pif_app_page_add` creates `metrics` after the scaffolded `home` page.
3. `pif_app_widget_add` creates `team_pulse_status` in the status slot.
4. Scoped child sessions author the shared demo foundation, then Home, Metrics,
   and the status extension against this approved plan.
5. Each piece closes through `pif_widget_install`; at least one analyzer
   diagnostic is returned to its scoped child, corrected, and successfully
   reinstalled as visible workflow evidence.
6. `pif_app_list` confirms Home and Metrics in the approved order and confirms
   the installed status extension.
7. `pif_app_build` produces the standalone application used for launch,
   restart, appearance, and native-agent verification under #160.

The owner performs no manual file editing. Agent-authored foundation and widget
source stays inside the prepared writable development environment and every
installable piece passes through the analyzer gate.

# Proposed app.yaml

```yaml
id: team-pulse
name: Team Pulse
version: 0.1.0
home: home
pages:
  - home
  - metrics
template: mercury
dependencies: []
```

`team_pulse_status` is an installed widget-extension and therefore is tracked
through its widget manifest/registry rather than added to the page list.

# Open Questions

None. The owner delegated the recommended Home/Metrics correction. The pinned
documented Mercury accent, System-first paired appearance, shared demo
snapshot, two destinations, and status extension are frozen for this build.

# Rule Check

1. **Job sentences:** Home shows the weekly status; Metrics explains the four
   indicators. Each sentence has one job. **PASS**
2. **One in, one out:** the shell is the only route between the two top-level
   destinations; there are no duplicate cards, links, or back controls.
   **PASS**
3. **Back saves:** there is no editing or draft state in v0.1 and no Save,
   Revert, or confirmation affordance. **N/A / PASS**
4. **Navigation:** the shell alone owns Home and Metrics navigation in the
   same order at every width. **PASS**
5. **Stages:** Team Pulse has no linear workflow. **N/A**
6. **Components:** every metric, notice, status, and section structure uses
   the pinned starter kit; no private visual primitive is introduced. **PASS**
7. **Tokens:** all color, type, spacing, radius, divider, and elevation
   decisions bind to `design.json`; text weight stays at or below 500.
   **PASS**
8. **Density:** Home contains only the summary and current status; Metrics
   contains only the detail needed to interpret them. About and duplicate
   Overview navigation were removed. **PASS**
9. **Reuse first:** the design composes the existing Mercury components and
   responsive shell before proposing code. **PASS**
10. **Deviation:** none. The documented pinned accent resolves the recorded
    template drift for this build, and the application appearance remains
    isolated from the IDE. **PASS**
