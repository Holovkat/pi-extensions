#!/usr/bin/env bash
set -euo pipefail

worktree_root="${1:-}"
branch_name="${2:-}"

if [[ -z "$worktree_root" ]]; then
  echo "Usage: ./scripts/worktree-project-prepare.sh <worktree-path> [branch-name]" >&2
  exit 1
fi

mkdir -p "$worktree_root/.worktree-session"

cat <<EOF
No project-specific worktree prep steps are defined yet.

Customize scripts/worktree-project-prepare.sh to make isolated sessions deterministic for this project.

Typical responsibilities:
- create worktree-local env/runtime files
- provision local services or databases
- seed fixtures or baseline data
- verify the worker environment is ready before Droid launches

Worktree: $worktree_root
Branch: ${branch_name:-<unknown>}
EOF
