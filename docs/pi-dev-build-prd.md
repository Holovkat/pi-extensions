# PRD: `pi-builder` Build, Review, Test, and Delivery Engine

## Executive Summary

This PRD defines `pi-builder`, a new execution extension built from the current `pi-dev` foundation.

It consumes planning output from `pi-blueprint`.

The target outcome is:

- task-first execution
- warm builder continuity
- diff-scoped review
- targeted testing
- line-stop and replanning on overruns or bad prerequisites
- continuous GitHub-backed state synchronization

`pi-builder` should stop behaving like a chain of cold broad passes and instead behave like a controlled manufacturing cell.

## Goals & Success Metrics

### Goals

1. Use tasks or sub-tasks, not epics, as the default execution unit.
2. Keep builders warm across correction loops.
3. Review changed surfaces first, not the entire epic every time.
4. Run targeted tests before broad validation.
5. Stop and replan when execution grain or prerequisites were wrong.
6. Write workflow state back to GitHub continuously.
7. Refuse execution-ready tasks that exceed the hard planning ceiling of complexity score `5/10`.

### Success Metrics

1. Reduce average correction-loop time per task by at least 40%.
2. Reduce average builder cold starts per task by at least 50%.
3. Reduce broad validator runs per local fix by at least 60%.
4. Ensure 100% of major state transitions are synced back to GitHub/checklist state.
5. Keep at least 95% of restarts reconstructable from GitHub and repo artifacts alone.
6. Ensure no task enters execution with a complexity score above `5/10`.

## User Personas

### Operator

Needs:

- a visible execution line
- clear understanding of what is running and why
- clean line-stop and replanning behavior

### Builder Agent

Needs:

- stable task packet
- continuity across corrections
- narrow instructions and file ownership

### Reviewer Agent

Needs:

- changed files
- touched interfaces
- acceptance criteria

### Tester Agent

Needs:

- regression surface
- targeted validator selection
- promotion rules for broader UAT

## Functional Requirements

### 1. Planning-Engine Intake

`pi-builder` must not simply execute the next checklist item blindly.

Acceptance criteria:

- execution begins only after task readiness is confirmed
- lane and execution gating are derived from planning metadata
- tasks scoring above `5/10` are rejected back to replanning before build begins

### 2. Task Context Loading

`pi-builder` must reconstruct a live task packet from GitHub and repo state.

Acceptance criteria:

- task packets can be reconstructed from issue body, comments, checklist state, and current diff

### 3. Warm Builder Continuity

`pi-builder` must support task-local warm builder sessions.

Acceptance criteria:

- the same builder can continue across build, review-fix, and test-fix
- correction packets can be injected without a full cold start

### 4. Change Snapshot Generation

The builder must emit a narrow change snapshot for downstream review/test.

Acceptance criteria:

- changed files and touched acceptance criteria are available for the next lanes

### 5. Diff-Scoped Review

Review must inspect changed files and relevant interfaces first.

Acceptance criteria:

- local review avoids whole-epic sweep by default
- promotion-gate review can still be broader when needed

### 6. Targeted Testing

Testing must run in layers.

Acceptance criteria:

- local loop runs changed-file, task-acceptance, and targeted regression checks first
- broad UAT is reserved for promotion points

### 7. Tracker Sync

Dedicated sync logic must post state transitions and findings back to GitHub/checklist artifacts.

Acceptance criteria:

- implementation updates are posted
- review findings are posted
- test findings are posted
- closure summaries update checklist and issue state

### 8. Line Stop / Replan

If a task overruns or a prerequisite problem is discovered, `pi-builder` must stop the line for that task and route back to replanning.

Acceptance criteria:

- overrun and blocked-prerequisite events are visible
- replanning can split, defer, or reprioritize work
- any task packet that reveals hidden scope at complexity score `8/10` or higher is treated as a red-flag planning failure, not tolerated as normal execution

### 9. Promotion Gates

Broader validation must happen at promotion points, not every local correction.

Acceptance criteria:

- epic integration and UAT are explicit promotion gates
- local correction loops avoid unnecessary broad validation

## Non-Functional Requirements

1. Execution must remain restartable from GitHub and repo state.
2. Execution must minimize repeated whole-repo rereads.
3. Operator visibility must remain compatible with current dashboard/state patterns.
4. The system must preserve steer, abort, and watchdog control behavior.
5. The system must enforce the planning score ceiling consistently even if oversized work is handed to execution.

## User Stories & Workflows

### Story 1

As an operator, I want the same builder to continue fixing a task after review findings so that the system does not lose local context.

### Story 2

As a reviewer, I want to review only changed surfaces and relevant interfaces so that the loop stays fast.

### Story 3

As a tester, I want targeted regression selection before broad UAT so that bugfix and enhancement loops do not overpay in validation cost.

## Technical Requirements

### 1. Task Packet Runtime

Implement task context reconstruction from:

- issue body
- parent epic
- checklist state
- review/test comments
- current diff

### 2. Builder Session Reuse

Extend task-local session reuse so builder state remains hot through correction loops.

### 3. Review and Test Packets

Define structured packets for:

- changed files
- owned files
- touched interfaces
- open findings
- regression surface

### 4. Sync Skill Integration

Add dedicated sync behavior for GitHub/checklist write-back.

### 5. Line-Stop Handling

Add execution logic for:

- overrun handling
- missing prerequisite handling
- task splitting / replanning handoff

## Data Model

### Runtime Task Packet

```json
{
  "taskId": "4.2",
  "issueNumber": 58,
  "complexityScore": 6,
  "planningGate": "rejected-decompose",
  "lane": "blocked-replan",
  "ownedFiles": ["src/pathfinding/*"],
  "acceptanceCriteria": ["...", "..."],
  "prerequisites": [
    {"id": "3.1", "status": "satisfied"}
  ],
  "openFindings": [],
  "currentDiff": {
    "filesChanged": ["src/pathfinding/a_star.ts"],
    "baseCommit": "abc123"
  }
}
```

### Required Sync Comment Types

- Implementation Update
- Review Findings
- Test Results
- Line Stop / Replan
- Closure Summary

## Integration Points

1. `pi-blueprint` output and checklist artifacts
2. GitHub issue/comment state
3. current `dev-pipeline.ts` behavior as the migration baseline
4. dashboard / pipeline-state outputs
5. existing RPC steering and watchdog controls

## Deployment Strategy

### Phase 1

- implement task packet reconstruction
- implement comment schemas

### Phase 2

- implement warm builder continuity
- implement correction packet loop

### Phase 3

- add diff-reviewer and targeted-tester lanes
- add tracker-sync skill

### Phase 4

- add line-stop and replanning logic
- expose lane / score / prerequisite state to operators

### Phase 5

- run pilots on greenfield, enhancement, and bugfix flows

## Risk Register

### 1. Warm-session drift

Risk:

- builder remains hot but outdated

Mitigation:

- refresh task packet from GitHub-backed findings before each correction loop

### 2. Review misses wider impact

Risk:

- diff-scoped review misses broader regression risk

Mitigation:

- use broader promotion-gate review at epic or milestone boundaries

### 3. Incomplete sync

Risk:

- GitHub state falls out of sync with actual execution

Mitigation:

- dedicated sync skill
- mandatory sync at each major transition

### 4. Excessive replanning

Risk:

- line-stop logic triggers too often

Mitigation:

- tune score bands and gating thresholds from pilot data

## Scenario Validation

### Scenario A: Greenfield Feature Construction

Expected behavior:

- only ready tasks enter execution
- builders remain hot through local corrections
- epic-wide checks happen only at promotion

### Scenario B: Enhancement Flow

Expected behavior:

- enhancement work stays narrow
- review/test loops are localized
- issue state stays synchronized

### Scenario C: Bugfix Flow

Expected behavior:

- root-cause-backed fix packet enters the right lane
- targeted regression runs before broader validation

## Epics

### Epic 1: Task Packet Runtime

Add task context loader and packet assembly.

### Epic 2: Warm Builder Continuity

Refactor builder execution to stay task-hot across corrections.

### Epic 3: Diff Review and Targeted Testing

Introduce narrow downstream lanes before broad gates.

### Epic 4: Tracker Sync and Line Stops

Add durable GitHub-backed state sync and replanning behavior.

### Epic 5: Operator Visibility

Expose lane, score, prerequisite, and line-stop state in the UI/status layer.

## Implementation Checklist

- [ ] **1.1 — Build task-context-loader**
  - Description: Reconstruct runtime task packet from issue body, comments, checklist state, and current diff.
  - Files to create/modify: new `pi-builder` extension files, supporting skill/prompt files
  - Acceptance criteria:
    - task packet can be assembled without a second durable store
  - Dependencies: planning PRD outputs available

- [ ] **1.2 — Define runtime packet schema**
  - Description: Standardize fields needed by builder, reviewer, and tester.
  - Files to create/modify: new `pi-builder` extension files, docs/prompt files
  - Acceptance criteria:
    - packet includes complexity, lane, prerequisites, and open findings
  - Dependencies: 1.1

- [ ] **2.1 — Implement warm builder continuity**
  - Description: Reuse builder session for the same task across build and correction loops.
  - Files to create/modify: new `pi-builder` extension files
  - Acceptance criteria:
    - same task can remain in one hot builder context across local loops
  - Dependencies: 1.2

- [ ] **2.2 — Implement correction packet injection**
  - Description: Feed review/test findings back into the hot builder without full cold re-assembly.
  - Files to create/modify: new `pi-builder` extension files
  - Acceptance criteria:
    - correction loop works through narrow packets
  - Dependencies: 2.1

- [ ] **3.1 — Add diff-reviewer lane**
  - Description: Review changed files and declared interfaces first.
  - Files to create/modify: review agent prompts/skills, new `pi-builder` extension files
  - Acceptance criteria:
    - local review does not default to whole-epic sweep
  - Dependencies: 1.2

- [ ] **3.2 — Add targeted-tester lane**
  - Description: Run changed-file checks, task acceptance checks, and targeted regression before broader validation.
  - Files to create/modify: tester prompts/skills, new `pi-builder` extension files
  - Acceptance criteria:
    - broad UAT is not the default hot-loop validator
  - Dependencies: 1.2

- [ ] **4.1 — Add tracker-sync skill**
  - Description: Create dedicated GitHub/checklist sync behavior for all major transitions.
  - Files to create/modify: sync skill files, GitHub integration helpers
  - Acceptance criteria:
    - all major state transitions are written back consistently
  - Dependencies: 1.1

- [ ] **4.2 — Implement line-stop and replanning flow**
  - Description: Stop execution on overrun or prerequisite discovery and route back to replanning.
  - Files to create/modify: new `pi-builder` extension files
  - Acceptance criteria:
    - overrun does not just continue blindly
    - blocked tasks can be split, deferred, or reprioritized
    - tasks scoring above `5/10` never enter execution
    - any task that drifts into `8/10+` scope is surfaced as planning failure / complexity creep
  - Dependencies: 2.2, 4.1

- [ ] **5.1 — Add promotion gates**
  - Description: Separate local validation from epic/milestone promotion validation.
  - Files to create/modify: new `pi-builder` extension files
  - Acceptance criteria:
    - local correction loops remain narrow
    - broader validation runs at promotion boundaries
  - Dependencies: 3.1, 3.2

- [ ] **5.2 — Expose operator metadata**
  - Description: Show lane, score, prerequisites, and line-stop cause in state outputs and dashboards.
  - Files to create/modify: `extensions/dev-pipeline.ts`, dashboard renderers
  - Acceptance criteria:
    - operator can see task execution context clearly
  - Dependencies: 4.2, 5.1
