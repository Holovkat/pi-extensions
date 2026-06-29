---
type: Decision
title: Fast Track vs Three-Wave
description: Decision to offer two pipeline modes — lean Fast Track for iteration speed and thorough 3-Wave for maximum quality on complex projects.
resource: ./README.md
tags: [pi-extensions, decision, fast-track, three-wave, multiwave, trade-offs]
timestamp: 2026-06-29T15:00:00Z
status: active
---

# Decision: Fast Track vs Three-Wave

## Context

The dev-pipeline extension needs to serve both fast iteration cycles and complex architectural builds. A single mode would either be too slow for simple projects or too shallow for complex ones.

## Decision

Offer two execution modes:

- **Fast Track (default)** — activated with `/pipeline-start` (no flags)
- **3-Wave** — activated with `/pipeline-start --multiwave`

## Trade-offs

| | 3-Wave | Fast Track |
|---|---|---|
| **LLM calls per epic** | 15-30+ | 3-8 |
| **Time per epic** | 15-25 min | 5-10 min |
| **Quality approach** | Multi-model consensus | Single builder + strong evaluator |
| **Fix strategy** | Re-attempt with gap feedback | Surgical subtask decomposition |
| **UAT** | Manual sign-off | Automated Playwright + approval gate |
| **Best for** | Complex architectures, first builds | Iteration, known patterns, speed |

## Rationale

- Fast Track optimizes for speed and iteration: one model builds, one evaluates, surgical fixes with watchdog timers. Best for known patterns and rapid delivery.
- 3-Wave optimizes for quality: council of 3 models designs architecture, 3-step prototype build, sequential dev with compliance scoring. Best for complex projects and first builds.
- Users can switch modes between epics — use Fast Track for early epics, switch to 3-Wave for complex ones.

## Alternatives Rejected

- **Single mode only** — would force a quality/speed trade-off on every project
- **Automatic mode selection** — rejected because the user knows their project complexity better than heuristics

## Related Concepts

- [Fast Track Architecture](../architecture/fast-track-architecture.md)
- [Three-Wave Architecture](../architecture/three-wave-architecture.md)
- [Model Configuration](../architecture/model-configuration.md)
- [Sprint Development Workflow](../process/sprint-development-workflow.md)
