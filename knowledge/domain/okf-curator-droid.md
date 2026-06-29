---
type: Domain
title: OKF Curator Droid
description: Curation agent that processes OKF inbox syntheses into permanent concept files, reads GitHub issues for context, and maintains knowledge indexes.
resource: ./.factory/droids/okf-curator.md
tags: [pi-extensions, domain, okf, curator, droid, curation, inbox, knowledge]
timestamp: 2026-06-29T15:00:00Z
status: active
---

# OKF Curator Droid

**File:** `.factory/droids/okf-curator.md`

A Factory Droid that curates OKF inbox items into permanent knowledge concept files. It transforms session syntheses into well-structured, typed, searchable concepts.

## Process

1. Read all unprocessed inbox items in `knowledge/inbox/` (not in `inbox/processed/`)
2. Read existing concept files in each concept directory
3. Read relevant source code and git history for context
4. Fetch and read GitHub issues referenced by `issue_refs` or `epic_refs` in inbox frontmatter
5. For each inbox item, determine concept type and create/update files
6. When a concept is superseded, move the old file to `deprecation/` and add a `supersedes` field
7. Move processed inbox items to `knowledge/inbox/processed/`
8. Update all `index.md` files
9. Update `knowledge/log.md` with curation summary

## Concept Type Routing

| Inbox Content | Target Directory |
|---------------|------------------|
| Architectural changes | `architecture/` |
| UI component work | `components/` |
| Business logic changes | `domain/` |
| Decisions with rationale | `decisions/` |
| Workflow/process changes | `process/` |
| Superseded patterns | `deprecation/` |
| Current status updates | `state/` |

## Tools

Read, LS, Grep, Glob, Execute, Edit, Create, TodoWrite

## Rules

- Never delete a concept file — move superseded ones to `deprecation/`
- One concept per file; do not mix types
- Filenames are slugified versions of the title
- Always include `issue_refs` when concepts relate to GitHub issues
- Always update `index.md` files and `log.md`
- Cross-link related concepts using markdown relative paths

## Related Concepts

- [OKF Pi Extension](../components/okf-extension.md)
- [Current Repo State](../state/current-repo-state.md)
