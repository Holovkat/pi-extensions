---
type: Decision
title: Read-Only Agents by Design
description: Decision that only dev and prd-writer have write access; all other agents are read-only to prevent evaluation agents from silently modifying code.
resource: ./README.md
tags: [pi-extensions, decision, agents, read-only, write-access, safety, compliance]
timestamp: 2026-06-29T15:00:00Z
status: active
---

# Decision: Read-Only Agents by Design

## Context

The pipeline spawns multiple agents for building, evaluating, reviewing, testing, and scoring. If evaluation or compliance agents could modify code, they might silently change implementations during scoring, corrupting the audit trail.

## Decision

Only `dev` and `prd-writer` have write access. All other agents are read-only by design — they analyze and report, they do not modify.

## Tool Access

| Agent | write | edit |
|-------|-------|------|
| dev | YES | YES |
| prd-writer | YES | |
| compliance | | |
| analyst | | |
| reviewer | | |
| lint-build | | |
| tester | | |
| uat-signoff | | |
| sharder | | |
| req-analyst | | |
| tech-analyst | | |
| ux-analyst | | |
| scenario-analyst | | |

## Rationale

- **Audit integrity** — compliance scoring must reflect what was actually built, not what the compliance agent changed
- **Clear separation of concerns** — building and fixing are the dev agent's job; evaluation is everyone else's
- **Prevents silent corruption** — a reviewer that can write could "fix" issues it finds, hiding them from the score
- **prd-writer exception** — the PRD writer needs to write the PRD and checklist files, but not edit source code (no edit tool)

## Alternatives Rejected

- **All agents can write** — would corrupt the build/evaluate/fix separation
- **Configurable per-agent** — adds complexity; the read-only default is correct for all evaluation roles

## Related Concepts

- [Agent Capability Matrix](../domain/agent-capability-matrix.md)
- [Specialist Agents](../domain/specialist-agents.md)
- [Pipeline Agents](../domain/pipeline-agents.md)
- [Fast Track Architecture](../architecture/fast-track-architecture.md)
