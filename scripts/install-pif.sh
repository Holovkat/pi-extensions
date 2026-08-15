#!/usr/bin/env bash
# install-pif.sh — Install pif globally so any project can use it as the host environment.
#
# Usage: ./scripts/install-pif.sh
#
# Installs:
#   ~/.pi/pif/app/        Flutter shell (shared across projects)
#   ~/.pi/agent/extensions/pif.ts + pif-shared.ts  Hub extension
#
# After install, run `pi` in any project directory and type /pif to launch the shell.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

GLOBAL_APP="$HOME/.pi/pif/app"
GLOBAL_EXT="$HOME/.pi/agent/extensions"

echo "Installing pif Flutter shell to $GLOBAL_APP ..."
mkdir -p "$GLOBAL_APP"
rsync -a --delete \
  --exclude='.dart_tool' \
  --exclude='build' \
  --exclude='.flutter-plugins' \
  --exclude='.flutter-plugins-dependencies' \
  "$REPO_ROOT/pif/" "$GLOBAL_APP/"

echo "Installing pif hub extension to $GLOBAL_EXT ..."
mkdir -p "$GLOBAL_EXT"
cp "$REPO_ROOT/extensions/pif.ts" "$GLOBAL_EXT/pif.ts"
cp "$REPO_ROOT/extensions/pif-shared.ts" "$GLOBAL_EXT/pif-shared.ts"

echo "Running flutter pub get in global app ..."
cd "$GLOBAL_APP" && flutter pub get

echo ""
echo "pif installed successfully."
echo ""
echo "Usage:"
echo "  1. cd to any project directory"
echo "  2. run: pi"
echo "  3. type: /pif"
echo ""
echo "The Flutter shell will launch with your project as the workspace."
echo "Widget installs and layout persist per-project in .pi/pif/."
