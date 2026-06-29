# OKF — Open Knowledge Format

Use this skill when working on a project that has a `knowledge/` OKF bundle, when initializing one, or when deploying OKF to a new project.

## What OKF Is

OKF is a convention for maintaining project knowledge as markdown files with YAML frontmatter, stored in git alongside code. Git is canonical. Agents read the bundle before starting work and write session syntheses to an inbox after completing work.

## OKF System Knowledge

The OKF system's own knowledge base lives at `designs/knowledge/`. It contains concepts documenting the OKF standard, viewer architecture, hook system, installer design, deployment process, seeding strategy, AGENTS.md migration pattern, curation workflow, and schema diagram creation. Any agent deploying or maintaining OKF should read these concepts first.

Key concepts for deployment:
- `designs/knowledge/process/deploy-okf.md` — 8-phase deployment workflow overview
- `designs/knowledge/process/seed-from-existing-docs.md` — How to seed from existing project docs
- `designs/knowledge/process/process-github-epics.md` — Processing closed GitHub epics
- `designs/knowledge/process/create-schema-diagrams.md` — Mermaid ER diagram creation
- `designs/knowledge/process/migrate-agents-md.md` — AGENTS.md migration pattern
- `designs/knowledge/process/curation-pass.md` — Full curation workflow
- `designs/knowledge/process/verify-deployment.md` — Deployment verification checklist

The full step-by-step deployment runbook is at `designs/templates/okf/DEPLOYMENT-RUNBOOK.md`.

## Deploying OKF to a New Project

When asked to deploy OKF to a project, follow `designs/templates/okf/DEPLOYMENT-RUNBOOK.md` in order:

1. **Mechanical Install** — Run `install-okf.sh` to create the knowledge directory structure, viewer, hook, and scripts.
2. **Seed From Existing Docs** — Read AGENTS.md, docs/, docs/design/, docs/agents/ and create 40-80 concepts summarising each significant topic. Use the `resource` field to link back to source docs.
3. **Process GitHub Epics** — List closed epics with `gh issue list --label epic --state closed`. Recent epics get full concepts; older epics get deprecation entries.
4. **Create Schema Diagrams** — If the project has a database, group tables by domain and create mermaid erDiagram concepts per domain plus an architecture index.
5. **Migrate AGENTS.md** — Replace AFFiNE/docs.agents references with OKF knowledge references. Add the OKF Knowledge Bundle section. Add Legacy Documentation Alignment section.
6. **Curation Pass** — Add cross-links, check for duplicates, verify index counts, update log.md.
7. **Generate Viewer** — Run `generate-viz.js` to produce self-contained `viz.html`.
8. **Final Verification** — Verify counts, no AFFiNE references remain, hook is installed, viz.html works.

Read the runbook for detailed instructions for each phase.

## Directory Structure

```
knowledge/
├── index.md          # Root index with concept group counts
├── log.md            # Chronological update history
├── inbox/            # Staging area for commit-time captures
│   ├── index.md
│   └── <timestamp>-<slug>.md
├── architecture/     # How the system is structured
├── components/       # UI components and behavior
├── domain/           # Business logic and domain knowledge
├── decisions/        # Architectural decisions and rationale
├── process/          # How workflows operate
├── deprecation/      # Superseded concepts
└── state/            # Current state of play
```

## Agent Onboarding

When starting work on a project with an OKF bundle:

1. Read `knowledge/index.md` for an overview of all concept groups and counts.
2. Read `knowledge/state/index.md` and any state concept files for current status.
3. Read `knowledge/deprecation/index.md` to understand what has been superseded.
4. Read concept files relevant to the work area (use titles and tags to find them).
5. Do not read everything. Use the index files for progressive disclosure.

## Writing Inbox Items

After completing meaningful work, write a session synthesis to `knowledge/inbox/`:

```yaml
---
type: Inbox
title: Session 2026-06-29 - Route geometry QA fixes
description: Session synthesis for route geometry work
tags: [mobile, routing, qa]
timestamp: 2026-06-29T10:00:00Z
session_id: <session-uuid>
commit_sha: <sha>
branch: <branch-name>
issue_refs: [1503]
epic_refs: [1495]
---

# What Was Done
Summary of work completed.

# Decisions Made
Decisions and their rationale.

# What Was Deprecated
Patterns or approaches removed or superseded.

# Lessons Learned
Insights gained during the work.

# Current State
What works now, what's in progress, what's blocked.
```

Filename format: `<ISO-timestamp-with-dashes>-<slugified-title>.md`

This is about the product, business logic, and application state, not just code diffs. Capture the full session context so another agent reading this knows exactly the current state of play.

## Curation

Curation transforms inbox items into permanent concept files:

1. Read all unprocessed inbox items.
2. Read existing concept files in relevant directories.
3. Read the codebase and git history for additional context.
4. **Fetch and read GitHub issues referenced by `issue_refs` in inbox item frontmatter.**
   - Use: `gh issue view <number> --json body,title,labels --jq '.body'`
   - Issues contain rich context: pre-approved directives, acceptance criteria, linked epics, and full reasoning.
   - Use this context to enrich concepts beyond what the commit message alone provides.
5. For each inbox item, determine which concept(s) to create or update.
6. Create new concept files with proper frontmatter (include `issue_refs` when applicable).
7. Update existing concepts by merging new information.
8. Move superseded concepts to `deprecation/` with `supersedes` links.
9. Move processed inbox items to `inbox/processed/`.
10. Update all `index.md` files with current listings.
11. Update `log.md` with a summary of changes.

## Concept Frontmatter

```yaml
---
type: Architecture              # REQUIRED
title: SpacetimeDB Tenant Model  # Recommended
description: One-line summary     # Recommended
resource: ./src/db/schema.ts     # Recommended
tags: [backend, spacetime-db]    # Recommended
timestamp: 2026-06-29T10:00:00Z # Recommended
status: active                   # active | deprecated | in-progress | blocked
supersedes: [old-pattern.md]     # For deprecation entries
issue_refs: [1503]               # Ticket references
---
```

## Concept Types

| Type | Directory | Use For |
|------|-----------|---------|
| Architecture | architecture/ | System structure, data models, infrastructure |
| Component | components/ | UI components, interaction patterns |
| Domain | domain/ | Business logic, domain entities, rules |
| Decision | decisions/ | Architectural decisions and rationale |
| Process | process/ | Workflows, sprint flow, deployment gates |
| Deprecation | deprecation/ | Superseded patterns with links to replacements |
| State | state/ | Current state: what works, in progress, blocked |
| Inbox | inbox/ | Session syntheses awaiting curation |

## Rules

- Never delete a concept file. Move superseded ones to `deprecation/` instead.
- Always update `index.md` files when adding or updating concepts.
- Always log curation actions in `log.md`.
- Use lowercase tags. Keep tags consistent across concepts.
- Filenames should be slugified versions of the title.
- One concept per file. Do not mix types.
- The `resource` field should point to the most relevant code file or issue.
