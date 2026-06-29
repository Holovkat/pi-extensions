---
type: Architecture
title: Two-Phase Pipeline System Architecture
description: Overall system design built on two extension pipelines — req-qa for requirements discovery and dev-pipeline for sprint development.
resource: ./README.md
tags: [pi-extensions, architecture, pipeline, req-qa, dev-pipeline, sdlc]
timestamp: 2026-06-29T15:00:00Z
status: active
---

# Two-Phase Pipeline System Architecture

The pi-extensions system is built on two main extension pipelines that form a complete software development lifecycle.

## Phase 1 — Requirements Discovery (`req-qa`)

The pi session acts as an interviewer, calling specialist agents on demand, with everything gated by user approval:

1. Human interview loop — one question at a time
2. Specialist consultations — sequential, spawned as pi subprocesses
3. User review and refinement — iterate until satisfied
4. Sign-off — generate PRD + implementation checklist
5. Publish to GitHub Issues — epics and tasks linked

## Phase 2 — Sprint Development (`dev-pipeline`)

Reads the checklist produced by req-qa and drives tasks through development, compliance, and quality gates. Two execution modes:

- **Fast Track (default)** — Build entire epic, evaluate per-task, surgical fixes with watchdog timers, automated UAT via Playwright.
- **3-Wave (`--multiwave`)** — Council architecture, 3-step prototype build, sequential dev sprint with compliance scoring.

Both modes auto-chain through all epics, halt on failure, and require explicit UAT approval before squash merge.

## Key Design Principles

- The checklist is the contract between the two phases — req-qa produces it, dev-pipeline consumes it.
- GitHub Issues are the durable state layer — acceptance criteria, learnings, UAT results, and approval all live on issues.
- Agents are spawned as pi CLI subprocesses in RPC mode, enabling mid-execution steering.
- Only `dev` and `prd-writer` agents have write access; all others are read-only.

## Related Concepts

- [Agent Subprocess Execution](./agent-subprocess-execution.md)
- [Fast Track Architecture](./fast-track-architecture.md)
- [Three-Wave Architecture](./three-wave-architecture.md)
- [GitHub Integration](./github-integration.md)
- [Requirements Discovery Workflow](../process/requirements-discovery-workflow.md)
- [Sprint Development Workflow](../process/sprint-development-workflow.md)
