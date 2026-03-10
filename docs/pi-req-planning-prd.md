# PRD: `pi-blueprint` Planning Engine

## Executive Summary

This PRD defines `pi-blueprint`, a new planning extension built from the current `pi-req` foundation.

The target outcome is for `pi-blueprint` to produce execution-ready work packets for `pi-builder`, not just a PRD and checklist. It must determine:

- planning hierarchy
- execution grain
- complexity
- prerequisites
- lane routing
- test intent

`pi-blueprint` remains upstream of `pi-builder`, but its output becomes operational rather than narrative.

## Goals & Success Metrics

### Goals

1. Introduce explicit hierarchy: application -> domain -> phase -> epic -> task -> atomic step.
2. Prevent epics from being treated as default build units.
3. Add a `10` to `1` complexity scoring model.
4. Add prerequisite awareness and readiness scoring.
5. Produce build-ready task packets and checklist artifacts for `pi-builder`.
6. Ensure planning can stop and rework oversized or blocked items before execution begins.
7. Enforce a hard rule that no execution-ready task is planned above `15 minutes`.

### Success Metrics

1. At least 90% of tasks entering `pi-builder` have prerequisites already satisfied.
2. At least 90% of planned executable items are at task, sub-task, or atomic-step grain rather than epic grain.
3. At least 80% of line-stop events in `pi-builder` trace back to known planning rules rather than missing planning metadata.
4. Planning outputs are sufficient for `pi-builder` to reconstruct task context from GitHub/checklist state without private sidecar dependency.
5. 100% of tasks estimated above `15 minutes` are rejected in planning and decomposed further before publication.

## User Personas

### Operator

Needs planning that reflects actual execution reality, not just good prose.

### Planner

Needs a structured system for:

- decomposition
- dependency mapping
- complexity scoring
- execution-grain selection

### Builder Pipeline

Needs tasks that are:

- narrow
- executable
- prerequisite-clean
- test-aware

## Functional Requirements

### 1. Hierarchy Modeling

`pi-blueprint` must model work across these levels:

- application
- domain
- phase
- epic
- task
- atomic step

Acceptance criteria:

- every planned work item is explicitly typed
- epics are not emitted as implicit build units

### 2. Complexity Scoring

`pi-blueprint` must assign a complexity score from `10` to `1` to each work item.

Acceptance criteria:

- `10` means non-executable, must decompose
- `1` means atomic and immediately executable
- score influences execution lane and time budget metadata
- no execution-ready task may be published if its estimated time exceeds `15 minutes`

### 3. Execution-Grain Decision

Planning must decide whether a work item is:

- planning-only
- task-ready
- sub-task-ready
- atomic-step-ready

Acceptance criteria:

- oversized items are decomposed before publication
- execution-ready items are clearly marked
- any item estimated above `15 minutes` is marked not execution-ready and sent back for decomposition

### 4. Prerequisite Tracking

Each executable task must list prerequisites.

Acceptance criteria:

- prerequisites can be marked `satisfied`, `missing`, or `waived`
- prerequisite state is included in the published task definition

### 5. Dependency Mapping

Planning must identify:

- upstream blockers
- parallel-safe work
- downstream dependencies

Acceptance criteria:

- each task includes dependency metadata
- planning can propose reprioritization when blockers are discovered

### 6. Verification Design

Planning must include intended verification shape for each task.

Acceptance criteria:

- each task includes expected validator type
- each task includes likely regression surface
- each task notes whether UAT relevance is local, epic-level, or milestone-level

### 7. Task Packet Publication

Planning output must include all information needed for `pi-builder` to reconstruct task context from GitHub and checklist artifacts.

Acceptance criteria:

- published issues/checklists include complexity, prerequisites, ownership, and acceptance criteria
- no second durable store is required

### 8. Planning Quality Gate

Before publication, each task must be checked for execution readiness.

Acceptance criteria:

- tasks with weak ownership, vague acceptance, or unmet critical prerequisites are sent back for replanning
- tasks estimated above `15 minutes` are rejected from execution publication
- tasks estimated at `20+ minutes` are explicitly flagged as complexity creep or planning failure

## Non-Functional Requirements

1. Planning must remain operator-readable.
2. Planning must preserve GitHub and repo artifacts as the only durable source of truth.
3. Planning should not create unnecessary bureaucracy for atomic or low-complexity work.
4. Planning decisions must be auditable from generated issues, checklist items, and comments.
5. Time-budget rejection must be deterministic and visible in planning outputs.

## User Stories & Workflows

### Story 1

As an operator, I want an ERP domain to be decomposed into executable tasks with explicit prerequisites so that `pi-builder` does not waste time discovering missing foundation work.

### Story 2

As a planner, I want a complexity score for each work item so that I can decide whether it should be executed directly or decomposed further.

### Story 3

As an execution system, I want planning output to include ownership boundaries and test intent so that I can run narrow build/review/test loops.

## Technical Requirements

### 1. Planning Schema

Add schema support for:

- hierarchy level
- complexity score
- prerequisite state
- execution lane
- time budget hint
- execution-ready boolean derived from the hard `15 minute` rule

### 2. Prompt / Planning Logic Updates

Update the new `pi-blueprint` extension, using the current `req-qa` behavior as the baseline, to:

- map domain -> phase -> epic -> task -> atomic step
- score work items
- determine execution grain
- refuse to publish oversized executable items

### 3. Checklist Enrichment

Checklist items must include:

- acceptance criteria
- dependencies
- complexity score
- prerequisite state
- likely owned files/modules

### 4. GitHub Publication Enrichment

Published issues must carry enough structured detail for downstream packet reconstruction.

## Data Model

### Planned Task Shape

```json
{
  "level": "task",
  "id": "2.3",
  "title": "Invoice tax calculation",
  "complexityScore": 6,
  "executionReady": true,
  "estimatedMinutes": 12,
  "lane": "feature-construction",
  "prerequisites": [
    { "id": "1.2", "status": "satisfied" },
    { "id": "2.1", "status": "satisfied" }
  ],
  "ownedAreas": ["src/invoicing/tax/*"],
  "acceptanceCriteria": ["...", "..."],
  "verificationIntent": {
    "validators": ["unit", "integration"],
    "uatScope": "epic"
  }
}
```

## Risk Register

### 1. Planning Overhead

Risk:

- planning becomes too slow

Mitigation:

- keep atomic and low-score work lightweight

### 2. False Precision

Risk:

- scores look precise but are inconsistent

Mitigation:

- start with coarse bands and tune from evidence

### 3. Weak Publication Format

Risk:

- GitHub issues/checklists lack enough structure for downstream use

Mitigation:

- define explicit issue/checklist schema

## Epics

### Epic 1: Planning Hierarchy and Schema

Add hierarchy model and execution-grain schema to `pi-blueprint`.

### Epic 2: Complexity and Prerequisite Scoring

Add scoring rubric and prerequisite readiness logic.

### Epic 3: Enriched Task Publication

Publish task packets through GitHub issues and checklist artifacts.

### Epic 4: Planning Quality Gate

Prevent weak or oversized tasks from entering execution.

## Implementation Checklist

- [ ] **1.1 — Define planning hierarchy schema**
  - Description: Add explicit hierarchy representation for application/domain/phase/epic/task/step.
  - Files to create/modify: new `pi-blueprint` extension files, related planning docs/prompts
  - Acceptance criteria:
    - planned items are typed by hierarchy level
    - epics are distinguishable from executable tasks
  - Dependencies: none

- [ ] **1.2 — Define complexity scoring rubric**
  - Description: Add `10` to `1` scoring guidance and bind it to execution grain, hard `15 minute` ceiling, and rejection rules.
  - Files to create/modify: new `pi-blueprint` extension files, planning docs/prompts
  - Acceptance criteria:
    - each work item can be scored
    - score affects decomposition and routing
    - work estimated above `15 minutes` is rejected from execution publication
  - Dependencies: 1.1

- [ ] **1.3 — Define prerequisite schema**
  - Description: Add prerequisite metadata and readiness states to planned tasks.
  - Files to create/modify: new `pi-blueprint` extension files, planning docs/prompts
  - Acceptance criteria:
    - prerequisites are explicit
    - readiness is clear before execution
  - Dependencies: 1.1

- [ ] **2.1 — Add execution-grain planning logic**
  - Description: Make planning decide whether a work item is planning-only, task-ready, sub-task-ready, or atomic.
  - Files to create/modify: new `pi-blueprint` extension files
  - Acceptance criteria:
    - oversized work is decomposed before publication
  - Dependencies: 1.2, 1.3

- [ ] **2.2 — Add planning quality gate**
  - Description: Block publication of weakly-scoped, blocked, or over-budget tasks.
  - Files to create/modify: new `pi-blueprint` extension files
  - Acceptance criteria:
    - vague acceptance, unclear ownership, unmet prerequisites, or `>15 minute` estimates trigger replanning
    - `20+ minute` estimates are flagged as complexity creep
  - Dependencies: 2.1

- [ ] **3.1 — Enrich checklist publication**
  - Description: Add complexity, prerequisite, and ownership metadata to checklist output.
  - Files to create/modify: PRD/checklist generation paths
  - Acceptance criteria:
    - downstream execution can infer readiness from checklist items
  - Dependencies: 2.2

- [ ] **3.2 — Enrich GitHub issue publication**
  - Description: Publish issues with task-packet-ready structure.
  - Files to create/modify: GitHub publication logic
  - Acceptance criteria:
    - issues contain execution-ready metadata
  - Dependencies: 2.2
