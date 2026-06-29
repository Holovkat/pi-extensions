# Pi Extensions

Custom extensions for the [pi coding agent CLI](https://github.com/nichochar/pi) that orchestrate multi-agent workflows for requirements discovery and sprint-based development. Home to the Open Knowledge Format (OKF) extension, skill, and curator droid.

## Key Areas

| Area | Path | Description |
|------|------|-------------|
| Extensions | `extensions/` | req-qa, dev-pipeline, pi-blueprint, pi-toolshed, council, coms, okf, providers |
| Agents | `agents/` | Agent definitions (req-qa specialists, dev-pipeline agents, blueprint agents) |
| Skills | `skills/` | OKF skill, pi-blueprint skills |
| Droids | `.factory/droids/` | OKF curator droid |
| Bin | `bin/` | Terminal and web dashboards |
| Docs | `docs/` | Walkthroughs, comms guide, research, retrospectives |
| Features | `features/` | Feature specs and planning |
| Knowledge | `knowledge/` | OKF knowledge bundle (37 concepts) |

## OKF Knowledge Bundle

This project uses the [Open Knowledge Format (OKF)](https://github.com/holovkat/designs/blob/main/templates/okf/OKF-STANDARD.md) v0.1 for project knowledge management.

### Agent Onboarding

Before starting any work on this project:

1. Read `knowledge/index.md` for an overview of all concept groups.
2. Read `knowledge/state/index.md` for the current state of play.
3. Read `knowledge/deprecation/index.md` to understand what has been superseded.
4. Read concept files relevant to your work area (use tags and titles to find them).
5. Do not read everything. Use index files for progressive disclosure.

### Legacy Documentation

This project has existing documentation in `docs/` (walkthroughs, comms guide, research, retrospectives) and `README.md` (full architecture and commands reference). OKF concepts in `knowledge/` reference these via the `resource` field in frontmatter. The existing docs remain as detailed references; OKF concepts provide a typed, searchable, curated index over them.

When a concept's `resource` field points to a doc, follow that link to the source doc for full details. The concept file provides a summary and classification; the source doc provides the complete content.

Do not move or duplicate existing docs into `knowledge/`. New knowledge that doesn't have an existing source doc is written directly as an OKF concept.

### After Completing Work

When you finish a meaningful work session:

1. Write a session synthesis to `knowledge/inbox/` using the OKF inbox format.
2. Include: what was done, decisions made, what was deprecated, lessons learned, current state.
3. This is about the product, business logic, and application state, not just code diffs.
4. The post-commit hook will also write lightweight commit metadata to the inbox.

### Curation

The curation agent processes inbox items into permanent concept files:

1. Reads all unprocessed inbox items plus existing concepts and codebase context.
2. Creates or updates concept files in the appropriate directory.
3. Moves superseded concepts to `knowledge/deprecation/`.
4. Updates all `index.md` files and `knowledge/log.md`.

### Concept Types

| Type | Directory | Use For |
|------|-----------|---------|
| Architecture | `architecture/` | System structure, data models, infrastructure |
| Component | `components/` | UI components, interaction patterns |
| Domain | `domain/` | Business logic, domain entities, rules |
| Decision | `decisions/` | Architectural decisions and rationale |
| Process | `process/` | Workflows, sprint flow, deployment gates |
| Deprecation | `deprecation/` | Superseded patterns |
| State | `state/` | Current state of play |

### Rules

- Never delete concept files. Move superseded ones to `deprecation/` instead.
- Always update `index.md` files when adding or updating concepts.
- Always log curation actions in `log.md`.
- Use lowercase, consistent tags.
- One concept per file. Do not mix types.
- The `resource` field in frontmatter should point to the relevant code file, issue, or existing doc.
- For legacy projects, concepts reference existing docs via `resource` rather than duplicating content.
