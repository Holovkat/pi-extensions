---
type: Inbox
title: pif export launcher now refreshes workspace manifest atomically (#202)
description: Updated scripts/build-pif-project-app.sh so exported apps validate the bundled app.yaml with parseAppManifest, require the source app id to match the exported app id, back up any differing or malformed same-app workspace manifest as app.yaml.export-backup-<timestamp>-<pid>, and replace it with same-directory atomic renames on launch
tags: [pi-extensions, pif, export, bootstrap, manifest, launcher, atomic, backup]
timestamp: 2026-08-31T02:05:00Z
generated_at: 2026-08-31T02:05:00Z
generated_by: governed-sprint-builder
session_id: pending
commit_sha: []
branch: codex/pif-app-builder-154
issue_refs: [202]
capture_tier: session
---

# What Was Done

Updated `scripts/build-pif-project-app.sh` so the exported macOS app no longer treats the workspace manifest as a one-time first-launch copy. The script now emits a dedicated `bootstrap-manifest.mjs` helper into the bundle and the generated launcher invokes it on every start. The helper reuses the shared `parseAppManifest` parser from `extensions/pif-shared.ts`, validates the bundled `app.yaml` before mutating anything, requires the source manifest id to match the exported app id, and updates the workspace copy with same-directory atomic renames. If an existing workspace manifest differs or is malformed but belongs to the same app, it is preserved as `app.yaml.export-backup-<timestamp>-<pid>` before replacement.

# Decisions Made

- Keep the bootstrap logic inside the export script as a generated helper rather than introducing a new runtime parser path.
- Use the shared `parseAppManifest` implementation instead of a parallel YAML parser.
- Use positional argv for the internal bootstrap helper because the generated launcher is the only caller.
- Remove the pre-helper `mkdir -p` from the launcher so source validation happens before any workspace mutation.

# What Was Deprecated

- The first-launch-only manifest copy path.
- The permissive helper flag parser and default app-id fallback.
- Silent overwrites of differing workspace manifests.

# Lessons Learned

- The exported app id must be enforced as an identity check, not only as an error label.
- Same-directory rename keeps the manifest update atomic, but the backup filename also needs a process component so concurrent launches do not trample each other. Malformed prior bytes are backed up too, so recovery has a concrete manifest to restore.
- The workspace bootstrap still needs the shared path-guard hook from #187 before it can safely reject paths inside `.app/Contents`; that integration is intentionally left for the #187 guard work.

# Current State

The launcher/bootstrap path is updated and validated only through disposable workspace diagnostics. No real export build, installed-app launch, or user-profile mutation was run for this slice.

# Checks

- `bash -n scripts/build-pif-project-app.sh`
- Disposable Node diagnostics that exercised first launch, repeat no-op launch, same-app user-edited manifest backup/replace, foreign-app id refusal, and invalid source refusal
- Verified that the helper leaves no `.stage-` files behind and does not touch sentinel data/config files in the disposable workspaces
