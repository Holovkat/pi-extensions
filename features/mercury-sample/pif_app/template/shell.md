# Mercury — Responsive Shell Pattern

The single-codebase layout recipe for Mercury apps: one widget tree that
adapts by width, not two codebases. Observed in the Mercury shell
(`mercury_shell.dart`): the same `Scaffold` renders a navigation rail at wide
widths and a bottom navigation bar below the breakpoint — destinations, state,
and badges are shared between both.

## The recipe

```
Scaffold
├─ body: Row (only when width >= 1024)
│   ├─ NavigationRail  (always labeled)
│   ├─ VerticalDivider (1px, divider role)
│   └─ Expanded(content)
└─ bottomNavigationBar: (only when width < 1024)
    NavigationBar (same destinations, same order)
```

Switch on `MediaQuery.sizeOf(context).width >= 1024` (the observed
`MercuryBreakpoints.expandedNavigation`). Render **either** the rail row
**or** the plain content — never both, and never the bottom bar while the
rail is visible.

## Navigation rules

- **At >=1024px:** an always-labeled navigation rail
  (`NavigationRailLabelType.all`) for the primary destinations, followed by a
  1px vertical divider, then content. Detailed administration may extend the
  rail to 260px and keep persistent panes.
- **Below 1024px:** bottom navigation for the same compact set of primary
  destinations; navigation stacks and system Back express hierarchy.
- **Same destinations, same order, both modes.** Unread badges resolve the
  same semantic colors and accessible announcement in bar and rail.
- **No dead placeholders.** Desktop-only administrative modules do not appear
  as disabled destinations on mobile; destinations follow role and platform
  capability.
- **Active destination:** `accent_soft` tonal background with an accent
  icon/foreground signal.
- **The shell owns navigation.** Pages never add in-page rails, tab rows, or
  card grids that duplicate shell destinations (Screen Composition Law).

## One job per screen

Every screen performs exactly one job, stated in one sentence before it is
composed. One circular back control plus breadcrumbs; one primary action;
progressive disclosure replaces rather than accumulates; distinct jobs get
distinct surfaces. Full law: `rules.md`. The shell recipe serves this law —
navigation lives in the shell so each page stays a single-job surface.

## Width bands

| Band | Layout behavior |
|---|---|
| < 600 (compact) | One clear task; scrollable card stacks (1 column); bottom navigation; safe-area-aware content; controls usable without hover; full-bleed maps allowed with bounded circular controls |
| 600–1023 | Intermediate thresholds admit horizontal filters, two-column forms, 2-column card grids, or master-detail panes where the workflow gains from them (treat 720/840/900 as guidance) |
| >= 1024 | Navigation rail replaces bottom navigation; card grids go 3-column; multi-column tool layouts are allowed |

Thresholds: 600 and 1024 are code-observed law; 720/840/900 are documented
guidance. Content stops stretching at 1280px (information-heavy workspaces
may use 1440px) — center or cap the content column rather than stretching
cards edge to edge. Desktop earns density through persistent context
(260–430px list/section panes, master-detail), not by widening mobile cards.

## Page anatomy

- **Dashboard/workspace pages:** content column on the `page` background;
  cards and grouped panels on `surface`; section headers (title role) between
  sections; card grids via the responsive grid (1/2/3 columns).
- **Focused task pages:** 64px centered page header — 48px circular tonal
  back control, centered ellipsized title, at most one trailing action.
- **Mobile operational actions:** footer action pills — 64x32px tonal icon
  pill above a compact centered label, inside a 112-wide, min-72-high target;
  actions wrap as a centered group and stay understandable without the icon.
- **Sheets for secondary jobs:** slide-up sheets carry a grabber and a small
  circular back control on deeper panes; deeper panes stack inside the sheet.
- **Empty/error states:** the shared state view (icon, title, message, Retry
  on error) — never ad-hoc placeholders.

## Adaptive, not stretched

Share product truth and system tokens across widths; compose each band for
its actual job (Purposeful Adaptation Rule). Mobile is a role-filtered
operational surface (current work, status, quick actions lead); desktop is an
administration workspace (persistent navigation, filters, master-detail,
denser records). Do not stretch a mobile card stack across a desktop viewport
and call it adaptive, and do not force desktop-only tools into the mobile
field workflow.

## Pif binding notes

- Pages are pif widgets with `slot: page` — full-screen, rendered in the
  app-mode page stage; the shell chrome described here is the stage around
  them.
- `app.yaml` is the single source of truth for `home` and the ordered
  `pages` list; the rail/bar destinations mirror that order.
- The design pass (`skills/pif-app-designer/SKILL.md`) must assign every page
  to a width-band layout plan (compact/intermediate/wide) before any widget is
  built; the approved plan is law inside the build loop.
