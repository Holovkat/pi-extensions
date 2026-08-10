---
description: Close session with compliance gate, builder handoff, merge-back, and cleanup. Closes epic and collapses branch when all tasks are done.
---

You are closing out the current coding session. This includes quality checks,
compliance review, builder handoff updates, branch push, merge-back to the
recorded parent branch, and cleanup of the isolated worktree session.

When all task issues linked to the epic are closed and UAT has passed,
`/end-session` also closes the epic and collapses the branch entirely.

**CRITICAL RULES:**
1. **COMPLIANCE IS A GATE** - Cannot hand off cleanly until compliance passes or the issue is explicitly blocked
2. **USE BUILDER HANDOFF** - The issue comment and labels are the durable execution record
3. **CAPTURE PACKET/WARM-LOOP FACTS** - Record whether packet freeze held and whether warm `dev` continuity was preserved
4. **CHECK EPIC COMPLETION** - If all task issues for the epic are closed and UAT has passed, close the epic and collapse the branch
5. **COMPLETE ALL STEPS** - Do not skip the GitHub handoff, branch push, or merge-back cleanup
6. **KEEP USER-FACING OUTPUT BRIEF** - Status updates only during execution. All detailed information goes into GitHub issues and comments. Do not repeat to the user what has been written to GitHub. Final summary: what was done, what was closed, current status.

---

## WORKFLOW

| Step | Description |
|------|-------------|
| 1 | Run Quality Checks (lint, build) |
| 2 | Compliance Review (GATE) |
| 3 | Code Review |
| 4 | Gather builder handoff facts |
| 5 | Update GitHub issue handoff state |
| 6 | Check epic completion |
| 7 | Git Operations (commit, push) |
| 8 | Merge back to parent + cleanup |
| 9 | Summary |

## Step 1: Quality Checks

```bash
bun run lint 2>/dev/null || pnpm lint 2>/dev/null || npm run lint 2>/dev/null || true
bun run build 2>/dev/null || pnpm build 2>/dev/null || npm run build 2>/dev/null || true
```

## Step 2: Compliance Review (GATE)

Read acceptance criteria from the GitHub task issue and verify the current work.
If compliance fails and you cannot fix it in-session, hand off as blocked.

## Step 4: Gather Builder Handoff Facts

- task issue number
- branch
- worktree path
- commit SHA
- verification results
- lessons learned
- new prerequisites or setup changes
- data baseline, fixture, or dataset changes
- whether the task packet remained frozen
- whether warm `dev` continuity was preserved
- whether line-stop / replanning conditions were triggered or avoided

## Step 5: Update GitHub Issue Handoff State

Run `/builder-handoff` and let it:
- post the canonical handoff comment
- apply `ready-for-integration`, `integration-pending`, `builder-blocked`, and `needs-replan`
- update setup/data docs when needed

Do **not** close the task issue here unless all epic tasks are complete (see
Step 6).

## Step 6: Check Epic Completion

After the builder handoff, check whether all task issues linked to the active
epic are closed and UAT has passed:

```bash
# Identify the active epic from the current branch
gh issue list --label "epic" --state open --json number,title

# Query linked issues for the epic
gh api graphql -f query='query {
  repository(owner: "[OWNER]", name: "[REPO]") {
    issue(number: [EPIC]) {
      trackedIssues(first: 100) {
        nodes {
          number
          state
          labels(first: 20) { nodes { name } }
        }
      }
    }
  }
}'
```

### If ALL task issues are closed and UAT has passed:

1. Close the task issue (if not already closed):

```bash
gh issue close [TASK_NUMBER] --comment "Task complete. UAT passed. Closed by /end-session on [DATE]."
```

2. Post a Closing Report comment on the epic:

```bash
gh issue comment [EPIC_NUMBER] --body "## Closing Report

**Epic**: #[EPIC_NUMBER] - [Epic Title]
**Branch**: [branch-name]
**Closed**: [DATE]
**Status**: Complete

### Tasks Completed
| Issue | Title | UAT | Closed |
|-------|-------|-----|--------|
| #[T1] | [Task 1] | Passed | [DATE] |
| #[T2] | [Task 2] | Passed | [DATE] |

### Summary
[2-3 sentences: what was built, key decisions, anything notable]

### UAT Status
- Scenarios run: [N]
- Passed: [N]
- Failed: [N]
- Result: [All passed / Passed with caveats / Forced close]

### Branch
- Merged back to: [parent-branch]
- Worktree: [removed]
- Session branch: [removed]

### Lessons Learned
- [Any notable lessons from the session]

_Closed by /end-session on [DATE]_
"
```

3. Close the epic:

```bash
gh issue close [EPIC_NUMBER]
```

4. Proceed to Step 7 and Step 8 — the merge-back and cleanup will collapse
   the branch entirely since the epic is complete.

### If tasks remain open or UAT has not passed:

1. Do **not** close the task issue or the epic.
2. Apply labels only (`ready-for-integration`, etc.) via the builder handoff.
3. Post a brief session-end comment on the task issue:

```bash
gh issue comment [TASK_NUMBER] --body "## Session End

**Branch**: [branch-name]
**Status**: [ready-for-integration / builder-blocked / needs-replan]
**Committed**: [SHA]
**Next**: [remaining tasks in epic / blocked on / needs replan]

_Session ended by /end-session on [DATE]_
"
```

4. Proceed to Step 7 and Step 8 — the merge-back and cleanup handle the
   current task's worktree only. The branch remains for future tasks.

## Step 7: Git Operations

```bash
git add -A
git commit -m "[type]: [short description]"
git push -u origin $(git branch --show-current) 2>/dev/null || git push origin $(git branch --show-current)
```

## Step 8: Merge Back to Parent + Cleanup

After the branch is committed, pushed, approved, and UAT has passed, run:

```bash
./commands/end-session.sh
```

That backend script should:
- rebase the session branch onto its recorded parent branch
- fast-forward merge the parent branch locally
- stop project-specific worktree runtime artifacts if required
- remove the session branch, worktree folder, and tmux pane

If the epic is complete (Step 6 closed it), the branch is fully collapsed —
no remaining worktree or branch artifacts for this epic.

If the backend cleanup fails, stop and report the blocker instead of deleting state manually.

## Step 9: Summary

Present a brief summary to the user. Do not repeat what was written to GitHub.

### If epic was closed:

```
Done. Epic #[NN] closed. All [N] tasks complete. Branch collapsed.
```

### If tasks remain:

```
Done. Task #[NN] labeled [ready-for-integration]. [N] tasks remaining in epic #[NN].
```

### If blocked:

```
Blocked. Task #[NN] labeled [builder-blocked]. Reason: [one line]. Next: [one line].
```

---

**BEGIN NOW:** Run quality checks, run the compliance gate, gather the builder handoff facts, invoke `/builder-handoff`, check epic completion, commit and push the task branch, then run `./commands/end-session.sh`. Keep user-facing output brief — detail goes to GitHub.
