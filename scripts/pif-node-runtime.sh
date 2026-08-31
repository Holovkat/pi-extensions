#!/usr/bin/env bash
# Shared by the stock and project exporters. Bundle one existing, portable
# macOS Node runtime, never a Homebrew binary plus its host dependency tree.
# PIF_NODE_BIN=/absolute/path/to/node selects an explicit runtime (no fallback).

pif_validate_node_runtime() {
  local binary="$1" architectures libraries dependency version count=0
  if [ ! -f "$binary" ] || [ ! -x "$binary" ]; then
    echo "Node runtime is not an executable file: $binary" >&2
    return 1
  fi
  if ! architectures="$(/usr/bin/lipo -archs "$binary" 2>/dev/null)"; then
    echo "Node runtime is not a macOS Mach-O binary: $binary" >&2
    return 1
  fi
  case " $architectures " in
    *" $(/usr/bin/uname -m) "*) ;;
    *) echo "Node runtime architecture '$architectures' cannot run on this build host: $binary" >&2; return 1 ;;
  esac
  if ! libraries="$(/usr/bin/otool -L "$binary" 2>/dev/null)"; then
    echo "Cannot inspect Node runtime dependencies: $binary" >&2
    return 1
  fi
  while IFS= read -r dependency; do
    count=$((count + 1))
    case "$dependency" in
      *'/../'*|*'/./'*) echo "Node runtime has a noncanonical dependency: $dependency ($binary)" >&2; return 1 ;;
      /usr/lib/*|/System/Library/*) ;;
      *) echo "Node runtime depends on a non-system library: $dependency ($binary)" >&2; return 1 ;;
    esac
  done < <(printf '%s\n' "$libraries" | /usr/bin/sed -n 's/^[[:space:]]*\(.*\) (compatibility version .*$/\1/p')
  if [ "$count" -eq 0 ]; then
    echo "No verifiable system dependencies found for Node runtime: $binary" >&2
    return 1
  fi
  # An empty environment removes every DYLD_* override and NODE_OPTIONS, so
  # the copied runtime cannot depend on the developer shell to start.
  if ! version="$(/usr/bin/env -i PATH=/usr/bin:/bin "$binary" --version 2>&1)"; then
    echo "Node runtime cannot start with a clean environment: $binary ($version)" >&2
    return 1
  fi
  # Bundled Pi requires >=22.19.0; pif also uses native TypeScript stripping.
  if [[ ! "$version" =~ ^v([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] ||
     (( BASH_REMATCH[1] < 22 || (BASH_REMATCH[1] == 22 && BASH_REMATCH[2] < 19) )); then
    echo "Node runtime must be a stable version >=22.19.0: $binary ($version)" >&2
    return 1
  fi
  printf '%s\n' "$version"
}

_pif_node_candidates() {
  local pi_command pi_real prefix directory
  local -a path_entries
  pi_command="$(command -v pi 2>/dev/null || true)"
  if [ -n "$pi_command" ]; then
    # Prefer the runtime installed alongside Pi, including version-manager
    # installs reached through a symlink from another bin directory.
    printf '%s/node\n' "$(dirname "$pi_command")"
    pi_real="$(readlink -f "$pi_command" 2>/dev/null || printf '%s' "$pi_command")"
    prefix="$(dirname "$pi_real")"
  else
    prefix=""
  fi
  for directory in "${PI_PKG_DIR:-}" "$prefix"; do
    while [ -n "$directory" ] && [ "$directory" != / ] && [ "$directory" != . ]; do
      [ ! -x "$directory/bin/node" ] || printf '%s/bin/node\n' "$directory"
      directory="$(dirname "$directory")"
    done
  done
  [ -z "${NVM_BIN:-}" ] || printf '%s/node\n' "$NVM_BIN"
  IFS=: read -r -a path_entries <<< "$PATH"
  for directory in "${path_entries[@]}"; do
    printf '%s/node\n' "${directory:-.}"
  done
}

pif_select_node_runtime() {
  local candidate version
  if [ -n "${PIF_NODE_BIN:-}" ]; then
    candidate="$PIF_NODE_BIN"
    if ! version="$(pif_validate_node_runtime "$candidate")"; then
      echo "ERROR: PIF_NODE_BIN is unsuitable; choose a standalone Node >=22.19.0 macOS binary for this architecture." >&2
      return 1
    fi
  else
    candidate=""
    while IFS= read -r candidate; do
      [ -x "$candidate" ] || continue
      if version="$(pif_validate_node_runtime "$candidate")"; then
        break
      fi
      candidate=""
    done < <(_pif_node_candidates)
    if [ -z "$candidate" ] || [ ! -x "$candidate" ]; then
      echo "ERROR: No portable Node runtime found beside Pi or on PATH. Set PIF_NODE_BIN to an existing standalone macOS Node >=22.19.0 binary (for example an nvm installation). Homebrew-linked runtimes cannot be bundled alone." >&2
      return 1
    fi
  fi
  # Anchor relative overrides/PATH entries before either builder changes cwd.
  PIF_BUNDLE_NODE="$(cd "$(dirname "$candidate")" && pwd -P)/$(basename "$candidate")"
  PIF_BUNDLE_NODE_VERSION="$version"
}

pif_bundle_node_runtime() {
  local destination="$1" copied_version
  cp -L "$PIF_BUNDLE_NODE" "$destination" || return 1
  chmod 755 "$destination" || return 1
  if ! copied_version="$(pif_validate_node_runtime "$destination")"; then
    echo "ERROR: Bundled Node failed portability/startup verification: $destination" >&2
    return 1
  fi
  if [ "$copied_version" != "$PIF_BUNDLE_NODE_VERSION" ]; then
    echo "ERROR: Node runtime changed during packaging; rerun the build." >&2
    return 1
  fi
}
