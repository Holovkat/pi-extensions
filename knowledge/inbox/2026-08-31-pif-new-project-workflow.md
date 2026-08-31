---
type: Inbox
title: New Project follows saved setup state
description: Simplifies the New Project journey and resumes local preparation without repeating saved repository or token work.
tags: [pif, onboarding, workflow, settings, verification]
timestamp: 2026-08-31T11:54:40Z
generated_at: 2026-08-31T11:54:40Z
generated_by: orchestrated-dev-session
session_id: pending
commit_sha: []
branch: codex/pif-app-builder-154
issue_refs: [160, 219, 222, 223]
capture_tier: session
---

# Product outcome

The owner found the saved-project screen confusing: it offered Retry setup, SDK selection, Open without preview and Settings together even though only local workspace preparation was missing. Their GitHub repository decision was already linked. This is a state/workflow defect, not a request for more application modes or an expanded Settings platform.

New Project now asks for name/location before repository details, reveals connection/review controls only when relevant, prepares local resources automatically and opens the ready project. Open/Recent automatically finishes missing local preparation. Saved local/linked decisions are reused; repository operations and token setup are not repeated just to create the writable source.

Settings remains a quiet header reference. Returning preserves draft values and workflow state. A real setup failure offers one recovery entry; Flutter SDK location is exposed only inside relevant help after discovery actually fails. The routine preview bypass is removed from this journey. Repository-only changes in an existing project remain available without re-running the authoring setup gate.

# Boundaries and lessons

Preserve existing files, environment UUID, Keychain scope, explicit remote confirmation and durable uncertain-request recovery. Do not clone credentials between projects or alter GitHub authority. An identity/repository being saved does not mean local source preparation is complete; resume the unfinished step rather than showing every possible recovery tool. Normal setup copy should describe the user's next action, not internal marker files or build architecture.

# Verification

Clean analysis, 142 Flutter tests (including ten onboarding and six picker regressions), and 15 Node integration checks pass. Final signed installation is PID69833 with builder eba14829. Computer Use verified the simplified first step/Settings return and the final installed app automatically prepared/opened the owner's existing project while preserving UUID and repository decision. A separate system folder chooser was visible to the owner but not addressable by Computer Use; fresh-project GUI completion remains explicit in the verification report. No broader epic, live credential lifecycle or sample-design acceptance is implied.
