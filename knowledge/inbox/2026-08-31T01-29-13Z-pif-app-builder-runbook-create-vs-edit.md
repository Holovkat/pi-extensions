---
type: Inbox
title: pif app-builder runbook now uses scaffold-then-edit app flow (#200)
description: Updated skills/pif-app-builder/SKILL.md so the app loop stays on pif_app_* scaffolds plus scoped Dart edits and pif_widget_install corrections, without a generic pif_widget_create step in the app workflow
tags: [pi-extensions, pif, skill, runbook, widgets, analyzer]
timestamp: 2026-08-31T01:29:13Z
generated_at: 2026-08-31T01:29:13Z
generated_by: governed-sprint-builder
session_id: pending
commit_sha: []
branch: codex/pif-app-builder-154
issue_refs: [200]
capture_tier: session
---

# What Was Done

Reworded `skills/pif-app-builder/SKILL.md` so the build loop stays on the `pif_app_*` scaffolds for pages and widget-extensions, then uses scoped Dart edits and `pif_widget_install` for each correction. The child-session guidance now matches that contract and no longer suggests a generic app-loop `pif_widget_create` step.

# Decisions Made

- Keep the app loop on `pif_app_page_add` / `pif_app_widget_add` scaffolds plus scoped Dart edits.
- Use `pif_widget_install` for iterative fixes on an existing widget.
- Keep the child-session instructions aligned with the same create-once, install-for-corrections flow.

# What Was Deprecated

- The older wording that implied a generic `pif_widget_create` step inside the app loop.

# Lessons Learned

- The scaffold and install phases are separate; the runbook should say so directly.
- A precise runbook prevents the common mistake of trying to re-create an existing widget id in the app workflow.
- Child-session language should mirror the main loop language so the contract stays obvious.

# Current State

The runbook text is aligned with the actual widget workflow. This was a documentation-only correction; no widget code or analyzer gate was run in this turn.

# Checks

- `sed -n '1,220p' skills/pif-app-builder/SKILL.md`
- `rg -n "Use pif_widget_create once only|pif_widget_install" skills/pif-app-builder/SKILL.md`
- `git diff --check -- skills/pif-app-builder/SKILL.md`
