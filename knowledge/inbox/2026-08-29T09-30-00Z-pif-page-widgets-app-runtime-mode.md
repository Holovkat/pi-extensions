# pif page widgets and app runtime mode (#156)

- date: 2026-08-29
- type: component
- tags: pi-extensions, pif, shell, app-mode, pages, widget-contract
- status: current
- resource: pif/lib/core/docking_shell.dart

## What was done

Task #156 (recovered from an evicted builder's partial work, audited and finished in-session): the pif shell gained the **page** widget slot and an **app runtime mode**. `PifWidgetMeta`/`PifSlot` gained `page`. When the hub snapshot carries a usable app manifest (`app` = {id, name, home, pages}, parsed from `pif_app/app.yaml`), the shell boots into a page stage: the declared home page full-viewport, responsive navigation (labelled rail at ≥1024px, bottom bar below), an Agent Console slide-in overlay, and a dev toggle (`pif_dev_toggle`) that exposes the full IDE docking without losing page state (both scaffolds stay mounted via Offstage). Projects without a manifest — or with a manifest declaring no pages — keep the IDE shell byte-for-byte. Page widgets are refused from dock slots at layout-parse, at `move()`, and at render (no hub write for a rejected move). The Widget Store renders source badges (`BASE`/`CATALOG`/`PROJECT`) from the #155 provenance field.

## Decisions

- Only the ACTIVE page mounts; navigation switches mount. Inactive pages are not kept alive (contract asserted in tests). State preservation across the dev toggle works because the whole app scaffold stays mounted offstage.
- Navigation state survives snapshot resyncs; it resets only if the active page disappears from the manifest.
- Provenance wording follows the settled spec: `base|catalog|project` (not the issue's `global`).
- Store badge for catalog entries is implicit (`CATALOG` on every local-catalog card).

## Bugs found and fixed while finishing

- **Test-seam bug (real code):** the `factories` constructor override was applied in `reassemble`/`didUpdateWidget` but not `initState`, so frame one used the real generated registry; with the shell's pre-snapshot default `enabled` set (includes `agent_console`), tests built the real console and overflowed. Fixed by calling `_refreshFactories()` first thing in `initState`.
- **Test-hang lesson:** awaited real-async I/O (`Directory.systemTemp.createTemp`) inside `testWidgets` never completes under FakeAsync — and the per-test `--timeout` does not fire while the zone is blocked. Use `createTempSync`/`deleteSync` in widget tests. Symptom was a flutter_tester at 0% CPU stuck on the first test with no timeout firing.
- One over-specified assertion (inactive page expected to exist offstage) corrected to the only-active-page contract.

## Lessons

- The evicted builder's work was ~85% sound; auditing it beat rewriting it. Freeze partial work in the worktree, never discard.
- A control experiment (existing suite passed in 2s in the same worktree) isolated the hang to the new tests in one minute — cheaper than any theory.

## Current state

Flutter 53/53 green (45 existing + 8 new), `dart analyze` clean. Remaining for the epic: hub-side dev-toggle control surface (noted as hub-lane surface), `pif_app_init` (#157) to produce manifests that light this mode up.
