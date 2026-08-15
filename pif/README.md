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
