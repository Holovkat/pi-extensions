#!/usr/bin/env bash
# install-pif.sh — Install pif globally so any project can use it as the host environment.
#
# Usage: ./scripts/install-pif.sh
#
# Prerequisites: flutter on PATH (for `flutter pub get` in the global app).
#
# Installs:
#   ~/.pi/pif/app/        Flutter shell (shared across projects)
#   ~/.pi/agent/extensions/pif.ts + pif-shared.ts  Hub extension
#
# After install, run `pi` in any project directory and type /pif to launch the shell.

set -euo pipefail

if ! command -v flutter > /dev/null 2>&1; then
  echo "ERROR: flutter not found on PATH — the global app needs it for 'flutter pub get'."
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

GLOBAL_APP="$HOME/.pi/pif/app"
GLOBAL_EXT="$HOME/.pi/agent/extensions"

echo "Installing pif Flutter shell to $GLOBAL_APP ..."
mkdir -p "$GLOBAL_APP"
if [ -d "$GLOBAL_APP" ] && [ -n "$(ls -A "$GLOBAL_APP" 2>/dev/null)" ]; then
  BACKUP="$HOME/.pi/pif/app.bak-$(date +%Y%m%d-%H%M%S)"
  echo "  Existing install found — backing it up to $BACKUP before replacing."
  echo "  (rsync --delete would otherwise discard any local modifications.)"
  cp -R "$GLOBAL_APP" "$BACKUP"
fi
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
