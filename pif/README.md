# pif shell

The macOS Flutter renderer for the `extensions/pif.ts` hub. The hub owns sessions, widget state, layout, catalog state, and shell supervision; this app reconnects and requests an authoritative snapshot.

## Run

From a Pi session with this package loaded:

```text
/pif
/pif-status
/pif-stop
```

Or run the renderer against an existing hub:

```bash
PIF_PORT=31415 PIF_WORKSPACE="$PWD" flutter run -d macos
```

## Validate

```bash
cd pif
dart analyze
flutter test
flutter build macos --debug
```

Widget source belongs in `lib/widgets/<id>/` with `widget.yaml`. Available but uninstalled source belongs in `catalog/`. The generated `lib/widget_registry.g.dart` is owned by the hub install pipeline.

## Tracker board

The **Tracker** widget is a center-stage Kanban board for the workspace repo's GitHub issues. The hub reads issues via the ambient `gh` session (epic/sprint/task labels become card types) and writes card moves back through it — the repo stays the single source of truth. A local cache in `.pi/pif/cache/` keeps the board readable offline with a `cached` staleness badge.

Columns come from a versioned `.pif/board.yaml` in the repo; repos without one get the default Backlog / In Progress / Done board derived from issue state and `status:*` labels:

```yaml
column todo:
  name: To Do
  label: status:todo
column in_progress:
  name: In Progress
  label: status:in-progress
column done:
  name: Done
  state: closed
```

Moving a card in pif and the hub writes the matching label / state back via gh. Cards can also be created, edited (title/body), moved between lanes (drag or the sheet's lane dropdown), and deleted from the resizable ticket sheet — its preferred size is remembered. Agents get the same operations through the `pif_tracker_list` / `pif_tracker_create` / `pif_tracker_update` / `pif_tracker_delete` pi tools.

## Install globally

To use pif as the host environment in any project:

```bash
./scripts/install-pif.sh
```

This copies the Flutter shell to `~/.pi/pif/app/` and the hub extension to `~/.pi/agent/extensions/`. After install, run `pi` in any project directory and type `/pif` to launch the shell with that project as the workspace. Widget installs and layout persist per-project in `.pi/pif/`.

## Build standalone macOS app

To build a self-contained `.app` that bundles Node.js + pi + the Flutter shell:

```bash
./scripts/build-pif-app.sh
```

This produces `build/pif.app` with everything bundled inside. Drag it to `/Applications` and launch by double-clicking. No external dependencies required — Node.js and pi are bundled in the `.app`.

On first launch, the app shows a project picker. Select a project folder and pif spawns pi with the pif extension, waits for the hub to come up, and connects automatically. Recent projects are saved for quick access.

If a hub is already running (e.g. from a terminal `pi` session with `/pif`), the app connects to it directly without showing the picker.

### Architecture

```
pif.app/
  Contents/
    MacOS/pif              ← Flutter native binary
    Resources/
      pi/
        node               ← Bundled Node.js
        cli/               ← Bundled pi CLI
        extensions/        ← pif.ts + pif-shared.ts
      app/                 ← Flutter app source (widget scanning)
```

The Flutter app's `main()` checks for an existing hub on port 31415. If none is running, it shows a project picker. Once a project is selected, it spawns pi with `PIF_AUTOSTART=1 PIF_NO_FLUTTER=1` — the pif extension auto-starts the hub (WS server) without the FlutterSupervisor, and the app connects to it.
