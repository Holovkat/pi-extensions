---
description: Import GitHub issues or PRs and convert to implementation specs with child issues
---

You are importing a **GitHub issue or PR** and converting it into actionable implementation specifications. All spec content is created as GitHub child issues under the imported issue (which becomes or links to an epic). GitHub issues are the source of truth for both specs and task state.

**CRITICAL RULES:**
1. **ONE QUESTION AT A TIME** - Never ask multiple questions in a single response
2. **WAIT FOR ANSWERS** - Do not proceed until user responds
3. **GITHUB IS THE SOURCE** - All spec content lives in GitHub issue bodies
4. **TASK STATE ON ISSUES** - Completion is tracked via issue state and labels, not a local checklist
5. **POST GITHUB COMMENT** - MANDATORY at the end for traceability
6. **COMPLETE ALL STEPS** - Do NOT stop after the interview
7. **KEEP USER-FACING OUTPUT BRIEF** - Status updates only during execution. All detailed information goes into GitHub issues and comments. Do not repeat to the user what has been written to GitHub. Final summary: issues created, epic number, next steps.

## Planning Pack Ownership

This command is owned by the global `blueprint_orchestrator` planning agent
defined in [codex-global-planning-agents.md](../codex-global-planning-agents.md).

- If this command starts under another agent, immediately hand the workflow to
  `blueprint_orchestrator`.
- `blueprint_orchestrator` must infer the planning mode from imported issue/PR
  content, project trajectory, active epic state, recent commits, labels,
  comments, and known risk before it commits to specialist delegation.
- Ask a focused mode/scope question only when confidence is low or a high-risk
  unknown would make the next step unsafe.
- Use `req-analyst` when imported issue or PR content is sparse or ambiguous.
- Use `tech-analyst` for dependency, code-path, and sequencing analysis.
- Use `scenario-analyst` when imported acceptance or validation coverage is
  incomplete.
- Use `prd-writer` to convert the imported material and specialist findings into
  issue-ready planning content for final orchestrator review.
- Specialists are read-only. Only `blueprint_orchestrator` may publish the
  resulting GitHub planning artifacts.
- When delegation is needed, use Codex subagents directly so built-in activity
  shows real orchestration instead of inline roleplay.
- At planning gate points, use explicit option blocks instead of vague
  confirmations:
  `1. Proceed to the next step. (Recommended)`
  `2. Loop back and revise the current stage.`
  `3. Stop and replan / cancel.`

---

## WORKFLOW

| Step | Description | Required? |
|------|-------------|-----------|
| 1 | Check GitHub CLI | **MANDATORY** |
| 2 | Determine Import Source | **MANDATORY** |
| 3 | Fetch GitHub Data | **MANDATORY** |
| 4 | Context Gathering | **MANDATORY** |
| 5 | Present Summary | **MANDATORY** |
| 6 | Clarification Interview | **MANDATORY** |
| 7 | Confirm Understanding | **MANDATORY** |
| 8 | Sprint Placement | **MANDATORY** |
| 9 | Create/Update Epic Structure | **MANDATORY** |
| 10 | Create Task and Sub-task Issues | **MANDATORY** |
| 11 | Post GitHub Comment | **MANDATORY** |
| 12 | Summary | **MANDATORY** |

---

## Step 1: Check GitHub CLI

```bash
gh --version
gh auth status
gh repo view --json name,owner,url 2>/dev/null || echo "NO_GITHUB_REPO"
```

### 1.1 Refresh Shared Brief

Before clarification or delegation:

- Update the condensed shared brief with the imported source, current scope,
  inferred intent, confidence, project trajectory, active vectors, constraints,
  non-goals, references, and lessons learned.
- Reuse that shared brief for every specialist delegation rather than
  restating the full imported issue history each time.

## Step 2: Determine Import Source

> "What would you like to import?
> 1. **Specific issue** - Import by number (e.g., #42)
> 2. **Specific PR** - Import by PR number
> 3. **Browse open issues** - Show list
> 4. **Browse open PRs** - Show list
> 5. **Search issues** - By label, assignee, or keyword"

If user provided number directly (`/plan-github #42`), skip to Step 3.

## Step 3: Fetch GitHub Data

```bash
gh issue view [NUMBER] --json number,title,body,labels,assignees,milestone,comments,state,createdAt,author,url
```

## Step 5: Present Summary

> "## Planning Gate: Imported Scope Confirmation
> **Imported Issue:** #[NUMBER]
> **Title:** [title]
> **Author:** [author] | **Created:** [date]
> **Labels:** [labels]
>
> ### Description
> [body]
>
> Choose one:
> 1. **Proceed with this imported scope. (Recommended)**
> 2. **Loop back and refine the imported scope first.**
> 3. **Stop and replan / cancel.**
>
> Reply `1`, `2`, or `3`."

After a `Proceed` response, state the inferred mode when confidence is medium or
high:

> "I am treating this as a [quick-fix / standard / full-planning] import because
> [one concise reason from the imported issue and project trajectory]."

If confidence is low, ask one focused question instead:

> "I can take this in more than one direction because [specific ambiguity].
> Should I treat this as [recommended mode/scope] or [alternate mode/scope]?"

## Step 6: Clarification Interview

Ask ONE at a time:
- "Based on content, this appears to be a **[Bug/Feature/Chore]**. Correct?"
- "The description is brief. Can you clarify [aspect]?"
- "No acceptance criteria. How will we know this is complete?"
- "Do you have preferences for implementation approach?"

## Step 9: Create/Update Epic Structure

**If the imported issue should BE the epic:**
```bash
gh issue edit [NUMBER] --add-label "epic,sprint-[N]"
gh issue edit [NUMBER] --body "[full spec body with task list using #PENDING]"
```

**Ensure labels exist:**
```bash
gh label create "epic" --description "Epic-level feature issue" --color "7057ff" --force 2>/dev/null
gh label create "task" --description "Implementable task issue" --color "1d76db" --force 2>/dev/null
gh label create "sub-task" --description "Sub-task of a task" --color "c5def5" --force 2>/dev/null
```

## Step 10: Create Task and Sub-task Issues

Each task issue body must be detailed enough for implementation. Include file paths, interfaces, patterns, tests, acceptance criteria.

```bash
gh issue create \
  --title "[Sprint N] Task: [Task Name]" \
  --label "task,sprint-[N]" \
  --body "[full task specification]"
```

Sub-tasks (3rd level) as separate issues:
```bash
gh issue create \
  --title "[Sprint N] Sub-task: [Name]" \
  --label "sub-task,sprint-[N]" \
  --body "[sub-task spec referencing parent task and epic]"
```

Update parent issue task lists with real issue numbers:
```bash
gh issue edit [EPIC] --body "[updated body]"
```

## Step 11: Post GitHub Comment (MANDATORY)

```bash
gh issue comment [ORIGINAL] --body "## Implementation Planned

**Sprint**: Sprint [N]
**Epic**: #[EPIC]

**Tasks Created**:
- [ ] #[T1] - [Task 1]
- [ ] #[T2] - [Task 2]

_Planned via /plan-github on [DATE]_"
```

## Step 12: Summary

Present a brief summary to the user. Do not repeat what was written to GitHub.

```markdown
## Import Complete

- **Source**: #[number] - [title]
- **Epic**: #[E] | **Tasks**: [X] created
- **Next**: `/start-session feature/[name]`
```

---

**BEGIN NOW:** Fetch the issue, interview for clarity, create GitHub child issues, post comment. Keep user-facing output brief — detail goes to GitHub.
