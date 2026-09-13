# Team Pulse build-flow verification — 13 September 2026

Task: [#206](https://github.com/Holovkat/pi-extensions/issues/206) (evidence also for #158 and #160) · Branch `codex/pif-app-builder-154` · Sample workspace: `~/workspace/team-pulse`

## What ran

The approved Team Pulse sample (`features/mercury-sample/pif_app/design.md`, approved at `e74d40e6`) was built through the real conversational pif build flow — no manual file edits to app source. A headless hub (`PIF_AUTOSTART=1 PIF_NO_FLUTTER=1`, scratch `PIF_APP_DIR`, port 39999) hosted a fresh workspace, and a WS driver relayed the approved plan to the host session and three scoped child sessions, exactly the path the Agent Console drives.

| Step | Tool / author | Result |
|------|---------------|--------|
| 1 | host → `pif_app_init {name: Team Pulse, template: mercury}` | template layers pinned to `pif_app/template/`, Home scaffolded + installed |
| 2 | host → `pif_app_page_add {Metrics}` | metrics page scaffolded + installed, manifest order `home, metrics` |
| 3 | host → `pif_app_widget_add {Team Pulse Status, slot: status}` | status widget-extension scaffolded + installed |
| 4 | child "Foundation & Home" | `team_pulse_data.dart` (immutable demo snapshot: 24 / 6 / 2.4 days / 2 risks) + approved Home composition; install 1 **failed the analyzer gate** (see below), corrected, install 2 passed |
| 5 | child "Metrics Author" | approved Metrics composition importing the shared foundation; install passed first pass |
| 6 | child "Status Author" | `Team Pulse · 2 open risks` badge in the status slot; install passed first pass |
| 7 | host → `pif_app_list` | confirmed name, page order, install states, status extension |

## Analyzer gate / retry evidence (#206 acceptance)

Four `pif_widget_install` calls are recorded in the transcripts:

1. `home` — **ok: false, phase analyze**: `warning - home.dart:244:7 - The declaration '_MercuryMetricValueRow' isn't referenced. — unused_element. 1 issue found.`
2. `home` — corrected via an in-session edit, reinstalled **ok: true** (phase reload).
3. `metrics` — **ok: true** first pass.
4. `team_pulse_status` — **ok: true** first pass.

This is the conversational diagnostics/retry cycle the ticket requires, produced naturally by the gate. Transcripts (pi session JSONL, no secrets found on scan): [`docs/reviews/evidence/team-pulse-2026-09-13/`](./evidence/team-pulse-2026-09-13/) — `session_c53a8ff1.jsonl` (Foundation & Home), `session_31a87994.jsonl` (Metrics), `session_d5912659.jsonl` (Status), `host.jsonl` (host steps). The live workspace retains the same sessions in `.pi/pif/` for in-app inspection.

## Design conformance

- Pages and status extension implement the approved compositions: Home's two section headers, four inset metrics and warning notice; Metrics' four value rows with direction badges; the non-interactive status badge. Responsive bands 600/1024, capped 1280 content.
- All color/typography/spacing/radius values bind to the documented `design.json` pairs (weights 400/500 only, spacing 4/8/12/16/24/32, radii 12/20/999, 12% tint + 1px tone border status badges, Poppins with sans-serif fallback). Light/dark both resolve deliberately.
- One shared immutable foundation source is consumed by both pages and the status extension, so values cannot disagree.
- Repo fixture updated in place (`features/mercury-sample/pif_app/`); `dart analyze` over the three overlay widget dirs against the repo `pif` package passes clean.

## Appearance binding (#212)

The samples render inside the app-mode `Theme` shipped by #212 (`d9acc2f3`): navigation, page stage and status dock take the pinned Mercury appearance while the IDE stays untouched. Combined Dev UAT for #212 + #206 happens against this workspace in the canonical installed pif.

## Boundaries

- `pif_app_build`/export was not run here — export artifacts and launch/restart acceptance belong to #160's verification per the ticket handoff.
- #160 still owns regression test additions, the final full gate and combined acceptance; this report is implementation evidence, not a closed gate.
