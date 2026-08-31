---
type: Inbox
title: Pif launcher keeps filesystem paths decoded and preserves legacy host history
description: URI conversions no longer create percent-encoded filesystem destinations; eligible legacy host transcripts are copied without overwriting either history.
tags: [pif, launcher, filesystem, history, migration, remediation]
timestamp: 2026-08-31T06:58:44Z
generated_at: 2026-08-31T06:58:44Z
generated_by: portable-node-packaging
session_id: pending
commit_sha: []
branch: codex/pif-app-builder-154
issue_refs: [160, 201]
capture_tier: session
---

# Observed Failure and Cause

The exported app used a real `Application Support` workspace but reported a host session under the separate literal `Application%20Support` directory. The expected canonical session file was absent while the encoded-path file contained history. Its native session header identified the correct real-space workspace. Three launcher conversions returned `Uri.path`, which is encoded, as though it were a filesystem path. Resolving raw relative strings also interpreted literal percent/hash characters as URI syntax.

# What Was Done

Path normalization, canonical suffix resolution, and relative native-profile resolution now use file URIs and `toFilePath`. Raw filesystem suffixes use `resolveUri(Uri.file(...))` so literal reserved characters remain filename characters.

Before creating a new canonical host transcript, the launcher checks for its legacy encoded-path counterpart. A nonempty regular legacy file is eligible only when its first native session header belongs to the same canonical workspace. An existing canonical destination always wins and is never overwritten. Eligible history is copied into owned staging under the canonical parent, checked for size/mtime changes, then published with the macOS `link` utility's atomic no-overwrite operation. The legacy file remains intact. Only the staging directory created by this operation is removed. Read, copy, or publication failures surface; profile credentials and unrelated directory trees are not migrated.

# Evidence and Limits

The exact launcher path was traced against the existing runtime path and session header, without changing any live data. Targeted `dart analyze lib/core/pi_launcher.dart` and `git diff --check` passed. The debug seam `debugMigrateLegacyHostSession` exposes the real migration helper for root-owned temporary-fixture regressions; `debugResolveCanonicalPath` remains the path-resolution seam. This slice ran no tests, builds, launches, live migration, Computer Use, Git commits, or cleanup of existing paths. Root owns regression and real-runtime acceptance.

# Decisions and Lessons

URI path text and filesystem path text are different representations. Decode through the file-URI API and encode literal filename input before URI resolution. Correcting future paths must not silently strand existing conversation history or overwrite a separately established canonical history. Legacy migration is deliberately limited to a verified host transcript and preserves its original source.

## Root verification

The literal-space/percent/hash path regression fails on bdfe5bb4 and passes on the repair. Migration checks pass for exact history preservation, unchanged legacy bytes, canonical-destination precedence, foreign-workspace rejection and staging cleanup. The bundle-alias guard also passes; targeted Dart analysis is clean. The real export legacy history is 10,450 bytes and has no canonical counterpart before final launch. No live migration has yet been claimed. Final native proof remains under #160/#201.
