# Team Pulse — UI plan (design pass)

## Brief (owner, #158)
"A small multi-page app, e.g. a dashboard with 2–3 pages, built from the Mercury template — the sample app that proves the agentic build flow end to end."

Restatement: a compact two-page team dashboard — a landing Home page and a
Metrics page with a few stat cards — scaffolded from the Mercury template
so every surface uses the template's tokens, rules, and component kit.

## Screens (Screen Composition Law — one job per screen)
1. **Home** — job: land the user and route them. Composes a centered page
   header ("Team Pulse"), a MercurySectionHeader ("Quick access"), and two
   MercuryHomeCard links (Overview → Metrics, About). Wide band: cards in a
   two-column grid; compact band: single column.
2. **Metrics** — job: show team stats at a glance. Composes a
   MercurySectionHeader ("This week") and a responsive grid of four
   MercuryMetricChip cards (Tasks done, In review, Cycle time, Open risks)
   with placeholder values until a real data source lands. Navigation back
   via the shell rail/bottom bar (Mercury shell pattern — rail ≥1024px,
   bottom nav below).

## Token bindings (design.json — no raw values)
- Surfaces: `page` / `surface` / `surfaceRaised`; navigation: `navigation`.
- Accent on primary actions and metric highlights: `accent` (soft variant
  `accentSoft` for chip fills).
- Type: Poppins roles from the template (cap 500); spacing on the 4/8/12/16
  scale; radii 8/12 as per component specs.

## Named rules in force
No-Bold Rule, Signal Not Decoration, Paired Appearance Rule, Screen
Composition Law; authority chain per rules.md.

## Storage & tool surface
v0.1 stores metric values as local placeholder state in the page widgets
(session-scoped). No backend. The build loop uses only: `pif_app_init
--template mercury`, `pif_app_page_add`, `pif_app_list`.

## Open questions
- Accent colour: EVID-DRIFT-1 (documented teal vs shipped near-black) —
  pending owner call; this build uses the template's documented `accent`
  token unchanged.
