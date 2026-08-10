---
description: Review planning artifacts against the Q&A/intake record before build approval
---

You are performing a **Plan Review**. This is a read-only gate that compares
the planning output against the original request, Q&A session, imported issue,
or discovery notes before implementation starts.

**THIS IS A BLOCKING GATE** - Do not start build work until the plan is ranked
as approved or the user explicitly accepts a documented exception.

---

## Required Inputs

- Original user request, Q&A transcript, imported issue, or discovery notes
- Epic or parent issue draft
- Phase / sprint issue draft
- Task issue drafts
- Local GitHub issue state, if present
- Open decisions, assumptions, non-goals, and risks

If any input is missing, mark the review `BLOCKED` and state the exact missing
artifact.

---

## Review Checklist

Compare the plan against the Q&A/intake record:

| Area | What to verify |
| --- | --- |
| Scope | Every accepted outcome from the Q&A appears in the plan. |
| Non-goals | Excluded work is named so builders do not infer it later. |
| Acceptance criteria | Each task has observable completion criteria. |
| Evidence | Required tests, screenshots, commands, data checks, or approvals are named. |
| Dependencies | Required credentials, environments, data, APIs, or upstream work are explicit. |
| Ownership | Each task has a clear file/module/workflow boundary. |
| Risks | Known risks and line-stop conditions are visible. |
| UAT | User-facing scenarios can be derived from the plan. |

---

## Ranking

Return one rank:

| Rank | Meaning | Decision |
| --- | --- | --- |
| `A - Approved` | Plan fully reflects the Q&A/intake record and can be built. | Build may start after owner approval. |
| `B - Conditional` | Minor gaps exist, but they are documented and can be accepted by the owner. | Ask for explicit approval or patch the plan. |
| `C - Incomplete` | Missing requirements, unclear acceptance criteria, or weak evidence gates. | Return to planning. |
| `D - Replan` | Scope mismatch or hidden prerequisite invalidates the plan. | Stop and rerun the planning command. |

Only `A` allows build without further discussion. `B` requires a named owner
waiver or an immediate plan patch.

---

## Output Format

```markdown
# Plan Review

**Source**: [request / Q&A / issue refs]
**Plan artifacts**: [epic, sprint, task refs]
**Rank**: A/B/C/D
**Decision**: Approved / Conditional approval needed / Return to planning / Replan

## Coverage Matrix

| Intake item | Planned artifact | Status | Evidence |
| --- | --- | --- | --- |
| [requirement] | [issue/task ref] | Pass/Partial/Fail | [evidence] |

## Gaps

- [Gap, impact, recommended fix]

## Approval Question

[Only if rank B or C: exact decision needed]
```

---

**BEGIN NOW:** Gather the intake record and planning artifacts, compare them
item by item, assign a rank, and return the decision before any build work
starts.
