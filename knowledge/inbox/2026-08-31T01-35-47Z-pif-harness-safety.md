---
type: Inbox
title: PIF harness safety slice narrows test fixtures for #160
description: Hardened the Node harness fixtures with short temp roots, owned agent-dir setup, and safer shutdown/cleanup while keeping runtime execution deferred
tags: [pi-extensions, pif, tests, node, harness, isolation]
timestamp: 2026-08-31T01:35:47Z
generated_at: 2026-08-31T01:35:47Z
generated_by: governed-sprint-builder
session_id: pending
commit_sha: []
branch: codex/pif-app-builder-154
issue_refs: [160]
capture_tier: session
---

# What Was Done

Updated the PIF test harness fixtures to use short `/tmp` roots, a shared per-run pub cache, and an owned `PI_CODING_AGENT_DIR` seeded with safe agent-dir files before launching the hub. The fake child env dump now proves the child inherits the owned agent dir while still scrubbing hub tokens and allowed origins.

# Decisions Made

- Keep this as a safety prerequisite only; do not claim full runtime or integration acceptance.
- Use deterministic owned temp roots so cleanup is predictable and fixture paths stay short.
- Restore any pre-existing `PIF_APP_DIR` and `PIF_GLOBAL_CATALOG` values after layered fixtures complete.

# What Was Deprecated

- `os.tmpdir()`-based fixture roots in the touched harness tests.
- Direct process-only cleanup paths that skipped a graceful `/pif-stop` attempt.
- Deleting env overrides unconditionally instead of restoring prior values.

# Lessons Learned

- The harness is easier to reason about when the owned agent dir, cache, and catalog paths are explicit.
- Safe cleanup needs both the graceful stop path and a bounded fallback.
- The Node-level guard is enough for this slice; full runtime validation remains the #160 gate.

# Current State

The harness safety slice is complete and the narrow checks passed, but full runtime execution is still deferred. #160 remains the blocked verification ticket and all acceptance remains unchecked.

# Checks

- `node --check extensions/pif.integration.test.mjs`
- `node --check extensions/pif.test.mjs`
- `git diff --check -- extensions/pif.integration.test.mjs extensions/pif.test.mjs`
