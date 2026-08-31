---
type: Inbox
title: pif flutter test storage isolation for #160
description: Recorded the test-harness safety cleanup that removed process cwd mutation from the four owned Flutter test files, bound each suite to a temp workspace or temp PifStorage helper, and kept the app-mode snapshot workspace aligned with the mounted shell
tags: [pi-extensions, pif, tests, storage, workspace, okf]
timestamp: 2026-08-31T01:22:34Z
generated_at: 2026-08-31T01:22:34Z
generated_by: governed-sprint-builder
session_id: pending
commit_sha: []
branch: codex/pif-app-builder-154
issue_refs: [160]
epic_refs: [152]
capture_tier: session
---

# What Was Done

Updated the four owned Flutter test files to keep storage writes and workspace state inside per-test temp roots instead of the repo checkout. `tracker_scope_test.dart` now points `PifHost.storage` at a temp workspace before any tracker widget pumps. `core_and_widgets_test.dart` now routes every storage-sensitive host through a temp-workspace helper, while preserving the intentional `/workspace` override in the status bar test. `app_mode_test.dart` keeps the fake hub snapshot workspace aligned with the mounted shell workspace. `integration_smoke_test.dart` now binds the shell to an owned temp workspace through a helper that passes `DockingShell(workspace: ...)`, and the bus snapshot payload uses the same workspace path.

The pass kept the diff to isolation semantics only and left the touched files analyzer-clean. `dart analyze` on the four touched test files passed cleanly.

# Decisions Made

- Keep the isolation fix entirely in test code.
- Use the existing `PifStorage.workspace` seam where storage is involved.
- Bind shell workspace through the existing `DockingShell.workspace` parameter instead of mutating `Directory.current`.
- Leave `PifStorage.write` asynchronous; do not add new flush or framework plumbing without runtime evidence.

# What Was Deprecated

Deprecated the test pattern that relied on process cwd as an implicit storage root for these suites.

# Lessons Learned

- The repo already had the right seams for the fix; the main work was wiring them consistently per test.
- Tracker-board tests need an explicit temp storage root, while the smoke suite only needs the shell and snapshot to agree on one workspace path.
- The analyzer can validate the wiring quickly, but runtime `flutter test` is still the gate that would prove async storage cleanup behavior.

# Current State

`pif/test/tracker_scope_test.dart`, `pif/test/core_and_widgets_test.dart`, `pif/test/app_mode_test.dart`, and `pif/test/integration_smoke_test.dart` are the only intended test changes for #160, and `dart analyze` on those files is clean. The work is ready for the next handoff, with T2 still responsible for runtime storage-flush verification if that gate is needed.
