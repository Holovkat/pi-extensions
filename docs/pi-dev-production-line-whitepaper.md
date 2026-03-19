# pi-builder Production-Line Whitepaper

Source of truth: [GitHub Epic #2](https://github.com/Holovkat/pi-extensions/issues/2)

## Thesis

Execution quality improves when the builder operates on a single execution-ready task packet, stays warm through narrow correction loops, and escalates hidden prerequisites or large scope drift back to replanning instead of absorbing them into an ever-growing implementation prompt.

## Why `pi-builder`

The existing execution baseline in this repo is optimized around epic progression. The production-line model shifts that center of gravity to the individual task.

That shift enables:
- smaller prompts
- clearer ownership
- restartability from GitHub state
- narrower review/test loops
- faster progression to UAT-ready output

## Core Principles

### 1. Task-First Execution
The task issue body is the stable specification. Comments and labels are execution history.

### 2. Warm Writer Continuity
The same `dev` session should stay warm for build, review-fix, and test-fix loops. The writer should not need to re-learn the whole repo for a small correction.

### 3. Narrow Evaluator Surfaces
Review and testing should start from the changed surface:
- changed files
- touched interfaces
- touched acceptance criteria

Broader validation happens at promotion gates, not every correction loop.

### 4. GitHub-Restorable State
The builder must be able to restart from GitHub issue state plus current repo state. It should not depend on hidden durable memory.

### 5. Visible Line Stops
Blocked prerequisites, execution overruns, and planning-grain failures must stop visibly and route back to replanning.

## Builder Packet Shape

```json
{
  "task_id": "issue-52",
  "issue_refs": [52, 2],
  "goal": "Create pi-builder extension entrypoint",
  "owned_files": ["extensions/pi-builder.ts", "extensions/themeMap.ts"],
  "input_contracts": ["GitHub issue body", "task metadata", "current repo state"],
  "output_contracts": ["new extension entrypoint", "GitHub sync comment"],
  "required_schema": [],
  "required_test_data": [],
  "required_artifacts": ["docs/pi-dev-build-prd.md"],
  "preload_steps": ["read issue body", "read issue comments", "inspect git diff"],
  "fixture_locations": [],
  "validation_scope": ["task acceptance criteria"],
  "regression_surface": ["extensions/pi-builder.ts", "extensions/themeMap.ts"],
  "blockers": [],
  "lessons_learned": [],
  "next_lane": "build",
  "line_stop_conditions": ["missing prerequisites", "complexity > 5/10", "scope drift >= 8/10"],
  "expected_output": "pi-builder exists alongside pi-dev"
}
```

## Lane Model

### Intake
Reconstruct the packet from GitHub issue state and current repo state.

### Build
Run the warm `dev` session against the frozen packet.

### Review
Perform diff-scoped review focused on changed files and interfaces.

### Test
Run layered targeted checks before broader validation.

### Sync
Write major state transitions back to GitHub.

### Promotion
Run the final local gate to determine whether the task is ready for broader integration and UAT.

## Readiness Rules

A task is execution-ready only if:
- acceptance criteria are present
- prerequisites are available
- dependencies are resolved
- complexity is `<=5/10`

If any of those fail, the builder should line-stop instead of improvising more work.

## Scope-Drift Policy

Local correction loops are allowed for narrow fixes.

But if execution reveals:
- missing schema work
- missing test data or fixtures
- missing prerequisite artifacts
- or complexity drift at `8/10+`

then the work is no longer execution-ready and must return to replanning.

## Promotion to UAT-ready

A task reaches UAT-ready when:
- implementation is green
- review is clean or below blocking severity
- targeted testing passes
- compliance clears the threshold
- GitHub state is updated with the promotion decision

## Migration Boundary

`pi-builder` should exist alongside `pi-dev` until operators are ready to switch. Existing operator workflows and dashboard/control surfaces should remain compatible during migration.
