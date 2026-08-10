# `.worktrees/` - Session Control Surface

This directory governs isolated worktree lifecycle for agent sessions.

## Purpose

- create/reuse isolated worktrees for session branches
- store manifests describing parent branch, tmux pane, and cleanup targets
- keep deterministic session setup separate from app implementation logic

## Entry points

| Entry point | Purpose |
|-------------|---------|
| `commands/start-session.sh` | Create stacked branch + worktree + prep + agent tmux pane |
| `commands/join-session.sh` | Reopen the agent in an existing prepared worktree pane |
| `commands/end-session.md` | Drive the closeout workflow and invoke backend merge-back/cleanup |
| `scripts/worktree-session-open.sh` | Deterministic backend for session creation |
| `scripts/worktree-session-prepare.sh` | Generic prep plus project adapter hook |
| `scripts/worktree-session-close.sh` | Merge-back and cleanup backend |

## Session manifest

Runtime manifests live in `.worktrees/_meta/*.env`.

Each manifest records:
- source branch
- session branch
- merge-back target branch
- worktree path
- tmux parent/session names
- source commit

## Operating rules

- Start the lifecycle from inside `tmux`
- Session branches stack from the current branch and merge back to that recorded parent
- Fail fast on dirty checkouts rather than copying uncommitted state into a worktree
- Use the backend scripts for setup/cleanup instead of ad-hoc git worktree commands
