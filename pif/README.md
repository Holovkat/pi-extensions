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
