---
type: Inbox
title: Pif remediation behavior regressions prepared for the combined gate
description: Root-owned tests cover the reviewed tracker, native transcript, source precedence, export preflight, bootstrap and bundle safety contracts without claiming final artifact acceptance.
tags: [pif, testing, remediation, native-ui, export]
timestamp: 2026-08-31T04:28:00Z
generated_at: 2026-08-31T04:28:00Z
generated_by: root-verification
session_id: pending
commit_sha: []
branch: codex/pif-app-builder-154
issue_refs: [160, 187, 194, 195, 196, 199, 201, 202, 207, 208, 209, 211, 215, 216]
capture_tier: session
---

# What Was Done

Added behavior regressions to the existing Node unit/integration and Flutter widget suites. Fixtures use owned temporary roots and synthetic errors. No real credentials or unrelated processes are used as test fixtures. The coverage includes bootstrap atomicity and bundle path guards, source precedence and failed-install rollback, app manifest publication and scaffold preservation, required-widget preflight at public and direct-script boundaries, native transcript role/message/tool boundaries, native profile file selection, export startup preference, and tracker request correlation.

## Evidence and Limits

Focused checks identified defects in intermediate source drafts; those failures are retained in /tmp/pif-remediation-2026-08-31. Subsequent focused checks passed after corrections. At this capture the latest source is 1f088f6f; all 52 cases across the console/core and tracker widget files pass. Fifteen focused native/bundle cases pass; the broader pre-final Node check passed 45 cases before the final profile/export/tracker joins. Required-widget checks pass four cases, and profile, export-mode and tracker-result checks each pass their focused case.

These counts overlap. The complete npm run test:pif gate, final public-tool export, stock/install/signature checks and final Computer Use walkthrough have not yet been run on the complete candidate. The owner-gated build support disposition and Mercury design/sample requirements remain open under #204, #206 and #212. Historical approvals are preserved; no release acceptance or hosted deployment is asserted.

## Decisions and Lessons

Keep a single combined acceptance gate under #160. A fake spawn proves protocol behavior, not a compiled export or provider answer. Native errors and aborts must remain visible rather than being suppressed to make a test appear clean. A final release claim requires the named installed artifact and its actual workflow evidence.
