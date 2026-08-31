#!/usr/bin/env bash
# build-pif-project-app.sh — Export a pif project as a standalone macOS .app
# (task #159). Parameterises the proven build-pif-app.sh stages: the Flutter
# shell is built with the project's widget set staged into the app source and
# a pinned registry, so the exported app runs the compiled app without the
# project picker, straight to its home page.
#
# Usage: ./scripts/build-pif-project-app.sh <project-dir> [app-name] [output-dir]
#
#   <project-dir>  a workspace containing pif_app/app.yaml (the manifest)
#   [app-name]     display name override (default: manifest name)
#   [output-dir]   default: <project-dir>/build
#
# Secrets policy: the bundle ships without dev models.json, settings.json,
# .env files, or API keys — models are provisioned on the target machine at
# first run. The scan below fails the export if credential-shaped material is
# found and only reports file paths plus credential classes, never raw values.
#
# AOT limitation: the widget set is frozen at export time (compiled into the
# binary). Runtime widget installs do not apply to exported apps; rebuild to
# change the widget set.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
PROJECT_DIR="$(cd "$1" && pwd)"
APP_NAME="${2:-}"
OUTPUT_DIR="${3:-$PROJECT_DIR/build}"

MANIFEST="$PROJECT_DIR/pif_app/app.yaml"
if [ ! -f "$MANIFEST" ]; then
  echo "ERROR: $MANIFEST not found — this project has no app model (run pif_app_init first)."
  exit 1
fi

echo "=== Exporting pif project app ==="

# Resolve id/name/version from the manifest with the hub's own parser.
MANIFEST_JSON="$(node --experimental-strip-types -e "
import { parseAppManifest } from '$REPO_ROOT/extensions/pif-shared.ts';
import fs from 'node:fs';
const parsed = parseAppManifest(fs.readFileSync('$MANIFEST', 'utf8'));
if (parsed.error) { console.error(parsed.error); process.exit(1); }
console.log(JSON.stringify(parsed.manifest));
")"
if [ -z "$MANIFEST_JSON" ]; then echo "ERROR: manifest parse failed."; exit 1; fi
APP_ID="$(printf '%s' "$MANIFEST_JSON" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).id))")"
MANIFEST_NAME="$(printf '%s' "$MANIFEST_JSON" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).name))")"
APP_NAME="${APP_NAME:-$MANIFEST_NAME}"

scan_export_bundle_for_secrets() {
  local bundle_root="$1"
  ROOT="$bundle_root" node --input-type=module <<'NODE'
import fs from 'node:fs';
import path from 'node:path';

const root = process.env.ROOT;
if (!root) {
  console.error('ERROR: secret scan root missing.');
  process.exit(1);
}

const fileNameRules = [
  { label: 'models.json', test: (name) => name === 'models.json' },
  { label: 'settings.json', test: (name) => name === 'settings.json' },
  { label: '.env', test: (name) => name === '.env' },
];

const textRules = [
  { label: 'generic-sk-token', regex: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { label: 'github-token', regex: /\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{36,})\b/ },
  { label: 'aws-access-key', regex: /\b(?:AKIA|ASIA|AIDA|AROA|ANPA|ANVA|AGPA|ACCA|ABIA|A3T)[A-Z0-9]{16}\b/ },
  { label: 'google-api-key', regex: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { label: 'google-oauth-token', regex: /\bya29\.[0-9A-Za-z_-]+\b/ },
];

const hits = [];
const seen = new Set();
const visitedDirs = new Set();
const visitedFiles = new Set();
const rootReal = fs.realpathSync(root);
const rootPrefix = rootReal.endsWith(path.sep) ? rootReal : `${rootReal}${path.sep}`;

function ensureUnderRoot(targetPath, sourcePath) {
  let resolvedTarget;
  try {
    resolvedTarget = fs.realpathSync(targetPath);
  } catch (error) {
    console.error(`ERROR: secret scan could not resolve symlink target ${sourcePath}: ${error.message}`);
    process.exit(1);
  }
  if (resolvedTarget !== rootReal && !resolvedTarget.startsWith(rootPrefix)) {
    console.error(`ERROR: secret scan refuses symlink target outside the export bundle: ${sourcePath} -> ${resolvedTarget}`);
    process.exit(1);
  }
  return resolvedTarget;
}

function record(label, file) {
  const key = `${label}\u0000${file}`;
  if (seen.has(key)) return;
  seen.add(key);
  hits.push({ label, file });
}

function scanFile(file, logicalPath = file) {
  const base = path.basename(logicalPath);
  for (const rule of fileNameRules) {
    if (rule.test(base)) record(rule.label, logicalPath);
  }

  const canonical = ensureUnderRoot(file, logicalPath);
  if (visitedFiles.has(canonical)) return;
  visitedFiles.add(canonical);

  let buffer;
  try {
    buffer = fs.readFileSync(canonical);
  } catch (error) {
    console.error(`ERROR: secret scan could not read ${canonical}: ${error.message}`);
    process.exit(1);
  }

  if (buffer.includes(0)) return;

  const text = buffer.toString('utf8');
  for (const rule of textRules) {
    if (rule.regex.test(text)) record(rule.label, canonical);
  }
}

function walk(dir) {
  const canonical = ensureUnderRoot(dir, dir);
  if (visitedDirs.has(canonical)) return;
  visitedDirs.add(canonical);

  let entries;
  try {
    entries = fs.readdirSync(canonical, { withFileTypes: true });
  } catch (error) {
    console.error(`ERROR: secret scan could not read ${canonical}: ${error.message}`);
    process.exit(1);
  }

  for (const entry of entries) {
    const file = path.join(canonical, entry.name);
    if (entry.isSymbolicLink()) {
      const target = ensureUnderRoot(file, file);
      const stat = fs.statSync(target);
      if (stat.isDirectory()) {
        walk(target);
      } else if (stat.isFile()) {
        scanFile(target, file);
      }
    } else if (entry.isDirectory()) {
      walk(file);
    } else if (entry.isFile()) {
      scanFile(file);
    }
  }
}

walk(root);
hits.sort((left, right) => left.file.localeCompare(right.file) || left.label.localeCompare(right.label));

if (hits.length) {
  console.error('ERROR: credential-shaped material found in the export bundle:');
  for (const { label, file } of hits) {
    console.error(`  - ${label}: ${file}`);
  }
  console.error('Coverage: exact file names (models.json, settings.json, .env) plus GitHub/AWS/Google/token-shaped text scans.');
  console.error('False positives: redacted fixtures or docs that intentionally contain these shapes may trip the scan.');
  console.error('Unsupported: encrypted blobs, compressed archives, and binary-only secret payloads are not inspected.');
  process.exit(1);
}

console.log('    clean.');
NODE
}

STAGE="$OUTPUT_DIR/$APP_ID-stage"
rm -rf "$STAGE"
mkdir -p "$OUTPUT_DIR"

# 1. Stage the app source (fresh copy; excludes build state)
echo "1. Staging app source at $STAGE ..."
rsync -a \
  --exclude='.dart_tool' \
  --exclude='build' \
  --exclude='.flutter-plugins' \
  --exclude='.flutter-plugins-dependencies' \
  "$REPO_ROOT/pif/" "$STAGE/"

# 2. Pin the project's widget set into the staged app source
echo "2. Pinning project widgets into lib/widgets/ ..."
cp -R "$PROJECT_DIR/pif_app/widgets/" "$STAGE/lib/widgets/"

# 3. Generate the pinned registry over the staged widget set
echo "3. Generating the pinned widget registry ..."
node --experimental-strip-types -e "
import { parseWidgetManifest, generateWidgetRegistry } from '$REPO_ROOT/extensions/pif-shared.ts';
import fs from 'node:fs'; import path from 'node:path';
const root = '$STAGE/lib/widgets';
const manifests = [];
for (const entry of fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory())) {
  const file = path.join(root, entry.name, 'widget.yaml');
  if (!fs.existsSync(file)) continue;
  manifests.push({ ...parseWidgetManifest(fs.readFileSync(file, 'utf8')), core: false });
}
manifests.sort((a, b) => a.id.localeCompare(b.id));
fs.writeFileSync('$STAGE/lib/widget_registry.g.dart', generateWidgetRegistry(manifests));
console.log('   pinned ' + manifests.length + ' widgets');
"

# 4. Build the Flutter release binary from the staged source
echo "4. flutter pub get + build macos --release (staged) ..."
cd "$STAGE"
flutter pub get
flutter build macos --release

APP_BUNDLE="$STAGE/build/macos/Build/Products/Release/pif.app"
if [ ! -d "$APP_BUNDLE" ]; then echo "ERROR: staged build output missing."; exit 1; fi

# 5. Assemble the exported bundle
APP="$OUTPUT_DIR/$APP_NAME.app"
rm -rf "$APP"
cp -R "$APP_BUNDLE" "$APP"
RESOURCES="$APP/Contents/Resources"
mkdir -p "$RESOURCES/pi/cli" "$RESOURCES/pi/extensions" "$RESOURCES/app" "$RESOURCES/pif_app-manifest"
echo "5. Assembled $APP"

# 6. Bundle Node.js
if ! NODE_BIN="$(command -v node)"; then echo "ERROR: node not found on PATH."; exit 1; fi
echo "6. Bundling Node.js $(node --version) ..."
cp "$NODE_BIN" "$RESOURCES/pi/node"

# 7. Bundle pi CLI (same resolution as the stock build)
if ! PI_SYMLINK="$(command -v pi)"; then echo "ERROR: pi not found on PATH."; exit 1; fi
PI_PKG_DIR="${PI_PKG_DIR:-}"
if [ -z "$PI_PKG_DIR" ]; then
  PI_REAL="$(readlink -f "$PI_SYMLINK" 2>/dev/null || echo "$PI_SYMLINK")"
  PI_PKG_DIR="$(dirname "$(dirname "$PI_REAL")")"
  if [ ! -f "$PI_PKG_DIR/dist/cli.js" ]; then
    NPM_GLOBAL="$(npm root -g 2>/dev/null || true)"
    for CANDIDATE in "$NPM_GLOBAL/@mariozechner/pi-coding-agent" "$NPM_GLOBAL/pi-coding-agent"; do
      if [ -n "$NPM_GLOBAL" ] && [ -f "$CANDIDATE/dist/cli.js" ]; then PI_PKG_DIR="$CANDIDATE"; break; fi
    done
  fi
fi
if [ ! -f "$PI_PKG_DIR/dist/cli.js" ]; then echo "ERROR: could not locate the pi package directory."; exit 1; fi
echo "7. Bundling pi CLI from $PI_PKG_DIR ..."
# Keep runtime JS/assets, but skip TypeScript declaration files: historical
# packages carry example-shaped text in non-runtime *.d.ts files that should
# not enter the exported bundle.
rsync -a \
  --exclude='*.d.ts' \
  "$PI_PKG_DIR/" \
  "$RESOURCES/pi/cli/"

# 8. Bundle pif extensions (hub runtime)
echo "8. Bundling pif extensions ..."
cp "$REPO_ROOT/extensions/pif.ts" "$RESOURCES/pi/extensions/pif.ts"
cp "$REPO_ROOT/extensions/pif-shared.ts" "$RESOURCES/pi/extensions/pif-shared.ts"

# 9. Bundle the staged app source — includes the project widgets and the
#    pinned registry (the hub scans this tree for base widgets).
echo "9. Bundling app source ..."
rsync -a \
  --exclude='.dart_tool' \
  --exclude='build' \
  --exclude='.flutter-plugins' \
  --exclude='.flutter-plugins-dependencies' \
  --exclude='macos' \
  --exclude='test' \
  "$STAGE/" "$RESOURCES/app/"

# 10. Ship the app manifest for first-run workspace bootstrap
echo "10. Bundling the app manifest ..."
cp "$MANIFEST" "$RESOURCES/pif_app-manifest/app.yaml"

# 11. Launcher: exported apps boot straight into their workspace — no
#     project picker. First run provisions the workspace from the bundle.
echo "11. Writing the exported-app launcher ..."
mv "$APP/Contents/MacOS/pif" "$APP/Contents/MacOS/pif.bin"
APP_SUPPORT="$HOME/Library/Application Support/pif-apps/$APP_ID"
cat > "$APP/Contents/MacOS/pif" << LAUNCHER
#!/usr/bin/env bash
DIR="\$(cd "\$(dirname "\$0")" && pwd)"
WS="\$HOME/Library/Application Support/pif-apps/$APP_ID"
mkdir -p "\$WS/pif_app"
[ -f "\$WS/pif_app/app.yaml" ] || cp "\$DIR/../Resources/pif_app-manifest/app.yaml" "\$WS/pif_app/app.yaml"
export PIF_EXPORTED=1
export PIF_WORKSPACE="\$WS"
export PIF_APP_DIR="\$DIR/../Resources/app"
exec "\$DIR/pif.bin"
LAUNCHER
chmod +x "$APP/Contents/MacOS/pif"

# 12. Re-sign (resource insertion invalidated the release signature)
echo "12. Re-signing ..."
ENTITLEMENTS="$(mktemp /tmp/pif-export-ent.XXXXXX.plist)"
if codesign -d --entitlements :- "$APP" > /dev/null 2>&1 && \
   codesign -d --entitlements :- "$APP" 2>/dev/null | grep -q '\.'; then
  codesign -d --entitlements :- "$APP" 2>/dev/null | tr -d '\0' > "$ENTITLEMENTS"
  codesign --force --deep --sign - --entitlements "$ENTITLEMENTS" "$APP"
else
  codesign --force --deep --sign - "$APP"
fi
rm -f "$ENTITLEMENTS"
if ! codesign --verify --deep --strict "$APP"; then echo "ERROR: codesign verification failed for $APP"; exit 1; fi

# 13. Secrets scan: fail closed on bundled credential-shaped material.
#    Coverage: exact file names (models.json, settings.json, .env) plus
#    GitHub/AWS/Google/token-shaped text scans.
#    False positives: redacted fixtures or docs that intentionally contain
#    these shapes may trip the scan.
#    Unsupported: encrypted blobs, compressed archives, and binary-only
#    secret payloads are not inspected.
echo "13. Secrets scan ..."
scan_export_bundle_for_secrets "$RESOURCES"

# 14. Summary
echo ""
echo "=== Export complete ==="
echo "  App: $APP"
echo "  Size: $(du -sh "$APP" | cut -f1)"
echo "  Home page: $MANIFEST-home (from app.yaml: home)"
echo ""
echo "First run: the app boots straight to its home page (no picker)."
echo "Models are provisioned on first run on the target machine — place a"
echo "models.json in:"
echo "  $APP_SUPPORT/.pi/"
echo ""
echo "AOT limitation: the widget set is frozen at export time; rebuild to"
echo "change it. The stock pif.app build path is unchanged."
