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
GLOBAL_CATALOG_DIR="${PIF_GLOBAL_CATALOG:-$HOME/.pi/pif/catalog}"

MANIFEST="$PROJECT_DIR/pif_app/app.yaml"
if [ ! -f "$MANIFEST" ]; then
  echo "ERROR: $MANIFEST not found — this project has no app model (run pif_app_init first)."
  exit 1
fi

echo "=== Exporting pif project app ==="

# Resolve id/name/version from the manifest with the hub's own parser.
MANIFEST_JSON="$(
REPO_ROOT="$REPO_ROOT" MANIFEST="$MANIFEST" node --experimental-strip-types <<'NODE'
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = process.env.REPO_ROOT;
const manifestPath = process.env.MANIFEST;
if (!repoRoot || !manifestPath) {
  console.error("ERROR: manifest parse environment missing.");
  process.exit(1);
}

const shared = await import(pathToFileURL(path.join(repoRoot, "extensions", "pif-shared.ts")).href);
const parsed = shared.parseAppManifest(fs.readFileSync(manifestPath, "utf8"));
if (parsed.error) {
  console.error(parsed.error);
  process.exit(1);
}
process.stdout.write(JSON.stringify(parsed.manifest));
NODE
)"
if [ -z "$MANIFEST_JSON" ]; then echo "ERROR: manifest parse failed."; exit 1; fi
APP_ID="$(printf '%s' "$MANIFEST_JSON" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).id))")"
MANIFEST_NAME="$(printf '%s' "$MANIFEST_JSON" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).name))")"
APP_NAME="${APP_NAME:-$MANIFEST_NAME}"

# Resolve the widget dependencies before any stage copy. The shared helper
# validates widget ids, rejects duplicates/missing/unavailable ids, and
# returns the selected source for each dependency so the export can materialize
# the pinned set deterministically.
RESOLVED_WIDGETS_JSON="$(
REPO_ROOT="$REPO_ROOT" MANIFEST_JSON="$MANIFEST_JSON" PROJECT_WIDGETS_DIR="$PROJECT_DIR/pif_app/widgets" GLOBAL_CATALOG_DIR="$GLOBAL_CATALOG_DIR" node --experimental-strip-types <<'NODE'
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = process.env.REPO_ROOT;
const manifestJson = process.env.MANIFEST_JSON;
const projectWidgetsDir = process.env.PROJECT_WIDGETS_DIR;
const globalCatalogDir = process.env.GLOBAL_CATALOG_DIR;
if (!repoRoot || !manifestJson || !projectWidgetsDir || !globalCatalogDir) {
  console.error("ERROR: required widget resolution environment missing.");
  process.exit(1);
}

const shared = await import(pathToFileURL(path.join(repoRoot, "extensions", "pif-shared.ts")).href);
const manifest = JSON.parse(manifestJson);
const resolution = shared.resolveRequiredWidgetSet(manifest.dependencies ?? [], {
  project: [projectWidgetsDir],
  catalog: [globalCatalogDir],
  base: [path.join(repoRoot, "pif", "lib", "widgets"), path.join(repoRoot, "pif", "catalog")],
});
if (!resolution.ok) {
  console.error("ERROR: required widget resolution failed before staging:");
  console.error(shared.formatWidgetResolutionProblems(resolution.problems));
  process.exit(1);
}
process.stdout.write(JSON.stringify(resolution));
NODE
)"

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

# 2b. Materialize the resolved required widgets and persist the pinned set
#     inside the staged app source before registry generation.
echo "2b. Materializing resolved required widgets ..."
RESOLVED_WIDGETS_JSON="$RESOLVED_WIDGETS_JSON" STAGE="$STAGE" node --experimental-strip-types <<'NODE'
import fs from "node:fs";
import path from "node:path";

const stage = process.env.STAGE;
const raw = process.env.RESOLVED_WIDGETS_JSON;
if (!stage || !raw) {
  console.error("ERROR: required widget materialization environment missing.");
  process.exit(1);
}

const resolution = JSON.parse(raw);
const widgetsRoot = path.join(stage, "lib", "widgets");
fs.mkdirSync(widgetsRoot, { recursive: true });
for (const widget of resolution.resolved ?? []) {
  if (widget.source === "project") continue;
  const target = path.join(widgetsRoot, widget.id);
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(widget.directory, target, { recursive: true });
}
const pinnedDir = path.join(stage, "pif_app-manifest");
fs.mkdirSync(pinnedDir, { recursive: true });
fs.writeFileSync(path.join(pinnedDir, "required-widgets.json"), JSON.stringify(resolution, null, 2) + "\n");
console.log(`   pinned ${resolution.resolved?.length ?? 0} required widgets`);
NODE

# 3. Generate the pinned registry over the staged widget set
echo "3. Generating the pinned widget registry ..."
STAGE_WIDGET_ROOT="$STAGE/lib/widgets" REPO_ROOT="$REPO_ROOT" node --experimental-strip-types <<'NODE'
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = process.env.REPO_ROOT;
const root = process.env.STAGE_WIDGET_ROOT;
if (!repoRoot || !root) {
  console.error("ERROR: registry generation environment missing.");
  process.exit(1);
}

const shared = await import(pathToFileURL(path.join(repoRoot, "extensions", "pif-shared.ts")).href);
const manifests = [];
for (const entry of fs.readdirSync(root, { withFileTypes: true }).filter((candidate) => candidate.isDirectory())) {
  const file = path.join(root, entry.name, "widget.yaml");
  if (!fs.existsSync(file)) continue;
  manifests.push({ ...shared.parseWidgetManifest(fs.readFileSync(file, "utf8")), core: false });
}
manifests.sort((left, right) => left.id.localeCompare(right.id));
fs.writeFileSync(path.join(root, "..", "widget_registry.g.dart"), shared.generateWidgetRegistry(manifests));
console.log(`   pinned ${manifests.length} widgets`);
NODE

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

# 10b. Write the bootstrap helper that refreshes the workspace manifest on
#      launch. It uses the shared parseAppManifest parser, validates the
#      source before mutating anything, and backs up any differing prior
#      app.yaml in the same directory before the atomic replace.
cat > "$RESOURCES/pif_app-manifest/bootstrap-manifest.mjs" <<'NODE'
#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { assertWritablePifPath, parseAppManifest } from '../pi/extensions/pif-shared.ts';

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

const workspaceArg = process.argv[2];
const sourceArg = process.argv[3];
const appId = process.argv[4];
if (!workspaceArg || !sourceArg || !appId) fail('usage: bootstrap-manifest.mjs <workspace> <source> <app-id>');

const workspace = assertWritablePifPath(workspaceArg);
const source = path.resolve(sourceArg);
const manifestDir = assertWritablePifPath(path.join(workspace, 'pif_app'));
const target = assertWritablePifPath(path.join(manifestDir, 'app.yaml'));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const staging = assertWritablePifPath(path.join(manifestDir, `.app.yaml.stage-${process.pid}-${stamp}`));
const backup = assertWritablePifPath(path.join(manifestDir, `app.yaml.export-backup-${stamp}-${process.pid}`));
const backupStage = assertWritablePifPath(`${backup}.stage-${process.pid}`);

let sourceRaw;
try {
  sourceRaw = fs.readFileSync(source);
} catch (error) {
  fail(`could not read source manifest ${source}: ${error.message}`);
}
const parsed = parseAppManifest(sourceRaw.toString('utf8'));
if (parsed.error) fail(`exported app manifest is invalid: ${parsed.error}`);
if (parsed.manifest?.id !== appId) {
  fail(`exported app manifest id '${parsed.manifest?.id ?? '(missing)'}' does not match exported app id '${appId}'`);
}

fs.mkdirSync(assertWritablePifPath(manifestDir), { recursive: true });

function cleanup(file) {
  try { fs.rmSync(assertWritablePifPath(file), { force: true }); } catch (_) { /* best-effort cleanup */ }
}

try {
  if (!fs.existsSync(target)) {
    fs.writeFileSync(assertWritablePifPath(staging), sourceRaw);
    fs.renameSync(assertWritablePifPath(staging), assertWritablePifPath(target));
    process.exit(0);
  }

  const currentRaw = fs.readFileSync(assertWritablePifPath(target));
  if (currentRaw.equals(sourceRaw)) process.exit(0);

  const currentParsed = parseAppManifest(currentRaw.toString('utf8'));
  if (!currentParsed.error && currentParsed.manifest?.id !== appId) {
    fail(`workspace manifest id '${currentParsed.manifest?.id ?? '(missing)'}' does not match exported app id '${appId}'`);
  }

  fs.copyFileSync(assertWritablePifPath(target), assertWritablePifPath(backupStage));
  fs.renameSync(assertWritablePifPath(backupStage), assertWritablePifPath(backup));
  fs.writeFileSync(assertWritablePifPath(staging), sourceRaw);
  fs.renameSync(assertWritablePifPath(staging), assertWritablePifPath(target));
} catch (error) {
  cleanup(staging);
  cleanup(backupStage);
  fail(
    `could not refresh export-owned manifest for ${appId}: ${error.message}. ` +
    `Recovery: restore '${target}' from the newest 'app.yaml.export-backup-*' file in ${manifestDir}, then relaunch.`
  );
}
NODE
chmod +x "$RESOURCES/pif_app-manifest/bootstrap-manifest.mjs"

# 11. Launcher: exported apps boot straight into their workspace — no
#     project picker. First run provisions the workspace from the bundle.
echo "11. Writing the exported-app launcher ..."
mv "$APP/Contents/MacOS/pif" "$APP/Contents/MacOS/pif.bin"
APP_SUPPORT="$HOME/Library/Application Support/pif-apps/$APP_ID"
cat > "$APP/Contents/MacOS/pif" << LAUNCHER
#!/usr/bin/env bash
set -euo pipefail
DIR="\$(cd "\$(dirname "\$0")" && pwd)"
RESOURCES="\$DIR/../Resources"
WS="\$HOME/Library/Application Support/pif-apps/$APP_ID"
# Export-owned manifest policy:
# - validate the bundle source before mutating anything
# - preserve any differing prior workspace app.yaml as
#   app.yaml.export-backup-<timestamp>-<pid> in the same directory
# - replace the workspace manifest through same-directory rename so launch
#   never observes a partial write
export PIF_EXPORTED=1
export PIF_WORKSPACE="\$WS"
export PIF_APP_DIR="\$RESOURCES/app"
"\$RESOURCES/pi/node" --experimental-strip-types "\$RESOURCES/pif_app-manifest/bootstrap-manifest.mjs" "\$WS" "\$RESOURCES/pif_app-manifest/app.yaml" "$APP_ID"
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
echo "Launch policy: each start validates the bundle manifest, backs up any"
echo "differing workspace app.yaml, and atomically refreshes it before launch."
echo "First run: the app boots straight to its home page (no picker)."
echo "Native Pi profile: ${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
echo "Custom-provider models.json belongs in that native profile."
echo "For built-in OAuth, run bundled Pi with the same profile and use /login"
echo "followed by /model; no developer credentials are included in the app."
printf '  %q %q --no-extensions --no-skills --no-prompt-templates\n' "$RESOURCES/pi/node" "$RESOURCES/pi/cli/dist/cli.js"
echo ""
echo "AOT limitation: the widget set is frozen at export time; rebuild to"
echo "change it. The stock pif.app build path is unchanged."
