---
type: Inbox
title: pif source precedence and catalog visibility alignment (#207)
description: Reordered layered widget install precedence so project overlays win first, then global catalog copies, then base widgets and archives; catalog collisions now stay visible unless a project definition wins, and failed copied installs rescan after cleanup so state returns to the surviving source
tags: [pi-extensions, pif, widgets, install-precedence, catalog, rollback, okf]
timestamp: 2026-08-31T04:02:39Z
generated_at: 2026-08-31T04:02:39Z
generated_by: dev-session
session_id: pending
commit_sha: []
branch: codex/pif-app-builder-154
issue_refs: [207]
capture_tier: session
---

# What Was Done

Updated `extensions/pif.ts` so layered widget install resolution now prefers the project overlay first, then the global catalog copy path, then base widgets, then the app-local archive. Bundled and source scans now keep catalog collisions visible when a base widget is installed and hide them only when a project definition actually wins. Failed copied installs now remove the attempt-owned directory first, restore the prior registry snapshot and `registryStateExists` flag, rescan, and rebroadcast the surviving widget/catalog state so the live source provenance matches the rolled-back filesystem. Core uninstall now consults the underlying base manifest before allowing a project shadow to deregister, so a non-core override can no longer mask a core base widget.

## Decisions Made

- Kept scan state limited to the effective installed sources instead of resurrecting catalog entries into `this.enabled`.
- Treated global catalog entries as install candidates that must be copied into the writable project overlay before they can become the active source.
- Preserved base/archive bytes during rollback and only removed directories created by the failed attempt.
- Checked the underlying base manifest before uninstalling a project shadow so core protection survives same-id overrides.

## What Was Deprecated

- Automatic hiding of catalog entries whenever any widget with the same id was installed.
- Base-before-global install selection for layered widget resolution.
- Retaining stale project provenance after a copied install failed and the copied directory had already been removed.

## Lessons Learned

- Catalog visibility has to follow effective source ownership, not just id collisions, or base-installed widgets can accidentally hide still-relevant catalog candidates.
- Rollback must rescan after cleanup, not before it, otherwise the in-memory state keeps the source that no longer exists on disk.
- A narrow install-precedence fix can stay local to `scanWidgets()` and `installWidget()` if the rollback helper owns the cleanup and rescan path.
- Core-protected base widgets remain protected even when a non-core project or catalog override exists with the same id.

## Current State

- `extensions/pif.ts` contains the owned #207 source changes.
- Root validation supersedes the packet-local static check:
  - `node --experimental-strip-types --test --test-name-pattern='#207' extensions/pif.integration.test.mjs` → `1` pass, `0` fail, `32.8s` (`/tmp/pif-remediation-2026-08-31/207-sources-root-corrected.log`)
  - the earlier core-shadow failure was corrected in this source slice
- Packet-local readback stayed within the frozen scope:
  - `git diff --check -- extensions/pif.ts`
  - manual readback of the edited `scanWidgets()` / `installWidget()` / `uninstallWidget()` branches
- No UI actions or shared-helper edits were run for this slice; `#160` remains responsible for broader final validation.
