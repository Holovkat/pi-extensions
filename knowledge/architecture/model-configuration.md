---
type: Architecture
title: Model Configuration System
description: Per-role model assignments, fix escalation chain, thinking level cycling, model selector with ping test, and runtime config persistence.
resource: ./extensions/dev-pipeline.ts
tags: [pi-extensions, architecture, models, configuration, escalation, ping-test, thinking]
timestamp: 2026-06-29T15:00:00Z
status: active
---

# Model Configuration System

The `/pipeline-config` command opens a full-screen configuration view with two mode tabs (Fast Track and 3-Wave) listing every pipeline role, its assigned model, and reasoning level.

## Configuration UI

Each role shows its model and thinking level (e.g. `gemini-3-pro | high`). Controls:
- **Enter** — open model selector to change the model
- **Space** — cycle thinking level: `off -> minimal -> low -> medium -> high -> xhigh`
- **Del/Backspace** — remove an escalation step
- **Tab** — switch between Fast Track and 3-Wave tabs

## Model Selector

On Enter, a model selector opens with two tabs:
- **Available** — only models with configured API keys (ready to use)
- **All** — every registered model (including unconfigured ones)

Selecting a model triggers a quick ping test to confirm it responds. On success, the assignment is saved to `~/.pi/agent/pipeline-config.json` and takes effect immediately — no restart needed.

## Fix Escalation

When a task fails at depth 1, the pipeline escalates to the next configured model/thinking pair:
- Depth 1 uses the base Fixer
- Depth 2 uses Escalation 1
- Depth 3 uses Escalation 2
- Add as many escalation steps as needed (Enter on "+ Add escalation step")
- If depths exceed configured escalation steps, the last step is reused

## Fast Track Default Assignments

| Role | Model |
|------|-------|
| Builder | Gemini 3 Pro Preview |
| Evaluator | GPT-5.6 Sol (minimal) |
| Fixer | Qwen 3.5 Plus |
| Fix Escalation 1 | Claude Sonnet 4.6 |
| Fix Escalation 2 | Claude Opus 4.6 (xhigh) |
| Analyst | Claude Opus 4.6 (xhigh) |
| UAT Tester | GPT-5.6 Sol (minimal) |

## 3-Wave Default Assignments

| Role | Model |
|------|-------|
| Council Architects | Opus, Qwen 3.5+, Gemini 3 Pro |
| Prototype Step 1 | Gemini 3 Pro Preview |
| Prototype Step 2 | Claude Haiku 4.5 |
| Prototype Step 3 | Qwen 3.5 Plus |
| Dev Agent | Claude Haiku 4.5 |
| Compliance | GPT-5.6 Sol (low) |
| Orchestrator Override | Claude Opus 4.6 |

The Analyst role uses the strongest model by default because it needs to deeply understand failure patterns and make architectural decisions about task decomposition.

## Related Concepts

- [Fast Track Architecture](./fast-track-architecture.md)
- [Three-Wave Architecture](./three-wave-architecture.md)
- [Watchdog Timer System](../domain/watchdog-timer-system.md)
- [Pipeline Agents](../domain/pipeline-agents.md)
