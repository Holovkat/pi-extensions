# pif — Pi-Native Flutter Agentic IDE

- **Date:** 2026-08-15
- **Status:** Approved design, pending implementation plan
- **Owner:** Tony Holovka
- **Repo:** pi-extensions (single repo: extension + Flutter app)
- **Tracker:** Epic [#120](https://github.com/Holovkat/pi-extensions/issues/120) · Sprint [#121](https://github.com/Holovkat/pi-extensions/issues/121) · Tasks #122–#129
- **Successor (app builder):** Epic [#152](https://github.com/Holovkat/pi-extensions/issues/152) · Sprint [#153](https://github.com/Holovkat/pi-extensions/issues/153) · Tasks #154–#160 — pif as the foundation applications are built on; rewrites the Phase 2/3 direction (Task #154 owns the spec update)

## Vision

A next-generation agentic IDE that replaces the terminal surface with a Pi-native, Flutter-first desktop shell. It fuses Pi's modularity model (extensions) with Flutter's modularity model (widgets): **everything on screen is a widget, every widget is an extension that can be turned on or off**, the app contains its own widget store, and Pi itself builds new widgets into the running shell conversationally. Codex-style paneling: a central work area plus any number of dockable widget windows. Start from a small set of base primitives and grow the rest of the system from those primitives, using the system itself.

## Decisions (settled during brainstorming)

| Decision | Choice | Alternatives rejected |
|---|---|---|
| Host topology | **Pi hosts.** A pi extension (`extensions/pif.ts`) is the hub; it launches the Flutter shell, which connects back over a local WebSocket | Flutter app spawning pi internally; standalone daemon in the middle |
| Dynamic widget mechanism | **Real Dart source, run from source.** Shell runs via `flutter run --machine` (JIT); widgets hot-reload when installed/changed | RFW interpreted widgets (Phase 3 option for release builds); dart_eval |
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

- **Manifest (`widget.yaml`)**: `id`, `name`, `version`, `description`, `slot` (left|center|right|bottom|status), `core` (bool), `tags`, `dart_dependencies` (extra pub packages, optional).
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

The signature loop: "build me a diff viewer widget" → `pif_widget_create` → agent writes real Dart with its normal file tools → `pif_widget_install` → diagnostics round-trip until green → widget appears in the live shell → agent opens it via `pif_layout`.

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

## Phasing

- **Phase 1 — Primitives**: hub (WS bus, host mirror, child sessions, Flutter supervisor), shell frame (docking + snapshot/reconnect), the base five widgets, widget contract + registry codegen + reload loop, pi tools, local catalog store. **Exit: diff-viewer dogfood passes.**
- **Phase 2 — Ecosystem**: dogfooded widgets (diff viewer, file explorer, and on-demand builds), remote git catalogs as installable widget packs, per-widget settings schema, theming (themeMap integration), layout presets.
- **Phase 3 — Platform**: publish/share widgets across machines via coms/council, trust/signing for third-party widgets, multi-window support, packaged release mode with a frozen widget set (AOT), optional RFW lane for release-mode dynamic widgets.

## Non-goals (v1 / Phase 1)

- No packaged/release build; run-from-source is the product for now.
- No remote or networked store; local catalog only.
- No full code editor or diff viewer in the base set (diff viewer arrives via dogfooding).
- macOS desktop only (toolchain verified: Flutter 3.44.8 stable, Dart 3.12.2, macOS arm64); other Flutter targets later.
- No RFW/interpreted widgets; that is a Phase 3 option for release builds.

## Environment facts (verified 2026-08-15)

- Flutter 3.44.8 stable + Dart 3.12.2 installed on macOS arm64.
- pi RPC mode (`--mode rpc`, `prompt`/`steer`/`follow_up`/`abort`, `--session <file> -c` reuse) is production-proven in dev-pipeline.
- Extension-to-host-session message injection (`pi.sendMessage` with `deliverAs: "followUp"`) is production-proven in coms.
