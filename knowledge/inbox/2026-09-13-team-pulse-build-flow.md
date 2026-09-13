---
type: Inbox
title: Team Pulse built conversationally through the pif build flow
description: The approved two-page Mercury sample plus its status extension were authored by scoped child sessions through the analyzer gate, including a real diagnostic and retry cycle.
tags: [pif, mercury, team-pulse, app-builder, agentic-build]
timestamp: 2026-09-13T09:00:00Z
generated_by: zcode-orchestrator
branch: codex/pif-app-builder-154
epic_refs: [152]
issue_refs: [206, 158, 160, 212]
capture_tier: session
---

# What Was Done

#206 implemented: the approved Team Pulse sample was built end to end through
the conversational build flow in a fresh workspace (`~/workspace/team-pulse`)
under a headless hub. Host prompts drove `pif_app_init --template mercury`,
`pif_app_page_add` (Metrics), `pif_app_widget_add` (team_pulse_status, status
slot) and the confirming `pif_app_list`. Three scoped child sessions authored
the shared immutable demo foundation, the Home page, the Metrics page and the
status extension, each closing through `pif_widget_install`. Four installs are
in the transcripts; the Home child's first install failed the analyzer gate
(unused element) and was corrected and reinstalled in-session — the required
visible diagnostics/retry cycle, produced naturally. Transcripts are preserved
in `docs/reviews/evidence/team-pulse-2026-09-13/` and in the workspace.

# Decisions Made

The sample workspace stays durable at `~/workspace/team-pulse` so Dev UAT opens
the real built project. The repo fixture mirrors the flow output. The
workspace `pif_app` package path dependency was repointed from the run's
scratch app dir to the repository checkout so future analyzer runs resolve
without run scaffolding. `pif_app_build`/export was deliberately not run:
#160 owns export artifacts and launch/restart acceptance.

# What Was Deprecated

The untouched scaffold pages in `features/mercury-sample/pif_app/` are
replaced by the flow-built implementations. The earlier offline
init/page-add/list run is superseded by this conversational build.

# Lessons Learned

Driving the real flow headlessly needs the envelope `v`/`ts` fields, an
always-open stdin for the rpc host, and workspace-scoped ports to coexist
with the installed app's 31415 hub. The analyzer gate catches genuine drafts:
the first Home draft shipped an unused component and the child repaired it
from the returned diagnostics exactly as designed.

# Current State

#212 (theme foundation) and #206 (sample build) are development complete and
in review; combined Dev UAT runs against `~/workspace/team-pulse` in the
installed pif. #160 remains the sole T2 owner (regressions, export, combined
gate). #158's acceptance evidence is now attached. No merge or release
authorized by this checkpoint.
