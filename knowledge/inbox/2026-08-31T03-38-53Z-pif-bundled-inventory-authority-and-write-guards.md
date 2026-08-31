---
type: Inbox
title: pif bundled inventory authority and writable-path guards (#187)
description: Tightened bundled-mode widget scanning and mutation gating so compiled inventory is authoritative, core enable state persists only in registry state, and bundle-internal filesystem writes and SQLite sidecars are rejected through canonical path guards
tags: [pi-extensions, pif, bundled-mode, registry, inventory, writable-paths, okf]
timestamp: 2026-08-31T03:38:53Z
generated_at: 2026-08-31T03:38:53Z
generated_by: dev-session
session_id: pending
commit_sha: []
branch: codex/pif-app-builder-154
issue_refs: [187]
capture_tier: session
---

# What Was Done

Updated `extensions/pif.ts` and `extensions/pif-shared.ts` so bundled app behavior is governed by the compiled widget inventory instead of workspace scan state. In bundled mode, widget mutation entry points now fail closed before source generation, install, uninstall, app scaffold, or Flutter relaunch; registry toggles persist only to registry state without codegen/reload; and bundled scans ignore workspace overlays while rejecting inventories that name widgets missing from bundled metadata. The same slice also added canonical writable-path guards for bundle-internal outputs, session transcript files, tracker cache files, SQLite sidecars, token/control-secret files, shell state temp files, model backups, app manifest writes, and other mutable PIF paths.

## Decisions Made

- Treated `PIF_COMPILED_WIDGET_IDS` as the authoritative bundled inventory and rejected malformed or incomplete inventories instead of synthesizing partial state.
- Removed `manifest.core` auto-enable during scan so persisted empty registry state remains meaningful after restart.
- Blocked bundled-mode mutation flows up front instead of allowing them to start and fail later in generation or reload.
- Used canonical path resolution plus bundle-contents checks for writable targets so symlinked or lexical bundle paths fail closed before writes.
- Kept the change scoped to the two owned source files and a narrow regression slice.

## What Was Deprecated

- Workspace-shadowing behavior in bundled mode for installed widget visibility.
- Bundled registry code generation and Flutter relaunch paths.
- Any write path that silently accepted a location inside an app bundle or another canonicalized protected target.

## Lessons Learned

- Once compiled widgets are shipped inside the app, scan state and mutation state need separate rules: scan from bundled metadata, persist only the mutable registry bits, and never rebuild the bundle in place.
- Canonical path checks need to happen before every write, not only at the top-level command entry points, because session files, cache files, and helper-generated paths can otherwise bypass the guard.
- Targeted fixtures are enough to bound the bundled inventory and write-guard contract, but the final codesign, installed-bundle, and export proofs still belong to #160 rather than this slice.

## Current State

- `extensions/pif.ts` and `extensions/pif-shared.ts` contain the owned changes for #187.
- Root validation supersedes the local slice-level checks here: the focused `#187` run reported `10` passes and `0` fails (`/tmp/pif-remediation-2026-08-31/187-full-focused-root.log`), the canonical bootstrap check passed (`/tmp/pif-remediation-2026-08-31/187-bootstrap-root-final.log`), and `bash -n` plus `dart analyze pif/lib/core/pi_launcher.dart` were clean.
- Targeted regression checks passed:
  - bundled scans ignore workspace shadows and preserve core toggle state only in registry
  - bundled create/install/uninstall reject before filesystem writes
  - bundled app scaffold entry points reject before generation
  - bundled relaunch rejects before Flutter spawn
  - bundled inventory fails closed for missing, malformed, or incomplete compiled IDs
  - runtime session storage rejects bundle-directed `sessions.db`, `sessions.db-wal`, `sessions.db-shm`, `sessions.db-journal`, `sessions.json`, and `sessions.json.tmp`
  - tracker cache rejects bundle-directed `tracker.db`, `tracker.db-wal`, `tracker.db-shm`, `tracker.db-journal`, and `tracker-cache.json`
- The startup path now preflights `token.tmp` and `control.secret`, and shell-state writes preflight `shell.json.tmp` before publication.
- No broad suite, deployment, or unrelated file edits were run as part of this slice.
