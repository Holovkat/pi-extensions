---
type: Inbox
title: pif required-widget resolution preflight and export-script materialization (#209)
description: Added a shared required-widget resolver plus export-script preflight/materialization so app exports fail early on invalid, duplicate, missing, or source-missing widget ids and persist the resolved pinned set for later hub consumption
tags: [pi-extensions, pif, widgets, export, resolver, preflight, okf]
timestamp: 2026-08-31T03:51:07Z
generated_at: 2026-08-31T03:51:07Z
generated_by: dev-session
session_id: pending
commit_sha: []
branch: detachedf4bfe769
issue_refs: [209]
capture_tier: session
---

# What Was Done

In the isolated worktree for #209, I added a shared required-widget resolution path and wired the export script to use it before any staging or copy work:

- `extensions/pif-shared.ts`: added `resolveRequiredWidgetSet()` and `formatWidgetResolutionProblems()` for widget-id resolution across the layered source roots (`project > catalog > base`), with deterministic output and explicit diagnostics for invalid, duplicate, missing, and unavailable entries.
- `extensions/pif-shared.ts`: tightened required-widget checks so each resolved widget must also have its actual Dart entrypoint (`<id>.dart`) before export staging proceeds; missing source files now fail as `unavailable` with the concrete path in the diagnostic.
- `scripts/build-pif-project-app.sh`: resolved the manifest dependencies through the shared helper before staging, materialized the resolved pinned set into the staged app source, and persisted `pif_app-manifest/required-widgets.json` for the runtime bundle.
- `scripts/build-pif-project-app.sh`: replaced the earlier path-interpolated `node -e` snippets with env-driven heredoc invocations so the script handles quoted and spaced paths more safely.

## Decisions Made

- The resolver uses one strict rule at both boundaries: if a required widget id is invalid, duplicated, or truly absent/incomplete at the source boundary, the export fails instead of silently dropping it.
- Hub enabled/disabled state is separate from export-time source selection. A catalog/project dependency that still has complete source on disk remains valid even if the hub currently considers it disabled or archived; the export pins source-present widgets and fails only when the source is missing or incomplete.
- The layered source precedence stays `project > catalog > base`; a higher-priority source that exists but is broken does not fall through to a lower layer.
- `app.yaml.dependencies` remains a widget-id list, separate from each widget manifest’s own Dart package dependencies.
- The export script writes the resolved pinned set into the staged app source so later hub-side consumers can read the same export-time decision without re-deriving it.

## What Was Deprecated

- The export path no longer relies on late discovery of required widgets during staging or registry generation; that work now happens up front through the shared resolver.
- Any future logic that tries to infer required-widget availability by only scanning `widget.yaml` files is superseded by the shared resolution check plus Dart entrypoint presence.

## Lessons Learned

- The source-resolution contract needs both manifest validity and actual Dart file presence to be useful; otherwise the build still fails later for a reason the preflight could have caught.
- The script boundary is the right place to materialize the resolved set for export, while the shared resolver keeps hub and script behaviour aligned.
- A narrow helper is enough here; there is no need to invent a second resolver stack just for the export script.

## Current State

The shared resolver, direct-script materialization and public hub preflight are integrated. The public hub rejects invalid required sets before allocating a build or spawning its process, and forwards the same catalog root used for validation to the exporter. Complete archive/base source is valid regardless of IDE enabled state; unavailable/incomplete source is rejected. This follows the binding any-layer dependency contract.

Three focused Node cases pass (resolver success, resolver invalid/incomplete sets, and public pre-spawn rejection). The direct-script quoted-path negative case also passes. Actual final artifact contents and native UI remain final verification work; no acceptance is claimed here.
