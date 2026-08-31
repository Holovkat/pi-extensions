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
  if [ -n "${PIF_BUILDER_ROOT:-}" ]; then
    candidate="$PIF_BUILDER_ROOT/runtime/node"
    if ! version="$(pif_validate_node_runtime "$candidate")"; then
      echo "ERROR: The installed builder Node runtime is unsuitable; repair this builder kit." >&2
      return 1
    fi
  elif [ -n "${PIF_NODE_BIN:-}" ]; then
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

# Both builders use this explicit root contract. A kit never falls back to
# workstation Pi/Node; source checkout builds retain their documented lookup.
pif_select_build_resources() {
  local script_dir="$1" pi_command pi_real npm_global candidate
  PIF_SOURCE_ROOT="$(dirname "$script_dir")"
  if [ -z "${PIF_BUILDER_ROOT:-}" ] && [ -f "$PIF_SOURCE_ROOT/manifest.json" ]; then
    PIF_BUILDER_ROOT="$PIF_SOURCE_ROOT"
  fi
  if [ -n "${PIF_BUILDER_ROOT:-}" ]; then
    PIF_BUILDER_ROOT="$(cd "$PIF_BUILDER_ROOT" && pwd -P)"
    PIF_SOURCE_ROOT="$PIF_BUILDER_ROOT"
  fi
  pif_select_node_runtime || return 1
  PIF_BUILDER_HELPER="$script_dir/pif-builder-kit.mjs"
  if [ -n "${PIF_BUILDER_ROOT:-}" ]; then
    "$PIF_BUNDLE_NODE" "$PIF_BUILDER_HELPER" validate "$PIF_BUILDER_ROOT" "${PIF_BUILDER_VERSION:-}" > /dev/null || return 1
    PI_PKG_DIR="$PIF_BUILDER_ROOT/runtime/pi"
  else
    PI_PKG_DIR="${PI_PKG_DIR:-}"
    if [ -z "$PI_PKG_DIR" ]; then
      pi_command="$(command -v pi 2>/dev/null || true)"
      if [ -n "$pi_command" ]; then
        pi_real="$(readlink -f "$pi_command" 2>/dev/null || printf '%s' "$pi_command")"
        PI_PKG_DIR="$(dirname "$(dirname "$pi_real")")"
      fi
      if [ ! -f "$PI_PKG_DIR/dist/cli.js" ]; then
        npm_global="$(npm root -g 2>/dev/null || true)"
        for candidate in "$npm_global/@mariozechner/pi-coding-agent" "$npm_global/pi-coding-agent"; do
          if [ -n "$npm_global" ] && [ -f "$candidate/dist/cli.js" ]; then PI_PKG_DIR="$candidate"; break; fi
        done
      fi
    fi
    if [ ! -f "$PI_PKG_DIR/dist/cli.js" ]; then
      echo "ERROR: Pi CLI build input is missing. Set PI_PKG_DIR to the package containing dist/cli.js, or use an installed builder kit." >&2
      return 1
    fi
    PI_PKG_DIR="$(cd "$PI_PKG_DIR" && pwd -P)"
  fi
  PIF_APP_TEMPLATE_DIR="${PIF_APP_TEMPLATE_DIR:-$PIF_SOURCE_ROOT/pif}"
  PIF_APP_TEMPLATE_DIR="$(cd "$PIF_APP_TEMPLATE_DIR" && pwd -P)"
  for candidate in pubspec.yaml lib/main.dart lib/export_main.dart macos/Runner.xcodeproj/project.pbxproj; do
    if [ ! -f "$PIF_APP_TEMPLATE_DIR/$candidate" ]; then
      echo "ERROR: Complete Flutter/macOS app template required; missing $candidate." >&2
      return 1
    fi
  done
  export PIF_BUILDER_ROOT PIF_SOURCE_ROOT PIF_APP_TEMPLATE_DIR
}

# Start the copied dependency tree before publishing either app. A valid Node
# binary alone cannot detect missing package build/dist modules.
pif_validate_pi_runtime() {
  /usr/bin/env -i PATH=/usr/bin:/bin "$1" --input-type=module - "$1" "$2" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const [node, piRoot] = process.argv.slice(2);
const profile = fs.mkdtempSync('/tmp/pif-pi-smoke.');
try {
  const expected = JSON.parse(fs.readFileSync(path.join(piRoot, 'package.json'), 'utf8')).version;
  const result = spawnSync(node, [path.join(piRoot, 'dist/cli.js'), '--version'], {
    encoding: 'utf8', timeout: 15_000,
    env: { PATH: '/usr/bin:/bin', PI_CODING_AGENT_DIR: profile },
  });
  if (result.error || result.status !== 0 || !expected || result.stdout.trim() !== expected) {
    throw new Error(result.error?.message || result.stderr.trim() || `Expected Pi ${expected}; received ${result.stdout.trim() || `exit ${result.status}`}`);
  }
  process.stdout.write(`${result.stdout.trim()}\n`);
} catch (error) {
  console.error(`ERROR: Copied Pi runtime failed its clean --version smoke check: ${error.message}`);
  process.exitCode = 1;
} finally { fs.rmSync(profile, { recursive: true, force: true }); }
NODE
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
