---
type: Architecture
title: GitHub Integration Layer
description: Issue publishing from checklists, learnings as structured comments, issue body enrichment, and issue rebuild/recovery.
resource: ./extensions/req-qa.ts
tags: [pi-extensions, architecture, github, issues, learnings, enrichment, gh-cli]
timestamp: 2026-06-29T15:00:00Z
status: active
---

# GitHub Integration Layer

GitHub Issues serve as the durable state layer across both pipeline phases — acceptance criteria, learnings, UAT results, and approval all live on issues.

## Issue Publishing (req-qa)

After `generate_artifacts` runs, the extension:
1. Parses the implementation checklist for epics and tasks
2. Creates GitHub issues for each epic (as tracking issues)
3. Creates GitHub issues for each task (linked to epic via `Part of #N` reference)
4. Updates the checklist file with issue numbers (`- [ ] **1.1 — Title** [#42]`)
5. Handles auth validation, repo creation (interactive), and error recovery

`/req-rebuild-issues` can re-publish all issues if GitHub wasn't available during generation.

## Issue Enrichment (dev-pipeline)

`enrichTaskBodiesFromGitHub()` fetches full issue bodies via `gh issue view` so agents get complete acceptance criteria, not just checklist summaries. This runs at pipeline start.

## Learnings as GitHub Comments

When a fix agent yields or an analyst makes a decision, a structured comment is posted to the task's GitHub issue:

```markdown
## Agent Learning (depth 2, fix, claude-sonnet-4-6)
**Yielded:** yes (timeout after 612s)
**Blockers:** collision detection not triggering at maze boundaries
**Attempted:** adjusted hitbox calculations; rewrote boundary detection
**Suggestion:** try a tile-based grid collision approach
**Analyst:** decompose — split into boundary detection + ghost collision
```

These comments accumulate, forming a visible audit trail. On pipeline restart, learnings are automatically read back from the issue comments — nothing is lost.

## UAT Issue Structure

```
UAT Epic #101: "UAT Test Suite"                     [uat]
  +-- #102: "UAT: Canvas renders correctly"          [uat-pass, epic-1]
  +-- #103: "UAT: Game loop 60 FPS"                  [uat-fail, epic-4]
```

Labels: `uat`, `uat-pending`, `uat-pass`, `uat-fail`, `epic-N`. UAT epic closed only when user runs `/pipeline-approve`.

## Blueprint Issue Rebuild

`/blueprint-rebuild-issues` recovers or rebuilds GitHub issues from artifacts, providing a recovery path when issues are lost or out of sync.

## Related Concepts

- [System Architecture](./system-architecture.md)
- [Req-QA Extension](../components/req-qa-extension.md)
- [Watchdog Timer System](../domain/watchdog-timer-system.md)
- [Requirements Discovery Workflow](../process/requirements-discovery-workflow.md)
