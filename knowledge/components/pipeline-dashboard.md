---
type: Component
title: Pipeline Terminal Dashboard
description: Standalone bash script that reads pipeline-state.json every 2 seconds and renders a live terminal dashboard with spinners, color-coded status, and UAT approval alerts.
resource: ./bin/pipeline-dashboard
tags: [pi-extensions, component, dashboard, terminal, bash, live, pipeline-state]
timestamp: 2026-06-29T15:00:00Z
status: active
---

# Pipeline Terminal Dashboard

**File:** `bin/pipeline-dashboard`
**Alias:** `pi-dash`

A standalone bash script that reads `pipeline-state.json` every 2 seconds and renders a live terminal dashboard.

## Features

- Animated spinners for active work
- Color-coded task status: green=passed, blue=building, cyan=scoring, red=failed, dim=pending
- Compliance scores with color thresholds (green >= 95%, yellow >= 80%, red < 80%)
- Phase elapsed time
- Recent activity log (last 12 entries, color-coded)
- Live tail of the active agent's log output
- UAT approval status (yellow flashing when awaiting)

## Usage

```bash
pi-dash /path/to/project      # standalone
/pipeline-dashboard           # from inside pi (opens in tmux pane)
```

## Dashboard Output Example

```
OK Epic 1: Foundation & Core Architecture
OK Epic 2: Procedural Maze Generation
OK Epic 3: Player Mechanics
DOT Epic 4: Ghost AI [fast-eval]
  OK 4.1: Ghost entity class  98%
  DOT 4.2: A* pathfinding  evaluating
  CIRCLE 4.3: Targeting behaviors

WARNING AWAITING UAT APPROVAL — /pipeline-approve or /pipeline-reject
  UAT: 12 pass, 2 fail, 1 pending

Mode: Fast Track
```

## Related Concepts

- [Pipeline State System](../architecture/pipeline-state-system.md)
- [Pipeline Dashboard Web](./pipeline-dashboard-web.md)
- [Dev-Pipeline Extension](./dev-pipeline-extension.md)
