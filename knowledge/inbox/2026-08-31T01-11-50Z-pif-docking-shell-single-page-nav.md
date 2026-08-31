---
type: Inbox
title: pif docking shell single-page no-nav state for #198
description: Recorded the shell fix that skips NavigationBar and NavigationRail when an app manifest exposes only one page, keeping the page stage and console/dev controls reachable without changing the multi-page responsive layout
tags: [pi-extensions, pif, shell, app-mode, navigation, responsive, okf]
timestamp: 2026-08-31T01:11:50Z
generated_at: 2026-08-31T01:11:50Z
generated_by: governed-sprint-builder
session_id: pending
commit_sha: []
branch: codex/pif-app-builder-154
issue_refs: [198]
epic_refs: [152]
capture_tier: session
---

# What Was Done

Updated `pif/lib/core/docking_shell.dart` so app-mode shells with only one page render a no-nav stage instead of a `NavigationBar`/`NavigationRail`. The wide and multi-page responsive paths are unchanged; the console overlay and dev toggle stay reachable because they live outside the page navigation chrome.

The fix uses the existing page-stage contract only. No navigation state was added for the single-page case, which avoids the narrow `NavigationBar` destination assertion without affecting 2+ page apps.

`dart analyze` on the touched file passed cleanly.

# Decisions Made

- Keep the responsive navigation split exactly as-is for multi-page apps.
- Treat a single-page manifest as a no-nav app-mode state.
- Do not add tests in this T1 lane.

# What Was Deprecated

Nothing deprecated. The single-page app-mode shell simply omits navigation chrome.

# Lessons Learned

- The shell already had a clean place to branch on page count; the fix is a layout choice, not a new state model.
- The console overlay and dev toggle remain accessible as long as the title bar and overlay layer stay outside the page-navigation branch.

# Current State

`pif/lib/core/docking_shell.dart` is the only intended code change for #198, and `dart analyze` on that file is clean. The task is ready for coordinator handoff, and the workspace can now move on to #210.
