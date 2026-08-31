---
type: Inbox
title: Reopenable installed pif development environments (#219)
description: Implemented local identity, versioned kit provisioning, explicit tool readiness and installed/source launch contracts with bounded T1 filesystem diagnostics; combined preview and two-generation acceptance remain #160.
tags: [pi-extensions, pif, builder, environments, flutter, lifecycle, github, okf]
timestamp: 2026-08-31T10:00:00Z
generated_at: 2026-08-31T10:00:00Z
generated_by: codex-development-environment
session_id: installed-builder-execution-2026-08-31
commit_sha: []
branch: codex/pif-app-builder-154
issue_refs: [219, 218, 221, 222, 160]
epic_refs: [152, 153]
capture_tier: session
---

# What Was Done

Added `EnvironmentIdentity` and `DevelopmentEnvironmentService` in `pif/lib/core/development_environment.dart`. A new or selected folder receives a UUID in `.pi/pif/environment.json` before Flutter or GitHub readiness. Invalid identities are preserved and rejected. The record has a schema version, pinned builder version (initially `unprovisioned`) and workspace-relative `pif` / `.pif/builder` references; the absolute root is resolved at launch. Runtime ignores are appended without replacing existing `.gitignore` content: `/.pi/` and `/.pif/builder/`, leaving `.pif/board.yaml` eligible for version control.

Provisioning uses #218's canonical builder helper and bundles its own immutable kit at `.pif/builder`, plus editable complete Flutter/macOS source at `pif`. It copies no creator workspace state, Git history/remotes, sessions, account connection or credentials. Repeat setup validates the kit, keeps the UUID, and preserves edited source. Failures and cancellation clean only the current invocation's unpublished staging directory. Source/kit collisions and symlink or signed-bundle destinations fail without overwriting existing files.

Added `DevelopmentToolchain` to discover prepared SDKs through an explicit saved location, `PIF_FLUTTER_SDK`, standard Homebrew/user locations and PATH. It checks Flutter 3.44–<4, Dart 3.12.2–<4, Git 2+, CocoaPods 1.15+, selected full Xcode and clang. Missing or incompatible prerequisites are actionable and do not erase identity or initiate installation, upgrades or license acceptance. Explicit SDK selection is stored only under local `.pi/pif` state.

The picker exposes New Project and Open Development Environment, with central-creation and identity-selection callbacks. Its local-only fallback supports provisioning, cancellation, SDK selection and retry. Colors follow the active application theme. `PiLauncher.start` accepts a readiness object and explicit `launchPreview` flag; ready launches use writable app source, the local kit runtime and explicit build paths. Each launch mints its own token/port, uses workspace-local sessions/catalog/cache, and strips ambient PIF/GitHub authority before constructing the child environment. Legacy writable-path checks are shared through `workspace_paths.dart`.

# Decisions Made

- Identity is local operational state, not a login or portable account connection. A fresh environment UUID has no inherited GitHub secure-store entry.
- Copy the versioned immutable kit to each environment so reopening and creating another environment does not require the creator process or repository checkout.
- Preserve native user profile resolution; do not duplicate its credentials into a new environment. GitHub scope remains the selected UUID and verified origin from #221/#222.
- Leave central Settings, main lifecycle, hub/FlutterSupervisor wiring and GitHub repository review to their existing owners. This task provides explicit callbacks and launch inputs rather than an alternative runtime.
- Keep only task-scoped T1 diagnostics here; #160 owns combined testing, installed UAT and release decisions.

# What Was Deprecated

Installed editable authoring must no longer point compiler or registry writes at signed `Resources/app` content. Existing read-only compiled-shell fallback remains useful while prerequisites are incomplete.

# Lessons Learned

- The kit CLI entry guard must canonicalize filesystem aliases such as `/tmp` versus `/private/tmp`; otherwise Node can exit successfully without running the command. The helper owner received the finding and fixed the canonical helper; the Dart caller also canonicalizes its kit path.
- macOS requires write permission on a directory being moved between parents. A frozen staged kit root is temporarily made writable only for publication, then resealed; cancellation cleanup likewise makes only its owned staging tree writable before removal.
- HTTP probing alone does not establish that a port is free. Launcher port selection now attempts a socket bind, and inherited hub tokens are accepted only for the same canonical workspace.

# Current State

The five owned Dart files passed narrow `dart analyze` with no issues. A standalone fixture using #218's real portable kit passed 29 checks covering early/stable/distinct UUIDs, malformed identity preservation, path collisions, unwritable-state and symlink/signed-bundle rejection, complete source/runtime copy, retained user edits, reopen with unavailable creator path, cancellation cleanup, missing SDK behavior and ambient authority stripping. Read-only version queries also found a compatible local toolchain; no Flutter build, UI launch, user process cleanup, system install, GitHub mutation, commit or tracker mutation was performed by this lane.

Evidence is under `/tmp/pif-installed-builder-execution-2026-08-31/219/` (`environment_diagnostic.dart`, `environment_diagnostic.json`, `analyze.txt`). The copied kit is a T1 diagnostic snapshot, not the final integrated release bundle. Actual editable preview, source-window lifecycle, two-generation creation, parent/sibling isolation and restart regression proof remain the combined #160 verification scope.
