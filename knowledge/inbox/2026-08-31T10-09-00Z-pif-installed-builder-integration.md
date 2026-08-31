---
type: Inbox
title: Installed builder, environment GitHub and Settings integration
description: Orchestrated implementation and verification of the owner-required installed authoring workflow, with explicit remaining live acceptance gates.
tags: [pif, installed-builder, environments, github, settings, verification]
timestamp: 2026-08-31T10:09:00Z
generated_at: 2026-08-31T10:09:00Z
generated_by: orchestrated-dev-session
session_id: pending
commit_sha: []
branch: codex/pif-app-builder-154
issue_refs: [152, 153, 160, 204, 218, 219, 220, 221, 222, 223]
capture_tier: session
---

# Product outcome

The settled requirement now has an integrated implementation: installed pif carries the immutable versioned builder resources, creates writable independently identified development environments, builds exports from those resources, and presents one small Settings surface for Appearance and an environment-scoped GitHub token. New Project includes explicit GitHub creation, connection and local-only choices. Local-only environments stay visibly disconnected from GitHub ticket authority.

Repository onboarding saves a sanitized creation intent before the remote request and reconciles the exact repository before retry. Definitive rejection allows correction; an uncertain network outcome never blindly repeats creation. Local Git setup does not commit, stage, push, overwrite an origin or change global Git identity. The tracker verifies the workspace is its own Git root and requires its own secure connection.

Token storage is macOS Keychain per environment UUID. Native GitHub commands receive the secret only in their transient clean environment. Agents, build processes, bus state, workspace files, kit copies and exports do not receive it. A new environment does not inherit its creator's GitHub connection. Explicit Validate/Replace/Remove can request Keychain authorization; background access cannot raise unsolicited prompts.

# Integration decisions and repairs

- Reused the existing picker, central docking tabs, supervisor, app model and export pipeline rather than introducing a second application framework.
- Kept runtime exports compiled; new editable source belongs in provisioned environments.
- Preserved live console state when opening/closing Settings, including split layouts; added shared readable light/dark theme behaviour without changing pinned product appearance.
- Used kernel-released locks for setup/repository recovery instead of stale exclusive-create lock files.
- Preserved existing environments and selected runtime-only fallback resources from their kit, never the creator's mutable project source.
- Retained legacy signed-bundle path guards and restored the existing dark-console text colour after regression checks.
- Found a readonly-kit repeat-build failure during native packaging. Both canonical builders now stage/validate before replacing output, with owned cleanup that does not traverse symlinks; final proof is recorded in the report.
- Real copied-runtime startup found a second packaging defect: applying source-cache exclusions to dependency packages dropped their required `build` code. Runtime copies now retain package code, kit-to-kit copying preserves the exact manifest inventory, and canonical builders run copied Pi with an empty profile before publication.
- Updated the existing global installer to copy the new required GitHub module, and aligned the existing local install runbook/droid to retain the old immutable bundle during replacement and stop only the canonical installed process.
- A fresh headless public app-init call exposed missing host package restoration. Restoring only the overlay allowed two analyzer identities for the same plugin type. The public tool now prepares the writable host package before the overlay; it no longer races or depends on preview startup, and the analyzer gate remains mandatory.
- Export portability checks found parent registry/source contamination in retained builder inputs. Installed packaging now retains its canonical immutable kit; source packaging regenerates a portable base-only registry. Compiling the runtime still uses the intended project source. The final proof additionally provisions an independent environment from the exported kit.

# Verification boundary

At the automated checkpoint, Dart analysis passed, 129 Flutter tests passed and 79 affected Node tests passed, including real hub and Flutter supervisor integration. A smoke harness needed to wait for actual asynchronous model activation before reading saved preferences. The original failure is retained in the diagnostic logs. Onboarding widget tests exposed a dropdown overflow, repaired before native handback.

Later native packaging/bootstrap repairs pass eight focused packaging checks and the fresh headless app-init integration regression. The final installed stock is signed, validates 10,333 kit files and runs as PID 53246. Fresh installed-service first/child creation, public two-page export and a further environment created from the exported kit all pass without manual package setup. The retained kit matches all 10,333 input files and version exactly; all three identities are independent and preserve edits on reopen. Native UI acceptance remains blocked by the locked Mac; native export naming remains a walkthrough check (the file/manifest are named, while CFBundleName is still pif).

The [verification report](../../docs/reviews/2026-08-31-installed-builder-verification.md) is the current authority for later packaging, install, native workflow and remaining live-token evidence. #160 remains the sole final test ticket. Separate #206/#212 sample approvals and owner acceptance are not supplied by these changes. No hosted deployment, merge or release acceptance is implied.

# Lessons and superseded assumptions

Readonly resource trees need an explicit output replacement/cleanup lifecycle; a successful first build is insufficient evidence for repeat builds. A copied builder kit is an input, not a mutable workspace. Account selection, repository authority and pending asynchronous results must all stay bound to the same environment. The earlier checkout-only support waiver and generic global GitHub login fallback are superseded by the owner's explicit requirements.
