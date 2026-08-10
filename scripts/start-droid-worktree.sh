#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/worktree-session-lib.sh"

usage() {
  cat <<'EOF'
Usage: ./scripts/start-droid-worktree.sh [worktree-path|worktree-name]

Splits the current tmux view, reuses an existing worktree pane if available, and launches Droid there.
This helper must be run from inside tmux.
EOF
}

resolve_target_path() {
  local primary_root="${1:?primary root required}"
  local input="${2:-}"
  local candidate

  if [[ -z "$input" ]]; then
    candidate="$PWD"
  elif [[ -d "$input" ]]; then
    candidate="$(cd "$input" && pwd -P)"
  elif [[ -d "$primary_root/.worktrees/$input" ]]; then
    candidate="$(cd "$primary_root/.worktrees/$input" && pwd -P)"
  else
    wt_session_fail "Worktree not found: ${input}. Pass a worktree path or a folder name under $primary_root/.worktrees."
  fi

  printf '%s\n' "$candidate"
}

main() {
  local requested_target="${1:-}"
  local repo_root
  local primary_root
  local target_path
  local worktree_root
  local prepared_file
  local worktree_name
  local manifest_path
  local parent_session
  local parent_pane
  local pane_id

  case "$requested_target" in
    -h|--help)
      usage
      exit 0
      ;;
  esac

  wt_session_require_tmux_session
  wt_session_require_command droid

  repo_root="$(wt_session_repo_root "$PWD")"
  primary_root="$(wt_session_primary_root "$repo_root")"
  target_path="$(resolve_target_path "$primary_root" "$requested_target")"
  worktree_root="$(git -C "$target_path" rev-parse --show-toplevel 2>/dev/null)" || wt_session_fail "\"$target_path\" is not a git checkout."

  if [[ "$worktree_root" == "$primary_root" ]]; then
    wt_session_fail "Refusing to start Droid in the primary checkout. Use an isolated worktree."
  fi

  prepared_file="$(wt_session_prepared_file "$worktree_root")"
  [[ -f "$prepared_file" ]] || wt_session_fail "Worktree session not prepared. Run scripts/worktree-session-prepare.sh first."

  worktree_name="$(basename "$worktree_root")"
  manifest_path="$(wt_session_manifest_path "$primary_root" "$worktree_name")"
  parent_session="$(wt_session_current_tmux_session)"
  parent_pane="$(wt_session_current_tmux_pane)"

  if [[ -f "$manifest_path" ]]; then
    # shellcheck disable=SC1090
    source "$manifest_path"
    if [[ -n "${WORKTREE_SESSION_TMUX_PANE:-}" ]] && tmux list-panes -a -F '#{pane_id}' | grep -qx "$WORKTREE_SESSION_TMUX_PANE"; then
      tmux select-pane -t "$WORKTREE_SESSION_TMUX_PANE"
      printf '%s\n' "$WORKTREE_SESSION_TMUX_PANE"
      exit 0
    fi
  fi

  pane_id="$(tmux split-window -h -c "$worktree_root" -P -F '#{pane_id}')"
  tmux send-keys -t "$pane_id" "clear" C-m
  tmux send-keys -t "$pane_id" "pwd" C-m
  tmux send-keys -t "$pane_id" "droid" C-m

  if [[ -f "$manifest_path" ]]; then
    wt_session_upsert_env_value "$manifest_path" "WORKTREE_SESSION_PARENT_TMUX_SESSION" "$parent_session"
    wt_session_upsert_env_value "$manifest_path" "WORKTREE_SESSION_PARENT_TMUX_PANE" "$parent_pane"
    wt_session_upsert_env_value "$manifest_path" "WORKTREE_SESSION_TMUX_SESSION" "$parent_session"
    wt_session_upsert_env_value "$manifest_path" "WORKTREE_SESSION_TMUX_PANE" "$pane_id"
  fi

  printf '%s\n' "$pane_id"
}

main "$@"
