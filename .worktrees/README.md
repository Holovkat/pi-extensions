# Worktree Sessions

This folder is the control surface for isolated coding sessions.

## What lives here

- session worktree checkouts created by `/start-session`
- `_meta/*.env` session manifests used for merge-back and cleanup
- local guidance for agents operating on session lifecycle tasks

## Session lifecycle

1. Run `/start-session <branch-name>` from inside `tmux`
2. The backend scripts create a stacked branch, create the worktree, prep the runtime, and launch Droid there
3. Do implementation work inside that isolated worktree
4. After review/UAT/approval, run `/end-session`
5. The backend scripts merge back to the recorded parent branch and remove the worktree/session artifacts

## Important rules

- Do not manually reuse session manifests across branches
- Do not merge a session branch directly to `main` unless its recorded parent branch is `main`
- Keep the parent checkout clean before starting or closing a session
