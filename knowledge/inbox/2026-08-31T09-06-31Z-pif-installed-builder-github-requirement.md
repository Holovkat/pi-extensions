---
type: Inbox
title: Installed pif builder and GitHub project setup required
description: Owner resolves installed export scope and adds repeatable local development environments plus secure GitHub onboarding.
tags: [pif, planning, export, environments, github, authentication]
timestamp: 2026-08-31T09:06:31Z
generated_at: 2026-08-31T09:06:31Z
generated_by: codex-root
branch: codex/pif-app-builder-154
issue_refs: [152, 153, 159, 160, 190, 204, 218, 219, 220, 221, 222]
capture_tier: session
---

## What was done

Updated the existing open [app-builder epic #152](https://github.com/Holovkat/pi-extensions/issues/152), sprint #153, export #159, reconciliation #204 and final verification #160. Created five atomic implementation tasks, all native children of #160: #218 bundled builder resources; #219 local development environments which can create more environments; #220 installed-app export; #221 secure GitHub connection Settings; #222 local/GitHub repository creation and tracker binding. Linked related runtime self-management backlog #190 without merging its scope. Live readback verified every published body, open state, planned label and native child relationship. An independent requirements review passed the five-task split with minor interface clarifications; the canonical bundle build-kit root, per-environment identity metadata and primary GitHub-backed creation flow are now explicit in the affected tickets.

## Decisions and scope

The owner requires the installed application to build apps and provision editable local development environments, including a created environment's ability to create another. Checkout-only export is not an accepted scope reduction. The subsequent owner instruction adds GitHub creation now, superseding the earlier suggestion to defer it, with application Settings for user authentication. #204 is no longer awaiting that product decision; it is To Do for canonical specification reconciliation. The implementation remains planned, not shipped.

Acceptance starts from installed pif, without a pi-extensions source checkout, and covers Settings, new local/GitHub project, tracker, development environment, conversational build, export and actual native launch/response. A second-generation environment must also build/export through the same capability. Existing #160 remains the only final verification owner; no duplicate epic or verification ticket was created.

Development environments use writable project state and explicit pinned build resources/toolchain setup. They do not mutate signed bundles or copy parent tickets, history, credentials, remotes or live runtime identity. GitHub remains authoritative for epics/tasks; local-only mode clearly disconnects the tracker and can connect later. Planned Settings prefer browser sign-in with a supported masked-token option and secure OS storage, prohibit plaintext fallback and token leakage into projects/exports, and keep account selection explicit. Ordinary AOT runtime exports remain distinct from editable development environments; new widgets require compilation/re-export, not an implied RFW implementation.

## Current state and lessons

#160 now has 32 native remediation children: 24 in Review, six To Do (including #204 and the five additions), and two blocked on independent sample design/appearance approval (#206/#212). The prior dc45ff40 tests/artifacts remain historical evidence for their tested scope, not proof of these new requirements. No application implementation, build, live repository creation, credential changes, toolchain setup, merge or deployment occurred in this planning session.

Keep runtime self-management (#190), GitHub access, local Git state and build-tool availability distinct. Installed runtime portability does not establish an installed authoring environment. Preserve safe creation retries, explicit repository identity and credential isolation in the new workflow. The authoritative detailed plan is in the tracker; this note records the decision and links rather than duplicating the task specifications.
