---
type: Process
title: Requirements Discovery Workflow
description: The req-qa interview loop — sequential specialist consultations, user review and refinement, sign-off, artifact generation, and GitHub issue publishing.
resource: ./extensions/req-qa.ts
tags: [pi-extensions, process, requirements, interview, consultation, sign-off, prd, checklist]
timestamp: 2026-06-29T15:00:00Z
status: active
---

# Requirements Discovery Workflow

The req-qa workflow is an interactive, human-in-the-loop requirements discovery process.

## Interview Loop

1. User describes what they want to build
2. Orchestrator asks interview questions (one at a time)
3. User provides answers and context
4. Orchestrator calls `consult_specialist` for each specialist sequentially:
   - `req-analyst` — functional/non-functional requirements
   - `tech-analyst` — technical feasibility and stack
   - `scenario-analyst` — stress tests and failure modes
5. After each consultation, findings are presented to the user for feedback
6. User refines or asks for changes — loop back to interview
7. User signs off when satisfied

## Artifact Generation

After sign-off, `generate_artifacts` is called:
1. The `prd-writer` agent is spawned as a subprocess
2. It synthesizes all analysis into `PRD.md` and an implementation checklist
3. Files are written to disk
4. The extension parses the checklist for epics and tasks
5. GitHub issues are created for each epic (tracking) and task (linked via `Part of #N`)
6. Checklist is updated with issue numbers

## Session Persistence

State is saved to `req-qa-state.json` after every consultation and phase change. On startup:
- Has consultation history -> resume (inject history into system prompt)
- Has existing PRD -> enhance (inject PRD content for refinement)
- Neither -> fresh start

The `before_agent_start` hook dynamically injects context into the orchestrator's system prompt, giving it full context without re-running specialists.

## Consultation Modes

- **Fast mode** (default): ~15s per call, no file tools
- **Deep mode**: ~30-60s per call, with file-reading tools and session persistence

## Related Concepts

- [Req-QA Extension](../components/req-qa-extension.md)
- [Specialist Agents](../domain/specialist-agents.md)
- [GitHub Integration](../architecture/github-integration.md)
- [Sprint Development Workflow](./sprint-development-workflow.md)
- [System Architecture](../architecture/system-architecture.md)
