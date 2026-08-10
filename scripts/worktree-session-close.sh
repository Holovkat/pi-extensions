#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/worktree-session-lib.sh"

usage() {
  cat <<'EOF'
Usage: ./scripts/worktree-session-close.sh [worktree-path]

Merges the current session branch back into its recorded parent branch and cleans
up the isolated worktree, tmux pane, and local branch.
EOF
}

main() {
  local current_root="${1:-}"
  local primary_root
  local worktree_name
  local manifest_path
  local current_branch
  local cleanup_script

  case "$current_root" in
    -h|--help)
      usage
      exit 0
      ;;
    "")
      current_root="$PWD"
      ;;
  esac

  current_root="$(wt_session_repo_root "$current_root")"
  primary_root="$(wt_session_primary_root "$current_root")"

  if [[ "$current_root" == "$primary_root" ]]; then
    wt_session_fail "Run this command from the isolated worktree checkout you want to close."
  fi

  worktree_name="$(basename "$current_root")"
  manifest_path="$(wt_session_manifest_path "$primary_root" "$worktree_name")"
  [[ -f "$manifest_path" ]] || wt_session_fail "Missing session manifest: $manifest_path"

  # shellcheck disable=SC1090
  source "$manifest_path"

  current_branch="$(git -C "$current_root" branch --show-current)"
  [[ "$current_branch" == "$WORKTREE_SESSION_BRANCH" ]] || wt_session_fail "Expected session branch $WORKTREE_SESSION_BRANCH but found $current_branch"

  wt_session_require_clean_checkout "$current_root"
  wt_session_require_clean_checkout "$primary_root"

  git -C "$current_root" rebase "$WORKTREE_SESSION_TARGET_BRANCH"
  git -C "$primary_root" checkout "$WORKTREE_SESSION_TARGET_BRANCH" >/dev/null
  git -C "$primary_root" merge --ff-only "$WORKTREE_SESSION_BRANCH"

  cleanup_script="$current_root/scripts/worktree-project-cleanup.sh"
  if [[ -x "$cleanup_script" ]]; then
    "$cleanup_script" "$current_root"
  fi

  if command -v tmux >/dev/null 2>&1; then
    if [[ -n "${WORKTREE_SESSION_PARENT_TMUX_PANE:-}" ]] && tmux list-panes -a -F '#{pane_id}' | grep -qx "$WORKTREE_SESSION_PARENT_TMUX_PANE"; then
      tmux select-pane -t "$WORKTREE_SESSION_PARENT_TMUX_PANE" >/dev/null 2>&1 || true
    elif [[ -n "${WORKTREE_SESSION_PARENT_TMUX_SESSION:-}" ]] && [[ -n "${TMUX:-}" ]]; then
      tmux has-session -t "$WORKTREE_SESSION_PARENT_TMUX_SESSION" 2>/dev/null && \
        tmux switch-client -t "$WORKTREE_SESSION_PARENT_TMUX_SESSION" >/dev/null 2>&1 || true
    fi
  fi

  if command -v tmux >/dev/null 2>&1; then
    if [[ -n "${WORKTREE_SESSION_TMUX_PANE:-}" ]] && tmux list-panes -a -F '#{pane_id}' | grep -qx "$WORKTREE_SESSION_TMUX_PANE"; then
      tmux kill-pane -t "$WORKTREE_SESSION_TMUX_PANE" >/dev/null 2>&1 || true
    elif [[ -n "${WORKTREE_SESSION_TMUX_SESSION:-}" ]]; then
      tmux has-session -t "$WORKTREE_SESSION_TMUX_SESSION" 2>/dev/null && \
        tmux kill-session -t "$WORKTREE_SESSION_TMUX_SESSION" >/dev/null 2>&1 || true
    fi
  fi

  cd "$primary_root"
  git -C "$primary_root" worktree remove "$WORKTREE_SESSION_WORKTREE_PATH" --force
  git -C "$primary_root" branch -d "$WORKTREE_SESSION_BRANCH"
  rm -f "$manifest_path"

  echo "Merged $WORKTREE_SESSION_BRANCH -> $WORKTREE_SESSION_TARGET_BRANCH"
  echo "Removed worktree: $WORKTREE_SESSION_WORKTREE_PATH"
}

main "$@"
