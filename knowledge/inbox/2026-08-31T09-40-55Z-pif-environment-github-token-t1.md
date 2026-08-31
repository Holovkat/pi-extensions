---
type: Inbox
title: Environment-bound GitHub token broker prepared for integration
description: T1 implementation of native Keychain token handling and a bounded environment GitHub adapter; live credential and installed UAT gates remain open.
tags: [pif, github, keychain, environments, settings, security]
timestamp: 2026-08-31T09:40:55Z
generated_at: 2026-08-31T09:40:55Z
generated_by: codex-github-token
branch: codex/pif-app-builder-154
issue_refs: [160, 219, 221, 222, 223]
capture_tier: session
---

## What changed

Added a native `pif/github` MethodChannel in `MainFlutterWindow.swift`. Only the native broker reads saved credentials. One macOS Keychain generic-password entry is keyed by environment UUID and `github.com`; it contains the token plus verified account/capability metadata. Save/Validate validates a candidate before atomic Keychain replacement. Failed validation or secure-store writes preserve the existing credential. Remove only deletes that environment's entry. No file fallback, browser flow, global GitHub login, native Pi profile change, or credential-read method exists.

Added `core/github_connection.dart` as the small Settings/onboarding contract: environment selection, safe connection state, Save/Validate/Remove, direct bounded GitHub operations, and a user-only Unix HTTP socket for the existing tracker. It discards responses after environment switches. The Settings group and launcher/environment lifecycle are owned by the adjacent implementation slices.

Added `extensions/pif-github.ts` as an asynchronous adapter for the existing tracker runner. It reads only the environment UUID and sends scoped requests to the native broker. Missing identity or connection fails without ambient `gh`/`GH_TOKEN` fallback. No GitHub token crosses the socket, bus, workspace, export, or agent environment.

## Decisions and boundaries

- `gh` runs only in the native broker with a fresh allowlisted environment, temporary empty HOME/config directory, a fixed GitHub host, bounded timeout/output, and the token in the trusted child environment rather than argv. No secret is written to the temporary directory. Bundled `Resources/pi/gh` is preferred if present; known absolute GitHub CLI installation paths otherwise remain explicit prerequisites.
- Native validation allowlists complete command arguments, API paths, fields and methods. Tracker issue and label operations must match the selected workspace's credential-free GitHub origin. Repository creation POST is available through explicit UI onboarding only; the hub socket cannot create repositories.
- Account verification does not imply organization or fine-grained repository permissions. Classic `repo`/`public_repo` scopes can establish known capability limits. Fine-grained creation capability remains unknown, including when the scopes header is empty; an explicit Create attempt receives GitHub's actual decision. No repository-deletion scope or operation is requested.
- The user-only Unix socket is operational environment isolation, not a sandbox against arbitrary code already running as the macOS user. Workspace/UUID validation and a bounded API limit its authority; it never exposes credentials. Unix socket path lengths have an explicit actionable limit; socket startup failure must not prevent local-only work.
- Ambient tracker authentication is superseded for the environment-backed pif path. Native model/provider authentication remains separate.

GitHub API/CLI behavior was checked against the official [repository API](https://docs.github.com/en/rest/repos/repos?apiversion=2022-11-28) and [GitHub CLI environment reference](https://cli.github.com/manual/gh_help_environment).

## T1 evidence and lessons

- `dart analyze pif/lib/core/github_connection.dart`: clean focused analysis.
- `swiftc -typecheck` against the installed FlutterMacOS framework and existing generated plugin registrar: clean native type check; no native execution.
- `node --experimental-strip-types --check extensions/pif-github.ts`: syntax passed.
- One disposable synthetic Unix adapter diagnostic passed identity-required, disconnected/no-fallback, scoped request, safe response, and disallowed-command handling. It used a synthetic account response; it did not call gh, Keychain or a remote service.
- Separate the UI's secret operation API from the tracker's data API. Sharing a broker does not require exposing repository creation or credential methods to the hub.

## Current state and remaining gates

This is implementation prepared for integration, not credential/runtime acceptance. No real tokens were read, stored, replaced or removed. No repository was created or mutated. No builds, full suites, installed-app launches, deployments, commits, pushes or tracker updates were performed by this slice.

#160 owns test additions and integration checks for denied/locked Keychain, failed replacement, revoked tokens, restart, environment/child isolation, in-flight environment switches, secret redaction, socket lifecycle, account/organization restrictions, repository creation recovery, native subissue linkage and existing tracker regression. Installed Save/Validate/Create/Reopen/Remove plus a second unconnected environment remain explicit T3 evidence. Final source/launcher and Settings integration must be checked together before acceptance.
