# Session Workflow - Installation Guide

This package provides slash commands, backend scripts, project skills, worktree guidance, and agent-aware hooks for managing coding sessions with an agent harness.

## What's Included

### Commands

| Command                   | Description                                                                |
| ------------------------- | -------------------------------------------------------------------------- |
| `/plan-feature`           | Interactive planning session to scope and document a new feature           |
| `/plan-bugfix`            | Interactive planning session to scope and document a bug fix               |
| `/plan-github`            | Import GitHub issues/PRs and convert them into implementation specs        |
| `/plan-review`            | Review planning output against the Q&A/intake record before build approval |
| `/release-assess`         | Assess release intent, confidence, vectors, order, and specialist ownership |
| `/start-session <branch>` | Create a stacked branch, isolated worktree, and tmux-rooted agent session  |
| `/next-phase`             | Continue implementing the next task from GitHub linked issues            |
| `/end-session`            | Close out session, close epic and collapse branch when all tasks done      |
| `/uat`                    | Run User Acceptance Testing with guided test scenarios and rework tracking |
| `/compliance-review`      | Verify requirements compliance and Definition of Done before handover/UAT  |
| `/kingmode`               | Activate "King Mode" for deep, multi-dimensional analysis                  |

### Hook Command Aliases

These are settings-backed aliases when the harness supports hook command
aliases; they are not Markdown command files.

| Alias | Description |
| ----- | ----------- |
| `/sanity-check` | Verify app loads without errors |
| `/code-review` | Get a second agent review on recent changes |

### Worktree Session Backend

| Component | Description |
| --------- | ----------- |
| `scripts/worktree-session-open.sh` | Creates a stacked branch, worktree, session manifest, and launches the agent harness in tmux |
| `scripts/worktree-session-prepare.sh` | Runs deterministic per-worktree preparation plus the project prep adapter |
| `scripts/worktree-session-close.sh` | Merges back to the recorded parent branch and removes session artifacts |
| `scripts/start-droid-worktree.sh` | Reuses a prepared worktree and launches the agent harness in a new tmux pane |
| `scripts/worktree-project-prepare.sh` | Project-specific adapter for runtime/bootstrap tasks |
| `scripts/worktree-project-cleanup.sh` | Project-specific adapter for shutdown/cleanup tasks |
| `scripts/release-vector-assess.sh` | Provider-neutral starter matrix for release/change vectors |

### Project Skills

| Skill | Description |
| ----- | ----------- |
| `worktree-toolkit-init` | Audit and update project-specific worktree lifecycle tooling |
| `worktree-session-lifecycle` | Operate the start/end session lifecycle through the backend scripts |
| `plan-review` | Review planning artifacts against Q&A/intake before build approval |
| `release-assess` | Infer release intent/confidence and route active vectors to specialists |
| `vibe-fix` | Handle small observed behavior fixes with live verification |

### Worktree Guidance

| File | Description |
| ---- | ----------- |
| `.worktrees/README.md` | Operator-facing overview for session lifecycle |
| `.worktrees/AGENTS.md` | Rules and entrypoints for agent-managed worktree sessions |
| `.worktrees/_meta/README.md` | Manifest contract for merge-back and cleanup |

### Agent-Aware Hooks

| Hook                        | Trigger                     | Purpose                            |
| --------------------------- | --------------------------- | ---------------------------------- |
| `post-edit-lint.sh`         | After Edit/Create/MultiEdit | Incremental lint on modified files |
| `sanity-check.sh`           | Manual or end-session       | Verify app loads without errors    |
| `code-review-checkpoint.sh` | Manual or end-session       | Second agent review of changes     |
| `pre-commit-workflow.sh`    | Before git commit           | Lint, build, code review           |
| `post-commit-push.sh`       | After git commit            | Push current branch/upstream       |

## Prerequisites

- Agent harness installed and able to load project-local commands
- Git repository initialized
- Project uses `pnpm` (or modify commands for `npm`/`yarn`)
- `jq` for JSON processing: `brew install jq`

## Quick Install

### New Project (Full Install)

Use the global `/install-workflows` command to set up everything:

```bash
# In your agent harness, from your project root:
/install-workflows
```

This installs:

- Commands + Hooks + Settings
- Worktree session backend scripts (`scripts/`)
- Project-local skills (`skills/`)
- `.worktrees/` guidance + manifest scaffolding
- Design templates (`designs/templates/`)
- Supporting files (`features/`, `changelog/`)

### Existing Project (Refresh Only)

Use `/install-session-workflows` to refresh commands/hooks without overwriting templates:

```bash
# In your agent harness, from your project root:
/install-session-workflows
```

This updates commands and hooks but leaves your `designs/templates/` untouched.

### Installer Options

```bash
# Full install with templates (new projects)
/install-workflows

# Refresh commands/hooks only (existing projects)
/install-session-workflows

# Refresh including templates
/install-session-workflows --with-templates

# Only refresh commands
/install-session-workflows --commands-only

# Only refresh hooks
/install-session-workflows --hooks-only

# Skip settings.json (keep existing)
/install-session-workflows --no-settings

# Preview what would be copied
/install-session-workflows --dry-run
```

The refresh command defaults to project-level `commands/`, `hooks/`, and `settings.json`. Harnesses that use another layout can set:

```bash
DESIGNS_WORKFLOW_SOURCE=/path/to/designs/templates/instructional-documents
WORKFLOW_COMMANDS_DIR=/path/to/project-command-dir
WORKFLOW_HOOKS_DIR=/path/to/project-hook-dir
WORKFLOW_SETTINGS_FILE=/path/to/project-settings.json
WORKFLOW_PROJECT_DIR=/path/to/project-root
```

### What Gets Installed

| Location                 | `/install-workflows` | `/install-session-workflows` |
| ------------------------ | -------------------- | ---------------------------- |
| `commands/`              | Yes                  | Yes                          |
| `hooks/`                 | Yes                  | Yes                          |
| `settings.json`          | Yes                  | Yes                          |
| `scripts/`               | Yes                  | Yes                          |
| `skills/`                | Yes                  | Yes                          |
| `.worktrees/`            | Yes                  | Yes                          |
| `features/`              | Yes (if missing)     | Yes (if missing)             |
| `changelog/`             | Yes (if missing)     | Yes (if missing)             |
| `designs/templates/`     | **Yes**              | No (use `--with-templates`)  |

### Refreshing After Template Updates

When the template files are updated, refresh your project:

```bash
/install-session-workflows
```

This safely updates commands and hooks without overwriting any customized templates.

## Manual Installation

### Step 1: Create directories

```bash
mkdir -p commands hooks scripts skills .worktrees/_meta features changelog
```

### Step 2: Copy the command files

```bash
# From this template directory, copy to your project:
cp start-session.sh /path/to/your/project/commands/
cp end-session.sh /path/to/your/project/commands/
cp end-session.md /path/to/your/project/commands/
cp next-phase.md /path/to/your/project/commands/
cp kingmode.md /path/to/your/project/commands/
```

Or manually create each file in `commands/` or your harness-specific command directory:

- `plan-feature.md` - Markdown command (interactive feature planning)
- `plan-bugfix.md` - Markdown command (interactive bugfix planning)
- `plan-github.md` - Markdown command (GitHub issue/PR import)
- `plan-review.md` - Markdown command (planning vs Q&A/intake review)
- `release-assess.md` - Markdown command (release intent, vector, and execution-order assessment)
- `start-session.sh` - Executable bash script
- `end-session.sh` - Executable bash wrapper for merge-back + cleanup
- `next-phase.md` - Markdown command
- `end-session.md` - Markdown command (includes compliance gate)
- `uat.md` - Markdown command (user acceptance testing with rework tracking)
- `compliance-review.md` - Markdown command (requirements compliance and DoD ranking)
- `kingmode.md` - Markdown command

### Step 3: Copy the backend scripts

```bash
cp /path/to/templates/instructional-documents/scripts/* /path/to/your/project/scripts/
chmod +x /path/to/your/project/scripts/*.sh
```

### Step 4: Copy the project skills

```bash
cp -R /path/to/templates/instructional-documents/skills/. /path/to/your/project/skills/
```

### Step 5: Copy the `.worktrees` guidance files

```bash
cp /path/to/templates/instructional-documents/worktrees/.gitignore /path/to/your/project/.worktrees/
cp /path/to/templates/instructional-documents/worktrees/README.md /path/to/your/project/.worktrees/
cp /path/to/templates/instructional-documents/worktrees/AGENTS.md /path/to/your/project/.worktrees/
cp /path/to/templates/instructional-documents/worktrees/_meta/.gitignore /path/to/your/project/.worktrees/_meta/
cp /path/to/templates/instructional-documents/worktrees/_meta/README.md /path/to/your/project/.worktrees/_meta/
```

### Step 6: Copy the hooks

```bash
# From the hooks template directory:
cp /path/to/templates/instructional-documents/hooks/*.sh hooks/
```

### Step 7: Configure hook settings

```bash
# Copy the agent-aware hooks settings
cp /path/to/templates/instructional-documents/hooks/settings-agent-aware.json settings.json
```

### Step 8: Make scripts executable

```bash
chmod +x commands/start-session.sh
chmod +x commands/end-session.sh
chmod +x hooks/*.sh
chmod +x scripts/*.sh
```

### Step 9: Create supporting files

#### Implementation Checklist (Legacy)

The local `00-IMPLEMENTATION-CHECKLIST.md` is a legacy artifact from before
GitHub-native task tracking. New projects should not create one. GitHub issues
linked to the epic are the source of truth for task queue and completion state.
Existing projects with checklists can migrate by closing off remaining items
and noting that GitHub is the source of truth going forward.

For backward compatibility, `/next-phase` includes a legacy fallback that reads
the checklist when GitHub has no linked issues for the active epic.

#### Backlog File

Create `features/BACKLOG.md`:

```bash
cp BACKLOG.md /path/to/your/project/features/
```

#### Session Log

Create `changelog/SESSION-LOG.md`:

```markdown
# Session Log

Development session history with completed work and changes.

---

## Sessions

<!-- New sessions are added below this line -->
```

### Step 10: Verify installation

In your project directory, reload your agent harness and list available commands:

```
/commands
```

You should see:

- `/start-session` - Create stacked branch + worktree + tmux agent session
- `/next-phase` - Continue implementing next phase
- `/end-session` - Close out session, close epic and collapse branch when all tasks done
- `/plan-review` - Review planning output against the Q&A/intake record
- `/release-assess` - Assess release intent, vectors, ownership, and order
- `/compliance-review` - Verify requirements compliance and rank Definition of Done

With agent-aware hook aliases enabled, you may also see:

- `/sanity-check` - Verify app loads without errors
- `/code-review` - Get second agent review on changes

To verify hooks are active:

```bash
cat settings.json | jq '.hooks'
```

## Directory Structure

After installation, your project should have:

```
your-project/
├── commands/
│   ├── plan-feature.md     # Interactive feature planning
│   ├── plan-bugfix.md      # Interactive bugfix planning
│   ├── plan-github.md      # GitHub issue/PR import
│   ├── plan-review.md      # Planning vs Q&A/intake review
│   ├── release-assess.md   # Release vector and execution-order assessment
│   ├── start-session.sh    # Creates stacked branch + worktree
│   ├── end-session.sh      # Merge-back + cleanup wrapper
│   ├── next-phase.md       # Continues implementation
│   ├── end-session.md      # Closes session
│   ├── compliance-review.md # Requirements compliance and DoD gate
│   ├── uat.md              # User acceptance testing
│   └── kingmode.md         # Deep analysis mode
├── hooks/
│   ├── post-edit-lint.sh   # Lint after file edits
│   ├── sanity-check.sh     # Verify app loads
│   ├── code-review-checkpoint.sh  # Second opinion
│   ├── pre-commit-workflow.sh     # Pre-commit checks
│   └── post-commit-push.sh        # Push current branch/upstream
├── settings.json           # Hooks configuration
├── scripts/
│   ├── README.md                    # Backend session lifecycle overview
│   ├── worktree-session-open.sh     # Creates stacked branch + worktree
│   ├── worktree-session-prepare.sh  # Runs deterministic worktree prep
│   ├── worktree-session-close.sh    # Merges back + cleans up
│   ├── start-droid-worktree.sh      # Launches the agent harness in tmux
│   ├── worktree-project-prepare.sh  # Project-specific prep adapter
│   ├── worktree-project-cleanup.sh  # Project-specific cleanup adapter
│   └── release-vector-assess.sh     # Provider-neutral release vector matrix
├── skills/
│   ├── README.md
│   ├── plan-review/
│   │   └── SKILL.md
│   ├── release-assess/
│   │   └── SKILL.md
│   ├── vibe-fix/
│   │   └── SKILL.md
│   ├── worktree-toolkit-init/
│   │   └── SKILL.md
│   └── worktree-session-lifecycle/
│       └── SKILL.md
├── .worktrees/
│   ├── .gitignore
│   ├── README.md
│   ├── AGENTS.md
│   └── _meta/
│       ├── .gitignore
│       └── README.md
├── features/
│   ├── 00-IMPLEMENTATION-CHECKLIST.md (legacy, optional)
│   └── BACKLOG.md
└── changelog/
    └── SESSION-LOG.md
```

## Customization

### Change package manager

Edit `end-session.md` Step 1 to use your package manager:

```markdown
# For npm:

npm run lint
npm run build

# For yarn:

yarn lint
yarn build
```

### Customize project prep adapters

Edit these scripts for project-specific deterministic setup and cleanup:

```bash
scripts/worktree-project-prepare.sh
scripts/worktree-project-cleanup.sh
```

Typical prep responsibilities:
- create worktree-local env/runtime files
- seed data or fixtures
- start or verify local services
- emit readiness markers for worker agents

### Add/remove quality checks

Edit `end-session.md` Step 1 to add typecheck, tests, etc:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Usage

### Planning a new feature

```
/plan-feature
```

The agent will:

1. Gather context (review docs, git history, codebase)
2. Interview you one question at a time about the feature
3. Trigger `/kingmode` analysis if needed
4. Generate a numbered shard document in `features/` (optional)
5. Create GitHub issues as the source of truth for tasks

### Planning a bug fix

```
/plan-bugfix
```

The agent will:

1. Gather context and review recent changes
2. Interview you about the bug symptoms and behavior
3. Investigate the codebase to identify root cause
4. Generate a bugfix GitHub issue with analysis and fix plan

### Importing from GitHub

```
/plan-github
```

Or with a specific issue:

```
/plan-github #42
```

The agent will:

1. Fetch issue/PR details from GitHub (title, body, labels, comments)
2. Present the content and clarify any missing details
3. Determine if it's a bug, feature, or chore
4. Generate GitHub issues with imported context preserved
5. Post implementation plan comment to the GitHub issue (mandatory)

### Reviewing the plan before build

```
/plan-review
```

The agent will:

1. Compare the plan against the request, Q&A session, or imported issue
2. Check scope, non-goals, acceptance criteria, evidence gates, risks, dependencies, and ownership
3. Rank the plan `A - Approved`, `B - Conditional`, `C - Incomplete`, or `D - Replan`
4. Block build until the plan passes or the owner accepts documented caveats

### Starting implementation

```
/start-session feature/my-new-feature
```

The backend script will:

1. Require that you already started inside `tmux`
2. Fail if the current checkout is dirty
3. Create a stacked branch from the current branch
4. Create a worktree under `.worktrees/`
5. Run the deterministic prep scripts
6. Launch the agent harness in a new tmux pane rooted in that worktree while preserving the parent pane

### Continuing project work

```
/next-phase
```

The agent will:

1. Check for uncommitted changes (offers to run end-session first)
2. Read the active epic and its linked task issues from GitHub
3. Find the next incomplete sprint
4. Create/switch to the sprint branch
5. Show the implementation plan
6. Implement after your confirmation

### Ending a session

```
/end-session
```

The agent will:

1. Run review/compliance gates
2. Commit and push the task branch
3. Check if all task issues for the epic are closed and UAT has passed
4. If yes: close the epic, collapse the branch entirely
5. If no: run merge-back + cleanup for the current task only
6. Remove the isolated worktree/session branch/tmux pane
7. Return you to the recorded parent branch

### Reviewing Compliance and Definition of Done

```
/compliance-review
```

The agent will:

1. Compare approved requirements against delivered files, behavior, tests, and evidence
2. Check whether code review, test review, smoke evidence, and compliance evidence are complete
3. Rank the work `A - Done`, `B - Done with caveats`, `C - Not done`, or `D - Replan`
4. Block handover/UAT unless the rank passes or the owner accepts caveats

### Running User Acceptance Testing

```
/uat
```

The agent will:

1. Identify the current sprint and its changes
2. Analyze git history and requirements sources for acceptance criteria
3. Generate comprehensive test scenarios
4. Walk you through each test one at a time, awaiting approval
5. Log any failures to the project-standard UAT rework document under `[PLAN_ROOT]/UAT/`
6. Update GitHub issue labels with UAT status (uat-passed/uat-failed)
7. Direct you to `/next-phase`, `/plan-feature`, or `/plan-bugfix` for rework

### Activating King Mode

```
/kingmode
```

The agent will:

1. Activate "King Mode" for deep, multi-dimensional analysis
2. Provide detailed reasoning chain and edge case analysis

### Deactivating King Mode

```
/kingmode off
```

## Troubleshooting

### Commands not appearing

1. Ensure files are in `commands/` or your harness-specific command directory
2. Check file extensions: `.sh` for bash, `.md` for markdown
3. Run `/commands` and press `R` to reload

### Permission denied on start-session

```bash
chmod +x commands/start-session.sh
```

### No origin remote

If git operations fail with "origin does not exist":

```bash
git remote add origin <your-repo-url>
```

---

_Template version: January 2026_
