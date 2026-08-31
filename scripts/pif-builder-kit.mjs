#!/usr/bin/env node
// Canonical, dependency-free installed builder resource contract. Build inputs
// are copied by allowlist; signed resources are only read by consumer commands.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const BUILDER_SCHEMA_VERSION = 1;
export const BUILDER_LAYOUT = Object.freeze({
  appTemplate: 'pif', scripts: 'scripts', extensions: 'extensions',
  skills: 'skills', node: 'runtime/node', pi: 'runtime/pi',
});
const scripts = ['build-pif-app.sh', 'build-pif-project-app.sh', 'pif-node-runtime.sh', 'pif-builder-kit.mjs'];
const appInputs = ['lib', 'macos', 'catalog', 'templates', 'assets', 'pubspec.yaml', 'pubspec.lock', 'analysis_options.yaml', '.metadata'];
const omitted = new Set(['.git', '.pi', '.pif', '.dart_tool', 'build', 'ephemeral', 'Pods',
  '.DS_Store', '.idea', '.vscode', 'xcuserdata', 'DerivedData', '.flutter-plugins', '.flutter-plugins-dependencies']);
const omitSourceEntry = (name) => omitted.has(name) || name.endsWith('.app') || name.endsWith('.xcuserstate') || name.endsWith('.d.ts');
// Match the stock Pi runtime copy policy. Package build/dist directories and
// other source-cache-looking names may contain executable dependency code.
const omitRuntimeEntry = (name) => name.endsWith('.d.ts');
const required = ['package.json', 'package-lock.json', 'scripts/build-pif-app.sh', 'scripts/build-pif-project-app.sh',
  'scripts/pif-node-runtime.sh', 'scripts/pif-builder-kit.mjs',
  'extensions/pif.ts', 'extensions/pif-shared.ts', 'extensions/pif-github.ts', 'pif/pubspec.yaml', 'pif/pubspec.lock',
  'pif/lib/main.dart', 'pif/lib/export_main.dart', 'pif/lib/widget_registry.g.dart',
  'pif/macos/Runner.xcodeproj/project.pbxproj', 'pif/macos/Podfile',
  'skills/pif-app-builder/SKILL.md', 'skills/pif-app-designer/SKILL.md',
  'runtime/node', 'runtime/pi/package.json', 'runtime/pi/dist/cli.js'];

function fail(message) { throw new Error(message); }
function within(root, candidate) { return candidate === root || candidate.startsWith(`${root}${path.sep}`); }
function sha256(data) { return crypto.createHash('sha256').update(data).digest('hex'); }
function existingPath(candidate) {
  let ancestor = path.resolve(candidate);
  const suffix = [];
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) fail(`Cannot resolve path: ${candidate}`);
    suffix.unshift(path.basename(ancestor));
    ancestor = parent;
  }
  return path.join(fs.realpathSync(ancestor), ...suffix);
}

export function assertWritableBuilderPath(candidate) {
  const resolved = existingPath(candidate);
  if (/\.app\/Contents(?:\/|$)/i.test(resolved)) fail(`Refusing to write inside a signed app bundle: ${resolved}`);
  return resolved;
}

function destinationFor(source, destination, allowBundle = false) {
  const target = allowBundle ? existingPath(destination) : assertWritableBuilderPath(destination);
  const sourceReal = fs.realpathSync(source);
  if (within(sourceReal, target) || within(target, sourceReal)) fail('Builder copy source and destination must not overlap.');
  if (fs.existsSync(target)) fail(`Builder destination already exists: ${target}`);
  return target;
}

// Dereference only links contained in their declared input tree. Neither
// developer symlinks nor a cyclic input can pull unrelated machine data in.
function copyTree(source, destination, root = source, ancestors = new Set(), omit = () => false) {
  const real = fs.realpathSync(source);
  if (!within(fs.realpathSync(root), real)) fail(`Builder input symlink leaves its source root: ${source}`);
  const stat = fs.statSync(real);
  if (stat.isDirectory()) {
    if (ancestors.has(real)) fail(`Builder input contains a symlink cycle: ${source}`);
    fs.mkdirSync(destination, { recursive: true });
    const next = new Set([...ancestors, real]);
    for (const name of fs.readdirSync(real).sort()) {
      if (omit(name)) continue;
      copyTree(path.join(real, name), path.join(destination, name), root, next, omit);
    }
  } else if (stat.isFile()) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(real, destination);
    fs.chmodSync(destination, (stat.mode & 0o111) ? 0o755 : 0o644);
  } else fail(`Unsupported builder input type: ${source}`);
}

export function copyAppSource(source, destination, { allowBundle = false } = {}) {
  const target = destinationFor(source, destination, allowBundle);
  fs.mkdirSync(target, { recursive: true });
  for (const name of appInputs) {
    if (fs.existsSync(path.join(source, name))) copyTree(path.join(source, name), path.join(target, name), source, new Set(), omitSourceEntry);
  }
  for (const name of ['pubspec.yaml', 'lib/main.dart', 'lib/export_main.dart', 'macos/Runner.xcodeproj/project.pbxproj']) {
    if (!fs.existsSync(path.join(target, name))) fail(`Incomplete Flutter/macOS template: ${name}`);
  }
  scanBuilderSecrets(target);
  return target;
}

function inventory(root) {
  const records = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      const relative = path.relative(root, file).split(path.sep).join('/');
      if (relative === 'manifest.json') continue;
      if (entry.isSymbolicLink()) fail(`Builder kit must not contain symlinks: ${relative}`);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) {
        const stat = fs.statSync(file);
        records.push({ path: relative, size: stat.size, executable: Boolean(stat.mode & 0o111), sha256: sha256(fs.readFileSync(file)) });
      } else fail(`Unsupported builder kit file: ${relative}`);
    }
  }
  visit(root);
  return records.sort((a, b) => a.path.localeCompare(b.path));
}

function contentVersion(files) { return sha256(JSON.stringify(files)); }
function freezeKit(root) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) freezeKit(file);
    else fs.chmodSync(file, fs.statSync(file).mode & 0o555);
  }
  fs.chmodSync(root, 0o555);
}
function checkLayout(root) {
  for (const name of required) if (!fs.statSync(path.join(root, name), { throwIfNoEntry: false })?.isFile()) fail(`Incomplete builder kit: ${name}`);
  for (const name of ['pif/lib/core', 'pif/lib/widgets', 'pif/catalog', 'pif/templates']) {
    if (!fs.statSync(path.join(root, name), { throwIfNoEntry: false })?.isDirectory()) fail(`Incomplete builder kit: ${name}`);
  }
}

export function validateBuilderKit(root, { expectedVersion } = {}) {
  root = fs.realpathSync(root);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  if (manifest.schemaVersion !== BUILDER_SCHEMA_VERSION) fail(`Unsupported builder kit schema: ${manifest.schemaVersion}`);
  if (Object.keys(manifest.layout ?? {}).length !== Object.keys(BUILDER_LAYOUT).length ||
      Object.entries(BUILDER_LAYOUT).some(([key, value]) => manifest.layout?.[key] !== value)) fail('Builder kit layout does not match this builder version.');
  if (!/^[a-f0-9]{64}$/.test(manifest.builderVersion ?? '')) fail('Builder kit version is invalid.');
  if (expectedVersion && manifest.builderVersion !== expectedVersion) fail('Builder kit version does not match this environment.');
  checkLayout(root);
  const files = inventory(root);
  if (JSON.stringify(files) !== JSON.stringify(manifest.files) || contentVersion(files) !== manifest.builderVersion) fail('Builder kit integrity check failed; repair it from the installed application.');
  scanBuilderSecrets(root);
  return manifest;
}

// Called by packaging after deep-signing nested executables, then the outer
// app is signed without --deep so signing cannot invalidate these checksums.
export function sealBuilderKit(root) {
  root = fs.realpathSync(root);
  if (process.env.PIF_BUILDER_ASSEMBLY !== '1') assertWritableBuilderPath(root);
  checkLayout(root);
  scanBuilderSecrets(root);
  const appVersion = fs.readFileSync(path.join(root, 'pif/pubspec.yaml'), 'utf8').match(/^version:\s*(\S+)/m)?.[1];
  const pi = JSON.parse(fs.readFileSync(path.join(root, 'runtime/pi/package.json'), 'utf8'));
  const files = inventory(root);
  const manifest = { schemaVersion: BUILDER_SCHEMA_VERSION, builderVersion: contentVersion(files), appVersion,
    layout: BUILDER_LAYOUT, runtime: { node: process.version, pi: pi.version },
    prerequisites: { platform: 'darwin', architecture: process.arch, nodeMinimum: '22.19.0',
      flutterMinimum: '3.44.0', flutterMaximumExclusive: '4.0.0', dartMinimum: '3.12.2', dartMaximumExclusive: '4.0.0',
      gitMinimum: '2.0.0', cocoaPodsMinimum: '1.15.0', xcode: 'Full Xcode selected; xcodebuild -version must succeed',
      restore: 'Flutter/Pub and CocoaPods restore into writable workspace/tool caches' }, files };
  const manifestPath = path.join(root, 'manifest.json');
  if (fs.existsSync(manifestPath)) fs.chmodSync(manifestPath, 0o644);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

async function generateBaseRegistry(root) {
  // Reuse canonical parsing/codegen, but derive entries solely from the files
  // included in this template. A live checkout registry may contain overlays.
  const { parseWidgetManifest, generateWidgetRegistry } = await import(pathToFileURL(path.join(root, 'extensions/pif-shared.ts')).href);
  const widgets = path.join(root, 'pif/lib/widgets');
  const manifests = [];
  for (const entry of fs.readdirSync(widgets, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(widgets, entry.name, 'widget.yaml');
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = parseWidgetManifest(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.id !== entry.name || !fs.statSync(path.join(widgets, entry.name, `${manifest.id}.dart`), { throwIfNoEntry: false })?.isFile()) {
      fail(`Incomplete base widget source: ${entry.name}`);
    }
    manifests.push({ ...manifest, source: 'base' });
  }
  fs.writeFileSync(path.join(root, 'pif/lib/widget_registry.g.dart'), generateWidgetRegistry(manifests));
}

export async function createBuilderKit(sourceRoot, destination, nodeBinary, piRoot) {
  // Source-checkout output normally lives under its own build/. Only these
  // explicit inputs are copied, so that output can never recurse into itself.
  const target = process.env.PIF_BUILDER_ASSEMBLY === '1' ? existingPath(destination) : assertWritableBuilderPath(destination);
  if (within(target, fs.realpathSync(sourceRoot)) || fs.existsSync(target)) fail(`Builder destination must be a new owned directory: ${target}`);
  fs.mkdirSync(target, { recursive: true });
  for (const name of ['package.json', 'package-lock.json']) copyTree(path.join(sourceRoot, name), path.join(target, name));
  for (const name of scripts) copyTree(path.join(sourceRoot, 'scripts', name), path.join(target, 'scripts', name));
  for (const name of fs.readdirSync(path.join(sourceRoot, 'extensions')).sort()) {
    if (/^pif(?:[.-].*)?\.(?:ts|mjs)$/.test(name) && !/\.test\./.test(name)) copyTree(path.join(sourceRoot, 'extensions', name), path.join(target, 'extensions', name));
  }
  copyAppSource(path.join(sourceRoot, 'pif'), path.join(target, 'pif'), { allowBundle: true });
  await generateBaseRegistry(target);
  for (const name of ['pif-app-builder', 'pif-app-designer']) {
    const source = path.join(sourceRoot, 'skills', name);
    copyTree(source, path.join(target, 'skills', name), source, new Set(), omitSourceEntry);
  }
  copyTree(nodeBinary, path.join(target, 'runtime/node'));
  copyTree(piRoot, path.join(target, 'runtime/pi'), piRoot, new Set(), omitRuntimeEntry);
  return { root: target, manifest: sealBuilderKit(target) };
}

export function copyBuilderKit(source, destination) {
  const manifest = validateBuilderKit(source);
  const target = destinationFor(source, destination);
  copyTree(source, target); // An existing kit is copied exactly, without source filters.
  validateBuilderKit(target, { expectedVersion: manifest.builderVersion });
  freezeKit(target);
  return { root: target, manifest };
}

export function copyBuilderKitForAssembly(source, destination) {
  if (process.env.PIF_BUILDER_ASSEMBLY !== '1') fail('Builder kit packaging requires an explicit assembly context.');
  const manifest = validateBuilderKit(source);
  const target = destinationFor(source, destination, true);
  const app = path.dirname(path.dirname(path.dirname(target)));
  assemblyDirectory(path.dirname(app), source);
  if (!app.endsWith('.app') || target !== path.join(app, 'Contents/Resources/builder') || !fs.lstatSync(app).isDirectory()) {
    fail('Builder kit packaging requires an owned staged app Resources/builder directory.');
  }
  copyTree(source, target);
  validateBuilderKit(target, { expectedVersion: manifest.builderVersion });
  // Keep only the assembly copy writable for deep signing, then seal/freeze it.
  return { root: target, manifest };
}

export function copyAppTemplate(source, destination) {
  const manifest = validateBuilderKit(source);
  if (within(fs.realpathSync(source), existingPath(destination))) fail('Writable app templates must be outside the immutable builder kit.');
  return { appTemplateDir: copyAppSource(path.join(source, manifest.layout.appTemplate), destination), builderVersion: manifest.builderVersion };
}

export function resolveBuilderResources({ builderRoot, sourceRoot, appTemplateDir, expectedVersion } = {}) {
  if (builderRoot) {
    const root = fs.realpathSync(builderRoot);
    const manifest = validateBuilderKit(root, { expectedVersion });
    const { files, ...metadata } = manifest;
    return { root, manifest: metadata, script: path.join(root, 'scripts/build-pif-project-app.sh'),
      appTemplateDir: appTemplateDir ? fs.realpathSync(appTemplateDir) : path.join(root, manifest.layout.appTemplate),
      node: path.join(root, manifest.layout.node), pi: path.join(root, manifest.layout.pi) };
  }
  if (!sourceRoot) fail('An explicit builder kit or source checkout is required.');
  const root = fs.realpathSync(sourceRoot);
  for (const name of scripts) if (!fs.existsSync(path.join(root, 'scripts', name))) fail(`Source builder helper is missing: ${name}`);
  return { root, script: path.join(root, 'scripts/build-pif-project-app.sh'), appTemplateDir: appTemplateDir ?? path.join(root, 'pif') };
}

function assemblyDirectory(directory, kitRoot) {
  const parent = assertWritableBuilderPath(path.dirname(directory));
  if (within('/Applications', parent)) fail('Build outputs must be staged outside /Applications.');
  const root = path.join(parent, path.basename(directory));
  if (!/^\.pif-assembly\.[A-Za-z0-9]+$/.test(path.basename(root)) || !fs.lstatSync(root).isDirectory()) fail('Expected an owned builder assembly directory.');
  if (kitRoot && (within(fs.realpathSync(kitRoot), root) || within(root, fs.realpathSync(kitRoot)))) fail('Assembly cleanup must not touch the builder input kit.');
  return root;
}

// Only called for task-owned assembly/recovery trees. lstat prevents chmod or
// recursion through symlinks into user data or the immutable input kit.
function removeOwnedTree(root) {
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory()) { fs.unlinkSync(root); return; }
  fs.chmodSync(root, (stat.mode & 0o777) | 0o700);
  for (const name of fs.readdirSync(root)) removeOwnedTree(path.join(root, name));
  fs.rmdirSync(root);
}

export function discardBuilderAssembly(directory, kitRoot) {
  const root = assemblyDirectory(directory, kitRoot);
  removeOwnedTree(root);
  return { removed: root };
}

export function publishBuiltApp(stagedApp, outputApp, kitRoot) {
  const assembly = assemblyDirectory(path.dirname(stagedApp), kitRoot);
  const name = path.basename(stagedApp);
  const source = path.join(assembly, name);
  const parent = assertWritableBuilderPath(path.dirname(outputApp));
  const destination = path.join(parent, path.basename(outputApp));
  if (parent !== path.dirname(assembly) || name !== path.basename(destination) || !name.endsWith('.app')) fail('Publish requires matching app names in sibling assembly/output directories.');
  if (kitRoot && (within(fs.realpathSync(kitRoot), destination) || within(destination, fs.realpathSync(kitRoot)))) fail('Publish must not replace the builder input kit.');
  if (!fs.lstatSync(source).isDirectory()) fail('The staged app must be a directory, not a symlink.');
  const executable = path.join(source, 'Contents/MacOS/pif');
  if (!fs.lstatSync(executable, { throwIfNoEntry: false })?.isFile()) fail('The staged app executable is missing.');
  validateBuilderKit(path.join(source, 'Contents/Resources/builder'));
  const previous = fs.lstatSync(destination, { throwIfNoEntry: false });
  if (previous && !previous.isDirectory()) fail('Refusing to replace a symlink or non-directory app output.');

  const recovery = previous ? fs.mkdtempSync(path.join(parent, '.pif-replaced.')) : null;
  const backup = recovery ? path.join(recovery, name) : null;
  try {
    if (backup) {
      // macOS requires a writable root when moving between parent directories.
      fs.chmodSync(destination, (previous.mode & 0o777) | 0o200);
      fs.renameSync(destination, backup);
    }
    fs.renameSync(source, destination);
  } catch (error) {
    if (backup && fs.existsSync(backup) && !fs.existsSync(destination)) fs.renameSync(backup, destination);
    if (previous && fs.existsSync(destination)) fs.chmodSync(destination, previous.mode & 0o777);
    if (recovery && fs.readdirSync(recovery).length === 0) fs.rmdirSync(recovery);
    throw error;
  }
  // Publishing has succeeded. A cleanup problem must retain the valid new app
  // and report where the old artifact remains, rather than undoing publication.
  let retainedBackup;
  try { if (recovery) removeOwnedTree(recovery); } catch { retainedBackup = backup; }
  let retainedAssembly;
  try { removeOwnedTree(assembly); } catch { retainedAssembly = assembly; }
  return { appPath: destination, ...(retainedBackup ? { retainedBackup } : {}), ...(retainedAssembly ? { retainedAssembly } : {}) };
}

// The established export secret policy applies equally to kit inputs, source
// templates and final resources. Report classes/paths only, never values.
export function scanBuilderSecrets(root) {
  const rootReal = fs.realpathSync(root);
  const seen = new Set();
  const hits = [];
  const fileNames = new Set(['models.json', 'settings.json', '.env', 'auth.json', 'credentials.json']);
  const rules = [
    ['generic-sk-token', /\bsk-[A-Za-z0-9_-]{20,}\b/],
    ['github-token', /\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{36,})\b/],
    ['aws-access-key', /\b(?:AKIA|ASIA|AIDA|AROA|ANPA|ANVA|AGPA|ACCA|ABIA|A3T)[A-Z0-9]{16}\b/],
    ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/],
    ['google-oauth-token', /\bya29\.[0-9A-Za-z_-]+\b/],
  ];
  function walk(file) {
    const canonical = fs.realpathSync(file);
    if (!within(rootReal, canonical)) fail(`Secret scan refuses symlink target outside the export bundle: ${file}`);
    if (fileNames.has(path.basename(file))) hits.push([path.basename(file), file]);
    if (seen.has(canonical)) return;
    seen.add(canonical);
    const stat = fs.statSync(canonical);
    if (stat.isDirectory()) { for (const name of fs.readdirSync(canonical)) walk(path.join(canonical, name)); return; }
    if (!stat.isFile()) fail(`Secret scan cannot inspect input: ${file}`);
    const buffer = fs.readFileSync(canonical);
    if (buffer.includes(0)) return;
    for (const [label, regex] of rules) if (regex.test(buffer.toString('utf8'))) hits.push([label, file]);
  }
  walk(rootReal);
  if (hits.length) fail(`Credential-shaped material found in the export bundle:\n${hits.map(([label, file]) => `  - ${label}: ${file}`).sort().join('\n')}\nBinary-only, compressed and encrypted secret payloads are not inspected.`);
}

const commands = {
  resolve: ([json]) => resolveBuilderResources(JSON.parse(json)),
  'publish-app': ([source, destination, kit]) => publishBuiltApp(source, destination, kit),
  'discard-assembly': ([directory, kit]) => discardBuilderAssembly(directory, kit),
  validate: ([root, version]) => validateBuilderKit(root, { expectedVersion: version }),
  'copy-kit': ([source, destination]) => copyBuilderKit(source, destination),
  'copy-kit-for-assembly': ([source, destination]) => copyBuilderKitForAssembly(source, destination),
  'copy-template': ([source, destination]) => copyAppTemplate(source, destination),
  'copy-source': ([source, destination]) => ({ appTemplateDir: copyAppSource(source, destination) }),
  'copy-runtime-source': ([source, destination]) => {
    if (process.env.PIF_BUILDER_ASSEMBLY !== '1') fail('Runtime source packaging requires an explicit assembly context.');
    const appTemplateDir = copyAppSource(source, destination, { allowBundle: true });
    fs.rmSync(path.join(appTemplateDir, 'macos'), { recursive: true });
    return { appTemplateDir };
  },
  create: ([source, destination, node, pi]) => createBuilderKit(source, destination, node, pi),
  seal: ([root]) => { const manifest = sealBuilderKit(root); freezeKit(root); return manifest; },
  scan: ([root]) => { scanBuilderSecrets(root); return { clean: true }; },
  writable: ([target, kitRoot]) => {
    const result = assertWritableBuilderPath(target);
    if (kitRoot && within(fs.realpathSync(kitRoot), result)) fail('Builder output must be outside the immutable kit.');
    return result;
  },
};
if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (!commands[command]) fail(`Usage: pif-builder-kit.mjs <${Object.keys(commands).join('|')}> <paths...>`);
    const result = await commands[command](args);
    process.stdout.write(typeof result === 'string' ? `${result}\n` : `${JSON.stringify(result)}\n`);
  } catch (error) { console.error(`ERROR: ${error.message}`); process.exitCode = 1; }
}
