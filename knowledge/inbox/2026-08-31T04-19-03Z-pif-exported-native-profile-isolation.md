---
type: Inbox
title: pif exported native profile isolation in launcher (#201)
description: Tightened PiLauncher startup so exported app launches disable ambient extension, skill, and prompt-template discovery while still loading the bundled pif extension and validating the native profile destination before spawn
tags: [pi-extensions, pif, launcher, export, native-profile, okf]
timestamp: 2026-08-31T04:19:03Z
generated_at: 2026-08-31T04:19:03Z
generated_by: dev-session
session_id: pending
commit_sha: []
branch: codex/pif-app-builder-154
issue_refs: [201]
capture_tier: session
---

# What Was Done

Updated the owned launcher surface in `pif/lib/core/pi_launcher.dart` for #201:

- `PiLauncher.start()` now detects exported launches via `PIF_EXPORTED=1` and adds `--no-extensions`, `--no-skills`, and `--no-prompt-templates` only in that mode.
- Exported launches now load the bundled `pif.ts` explicitly and fail closed if the app bundle does not contain it.
- `PI_CODING_AGENT_DIR` is now resolved before spawn, expanded for `~` / `~/`, anchored to the child workspace when the value is relative, and validated with the existing bundle-safe writable-path guard.
- The resolved native profile path is passed through to the child process as an absolute canonical destination before any native profile writes can happen.
- Normal non-export launches still use the existing extension discovery path and keep the command shape unchanged apart from the validated native-profile env.

## Decisions Made

- Exported launch isolation is controlled by the existing `PIF_EXPORTED=1` contract rather than a new toggle.
- The launcher now mirrors the native CLI's own tilde expansion semantics for `PI_CODING_AGENT_DIR`, then resolves relative values against the child workspace because the launcher and child process do not share the same cwd.
- The launcher keeps using the existing bundle-safe destination guard instead of introducing a new validation helper or a parallel path policy.
- I did not change the native profile contents, copy credentials, or widen the startup surface beyond the supported CLI flags already present in the Pi CLI source.

## What Was Deprecated

- Implicit ambient discovery for exported app launches is superseded by explicit sealed-launch flags.
- The previous launcher behavior that validated `PI_CODING_AGENT_DIR` only as an unexpanded path from the Flutter process cwd is superseded.

## Lessons Learned

- The native CLI already supports the exact sealed-launch flags needed here (`--no-extensions`, `--no-skills`, `--no-prompt-templates`), so the launcher should use those directly instead of inventing a new mode.
- `PI_CODING_AGENT_DIR` needs both tilde handling and workspace-relative resolution when the launcher cwd differs from the child process cwd; otherwise the validation can point at the wrong destination.
- The launcher can keep the export change small if it only branches on `PIF_EXPORTED` and leaves the non-export path intact.

## Current State

- `pif/lib/core/pi_launcher.dart` is the only production file changed for this task.
- `dart analyze pif/lib/core/pi_launcher.dart` passed with no issues after the path-resolution fix.
- Exported app launches now run with a sealed native discovery surface and a validated canonical native profile path.
- The index was intentionally left untouched for this task packet.

## Root integration and verification boundary

Hub models and enabled-model settings now follow the same PI_CODING_AGENT_DIR authority, with native-style tilde expansion. PIF_MODELS_PATH remains a deliberate hub compatibility override. Export instructions name the native profile and bundled interactive /login /model flow, replacing the incorrect app-workspace .pi path. No credentials are copied, no permissions are changed, and no custom OAuth flow is added. Static validation and a synthetic profile-path check are implementation evidence; final exported native-provider response and clean-profile provisioning remain separate gates.
