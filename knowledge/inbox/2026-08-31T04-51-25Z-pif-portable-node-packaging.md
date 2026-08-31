---
type: Inbox
title: Pif stock and export bundles require a portable Node runtime
description: Shared runtime selection rejects host-linked Node binaries and verifies copied startup before reporting a complete app build.
tags: [pif, packaging, export, macos, node, remediation]
timestamp: 2026-08-31T04:51:25Z
generated_at: 2026-08-31T04:51:25Z
generated_by: portable-node-packaging
session_id: pending
commit_sha: []
branch: codex/pif-app-builder-154
issue_refs: [160, 217]
capture_tier: session
---

# What Was Done

Both canonical macOS builders now use `scripts/pif-node-runtime.sh` to select and package Node. Selection prefers an existing runtime associated with the Pi installation, then version-manager/PATH candidates. `PIF_NODE_BIN` is an explicit override and fails without silently selecting a different runtime if unsuitable. No runtime downloads or host dependency trees are copied.

Preflight runs before Flutter compilation. It requires a Mach-O binary supporting the build host architecture, only canonical system-library dependencies, and a stable Node version at least 22.19.0. The actual copied runtime must start with an empty environment, removing dynamic-loader and Node option overrides. Both builders repeat the runtime check after signing before reporting completion.

# Decisions and Lessons

A successful Flutter build and code signature do not establish that the bundled Node can launch. The observed Homebrew Node depended on `@rpath/libnode.147.dylib` and additional Homebrew libraries. Copying only that executable created an app that could not start. The existing Node associated with Pi used only system libraries and is suitable for the current build host. Host-linked runtimes are rejected instead of attempting to reconstruct an arbitrary developer installation inside the app.

# Evidence and Current State

Narrow checks passed: shell syntax for all three scripts; selection of the existing Pi-associated Node v22.22.0; a copied executable starting with an empty environment despite injected invalid Node/dynamic-loader options in the caller; explicit rejection of the actual Homebrew runtime; and selection of the portable runtime with Homebrew first on PATH. Only a disposable temporary directory was created and removed.

No full build, installed app launch, Computer Use, cross-architecture execution, complete regression run, or acceptance was performed by this implementation slice. Root orchestration owns those checks and publication. Support for another architecture requires an existing Node binary with that architecture; this evidence is from the current arm64 host only. No existing product feature was deprecated; only unconditional copying of the first PATH Node runtime was superseded.

Root review and bounded diagnostics also pass: portable selection/copy in a path containing spaces and an apostrophe, clean-environment execution, and explicit missing/Homebrew override rejection before creating output. Evidence: `/tmp/pif-remediation-2026-08-31/217-root-runtime-checks.json`. Real rebuilt artifacts and UI remain pending.
