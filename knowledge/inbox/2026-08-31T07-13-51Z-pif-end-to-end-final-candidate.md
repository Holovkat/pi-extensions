---
type: Inbox
title: Pif final candidate passes full gate and native recovery workflows
description: Fresh end-to-end run fixes setup, history and path defects; preserves remaining owner acceptance gates.
tags: [pif, verification, computer-use, remediation, history, native-profile]
timestamp: 2026-08-31T07:13:51Z
generated_at: 2026-08-31T07:13:51Z
generated_by: codex-root
branch: codex/pif-app-builder-154
issue_refs: [160, 201, 204, 205, 206, 212, 215]
capture_tier: session
---

## What was done

On the owner's fresh end-to-end request, the complete canonical gate first passed at bdfe5bb4. Real empty-profile, recovery and restart use then found three additional defects: native host setup/selection, empty-failure history contamination, and URI-encoded filesystem paths. Atomic commits 62f86b07, f1fdd926 and dc45ff40 repair these; failing-baseline regressions and focused checks are retained.

The final clean-checkout gate passed on dc45ff40: 66 Node tests, clean Dart analysis and 81 Flutter tests in one run. Independent review found no concrete blocker. The canonical stock build and real native pif_app_build export passed, with correlated buildId 10fbe4f6-ca1b-4c6b-8262-9f23d8476f62 and a responsive hub during compilation.

Computer Use proved native child answers, Steer during streaming with correct reopen, Abort followed by successful tool recovery, stock widget toggles, export Settings/Home navigation, no-auth guidance and guarded Send, real configured write/read, and restart persistence. The 10,450-byte legacy host transcript was copied exactly into the real-space path and its original remains unchanged. Successful history now retains green footers and its own duration.

## Current state and decisions

Stock is installed at /Applications/pif.app and left at the clean picker as PID 81004; workflow PID 76691 was normally quit. Export /tmp/pif160-ui-31x_h8mg/build/UI Workflow Check.app final PID 80355 was normally quit. Post-UI hashes match for all 13,263 stock files and 10,327 export files; strict signature checks pass. No merge, release or hosted deploy occurred. No credentials or device security settings were changed.

All 27 native #160 remediation children remain open: 24 implementation tasks in Review, and #204/#206/#212 blocked. The remaining gates are the installed-vs-checkout export boundary, explicit Team Pulse design approval and actual approved sample/appearance implementation. The native folder chooser could not be targeted by Computer Use, and no completed user selection was observed. Existing-profile recovery is proven; new OAuth and denied secret-store access were not exercised.

## Lessons and superseded assumptions

Passing automated tests and building/signing are insufficient for native runtime acceptance. A model label must correspond to the actual native selection; an empty failed answer must still close its turn; URI paths are not filesystem paths. Preserve old history before correcting persistence destinations. The earlier full-gate gap is now resolved, but none of these successes waive outstanding product requirements or owner approval.

## Evidence

Current report: docs/reviews/2026-08-31-remediation-verification.md. Raw evidence: /tmp/pif-e2e-2026-08-31/. The original review and prior failures remain available; this synthesis does not erase them or claim defect-free behavior outside the exercised workflows.
