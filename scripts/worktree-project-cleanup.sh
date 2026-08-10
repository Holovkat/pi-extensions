#!/usr/bin/env bash
set -euo pipefail

worktree_root="${1:-}"

if [[ -z "$worktree_root" ]]; then
  echo "Usage: ./scripts/worktree-project-cleanup.sh <worktree-path>" >&2
  exit 1
fi

cat <<EOF
No project-specific worktree cleanup steps are defined yet.

Customize scripts/worktree-project-cleanup.sh if this project needs deterministic shutdown or artifact cleanup before worktree removal.

Worktree: $worktree_root
EOF
