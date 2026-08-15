#!/usr/bin/env bash
# build-pif-app.sh — Build a self-contained macOS .app that bundles
# the Flutter shell + Node.js + pi CLI + pif extensions.
#
# Usage: ./scripts/build-pif-app.sh [output-dir]
#
# Produces: <output-dir>/pif.app  (default: build/)
#
# The resulting .app can be dragged to /Applications and launched
# by double-clicking. No external dependencies required (Node.js
# and pi are bundled inside the .app).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="${1:-$REPO_ROOT/build}"

echo "=== Building pif macOS app ==="

# 1. Build the Flutter release binary
echo "1. flutter build macos --release ..."
cd "$REPO_ROOT/pif"
flutter build macos --release

APP_BUNDLE="$REPO_ROOT/pif/build/macos/Build/Products/Release/pif.app"

if [ ! -d "$APP_BUNDLE" ]; then
  echo "ERROR: Build output not found at $APP_BUNDLE"
  exit 1
fi

# 2. Copy to output directory
mkdir -p "$OUTPUT_DIR"
if [ -d "$OUTPUT_DIR/pif.app" ]; then
  rm -rf "$OUTPUT_DIR/pif.app"
fi
cp -R "$APP_BUNDLE" "$OUTPUT_DIR/"
APP="$OUTPUT_DIR/pif.app"
echo "2. Copied to $APP"

RESOURCES="$APP/Contents/Resources"
mkdir -p "$RESOURCES/pi/extensions"
mkdir -p "$RESOURCES/app"

# 3. Bundle Node.js binary
NODE_BIN="$(which node)"
NODE_VERSION="$(node --version)"
echo "3. Bundling Node.js $NODE_VERSION from $NODE_BIN ..."
cp "$NODE_BIN" "$RESOURCES/pi/node"

# 4. Bundle pi CLI
PI_SYMLINK="$(which pi)"
PI_REAL="$(readlink -f "$PI_SYMLINK")"
PI_PKG_DIR="$(dirname "$(dirname "$PI_REAL")")"  # .../pi-coding-agent
echo "4. Bundling pi CLI from $PI_PKG_DIR ..."
cp -R "$PI_PKG_DIR" "$RESOURCES/pi/cli"

# 5. Bundle pif extensions
echo "5. Bundling pif extensions ..."
cp "$REPO_ROOT/extensions/pif.ts" "$RESOURCES/pi/extensions/pif.ts"
cp "$REPO_ROOT/extensions/pif-shared.ts" "$RESOURCES/pi/extensions/pif-shared.ts"

# 6. Bundle Flutter app source (for widget scanning and catalog)
echo "6. Bundling Flutter app source ..."
rsync -a \
  --exclude='.dart_tool' \
  --exclude='build' \
  --exclude='.flutter-plugins' \
  --exclude='.flutter-plugins-dependencies' \
  --exclude='macos' \
  --exclude='test' \
  "$REPO_ROOT/pif/" "$RESOURCES/app/"

# 7. Summary
echo ""
echo "=== Build complete ==="
echo "  App: $APP"
echo "  Size: $(du -sh "$APP" | cut -f1)"
echo ""
echo "To install: cp -R $APP /Applications/"
echo "To run: open $APP"
echo ""
echo "The app will show a project picker on first launch. Select a"
echo "project folder and pif will start pi and connect automatically."
