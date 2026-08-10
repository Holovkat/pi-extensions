#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -d "$SCRIPT_DIR/../scripts" ]]; then
  REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
else
  REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || true)"
  if [[ -z "$REPO_ROOT" ]]; then
    REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
  fi
fi

branch_name="${1:-}"

if [ -z "$branch_name" ]; then
  echo "Error: Please provide a branch name"
  echo "Usage: /start-session <branch-name>"
  exit 1
fi

exec "$REPO_ROOT/scripts/worktree-session-open.sh" "$branch_name"
