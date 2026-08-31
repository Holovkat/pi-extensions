---
type: Inbox
title: GitHub Settings uses one validation action
description: Simplified token settings and preserved automatic repository access refresh without exposing credential or environment internals.
tags: [pif, settings, github, workflow, verification]
timestamp: 2026-08-31T12:26:00Z
generated_at: 2026-08-31T12:26:00Z
generated_by: codex-orchestrator
branch: codex/pif-app-builder-154
issue_refs: [160, 221, 223]
capture_tier: session
---

## Product outcome

The owner requested a plain GitHub token workflow, without environment IDs,
technical scope wording or multiple competing actions. Settings now contains a
masked saved-token placeholder, an inline Remove control for confirmed saved
credentials, one right-aligned Validate button and concise status guidance.
Empty connections hide actions until text is entered. Validate uses the entered
candidate or the saved Keychain value; tokens are never retrieved for display.

## Decisions and boundaries

Keep validation-before-replacement and environment-scoped Keychain storage.
Do not imply a token is restricted to one repository; storage selection is not
a statement about GitHub permissions. Preserve the old token after a rejected
replacement and show safe failure text rather than a previous success state.
Locked/unknown Keychain status keeps explicit Validate, but no saved indicator
or Remove action until storage has confirmed the token exists.

Successful validation now has its own revision so same-account checks refresh
the existing tracker access path. Validation does not open repository onboarding,
create a repository or change origin. Removing Settings' repository action must
not strand local-only projects: their unlinked Tracker retains that setup action.

## Verification and current state

Clean analysis, 151 Flutter tests and 15 Node integration tests pass. Independent
review found no remaining actionable source findings. Signed installed
`/Applications/pif.app` PID83021 matches all four changed product files; builder
51b92859 contains 10,333 files. The previous installation is retained.

Computer Use confirmed the card and one live saved-token validation, showing
Connected to GitHub as Holovkat. A successful tracker fetch timestamp advanced;
identity and repository-decision file hashes stayed unchanged. No owner token
was extracted, replaced or removed. Repeated validation, failure and removal
regressions use synthetic native results.

Intermittent Flutter AXTree/Computer Use accessibility failures prevented proof
of a second live click; visual state remained usable. This diagnostic and wider
#160 acceptance remain open, along with previously separate chooser, credential
lifecycle and sample gates. Evidence is in the canonical installed-builder
verification report and `/tmp/pif-settings-workflow/`.
