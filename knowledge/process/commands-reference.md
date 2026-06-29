---
type: Process
title: Commands Reference
description: Complete slash command reference for all pi-extensions — req-qa, dev-pipeline, pi-blueprint, council, and pi-toolshed.
resource: ./README.md
tags: [pi-extensions, process, commands, slash-commands, reference]
timestamp: 2026-06-29T15:00:00Z
status: active
---

# Commands Reference

## req-qa Commands

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

## dev-pipeline Commands

| Command | Description |
|---------|-------------|
| `/pipeline-start` | Initialize pipeline in Fast Track mode (default) |
| `/pipeline-start --multiwave` | Initialize pipeline in 3-Wave mode |
| `/pipeline-next` | Run next phase (uses active mode) |
| `/pipeline-approve` | Approve UAT results (Fast Track) |
| `/pipeline-reject` | Reject UAT with notes, loop back (Fast Track) |
| `/pipeline-reset` | Full reset — checkout main, delete branches, uncheck, reopen |
| `/pipeline-end` | UAT sign-off, squash merge to main, push, clean up |
| `/pipeline-config` | Configure model assignments for each pipeline role |
| `/pipeline-status` | Show current pipeline progress |
| `/pipeline-dashboard` | Open live dashboard in tmux pane |
| `/pipeline-logs` | Open all agent logs in tmux panes |
| `/pipeline-watch <name>` | Tail a specific agent's log |
| `/pipeline-close-panes` | Close all tmux/dashboard panes |

## pi-blueprint Commands

| Command | Description |
|---------|-------------|
| `/blueprint-status` | Show current planning phase and readiness |
| `/blueprint-history` | Show consultation history |
| `/blueprint-prd` | Open the generated PRD |
| `/blueprint-checklist` | Open the generated checklist |
| `/blueprint-web` | Open the live Blueprint web mirror |
| `/blueprint-sync-assets` | Sync repo-managed agents and skills into local `.pi` |
| `/blueprint-check-alignment` | Verify transcript-backed alignment |
| `/blueprint-rebuild-issues` | Rebuild or recover GitHub issues |

## council Commands

| Command | Description |
|---------|-------------|
| `/council` | Refresh the council panel |
| `/council --server` | Show hub URL, PID, queue/status counts, recent events |
| `/council --reconnect` | Re-register and reopen the event stream |
| `/council --project <name>` | View another project/council pool |

## pi-toolshed Commands

| Command | Description |
|---------|-------------|
| `/toolshed-web` | Open the toolshed web workspace |
| `/toolshed-status` | Show current toolshed state |
| `/toolshed-workspace` | Switch active workspace preset |
| `/toolshed-freeze` | Freeze the active frontier into a packet |
| `/toolshed-packets` | Inspect the packet queue |
| `/toolshed-reset-layout` | Reset card collapse state |

## Related Concepts

- [Installation Guide](./installation-guide.md)
- [Req-QA Extension](../components/req-qa-extension.md)
- [Dev-Pipeline Extension](../components/dev-pipeline-extension.md)
- [Pi-Blueprint Extension](../components/pi-blueprint-extension.md)
- [Council Extension](../components/council-extension.md)
- [Pi-Toolshed Extension](../components/pi-toolshed-extension.md)
