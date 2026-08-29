# Mercury — Named Rules (agent-obeyable)

These rules are binding for every screen, widget, and workflow change built
from the Mercury template. They are rewritten from the Mercury sources
(`DESIGN.md`, `docs/MERCURY_VISUAL_STANDARD.md`, `docs/MERCURY_UI_CONTRACT.md`)
into constraints an agent can check line by line. Personal preference, model
habit, and "the framework default" never override them.

## Authority chain (highest wins on conflict)

1. An explicit owner instruction in the current task.
2. This file (`rules.md`) — the template contract.
3. `design.json` (semantic tokens) and the Mercury sources it was extracted
   from (`DESIGN.md`, `docs/MERCURY_VISUAL_STANDARD.md`).
4. Accepted design-QA evidence records that remain consistent with the owner
   direction and the sources above.

Framework defaults (Material templates, generic scaffold patterns, "helpful"
extra affordances) rank **below all of the above**. If this chain does not
answer a question, **ask the owner; do not invent.** Any departure from a rule
below is named, justified, and owner-approved **before it ships** — "the screen
is simple" and "users may expect it" are not justifications.

---

## The No-Bold Rule

- MUST NOT render any user-facing text above weight 500 (Medium). No app
  surface, document, map label, or message uses Bold or Black.
- MUST use only Regular (400) and Medium (500) for text hierarchy.
- MUST create hierarchy from text role, size, spacing, and tone — never from
  weight.
- MUST choose the semantic text role first (display/headline/title/body/label)
  and inherit its scale; MUST NOT hand-pick a font size per screen (Role
  Before Size Rule).
- MUST let system text scaling pass through with no application-level maximum.
- Record: the shipped Mercury implementation pins all roles to weight 300 as
  an owner-approved legibility exception for field devices. That exception is
  **not** a template default; new builds use 400/500 unless the owner says
  otherwise. The 500 cap always holds.

## The Signal-Not-Decoration Rule

- MUST use the accent token only as a semantic signal: interaction, focus,
  selection, progress, and live operational state.
- MUST NOT flood a screen with accent, use it as ambient decoration, or tint
  large passive regions with it.
- MUST pair every status color with text, an icon, or a semantic announcement
  — color is never the sole signal.
- MUST take secondary/tonal surfaces from `accent_soft`, not from accent at
  low opacity, unless extending an observed pattern (metric chips use
  `accent_soft` at 42% opacity — that treatment is canonical for inset
  metrics).
- MUST keep large content areas on the page/surface/raised-surface roles;
  accent belongs to controls, badges, focus rings, and active navigation.

## The Paired Appearance Rule

- MUST resolve every semantic role (page, surface, raised surface, navigation,
  accent, accent soft, divider, foregrounds, status) deliberately in **both**
  light and dark appearance.
- MUST consume semantic role names from `design.json` / the theme extension —
  MUST NOT hard-code hex values in feature code.
- MUST NOT produce a dark theme by mechanically inverting the light palette;
  each role resolves to its own dark value.
- When overriding an accent for contrast, MUST preserve the reference hue and
  adjust lightness until white (light) / dark (dark) labels meet WCAG AA.

## The Screen Composition Law (one in, one out)

- MUST state the screen's single job in one sentence before composing it, and
  MUST remove or relocate anything that does not serve that sentence.
- MUST provide exactly one way in and one way out: one circular back control
  (44/48px tonal circle) plus breadcrumbs, and one primary action in the
  footer or as the single trailing header action.
- MUST NOT offer two affordances that reach the same outcome from one surface;
  MUST NOT add a second back (text "back" links, extra chevrons, duplicate
  close actions).
- MUST let leaving the screen implicitly save safe draft changes; `Revert`
  appears only after a real change; no explicit Save buttons for inline edits
  and no "are you sure" interrupts for safe drafts.
- MUST let the shell own navigation: no in-page rails, tab rows, or card grids
  that duplicate shell destinations. In-page navigation is only the linear
  stage sequence of the current workflow.
- MUST make progressive disclosure replace, never accumulate: selecting a card
  replaces the choice list with that task's stages; previous choices do not
  stack above or beside the selection.
- MUST run linear workflows forward, starting at stage 1 in the accepted
  order; existing records open in the locked review state and editing requires
  the explicit edit/unlock action.
- MUST give distinct jobs distinct surfaces: calculation previews, offline
  package management, master-data creation, and secondary object authoring
  never live inside another task's form.
- MUST collapse or split duplicated similar functions within one form — "the
  user might want both" is not a justification.
- MUST show only what the operator needs for this screen's job now (density
  serves the job). A screen is finished when nothing can be removed, not when
  nothing can be added.
- MUST route any deviation through the owner before shipping.

## Supporting rules (from the same sources — equally binding)

- **Tonal-First / Lift With Purpose.** Establish hierarchy with semantic
  surface levels; shadow confirms a raised role instead of inventing one.
  Reserve visible lift for actionable cards, decisions, and controls floating
  over complex content. No arbitrary shadows.
- **Nested-Radius Rule.** Child controls use a tighter radius than the group
  containing them; never mix unrelated radius roles.
- **Pill Has a Job Rule.** Reserve full pills (999 radius) for compact
  actions, status, and circular navigation — not ordinary content containers.
- **One Implementation Per Primitive.** Never re-implement a card, watermark,
  rail, gutter, or badge locally; compose the shared component and extend it
  in the shared file when a variant is genuinely needed. A private card/badge
  widget inside a screen file is a defect.
- **Flat Groups.** Prefer one flat rounded group (radius 20) per content
  section; do not nest decorative panels inside decorative panels.
- **Purposeful Adaptation / Real-Estate.** Share product truth and tokens
  across platforms but compose each viewport for its actual job; desktop earns
  density through useful persistent context, not by widening cards. Desktop-
  only modules do not leave dead navigation placeholders on mobile.
- **Plain-Language Rule.** Typography clarifies operational meaning before it
  expresses brand.
- **Reuse First.** Search for the existing shared component/pattern before
  writing a new one.

## Pre-completion check (paste into any Mercury UI task)

```text
MERCURY TEMPLATE CHECK (pif/templates/mercury/rules.md)
1. Job sentence: this screen's single job is ______. Everything added serves
   that sentence; anything else was moved or removed.
2. One in, one out: exactly one circular back; exactly one primary action; no
   duplicate affordances for the same outcome.
3. Back saves; Revert only when dirty; no added Save buttons or confirms for
   safe drafts.
4. Navigation: no in-page nav duplicating the shell; only the workflow's
   linear stages navigate within the page.
5. Stages: the accepted stage order is preserved exactly.
6. Components: every card/badge/rail/gutter/chip comes from the template kit
   (components.md). No private card, badge, or gutter widget; no hand-picked
   visual values.
7. Tokens: colors, type roles, spacing, radii only from design.json; weights
   capped at 500.
8. Density: removed everything the job sentence does not need.
9. Reuse first: searched for the existing shared component before writing a
   new one.
10. Deviation: none — or it is named, justified, and owner-approved in the
    task.
```

A change that cannot check every line is not done: fix it, or raise the
deviation to the owner.
