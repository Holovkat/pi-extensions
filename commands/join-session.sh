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

# shellcheck disable=SC1091
source "$REPO_ROOT/scripts/worktree-session-lib.sh"

usage() {
  cat <<'EOF'
Usage: /join-session [worktree-name|worktree-path]

List available isolated worktrees and reopen Droid in the selected tmux pane.
If a worktree argument is provided, it joins that worktree directly.
EOF
}

resolve_target_path() {
  local primary_root="${1:?primary root required}"
  local input="${2:-}"
  local candidate

  if [[ -z "$input" ]]; then
    printf '\n'
    return 0
  fi

  if [[ -d "$input" ]]; then
    candidate="$(cd "$input" && pwd -P)"
  elif [[ -d "$primary_root/.worktrees/$input" ]]; then
    candidate="$(cd "$primary_root/.worktrees/$input" && pwd -P)"
  else
    wt_session_fail "Worktree not found: ${input}. Pass a worktree path or a folder name under $primary_root/.worktrees."
  fi

  printf '%s\n' "$candidate"
}

choose_worktree_interactively() {
  local primary_root="${1:?primary root required}"
  local -a worktree_paths=()
  local -a options=()
  local candidate
  local branch_name
  local index

  shopt -s nullglob
  for candidate in "$primary_root"/.worktrees/*; do
    [[ -d "$candidate" ]] || continue
    [[ "$(basename "$candidate")" == "_meta" ]] && continue
    if git -C "$candidate" rev-parse --show-toplevel >/dev/null 2>&1; then
      worktree_paths+=("$candidate")
      branch_name="$(git -C "$candidate" branch --show-current 2>/dev/null || printf 'unknown')"
      options+=("$(basename "$candidate") [$branch_name]")
    fi
  done
  shopt -u nullglob

  ((${#worktree_paths[@]} > 0)) || wt_session_fail "No isolated worktrees are available under $primary_root/.worktrees."

  if ((${#worktree_paths[@]} == 1)); then
    printf '%s\n' "${worktree_paths[0]}"
    return 0
  fi

  echo "Available worktrees:" >&2
  PS3="Join which worktree? "
  select _option in "${options[@]}"; do
    index=$((REPLY - 1))
    if [[ -n "${_option:-}" ]] && ((index >= 0)) && ((index < ${#worktree_paths[@]})); then
      printf '%s\n' "${worktree_paths[$index]}"
      return 0
    fi
    echo "Invalid selection." >&2
  done
}

main() {
  local requested_target="${1:-}"
  local current_root
  local primary_root
  local target_path

  case "$requested_target" in
    -h|--help)
      usage
      exit 0
      ;;
  esac

  wt_session_require_tmux_session
  wt_session_require_command droid

  current_root="$(wt_session_repo_root "$PWD")"
  primary_root="$(wt_session_primary_root "$current_root")"
  target_path="$(resolve_target_path "$primary_root" "$requested_target")"

  if [[ -z "$target_path" ]]; then
    target_path="$(choose_worktree_interactively "$primary_root")"
  fi

  [[ -d "$target_path" ]] || wt_session_fail "Selected worktree folder does not exist: $target_path"
  git -C "$target_path" rev-parse --show-toplevel >/dev/null 2>&1 || \
    wt_session_fail "Selected folder is not a valid git worktree: $target_path"

  exec "$REPO_ROOT/scripts/start-droid-worktree.sh" "$target_path"
}

main "$@"
