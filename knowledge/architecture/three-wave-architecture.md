---
type: Architecture
title: Three-Wave Pipeline Architecture
description: The thorough multi-wave pipeline mode — council architecture, 3-step prototype build, sequential dev sprint with compliance scoring.
resource: ./extensions/dev-pipeline.ts
tags: [pi-extensions, architecture, three-wave, multiwave, council, prototype, compliance]
timestamp: 2026-06-29T15:00:00Z
status: active
---

# Three-Wave Pipeline Architecture

Activated with `/pipeline-start --multiwave`. Best for complex projects requiring maximum quality. Uses multiple models in council for architecture, a 3-step prototype build, and detailed review passes.

## Wave Structure

### Wave 1 — Foundations Council
Three architects (Opus, Qwen 3.5+, Gemini 3 Pro) run in parallel, each producing an independent design brief. The extension consolidates them into a unified spec.

### Wave 0 — Prototype (first epic only)
A 3-step sequential prototype build:
1. **Gemini 3 Pro** — full one-shot build from spec
2. **Claude Haiku 4.5** — enhancement and polish pass
3. **Qwen 3.5 Plus** — fine-tuning and refinement pass

Wave 0 runs only for the first epic. Subsequent epics skip it to avoid destroying previous work.

### Wave 1 — Review + TODO Placement
A reviewer reviews the prototype vs the spec and places TODOs in the code.

### Wave 2 — Sequential Dev Sprint
For each task: dev agent implements (sees TODOs + spec), compliance agent scores. If score < 95%, the dev agent fixes gaps (up to 5 retries). All operations run sequentially — no parallel worktrees, preventing merge conflicts.

## Key Design Decisions

- **Wave 0 runs only for the first epic** — subsequent epics skip it to avoid destroying previous work
- **All Wave 2 operations run sequentially** — no parallel worktrees, preventing merge conflicts on single-file projects
- **Orchestrator override** — when a task scores 90-94%, Opus reviews the deductions and overrides if they're pedantic
- **GitHub issue enrichment** — fetches full issue bodies via `gh issue view` so agents get complete acceptance criteria
- **Auto-chaining** — epics chain automatically with 5s pause between them, halting on failure

## Model Assignments

| Role | Model |
|------|-------|
| Council Architects | Opus, Qwen 3.5+, Gemini 3 Pro |
| Prototype Step 1 | Gemini 3 Pro Preview |
| Prototype Step 2 | Claude Haiku 4.5 |
| Prototype Step 3 | Qwen 3.5 Plus |
| Dev Agent | Claude Haiku 4.5 |
| Compliance | Qwen 3.5 Plus |
| Orchestrator Override | Claude Opus 4.6 |

## Performance

A 7-task epic with fix attempts typically takes 15-25 minutes. 15-30+ LLM calls per epic.

## Related Concepts

- [Fast Track Architecture](./fast-track-architecture.md)
- [Fast Track vs Three-Wave](../decisions/fast-track-vs-three-wave.md)
- [Pipeline Agents](../domain/pipeline-agents.md)
- [Model Configuration](./model-configuration.md)
