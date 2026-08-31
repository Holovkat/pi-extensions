---
type: Inbox
title: pif app manifest parser preserves s-prefixed page ids on reload (#193)
description: Fixed the app manifest block-list parser so canonical page and dependency ids like settings, search, and repeated-leading-s entries survive render/reload round-trips without changing the settled schema or diagnostics
tags: [pi-extensions, pif, hub, manifest, parser, app-yaml, issues, okf]
timestamp: 2026-08-31T00:58:57Z
generated_at: 2026-08-31T00:58:57Z
generated_by: governed-sprint-builder
session_id: pending
commit_sha: []
branch: codex/pif-app-builder-154
issue_refs: [193]
epic_refs: [152, 153]
capture_tier: session
---

# What Was Done

Implemented the #193 manifest parser repair in `extensions/pif-shared.ts`. The block-list item regex now strips only the leading `-` plus whitespace, so canonical entries like `settings`, `search`, and other s-prefixed ids survive render/reload round-trips unchanged.

The change stayed on the parser surface only. The manifest schema, home validation, and invalid-input diagnostics were left intact.

# Decisions Made

- Keep the fix as a one-line parser correction rather than a schema or renderer change.
- Reuse the existing parser-focused tests in `extensions/pif.test.mjs` for T1 validation.
- Do not add a new regression test suite in this lane; #160 remains the owner of broader verification.

# What Was Deprecated

Nothing was deprecated. The old `^-.s*` list-prefix removal was replaced because it incorrectly consumed leading `s` characters from valid ids.

# Lessons Learned

- The parser must treat `- settings` and similar list entries as data, not as text to normalize beyond the list marker and whitespace.
- A narrow parser-focused smoke check was enough to confirm the bug and the fix without widening scope.

# Current State

`extensions/pif-shared.ts` contains the only owned code change for #193, and the existing parser-focused checks passed. The lane is ready for commit handoff, with #194 next in the serial remediation order.
