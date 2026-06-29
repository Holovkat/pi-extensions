---
type: Component
title: OKF Pi Extension
description: Open Knowledge Format extension providing /okf-status, /okf-query, /okf-capture, /okf-curate, and /okf-init commands for project knowledge management.
resource: ./extensions/okf.ts
tags: [pi-extensions, component, okf, knowledge, curation, inbox]
timestamp: 2026-06-29T15:00:00Z
status: active
---

# OKF Pi Extension

**File:** `extensions/okf.ts`

Provides commands for interacting with a project's `knowledge/` OKF bundle. The bundle structure is defined in the OKF-STANDARD.md (v0.1).

## Commands

| Command | Description |
|---------|-------------|
| `/okf-status` | Show inbox count, concept counts, last curation |
| `/okf-query <search>` | Search concepts by title, tags, or description |
| `/okf-capture` | Write a session synthesis to `knowledge/inbox/` |
| `/okf-curate` | Trigger curation of inbox items into permanent concepts |
| `/okf-init` | Initialize a new knowledge bundle in the current project |

## Concept Types

The extension recognizes seven concept types: Architecture, Component, Domain, Decision, Process, Deprecation, State, plus Inbox.

## How It Works

- Resolves the `knowledge/` directory relative to the project cwd
- Parses YAML frontmatter from concept files
- Counts concepts per directory for status display
- Searches across titles, tags, and descriptions for query
- Writes structured inbox items for capture
- The curation is performed by the OKF Curator droid

## Related Concepts

- [OKF Curator Droid](../domain/okf-curator-droid.md)
- [Current Repo State](../state/current-repo-state.md)
