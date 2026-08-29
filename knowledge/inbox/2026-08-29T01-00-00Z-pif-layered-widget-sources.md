---
type: Inbox
title: pif Hub Layered Widget Sources — Base, Global Catalog, Per-Project Overlay (#155)
description: Executed task #155 — extended the hub widget model from a single app dir to layered sources (base app, global catalog ~/.pi/pif/catalog/, per-project overlay pif_app/widgets/) with wholesale id shadowing (project > catalog > base), provenance flowing through widget.list, the snapshot, install/toggle/uninstall, and provenance-annotated registry codegen; project widgets install in place, global-catalog installs copy into the overlay, base uninstalls keep archive-to-catalog
tags: [pi-extensions, pif, hub, widgets, layered-sources, provenance, registry-codegen, okf]
timestamp: 2026-08-29T01:00:00Z
generated_at: 2026-08-29T01:00:00Z
generated_by: governed-sprint-builder
session_id: pending
commit_sha: []
branch: codex/pif-hub-layered-sources-155
issue_refs: [155, 130, 152, 153, 154, 156, 157]
epic_refs: [152]
capture_tier: session
---

# What Was Done

Executed task #155 (T1 scope, Lane A hub/TypeScript) in the worktree `codex/pif-hub-layered-sources-155`. Extended the hub's widget model from a single app dir to layered sources per the settled app-builder spec (Task #154):

- `extensions/pif-shared.ts`: added `PifWidgetSource` (`base|catalog|project`, the spec's provenance enum), `dartFileUri` (safe `file:` import URIs for project widgets), and provenance-aware `generateWidgetRegistry` (per-entry `// source:` comments + per-entry import paths; bare manifests still produce the byte-identical legacy golden).
- `extensions/pif.ts`: `widgetRoots()` now returns five roots — base widgets, app-local archive catalog, global catalog (`~/.pi/pif/catalog/`, env-overridable via `PIF_GLOBAL_CATALOG`), project overlay (`<workspace>/pif_app/widgets/`), and the registry. `scanWidgets()` resolves base ∪ project (project shadows wholesale) for installed and app-archive ∪ global (global shadows) for available, minus installed ids; every consumer (scan, `widget.list`, snapshot, codegen) reads that one resolved set. `installWidget` resolves project-in-place → base-in-place → app-archive copy (into base) → global-catalog copy (into the project overlay); `uninstallWidget` deregisters-only for project widgets (source stays, keeps shadowing) and archives base widgets to the app-local catalog as before; core widgets still refuse uninstall. All reads/writes for the new roots go through `assertSafeWidgetPath`.
- pif.ts constructors converted from TS parameter properties to explicit field assignments so plain `node --test` (type stripping) can import the module — no behavior change; the file had been un-importable from tests before.
- Tests: 4 new unit tests (shadowing determinism + provenance in scan/list/snapshot, provenance registry golden + import-path guards, install-in-place + global-catalog install from a clean non-repo temp workspace with writes-contained assertion, uninstall semantics per source) and a full real-pipeline integration block in the hub smoke (pif_app package seeded with a path dependency on the app + real `flutter pub get`, global catalog via `PIF_GLOBAL_CATALOG`, provenance over the WS snapshot, real dart analyze gates on both install/uninstall paths).

# Decisions Made

- **Provenance enum follows the spec, not the issue wording**: the issue says `source: base|global|project`, the settled spec says `base|catalog|project`. Spec wins — the value for the global-catalog layer is `catalog`. Not a semantic conflict (same layer, different label).
- **Registry imports for project widgets use `file:` URIs.** Empirically verified: relative imports from inside the app package cannot escape its root (analyzer reports `uri_does_not_exist` even for existing files), while `file:` URIs resolve and keep ONE library identity provided the project widget imports the host core as `package:pif/core/plugin.dart` (the `pif_app` package declares a path dependency on the app). This is the T1 convention #157's `pif_app_init` should scaffold.
- **Presence = installed for the overlay** (same as base): a project widget present in `pif_app/widgets/` shows as installed-but-disabled until the standard install pipeline (analyze gate) or a toggle enables it; "live after the standard install pipeline" is enforced, first-run mass-enable still mirrors base behaviour.
- **Global-catalog installs always copy into the project overlay** (never register in place from the catalog layer), so uninstalled project copies and the shared catalog source stay independent; uninstalling a project/global-sourced widget therefore deregisters only.
- Fixed a latent resurrection bug surfaced by the new semantics: `scanWidgets` re-harvests enabled ids from state, so project uninstall now clears the record's enabled flag before rescanning or the deregistration would be undone by the scan.

# What Was Deprecated

Nothing superseded. The single-app-dir widget model is now the base layer of the layered model; the old `Widget not found in widgets or catalog` resolution order is extended (project first), not replaced.

# Lessons Learned

- The Dart analyzer treats relative imports from inside a package's `lib/` as un-escapable (file exists but resolves to `uri_does_not_exist`), while non-`lib` package files can escape relatively — and `file:` URI imports + `package:pif` identity unification pass both gates (verified with throwaway fixtures before committing to the design).
- Node type stripping cannot load code with TS parameter properties; converting to explicit fields makes extension modules unit-testable with stock `node --test`.
- The integration fixture needs `pif_app` to be a real package (path dep + `flutter pub get`) for the analyze gate to resolve `package:flutter` — hand-copied `.dart_tool` package configs are fragile.

# Current State

- Gate: full `npm run test:pif` PASS — node half 26/26 (24 unit + 2 integration, incl. the real macOS Flutter supervisor test) and the flutter half (`dart analyze` clean + 45 flutter tests) green on this machine.
- Layered sources work end to end from a clean non-repo temp workspace against an app dir outside the workspace (#130 evidence: `PIF_APP_DIR` pins the app anywhere, `PIF_GLOBAL_CATALOG` shares widgets across projects, project overlay is per-workspace).
- Open for later tasks: `dart_dependencies` of project widgets are still added to the app package's pubspec (single-pubspec dev model until #157/#158); #156 (shell) consumes the snapshot provenance and the new registry shape; final registry goldens land in #160 verification.

# Next Steps

- #156 (shell/Dart lane) renders per-source provenance in the Widget Store and handles hot reload of project widgets.
- #157 should scaffold `pif_app` exactly like the #155 test fixture: path dependency on the app, `package:pif/core/plugin.dart` imports for project widgets.
- #160 pins the registry codegen goldens (now provenance-annotated).
