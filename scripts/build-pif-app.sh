#!/usr/bin/env bash
# build-pif-app.sh — Build a self-contained macOS .app that bundles
# the Flutter shell + Node.js + pi CLI + pif extensions.
#
# Usage: ./scripts/build-pif-app.sh [output-dir]
#
# Produces: <output-dir>/pif.app  (default: build/)
# Runtime override: PIF_NODE_BIN=/path/to/standalone/node
#
# The resulting .app can be dragged to /Applications and launched
# by double-clicking. No external dependencies required (Node.js
# and pi are bundled inside the .app).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/pif-node-runtime.sh"
pif_select_build_resources "$SCRIPT_DIR"
REPO_ROOT="$PIF_SOURCE_ROOT"
if [ -n "${PIF_BUILDER_ROOT:-}" ]; then
  OUTPUT_DIR="${1:-$PWD/build}"
else
  OUTPUT_DIR="${1:-$REPO_ROOT/build}"
fi
OUTPUT_DIR="$("$PIF_BUNDLE_NODE" "$PIF_BUILDER_HELPER" writable "$OUTPUT_DIR" "${PIF_BUILDER_ROOT:-}")"

echo "=== Building pif macOS app ==="

# 1. Build the Flutter release binary
echo "1. flutter build macos --release ..."
BUILD_SOURCE="$PIF_APP_TEMPLATE_DIR"
if [ -n "${PIF_BUILDER_ROOT:-}" ]; then
  # Dependency restore/codegen/output must never touch the signed kit.
  mkdir -p "$OUTPUT_DIR"
  BUILD_SOURCE="$(mktemp -d "$OUTPUT_DIR/pif-source.XXXXXX")/pif"
  "$PIF_BUNDLE_NODE" "$PIF_BUILDER_HELPER" copy-source "$PIF_APP_TEMPLATE_DIR" "$BUILD_SOURCE" > /dev/null
fi
cd "$BUILD_SOURCE"
"${PIF_FLUTTER_BIN:-flutter}" pub get
"${PIF_FLUTTER_BIN:-flutter}" build macos --release

APP_BUNDLE="$BUILD_SOURCE/build/macos/Build/Products/Release/pif.app"

if [ ! -d "$APP_BUNDLE" ]; then
  echo "ERROR: Build output not found at $APP_BUNDLE"
  exit 1
fi

# 2. Assemble beside the final output; preserve the previous app until every
# packaging, signature and integrity check has passed.
mkdir -p "$OUTPUT_DIR"
FINAL_APP="$OUTPUT_DIR/pif.app"
ASSEMBLY_DIR="$(mktemp -d "$OUTPUT_DIR/.pif-assembly.XXXXXX")"
trap 'if [ -d "$ASSEMBLY_DIR" ]; then "$PIF_BUNDLE_NODE" "$PIF_BUILDER_HELPER" discard-assembly "$ASSEMBLY_DIR" "${PIF_BUILDER_ROOT:-}" > /dev/null || true; fi' EXIT
APP="$ASSEMBLY_DIR/pif.app"
cp -R "$APP_BUNDLE" "$APP"
echo "2. Staged $APP"

RESOURCES="$APP/Contents/Resources"
mkdir -p "$RESOURCES/pi/extensions"

# 3. Bundle Node.js binary
echo "3. Bundling Node.js $PIF_BUNDLE_NODE_VERSION from $PIF_BUNDLE_NODE ..."
pif_bundle_node_runtime "$RESOURCES/pi/node"

# 4. Bundle Pi from the exact selected build input.
echo "4. Bundling pi CLI from $PI_PKG_DIR ..."
mkdir -p "$RESOURCES/pi/cli"
rsync -a --exclude='*.d.ts' "$PI_PKG_DIR/" "$RESOURCES/pi/cli/"

# 5. Bundle pif extensions
echo "5. Bundling pif extensions ..."
for EXTENSION in "$REPO_ROOT"/extensions/pif*.ts; do
  case "$EXTENSION" in *.test.ts) continue ;; esac
  cp "$EXTENSION" "$RESOURCES/pi/extensions/"
done

# 6. Bundle Flutter app source (for widget scanning and catalog)
echo "6. Bundling Flutter app source ..."
PIF_BUILDER_ASSEMBLY=1 "$PIF_BUNDLE_NODE" "$PIF_BUILDER_HELPER" copy-runtime-source "$PIF_APP_TEMPLATE_DIR" "$RESOURCES/app" > /dev/null

# 6b. Complete, version-matched inputs for installed authoring and export.
echo "6b. Bundling the versioned builder kit ..."
pif_bundle_builder_kit "$RESOURCES/builder" > /dev/null
"$PIF_BUNDLE_NODE" "$PIF_BUILDER_HELPER" scan "$RESOURCES" > /dev/null

# 7. Re-sign the bundle: inserting resources invalidated the release
#    signature, and an invalid seal can make Apple Silicon refuse to
#    launch the app ("damaged"). Preserve entitlements if present.
echo "7. Re-signing app bundle ..."
ENTITLEMENTS="$(mktemp /tmp/pif-entitlements.XXXXXX.plist)"
if codesign -d --entitlements :- "$APP" > /dev/null 2>&1 && \
   codesign -d --entitlements :- "$APP" 2>/dev/null | grep -q '\.'; then
  codesign -d --entitlements :- "$APP" 2>/dev/null | tr -d '\0' > "$ENTITLEMENTS"
  codesign --force --deep --sign - --entitlements "$ENTITLEMENTS" "$APP"
else
  codesign --force --deep --sign - "$APP"
fi
PIF_BUILDER_ASSEMBLY=1 "$PIF_BUNDLE_NODE" "$PIF_BUILDER_HELPER" seal "$RESOURCES/builder" > /dev/null
if [ -s "$ENTITLEMENTS" ]; then
  codesign --force --sign - --entitlements "$ENTITLEMENTS" "$APP"
else
  codesign --force --sign - "$APP"
fi
rm -f "$ENTITLEMENTS"
"$PIF_BUNDLE_NODE" "$PIF_BUILDER_HELPER" validate "$RESOURCES/builder" > /dev/null
if ! codesign --verify --deep --strict "$APP"; then
  echo "ERROR: codesign verification failed for $APP"
  exit 1
fi
pif_validate_node_runtime "$RESOURCES/pi/node" > /dev/null
pif_validate_pi_runtime "$RESOURCES/builder/runtime/node" "$RESOURCES/builder/runtime/pi" > /dev/null

# Publish only the fully validated artifact. The helper safely removes
# read-only directories in the old owned output without following symlinks.
"$PIF_BUNDLE_NODE" "$PIF_BUILDER_HELPER" publish-app "$APP" "$FINAL_APP" "${PIF_BUILDER_ROOT:-}"
APP="$FINAL_APP"
RESOURCES="$APP/Contents/Resources"

# 8. Summary
echo ""
echo "=== Build complete ==="
echo "  App: $APP"
echo "  Size: $(du -sh "$APP" | cut -f1)"
echo ""
echo "To install: quit pif and move any existing /Applications/pif.app aside first."
echo "Then: ditto $OUTPUT_DIR/pif.app /Applications/pif.app"
echo "To run: open /Applications/pif.app"
echo ""
echo "The app will show a project picker on first launch. Select a"
echo "project folder and pif will start pi and connect automatically."
