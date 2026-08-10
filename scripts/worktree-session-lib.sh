#!/usr/bin/env bash

if [ "${WT_SESSION_LIB_LOADED:-0}" = "1" ]; then
  return 0 2>/dev/null || exit 0
fi
WT_SESSION_LIB_LOADED=1

wt_session_fail() {
  echo "Error: $*" >&2
  exit 1
}

wt_session_repo_root() {
  local path="${1:-$PWD}"
  git -C "$path" rev-parse --show-toplevel 2>/dev/null || wt_session_fail "Unable to resolve git repository root from $path"
}

wt_session_primary_root() {
  local repo_root="${1:?repo root required}"
  local common_dir

  common_dir="$(git -C "$repo_root" rev-parse --git-common-dir 2>/dev/null || printf '%s/.git\n' "$repo_root")"
  if [[ "$common_dir" != /* ]]; then
    common_dir="$repo_root/$common_dir"
  fi

  cd "$common_dir/.." && pwd -P
}

wt_session_sanitize() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-'
}

wt_session_current_tmux_session() {
  if [[ -z "${TMUX:-}" ]]; then
    return 1
  fi

  tmux display-message -p '#S'
}

wt_session_current_tmux_pane() {
  if [[ -z "${TMUX:-}" ]]; then
    return 1
  fi

  tmux display-message -p '#{pane_id}'
}

wt_session_require_tmux_session() {
  command -v tmux >/dev/null 2>&1 || wt_session_fail "tmux is not installed or not on PATH."

  if [[ -z "${TMUX:-}" ]]; then
    cat >&2 <<'EOF'
This workflow must be started from inside tmux.
Exit the current Droid session, start tmux first, then rerun the command.
EOF
    exit 1
  fi
}

wt_session_require_command() {
  local command_name="${1:?command required}"
  command -v "$command_name" >/dev/null 2>&1 || wt_session_fail "$command_name is not installed or not on PATH."
}

wt_session_require_clean_checkout() {
  local repo_root="${1:?repo root required}"
  local status

  status="$(git -C "$repo_root" status --porcelain)"
  if [[ -n "$status" ]]; then
    echo "Checkout is not clean:" >&2
    echo "$status" >&2
    wt_session_fail "Commit or stash changes before using the worktree session workflow."
  fi
}

wt_session_worktree_name() {
  local branch_name="${1:?branch name required}"
  local sanitized

  sanitized="$(wt_session_sanitize "$branch_name")"
  sanitized="${sanitized%-}"
  [[ -n "$sanitized" ]] || wt_session_fail "Unable to derive worktree name from branch $branch_name"
  printf '%s\n' "$sanitized"
}

wt_session_worktree_path() {
  local primary_root="${1:?primary root required}"
  local worktree_name="${2:?worktree name required}"
  printf '%s/.worktrees/%s\n' "$primary_root" "$worktree_name"
}

wt_session_meta_dir() {
  local primary_root="${1:?primary root required}"
  printf '%s/.worktrees/_meta\n' "$primary_root"
}

wt_session_manifest_path() {
  local primary_root="${1:?primary root required}"
  local worktree_name="${2:?worktree name required}"
  printf '%s/%s.env\n' "$(wt_session_meta_dir "$primary_root")" "$worktree_name"
}

wt_session_prepared_file() {
  local worktree_root="${1:?worktree root required}"
  printf '%s/.worktree-session/prepared.env\n' "$worktree_root"
}

wt_session_write_env_file() {
  local output_path="${1:?output path required}"
  shift
  local key
  local value

  mkdir -p "$(dirname "$output_path")"
  : >"$output_path"

  while (($#)); do
    key="${1%%=*}"
    value="${1#*=}"
    printf 'export %s=%q\n' "$key" "$value" >>"$output_path"
    shift
  done
}

wt_session_upsert_env_value() {
  local file_path="${1:?file path required}"
  local key="${2:?key required}"
  local value="${3:-}"

  python3 - "$file_path" "$key" "$value" <<'PY'
from pathlib import Path
import shlex
import sys

path = Path(sys.argv[1])
key = sys.argv[2]
value = sys.argv[3]

lines = path.read_text().splitlines() if path.exists() else []
out = []
seen = False

for line in lines:
    if line.startswith(f"export {key}=") or line.startswith(f"{key}="):
        out.append(f"export {key}={shlex.quote(value)}")
        seen = True
    else:
        out.append(line)

if not seen:
    out.append(f"export {key}={shlex.quote(value)}")

path.write_text("\n".join(out) + "\n")
PY
}
