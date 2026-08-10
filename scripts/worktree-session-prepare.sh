#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/worktree-session-lib.sh"

usage() {
  cat <<'EOF'
Usage: ./scripts/worktree-session-prepare.sh <absolute-worktree-path> [branch-name]

Creates per-worktree session state and runs the optional project-specific prep adapter.
EOF
}

main() {
  local target_path="${1:-}"
  local requested_branch="${2:-}"
  local worktree_root
  local primary_root
  local branch_name
  local runtime_root
  local prepared_file
  local prepare_script

  case "$target_path" in
    -h|--help|"")
      usage
      [[ -n "$target_path" ]] && exit 0
      wt_session_fail "Missing worktree path."
      ;;
  esac

  worktree_root="$(cd "$target_path" && pwd -P)"
  worktree_root="$(git -C "$worktree_root" rev-parse --show-toplevel 2>/dev/null)" || wt_session_fail "\"$target_path\" is not a git worktree."
  primary_root="$(wt_session_primary_root "$worktree_root")"

  if [[ "$worktree_root" == "$primary_root" ]]; then
    wt_session_fail "Refusing to prepare the primary checkout."
  fi

  branch_name="$requested_branch"
  if [[ -z "$branch_name" ]]; then
    branch_name="$(git -C "$worktree_root" branch --show-current)"
  fi

  runtime_root="$worktree_root/.worktree-session"
  prepared_file="$(wt_session_prepared_file "$worktree_root")"
  mkdir -p "$runtime_root" "$runtime_root/logs" "$runtime_root/tmp"

  prepare_script="$worktree_root/scripts/worktree-project-prepare.sh"
  if [[ -x "$prepare_script" ]]; then
    "$prepare_script" "$worktree_root" "$branch_name"
  fi

  wt_session_write_env_file \
    "$prepared_file" \
    "WORKTREE_SESSION_PREPARED=1" \
    "WORKTREE_SESSION_WORKTREE_ROOT=${worktree_root}" \
    "WORKTREE_SESSION_PRIMARY_ROOT=${primary_root}" \
    "WORKTREE_SESSION_BRANCH=${branch_name}" \
    "WORKTREE_SESSION_PREPARED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  echo "Prepared worktree session: $worktree_root"
  echo "Prepared marker: $prepared_file"
}

main "$@"
