#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/worktree-session-lib.sh"

usage() {
  cat <<'EOF'
Usage: ./scripts/worktree-session-open.sh <branch-name>

Creates a stacked branch from the current branch, prepares an isolated worktree,
records session metadata, and launches Droid in a new tmux pane alongside the parent context.
EOF
}

main() {
  local branch_name="${1:-}"
  local source_root
  local primary_root
  local source_branch
  local source_commit
  local worktree_name
  local worktree_path
  local manifest_path
  local parent_tmux_session
  local parent_tmux_pane
  local child_tmux_pane=""
  local cleanup_required=0

  case "$branch_name" in
    -h|--help|"")
      usage
      [[ -n "$branch_name" ]] && exit 0
      wt_session_fail "Missing branch name."
      ;;
  esac

  wt_session_require_tmux_session
  wt_session_require_command git
  wt_session_require_command droid

  source_root="$(wt_session_repo_root "$PWD")"
  primary_root="$(wt_session_primary_root "$source_root")"
  source_branch="$(git -C "$source_root" branch --show-current)"
  source_commit="$(git -C "$source_root" rev-parse HEAD)"
  parent_tmux_session="$(wt_session_current_tmux_session)"
  parent_tmux_pane="$(wt_session_current_tmux_pane)"

  [[ -n "$source_branch" ]] || wt_session_fail "Unable to determine the current source branch."
  [[ "$branch_name" != "$source_branch" ]] || wt_session_fail "Target branch must differ from the current branch."

  wt_session_require_clean_checkout "$source_root"

  if git -C "$primary_root" show-ref --verify --quiet "refs/heads/$branch_name"; then
    wt_session_fail "Branch already exists: $branch_name"
  fi

  worktree_name="$(wt_session_worktree_name "$branch_name")"
  worktree_path="$(wt_session_worktree_path "$primary_root" "$worktree_name")"
  manifest_path="$(wt_session_manifest_path "$primary_root" "$worktree_name")"

  [[ ! -e "$worktree_path" ]] || wt_session_fail "Worktree path already exists: $worktree_path"
  [[ ! -f "$manifest_path" ]] || wt_session_fail "Session manifest already exists: $manifest_path"

  trap '
    if (( cleanup_required == 1 )); then
      if [[ -n "$child_tmux_pane" ]] && command -v tmux >/dev/null 2>&1; then
        tmux list-panes -a -F "#{pane_id}" | grep -qx "$child_tmux_pane" && \
          tmux kill-pane -t "$child_tmux_pane" >/dev/null 2>&1 || true
      fi
      git -C "$primary_root" worktree remove "$worktree_path" --force >/dev/null 2>&1 || true
      git -C "$primary_root" branch -D "$branch_name" >/dev/null 2>&1 || true
      rm -f "$manifest_path"
    fi
  ' ERR

  mkdir -p "$primary_root/.worktrees" "$(wt_session_meta_dir "$primary_root")"

  git -C "$source_root" worktree add -b "$branch_name" "$worktree_path" HEAD
  cleanup_required=1

  "$primary_root/scripts/worktree-session-prepare.sh" "$worktree_path" "$branch_name"

  child_tmux_pane="$("$primary_root/scripts/start-droid-worktree.sh" "$worktree_path")"

  wt_session_write_env_file \
    "$manifest_path" \
    "WORKTREE_SESSION_SOURCE_BRANCH=${source_branch}" \
    "WORKTREE_SESSION_SOURCE_COMMIT=${source_commit}" \
    "WORKTREE_SESSION_BRANCH=${branch_name}" \
    "WORKTREE_SESSION_TARGET_BRANCH=${source_branch}" \
    "WORKTREE_SESSION_WORKTREE_NAME=${worktree_name}" \
    "WORKTREE_SESSION_WORKTREE_PATH=${worktree_path}" \
    "WORKTREE_SESSION_PRIMARY_REPO_ROOT=${primary_root}" \
    "WORKTREE_SESSION_PARENT_TMUX_SESSION=${parent_tmux_session}" \
    "WORKTREE_SESSION_PARENT_TMUX_PANE=${parent_tmux_pane}" \
    "WORKTREE_SESSION_TMUX_SESSION=${parent_tmux_session}" \
    "WORKTREE_SESSION_TMUX_PANE=${child_tmux_pane}" \
    "WORKTREE_SESSION_CREATED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  cleanup_required=0
}

main "$@"
