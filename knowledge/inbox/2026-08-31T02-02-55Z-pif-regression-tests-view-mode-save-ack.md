---
type: Inbox
title: pif focused regression coverage for view-mode resize, app-mode breakpoints, and widget provenance
description: Recorded the final focused Flutter regression pass for snapshot-driven app mode, widget provenance badges, and tracker save/resize acknowledgement coverage after the production fixes
tags: [pi-extensions, pif, regression, tracker-board, app-mode, widget-store, okf]
timestamp: 2026-08-31T02:28:27Z
generated_at: 2026-08-31T02:28:27Z
generated_by: governed-sprint-builder
session_id: pending
commit_sha: []
branch: codex/pif-app-builder-154
issue_refs: [160, 197, 198, 208, 210]
epic_refs: [152]
capture_tier: session
---

# What Was Done

Added and updated focused Flutter regression coverage in the owned test files only:

- `pif/test/app_mode_test.dart` now proves a single-page app manifest stays chrome-free at 720/1023/1024 widths, and that adding the second page on the same shell unlocks the expected navigation, console, and dev-toggle affordances without taking a test exception.
- `pif/test/core_and_widgets_test.dart` now checks title-only label preservation and distinguishes an available base archive from the global catalog. Legacy installed entries stay unbadged; legacy available entries retain the catalog fallback. Installing the archive still sends its exact widget ID.
- `pif/test/tracker_scope_test.dart` now proves a view-mode image resize updates the saved markdown width tag from the original `|240` value, survives X → Yes save/close, and reopens with the image still between the surrounding body text; the tag-edit path now also covers removing an existing tag, adding a new one, and retrying after unrelated or failing `tracker/op` replies.

Root independently reran the three files together after adding the missing available-archive case: 54 tests passed, zero failed. Command: `flutter test --reporter expanded test/app_mode_test.dart test/core_and_widgets_test.dart test/tracker_scope_test.dart`. Log: `/tmp/pif-remediation-2026-08-31/root-ui-regressions.log`. The prior individual-file counts were not used as the aggregate count.

# Decisions Made

- Kept the regression coverage in the existing widget-test files, using real widgets and controlled bus acknowledgements.
- Used the handle's horizontal-drag callback directly in the image resize test because pointer-level drag gestures were not reliable enough in this markdown/selection layout.
- Preserved the existing edit-mode image insertion coverage rather than expanding into a more brittle end-to-end image interaction path.
- Kept the app-mode dev toggle authoritative off the `shell/state` snapshot `devMode` field.

# What Was Deprecated

The earlier pointer-driven image-resize assertion was dropped because it did not reliably trigger the resize callback in widget tests.

# Lessons Learned

- The image test proves callback-driven resizing, emitted update payload, saved width and reopened body ordering. It does not prove pointer hit testing or a physical drag; those remain a visible UAT check.
- Snapshot-driven app mode is easiest to reason about when tests assert the UI does not change before the matching snapshot arrives.
- Remote tracker labels and attribute edits need explicit preservation coverage on save paths that do not touch them.

# Current State

The production fixes have focused coverage in the three Flutter test files. The targeted regression run is green. It is not the complete `npm run test:pif` gate, installed-app verification, or owner UAT; #160 acceptance remains open.
