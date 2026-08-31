---
type: Inbox
title: Pif native profile setup guards first-run input and model selection
description: Empty profiles now produce actionable setup guidance before native input, and host model selection updates Pi before publishing the UI preference.
tags: [pif, native-profile, models, authentication, remediation]
timestamp: 2026-08-31T06:52:34Z
generated_at: 2026-08-31T06:52:34Z
generated_by: portable-node-packaging
session_id: pending
commit_sha: []
branch: codex/pif-app-builder-154
issue_refs: [160, 201]
capture_tier: session
---

# Observed Failure and Cause

A real exported-app launch with an empty native profile loaded the app but displayed an `unknown` model. Sending a message reached native Pi, which returned `Unknown provider: unknown`. The hub copied the native sentinel into host metadata and dispatched input without checking model availability. Its model selector also changed only hub preferences, leaving the native Pi model unchanged, so the existing control did not provide recovery.

# What Was Done

The hub now filters the unknown sentinel from displayed model IDs and uses native Pi's available-model registry before host input. Rejected host input is not appended as a delivered prompt and does not reach native Pi. A profile without an available model gets durable console setup guidance using the existing output event, including the actual native profile path and a shell-quoted command for bundled Pi. Instructions use the supported interactive `/login` and `/model` workflow or the native custom-provider `models.json`; they explicitly keep credentials out of chat.

Host model selection refreshes the native registry without catalog network refresh and activates the selected native model through `pi.setModel` before publishing the preference. Host input repeats the availability check before dispatch. The existing models refresh/save controls now await native registry refresh so a profile configured outside the app can be selected and retried. Relaunch remains an explicit supported recovery route. No custom authentication implementation, credential copying, launcher/UI changes, or child-process model preflight were added. Child invocations can use a separately configured Pi executable and remain outside this observed host defect.

# Evidence and Limits

The exact local path was traced through `createHostSession`, `sessionAction`, the console's existing output/error handling, and the installed Pi registry/extension APIs. `node --experimental-strip-types --check extensions/pif.ts` and `git diff --check` passed. No tests, builds, app launches, Computer Use, Git publication, or credential changes were performed by this implementation slice. Root owns the new regressions and fresh exported-runtime proof.

# Decisions and Lessons

App startup, model configuration, authenticated input, and a provider response are separate checks. Metadata that looks selected is insufficient unless the native runtime accepts that selection. Native Pi remains the authentication authority; the hub uses its availability and model-selection contracts and reports a safe setup path rather than inventing an unknown provider or a separate credential store. The prior unguarded send and preference-only host model selection are superseded by this checked path.

# Root Regression Evidence

Three focused native-host regressions fail on bdfe5bb4 and pass on this repair: unknown-model prevention/setup guidance; refresh/activation/send recovery; and activation rejection preserving preferences without exposing provider error details. The real hub integration smoke also passes with a loopback-only synthetic native model fixture. This is focused verification; final rebuilt UI and complete gate remain with #160.
