# pif Phase 1 — T2 Verification

- **Recorded:** 2026-08-15T00:41:10Z
- **Epic:** #120
- **Sprint:** #121
- **Verification task:** #129
- **Gate:** Epic verification passed; ready for Dev UAT (T2)

## Automated evidence

| Command | Result |
|---|---|
| `npm run test:pif` | PASS — 7 Node tests, clean Dart analysis, 11 Flutter tests |
| `npm run test:council` | PASS — 17 existing regression tests |
| `npm run build` | PASS — council package build remains compatible |
| `npx -y -p esbuild esbuild extensions/pif.ts --platform=node --format=esm --log-level=error` | PASS |
| `cd pif && flutter build macos --debug` | PASS — `pif.app` built |

The Node integration suite starts a real pif hub through Pi, exercises snapshot/resync, child RPC input/steer/abort, analyze rejection, dependency rollback, registry generation, catalog installation, layout persistence, `/pif-stop`, child termination, and a real `flutter run --machine -d macos` launch/reload cycle.

The Flutter suite covers the public host/plugin contract, authoritative transcript restoration, duplicate-event rejection, the five base widgets, reconnect resync, rendered panel close/reopen behavior, error-boundary containment, and the usable Diff Viewer.

## Acceptance evidence

- `/pif` hub and macOS shell boot through the real machine protocol; the five core widgets are generated into the registry and rendered by the docking frame.
- Host input uses Pi's `sendMessage` path; child sessions use RPC prompt/steer/follow-up/abort and are terminated with the hub.
- Widget creation and catalog installation cannot enter the registry without analysis; dependency and registry failures roll back project state.
- Layout and registry state persist under `.pi/pif/`; reconnect snapshots restore sessions, transcripts, widgets, catalog, and layout.
- Core widgets refuse uninstall. Non-core source is archived back to the local catalog.
- All eight `pif_*` tools route through the local control socket, allowing extension instances in the host, spawned child, or another Pi process to address the same hub.

## Combined review

A fresh requirements review initially identified transcript recovery and rendered panel-state gaps. Both were repaired and regression-tested. The independent re-review scored the implementation **97/100**, reported no remaining blocking or material findings, and judged T2 ready for Dev UAT.

## Real-use trial

The repeatable create → implement → analyze → register → open record is in `pif/REAL_USE_TRIAL.md` and `extensions/pif.integration.test.mjs`. The resulting non-core `pif/lib/widgets/diff_viewer/` provides editable Before/After inputs and a live red/green line comparison. Its rendered interaction is covered by Flutter tests.

## Remaining gate and risk

Dev UAT (T3) remains intentionally pending owner validation in the canonical local macOS shell. Validate live Agent Console interaction, Session Rail switching/spawn, terminal pty behavior, drag/tab/split layout interaction, Store controls, and Diff Viewer usability.

Known non-blocking warning: `flutter_pty` does not yet support Swift Package Manager on macOS; Flutter reports this as a future-compatibility warning while the current CocoaPods debug build succeeds.
