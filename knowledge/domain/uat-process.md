---
type: Domain
title: UAT Process
description: Automated Playwright-based UAT — scenario generation per epic, browser execution, results posting to GitHub issues, and approval gate.
resource: ./extensions/dev-pipeline.ts
tags: [pi-extensions, domain, uat, playwright, browser, scenarios, approval, testing]
timestamp: 2026-06-29T15:00:00Z
status: active
---

# UAT Process

The Fast Track pipeline includes automated UAT via Playwright browser automation, with an explicit approval gate before merge.

## UAT Scenario Generation

After compliance is resolved for each epic, the evaluator generates test scenarios. Each scenario becomes a GitHub issue under a UAT parent epic:

```
UAT Epic #101: "UAT Test Suite"                    [uat]
  +-- #102: "UAT: Canvas renders correctly"         [uat-pending, epic-1]
  +-- #103: "UAT: Game loop 60 FPS"                [uat-pending, epic-1]
```

Each issue body contains: epic name, inputs, steps, and expected outcomes.

Labels are created automatically: `uat`, `uat-pending`, `uat-pass`, `uat-fail`, `epic-N`.

## UAT Execution

Once every epic passes, the pipeline runs the full UAT suite:

1. **Server startup** — starts `python3 -m http.server 8080` if not already running
2. **Scenario execution** — for each scenario: Playwright navigates, executes steps (click, type, press key, wait), takes snapshots, records pass/fail per step
3. **Results posting** — posts a comment on each scenario issue with per-step results
4. **Label updates** — `uat-pending` replaced with `uat-pass` or `uat-fail`

## Approval Gate

The pipeline halts and waits for user decision. The dashboard flashes "AWAITING UAT APPROVAL" (yellow, 2Hz).

### Approve (`/pipeline-approve`)
- Closes the UAT epic on GitHub
- Closes all passed scenario issues
- Proceed to `/pipeline-end` for squash merge and push

### Reject (`/pipeline-reject`)
- User provides rejection notes
- Notes posted as comments on failed scenario issues
- Failed scenarios reset to `uat-pending`
- Run `/pipeline-next` to trigger fix cycle; UAT re-runs only previously failed scenarios

## Related Concepts

- [Fast Track Architecture](../architecture/fast-track-architecture.md)
- [GitHub Integration](../architecture/github-integration.md)
- [Pipeline State System](../architecture/pipeline-state-system.md)
- [Sprint Development Workflow](../process/sprint-development-workflow.md)
