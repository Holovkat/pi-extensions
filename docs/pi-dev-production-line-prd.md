# PRD: GitHub-Backed Production Line for `pi-req` and `pi-dev`

## Executive Summary

This project redesigns `pi-req` and `pi-dev` so they operate as a production line rather than a sequence of broad, cold-start phase handoffs.

The current system already has valuable primitives:

- RPC-based agent execution and steering
- checkpointing and session reuse
- GitHub issue integration
- review and UAT gates

But its default execution pattern still creates avoidable churn:

- epics are treated too often like build units
- implementation scope is too broad too early
- review and test phases reread too much context
- corrections often restart from reconstructed understanding instead of continuing from a hot task context

The redesign will make GitHub, the repo, and checklist artifacts the only durable source of truth while introducing:

- planning-time complexity scoring
- prerequisite-aware task scheduling
- task and atomic-step execution grain
- warm builder continuity across correction loops
- diff-scoped review and targeted testing
- dedicated sync skills that continuously write workflow state back to GitHub

The result should be faster correction cycles, better sequencing, lower reread overhead, and tighter alignment between planning and execution.

## Goals & Success Metrics

### Goals

1. Stop treating epics as default build units.
2. Make planning decide execution grain before implementation starts.
3. Ensure prerequisites are explicit and verified before a task enters the line.
4. Keep builders warm across build, review-fix, and test-fix loops.
5. Make review and test diff-scoped first, broad-gate later.
6. Keep GitHub and the repo as the only durable source of truth.
7. Reduce broad rereads and context reconstruction between phases.

### Success Metrics

1. Reduce average builder cold starts per task by at least 50%.
2. Reduce average correction loop time per task by at least 40%.
3. Increase percentage of tasks entering execution with all prerequisites satisfied to at least 90%.
4. Reduce broad validator runs per local correction by at least 60%.
5. Achieve restart reconstruction from GitHub issue state alone for at least 95% of paused or resumed tasks.
6. Keep GitHub issue/checklist state synchronized for 100% of task state transitions.

## User Personas

### 1. Operator

Needs:

- visibility into what is running now
- confidence that priorities and prerequisites are correct
- the ability to stop, replan, and reprioritize without drift

### 2. Planner

Needs:

- a way to convert large concepts into executable work packets
- a scoring system for complexity and execution readiness
- a scheduling model that reflects dependencies and execution lanes

### 3. Builder Agent

Needs:

- a narrow, stable execution packet
- continuity across correction loops
- explicit ownership and non-goals

### 4. Reviewer / Tester Agent

Needs:

- precise changed surfaces
- acceptance criteria
- explicit regression surface
- structured output expectations

## Functional Requirements

### 1. Planning Hierarchy

The planning system must support explicit hierarchy:

- application
- domain or capability area
- phase
- epic
- task
- atomic step

Acceptance criteria:

- every work item in the plan is typed at one of these levels
- epics cannot enter implementation directly unless explicitly marked executable

### 2. Complexity Scoring

The planning system must assign each work item a score from `10` to `1`.

Acceptance criteria:

- `10` denotes epic-scale or non-execution-ready work
- `1` denotes atomic, near-trivial implementation work
- the score determines execution lane, rejection behavior, and decomposition requirement

### 3. Prerequisite Tracking

Each executable task must carry explicit prerequisites.

Acceptance criteria:

- prerequisite status is tracked as `satisfied`, `missing`, or `waived`
- `pi-dev` does not begin work on a task with unmet prerequisites unless explicitly overridden

### 4. Execution Grain Selection

Planning must determine whether a work item is execution-ready at the task, sub-task, or atomic-step level.

Acceptance criteria:

- oversized tasks are decomposed before entering the line
- execution packets are narrow enough for a builder to complete within the assigned score band

### 5. Warm Builder Continuity

The execution system must preserve task-local continuity for builder agents.

Acceptance criteria:

- the same builder session can be reused for build, review-fix, and test-fix loops
- correction packets can be injected without rebuilding the entire prompt context from scratch

### 6. Diff-Scoped Review

Review must prioritize changed surfaces and declared interfaces before broad review.

Acceptance criteria:

- review packets include changed files, ownership boundaries, and acceptance criteria
- broad epic review is reserved for promotion gates

### 7. Targeted Testing

Testing must run in layers:

- changed-file checks
- task acceptance checks
- regression checks
- epic or milestone UAT

Acceptance criteria:

- local correction loops do not automatically trigger broad UAT
- targeted regression selection is explicitly recorded

### 8. GitHub-Backed Sync

Every significant workflow event must be written back to GitHub or checklist artifacts by dedicated sync logic.

Acceptance criteria:

- implementation updates are posted to issues
- review findings are posted to issues
- test results are posted to issues
- checklist state is updated when tasks progress or close

### 9. Line Stop and Replanning

The system must stop work when execution grain, prerequisites, or complexity band were misjudged.

Acceptance criteria:

- line-stop events record cause
- replanning can split work, reprioritize prerequisites, or rewrite task packets

## Non-Functional Requirements

1. The system must preserve GitHub and repo state as the only durable source of truth.
2. The system must remain restartable from issue and checklist state without depending on a private persistent ledger.
3. The workflow must remain observable by operators through existing pipeline state and dashboard surfaces.
4. Planning and execution decisions must be auditable from issue history and checklist changes.
5. The system must avoid excessive token use from repeated whole-repo rereads.

## User Stories & Workflows

### Story 1: Greenfield ERP Slice Planning

As an operator, I want `pi-req` to decide whether work belongs at domain, phase, epic, task, or atomic-step level so that `pi-dev` only receives executable work packets.

### Story 2: Enhancement Delivery

As an operator, I want an enhancement to be reviewed and tested only against touched surfaces first so that change scope stays narrow and execution cycles stay fast.

### Story 3: Bugfix Delivery

As an operator, I want root cause analysis to determine whether a bugfix is atomic or complex before work starts so that the bug does not enter the wrong lane and waste time.

## Technical Requirements

### 1. Planning Engine

Add planning logic that:

- scores complexity
- validates prerequisites
- assigns execution lane
- enforces score-band gating
- decides when decomposition is required

### 2. Task Context Loader

Add a runtime loader that reconstructs a task packet from:

- issue body
- parent epic issue
- checklist state
- issue comments
- recent review/test comments
- current diff or changed files

### 3. Dedicated Sync Skills

Add skills responsible for writing structured state back to GitHub or checklist files.

### 4. Builder Session Reuse

Adjust `pi-dev` execution logic so builder sessions can remain hot across corrections for the same task.

### 5. Review and Test Packetization

Add structured packets for:

- changed files
- touched criteria
- ownership boundaries
- regression surface
- open findings

## Data Model

### Task Packet

```json
{
  "taskId": "4.2",
  "issueNumber": 58,
  "title": "A* pathfinding",
  "complexityScore": 6,
  "lane": "feature-construction",
  "requirements": ["...", "..."],
  "acceptanceCriteria": ["...", "..."],
  "ownedFiles": ["src/pathfinding/*"],
  "doNotTouch": ["src/ui/*"],
  "prerequisites": [
    {"id": "3.1", "status": "satisfied"},
    {"id": "3.4", "status": "missing"}
  ],
  "openFindings": []
}
```

### Issue Comment Types

Required structured comment classes:

- Implementation Update
- Review Findings
- Test Results
- Line Stop / Replan
- Closure Summary

## Integration Points

1. GitHub issues and comments
2. checklist artifacts produced by `pi-req`
3. existing `pi-dev` pipeline state
4. existing dashboard surfaces
5. existing RPC agent runner and steer/abort flow

## Deployment Strategy

Implementation should be staged:

### Phase 1

- write PRD and backlog
- define comment schemas
- define complexity scoring and prerequisite schema

### Phase 2

- implement planning engine behavior in `pi-req`
- implement task packet assembly

### Phase 3

- implement builder continuity and correction packet flow in `pi-dev`
- add tracker sync skill

### Phase 4

- implement diff reviewer and targeted tester lanes
- update dashboards and state summaries

### Phase 5

- run pilot on one greenfield slice, one enhancement, one bugfix
- tune score bands and gating thresholds

## Risk Register

### 1. Overengineering the planning model

Risk:

- planning becomes slower than the value it adds

Mitigation:

- keep the hierarchy explicit but lightweight
- only require deeper planning for work above a threshold score

### 2. Sync drift

Risk:

- issue comments and checklist state fall behind actual code changes

Mitigation:

- dedicated sync skills
- structured comment schema
- explicit sync at each gate

### 3. Warm-session confusion

Risk:

- builder continuity causes stale assumptions

Mitigation:

- correction packets must include latest GitHub-backed findings
- line-stop events force packet refresh

### 4. Wrong scoring

Risk:

- tasks enter the wrong lane or get the wrong score band

Mitigation:

- tune score bands from live execution metrics
- require replanning on repeated overruns

## Scenario Validation

### Scenario A: Greenfield ERP Invoicing Build

Expected behavior:

- planning maps domain -> phase -> epic -> task
- foundations are identified first
- tasks with missing prerequisites do not enter implementation
- builders receive small, executable packets

### Scenario B: Enhancement to Existing Onboarding

Expected behavior:

- enhancement is split into task-ready units
- review and test are diff-scoped first
- broader UAT only happens at promotion points

### Scenario C: Bugfix From Root Cause to Regression

Expected behavior:

- root cause packet is produced first
- complexity score decides if fix is atomic or needs decomposition
- builder remains hot through correction loop
- regression coverage is recorded back to the issue

## Epics

### Epic 1: Planning Model Upgrade

Add hierarchy, scoring, prerequisite schema, and execution-grain logic to `pi-req`.

### Epic 2: GitHub Task Packet Runtime

Add task packet reconstruction and structured issue comment schemas.

### Epic 3: Warm Builder and Correction Loop

Refactor `pi-dev` so the same builder can remain task-hot across corrections.

### Epic 4: Diff Review and Targeted Testing

Introduce narrow review/test lanes before broad promotion gates.

### Epic 5: Operator Visibility and Metrics

Expose line-stop, lane, prerequisite, and score-band information in status outputs.

## Implementation Checklist

- [ ] **1.1 — Define planning hierarchy schema**
  - Description: Add explicit hierarchy representation for application/domain/phase/epic/task/step.
  - Files to create/modify: `extensions/req-qa.ts`, docs/schema docs as needed
  - Acceptance criteria:
    - hierarchy can be represented for new work
    - epics are distinguishable from executable tasks
  - Dependencies: none

- [ ] **1.2 — Define complexity scoring rubric**
  - Description: Implement `10` to `1` scoring guidance and attach expected execution grain and score-band gating rules.
  - Files to create/modify: `extensions/req-qa.ts`, planning docs/prompts
  - Acceptance criteria:
    - each work item can be scored
    - score influences decomposition and routing
  - Dependencies: 1.1

- [ ] **1.3 — Define prerequisite schema**
  - Description: Add prerequisite metadata and readiness statuses to planned tasks.
  - Files to create/modify: `extensions/req-qa.ts`, planning docs/prompts
  - Acceptance criteria:
    - tasks record prerequisites explicitly
    - readiness can be determined before execution
  - Dependencies: 1.1

- [ ] **2.1 — Define GitHub comment schemas**
  - Description: Standardize implementation, review, test, line-stop, and closure comment formats.
  - Files to create/modify: sync skill docs/prompts, GitHub integration helpers
  - Acceptance criteria:
    - schemas are structured and consistent
    - restart logic can reconstruct state from comments
  - Dependencies: 1.2, 1.3

- [ ] **2.2 — Build task-context-loader**
  - Description: Create logic to reconstruct a task packet from issue body, parent context, checklist state, and recent comments.
  - Files to create/modify: `extensions/dev-pipeline.ts` and supporting skill/prompt files
  - Acceptance criteria:
    - a task packet can be assembled without a second durable store
    - packet includes score, prerequisites, and open findings
  - Dependencies: 2.1

- [ ] **3.1 — Implement warm builder continuity**
  - Description: Ensure builders can remain hot across build, review-fix, and test-fix loops for the same task.
  - Files to create/modify: `extensions/dev-pipeline.ts`
  - Acceptance criteria:
    - same task can reuse builder session through correction loops
    - correction packets can be injected without full cold restart
  - Dependencies: 2.2

- [ ] **3.2 — Implement line-stop and replanning flow**
  - Description: Stop execution on overrun or missing prerequisite and route back to planning logic.
  - Files to create/modify: `extensions/dev-pipeline.ts`
  - Acceptance criteria:
    - overrun events trigger replan instead of blind continued chiseling
    - line-stop cause is visible and syncable
  - Dependencies: 1.2, 1.3, 3.1

- [ ] **4.1 — Add diff-reviewer lane**
  - Description: Create a review path that focuses on changed files and declared interfaces.
  - Files to create/modify: review agent prompts/skills, `extensions/dev-pipeline.ts`
  - Acceptance criteria:
    - local review uses changed surfaces first
    - broad review is reserved for promotion gates
  - Dependencies: 2.2

- [ ] **4.2 — Add targeted-tester lane**
  - Description: Create targeted test selection before broad regression and UAT.
  - Files to create/modify: tester agent prompts/skills, `extensions/dev-pipeline.ts`
  - Acceptance criteria:
    - local fixes trigger targeted checks first
    - UAT is not used as the default hot-loop validator
  - Dependencies: 2.2

- [ ] **4.3 — Add tracker-sync skill**
  - Description: Implement a dedicated role for posting state transitions and structured findings back to GitHub/checklist artifacts.
  - Files to create/modify: sync skill files, GitHub integration helpers
  - Acceptance criteria:
    - all major state transitions are written back consistently
    - repo and issue state remain synchronized
  - Dependencies: 2.1

- [ ] **5.1 — Surface score, lane, and prerequisites in operator status**
  - Description: Expose planning and execution metadata in pipeline state and dashboards.
  - Files to create/modify: `extensions/dev-pipeline.ts`, dashboard renderers
  - Acceptance criteria:
    - operator can see task score, lane, prerequisite status, and line-stop cause
  - Dependencies: 3.2, 4.3

- [ ] **5.2 — Pilot on three workflow types**
  - Description: Validate the new model with one greenfield slice, one enhancement, and one bugfix.
  - Files to create/modify: checklist/issues/test docs as needed
  - Acceptance criteria:
    - pilots produce measurable churn and replanning data
    - score bands and gating thresholds can be tuned from evidence
  - Dependencies: 3.2, 4.1, 4.2, 4.3, 5.1
