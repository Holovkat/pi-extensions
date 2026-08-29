# Mercury — Starter Component Kit

Inventory of the starter kit a Mercury-scaffolded pif app composes from. All
geometry, color roles, and behavior below are drawn from the observed shared
implementation (`frontend/triplogger/lib/shared/widgets/mercury_components.dart`,
`app_theme.dart`) and the canonical card spec (`docs/MERCURY_UI_CONTRACT.md`
Part 2). Exact values live in `design.json`; this file says what each component
is for and how it must be used.

**Kit law (from the contract):** one implementation per primitive. Screens
never re-implement a card, badge, rail, gutter, or group locally and never
hand-pick visual values. If a primitive is missing, add it once to the shared
kit, matching this spec, then consume it everywhere. Search for an existing
component before writing a new one.

## Card primitives

### Card (home card pattern — `MercuryHomeCard`)

The default tappable container.

- **Surface:** `surface` role; radius 20 (group); elevation 2 with a
  restrained 10% black ambient shadow; internal padding 16 (group); no border
  by default.
- **Structure:** optional accent-colored leading icon; title (title role) +
  optional subtitle (body-small); body content; trailing chevron when the
  body is tappable; optional top-right corner badge slot; optional bottom
  trailing indicator; optional edge strobe while loading.
- **Use for:** dashboard destinations, master-detail list entries, grouped
  operational summaries.
- **Do not:** nest a card inside it, add a local radius or shadow, or put a
  second tap affordance that duplicates the body action.

### Grouped panel (`MercuryGroupedPanel`)

One shared surface for a related stack of actionable rows. The group owns
background, radius 20, elevation 2, row insets (16 horizontal), and hairline
dividers (indent 16); children keep their own interaction and semantics.
Reorderable variant uses the canonical reorder gutter (44px wide, 7px accent
rail) — the surrounding page never scrolls while a stack reorders.

### Settings group + row (`MercurySettingsGroup` / `MercurySettingsRow`)

- **Group:** `surface` role, radius 20, optional hairline dividers (indent 16).
- **Row:** min height 48; content padding 16 horizontal / 4 vertical; leading
  icon optional; trailing is a chevron (navigation) or a switch (toggle);
  optional subtitle or custom subtitle widget.
- **Semantics:** combined label; button semantics when tappable; toggled state
  exposed; `, disabled` appended to the label when disabled — never rely on
  opacity alone.
- **Use for:** settings pages, preference lists, detail rows inside one flat
  rounded group per section.

## Status components

### Status badge (`MercuryStatusBadge`)

- **Tones:** `neutral`, `success`, `warning`, `error`, `disabled` (from
  `MercuryStatusTone`).
- **Geometry:** pill (radius 999); padding 12 horizontal / 8 vertical; tone
  color at 12% opacity background; 1px tone-color border; 18px icon + label.
- **Icons observed:** neutral `info_outline`, success `check_circle_outline`,
  warning `warning_amber_rounded`, error `error_outline`, disabled `block`.
- **Law:** every tone carries an icon and text, so meaning never depends on
  color alone; the disabled tone appends ", disabled" to the semantic label.

### Corner badge (`MercuryCornerBadge`)

Compact count/status ribbon integrated into a card's top-right corner: solid
tone color, bottom-left radius 20 only, padding 18/10/16/10, 16px icon +
label-medium text in the surface color. Does not consume a content row and
never uses a pill silhouette. Use for counts on navigation-style cards.

### Inline notice (`MercuryInlineNotice`)

Status badge plus an optional outlined retry action, wrapped. Warning and
error tones are live regions. Use for non-blocking operational messages inside
a page.

## Metric components

### Metric chip (`MercuryMetricChip`)

Single-line tonal value chip: `accent_soft` at 42% opacity, radius 12,
padding 8 horizontal / 4 vertical. Keep values unit-free when the unit belongs
to the label, so columns align and scan. Use inside cards for compact
supporting values.

### Inset metric (`MercuryInsetMetric`)

Two-line variant for metric columns: value (title-small, weight 500) over
label (body-small) on the same tonal background, radius 12, padding 8.
Use when a card shows a small set of parallel metrics.

### Metric value row (`MercuryMetricValueRow`)

Inline icon (20px) + label (body-medium) + value (title-medium) in a wrap.
Use for labeled values inside a record rather than a chip cluster.

## Structure components

### Section header (`MercurySectionHeader`)

Title-role text with an optional single trailing action; 4px side padding, 8px
bottom padding; announced as a semantics header. One section header per
content section; do not use it as a page title.

### Centered page header (`MercuryCenteredPageHeader` + `MercuryCircularBackButton`)

64px header for focused task pages: centered title (title-large, ellipsized),
optional eyebrow (label-small, accent, +1.8 letter spacing), optional subtitle
(label-small, secondary), a 48px circular tonal back control leading, and at
most one trailing text action. 64px horizontal insets reserve space so long
titles never displace Back or the trailing action. Exactly one back
affordance per screen (Screen Composition Law).

### State view (`MercuryStateView`)

Empty and error variants: 40px icon, centered title (title-medium), message
(body), Retry filled button on error. Error variant is a live region. Use for
empty lists and failed loads instead of ad-hoc placeholders.

### Responsive grid (`MercuryResponsiveGrid`)

1 column below 600, 2 at 600+, 3 at 1024+; gutter 16 at one column, 24
otherwise; reading-order focus traversal. Use it to lay out card grids instead
of hand-rolling `GridView` counts.

## Buttons, chips, fields (theme-level kit)

- **Primary button:** accent fill, `text_on_accent` foreground, radius 12,
  padding 24h/12v, elevation 1.
- **Outlined button:** accent foreground + 1px accent border, same geometry.
- **Text button:** accent foreground, radius 12, padding 16h/8v.
- **Chip:** radius 8, hairline divider border, label-role text; selected
  chips shift to the `accent_soft` tonal container; status chips add an icon
  and text.
- **Input field:** filled raised surface, radius 12, 16px padding, 1px
  divider stroke at rest, 2px accent focus outline, error outline
  strengthened to 2px while focused.
- **Button states:** Material state overlays, progress indicators, disabled
  semantics, visible keyboard focus.

## Composition rules

- One flat rounded group (radius 20) per content section; no nested cards or
  decorative panels inside panels.
- Watermark/gutter treatments (sequence watermarks, accent rails) are
  structural elements of ordered instruction/step cards, not decoration to
  sprinkle onto other cards.
- Colors, type roles, spacing, and radii come only from `design.json`
  (`design.json` → `tokens.*`); weights capped at 500.
- Every status color is paired with text, an icon, or semantic output.
