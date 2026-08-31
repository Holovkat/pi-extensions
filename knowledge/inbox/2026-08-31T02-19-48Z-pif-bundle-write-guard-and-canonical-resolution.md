---
type: Inbox
title: pif shared bundle write guard now keeps missing ancestors in canonical resolution (#187)
description: Added shared Node path helpers for bundle write protection and fixed canonical resolution so missing ancestors stay in the walk and later ../ or symlink components are still evaluated
tags: [pi-extensions, pif, bundle-guard, canonicalization, symlink, bootstrap]
timestamp: 2026-08-31T02:19:48Z
generated_at: 2026-08-31T02:19:48Z
generated_by: governed-sprint-builder
session_id: pending
commit_sha: []
branch: codex/pif-app-builder-154
issue_refs: [187]
capture_tier: session
---

# What Was Done

Updated `extensions/pif-shared.ts` with the shared Node helpers that the export bootstrap now relies on: `isInsideAppBundle`, `assertWritablePifPath`, and the internal canonical resolver they use. The guard now rejects any lexical or effective `.app/Contents` destination, fails closed on dangling symlinks, and preserves missing ancestors in the walk so later `..` segments and symlinks are still evaluated. `scripts/build-pif-project-app.sh` now routes the generated bootstrap manifest helper through that guard before creating, copying, or renaming manifest files.

# Decisions Made

- Keep the bundle-path policy in the shared helper so the export script and generated bootstrap use one contract.
- Separate path resolution from policy rejection: the predicate reports bundle membership, and the writable-path helper raises the signed-bundle error.
- Keep missing ancestors in the walk instead of stopping on first `ENOENT`, which preserves later `..` and symlink evaluation.

# What Was Deprecated

- Early-return canonicalization that stopped after the first missing path segment.
- Bundle-write checks embedded only in the generated bootstrap script.

# Lessons Learned

- Literal path spelling matters for symlink-plus-`..` cases; path construction helpers can normalize away the edge case before the resolver sees it.
- A resolver that stops at the first missing ancestor can miss a later symlink into the bundle and incorrectly permit a write.

# Current State

The shared helper contract is in place and the narrow direct checks passed for:

- literal symlink-plus-`..` paths into `Foo.app/Contents`
- missing ancestor plus later `..` and symlink into the bundle
- safe missing-ancestor paths outside the bundle
- broken symlink fail-closed behavior

The generated bootstrap still uses the shared guard for workspace, manifest, staging, backup, and cleanup destinations.

# Checks

- `node --input-type=module` direct helper checks for `isInsideAppBundle` and `assertWritablePifPath`
- bootstrap emitted-helper subprocess checks already reported by the root harness for the canonical manifest upgrade/reject flow
