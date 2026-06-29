---
type: Component
title: pi-blueprint Extension
description: GitHub-backed interactive planning cockpit with transcript-backed consultations, PRD/checklist generation, alignment scoring, and asset sync.
resource: ./extensions/pi-blueprint.ts
tags: [pi-extensions, component, pi-blueprint, planning, github, alignment, assets]
timestamp: 2026-06-29T15:00:00Z
status: active
---

# pi-blueprint Extension

**File:** `extensions/pi-blueprint.ts`
**Usage:** `pi -ne -e extensions/pi-blueprint.ts -e extensions/theme-cycler.ts`

GitHub-backed planning workflow that adds transcript-backed specialist consultations, PRD/checklist generation, alignment scoring, issue rebuild/recovery, and repo-managed asset sync.

## Repo-Managed Assets

- `agents/pi-blueprint/` — planning agents committed with the repo
- `skills/pi-blueprint/` — planning skills committed with the repo
- `bin/blueprint-dashboard-web` — live Blueprint web mirror

Use `/blueprint-sync-assets` to mirror repo-managed assets into a project-local `.pi` runtime.

## Commands

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

## Key Capabilities

- Transcript search over consultation history
- Alignment checks validating transcript-backed decisions
- Issue rebuilds for recovery when GitHub issues are lost
- Asset sync from repo to local runtime
- Dedicated web mirror for browser-based planning

## Related Concepts

- [System Architecture](../architecture/system-architecture.md)
- [Pi-Toolshed Extension](./pi-toolshed-extension.md)
- [Requirements Discovery Workflow](../process/requirements-discovery-workflow.md)
- [GitHub Integration](../architecture/github-integration.md)
