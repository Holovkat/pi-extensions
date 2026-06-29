---
type: Component
title: req-qa Extension
description: Interactive human-in-the-loop requirements discovery extension with specialist consultations, session persistence, and GitHub issue publishing.
resource: ./extensions/req-qa.ts
tags: [pi-extensions, component, req-qa, requirements, interview, specialist, prd]
timestamp: 2026-06-29T15:00:00Z
status: active
---

# req-qa Extension

**File:** `extensions/req-qa.ts` (~1640 lines)
**Alias:** `pi-req`
**Theme:** rose-pine

An interactive, human-in-the-loop requirements discovery system. The pi session acts as an interviewer, calling specialist agents on demand, with everything gated by user approval.

## State Machine

`idle -> interview -> consulting -> interview -> review -> interview|finalizing -> done`

- **Auto-detect on startup:** Has consultation history -> resume; Has existing PRD -> enhance; Neither -> fresh start.

## Tools

| Tool | Purpose | Subprocess? |
|------|---------|-------------|
| `consult_specialist` | Call a specialist agent for focused analysis | Yes — spawns agent subprocess |
| `generate_artifacts` | Produce PRD + checklist after user sign-off | Yes — spawns prd-writer |

## Consultation Modes

- **Fast mode** (`deep: false`, default): Specialist gets NO file tools — pure prompt-based analysis. ~15s per call.
- **Deep mode** (`deep: true`): Specialist gets file-reading tools + session persistence. Can examine the actual codebase. ~30-60s per call.

## Session Persistence

State is saved to `req-qa-state.json` after every consultation and phase change. The `before_agent_start` hook dynamically injects consultation history and PRD content into the orchestrator's system prompt.

## GitHub Integration

After `generate_artifacts`: parses checklist for epics/tasks, creates GitHub issues for each (linked via `Part of #N`), updates checklist with issue numbers. `/req-rebuild-issues` re-publishes if GitHub wasn't available.

## Commands

| Command | Description |
|---------|-------------|
| `/req-status` | Show current phase and consultation count |
| `/req-history` | Show all specialist consultations |
| `/req-logs` | Open all specialist logs in tmux panes |
| `/req-watch <name>` | Tail a specific specialist's log |
| `/req-close-panes` | Close all tmux log panes |
| `/req-prd` | View PRD in glow (rendered markdown) |
| `/req-rebuild-issues` | Re-publish all GitHub issues from checklist |
| `/req-reset` | Clear session state and start fresh |

## Related Concepts

- [System Architecture](../architecture/system-architecture.md)
- [Specialist Agents](../domain/specialist-agents.md)
- [GitHub Integration](../architecture/github-integration.md)
- [Requirements Discovery Workflow](../process/requirements-discovery-workflow.md)
