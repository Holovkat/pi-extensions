---
description: Continue implementing the next phase with the governed builder flow
---

You are continuing implementation from the active epic. Task specifications live in **GitHub issues** linked to the epic. Work happens in the governed execution worktree created by `/start-session`; in serial chains this is the shared sprint worktree, while true parallel lanes may use dedicated task worktrees. The governed builder flow should use the global builder pack when available.

**CRITICAL RULES:**
1. **GITHUB ISSUES ARE THE SPEC AND THE QUEUE** - Issue bodies contain all spec content. Linked issues in creation order are the task queue. Keep the issue body stable and use comments for execution history.
2. **FREEZE THE TASK PACKET BEFORE CODING** - Declare owned files, contracts, schema, test data, artifacts, preload steps, fixtures, validation scope, and line-stop conditions up front
3. **USE THE BUILDER ORCHESTRATOR WHEN AVAILABLE** - Prefer real subagent delegation over inline roleplay
4. **ONE WARM WRITER PER TASK** - Route findings back into the same `dev` session
5. **HIDDEN PREREQUISITES LINE-STOP** - Substantial missing schema, data, or artifacts go back to replanning
6. **DO NOT CLOSE THE TASK ISSUE HERE** - Final sign-off stays with orchestration/UAT. Apply labels only.
7. **USE THE ISSUE'S WORKTREE PATH** - Do not derive a different local path when the issue already declares one
8. **TASK BRANCHES MUST USE `codex/`** - If the issue omits `Task Branch`, derive `codex/[task-slug]`
9. **GREEN TASKS MUST EXIT THROUGH `/end-session`** - Do not stop with uncommitted success in the current execution worktree
10. **SEQUENTIAL SPRINT MODE IS DEFAULT** - Reuse one prepared sprint worktree for serial tasks and reserve per-task worktrees for true parallel lanes
11. **BRANCH NAME MUST ALIGN WITH EPIC** - The current branch name (minus harness prefix) must match the active epic. If it doesn't, flag the mismatch and ask the user to resolve it.
12. **KEEP USER-FACING OUTPUT BRIEF** - Status updates only during execution. All detailed information goes into GitHub issues and comments. Do not repeat to the user what has been written to GitHub. Final summary: what was done, what was updated, current status.

---

## WORKFLOW

| Step | Description | Interactive? |
|------|-------------|--------------|
| 1 | Check uncommitted changes | No |
| 2 | Identify active epic and find next task from GitHub | No |
| 3 | Determine worktree status | No |
| 4 | Fetch task spec from GitHub issue | No |
| 4b | Run workspace prep | No |
| 4c | Freeze the builder task packet | No |
| 5 | Generate test scenarios | **YES** |
| 6 | Post scenarios to GitHub | No |
| 7 | Present implementation plan | No |
| 8 | Governed implementation via builder lanes | No |
| 9 | Update GitHub issue handoff state | No |
| 10 | Session summary | No |

## Step 2: Identify Active Epic and Find Next Task

GitHub is the source of truth for both the task queue and task state. No local
checklist file is needed. The epic is identified from the current branch, and
the next task is the first open, unblocked issue linked to that epic in creation
order (issue number sequence).

### 2.1 Identify the Active Epic (branch-first)

Parse the current branch name to determine the active epic:

```bash
git branch --show-current
```

Strip any harness prefix (`codex/`, `feature/`, etc.) and extract the slug.
Query open epics and match by slugified title:

```bash
gh issue list --label "epic" --state open --json number,title --jq '.[] | "\(.number) \(.title)"'
```

Slugify each epic title (e.g., "Epic: Auth Redesign" becomes `auth-redesign`)
and compare against the branch slug. The branch slug must contain or match the
epic slug. If it does, that epic is active. The branch is authoritative and
overrules everything.

### 2.2 Fallback: Oldest Open Epic

If the branch doesn't map to an epic, find the oldest open epic (lowest issue
number):

```bash
gh issue list --label "epic" --state open --json number,title --jq '[.[] | {number, title}] | sort_by(.number) | .[0]'
```

If exactly one open epic exists, use it.

### 2.3 Fallback: Ask User

If multiple open epics exist and the branch is ambiguous, ask the user:

> "Multiple open epics found. Which epic are you working on?
> 1. #[NN] - [Epic Title A]
> 2. #[NN] - [Epic Title B]
> Reply 1 or 2."

The user's choice holds for the session.

### 2.4 Validate Branch-Epic Alignment

If a branch-epic match was found in 2.1, confirm the alignment is valid. If the
branch name does not match any open epic and the user had to be asked (2.3),
note the mismatch and proceed with the user's choice. If the branch name
actively conflicts with the chosen epic (different slug), flag the mismatch
and stop for the user to resolve.

### 2.5 Find the Next Task

Query GitHub for issues linked to the active epic, sorted by issue number
(creation order = execution order). Pick the first open, unblocked task:

```bash
gh api graphql -f query='query {
  repository(owner: "[OWNER]", name: "[REPO]") {
    issue(number: [EPIC]) {
      trackedIssues(first: 100) {
        nodes {
          number
          title
          state
          labels(first: 20) { nodes { name } }
        }
      }
    }
  }
}'
```

Sort the linked issues by number ascending. Skip any that are:
- Closed (state: CLOSED) — completed
- Labeled `ready-for-integration` or `integration-pending` — implementation done, awaiting integration
- Labeled `builder-blocked` — blocked, move to next task
- Labeled `needs-replan` — needs replanning, move to next task

The first remaining open, unblocked issue is the next task. Extract its issue
number for Step 4.

If all linked tasks are closed or blocked, report that the epic has no
available tasks and suggest `/plan-feature` or `/plan-bugfix` for new work.

### 2.6 Legacy Checklist Fallback

If the project still has a local `00-IMPLEMENTATION-CHECKLIST.md` from before
the GitHub-native migration, it may be used as a fallback when GitHub has no
linked issues for the epic. In that case, read the checklist to find `- [ ]`
items as before, but note that this is a legacy path and the checklist should
be migrated to GitHub-linked issues.

## Step 3: Determine Worktree Status

```bash
git rev-parse --show-toplevel
git branch --show-current
git worktree list
```

Never implement from the primary checkout or on `main`.

Default builder mode is a shared sprint worktree for serial chains. Use the
issue-specific task branch/worktree only when a real parallel split or isolated
replay is justified.

Before creating a fresh task worktree, verify the repo actually has tracked
content to work with:

```bash
git ls-files | head
```

If tracked content is effectively empty and the task is not explicitly a
bootstrap-from-empty-repo task, line-stop instead of creating an empty shell
worktree.

## Step 4: Fetch Task Spec

```bash
gh issue view [TASK_NUMBER] --json number,title,body,labels,state
```

Extract requirements, file paths, interfaces, patterns, acceptance criteria,
complexity, dependencies, task branch, base branch, and worktree path from the issue body.

For a serial chain, treat the issue-level task branch/worktree as advisory
metadata. The active execution surface should be the shared sprint branch and
worktree.

## Step 4b: Run Workspace Prep Yourself

```bash
/workspace-prep [worktree-path]
```

## Step 4c: Freeze the Builder Task Packet

The packet must declare:
- `task_id`
- `issue_refs`
- `owned_files`
- `input_contracts`
- `output_contracts`
- `required_schema`
- `required_test_data`
- `required_artifacts`
- `preload_steps`
- `fixture_locations`
- `validation_scope`
- `regression_surface`
- `line_stop_conditions`

## Step 5: Generate Scenarios (Interactive)

For each task, present test scenarios (HP, EC, EX) and wait for user approval before proceeding.

## Step 6: Post to GitHub

Post approved scenarios as comments on task issues.

## Step 8: Implement

If `builder_orchestrator` is installed, invoke it as a real subagent and let it
coordinate:
- `dev` as the sole durable writer
- `reviewer`, `tester`, and `compliance` as read-only lanes

Keep the task packet frozen, preserve one warm `dev` session per task, and
line-stop back to replanning if substantial hidden prerequisites appear.
For adjacent serial tasks, keep reusing the same prepared sprint worktree
instead of allocating a new task worktree for each issue.

If the user started this task flow intentionally and prep succeeded, do not stop with an "if you want" prompt. Continue automatically into the governed build flow unless blocked.

If implementation and verification succeed, immediately run `/end-session` from
the same task worktree so `/builder-handoff`, labels, commit, push, and
epic-completion check are all completed before the run stops. If all task
issues for the epic are closed and UAT has passed, `/end-session` will close
the epic and collapse the branch. Only blocked tasks should stop with
`/builder-handoff` alone.

Use explicit wording before that handoff:
- green task: `Decision: proceeding directly to /end-session`
- blocked task: `Decision Needed: [exact choice]`
- bootstrap-only success: say it satisfies bootstrap scope without implying full epic completion

## Step 9: Update

1. Leave a canonical `Builder Handoff` comment on the task issue
2. Apply `ready-for-integration`, `integration-pending`, `builder-blocked`, or `needs-replan` labels
3. Do **not** close the task issue here

## Step 10: Session Summary

Present a brief summary to the user. Do not repeat what was written to GitHub.

```
Done. Task #[NN] implemented. Labeled [ready-for-integration]. Proceeding to /end-session.
```

Or if blocked:

```
Blocked. Task #[NN]. Reason: [one line]. Next: [one line].
```

---

**BEGIN NOW:** Identify the active epic from the branch, find the next task from GitHub linked issues, prepare the worktree, freeze the builder packet, review scenarios, then implement through the governed builder flow. Keep user-facing output brief — detail goes to GitHub.
