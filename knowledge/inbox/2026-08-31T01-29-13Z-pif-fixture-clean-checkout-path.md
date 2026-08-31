---
type: Inbox
title: Team Pulse fixture now uses a clean-checkout pif path (#203)
description: Repointed features/mercury-sample/pif_app/pubspec.yaml at the repository-local pif package and documented exact flutter pub get and dart analyze validation commands for the fixture
tags: [pi-extensions, pif, fixture, pubspec, portability, flutter]
timestamp: 2026-08-31T01:29:13Z
generated_at: 2026-08-31T01:29:13Z
generated_by: governed-sprint-builder
session_id: pending
commit_sha: []
branch: codex/pif-app-builder-154
issue_refs: [203]
capture_tier: session
---

# What Was Done

Changed the Team Pulse sample app to resolve `pif` from `../../../pif` instead of the workstation-specific absolute path. Added `features/mercury-sample/pif_app/README.md` with exact local validation commands and a short note about keeping any generated `pubspec.lock` out of the commit.

# Decisions Made

- Keep the fixture portable from a clean checkout by using a repo-relative dependency path.
- Document the local validation commands in the fixture itself instead of relying on remembered workflow steps.
- Treat any generated `pubspec.lock` as a throwaway validation artifact, not a committed fixture file.

# What Was Deprecated

- The hard-coded absolute workspace path in `pubspec.yaml`.
- The loose "discard any throwaway lockfile" wording that could be read as permission to remove tracked files.

# Lessons Learned

- A repo-relative path is enough for the sample to work from a clean clone.
- Validation instructions need to say exactly which commands to run so the fixture stays reproducible.
- Lockfile handling should distinguish generated scratch artifacts from tracked repository files.

# Current State

The sample tree is now portable and documented. No package generation or full Flutter validation was run in this turn; the change is limited to the path fix and fixture instructions.

# Checks

- `rg -n "/Users/tonyholovka/workspace/pi-extensions|../../../../../Users" features/mercury-sample/pif_app -g '*.*'`
- `sed -n '1,200p' features/mercury-sample/pif_app/README.md`
- `sed -n '1,80p' features/mercury-sample/pif_app/pubspec.yaml`
- `git diff --check -- features/mercury-sample/pif_app/pubspec.yaml features/mercury-sample/pif_app/README.md`
