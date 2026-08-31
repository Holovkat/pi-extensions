---
type: Inbox
title: Team Pulse design approved for the sample build
description: Owner-delegated approval of the corrected Home and Metrics design, shared demo snapshot, Mercury appearance and real status extension.
tags: [pif, team-pulse, design, mercury, approval]
timestamp: 2026-08-31T21:48:09Z
generated_by: codex-orchestrator
branch: codex/pif-app-builder-154
commit_sha: [00cac934f2a2ef647ceb61981a24b25208492ba1]
epic_refs: [152]
issue_refs: [158, 160, 206, 212]
capture_tier: session
---

# Decisions Made

The owner accepted the recommended Team Pulse correction and delegated the
final design revision. Home is now the useful weekly dashboard, Metrics is the
detailed interpretation surface, and the unsupported About route and Overview
alias are removed. The design is approved on 1 September 2026 and binds the
build loop.

The sample uses the pinned documented Mercury accent, paired light/dark tokens
with System as the initial appearance, and one shared immutable demo snapshot.
It includes a real `team_pulse_status` status-slot extension using the same data
as the pages.

# What Was Deprecated

The earlier landing-page design with Quick access cards, an About destination
without a page, session-local page values and an unresolved accent question is
superseded. The build must not restore those routes or allow each page to own a
different copy of the metric data.

# Lessons Learned

A sample intended to prove an application builder still needs a coherent user
outcome. Shell navigation should not be duplicated inside Home. Freezing the
shared data and appearance boundary in the design prevents the implementation
loop from renegotiating product structure or leaking generated-app styling into
the IDE.

# Current State

`features/mercury-sample/pif_app/design.md` is the approved recipe. The existing
Home and Metrics Dart files remain scaffold placeholders; no widget code or
export was produced during this design-only step. #212 is ready for its bounded
pinned-template appearance implementation. #206 remains dependent on #212 and
then owns the approved pages, shared demo foundation and status extension.
#158 and #160 remain open for the recorded conversational build and final
integrated verification.
