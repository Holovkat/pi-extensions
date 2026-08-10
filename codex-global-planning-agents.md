# Codex Global Planning Agents

This document defines the v1 planning pack installed under `~/.codex/agents/`.
It is the source-of-truth contract for the global planning agents used by
`/plan-feature`, `/plan-bugfix`, and `/plan-github`.

## Goals

- Keep planning orchestration separate from implementation work.
- Push lower-cost analysis into specialist agents while preserving a single final
  planning publisher.
- Reduce context repetition through a condensed shared brief.
- Keep delegated work observable through built-in Codex subagent activity.

## Operating Mode

Before committing to a planning depth, the orchestrator must infer how it should
operate from the user's wording, project trajectory, active issue/epic
state, recent commits, and known risk.

- `quick-fix`: minimize specialist calls, keep the issue tree narrow, and favor
  the smallest useful plan.
- `standard`: use the normal planning path with the smallest specialist set
  needed to remove uncertainty.
- `full-planning`: use the standard multi-agent planning flow with specialist
  analysis, synthesis, and canary validation when scope, risk, or ambiguity
  warrants it.

Confidence policy:

- High confidence: proceed and state the inferred mode briefly.
- Medium confidence: proceed with named assumptions and make the next decision
  point visible.
- Low confidence or high-risk unknowns: ask one focused question before acting.

Do not force a mode question when the project trajectory already makes the next
step clear.

## Agent Roster

| Agent | Model | Reasoning | Sandbox | Responsibility | Final publisher |
| --- | --- | --- | --- | --- | --- |
| `blueprint_orchestrator` | `gpt-5.4-mini` | `xhigh` | `workspace-write` | Interview, decide delegation, synthesize findings, publish GitHub planning artifacts | Yes |
| `req-analyst` | `gpt-5.4-mini` | `xhigh` | `read-only` | Requirement clarity, scope gaps, ambiguous assumptions, acceptance framing | No |
| `ux-analyst` | `gpt-5.4-mini` | `xhigh` | `read-only` | Workflow, operator experience, screen impact, visible planning outputs | No |
| `scenario-analyst` | `gpt-5.4-mini` | `xhigh` | `read-only` | Happy path, edge cases, exception coverage, regression scenarios | No |
| `tech-analyst` | `gpt-5.4-mini` | `xhigh` | `read-only` | Constraints, dependencies, sequencing, implementation-facing planning risks | No |
| `prd-writer` | `gpt-5.4-mini` | `xhigh` | `read-only` | Draft issue-ready blueprint sections, acceptance criteria, deferred scope notes, issue-ready summaries | No |

## Ownership Boundaries

- `blueprint_orchestrator` is planning-only. It may create or edit planning
  issues, but it may not edit implementation code.
- Specialists are read-only and report findings back to the orchestrator. They
  may not publish final GitHub issues or perform coding.
- Planning handoff stops at GitHub issues. Build or
  implementation work starts only from a later explicit user command.

## Shared Brief

Every delegated specialist starts from the latest condensed shared brief.
The orchestrator owns this brief and refreshes it after every completed or
blocked delegation.

### Required brief fields

- `planning_command`: one of `/plan-feature`, `/plan-bugfix`, `/plan-github`
- `goal`: the current planning objective
- `inferred_intent`: what the user appears to be asking the project to achieve
- `confidence`: high, medium, or low, with the reason
- `project_trajectory`: active branch, issue/epic state, recent commits, and prior decisions that shape the next step
- `active_vectors`: code, data-shape, data-content, config, service, provider, deployment, verification, cleanup, or closeout if already known
- `current_scope`: confirmed MVP or fix scope
- `constraints`: technical, product, or process constraints
- `non_goals`: explicitly deferred or excluded work
- `references`: relevant repo docs, issues, or screenshots
- `lessons_learned`: active lessons from prior delegations or canary runs
- `open_questions`: unresolved items for the current stage
- `expected_output`: what the specialist must return

## Communication Protocol

Codex custom agents do not have direct peer-to-peer messaging. v1 uses an
orchestrator-mediated protocol:

1. `blueprint_orchestrator` decides whether a specialist is needed.
2. The orchestrator delegates with the current shared brief and a clear ask.
3. Specialists return a fixed payload.
4. The orchestrator relays blockers, open questions, or follow-up findings into
   later delegations.
5. The orchestrator distills lessons learned before moving to the next stage.

### Specialist payload

Every specialist response must include:

- `task_id`
- `owner`
- `status`
- `deps`
- `blockers`
- `next`
- `eta`
- `evidence`

### Status lifecycle

Delegated work must use this lifecycle:

`queued -> claimed -> working -> blocked | ready -> done`

`needs-follow-up` is allowed when the orchestrator requires another pass after
reviewing the returned work.

## Delegation Rules

- Infer the operating mode and confidence before choosing specialists.
- In `quick-fix` mode, delegate only the minimum specialist set required to
  remove uncertainty and keep the plan lightweight.
- In `standard` mode, delegate to the smallest specialist set needed for the
  active vectors and open questions.
- In `full-planning` mode, use the normal specialist selection rules and canary
  validation path.
- Delegate only when the specialist can reduce orchestration cost or sharpen the
  resulting plan.
- Reuse the smallest specialist set necessary for the current stage.
- Prefer serial delegation when one specialist's output materially changes the
  next ask.
- Prefer parallel delegation only after the shared brief, ownership boundaries,
  and expected payload are stable.
- When a delegation stalls, narrow the ask or split the work instead of growing
  a catch-all follow-up.

## Validation Contract

- The planning pack must be installed globally under `~/.codex/agents/`.
- Built-in Codex subagent activity must appear whenever specialist delegation is
  actually used.
- Validation runs should follow canary order:
  1. `/plan-feature`
  2. `/plan-bugfix`
  3. `/plan-github`
- Lessons from each validation pass must be pushed into the next shared brief.
- v1 does not depend on retrieval MCPs or web research. Those are later
  efficiency optimizations, not completion requirements for this pack.
