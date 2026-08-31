import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { __test as pif } from './pif.ts';

const repo = path.resolve(import.meta.dirname, '..');
const extension = path.join(repo, 'extensions', 'pif.ts');
const syntheticAllowedOrigins = 'https://fixture.pif.local';
const sharedPubCache = fs.mkdtempSync(path.join('/tmp', 'pif-pub-cache-'));
const tempDir = (prefix) => fs.mkdtempSync(path.join('/tmp', prefix));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Exercise real hub dispatch/state without starting Pi, Flutter or GitHub.
// External compiler/process boundaries are controlled explicitly per case.
function contractHub(t, workspace = tempDir('pif-contract-')) {
  const overrides = {
    PIF_APP_DIR: path.join(workspace, 'app-source'),
    PIF_GLOBAL_CATALOG: path.join(workspace, 'catalog'),
    PIF_MODELS_PATH: path.join(workspace, 'agent', 'models.json'),
    PI_CODING_AGENT_DIR: path.join(workspace, 'agent'),
  };
  const previous = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
  let hub;
  try {
    Object.assign(process.env, overrides);
    hub = new pif.PifHub({}, {}, workspace, 0);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
  const messages = [];
  hub.peers.add({sendRaw: (bytes) => messages.push(JSON.parse(bytes.toString()))});
  t.after(() => {
    hub.peers.clear();
    fs.rmSync(workspace, {recursive: true, force: true});
  });
  return {hub, workspace, messages};
}

test('manifest publication waits for the install gate and rejects speculative state (#194)', async (t) => {
  const {hub, workspace, messages} = contractHub(t);
  hub.scaffoldAppPackage = () => {}; // Real scaffold writes; only package resolution is stubbed.
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  hub.installOrFail = async () => {
    hub.scanWidgets();
    hub.broadcastSnapshot();
    await gate;
  };
  const initializing = hub.control('pif_app.init', {name: 'Live Fixture'});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fs.existsSync(path.join(workspace, 'pif_app', 'app.yaml')), false);
  assert.equal(hub.snapshot().app, null);
  assert.ok(messages.every((event) => event.payload.app === null));
  release();
  await initializing;
  assert.equal(messages.at(-1).payload.app.id, 'live-fixture');
  assert.ok(fs.existsSync(path.join(workspace, 'pif_app', 'app.yaml')));

  const rejected = contractHub(t);
  rejected.hub.scaffoldAppPackage = () => {};
  rejected.hub.installOrFail = async () => {
    rejected.hub.broadcastSnapshot();
    throw new Error('controlled analyzer rejection');
  };
  await assert.rejects(rejected.hub.control('pif_app.init', {name: 'Rejected'}), /analyzer rejection/);
  assert.equal(rejected.hub.snapshot().app, null);
  assert.equal(fs.existsSync(path.join(rejected.workspace, 'pif_app', 'app.yaml')), false);
  assert.ok(rejected.messages.every((event) => event.payload.app === null));
});

test('dev mode synchronizes control and client messages with safe persistence (#208)', async (t) => {
  const {hub, workspace, messages} = contractHub(t);
  assert.equal(hub.snapshot().devMode, false);
  assert.equal(fs.existsSync(hub.shellStatePath), false);
  await hub.control('shell.dev_mode', {enabled: true});
  assert.equal(messages.at(-1).payload.devMode, true);
  const preferences = JSON.parse(fs.readFileSync(hub.shellStatePath, 'utf8'));
  preferences.unrelated = {keep: 'sentinel'};
  fs.writeFileSync(hub.shellStatePath, JSON.stringify(preferences));
  await hub.receive(JSON.stringify({v: 1, id: 'dev-mode-client', ts: new Date().toISOString(), channel: 'shell/control', type: 'dev_mode_set', payload: {enabled: false}}), {send: (event) => messages.push(event)});
  assert.equal(hub.snapshot().devMode, false);
  assert.equal(messages.at(-1).payload.devMode, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(hub.shellStatePath, 'utf8')).unrelated, {keep: 'sentinel'});
  const before = fs.readFileSync(hub.shellStatePath);
  const eventCount = messages.length;
  for (const payload of [true, null, 'true', {}, {enabled: 'false'}]) {
    await assert.rejects(hub.control('shell.dev_mode', payload), /requires/);
  }
  assert.deepEqual(fs.readFileSync(hub.shellStatePath), before);
  assert.equal(messages.length, eventCount);
  await hub.control('shell.dev_mode', {enabled: true});
  const {hub: restored} = contractHub(t, workspace);
  restored.loadShellState();
  assert.equal(restored.snapshot().devMode, true);
  const malformed = '{ SYNTHETIC_PRIVATE_PREFERENCE';
  fs.writeFileSync(hub.shellStatePath, malformed);
  await assert.rejects(hub.control('shell.dev_mode', {enabled: false}), (error) => error.message.includes('invalid shell JSON') && !error.message.includes('SYNTHETIC_PRIVATE_PREFERENCE'));
  assert.equal(fs.readFileSync(hub.shellStatePath, 'utf8'), malformed);
  assert.equal(hub.snapshot().devMode, true);
});

function writeJsonIfMissing(file, value) {
  if (fs.existsSync(file)) return;
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function prepareAgentDir(workspace) {
  const agentDir = path.join(workspace, '.pi', 'agent');
  fs.mkdirSync(path.join(agentDir, 'agents'), {recursive: true});
  fs.mkdirSync(path.join(agentDir, 'extensions'), {recursive: true});
  fs.mkdirSync(path.join(agentDir, 'state'), {recursive: true});
  writeJsonIfMissing(path.join(agentDir, 'models.json'), {providers: {}});
  writeJsonIfMissing(path.join(agentDir, 'settings.json'), {});
  writeJsonIfMissing(path.join(agentDir, 'pipeline-config.json'), {});
  return agentDir;
}

async function waitFor(check, message, timeout = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) { try { const value = await check(); if (value) return value; } catch {} await delay(50); }
  throw new Error(`Timed out: ${message}`);
}

function control(socketPath, method, params = {}) {
  return new Promise((resolve, reject) => {
    const secretPath = path.join(path.dirname(socketPath), 'control.secret');
    const secret = fs.existsSync(secretPath) ? fs.readFileSync(secretPath, 'utf8').trim() : '';
    const socket = net.createConnection(socketPath); let raw = '';
    const finish = (action, value) => { socket.destroy(); action(value); };
    socket.on('connect', () => socket.write(JSON.stringify({secret}) + '\n' + JSON.stringify({method, params}) + '\n'));
    socket.on('data', (chunk) => raw += chunk);
    socket.on('end', () => { try { const value = JSON.parse(raw); value.ok ? finish(resolve, value.result) : finish(reject, new Error(value.error)); } catch (error) { finish(reject, error); } });
    socket.on('close', () => { if (raw === '') finish(reject, new Error('control socket closed without a response')); });
    socket.on('error', (error) => finish(reject, error));
  });
}

function rpc(child, command, timeout = 15_000) {
  return new Promise((resolve, reject) => {
    const id = `rpc-${Date.now()}-${Math.random()}`;
    let buffer = '';
    const timer = setTimeout(() => { child.stdout.off('data', onData); reject(new Error(`RPC timeout: ${command.type}`)); }, timeout);
    const onData = (chunk) => {
      buffer += chunk;
      let at;
      while ((at = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
        let value; try { value = JSON.parse(line); } catch { continue; }
        if (value.id !== id || value.type !== 'response') continue;
        clearTimeout(timer); child.stdout.off('data', onData);
        value.success ? resolve(value) : reject(new Error(value.error));
      }
    };
    child.stdout.on('data', onData);
    child.stdin.write(JSON.stringify({...command, id}) + '\n');
  });
}

function nextMessage(socket, predicate, timeout = 10_000) {
  return new Promise((resolve, reject) => {
    const finish = (action, value) => {
      clearTimeout(timer);
      socket.removeEventListener('message', listener);
      socket.removeEventListener('close', closed);
      socket.removeEventListener('error', closed);
      action(value);
    };
    const timer = setTimeout(() => finish(reject, new Error('WebSocket message timeout')), timeout);
    const closed = () => finish(reject, new Error('WebSocket closed before the expected message'));
    const listener = (event) => {
      try {
        const value = JSON.parse(event.data);
        if (predicate(value)) finish(resolve, value);
      } catch (error) { finish(reject, error); }
    };
    socket.addEventListener('message', listener);
    socket.addEventListener('close', closed);
    socket.addEventListener('error', closed);
  });
}

function send(socket, channel, type, payload) { socket.send(JSON.stringify({v: 1, id: `${Date.now()}`, ts: new Date().toISOString(), channel, type, payload})); }

function fixtureEnvironment(root, extra = {}) {
  const env = {
    PATH: process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin',
    TMPDIR: path.join(root, '.tmp'),
    PUB_CACHE: sharedPubCache,
    XDG_CACHE_HOME: path.join(root, '.xdg-cache'),
    XDG_CONFIG_HOME: path.join(root, '.xdg-config'),
    ...extra,
  };
  if (process.env.HOME) env.HOME = process.env.HOME;
  if (process.env.LANG) env.LANG = process.env.LANG;
  if (process.env.LC_ALL) env.LC_ALL = process.env.LC_ALL;
  if (process.env.USER) env.USER = process.env.USER;
  if (process.env.LOGNAME) env.LOGNAME = process.env.LOGNAME;
  for (const key of ['TMPDIR', 'PUB_CACHE', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME']) fs.mkdirSync(env[key], {recursive: true});
  return env;
}

function runFlutterPubGet(cwd, root) {
  const result = spawnSync('flutter', ['pub', 'get'], {cwd, env: fixtureEnvironment(root), encoding: 'utf8', timeout: 120_000, killSignal: 'SIGTERM'});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`flutter pub get failed for ${cwd}: ${result.stderr || result.stdout || `exit ${result.status}`}`);
}

async function reservePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      if (!port) {
        server.close(() => reject(new Error('Failed to reserve a port')));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function closeWebSocket(socket, timeout = 5_000) {
  if (!socket) return;
  if (socket.readyState === 3) return;
  if (socket.readyState === 2) {
    try { await waitFor(() => socket.readyState === 3, 'WebSocket close', timeout); } catch {}
    return;
  }
  socket.close();
  try { await waitFor(() => socket.readyState === 3, 'WebSocket close', timeout); } catch {}
}

async function shutdownChild(child, timeout = 5_000) {
  if (!child || child.exitCode != null || child.signalCode != null) return;
  try {
    await rpc(child, {type: 'prompt', message: '/pif-stop'}, Math.min(timeout, 5_000));
  } catch {}
  try {
    await waitFor(() => child.exitCode != null || child.signalCode != null, 'child exit', timeout);
  } catch {
    try { child.kill('SIGTERM'); } catch {}
    try { await waitFor(() => child.exitCode != null || child.signalCode != null, 'child hard exit', timeout); } catch {
      try { child.kill('SIGKILL'); } catch {}
      try { await waitFor(() => child.exitCode != null || child.signalCode != null, 'child hard exit', timeout); } catch {}
    }
  }
}

function copyFixture(workspace, removeDiffViewer = true) {
  const target = path.join(workspace, 'pif'); fs.mkdirSync(target, {recursive: true});
  for (const name of ['lib', 'catalog', 'templates', 'macos']) fs.cpSync(path.join(repo, 'pif', name), path.join(target, name), {recursive: true});
  for (const name of ['pubspec.yaml', 'pubspec.lock', 'analysis_options.yaml', '.metadata']) fs.copyFileSync(path.join(repo, 'pif', name), path.join(target, name));
  fs.rmSync(path.join(target, '.dart_tool'), {recursive: true, force: true});
  fs.rmSync(path.join(target, 'macos', 'Flutter', 'ephemeral'), {recursive: true, force: true});
  if (removeDiffViewer) fs.rmSync(path.join(target, 'lib', 'widgets', 'diff_viewer'), {recursive: true, force: true});
  runFlutterPubGet(target, workspace);
  return target;
}

/** Layered widget sources (#155): a project overlay package (`pif_app/` with a
 * path dependency on the app so `package:pif/core/plugin.dart` resolves), one
 * project widget, and one global-catalog-only widget. Both are real enough to
 * pass the hub's dart analyze gates. */
function seedProjectOverlay(workspace) {
  const overlay = path.join(workspace, 'pif_app');
  fs.mkdirSync(path.join(overlay, 'widgets'), {recursive: true});
  fs.writeFileSync(path.join(overlay, 'pubspec.yaml'), 'name: pif_app\nenvironment:\n  sdk: ^3.0.0\ndependencies:\n  flutter:\n    sdk: flutter\n  pif:\n    path: ../pif\n');
  fs.writeFileSync(path.join(overlay, 'widgets', 'hello_page.dart'), [
    "import 'package:flutter/material.dart';",
    "import 'package:pif/core/plugin.dart';",
    '',
    'class HelloPagePlugin implements PifWidgetPlugin {',
    '  @override PifWidgetMeta get meta => const PifWidgetMeta(id: \'hello_page\', name: \'Hello Page\', slot: PifSlot.center);',
    '  @override Widget build(BuildContext context, PifHost host) => const SizedBox();',
    '}',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(overlay, 'widgets', 'widget.yaml'), 'id: hello_page\nname: "Hello Page"\nversion: 0.1.0\ndescription: "Project overlay fixture"\nslot: center\ncore: false\ntags: [project]\ndart_dependencies: []\n');
  fs.mkdirSync(path.join(overlay, 'widgets', 'hello_page'), {recursive: true});
  fs.renameSync(path.join(overlay, 'widgets', 'hello_page.dart'), path.join(overlay, 'widgets', 'hello_page', 'hello_page.dart'));
  fs.renameSync(path.join(overlay, 'widgets', 'widget.yaml'), path.join(overlay, 'widgets', 'hello_page', 'widget.yaml'));
  const globalCatalog = path.join(workspace, 'global-pif-catalog');
  fs.mkdirSync(path.join(globalCatalog, 'global_only'), {recursive: true});
  fs.writeFileSync(path.join(globalCatalog, 'global_only', 'widget.yaml'), 'id: global_only\nname: "Global Only"\nversion: 0.1.0\ndescription: "Global catalog fixture"\nslot: right\ncore: false\ntags: [global]\ndart_dependencies: []\n');
  fs.writeFileSync(path.join(globalCatalog, 'global_only', 'global_only.dart'), [
    "import 'package:flutter/material.dart';",
    "import 'package:pif/core/plugin.dart';",
    '',
    'class GlobalOnlyPlugin implements PifWidgetPlugin {',
    '  @override PifWidgetMeta get meta => const PifWidgetMeta(id: \'global_only\', name: \'Global Only\', slot: PifSlot.right);',
    '  @override Widget build(BuildContext context, PifHost host) => const SizedBox();',
    '}',
    '',
  ].join('\n'));
  runFlutterPubGet(overlay, workspace);
  return {overlay, globalCatalog};
}

function fakePi(workspace) {
  const file = path.join(workspace, 'fake-pi.mjs');
  // Mirrors real pi: events stream over stdout AND append to the
  // `--session <file>.jsonl` log, which the hub treats as the source of
  // truth for display history.
  fs.writeFileSync(file, `#!/usr/bin/env node\nimport fs from 'node:fs';\nconst at = process.argv.indexOf('--session');\nconst sessionFile = at >= 0 ? process.argv[at + 1] : null;\nfs.writeFileSync(${JSON.stringify(path.join(workspace, 'fake-child.pid'))}, String(process.pid));\nfs.writeFileSync(${JSON.stringify(path.join(workspace, 'fake-child.env.json'))}, JSON.stringify({autostart: process.env.PIF_AUTOSTART ?? null, noFlutter: process.env.PIF_NO_FLUTTER ?? null, port: process.env.PIF_PORT ?? null, sentinel: process.env.PIF_SYNTHETIC_SENTINEL ?? null, token: process.env.PIF_TOKEN ?? null, allowedOrigins: process.env.PIF_ALLOWED_ORIGINS ?? null, agentDir: process.env.PI_CODING_AGENT_DIR ?? null}));\nlet b=''; process.stdin.on('data',c=>{b+=c;let i;while((i=b.indexOf('\\n'))>=0){const l=b.slice(0,i);b=b.slice(i+1);if(!l)continue;const q=JSON.parse(l);if(q.type==='prompt'||q.type==='steer'){const user={role:'user',content:[{type:'text',text:q.message||''}]};process.stdout.write(JSON.stringify({type:'message_start',message:user})+'\\n');process.stdout.write(JSON.stringify({type:'message_end',message:user})+'\\n');}const ev={type:'message_update',delta:q.message||'',command:q.type};if(sessionFile)fs.appendFileSync(sessionFile, JSON.stringify(ev)+'\\n');process.stdout.write(JSON.stringify(ev)+'\\n');if(q.type==='abort')process.stdout.write(JSON.stringify({type:'agent_end',aborted:true})+'\\n');else process.stdout.write(JSON.stringify({type:'agent_end'})+'\\n');}});\nprocess.on('SIGTERM',()=>{fs.writeFileSync(${JSON.stringify(path.join(workspace, 'fake-child.stopped'))},'yes');process.exit(0)});\n`);
  fs.chmodSync(file, 0o755); return file;
}

async function startPi({workspace, port, piBin, launchFlutter = false, modelsPath = path.join(workspace, '.pi', 'agent', 'models.json'), hostSessionFile = path.join(workspace, '.pi', 'pif', 'sessions', 'host.jsonl'), globalCatalog = path.join(workspace, '.pi', 'pif', 'catalog'), token = 'integration-token', appDir = path.join(workspace, 'pif'), allowedOrigins = syntheticAllowedOrigins, extraEnv = {}}) {
  const agentDir = prepareAgentDir(workspace);
  fs.mkdirSync(path.dirname(modelsPath), {recursive: true});
  writeJsonIfMissing(modelsPath, {providers: {}});
  fs.mkdirSync(path.dirname(hostSessionFile), {recursive: true});
  fs.mkdirSync(globalCatalog, {recursive: true});
  const child = spawn('pi', ['--mode', 'rpc', '--offline', '--no-session', '-ne', '-e', extension], {cwd: workspace, env: fixtureEnvironment(workspace, {PIF_WORKSPACE: workspace, PIF_AUTOSTART: '1', PIF_TOKEN: token, ...(launchFlutter ? {} : {PIF_NO_FLUTTER: '1'}), PIF_PORT: String(port), PIF_PI_BIN: piBin, PIF_MODELS_PATH: modelsPath, PIF_HOST_SESSION_FILE: hostSessionFile, PIF_GLOBAL_CATALOG: globalCatalog, PIF_APP_DIR: appDir, PIF_ALLOWED_ORIGINS: allowedOrigins, PI_CODING_AGENT_DIR: agentDir, ...extraEnv}), stdio: ['pipe', 'pipe', 'pipe']});
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => stdout += chunk);
  child.stderr.on('data', (chunk) => stderr += chunk);
  try {
    child.stdin.write(JSON.stringify({type: 'get_state'}) + '\n');
    await waitFor(() => stdout.includes('"command":"get_state"'), `pi RPC start: ${stderr || stdout}`);
    await waitFor(() => fetch(`http://127.0.0.1:${port}`).then((response) => response.ok), `hub start: ${stderr || stdout}`);
    return child;
  } catch (error) {
    await shutdownChild(child);
    throw error;
  }
}

test('real hub smoke covers snapshot, RPC child, analyze gate, catalog, layout, and shutdown', {timeout: 120_000}, async (t) => {
  const checkpoint = (name) => console.error(`[pif-smoke] ${name}`);
  checkpoint('setup');
  const workspace = tempDir('pif-smoke-');
  let pi;
  let socket;
  let pi2;
  let socket2;
  t.after(async () => {
    await closeWebSocket(socket2);
    await shutdownChild(pi2);
    await closeWebSocket(socket);
    await shutdownChild(pi);
    fs.rmSync(workspace, {recursive: true, force: true});
  });
  const appDir = copyFixture(workspace);
  const piBin = fakePi(workspace);
  const port = await reservePort();
  checkpoint('seeding project overlay + global catalog');
  const {globalCatalog} = seedProjectOverlay(workspace);
  checkpoint('pif_app pub get done');
  const hostSessionFile = path.join(workspace, '.pi', 'pif', 'sessions', 'host.jsonl'); fs.mkdirSync(path.dirname(hostSessionFile), {recursive: true});
  fs.writeFileSync(hostSessionFile, [
    {type: 'session', version: 3, id: 'host-fixture', timestamp: new Date().toISOString(), cwd: workspace},
    {type: 'custom_message', customType: 'pif-input', content: 'restored host input'},
    {type: 'message', message: {role: 'assistant', content: [{type: 'text', text: 'restored host reply'}]}},
  ].map((value) => JSON.stringify(value)).join('\n') + '\n');
  const modelsPath = path.join(workspace, 'models-fixture.json'); fs.writeFileSync(modelsPath, JSON.stringify({providers: {fixture: {models: [{id: 'old'}]}}, customKey: 'keep-me'}, null, 2));
  pi = await startPi({workspace, port, piBin, modelsPath, hostSessionFile, globalCatalog, appDir, extraEnv: {PIF_SYNTHETIC_SENTINEL: 'fixture-sentinel'}});
  checkpoint('hub started');
  const tokenFile = path.join(workspace, '.pi', 'pif', 'token');
  assert.equal(fs.readFileSync(tokenFile, 'utf8'), 'integration-token');
  const openFail = (url) => new Promise((resolve, reject) => { const socket = new WebSocket(url); socket.addEventListener('open', () => { socket.close(); resolve(); }, {once: true}); socket.addEventListener('error', () => reject(new Error('connection rejected')), {once: true}); });
  await assert.rejects(() => openFail(`ws://127.0.0.1:${port}/pif`), /rejected/);
  await assert.rejects(() => openFail(`ws://127.0.0.1:${port}/pif?token=wrong-token-value`), /rejected/);
  checkpoint('unauthenticated connections rejected');

  // Health endpoint discloses no absolute workspace path; /probe proves
  // hub identity via HMAC of our nonce under the token.
  const health = await (await fetch(`http://127.0.0.1:${port}/`)).json();
  assert.equal(health.name, 'pif');
  assert.ok(!JSON.stringify(health).includes(workspace), 'health must not leak the workspace path');
  const nonce = `nonce-${Date.now()}`;
  const { createHmac } = await import('node:crypto');
  const proof = createHmac('sha256', 'integration-token').update(nonce).digest('hex');
  const probe = await (await fetch(`http://127.0.0.1:${port}/probe?nonce=${nonce}`)).json();
  assert.equal(proof, probe.proof, 'hub proves token possession');
  const squatter = await (await fetch(`http://127.0.0.1:${port}/probe?nonce=x`)).json();
  assert.notEqual(proof, squatter.proof, 'proof is bound to the caller nonce');
  socket = new WebSocket(`ws://127.0.0.1:${port}/pif?token=integration-token`); await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, {once: true}); socket.addEventListener('error', reject, {once: true}); });
  send(socket, 'shell/state', 'snapshot_request', {}); const snapshot = await nextMessage(socket, (value) => value.type === 'snapshot');
  checkpoint('snapshot received');
  assert.equal(snapshot.payload.health.hub, 'running'); assert.equal(snapshot.payload.widgets.agent_console.core, true); assert.equal(snapshot.payload.widgets.diff_viewer, undefined);
  assert.equal(snapshot.payload.health.origin, 'standalone');
  // Layered widget sources (#155): provenance reaches the shell snapshot.
  assert.equal(snapshot.payload.widgets.hello_page.source, 'project', 'project overlay provenance in the snapshot');
  assert.equal(snapshot.payload.catalog.global_only.source, 'catalog', 'global catalog provenance in the snapshot');
  send(socket, 'session/control', 'transcript', {sessionId: 'host'});
  const hostHistory = await nextMessage(socket, (value) => value.type === 'history' && value.payload?.sessionId === 'host');
  assert.ok(hostHistory.payload.transcript.some((entry) => entry.type === 'input' && entry.content === 'restored host input'), 'host history hydrates from its persisted session file');
  assert.ok(hostHistory.payload.transcript.some((entry) => entry.type === 'message' && entry.text === 'restored host reply'), 'host assistant history hydrates from its persisted session file');

  const createdPromise = nextMessage(socket, (value) => value.type === 'created');
  send(socket, 'session/control', 'spawn', {cwd: workspace, model: 'fake'});
  const created = await createdPromise;
  const sessionId = created.payload.id; assert.match(sessionId, /^session_/);
  assert.ok(fs.existsSync(path.join(workspace, '.pi', 'pif', 'sessions', `${sessionId}.jsonl`)), 'new sessions reserve a transcript file before first input');
  const childProbe = JSON.parse(await waitFor(() => fs.existsSync(path.join(workspace, 'fake-child.env.json')) ? fs.readFileSync(path.join(workspace, 'fake-child.env.json'), 'utf8') : false, 'child env dump'));
  assert.equal(childProbe.autostart, null); assert.equal(childProbe.noFlutter, null); assert.equal(childProbe.port, null);
  assert.equal(childProbe.sentinel, 'fixture-sentinel');
  assert.equal(childProbe.token, null, 'children must not inherit the hub token');
  assert.equal(childProbe.agentDir, path.join(workspace, '.pi', 'agent'));
  assert.equal(childProbe.allowedOrigins, null);
  checkpoint('child env scrubbed of lifecycle vars');
  checkpoint('child env contains no pif credentials');

  // Slim snapshots (#174): payload carries rail metadata, no transcripts.
  send(socket, 'shell/state', 'snapshot_request', {});
  const postSpawnSnapshot = await nextMessage(socket, (value) => value.type === 'snapshot');
  const slimmed = postSpawnSnapshot.payload.sessions[sessionId];
  assert.ok(slimmed, 'snapshot carries the spawned session');
  assert.deepEqual(slimmed.transcript, [], 'snapshot excludes transcripts');
  // Lazy hydration: session/transcript returns the authoritative history.
  send(socket, 'session/control', 'transcript', {sessionId});
  const history = await nextMessage(socket, (value) => value.type === 'history' && value.payload?.sessionId === sessionId);
  assert.ok(Array.isArray(history.payload.transcript), 'history envelope carries a transcript array');
  const inputEvents = [];
  const inputListener = (event) => { const value = JSON.parse(event.data); if (value.channel === 'session/event' && value.payload?.sessionId === sessionId && value.type === 'input') inputEvents.push(value); };
  socket.addEventListener('message', inputListener);
  const streamPromise = nextMessage(socket, (value) => value.channel === 'session/event' && value.payload.sessionId === sessionId && value.type === 'message_update');
  send(socket, 'session/control', 'input', {sessionId, content: 'hello'});
  const streamed = await streamPromise; checkpoint('child streamed'); assert.equal(streamed.payload.event.delta, 'hello'); await delay(20); socket.removeEventListener('message', inputListener); assert.equal(inputEvents.length, 1, 'user boundary events must not duplicate the authoritative input');
  const steerPromise = nextMessage(socket, (value) => value.channel === 'session/event' && value.payload.event?.delta === 'turn');
  send(socket, 'session/control', 'steer', {sessionId, content: 'turn'});
  const steered = await steerPromise; assert.equal(steered.payload.event.command, 'steer');
  const abortPromise = nextMessage(socket, (value) => value.channel === 'session/event' && value.payload.event?.aborted === true);
  send(socket, 'session/control', 'abort', {sessionId});
  await abortPromise; checkpoint('child controls complete');
  send(socket, 'session/control', 'rename', {sessionId, name: 'Researcher'});
  await nextMessage(socket, (value) => value.type === 'updated' && value.payload?.id === sessionId && value.payload?.name === 'Researcher');

  const controlPath = path.join(workspace, '.pi', 'pif', 'control.sock');
  // Control socket rejects callers without the per-launch secret (#176).
  await assert.rejects(() => new Promise((resolve, reject) => {
    const socket = net.createConnection(controlPath); let raw = '';
    socket.on('connect', () => socket.write(JSON.stringify({secret: 'wrong'}) + '\n' + JSON.stringify({method: 'shell.status', params: {}}) + '\n'));
    socket.on('data', (chunk) => raw += chunk);
    socket.on('end', () => { try { const value = JSON.parse(raw); value.ok ? resolve(value.result) : reject(new Error(value.error)); } catch (error) { reject(error); } });
    socket.on('error', reject);
  }), /authorization failed/);
  checkpoint('unauthorized control connection rejected');
  const scaffold = await control(controlPath, 'widget.create', {id: 'diff_viewer', name: 'Diff Viewer', slot: 'center', spec: 'Compare before and after text'});
  assert.ok(fs.existsSync(scaffold.manifest));
  fs.writeFileSync(scaffold.source, `import 'package:flutter/material.dart';\nimport '../../core/plugin.dart';\nclass DiffViewerPlugin implements PifWidgetPlugin {\n @override PifWidgetMeta get meta => const PifWidgetMeta(id: 'diff_viewer', name: 'Diff Viewer', slot: PifSlot.center);\n @override Widget build(BuildContext context, PifHost host) => const Row(children:[Expanded(child:SelectableText('before')),VerticalDivider(),Expanded(child:SelectableText('after'))]);\n}\n`);
  checkpoint('diff viewer scaffolded');
  const diffInstall = await control(controlPath, 'widget.install', {id: 'diff_viewer'}); checkpoint('diff viewer installed'); assert.equal(diffInstall.ok, true); assert.match(diffInstall.diagnostics, /No issues found/);
  await control(controlPath, 'layout', {action: 'open', widgetId: 'diff_viewer', slot: 'center'});
  const diffSnapshotPromise = nextMessage(socket, (value) => value.type === 'snapshot' && value.payload.widgets.diff_viewer);
  send(socket, 'shell/state', 'snapshot_request', {}); const diffSnapshot = await diffSnapshotPromise;
  assert.equal(diffSnapshot.payload.widgets.diff_viewer.enabled, true);
  const badDir = path.join(workspace, 'pif', 'lib', 'widgets', 'broken_widget'); fs.mkdirSync(badDir); fs.writeFileSync(path.join(badDir, 'widget.yaml'), 'id: broken_widget\nname: "Broken"\nversion: 0.1.0\ndescription: "Broken fixture"\nslot: center\ncore: false\ntags: [test]\ndart_dependencies: []\n'); fs.writeFileSync(path.join(badDir, 'broken_widget.dart'), "void broken( {\n");
  const rejected = await control(controlPath, 'widget.install', {id: 'broken_widget'}); checkpoint('broken rejected'); assert.equal(rejected.ok, false); assert.equal(rejected.phase, 'analyze'); assert.match(rejected.diagnostics, /error/i);
  const pubspecPath = path.join(workspace, 'pif', 'pubspec.yaml');
  const lockPath = path.join(workspace, 'pif', 'pubspec.lock');
  const pubspecBefore = fs.readFileSync(pubspecPath, 'utf8');
  const lockBefore = fs.readFileSync(lockPath, 'utf8');
  const depDir = path.join(workspace, 'pif', 'lib', 'widgets', 'dependency_broken');
  fs.mkdirSync(depDir);
  fs.writeFileSync(path.join(depDir, 'widget.yaml'), 'id: dependency_broken\nname: "Dependency Broken"\nversion: 0.1.0\ndescription: "Rollback fixture"\nslot: center\ncore: false\ntags: [test]\ndart_dependencies: [path]\n');
  fs.writeFileSync(path.join(depDir, 'dependency_broken.dart'), 'void broken( {\n');
  const depRejected = await control(controlPath, 'widget.install', {id: 'dependency_broken'});
  assert.equal(depRejected.ok, false);
  assert.equal(depRejected.phase, 'analyze');
  assert.equal(fs.readFileSync(pubspecPath, 'utf8'), pubspecBefore);
  assert.equal(fs.readFileSync(lockPath, 'utf8'), lockBefore);
  const installed = await control(controlPath, 'widget.install', {id: 'workspace_clock'}); checkpoint('catalog installed'); assert.equal(installed.ok, true); assert.ok(fs.existsSync(path.join(workspace, 'pif', 'lib', 'widgets', 'workspace_clock')));
  // Layered widget sources (#155): provenance in widget.list plus per-source install/uninstall.
  const listed = await control(controlPath, 'widget.list'); checkpoint('widget.list verified');
  assert.equal(listed.installed.agent_console.source, 'base');
  assert.equal(listed.installed.hello_page.source, 'project');
  assert.equal(listed.installed.workspace_clock.source, 'base');
  assert.equal(listed.catalog.global_only.source, 'catalog');
  assert.equal(listed.catalog.workspace_clock, undefined, 'installed widgets shadow catalog entries');
  const helloSource = path.join(workspace, 'pif_app', 'widgets', 'hello_page', 'hello_page.dart');
  const helloBefore = fs.readFileSync(helloSource, 'utf8');
  const projectInstall = await control(controlPath, 'widget.install', {id: 'hello_page'}); checkpoint('project widget installed');
  assert.equal(projectInstall.ok, true, projectInstall.diagnostics || '');
  assert.equal(projectInstall.source, 'project');
  assert.equal(fs.readFileSync(helloSource, 'utf8'), helloBefore, 'installing a project widget registers it in place — source never moves');
  const registry = fs.readFileSync(path.join(workspace, 'pif', 'lib', 'widget_registry.g.dart'), 'utf8');
  assert.match(registry, /\/\/ source: project\n    'hello_page'/);
  assert.match(registry, /import 'file:\/\/.+\/pif_app\/widgets\/hello_page\/hello_page\.dart';/);
  const globalInstall = await control(controlPath, 'widget.install', {id: 'global_only'}); checkpoint('global catalog widget installed');
  assert.equal(globalInstall.ok, true, globalInstall.diagnostics || '');
  assert.equal(globalInstall.source, 'project');
  assert.ok(fs.existsSync(path.join(workspace, 'pif_app', 'widgets', 'global_only', 'widget.yaml')), 'global catalog installs copy into the project overlay');
  assert.ok(fs.existsSync(path.join(globalCatalog, 'global_only', 'widget.yaml')), 'global catalog source never moves');
  const deregistered = await control(controlPath, 'widget.uninstall', {id: 'hello_page'}); checkpoint('project widget deregistered');
  assert.equal(deregistered.ok, true);
  assert.equal(deregistered.source, 'project');
  assert.equal(deregistered.deregistered, true);
  assert.ok(fs.existsSync(helloSource), 'uninstalling a project widget keeps its source');
  const afterUninstall = await control(controlPath, 'widget.list');
  assert.equal(afterUninstall.installed.hello_page.enabled, false, 'deregistered project widget stays present but disabled');
  assert.ok(!fs.readFileSync(path.join(workspace, 'pif', 'lib', 'widget_registry.g.dart'), 'utf8').includes("'hello_page'"), 'registry drops the deregistered project widget');
  await assert.rejects(() => control(controlPath, 'widget.uninstall', {id: 'agent_console'}), /Core widget/);
  await control(controlPath, 'layout', {action: 'move', widgetId: 'diff_viewer', slot: 'right'}); assert.equal(JSON.parse(fs.readFileSync(path.join(workspace, '.pi', 'pif', 'layout.json'))).panels.diff_viewer.slot, 'right');
  const resetState = nextMessage(socket, (value) => value.type === 'layout_state' && Object.keys(value.payload.panels ?? {}).length === 0);
  await control(controlPath, 'layout', {action: 'reset'});
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(workspace, '.pi', 'pif', 'layout.json'))).panels, {});
  await resetState; checkpoint('layout reset verified');
  const resizeState = nextMessage(socket, (value) => value.type === 'layout_state' && value.payload.sizes?.left === 300);
  send(socket, 'shell/layout', 'resize', {sizes: {left: 300, right: 280, bottom: 200}});
  await resizeState;
  assert.equal(JSON.parse(fs.readFileSync(path.join(workspace, '.pi', 'pif', 'layout.json'))).sizes.left, 300);
  await control(controlPath, 'layout', {action: 'reset'});
  assert.equal(JSON.parse(fs.readFileSync(path.join(workspace, '.pi', 'pif', 'layout.json'))).sizes, undefined);
  checkpoint('dock sizes persist and reset');
  const pinState = nextMessage(socket, (value) => value.type === 'layout_state' && value.payload.panels?.widget_store?.pinned === false);
  send(socket, 'shell/layout', 'pin', {widgetId: 'widget_store', pinned: false});
  await pinState;
  assert.equal(JSON.parse(fs.readFileSync(path.join(workspace, '.pi', 'pif', 'layout.json'))).panels.widget_store.pinned, false);
  send(socket, 'shell/layout', 'pin', {widgetId: 'widget_store', pinned: true});
  checkpoint('pin state persists');

  await assert.rejects(() => control(controlPath, 'widget.install', {id: '../../escape'}), /snake_case/);
  await assert.rejects(() => control(controlPath, 'models.save', {providers: 'not-an-object'}), /providers object/);
  await assert.rejects(() => control(controlPath, 'models.save', {providers: {broken: {models: 'nope'}}}), /models must be an array/);
  const savedModels = await control(controlPath, 'models.save', {providers: {fixture: {models: [{id: 'new'}]}}});
  assert.equal(savedModels.ok, true);
  const savedFile = JSON.parse(fs.readFileSync(modelsPath, 'utf8'));
  assert.equal(savedFile.customKey, 'keep-me'); assert.equal(savedFile.providers.fixture.models[0].id, 'new');
  assert.ok(fs.readdirSync(workspace).some((name) => name.startsWith('models-fixture.json.bak-')), 'backup written');
  checkpoint('input hardening verified');

  // models/save round-trips through the WebSocket (#175): the Model
  // Manager's channel is allowlisted and persists providers to disk.
  const wsSavePromise = nextMessage(socket, (value) => value.type === 'snapshot');
  send(socket, 'models/save', 'save', {providers: {fixture: {models: [{id: 'ws-saved'}]}}});
  await wsSavePromise;
  await waitFor(() => { try { return JSON.parse(fs.readFileSync(modelsPath, 'utf8')).providers.fixture.models[0].id === 'ws-saved'; } catch { return false; } }, 'models/save over WS writes the file');
  checkpoint('models/save works over WS');

  // A failing action surfaces shell/error with request correlation (#175).
  send(socket, 'session/control', 'resume', {sessionId: 'no-such-session'});
  const actionFailed = await nextMessage(socket, (value) => value.channel === 'shell/error' && value.type === 'action_failed');
  assert.ok(actionFailed.payload.requestId, 'failure carries the request id');
  assert.match(actionFailed.payload.error, /Unknown session/);
  checkpoint('failed actions produce correlated errors');

  // models/* envelopes over the WS bus previously failed channel validation.
  const modelsRefreshed = nextMessage(socket, (value) => value.type === 'snapshot' && Array.isArray(value.payload.models));
  send(socket, 'models/control', 'refresh', {});
  await modelsRefreshed; checkpoint('models channel envelope accepted');

  // Tracker surface: the temp workspace has no GitHub remote — errors surface over the bus and the empty cache stays stale.
  assert.equal(snapshot.payload.tracker.repo, null);
  const trackerState = nextMessage(socket, (value) => value.channel === 'tracker/state');
  const refreshed = await control(controlPath, 'tracker.refresh');
  assert.equal(refreshed.ok, false); assert.match(refreshed.error, /no GitHub origin remote/);
  await trackerState; checkpoint('tracker error surfaced');
  const board = await control(controlPath, 'tracker.list');
  assert.deepEqual(board.columns, []); assert.equal(board.cards.length, 0); assert.equal(board.stale, true);
  const moveReject = await control(controlPath, 'tracker.move', {number: 1, column: 'todo'});
  assert.equal(moveReject.ok, false); assert.match(moveReject.error, /Unknown card/);
  checkpoint('tracker controls verified');

  send(socket, 'session/control', 'setModel', {sessionId: 'host', model: 'fixture/fast'});
  send(socket, 'session/control', 'setThinking', {sessionId: 'host', thinking: 'low'});
  await nextMessage(socket, (value) => value.type === 'updated' && value.payload?.thinking === 'low');
  send(socket, 'session/control', 'rename', {sessionId: 'host', name: 'My Workspace'});
  await nextMessage(socket, (value) => value.type === 'updated' && value.payload?.name === 'My Workspace');
  const prefs = JSON.parse(fs.readFileSync(path.join(workspace, '.pi', 'pif', 'prefs.json'), 'utf8'));
  assert.equal(prefs.model, 'fixture/fast'); assert.equal(prefs.thinking, 'low'); assert.equal(prefs.name, 'My Workspace');
  const sessionFile = path.join(workspace, '.pi', 'pif', 'sessions', `${sessionId}.jsonl`);
  fs.appendFileSync(sessionFile, JSON.stringify({type: 'message', message: {role: 'user', content: [{type: 'text', text: 'restored input'}]}}) + '\n');
  const port2 = await reservePort();
  pi2 = await startPi({workspace, port: port2, piBin, appDir, globalCatalog, modelsPath, hostSessionFile});
  socket2 = new WebSocket(`ws://127.0.0.1:${port2}/pif?token=integration-token`);
  await new Promise((resolve, reject) => { socket2.addEventListener('open', resolve, {once: true}); socket2.addEventListener('error', reject, {once: true}); });
  send(socket2, 'shell/state', 'snapshot_request', {});
  const restarted = await nextMessage(socket2, (value) => value.type === 'snapshot');
  assert.equal(restarted.payload.sessions.host.model, 'fixture/fast');
  assert.equal(restarted.payload.sessions.host.thinking, 'low');
  assert.equal(restarted.payload.sessions.host.name, 'My Workspace');
  const restored = restarted.payload.sessions[sessionId];
  assert.equal(restored.name, 'Researcher');
  assert.equal(restored.state, 'ended');
  // Metadata-only restore: the transcript hydrates from `.jsonl` on demand.
  send(socket2, 'session/control', 'transcript', {sessionId});
  const restoredHistory = await nextMessage(socket2, (value) => value.type === 'history' && value.payload?.sessionId === sessionId);
  assert.ok(restoredHistory.payload.transcript.length > 0, 'hydrated transcript carries history after restart');
  assert.ok(restoredHistory.payload.transcript.some((entry) => entry.type === 'input' && entry.content === 'restored input'), 'persisted user messages hydrate as input');
  // Console input automatically resumes an ended session against its
  // existing session file before sending the prompt.
  const resumedMsg = nextMessage(socket2, (value) => value.type === 'updated' && value.payload?.id === sessionId && value.payload?.state === 'idle');
  const resumedStream = nextMessage(socket2, (value) => value.channel === 'session/event' && value.payload.sessionId === sessionId && value.type === 'message_update');
  send(socket2, 'session/control', 'input', {sessionId, content: 'back again'});
  await resumedMsg;
  const streamedAgain = await resumedStream;
  assert.equal(streamedAgain.payload.event.delta, 'back again');
  checkpoint('session resumed from history');
  const removedMsg = nextMessage(socket2, (value) => value.type === 'removed' && value.payload?.sessionId === sessionId);
  send(socket2, 'session/control', 'delete', {sessionId});
  await removedMsg;
  send(socket2, 'shell/state', 'snapshot_request', {});
  const afterDelete = await nextMessage(socket2, (value) => value.type === 'snapshot');
  assert.equal(afterDelete.payload.sessions[sessionId], undefined);
  // The host card is removable too. Its live parent session stays intact;
  // only the rail card is removed, and the host transcript file remains owned
  // by the parent pi process.
  const hostRemoved = nextMessage(socket2, (value) => value.type === 'removed' && value.payload?.sessionId === 'host');
  send(socket2, 'session/control', 'delete', {sessionId: 'host'});
  await hostRemoved;
  assert.ok(fs.existsSync(hostSessionFile), 'deleting the host card must not unlink the live host transcript');
  send(socket2, 'shell/state', 'snapshot_request', {});
  const afterHostDelete = await nextMessage(socket2, (value) => value.type === 'snapshot');
  assert.equal(afterHostDelete.payload.sessions.host, undefined, 'host card is removable');
  const hostInputFailed = nextMessage(socket2, (value) => value.channel === 'shell/error' && value.type === 'action_failed');
  send(socket2, 'session/control', 'input', {sessionId: 'host', content: 'after delete'});
  const hostError = await hostInputFailed;
  assert.match(hostError.payload.error, /Host session has been deleted/);
  checkpoint('sessions persist, restore, and delete');
  send(socket2, 'shell/state', 'shutdown_request', {});
  await waitFor(() => pi2.exitCode != null || pi2.signalCode != null, 'pi2 shutdown via shutdown_request', 15_000);
  await closeWebSocket(socket2);
  await shutdownChild(pi2);
  checkpoint('adopted standalone hub shuts down over the bus');

  await rpc(pi, {type: 'prompt', message: '/pif-stop'});
  await waitFor(() => fs.existsSync(path.join(workspace, 'fake-child.stopped')), 'child termination');
  await closeWebSocket(socket);
  await shutdownChild(pi);
  checkpoint('pi exited');
});

test('real Flutter supervisor boots the macOS shell and performs a machine-protocol reload', {timeout: 180_000}, async (t) => {
  const workspace = tempDir('pif-flutter-smoke-');
  let pi;
  let socket;
  t.after(async () => {
    await closeWebSocket(socket);
    await shutdownChild(pi);
    fs.rmSync(workspace, {recursive: true, force: true});
  });
  const appDir = copyFixture(workspace, false);
  const globalCatalog = path.join(workspace, '.pi', 'pif', 'catalog');
  const modelsPath = path.join(workspace, '.pi', 'agent', 'models.json');
  const hostSessionFile = path.join(workspace, '.pi', 'pif', 'sessions', 'host.jsonl');
  const port = await reservePort();
  pi = await startPi({workspace, port, piBin: fakePi(workspace), launchFlutter: true, appDir, globalCatalog, modelsPath, hostSessionFile});
  const controlPath = path.join(workspace, '.pi', 'pif', 'control.sock');
  const status = await waitFor(async () => {
    const value = await control(controlPath, 'shell.status');
    return value.health.flutter === 'running' ? value : false;
  }, 'Flutter app.start machine event', 90_000);
  assert.equal(status.health.hub, 'running');
  assert.equal(status.health.flutter, 'running');
  const reload = await control(controlPath, 'shell.reload', {restart: false});
  assert.equal(reload.error, undefined);
  socket = new WebSocket(`ws://127.0.0.1:${port}/pif?token=integration-token`);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, {once: true}); socket.addEventListener('error', reject, {once: true}); });
  send(socket, 'shell/state', 'snapshot_request', {});
  const snapshot = await nextMessage(socket, (value) => value.type === 'snapshot');
  assert.equal(snapshot.payload.widgets.diff_viewer.enabled, true);
  await rpc(pi, {type: 'prompt', message: '/pif-stop'});
  await closeWebSocket(socket);
  await shutdownChild(pi);
});

test('pif_app_init scaffolds a runnable app; the manifest reaches the snapshot (#157)', {timeout: 180_000}, async (t) => {
  const checkpoint = (name) => console.error(`[pif-app-init] ${name}`);
  const workspace = tempDir('pif-app-init-');
  const appRoot = tempDir('pif-app-init-app-');
  let pi;
  let socket;
  t.after(async () => {
    await closeWebSocket(socket);
    await shutdownChild(pi);
    fs.rmSync(workspace, {recursive: true, force: true});
    fs.rmSync(appRoot, {recursive: true, force: true});
  });
  const appDir = copyFixture(appRoot);
  const port = await reservePort();
  const globalCatalog = path.join(workspace, '.pi', 'pif', 'catalog');
  const modelsPath = path.join(workspace, '.pi', 'agent', 'models.json');
  const hostSessionFile = path.join(workspace, '.pi', 'pif', 'sessions', 'host.jsonl');
  pi = await startPi({workspace, port, piBin: fakePi(workspace), globalCatalog, appDir, modelsPath, hostSessionFile});
  checkpoint('hub started');
  const controlPath = path.join(workspace, '.pi', 'pif', 'control.sock');
  await waitFor(() => fs.existsSync(controlPath), 'control socket appears');
  socket = new WebSocket(`ws://127.0.0.1:${port}/pif?token=integration-token`);
  const initialSnapshot = nextMessage(socket, (value) => value.type === 'snapshot');
  const [, initial] = await Promise.all([new Promise((resolve, reject) => { socket.addEventListener('open', resolve, {once: true}); socket.addEventListener('error', reject, {once: true}); }), initialSnapshot]);
  assert.equal(initial.payload.app, null);
  const initializedSnapshot = nextMessage(socket, (value) => value.type === 'snapshot' && value.payload.app?.id === 'notes-trial', 150_000);
  const [init, committedInit] = await Promise.all([control(controlPath, 'pif_app.init', {name: 'Notes Trial', template: 'mercury'}), initializedSnapshot]);
  assert.equal(init.ok, true);
  assert.equal(init.id, 'notes-trial');
  assert.equal(init.template, 'mercury');
  assert.ok(fs.existsSync(path.join(workspace, 'pif_app', 'app.yaml')), 'manifest written');
  assert.ok(fs.existsSync(path.join(workspace, 'pif_app', 'template', 'template.yaml')), 'mercury layers pinned into the project');
  assert.ok(fs.existsSync(path.join(workspace, 'pif_app', 'widgets', 'home', 'home.dart')), 'home page scaffolded');
  assert.deepEqual(committedInit.payload.app.pages, ['home']);
  checkpoint('init done (template pinned, home installed through the analyzer gate)');
  const pageSnapshot = nextMessage(socket, (value) => value.type === 'snapshot' && value.payload.app?.pages.includes('settings'), 120_000);
  const [page, committedPage] = await Promise.all([control(controlPath, 'pif_app.page_add', {name: 'Settings', id: 'settings'}), pageSnapshot]);
  assert.deepEqual(page.pages, ['home', 'settings']);
  assert.deepEqual(committedPage.payload.app.pages, ['home', 'settings']);
  const homeSnapshot = nextMessage(socket, (value) => value.type === 'snapshot' && value.payload.app?.home === 'settings');
  const [home, snapshot] = await Promise.all([control(controlPath, 'pif_app.home_set', {id: 'settings'}), homeSnapshot]);
  assert.equal(home.home, 'settings');
  // pif_app.build dispatches a REAL export build (minutes; #159 verified
  // live) — do not call it in tests: the orphaned build locks pub and
  // hangs the smoke suite.
  const list = await control(controlPath, 'pif_app.list', {});
  assert.equal(list.manifest.pages.join(','), 'home,settings');
  assert.equal(list.widgets[0].installed, true, 'home page installed');
  // This is the original connection: each mutation publishes without a
  // reconnect or snapshot_request hiding a missing broadcast.
  assert.equal(snapshot.payload.app.id, 'notes-trial');
  assert.equal(snapshot.payload.app.home, 'settings');
  assert.deepEqual(snapshot.payload.app.pages, ['home', 'settings']);
  assert.equal(snapshot.payload.widgets.home.source, 'project', 'scaffolded page registers from the project overlay');
  checkpoint('manifest live in the snapshot — app mode is armed');
  const devSnapshot = nextMessage(socket, (value) => value.type === 'snapshot' && value.payload.devMode === true);
  const [devResult, devEvent] = await Promise.all([control(controlPath, 'shell.dev_mode', {enabled: true}), devSnapshot]);
  assert.equal(devResult.devMode, true);
  assert.equal(devEvent.payload.devMode, true);
  const appSnapshot = nextMessage(socket, (value) => value.type === 'snapshot' && value.payload.devMode === false);
  send(socket, 'shell/control', 'dev_mode_set', {enabled: false});
  assert.equal((await appSnapshot).payload.devMode, false);
  assert.equal((await control(controlPath, 'shell.status')).devMode, false);
  await assert.rejects(control(controlPath, 'shell.dev_mode', {enabled: 'true'}), /requires/);
  await control(controlPath, 'shell.dev_mode', {enabled: true});
  await closeWebSocket(socket);
  await shutdownChild(pi);
  pi = await startPi({workspace, port, piBin: fakePi(workspace), globalCatalog, appDir, modelsPath, hostSessionFile});
  socket = new WebSocket(`ws://127.0.0.1:${port}/pif?token=integration-token`);
  const restartedSnapshot = nextMessage(socket, (value) => value.type === 'snapshot');
  const [, restarted] = await Promise.all([new Promise((resolve, reject) => { socket.addEventListener('open', resolve, {once: true}); socket.addEventListener('error', reject, {once: true}); }), restartedSnapshot]);
  assert.equal(restarted.payload.app.home, 'settings', 's-prefixed home survives a real hub restart');
  assert.deepEqual(restarted.payload.app.pages, ['home', 'settings']);
  assert.equal(restarted.payload.devMode, true, 'source dev preference survives restart and reconnect');
  checkpoint('home and dev mode survived a real hub restart');
});
