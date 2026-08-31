---
type: Inbox
title: PIF New Project accepts a typed parent folder
description: New Project now shares one editable parent-folder field with optional native Browse and rejects invalid paths before environment creation.
tags: [pif, onboarding, new-project, filesystem, testing]
timestamp: 2026-08-31T22:06:16Z
generated_by: codex-orchestrator
branch: codex/pif-app-builder-154
commit_sha: [e74d40e6eff98acc9394ab966d274439fbd3453a]
epic_refs: [152]
issue_refs: [160, 224]
capture_tier: session
---

# Decisions Made

New Project uses one editable `Parent folder` field as the location authority.
The existing native chooser remains available through Browse and writes its
result into that same field. A typed absolute existing directory plus a project
name enables Continue without opening the macOS panel.

Empty, relative, missing and non-directory paths show specific inline messages
and keep Continue disabled. `DevelopmentEnvironmentService.create` remains the
authority for project-name, collision and writable-location checks.

# What Was Deprecated

The native folder chooser is no longer the only way to provide a project
parent. The previous button that replaced its label with the selected path is
superseded by the editable field and optional Browse action.

# Lessons Learned

A required system panel makes the main PIF workflow difficult to automate and
unnecessarily blocks users who already know the path. Keeping typed and browsed
input in one controller avoids competing state and makes the path visible,
editable and testable before creation.

# Current State

Issue #224 is implemented in `project_onboarding.dart` with updated onboarding
widget coverage. Focused analysis is clean and 12 onboarding tests pass. The
complete source gate also passes: clean Flutter analysis, 153 Flutter tests and
15 Node integration tests. Packaging, installed-app typed-path proof and the
resumed Team Pulse run remain the next steps; no final #160 acceptance is
claimed by this implementation checkpoint.
