import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '..');
const extension = path.join(repo, 'extensions', 'pif.ts');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, message, timeout = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) { try { const value = await check(); if (value) return value; } catch {} await delay(50); }
  throw new Error(`Timed out: ${message}`);
}

function control(socketPath, method, params = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath); let raw = '';
    socket.on('connect', () => socket.write(JSON.stringify({method, params}) + '\n'));
    socket.on('data', (chunk) => raw += chunk);
    socket.on('end', () => { try { const value = JSON.parse(raw); value.ok ? resolve(value.result) : reject(new Error(value.error)); } catch (error) { reject(error); } });
    socket.on('error', reject);
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
    const timer = setTimeout(() => { socket.removeEventListener('message', listener); reject(new Error('WebSocket message timeout')); }, timeout);
    const listener = (event) => { const value = JSON.parse(event.data); if (!predicate(value)) return; clearTimeout(timer); socket.removeEventListener('message', listener); resolve(value); };
    socket.addEventListener('message', listener);
  });
}

function send(socket, channel, type, payload) { socket.send(JSON.stringify({v: 1, id: `${Date.now()}`, ts: new Date().toISOString(), channel, type, payload})); }

function copyFixture(workspace, removeDogfood = true) {
  const target = path.join(workspace, 'pif'); fs.mkdirSync(target, {recursive: true});
  for (const name of ['lib', 'catalog', '.dart_tool', 'macos']) fs.cpSync(path.join(repo, 'pif', name), path.join(target, name), {recursive: true});
  if (removeDogfood) fs.rmSync(path.join(target, 'lib', 'widgets', 'diff_viewer'), {recursive: true, force: true});
  for (const name of ['pubspec.yaml', 'pubspec.lock', 'analysis_options.yaml', '.metadata']) fs.copyFileSync(path.join(repo, 'pif', name), path.join(target, name));
}

function fakePi(workspace) {
  const file = path.join(workspace, 'fake-pi.mjs');
  fs.writeFileSync(file, `#!/usr/bin/env node\nimport fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(path.join(workspace, 'fake-child.pid'))}, String(process.pid));\nfs.writeFileSync(${JSON.stringify(path.join(workspace, 'fake-child.env.json'))}, JSON.stringify({autostart: process.env.PIF_AUTOSTART ?? null, noFlutter: process.env.PIF_NO_FLUTTER ?? null, port: process.env.PIF_PORT ?? null}));\nlet b=''; process.stdin.on('data',c=>{b+=c;let i;while((i=b.indexOf('\\n'))>=0){const l=b.slice(0,i);b=b.slice(i+1);if(!l)continue;const q=JSON.parse(l);process.stdout.write(JSON.stringify({type:'message_update',delta:q.message||'',command:q.type})+'\\n');if(q.type==='abort')process.stdout.write(JSON.stringify({type:'agent_end',aborted:true})+'\\n');else process.stdout.write(JSON.stringify({type:'agent_end'})+'\\n');}});\nprocess.on('SIGTERM',()=>{fs.writeFileSync(${JSON.stringify(path.join(workspace, 'fake-child.stopped'))},'yes');process.exit(0)});\n`);
  fs.chmodSync(file, 0o755); return file;
}

async function startPi({workspace, port, piBin, launchFlutter = false, modelsPath = null, token = 'integration-token'}) {
  const child = spawn('pi', ['--mode', 'rpc', '--offline', '--no-session', '-ne', '-e', extension], {cwd: workspace, env: {...process.env, PIF_AUTOSTART: '1', PIF_TOKEN: token, ...(launchFlutter ? {} : {PIF_NO_FLUTTER: '1'}), PIF_PORT: String(port), PIF_PI_BIN: piBin, ...(modelsPath ? {PIF_MODELS_PATH: modelsPath} : {})}, stdio: ['pipe', 'pipe', 'pipe']});
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => stdout += chunk);
  child.stderr.on('data', (chunk) => stderr += chunk);
  try {
    child.stdin.write(JSON.stringify({type: 'get_state'}) + '\n');
    await waitFor(() => stdout.includes('"command":"get_state"'), `pi RPC start: ${stderr || stdout}`);
    await waitFor(() => fetch(`http://127.0.0.1:${port}`).then((response) => response.ok), `hub start: ${stderr || stdout}`);
    return child;
  } catch (error) {
    child.kill('SIGKILL');
    throw error;
  }
}

test('real hub smoke covers snapshot, RPC child, analyze gate, catalog, layout, and shutdown', {timeout: 120_000}, async (t) => {
  const checkpoint = (name) => console.error(`[pif-smoke] ${name}`);
  checkpoint('setup');
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'pif-smoke-')); copyFixture(workspace); const piBin = fakePi(workspace); const port = 32000 + Math.floor(Math.random() * 1000);
  const modelsPath = path.join(workspace, 'models-fixture.json'); fs.writeFileSync(modelsPath, JSON.stringify({providers: {fixture: {models: [{id: 'old'}]}}, customKey: 'keep-me'}, null, 2));
  const pi = await startPi({workspace, port, piBin: fakePi(workspace), modelsPath}); checkpoint('hub started'); t.after(() => { if (pi.exitCode == null) pi.kill('SIGKILL'); fs.rmSync(workspace, {recursive: true, force: true}); });
  const tokenFile = path.join(workspace, '.pi', 'pif', 'token');
  assert.equal(fs.readFileSync(tokenFile, 'utf8'), 'integration-token');
  const openFail = (url) => new Promise((resolve, reject) => { const socket = new WebSocket(url); socket.addEventListener('open', () => { socket.close(); resolve(); }, {once: true}); socket.addEventListener('error', () => reject(new Error('connection rejected')), {once: true}); });
  await assert.rejects(() => openFail(`ws://127.0.0.1:${port}/pif`), /rejected/);
  await assert.rejects(() => openFail(`ws://127.0.0.1:${port}/pif?token=wrong-token-value`), /rejected/);
  checkpoint('unauthenticated connections rejected');
  const socket = new WebSocket(`ws://127.0.0.1:${port}/pif?token=integration-token`); await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, {once: true}); socket.addEventListener('error', reject, {once: true}); });
  send(socket, 'shell/state', 'snapshot_request', {}); const snapshot = await nextMessage(socket, (value) => value.type === 'snapshot');
  checkpoint('snapshot received');
  assert.equal(snapshot.payload.health.hub, 'running'); assert.equal(snapshot.payload.widgets.agent_console.core, true); assert.equal(snapshot.payload.widgets.diff_viewer, undefined);
  assert.equal(snapshot.payload.health.origin, 'standalone');

  const createdPromise = nextMessage(socket, (value) => value.type === 'created');
  send(socket, 'session/control', 'spawn', {cwd: workspace, model: 'fake'});
  const created = await createdPromise;
  const sessionId = created.payload.id; assert.match(sessionId, /^session_/);
  const childEnv = JSON.parse(await waitFor(() => fs.existsSync(path.join(workspace, 'fake-child.env.json')) ? fs.readFileSync(path.join(workspace, 'fake-child.env.json'), 'utf8') : false, 'child env dump'));
  assert.equal(childEnv.autostart, null); assert.equal(childEnv.noFlutter, null); assert.equal(childEnv.port, null);
  const streamPromise = nextMessage(socket, (value) => value.channel === 'session/event' && value.payload.sessionId === sessionId && value.type === 'message_update');
  send(socket, 'session/control', 'input', {sessionId, content: 'hello'});
  const streamed = await streamPromise; checkpoint('child streamed'); assert.equal(streamed.payload.event.delta, 'hello');
  const steerPromise = nextMessage(socket, (value) => value.channel === 'session/event' && value.payload.event?.delta === 'turn');
  send(socket, 'session/control', 'steer', {sessionId, content: 'turn'});
  const steered = await steerPromise; assert.equal(steered.payload.event.command, 'steer');
  const abortPromise = nextMessage(socket, (value) => value.channel === 'session/event' && value.payload.event?.aborted === true);
  send(socket, 'session/control', 'abort', {sessionId});
  await abortPromise; checkpoint('child controls complete');

  const controlPath = path.join(workspace, '.pi', 'pif', 'control.sock');
  const scaffold = await control(controlPath, 'widget.create', {id: 'diff_viewer', name: 'Diff Viewer', slot: 'center', spec: 'Compare before and after text'});
  assert.ok(fs.existsSync(scaffold.manifest));
  fs.writeFileSync(scaffold.source, `import 'package:flutter/material.dart';\nimport '../../core/plugin.dart';\nclass DiffViewerPlugin implements PifWidgetPlugin {\n @override PifWidgetMeta get meta => const PifWidgetMeta(id: 'diff_viewer', name: 'Diff Viewer', slot: PifSlot.center);\n @override Widget build(BuildContext context, PifHost host) => const Row(children:[Expanded(child:SelectableText('before')),VerticalDivider(),Expanded(child:SelectableText('after'))]);\n}\n`);
  checkpoint('dogfood scaffolded');
  const dogfood = await control(controlPath, 'widget.install', {id: 'diff_viewer'}); checkpoint('dogfood installed'); assert.equal(dogfood.ok, true); assert.match(dogfood.diagnostics, /No issues found/);
  await control(controlPath, 'layout', {action: 'open', widgetId: 'diff_viewer', slot: 'center'});
  const dogfoodSnapshotPromise = nextMessage(socket, (value) => value.type === 'snapshot' && value.payload.widgets.diff_viewer);
  send(socket, 'shell/state', 'snapshot_request', {}); const dogfoodSnapshot = await dogfoodSnapshotPromise;
  assert.equal(dogfoodSnapshot.payload.widgets.diff_viewer.enabled, true);
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
  await assert.rejects(() => control(controlPath, 'widget.uninstall', {id: 'agent_console'}), /Core widget/);
  await control(controlPath, 'layout', {action: 'move', widgetId: 'diff_viewer', slot: 'right'}); assert.equal(JSON.parse(fs.readFileSync(path.join(workspace, '.pi', 'pif', 'layout.json'))).panels.diff_viewer.slot, 'right');
  const resetState = nextMessage(socket, (value) => value.type === 'layout_state' && Object.keys(value.payload.panels ?? {}).length === 0);
  await control(controlPath, 'layout', {action: 'reset'});
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(workspace, '.pi', 'pif', 'layout.json'))).panels, {});
  await resetState; checkpoint('layout reset verified');

  await assert.rejects(() => control(controlPath, 'widget.install', {id: '../../escape'}), /snake_case/);
  await assert.rejects(() => control(controlPath, 'models.save', {providers: 'not-an-object'}), /providers object/);
  await assert.rejects(() => control(controlPath, 'models.save', {providers: {broken: {models: 'nope'}}}), /models must be an array/);
  const savedModels = await control(controlPath, 'models.save', {providers: {fixture: {models: [{id: 'new'}]}}});
  assert.equal(savedModels.ok, true);
  const savedFile = JSON.parse(fs.readFileSync(modelsPath, 'utf8'));
  assert.equal(savedFile.customKey, 'keep-me'); assert.equal(savedFile.providers.fixture.models[0].id, 'new');
  assert.ok(fs.readdirSync(workspace).some((name) => name.startsWith('models-fixture.json.bak-')), 'backup written');
  checkpoint('input hardening verified');

  send(socket, 'session/control', 'setModel', {sessionId: 'host', model: 'fixture/fast'});
  send(socket, 'session/control', 'setThinking', {sessionId: 'host', thinking: 'low'});
  await nextMessage(socket, (value) => value.type === 'updated' && value.payload?.thinking === 'low');
  const prefs = JSON.parse(fs.readFileSync(path.join(workspace, '.pi', 'pif', 'prefs.json'), 'utf8'));
  assert.equal(prefs.model, 'fixture/fast'); assert.equal(prefs.thinking, 'low');
  const port2 = 34000 + Math.floor(Math.random() * 500);
  const pi2 = await startPi({workspace, port: port2, piBin});
  const socket2 = new WebSocket(`ws://127.0.0.1:${port2}/pif?token=integration-token`);
  await new Promise((resolve, reject) => { socket2.addEventListener('open', resolve, {once: true}); socket2.addEventListener('error', reject, {once: true}); });
  send(socket2, 'shell/state', 'snapshot_request', {});
  const restarted = await nextMessage(socket2, (value) => value.type === 'snapshot');
  assert.equal(restarted.payload.sessions.host.model, 'fixture/fast');
  assert.equal(restarted.payload.sessions.host.thinking, 'low');
  send(socket2, 'shell/state', 'shutdown_request', {});
  await waitFor(() => pi2.exitCode != null ? true : false, 'pi2 shutdown via shutdown_request', 15_000);
  socket2.close();
  checkpoint('adopted standalone hub shuts down over the bus');

  await rpc(pi, {type: 'prompt', message: '/pif-stop'});
  await waitFor(() => fs.existsSync(path.join(workspace, 'fake-child.stopped')), 'child termination');
  socket.close(); pi.kill('SIGTERM'); checkpoint('waiting pi exit'); await new Promise((resolve) => pi.once('exit', resolve)); checkpoint('pi exited');
});

test('real Flutter supervisor boots the macOS shell and performs a machine-protocol reload', {timeout: 180_000}, async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'pif-flutter-smoke-'));
  copyFixture(workspace, false);
  const port = 33000 + Math.floor(Math.random() * 1000);
  const pi = await startPi({workspace, port, piBin: fakePi(workspace), launchFlutter: true});
  t.after(() => { if (pi.exitCode == null) pi.kill('SIGKILL'); fs.rmSync(workspace, {recursive: true, force: true}); });
  const controlPath = path.join(workspace, '.pi', 'pif', 'control.sock');
  const status = await waitFor(async () => {
    const value = await control(controlPath, 'shell.status');
    return value.health.flutter === 'running' ? value : false;
  }, 'Flutter app.start machine event', 90_000);
  assert.equal(status.health.hub, 'running');
  assert.equal(status.health.flutter, 'running');
  const reload = await control(controlPath, 'shell.reload', {restart: false});
  assert.equal(reload.error, undefined);
  const socket = new WebSocket(`ws://127.0.0.1:${port}/pif?token=integration-token`);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, {once: true}); socket.addEventListener('error', reject, {once: true}); });
  send(socket, 'shell/state', 'snapshot_request', {});
  const snapshot = await nextMessage(socket, (value) => value.type === 'snapshot');
  assert.equal(snapshot.payload.widgets.diff_viewer.enabled, true);
  await rpc(pi, {type: 'prompt', message: '/pif-stop'});
  socket.close();
  pi.kill('SIGTERM');
  await new Promise((resolve) => pi.once('exit', resolve));
});
