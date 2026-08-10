# Codex Global Builder Agents

This document defines the v1 builder pack installed under `~/.codex/agents/`.
It is the source-of-truth contract for the governed build agents that begin from
`/start-session` and stop at `ready-for-integration`.

## Goals

- Keep planning handoff separate from build execution.
- Use `start-session` as the explicit user entrypoint into isolated worktree
  execution.
- Preserve one warm writer session per task instead of cold handoffs through
  correction loops.
- Reuse the same orchestrator-mediated communication pattern established for the
  planning pack.
- Keep build governance observable through built-in Codex subagent activity and
  issue-backed state.

## Builder Roster

| Agent | Model | Reasoning | Sandbox | Responsibility | Final publisher |
| --- | --- | --- | --- | --- | --- |
| `builder_orchestrator` | `gpt-5.4-mini` | `xhigh` | `workspace-write` | Intake, task-packet reconstruction, lane routing, warm continuity, line-stop and replan decisions, GitHub issue sync | Yes |
| `dev` | `gpt-5.4-mini` | `xhigh` | `workspace-write` | Sole durable writer for implementation code, tests, task-local fixtures, and correction work | No |
| `reviewer` | `gpt-5.4-mini` | `xhigh` | `read-only` | Diff-scoped correctness, acceptance, and owned-surface review | No |
| `tester` | `gpt-5.4-mini` | `xhigh` | `read-only` | Targeted verification against changed files, regression surface, and declared test artifacts | No |
| `compliance` | `gpt-5.4-mini` | `xhigh` | `read-only` | Requirement traceability and final `ready-for-integration` gate | No |

## Ownership Boundaries

- `builder_orchestrator` does not edit implementation code. It governs the
  build flow, task packet, status relay, and line-stop behavior.
- `dev` is the only agent allowed to make durable edits inside the task
  worktree. That includes code, tests, task-local fixtures, mocks, seed/setup
  scripts, and small task-scoped validation artifacts.
- `reviewer`, `tester`, and `compliance` are read-only by design. They analyze,
  verify, and report findings; they do not modify the worktree.
- Builder v1 stops at `ready-for-integration`. `uat-signoff`, QA promotion, and
  production promotion remain downstream workflows outside the core builder pack.

## Worktree Execution Model

- `start-session` remains the explicit user command that creates the isolated
  worktree and branch context.
- Worktree isolation is the execution container, not the governance layer.
- `builder_orchestrator` owns what happens inside that container once the task
  starts.
- Default builder mode is **sequential sprint mode**:
  - one prepared shared sprint worktree for a serial dependency chain
  - task packets still freeze per task
  - branch/worktree churn is avoided between adjacent serial tasks
- Separate task worktrees are reserved for:
  - true parallel lanes with disjoint ownership
  - isolated task replays
  - situations where the issue or user explicitly requires isolation

## Task Packet

Every task must start from a frozen task packet reconstructed from GitHub issue
content, issue state, comments, and current repo context.

### Required packet fields

- `task_id`
- `issue_refs`
- `goal`
- `inferred_intent`
- `confidence`
- `project_trajectory`
- `active_vectors`
- `current_scope`
- `constraints`
- `non_goals`
- `owned_files`
- `input_contracts`
- `output_contracts`
- `required_schema`
- `required_test_data`
- `required_artifacts`
- `preload_steps`
- `fixture_locations`
- `acceptance_criteria`
- `validators`
- `validation_scope`
- `regression_surface`
- `release_vector_matrix`
- `lessons_learned`
- `open_findings`
- `line_stop_conditions`

### Packet freeze rule

No parallel lane may start until the task packet is frozen.

If required schema, test data, artifacts, or preload steps are substantial and
missing, that is a prerequisite planning failure. The builder must line-stop and
route back to replanning instead of forcing `dev` to invent hidden upstream
work.

If the packet includes release vectors, the builder preserves them rather than
flattening the work into "small" or "large." Code, data-shape, data-content,
config, service, provider, deployment, verification, cleanup, and closeout rows
remain owned by the relevant specialist or project adapter.

## Communication Protocol

Builder uses the same orchestrator-mediated pattern as blueprint.

### Lane payload

Every lane response must include:

- `task_id`
- `owner`
- `status`
- `deps`
- `blockers`
- `next`
- `eta`
- `evidence`

### Lane lifecycle

Delegated lane work must use:

`queued -> claimed -> working -> blocked | ready -> done`

`needs-follow-up` is allowed when the orchestrator requires another pass.

## Lane Sequence

Default v1 sequence:

1. `start-session` creates the shared sprint worktree by default.
2. `builder_orchestrator` reconstructs and freezes the current task packet.
3. `dev` starts the warm implementation session.
4. `builder_orchestrator` captures a narrow change snapshot.
5. `reviewer` and `tester` may run from the same stable snapshot.
6. `compliance` runs after the correction loop is clean enough for the final
   builder gate.
7. Findings route back into the same warm `dev` session.
8. On success, the task exits as `ready-for-integration`.
9. The next adjacent serial task reuses the same prepared sprint worktree and
   repeats the packet-freeze and validation cycle.

## Warm Builder Continuity

- Warm continuity begins after the task packet is frozen and `dev` starts work.
- The same `dev` session is reused across build, review-fix, test-fix, and
  compliance-fix loops for the same task.
- Reviewer, tester, and compliance remain stateless lanes that work from the
  frozen packet plus the latest change snapshot.

## Complexity and Prerequisite Rules

- Small task-local fixtures or mocks may remain in the `dev` lane.
- Large schema work, data-shaping, preload payload generation, or broad
  environment setup increase task complexity and must be split into prerequisite
  tasks before the warm builder loop starts.
- Hidden prerequisite discovery is a line-stop, not “figure it out in dev.”

## Validation Contract

- Built-in Codex subagent activity must show lane use whenever delegation occurs.
- Validation should prove:
  1. task-packet freeze before execution
  2. warm `dev` correction reuse
  3. line-stop / replan on missing prerequisites or complexity creep
  4. inferred intent, confidence, trajectory, and active vectors carried into the handoff
  5. `ready-for-integration` handoff without absorbing UAT signoff into the hot loop
- v1 does not require a dedicated `lint-build` agent. Build and lint checks may
  be folded into `tester`'s targeted validation packet until evidence shows a
  separate lane is worth the coordination cost.
