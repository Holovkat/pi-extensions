# pif — Pi-Native Flutter Agentic IDE

- **Date:** 2026-08-15
- **Status:** Approved — Phase 1 shipped; app-builder model settled by Task #154 (2026-08-29)
- **Owner:** Tony Holovka
- **Repo:** pi-extensions (single repo: extension + Flutter app)
- **Tracker:** Epic [#120](https://github.com/Holovkat/pi-extensions/issues/120) · Sprint [#121](https://github.com/Holovkat/pi-extensions/issues/121) · Tasks #122–#129
- **Successor (app builder):** Epic [#152](https://github.com/Holovkat/pi-extensions/issues/152) · Sprint [#153](https://github.com/Holovkat/pi-extensions/issues/153) · Tasks #154–#160 — pif as the foundation applications are built on; rewrote the Phase 2/3 direction (done — Task #154, 2026-08-29: Roadmap realignment, QA audit, and settled app-builder model below)

## Vision

A next-generation agentic IDE that replaces the terminal surface with a Pi-native, Flutter-first desktop shell. It fuses Pi's modularity model (extensions) with Flutter's modularity model (widgets): **everything on screen is a widget, every widget is an extension that can be turned on or off**, the app contains its own widget store, and Pi itself builds new widgets into the running shell conversationally. Codex-style paneling: a central work area plus any number of dockable widget windows. Start from a small set of base primitives and grow the rest of the system from those primitives, using the system itself.

## Decisions (settled during brainstorming)

| Decision | Choice | Alternatives rejected |
|---|---|---|
| Host topology | **Pi hosts.** A pi extension (`extensions/pif.ts`) is the hub; it launches the Flutter shell, which connects back over a local WebSocket | Flutter app spawning pi internally; standalone daemon in the middle |
| Dynamic widget mechanism | **Real Dart source, run from source.** Shell runs via `flutter run --machine` (JIT); widgets hot-reload when installed/changed | RFW interpreted widgets (deferred — Sprint 3 RFW lane, see Roadmap realignment); dart_eval |
| v1 base widgets | Agent Console, Session Rail, Terminal (pty), Widget Store panel, Status Bar | Diff Viewer and File Explorer deferred, deliberately: they are the first dogfooded widgets Pi builds through pif itself |
| Repo layout | Everything in pi-extensions: `extensions/pif.ts` + Flutter app in `pif/` | Separate repo for the shell |
| Name | **pif** (extension `pif`, app dir `pif/`, widget namespace `pif.*`) | pi-deck, pi-studio, pi-shell |
| Scope of this spec | Full platform, phased: Phase 1 = hub + contract + primitives; later phases = ecosystem and platform features | Minimal mirror-only bridge; unphased big-bang build |

## Architecture

Three cooperating processes, pi at the root:

```
┌────────────────────── pi (interactive host session) ──────────────────────┐
│  extensions/pif.ts  =  the pif hub                                        │
│  • WS server (localhost:31415 default, configurable) — authoritative state│
│  • Session manager: mirrors host session + spawns `pi --mode rpc` children│
│  • Widget manager: manifests, registry codegen, enable/disable, catalog   │
│  • Flutter supervisor: `flutter run --machine` (programmatic hot reload)  │
│  • Pi tools: pif_widget_*, pif_layout, pif_shell_* (agents drive shell)   │
└──────────┬─────────────────────────────────────┬───────────────────────────┘
           │ spawns/supervises                   │ WS (pif bus)
  ┌────────▼─────────┐                  ┌────────▼─────────┐
  │ pi --mode rpc    │  (0..n children) │ pif shell        │
  │ child sessions   │                  │ Flutter, pif/    │
  └──────────────────┘                  │ run from source  │
                                        └──────────────────┘
```

### Components

1. **pif hub** (`extensions/pif.ts`, TypeScript): started by `/pif` in the host pi session. Owns all authoritative state: session registry, widget registry, layout, store catalog. Companion commands `/pif-stop`, `/pif-status`; TUI status via `ctx.ui.setStatus` (coms pattern).
2. **pif shell** (`pif/`, Flutter macOS desktop, run from source): a rendering client with local capabilities (pty terminal). Connects to the hub WS; requests a state snapshot on connect/reconnect.
3. **Agent sessions:**
   - *Host session* mirrored onto the bus via extension events (`pi.on(...)`); UI input injected with `pi.sendMessage(..., { deliverAs: "followUp", triggerTurn: true })` (proven in coms.ts).
   - *Spawned sessions*: `pi --mode rpc --session <file>` child processes with `prompt` / `steer` / `follow_up` / `abort` and session reuse (proven in dev-pipeline.ts).
4. **Flutter supervision symmetry:** the hub drives `flutter run --machine` over JSON-RPC (hot reload `app.restart`, hot restart, stop, lifecycle events) exactly the way extensions drive `pi --mode rpc`. This closes the loop that makes "Pi writes a widget and it appears live" possible.

## The pif bus (protocol)

Single WebSocket. JSON envelopes: `{v, id, ts, channel, type, payload}`.

| Channel | Hub → Shell | Shell → Hub |
|---|---|---|
| `session/*` | created, state, message_delta, tool_event, turn_end, ended | input, steer, abort, spawn, select |
| `widget/*` | registry_state, reload_result, widget_event | toggle, uninstall, widget_action |
| `store/*` | catalog_state, install_result | install, refresh |
| `shell/*` | snapshot, layout_state, health | snapshot_request, layout_change, focus |

Rules:

- The **hub is the source of truth**. The shell renders hub state and requests `shell/snapshot` on every (re)connect; deltas apply idempotently after the snapshot. A shell crash or hub restart never desyncs.
- The terminal is app-local (pty spawned by the shell in the workspace cwd); no terminal traffic crosses the bus.

## Widget contract (everything is a widget)

```
pif/
  lib/
    core/                      # shell frame: docking, bus client, PifHost API (not widgets)
    widgets/                   # ALL widgets, base primitives included
      agent_console/
        widget.yaml            # manifest
        agent_console.dart     # PifWidgetPlugin implementation
      session_rail/ ...
      terminal/ ...
      widget_store/ ...
      status_bar/ ...
    widget_registry.g.dart     # GENERATED by the hub (id → factory imports)
  catalog/                     # local store: available-but-not-installed widget folders
```

- **Manifest (`widget.yaml`)**: `id`, `name`, `version`, `description`, `slot` (left|center|right|bottom|status; the app builder adds `page` — see App-builder model), `core` (bool), `tags`, `dart_dependencies` (extra pub packages, optional).
- **Dart contract** (the only interface, base primitives included):

```dart
abstract class PifWidgetPlugin {
  PifWidgetMeta get meta;
  Widget build(BuildContext context, PifHost host);
}
```

- **`PifHost`** is a widget's only door to the world: `host.bus` (typed event streams + send), `host.sessions` (list/spawn/input/steer/abort), `host.layout` (open/focus/move panels), `host.storage` (per-widget persisted KV), `host.theme`.
- **Registry**: `widget_registry.g.dart` is generated by the hub from installed manifests (plain string templating, no build_runner). Enabled/disabled state is hub state (`widget/registry_state`); disabling a widget closes its panels.
- **Install pipeline**: copy folder from `catalog/` into `lib/widgets/` → `dart analyze` gate → registry regen → hot reload. If `dart_dependencies` present: `pub get` + hot **restart** instead. Uninstall = deregister + move folder back to `catalog/` (source is never destroyed).
- **Core safety**: base widgets are `core: true` (disable allowed, uninstall refused). Hub state lives extension-side, so the shell can never be bricked from inside the shell; `/pif` or a pi tool always recovers.

## Shell layout + base widgets (Codex-style)

Docking frame with five slots: **left rail, center stage (tabbed + splittable), right column, bottom dock, status strip**. Widgets declare a preferred slot; the user drags/splits/tabs panels freely ("any number of widget windows"). Layout persists per-project in `.pi/pif/layout.json` and flows through the hub so agents can rearrange the workspace via `pif_layout`.

| Widget | Slot | v1 behavior |
|---|---|---|
| Agent Console | center (tab per session) | Streamed markdown, tool-call cards with live output, input box, steer-while-running, abort |
| Session Rail | left | Host session pinned on top; spawned sessions with state (idle/running/awaiting-input) and model badges; New Session (cwd, model, prompt preset); click opens console tab |
| Terminal | bottom | pty tabs in the workspace cwd (flutter_pty + xterm.dart) |
| Widget Store | right (on demand) | Installed list (toggle/uninstall) + Catalog list (install); compile/reload results surface here |
| Status Bar | status strip | Hub connection, reload state, active session model + token usage, workspace path |

## Pi tools: the widget-building loop

Tools connect to the hub over its local socket (existing control-socket pattern), so the host session, spawned children, and separate terminal pi sessions can all drive the shell:

| Tool | Effect |
|---|---|
| `pif_widget_create` | Scaffolds `lib/widgets/<id>/` (manifest + contract stub) from id/name/slot/spec; returns paths |
| `pif_widget_install` | Registers a widget folder already in `lib/widgets/` (the create path) or copies it from `catalog/` first (the store path) → `dart analyze` gate → registry regen → hot reload (restart if deps changed) → **returns compiler diagnostics on failure** |
| `pif_widget_toggle` / `pif_widget_uninstall` / `pif_widget_list` | Registry state management |
| `pif_layout` | Open/focus/move/close panels; save/load layout presets |
| `pif_shell_status` / `pif_reload` | Health; manual reload/restart |

The signature loop: "build me a diff viewer widget" → `pif_widget_create` → agent writes real Dart with its normal file tools → `pif_widget_install` → diagnostics round-trip until green → widget appears in the live shell → agent opens it via `pif_layout`. For whole applications, the app-builder design pass (task #158) runs before this loop: brief + template → per-project UI plan (`pif_app/design.md`) → owner approval → build (recipe is law — no layout renegotiation inside the build loop). The app-builder tool surface (`pif_app_*`) is settled in the App-builder model section below.

## Error handling

- **WS drop** → shell reconnects with backoff + snapshot resync (hub authoritative).
- **Flutter process death** → hub detects via machine protocol, offers relaunch; sessions live in the hub, nothing lost.
- **Hot reload failure** → escalate: reload → hot restart → report to caller and Store panel.
- **Bad widget code** → `dart analyze` gate keeps it out of the registry (shell never sees it); runtime exceptions are caught by a per-panel error boundary rendered as an error card with a disable action.
- **Child pi crash** → session marked ended with exit info; transcript retained; respawn offered.
- **Host mirror granularity risk**: delta-level mirroring of the host session depends on which events the extension API surfaces; fallback is tailing the host session JSONL for full fidelity. Spawned sessions have full fidelity by construction.

## Testing

- **Extension (hub)**: unit tests in the repo's existing `*.test.mjs` style — envelope codec, registry codegen (golden file), session manager against a scripted fake `pi --mode rpc` subprocess, store install pipeline in tmp dirs.
- **Flutter (shell)**: `flutter test` for the contract host and each base widget against a fake bus; `dart analyze` clean as a gate; one integration smoke test against a mock hub.
- **Phase 1 acceptance (dogfood)**: use pif itself to have Pi build the Diff Viewer widget end to end (create → implement → install → visible → usable).

## Roadmap realignment (2026-08-29 — supersedes the original Phase 2 → 3 order)

Recorded on epic [#152](https://github.com/Holovkat/pi-extensions/issues/152) ("Roadmap Realignment"); the app-builder direction reorders the original Ecosystem → Platform phasing around packaging a project's application. Phase 1 is complete (exit: diff-viewer dogfood passed). The original **Phase 2 — Ecosystem** and **Phase 3 — Platform** sections are retired; their items are dispositioned below so spec and tracker tell one story.

- **Already complete despite being listed as Phase 2**: layout presets (`pif_layout` save/load, presets under `.pi/pif/presets/` — shipped with the Phase 1 iteration waves) and the diff viewer (the Phase 1 exit dogfood, installed under `pif/lib/widgets/diff_viewer/`).
- **Pulled forward from Phase 3 into the app-builder sprint**: packaged release mode with a frozen widget set (AOT) — repurposed from "package the IDE" to "package a project's application" (Task 6 / #159).
- **Pulled forward from Sprint 2 as precursor lane 1 (2026-08-23; shipped)**: the tracker panel — a repo-synced Kanban board for epics/sprints/tasks with Markdown detail, drag-between-columns write-back to the tracker, and an offline cache (Sprint #163, tasks #164–#166, plus the CRUD iteration #168). It was the first large non-console widget dogfood and tracked the epic itself from inside pif.
- **Precursor lane 2 (added 2026-08-29)**: **app templates + design-first build** — the agentic build flow gains a design pass (brief → template-backed UI plan → owner approval → build; recipe is law), with **FMS Mercury as the first template**. Task #178 authors the Mercury template (`pif/templates/mercury/`) and the `pif-app-designer` skill (`skills/pif-app-designer/SKILL.md`); #157 gains `pif_app_init --template`; #158 consumes both. Sprint 2's theming item is absorbed by templates.
- **Subsumed from Phase 2**: on-demand builds — the same agentic loop, generalized from single widgets to whole applications (Task 5 / #158).

Remaining work, in order, as future sprints under epic #152 (no issues created yet — planned when reached, per repo convention):

- **Sprint 2 — Ecosystem**: remote git catalogs as an installable widget-pack source layer (builds directly on #155's layered sources); per-widget settings schema; theming (themeMap integration — absorbed by app templates, see precursor lane 2); file-explorer widget, built through the #158 agentic flow as the ecosystem dogfood.
- **Sprint 3 — Platform & sharing**: publish/share widgets across machines via coms/council (depends on epic #112); trust/signing for third-party widgets (mandatory once remote catalogs land); RFW lane for runtime widget installation in shipped AOT apps (the answer to "pi, add a page to this app" on a shipped app); multi-window; non-macOS targets.

Current sprint (#153) task order: #154 (this update) → #155 (hub/TS) ∥ #156 (shell/Dart) → #157 → #158 / #159 → #160 (epic verification). The settled app-builder model follows.

## QA alignment audit (Task #154, 2026-08-29)

**Gate at HEAD: PASS.** Branch `codex/pif-app-builder-154`, commit `7237e0b`. `npm run test:pif` → node suites (`pif.test.mjs`, `pif.integration.test.mjs`) green, `dart analyze` clean, `flutter test` 45/45 ("All tests passed!"), exit 0 (session run log). Setup note: `node_modules` was absent, so `npm install` ran first; no other setup required.

Two weeks of shipped pif work (commits `64eca93` → `7237e0b`: hub, bus, docking shell, standalone launcher, packaging) reviewed against the app-builder vision:

**Reusable as-is**
- **Widget engine**: install pipeline + `dart analyze` gate + registry codegen + hot reload (`pif_widget_create/install/toggle/uninstall/list`). The create → write Dart → install → live loop is the app-builder loop at widget scale, already proven by the diff-viewer and tracker-board dogfoods.
- **Hub hardening** (remediation wave): per-launch WS token (b93c897), scrubbed child env + atomic hub start (553762c), input validation (dcf4304), bus resilience — queued sends, single connect, real hub probe (3d48fdc). Ships unchanged inside exported apps.
- **Docking shell core** (`pif/lib/core/`): `PifHost` API, bus client, panel error boundary, snapshot/reconnect resync. App mode reuses the same widget-host surface inside a page stage.
- **Session manager**: `pi --mode rpc` children, SQLite persistence, resume from session files (d002d9a, 3abad36). Drives the agentic build flow (#158) unchanged.
- **Standalone launcher + packaging**: project picker + bundled pi (a13cc1d), re-sign + actionable script errors (ff92e3a), self-healing relaunch + orphan hub shutdown (ea1f93a), `scripts/build-pif-app.sh`. These are the export pipeline's assembly/bundle/re-sign steps; what changes is which registry gets compiled and which entrypoint runs.
- **Tracker board shipped as `core: true`** (2d63281) — proves the "always present in shipped apps" path for core widgets.

**Missing (gaps against the vision)**
- **No page concept**: `PifSlot` is `left|center|right|bottom|status` only — no `page` value, no navigation, no app runtime mode.
- **Single widget source**: the hub resolves exactly one app dir (`PIF_APP_DIR` → workspace `pif/` → `~/.pi/pif/app`); there is no global catalog root (`~/.pi/pif/catalog/` does not exist yet), no per-project overlay (`pif_app/`), and no provenance in `widget.list`, the snapshot, or the Widget Store.
- **No app model**: no `pif_app/app.yaml`, no `pif_app_*` tools, no pinned-registry export path — `scripts/build-pif-app.sh` compiles only the stock IDE registry.
- **No templates or design pass**: no `design.json` token file, no template manifest, no `pif_app/design.md` plan artifact, no `pif-app-designer` skill.
- **Child-session cwd when the app dir is global** is untested (carried from #130; verified as part of #155).

**Conflicts / collisions to resolve (none are blockers, none touch a settled owner decision)**
- **`catalog/` naming collision**: local `pif/catalog/` currently serves as the uninstall archive, while the app builder needs `~/.pi/pif/catalog/` as a source layer. Resolution: the local archive keeps its role; the global catalog is additive (#155).
- **Docking layout assumes every widget occupies a dock slot**; `slot: page` widgets must bypass the docking frame entirely — refactor point owned by #156.
- **Core-widget semantics**: `core: true` today means IDE chrome (console/status/terminal). In app mode, core widgets remain console/status surfaces; pages come only from the project's declared page list (settled below).

No conflict was found with an already-settled owner decision — notably "built apps always bundle the agentic runtime" — the template decisions below layer on top of the existing model without changing it.

### #130 remainder mapping (absorbed by the app-builder epic)

| #130 remaining item | Lands in |
|---|---|
| Global catalog (`~/.pi/pif/catalog/`) shared across projects, with per-project widget overlays | #155 (layered widget sources: base → global catalog → project overlay) |
| `pif init` equivalent — scaffold a fresh project with pif as the host environment | #157 (`pif_app_init` seeds a runnable app immediately) |
| Verify child sessions spawn with the correct cwd when the app is global | #155 verification (session manager against layered widget roots) |
| Test the install-once, use-in-any-project workflow in a clean project | #155 verification (per-project overlay exercised in a non-repo project) and #157 acceptance (scaffold → home page live from a fresh directory) |
| Document the workflow: install once, use in any project | #157 (`pif_app` docs); the run-from-source Dev UAT surface remains the canonical entry |

## App-builder model (settled 2026-08-29, Task #154)

Decisions below are binding for tasks #155–#159; the names here are the exact contracts those tasks (and precursor #178) consume. The widget contract shape does not change: **pages are widgets** whose manifest declares `slot: page`, and all generated code passes the existing `dart analyze` gate — nothing bypasses the pipeline that already exists.

| Decision | Choice | Rationale / alternatives rejected |
|---|---|---|
| Per-project layout | `pif_app/` at the project root: `app.yaml` (manifest), `design.md` (per-project UI plan from the design pass), `template/` (pinned copy of the template's four layers, when scaffolded from one), `widgets/` (project widget tree — same `widget.yaml` + `PifWidgetPlugin` shape as the shell's own `lib/widgets/`) | Mirrors the shell's own widget convention so one scan/analyze/registry pipeline serves both roots; versioned inside the project repo; `.pi/pif/` stays hub state, not app source |
| `app.yaml` schema | `id` (kebab identifier, namespaces tooling + export), `name` (display), `version`, `home` (page widget id), `pages` (ordered page widget ids), `template` (optional template id, e.g. `mercury`), `dependencies` (widget ids from any layer the app requires beyond its own tree) | Single source of truth for home + navigation order; `dependencies` lets init/build validation catch missing pieces before export; hub parses it into the snapshot (task #157) |
| Layered widget sources | Resolution order: base (`pif/lib/widgets/` of the running app) → global catalog (`~/.pi/pif/catalog/`) → project overlay (`pif_app/widgets/`). The Widget Store distinguishes all three and installs/uninstalls per source | Reuses the existing single-scan pipeline over three roots; projects extend and override without touching the base app |
| Id shadowing | A later layer **shadows an earlier id wholesale** (no merging): the project definition wins over a catalog entry, which wins over base. Provenance (`base\|catalog\|project`) is carried in `widget.list`, the snapshot, the Widget Store, and the generated registry. Toggle/uninstall semantics apply per layer (base core widgets still refuse uninstall) | Predictable override semantics; provenance is required by the Store, the export pinning, and the epic's acceptance criteria |
| `slot: page` semantics | Manifest `slot` gains `page`. Page widgets are full-screen: excluded from docking slots, rendered only in the app-mode page stage (IDE mode may open one in center stage for debugging). Dock-side `slot` values remain untouched for IDE chrome | Pages are widgets — no second widget type, no contract fork; the docking frame keeps its five slots |
| Home selection | The home page is declared **once** in `app.yaml` (`home:`), never in the widget manifest; navigation order is the `pages` order in the same manifest | Owner-settled at planning: the manifest is the single source of truth; the widget stays transportable |
| App runtime mode | A workspace declaring `pif_app/app.yaml` boots in **app mode**: the page stage renders the current page with responsive navigation (rail at ≥1024px width, bottom bar below), Agent Console available, IDE docking hidden behind a **dev toggle** (shell setting + hub control method) for development. Exported apps always boot in app mode — no project picker | End users get "boots into its home page"; the IDE stays one toggle away for development; derived mode means no extra config to drift |
| Export composition | **Recommended: template app consuming the shell core** — a release entrypoint (second `main`) inside the pif package that imports `pif/lib/core/` plus a **pinned registry** generated over the project's widget set. The hub stages the app dir, generates the pinned registry, runs `flutter build macos --release -t <entry>`, then reuses the standalone bundling (node + pi + extensions) and re-signing steps. **Not** pursued: extracting a `pif_core` package — if the shell core proves inseparable, that is the epic's recorded line-stop: stop and replan as its own task before continuing | Smallest AOT path; `core/` is already import-clean within the package (bus, plugin, error boundary); reuses proven packaging from #136; avoids a large refactor with unclear blast radius |
| Secrets policy | Exported apps bundle Node + pi + pif extensions exactly like `pif.app` but never ship dev-machine `models.json`, `settings.json` API keys, or auth tokens. First-run provisioning happens on the target machine (model manager widget); the hub WS token stays per-launch (generated at runtime, never shipped). A secrets scan over the assembled bundle is part of export acceptance (#159) | Matches the epic risk record; the #134 env-scrubbing work already proves the pattern; first-run provisioning reuses an existing widget instead of new config plumbing |
| Template composition | A template is a named design system with **four layers**: (1) machine-readable token file `design.json` (colors, typography, spacing, layout, accessibility — extract-design output with observed/inferred confidence); (2) named design rules `rules.md` (agent-obeyable constraints + authority chain, e.g. Mercury's No-Bold Rule); (3) starter component kit `components.md` (inventory + usage guidance); (4) responsive shell pattern `shell.md` (navigation rail ≥1024px, bottom nav below, one-job-per-screen). The manifest `template.yaml` declares `id`, `name`, `description`, and the layer list | Separation lets the design pass bind tokens, obey named rules, compose from a known kit, and follow one shell recipe; the machine-readable layer is validator-checkable while rules/kit stay human-auditable |
| Template storage | Templates are a **global-catalog entry type** stored at `~/.pi/pif/catalog/templates/<id>/`. The repo ships the first template at `pif/templates/mercury/` (five files: `template.yaml`, `design.json`, `rules.md`, `components.md`, `shell.md`), and the hub syncs repo templates into the catalog at hub start (same origin→store philosophy as widgets). `pif_app_init --template <name>` resolves project → global catalog → repo fallback; without the flag it scaffolds a minimal unstyled app. With the flag it copies the four layers into `pif_app/template/` and records `template:` in `app.yaml`; the per-project UI plan lands at `pif_app/design.md`, produced by `skills/pif-app-designer/SKILL.md` for owner approval before any widget is built (recipe is law) | One shared store across projects (the #130 goal); pinned per-project copies keep apps stable if the catalog template later evolves; naming matches #157/#158/#178 exactly |

### Pi tools additions (app-builder surface — task #157)

All registered beside the `pif_widget_*` tools, callable from host and child sessions over the control socket:

| Tool | Effect |
|---|---|
| `pif_app_init` | Scaffolds `pif_app/` (manifest + home page through the existing create pipeline) and seeds `.pi/pif` wiring so a fresh project is immediately runnable; `--template <name>` scaffolds from a global-catalog template (tokens, rules, component kit, shell pattern into `pif_app/template/`) |
| `pif_app_page_add` / `pif_app_widget_add` | Add a page or widget to the project tree and manifest (create pipeline + analyze gate) |
| `pif_app_home_set` | Set the home page in `app.yaml` |
| `pif_app_list` | Manifest + page/widget inventory with per-layer provenance |
| `pif_app_build` | Assemble + AOT build + bundle + re-sign (task #159; registered here, returns a clear not-built-yet result until then) |

## Non-goals (Phase 1 — historical; superseded items marked)

- ~~No packaged/release build; run-from-source is the product for now~~ — superseded: release packaging pulled forward into the app-builder sprint as "package a project's application" (#159, see Roadmap realignment).
- ~~No remote or networked store; local catalog only~~ — superseded: remote git catalogs are Sprint 2 — Ecosystem (see Roadmap realignment).
- No full code editor or diff viewer in the base set (diff viewer arrived via dogfooding, as planned).
- macOS desktop only (toolchain verified: Flutter 3.44.8 stable, Dart 3.12.2, macOS arm64); non-macOS targets are Sprint 3 — Platform & sharing.
- No RFW/interpreted widgets — deferred to the Sprint 3 RFW lane for runtime widget installation in shipped AOT apps.

## Environment facts (verified 2026-08-15)

- Flutter 3.44.8 stable + Dart 3.12.2 installed on macOS arm64.
- pi RPC mode (`--mode rpc`, `prompt`/`steer`/`follow_up`/`abort`, `--session <file> -c` reuse) is production-proven in dev-pipeline.
- Extension-to-host-session message injection (`pi.sendMessage` with `deliverAs: "followUp"`) is production-proven in coms.
