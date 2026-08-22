---
name: okf
description: >
  Open Knowledge Format (OKF) agent onboarding, inbox writing, curation, and deployment guidance.
  Use when working on a project that has a knowledge/ OKF bundle, when initializing one, when
  curating inbox items into concepts, or when deploying OKF to a new project. Triggers on OKF,
  knowledge bundle, knowledge base, session synthesis, inbox curation, curate knowledge, or
  deploy OKF.
---

# OKF — Open Knowledge Format

Use this skill when working on a project that has a `knowledge/` OKF bundle, when initializing one, or when deploying OKF to a new project.

## What OKF Is

OKF is a convention for maintaining project knowledge as markdown files with YAML frontmatter, stored in git alongside code. Git is canonical. Agents read the bundle before starting work; at the end of a meaningful work session the agent writes one session synthesis to `knowledge/inbox/` before committing and `git add`s it with the change (AGENTS.md is the authority on this flow). The repository's post-commit hook only pushes — it does not write inbox items.

## Locating the OKF Source Repo

OKF is distributed from the `designs` repo. Resolve `<designs>` in this order:

1. `$DESIGNS_REPO` if set
2. `~/workspace/designs` if it exists
3. Ask the user for the designs repo location

All `<designs>/...` paths below use that root.

## OKF System Knowledge

The OKF system's own knowledge base lives at `<designs>/knowledge/`. It contains concepts documenting the OKF standard, viewer architecture, hook system, installer design, deployment process, seeding strategy, AGENTS.md migration pattern, curation workflow, and schema diagram creation. Any agent deploying or maintaining OKF should read these concepts first.

Key concepts for deployment:
- `<designs>/knowledge/process/deploy-okf.md` — 8-phase deployment workflow overview
- `<designs>/knowledge/process/seed-from-existing-docs.md` — How to seed from existing project docs
- `<designs>/knowledge/process/process-github-epics.md` — Processing closed GitHub epics
- `<designs>/knowledge/process/create-schema-diagrams.md` — Mermaid ER diagram creation
- `<designs>/knowledge/process/migrate-agents-md.md` — AGENTS.md migration pattern
- `<designs>/knowledge/process/curation-pass.md` — Full curation workflow
- `<designs>/knowledge/process/verify-deployment.md` — Deployment verification checklist

The full step-by-step deployment runbook is at `<designs>/templates/okf/DEPLOYMENT-RUNBOOK.md`.

## Deploying OKF to a New Project

When asked to deploy OKF to a project, follow `<designs>/templates/okf/DEPLOYMENT-RUNBOOK.md` in order:

1. **Mechanical Install** — Run `install-okf.sh` to create the knowledge
   structure and copy the viewer, hook, pinned offline runtime, schema,
   validator, commands, curator contract, and repository-local controls. The
   installer starts no runtime or schedule and preserves existing controls.
2. **Seed From Existing Docs** — Read AGENTS.md, docs/, docs/design/, docs/agents/ and create 40-80 concepts summarising each significant topic. Use the `resource` field to link back to source docs.
3. **Process GitHub Epics** — List closed epics with `gh issue list --label epic --state closed`. Recent epics get full concepts; older epics get deprecation entries.
4. **Create Schema Diagrams** — If the project has a database, group tables by domain and create mermaid erDiagram concepts per domain plus an architecture index.
5. **Review AGENTS.md Alignment** — Report precise proposals. Only the explicit
   installation action may append the standard section; later changes require
   separate operator approval.
6. **Bounded Curation Pass** — Build and review a deterministic proposal, then
   use the installed locked/quota-bounded curator with validation and recovery.
7. **Adopt the Core Profile** — Audit retained history in warning mode and opt
   new records into `okf-core/1.0` before any reviewed bundle migration.
8. **Generate Viewer** — Run `generate-viz.js` to produce self-contained
   `viz.html` with typed edges and visible relationship diagnostics.
9. **Final Verification** — Run the combined schema/parser/linter/hook/viewer/
   query/curator/triage/archive/cadence/installer suite and isolated canaries.

Read the runbook for detailed instructions for each phase.

## Directory Structure

```
knowledge/
├── index.md          # Root index with concept group counts
├── log.md            # Chronological update history
├── inbox/            # Session syntheses awaiting curation
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

## OKF-First Protocol

The knowledge bundle is the first source of truth. Consult it before
investigating the codebase or proposing a course of action:

1. **Before investigating**, query the bundle for the topic. Use
   `knowledge/okf-query.sh <term>` when installed, or grep frontmatter and
   titles directly:

   ```bash
   grep -ril "<term>" knowledge/ --include="*.md" | grep -v index.md
   ```

2. **Before proposing a plan**, read matching concepts in `decisions/` and
   `deprecation/`. If a path was already taken and rejected, do not re-derive
   it: cite the concept, state whether its "When This Might Be Relevant Again"
   conditions apply, and only then decide.
3. **Cite what you reuse.** When a concept answers the question, reference it
   instead of re-investigating the codebase.
4. **Trust but verify freshness.** If a concept's `timestamp` is old and its
   `resource` file has newer commits, verify against code before relying on it,
   and note the staleness in your session synthesis.
5. **Record rejected paths.** When you evaluate and reject an approach during a
   session, write the rejection and its reason into your inbox synthesis so
   curation can turn it into a decision or deprecation lesson. This is how
   repeat investigations are prevented.

## Writing Inbox Items

The agent writes session syntheses directly; Git remains the source for
changed files. AGENTS.md is the authority on this flow: write the synthesis
BEFORE committing and `git add` it with your changes so it is part of the
commit. The repository's post-commit hook only pushes — it never writes
inbox items.

### Tier 1: Commit Capture (not installed in this repository)

The full OKF install from the designs repo can ship a post-commit hook that
writes one compact `capture_tier: commit` item per ordinary commit. That
capture hook is **not installed in this repository** — the only post-commit
hook here (`hooks/post-commit-push.sh`) just pushes the current branch. Do
not expect Tier 1 items in this inbox, and do not rely on commit messages
being captured automatically; put durable knowledge (decisions, rejected
paths, lessons) into the session synthesis instead.

### Tier 2: Session Synthesis

When you finish a meaningful work session, write exactly one
`capture_tier: session` item BEFORE committing, and `git add` it with your
changes so it lands in the same commit. It records what was done, decisions,
deprecations, lessons, and current state in product terms — not code diffs:

```yaml
---
type: Inbox
title: <what changed, in product terms>
description: <one line>
tags: [lowercase, consistent]
timestamp: <ISO-8601>
generated_at: <ISO-8601>
generated_by: <session-type>          # e.g. dev-session, planning-session
session_id: <session-uuid>
commit_sha: []                        # earlier session SHAs if any; empty when written pre-commit
branch: <branch-name>
issue_refs: [<n>]
epic_refs: [<n>]
capture_tier: session
---

# What Was Done

# Decisions Made

# What Was Deprecated

# Lessons Learned

# Current State
```

Filename format: `<ISO-timestamp-with-dashes>-<slugified-title>.md`.

## Curation

Curation transforms selected inbox items into permanent concept files and
audits the approved context. Run it only through an explicit, repository-scoped
operator action via the installed `okf-curator` contract and
`.okf/bin/okf-curate.mjs`. The approved cadence is manual status/triage plus a
separately requested batch. Do not add schedules, cron/launchd, queues, polling,
hook launches, Factory automation, child sessions, automatic retries, or a
cross-project rollout.

Steps:

1. Run `.okf/bin/okf-inbox-status.mjs` and
   `.okf/bin/okf-inbox-triage.mjs` against one explicit physical Git root. The
   report does not authorize curation.
2. Record the full revision, exact selected items and hashes, approved context,
   operator identity/request, run ID, positive item/input/generated-byte/runtime
   ceilings, `max_sessions: 1`, expected outcome, cancellation, and recovery.
3. Prepare a deterministic `okf-curation-proposal/1` whose selected items match
   the dry-run plan and whose outputs include concepts, affected indexes, root
   index, inbox index, and log with expected hashes and generated provenance.
4. Run `okf-curate.mjs --check-only`. Resolve every root, control, proposal,
   source, containment, preflight, and quota block before execution.
5. Run `okf-curate.mjs --execute` once. It acquires one repository-local lock,
   stages and strictly validates output, applies/checkpoints safe units,
   postflights the bundle, and only then moves selected sources to
   `inbox/processed/`.
6. If cancelled or interrupted, retain input and recovery evidence. Resume only
   through a new explicit `--resume` request with the identical plan, hashes,
   proposal, root/revision, allowlist, and limits. Never clear a stale lock,
   raise a quota, widen scope, clean up, or self-retry automatically.
7. Review the bounded terminal report; commit only the reviewed output with an
   `okf-curation:` subject. AGENTS.md findings remain proposals.

Use `.okf/bin/okf-inbox-archive.mjs` only for a separately reviewed reversible
archive/compaction manifest. Permanent deletion always requires a distinct,
path-specific approval.

## Concept Frontmatter

```yaml
---
type: Architecture
id: okf-63a160c2-9a5b-4df9-87b4-40ac8f59ac89
title: SpacetimeDB Tenant Model
description: One-line summary
resource: ./src/db/schema.ts
tags: [backend, spacetime-db]
timestamp: 2026-06-29T10:00:00Z
status: active                   # active | deprecated | in-progress | blocked
assertion_state: proposed        # verified | inferred | proposed | historical | stale
supersedes: [okf-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb]
generated_at: 2026-06-29T10:00:00Z
generated_by: okf-curator
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

- Git and repository-local Markdown/YAML remain canonical; semantic-web
  services are not required.
- `okf-core/1.0` is warning-first for retained history. Strict relationships
  use stable project-local IDs; `A supersedes B` means A is the replacement.
- Never delete a concept file. Retain superseded concepts in `deprecation/` and
  put the `supersedes` predicate on the replacement.
- Always update `index.md` files when adding or updating concepts.
- Always log curation actions in `log.md`.
- Use lowercase tags. Keep tags consistent across concepts.
- Filenames should be slugified versions of the title.
- One concept per file. Do not mix types.
- The `resource` field should point to the most relevant code file or issue.
- An unresolved relationship, stale/proposed assertion, or warning is not
  permission to rewrite, archive, delete, or curate.
- Curator, archive, cadence, and migration operations are exact-root, locked,
  quota-bounded, cancellable, observable, recoverable, and operator-controlled.
- Never patch `AGENTS.md` from curation; report proposals for approval.
