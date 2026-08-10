---
description: Reopen an agent in an existing prepared worktree pane
---

# /join-session - Rejoin Worktree Session

Pick an existing isolated worktree under `.worktrees/`, verify it still exists, and reopen the agent in that worktree's tmux pane.

## What It Does

1. Verifies tmux is already running in the current terminal
2. Enumerates valid git worktrees under `.worktrees/`
3. Lets you pick one interactively, or accepts a worktree name/path directly
4. Verifies the selected worktree folder still exists
5. Reuses the existing tmux pane when available, or splits a new pane and launches the agent there

## Usage

```
/join-session
/join-session sprint-34-mainline
/join-session .worktrees/sprint-34-mainline
/join-session /absolute/path/to/worktree
```

## Workflow Integration

```
/start-session
    ↓
Leave or detach from the worktree pane
    ↓
/join-session ← YOU ARE HERE
    ↓
Resume the agent in the existing isolated worktree
```

## See Also

- `/start-session` - Create a new isolated worktree session
- `/end-session` - Merge back to the recorded parent branch and clean up

---

**ACTION: Run `./commands/join-session.sh $ARGUMENTS`.**
