# Pi Extensions

Custom extensions for the [pi coding agent CLI](https://github.com/nichochar/pi) that orchestrate multi-agent workflows for requirements discovery and sprint-based development. Home to the Open Knowledge Format (OKF) extension, skill, and curator droid.

## Key Areas

| Area | Path | Description |
|------|------|-------------|
| Extensions | `extensions/` | req-qa, dev-pipeline, pi-blueprint, pi-toolshed, council, coms, okf, pif, providers |
| Agents | `agents/` | Agent definitions (req-qa specialists, dev-pipeline agents, blueprint agents) |
| Skills | `skills/` | OKF skill, pi-blueprint skills |
| Droids | `.factory/droids/` | OKF curator, pif-builder |
| Bin | `bin/` | Terminal and web dashboards |
| Docs | `docs/` | Walkthroughs, comms guide, research, retrospectives |
| Features | `features/` | Feature specs and planning |
| Knowledge | `knowledge/` | OKF knowledge bundle (37 concepts) |
| pif App | `pif/` | Flutter macOS agentic IDE shell |
| Scripts | `scripts/` | install-pif.sh, build-pif-app.sh |

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

### Before Committing Work

When you finish a meaningful work session, write a session synthesis to `knowledge/inbox/` BEFORE you commit:

1. Write the session synthesis to `knowledge/inbox/` using the OKF inbox format.
2. Include: what was done, decisions made, what was deprecated, lessons learned, current state.
3. This is about the product, business logic, and application state, not just code diffs.
4. `git add` the inbox file along with your other changes so it's part of the commit.
5. The post-commit hook refreshes the workspace manifest but does NOT create stubs.

### Curation

The curation agent processes inbox items into permanent concept files:

1. Reads all unprocessed inbox items plus existing concepts and codebase context.
2. Creates or updates concept files in the appropriate directory.
3. Moves superseded concepts to `knowledge/deprecation/` with full lesson sections.
4. Updates all `index.md` files and `knowledge/log.md`.
5. Auto-commits changes with `okf-curation:` prefix (the post-commit hook skips these to prevent loops).

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

## Building pif (Standalone macOS App)

pif can be built into a self-contained `.app` that bundles Node.js + pi CLI + pif extensions. No external dependencies required on the target machine.

### Build from terminal

```bash
./scripts/build-pif-app.sh
```

Produces `build/pif.app` (~290MB). Install with:

```bash
cp -R build/pif.app /Applications/pif.app
open /Applications/pif.app
```

### Build via the pif-builder droid

The `pif-builder` droid (`.factory/droids/pif-builder.md`, model: GLM-5.3) automates the full build + install cycle. It kills any running instance, runs the build script, verifies the output, and installs to `/Applications/`.

Invoke it by asking: "build pif", "rebuild pif", or "update pif to the latest version".

### UAT handback: build, deploy, and verify pif

When handing pif back for UAT, complete the full local delivery loop before
reporting it as ready:

```bash
(cd pif && flutter analyze)
(cd pif && flutter test)
node --test extensions/pif.integration.test.mjs
./scripts/build-pif-app.sh
pkill -TERM -f '/Applications/pif.app/Contents/MacOS/pif' || true
ditto build/pif.app /Applications/pif.app
open /Applications/pif.app
sleep 2
pgrep -fl '/Applications/pif.app/Contents/MacOS/pif'
codesign --verify --deep --strict /Applications/pif.app
```

Build, install, and launch are separate evidence. The UAT handback must name
the installed path and the returned process ID, and must not call the app
deployed based on a build artifact alone. The installed bundle should also be
checked against the source for the changed widget when practical:

```bash
cmp -s pif/lib/widgets/agent_console/agent_console.dart \
  /Applications/pif.app/Contents/Resources/app/lib/widgets/agent_console/agent_console.dart
```

### What gets bundled

```
pif.app/Contents/
  MacOS/pif              ← Flutter native binary
  Resources/
    pi/node              ← Node.js runtime
    pi/cli/              ← pi CLI package
    pi/extensions/       ← pif.ts + pif-shared.ts
    app/                 ← Flutter app source (widget scanning)
```

On launch, the app shows a project picker. Select a folder and pif spawns pi with `PIF_AUTOSTART=1 PIF_NO_FLUTTER=1` — the pif extension auto-starts the hub, and the app connects via WebSocket.

## Communication discipline
- Communicate clearly, concisely, and in plain language.
- Stay on track and focused on the current task or software-development conversation.
- Do not ramble, repeat yourself, or add unnecessary background and detail.
- Avoid excessive technical jargon. When specialized terms are necessary, explain them briefly.
- Prioritize relevant actions, decisions, evidence, blockers, and next steps.
