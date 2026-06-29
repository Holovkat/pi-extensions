---
type: Domain
title: Specialist Agents (req-qa)
description: Requirements discovery specialist agents — req-analyst, tech-analyst, ux-analyst, scenario-analyst, and prd-writer — each focused on a domain of analysis.
resource: ./agents/req-qa/
tags: [pi-extensions, domain, agents, specialist, req-qa, requirements, prd]
timestamp: 2026-06-29T15:00:00Z
status: active
---

# Specialist Agents (req-qa)

Specialist agents called by the req-qa orchestrator during requirements discovery. Each is spawned as a pi subprocess with a domain-specific system prompt.

## Agent Roster

| Agent | Focus | Tools | Output Format |
|-------|-------|-------|---------------|
| `req-analyst` | Functional/non-functional requirements, gaps, assumptions | read, bash, grep, find, ls | JSON: requirements, open questions, risks |
| `tech-analyst` | Technical feasibility, stack analysis, deployment | read, bash, grep, find, ls | JSON: tech stack, constraints, data models |
| `ux-analyst` | User journeys, workflows, edge cases, navigation | read, grep, find, ls | JSON: personas, stories, workflows |
| `scenario-analyst` | Stress tests, failure modes, real-world validation | read, bash, grep, find, ls | JSON: scenarios, failure modes, stress points |
| `prd-writer` | Synthesize all analysis into PRD + checklist | read, write, grep, find, ls | Markdown files (PRD.md + checklist) |

## Consultation Modes

- **Fast mode** (`deep: false`, default): Specialist gets NO file tools — pure prompt-based analysis. ~15s per call.
- **Deep mode** (`deep: true`): Specialist gets file-reading tools + session persistence. Can examine the actual codebase. ~30-60s per call.

## Sequential Consultation Flow

The orchestrator calls specialists sequentially: req-analyst -> tech-analyst -> scenario-analyst, presenting findings after each. The `prd-writer` is called last during `generate_artifacts` to synthesize everything.

## Output Discipline

All specialist agents (except prd-writer) return structured JSON. They do NOT modify any files. Only `prd-writer` has write access, and only to produce the PRD and checklist.

## Related Concepts

- [Req-QA Extension](../components/req-qa-extension.md)
- [Agent Capability Matrix](./agent-capability-matrix.md)
- [Requirements Discovery Workflow](../process/requirements-discovery-workflow.md)
- [Read-Only Agents by Design](../decisions/read-only-agents-by-design.md)
