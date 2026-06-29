---
type: Domain
title: Pipeline Agents (dev-pipeline)
description: Sprint development agents — dev, compliance, reviewer, lint-build, tester, uat-signoff, and sharder — each handling a stage of the build/eval/fix/UAT cycle.
resource: ./agents/dev-pipeline/
tags: [pi-extensions, domain, agents, pipeline, dev, compliance, reviewer, tester, uat]
timestamp: 2026-06-29T15:00:00Z
status: active
---

# Pipeline Agents (dev-pipeline)

Pipeline agents defined in `agents/dev-pipeline/` and used by the dev-pipeline extension through the build, evaluate, fix, and UAT stages.

## Agent Roster

| Agent | Description | Tools | Role |
|-------|-------------|-------|------|
| `dev` | Autonomous development agent — implements tasks completely | read, write, edit, bash, grep, find, ls | Builds/fixes code (only agent that writes) |
| `compliance` | Scores implementation against requirements | read, bash, grep, find, ls | Per-task scoring with JSON output |
| `reviewer` | Reviews prototype vs spec, places TODOs | read, bash, grep, find, ls | 3-Wave Wave 1 review |
| `lint-build` | Runs lint and build checks | read, bash, grep, find, ls | Quality verification |
| `tester` | Runs tests and reports results | read, bash, grep, find, ls | Test execution |
| `uat-signoff` | UAT sign-off agent | read, bash, grep, find, ls | Final UAT gate |
| `sharder` | Task decomposition for large tasks | read, grep, find, ls | Splits complex tasks |

## Dev Agent

The core builder. Receives a specific task with acceptance criteria and must complete it fully. For Fast Track, it builds entire epics in one prompt. For 3-Wave, it implements individual tasks sequentially. Explicitly instructed to extend existing code, not delete or rewrite working code from previous epics.

## Compliance Agent

Compares implementation against original requirements and outputs a percentage score with detailed gap analysis. Returns structured JSON with `score`, `summary`, `passed`, and `failed` arrays. Strict but fair — partially met requirements count as half. Does NOT modify any files.

## Related Concepts

- [Agent Capability Matrix](./agent-capability-matrix.md)
- [Dev-Pipeline Extension](../components/dev-pipeline-extension.md)
- [Fast Track Architecture](../architecture/fast-track-architecture.md)
- [Three-Wave Architecture](../architecture/three-wave-architecture.md)
- [Model Configuration](../architecture/model-configuration.md)
