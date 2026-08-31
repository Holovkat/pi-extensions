---
type: Inbox
title: Environment-bound asynchronous GitHub tracker (#222)
description: Tracker CRUD now uses the native environment connection, verifies the current repository, separates caches, and creates native parent links without blind issue retries.
tags: [pi-extensions, pif, tracker, github, repository-isolation, asynchronous, retry]
timestamp: 2026-08-31T09:45:43Z
generated_at: 2026-08-31T09:45:43Z
generated_by: orchestrated-dev-session
session_id: pending
commit_sha: []
branch: codex/pif-app-builder-154
issue_refs: [160, 221, 222]
capture_tier: session
---

# What Was Done

The tracker previously called the ambient `gh` session synchronously and permanently cached its first origin resolution. That could block the hub, retain a local-only or old repository binding, and reuse old cards after a project connected elsewhere. Its create path also retried without labels after any failure, risking duplicate issues and silently dropping board conventions.

`TrackerSync` now uses the current environment's `runEnvironmentGithub` adapter for GitHub operations. Refresh, list, move, create, update and delete are asynchronous. Production origin inspection remains a dedicated local Git call; the injected test runner can return immediate or asynchronous results. No token or ambient `gh` executable is accepted by the production tracker path.

Origin parsing requires an exact `github.com` hostname and valid owner/repository path. Reads and writes recheck it, clear old visible state when it changes, and load only that repository's cache. SQLite and JSON snapshots are keyed by repository; matching legacy snapshots can still be read. Local-only workspaces have an explicit disconnected status and no generic missing-remote error. GitHub remains the sole ticket authority; cached tickets cannot be edited offline.

Every mutation verifies GitHub's repository identity and that issues are enabled. Known read-only repository permissions preserve reads but disable writes. Missing write-permission metadata is described as unknown; GitHub still authorizes each attempted operation. Mutations are serialized and pinned to the repository/version visible when enqueued, optional client repository references are checked, and superseded refreshes cannot overwrite newer state. Operation replies identify their original repository.

Missing type/status labels are checked and created before issue creation. A creation is attempted once. A small per-repository recovery record contains only the request fingerprint and confirmed issue number, never its body or credentials. A confirmed issue is reused after a parent-link or close/readback failure. An uncertain creation with no confirmed number is not automatically repeated, including after restart; the user must inspect GitHub before proceeding. This is operational recovery metadata, not a local ticket store.

Creating a task can select a native parent epic/sprint by number, with legacy body reference parsing retained. The parent is verified in the current repository; the new child's numeric REST identity is linked through GitHub's sub-issue API. Refresh reads native child relationships and uses them ahead of legacy body references. CRUD continues to preserve type/status label conventions and reads authoritative issue state around edits.

Child session environments additionally scrub ambient GitHub token/profile/host keys and any bridge-related environment keys. The native bridge and its narrow label/sub-issue allowlist are owned by the separate GitHub connection implementation.

# Decisions and Superseded Behavior

- Remove ambient/global GitHub authentication from tracker production calls.
- Replace permanent null/old-origin caching and one shared cache row with current-origin checks and repository-specific snapshots.
- A queued or stale dialog action must never be retargeted to the same issue number in a different repository.
- Never retry issue creation without labels or treat an uncertain write as a definite failure.
- Preserve native GitHub issue/sub-issue authority and the existing body-reference compatibility path.
- Native repository creation remains an explicit onboarding UI operation; this tracker does not expose repository POST creation.

# Validation and Current State

The task writer read the frozen #222 packet and reviewed existing tracker, board and native adapter contracts. `node --check extensions/pif-shared.ts`, direct Node module import, and `git diff --check` pass. A TypeScript compiler was not available, so no full typecheck is claimed. No tests, live GitHub requests, credential operations, builds, UI actions, commits or pushes were performed by this task.

Root owns hub `await` integration, initial state, disconnected/readonly UI and client repository capture. #160 owns tests, including updated async runner fixtures and authoritative repository/issue responses; origin changes/spoofing and delayed refresh/write races; native parent persistence; new-repository labels; permission/connection failures; and confirmed/uncertain create recovery. The board retains its existing 300-issue limit and reads at most three 100-child pages per epic/sprint. Real environment-token, repository and restart verification remains outstanding; T1 static integration is not acceptance.

## Integration safety follow-ups

Root identified that Git can discover a creator repository above a new local-only child folder. Tracker origin resolution now first runs `git rev-parse --show-toplevel` and requires its canonical root to equal the canonical current workspace. An ancestor repository is explicitly disconnected before any origin lookup or GitHub operation. The resolver honors the configured `PIF_GIT_BIN` tool path; test runners must provide distinct top-level and origin responses.

The first #160 targeted test run also retained a failing #187 assertion for a bundle-directed legacy `tracker-cache.json` symlink. The earlier refactor guarded new repository-specific files but omitted the legacy path preflight. Init now guards that legacy destination even for disconnected workspaces, and legacy cache reads repeat the guard. The assertion was not weakened. Product syntax and diff checks pass; the dedicated test owner owns the targeted rerun and records its result separately.
