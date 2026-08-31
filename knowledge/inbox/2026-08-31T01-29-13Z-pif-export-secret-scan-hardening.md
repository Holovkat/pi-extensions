---
type: Inbox
title: pif export scanner now fails closed on bundled credential shapes (#199)
description: Hardened scripts/build-pif-project-app.sh so the export scan catches settings.json, models.json, .env, alias symlinks with those logical names, modern sk-proj-/sk-svcacct- style tokens, GitHub/AWS/Google credential patterns, and symlink targets outside the bundle root without reading them
tags: [pi-extensions, pif, export, secrets, scanner, symlink, app-builder]
timestamp: 2026-08-31T01:29:13Z
generated_at: 2026-08-31T01:29:13Z
generated_by: governed-sprint-builder
session_id: pending
commit_sha: []
branch: codex/pif-app-builder-154
issue_refs: [199]
capture_tier: session
---

# What Was Done

Updated `scripts/build-pif-project-app.sh` to keep the export scanner canonical and fail closed on bundled credential-shaped material. The helper now checks exact credential file names (`models.json`, `settings.json`, `.env`), scans for generic OpenAI `sk-` tokens plus modern hyphen/underscore-bearing shapes, and flags GitHub, AWS, and Google credential patterns. It also refuses symlink targets outside the exported bundle root before reading them and canonicalizes internal links so cycles do not recurse forever. After a historical bundle scan surfaced false positives in bundled `.d.ts` declaration files, the CLI packaging step was narrowed to runtime files by excluding those declarations from the exported copy.

# Decisions Made

- Keep a single scanner helper inside the export script rather than adding a parallel scan pipeline.
- Report only file paths and credential classes; do not print raw token values.
- Treat external symlink targets as an export failure, and visit internal symlink targets once by canonical path.
- Exclude non-runtime `*.d.ts` declaration files from the bundled pi CLI copy so historical example-shaped text does not trigger the export scanner.

# What Was Deprecated

- The old narrow `models.json` / `.env` / `sk-` scan.
- Blind symlink traversal that could read outside the bundle root.

# Lessons Learned

- The generic `sk-` regex needed to accept `-` and `_` so `sk-proj-` and `sk-svcacct-` shapes are not missed.
- A scanner that follows symlinks without a root check can leak or read outside the export bundle.
- Internal symlink cycles are safe only if the walker tracks canonical directories and files.

# Current State

The export scanner is updated but the full export pipeline was not run. The helper passed a synthetic validation pass covering clean trees, internal symlink cycles, external symlink refusal, redacted modern credential shapes, and a disposable historical CLI fixture copied without `*.d.ts` declarations.

# Checks

- `bash -n scripts/build-pif-project-app.sh`
- Synthetic Node scan against a clean temp tree, a dirty temp tree with redacted `sk-proj-` and `sk-svcacct-` values, a same-bundle alias symlink named `models.json` that pointed at a differently named file, and a temp tree with an external symlink target that was refused before read
- Disposable historical Team Pulse CLI fixture copied with `rsync -a --exclude='*.d.ts'` before running the same canonical scanner; the declaration-file false positive disappeared while runtime assets remained present
