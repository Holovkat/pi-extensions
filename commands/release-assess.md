---
description: Assess release intent, confidence, change vectors, execution order, and specialist ownership before QA, production, cleanup, or closeout.
---

You are assessing a release or release-like change before moving it through QA,
production, cleanup, or closeout. Your job is to infer the user's intention,
check the project's trajectory, build a concrete change-vector matrix, and route
only the active vectors to the right specialists or project-local adapters.

## Core Rule

Do not reduce the decision to "small change" or "large change." A release is a
set of vectors. Execute the gates required by the active vectors, in dependency
order.

## Intent And Confidence

Before asking the user a question, inspect current evidence:

- current branch, status, and recent commits
- active issue, epic, or release notes
- nearest project instructions and release authority
- changed files and untracked files
- recent comments or deployment evidence when available
- project trajectory: what the project has been moving toward and what prior
  accepted decisions imply

Then state:

```markdown
## Intent Check

- Inferred intent: [one sentence]
- Confidence: high | medium | low
- Why: [evidence]
- Assumptions: [none or named assumptions]
- Next action: proceed | proceed with assumption | ask one focused question
```

Use this confidence policy:

- **High**: evidence and user wording agree. Proceed and report the inference.
- **Medium**: proceed only when the assumption is low-risk and named.
- **Low**: ask one focused question. Do not present a broad menu.
- **Any high-risk unknown**: ask before changing hosted environments, data,
  access, provider settings, or cleanup inventory.

## Vector Matrix

Use `scripts/release-vector-assess.sh` when it exists:

```bash
scripts/release-vector-assess.sh [base-ref]
```

If the script is unavailable, create the same matrix manually:

| Vector | Changed | Owner | Evidence Required | Depends On | Status |
| --- | --- | --- | --- | --- | --- |
| `code` | yes/no/unknown | implementation specialist | diff review, targeted test, visible/API smoke | [vectors] | pending |
| `data-shape` | yes/no/unknown | data specialist | migration/contract plan, backup when data can be affected, readback proof | [vectors] | pending |
| `data-content` | yes/no/unknown | data specialist | snapshot/backup if mutable data changes, cleanup/backfill evidence, readback proof | [vectors] | pending |
| `config` | yes/no/unknown | environment specialist | source-of-truth check, drift check, redacted before/after values | [vectors] | pending |
| `service` | yes/no/unknown | service/infrastructure specialist | restart/change evidence, health check, contract check | [vectors] | pending |
| `provider` | yes/no/unknown | provider/access specialist | boundary tuple, callback/webhook/role evidence, scoped smoke | [vectors] | pending |
| `deployment` | yes/no/unknown | deployment specialist | artifact identity, canonical target, promotion path, alias/domain mapping | [vectors] | pending |
| `verification` | yes/no/unknown | testing specialist | scenario list, pass/fail evidence, known limits | [vectors] | pending |
| `cleanup` | yes/no/unknown | deployment or repo-maintenance specialist | exact inventory, explicit approval, retained canonical resources | [vectors] | pending |
| `closeout` | yes/no/unknown | orchestrator/knowledge specialist | issue/docs/notes updated, lessons captured | [vectors] | pending |

## Specialist Ownership

The framework owns the matrix. Specialists own their rows. Each specialist row
must return:

```markdown
### [Vector] Specialist Result

- Current rule:
- What changed:
- What no longer serves:
- Applies when:
- Does not apply when:
- Evidence required:
- Project adapter:
- Stop conditions:
- Status:
```

## Execution Order

After the matrix is complete:

1. Resolve `unknown` vectors that can alter risk.
2. Put data-shape and provider/access contract changes before app deployment
   when the app depends on them.
3. Put config changes before rebuild/restart only when the runtime or build uses
   those values.
4. Put data-content cleanup before final smoke when stale or missing data affects
   the user-visible result.
5. Put service restarts only where the service vector changed or the project
   adapter requires it.
6. Put hosted cleanup after canonical deployment and alias/resource identity are
   proven, and only with explicit cleanup approval.
7. Close out only after active vectors have evidence.

## Output

Return:

- inferred intent and confidence
- vector matrix
- ordered execution plan
- specialist rows required
- project adapters found or missing
- stop conditions
- next action
