# Worktree session scripts

These scripts are the deterministic backend for the session lifecycle.

## Layers

- `worktree-session-open.sh` — create stacked branch, worktree, manifest, and launch Droid
- `worktree-session-prepare.sh` — run generic prep plus the project adapter
- `worktree-session-close.sh` — merge back to the recorded parent branch and clean up
- `start-droid-worktree.sh` — tmux-aware Droid launcher for a prepared worktree
- `worktree-project-prepare.sh` — project-specific initialization hook
- `worktree-project-cleanup.sh` — project-specific cleanup hook
- `release-vector-assess.sh` — provider-neutral starter matrix for release intent,
  confidence, vectors, execution order, and specialist ownership

## Rule

Skills and commands should delegate to these scripts rather than rediscovering setup steps interactively each time.
