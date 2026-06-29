---
type: Component
title: pi-toolshed Extension
description: Interactive card/workspace shell for frontier packets, quick actions, workspace presets, and blueprint-aware planning handoffs.
resource: ./extensions/pi-toolshed.ts
tags: [pi-extensions, component, pi-toolshed, workspace, cards, frontier, packets, mcp]
timestamp: 2026-06-29T15:00:00Z
status: active
---

# pi-toolshed Extension

**File:** `extensions/pi-toolshed.ts`

Interactive card/workspace shell for frontier packets, quick actions, workspace presets, and blueprint-aware planning handoffs. Built around the FMS-GLM conversation-lane model: one centered lane, floating header, bottom composer, single active frontier, freeze/inject progression.

## Repo Surfaces

- `bin/toolshed-dashboard-web` — browser UI for the toolshed workspace
- `PRD-PI-TOOLSHED.md` — product direction
- `TOOLSHED-IMPLEMENTATION-INSTRUCTIONS.md` — implementation notes

## Lane Discipline

- One centered conversation lane is the source of truth
- Only one active frontier at a time
- Freeze resolved work into packets or summaries before branching
- Widgets support the lane; they do not replace it

## Workspace Presets

10 workspace presets with 30 unique widgets total: Toolshed Core, RFC Studio, MCP Lab, Pair Programmer, Mission Control, Research Desk, Incident Ops, Design Review, Release Center, Automation Workbench.

## Widget Placements

`inline`, `left-dock`, `right-dock`, `float`. Widgets can pin, collapse, detach, and remember size/placement.

## Commands

| Command | Description |
|---------|-------------|
| `/toolshed-web` | Open the toolshed web workspace |
| `/toolshed-status` | Show current toolshed state |
| `/toolshed-workspace` | Switch active workspace preset |
| `/toolshed-freeze` | Freeze the active frontier into a packet |
| `/toolshed-packets` | Inspect the packet queue |
| `/toolshed-reset-layout` | Reset card collapse state |

## MCP App Hosting

Toolshed owns the MCP hosting path for custom apps (calculator, GitHub kanban board). Apps are exposed through PI-managed MCP routes and externally via ngrok.

## Related Concepts

- [Pi-Blueprint Extension](./pi-blueprint-extension.md)
- [Toolshed Implementation](../process/toolshed-implementation.md)
- [Current Repo State](../state/current-repo-state.md)
