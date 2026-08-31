import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
const repo = path.resolve(import.meta.dirname, '..');
import { __test as __shared, createEnvelope, decodeEnvelope, dartFileUri, generateWidgetRegistry, parseWidgetManifest, assertSafeWidgetPath, assertWritablePifPath, isInsideAppBundle, childEnvironment, extractPifToken, pifProbeProof, pifProbeValid, pifUpgradeAuthorized } from './pif-shared.ts';
import { parseBoardConfig, defaultBoardConfig, columnForCard, normalizeGhIssue, plannedTrackerMove, TrackerSync, trackerParentRef, trackerExcerpt, plannedLabelChange, parseAppManifest, renderAppManifest, addAppPage, setAppHome, slugifyAppId } from './pif-shared.ts';
import { __test as __pif } from './pif.ts';

const manifest = `id: alpha_widget\nname: "Alpha"\nversion: 0.1.0\ndescription: "Fixture"\nslot: center\ncore: false\ntags: [test, golden]\ndart_dependencies: []\n`;
const tempDir = (prefix) => fs.mkdtempSync(path.join('/tmp', prefix));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, message, timeout = 5_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const value = await check();
      if (value) return value;
    } catch {}
    await delay(25);
  }
  throw new Error(`Timed out: ${message}`);
}

function makeBuildChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write() {}, end() {} };
  child.exitCode = null;
  child.signalCode = null;
  child.killCalls = [];
  child.kill = (signal = 'SIGTERM') => {
    child.killCalls.push(signal);
    child.signalCode = signal;
    return true;
  };
  child.emitSpawn = () => child.emit('spawn');
  child.emitClose = (code = 0, signal = null) => {
    child.exitCode = code;
    child.signalCode = signal;
    child.emit('close', code, signal);
  };
  child.emitError = (error) => child.emit('error', error instanceof Error ? error : new Error(String(error)));
  return child;
}

function patchBuildSpawn(plans) {
  const originalSpawn = childProcess.spawn;
  const harness = { calls: [], children: [], plans: plans.map((plan) => ({...plan})) };
  childProcess.spawn = (command, args) => {
    harness.calls.push({command, args});
    const plan = harness.plans.shift();
    if (!plan) throw new Error(`Unexpected spawn: ${command}`);
    if (plan.kind === 'throw') throw new Error(plan.message);
    const child = makeBuildChild();
    harness.children.push(child);
    if (plan.kind === 'error') {
      queueMicrotask(() => {
        child.emitError(plan.error ?? new Error(plan.message ?? 'spawn failed'));
        queueMicrotask(() => child.emitClose(plan.code ?? 127, plan.signal ?? null));
      });
    }
    return child;
  };
  syncBuiltinESMExports();
  return {
    harness,
    restore() {
      childProcess.spawn = originalSpawn;
      syncBuiltinESMExports();
    },
  };
}

test('pif envelope codec accepts all protocol channels and rejects malformed data', () => {
  for (const channel of ['session/state', 'widget/registry', 'store/catalog', 'models/save', 'tracker/state', 'shell/state', 'app/build']) {
    const env = createEnvelope(channel, 'fixture', {ok: true}, 'fixed');
    assert.deepEqual(decodeEnvelope(JSON.stringify(env)), env);
  }
  assert.throws(() => decodeEnvelope('{"v":2}'), /Invalid pif envelope/);
  assert.throws(() => createEnvelope('network/state', 'bad', {}), /Unsupported/);
});

test('bundle write guard resolves symlinks before dot-dot and missing descendants (#187)', (t) => {
  const root = tempDir('pif-write-guard-');
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const resources = path.join(root, 'Fixture.app', 'Contents', 'Resources');
  const safe = path.join(root, 'safe');
  fs.mkdirSync(resources, {recursive: true});
  fs.mkdirSync(safe);
  fs.symlinkSync(resources, path.join(root, 'link'));
  fs.symlinkSync(path.join(root, 'Fixture.app'), path.join(root, 'bundle-alias'));
  const outwardContents = path.join(root, 'Outward.app', 'Contents');
  fs.mkdirSync(outwardContents, {recursive: true});
  fs.symlinkSync(safe, path.join(outwardContents, 'Resources'));
  const rejected = [
    path.join(resources, 'new', 'data'),
    `${root}/link/data`,
    `${root}/link/../data`,
    `${root}/missing/../link/data`,
    `${root}/bundle-alias/Contents/new/data`,
    path.join(outwardContents, 'Resources', 'new-data'),
  ];
  for (const candidate of rejected) {
    assert.equal(isInsideAppBundle(candidate), true, candidate);
    assert.throws(() => assertWritablePifPath(candidate), /bundle/i, candidate);
  }
  const safeReal = fs.realpathSync(safe);
  for (const candidate of [path.join(safe, 'new', 'data'), path.relative(process.cwd(), path.join(safe, 'new', 'data'))]) {
    assert.equal(isInsideAppBundle(candidate), false);
    assert.equal(assertWritablePifPath(candidate), path.join(safeReal, 'new', 'data'));
  }
  assert.equal(assertWritablePifPath(`${root}/missing/../safe/data`), path.join(safeReal, 'data'));
  fs.symlinkSync('absent-target', path.join(root, 'broken'));
  fs.symlinkSync('loop-b', path.join(root, 'loop-a'));
  fs.symlinkSync('loop-a', path.join(root, 'loop-b'));
  fs.writeFileSync(path.join(root, 'regular-file'), 'DATA');
  for (const candidate of [`${root}/broken/data`, `${root}/loop-a/data`, `${root}/regular-file/data`]) {
    assert.throws(() => isInsideAppBundle(candidate));
    assert.throws(() => assertWritablePifPath(candidate));
  }
  assert.deepEqual(fs.readdirSync(resources), [], 'guard checks never create destination files');
  assert.deepEqual(fs.readdirSync(safe), [], 'lexical bundle alias never writes through an outward link');
});

test('widget manifest parsing validates contract and dependencies', () => {
  const parsed = parseWidgetManifest(manifest.replace('dart_dependencies: []', 'dart_dependencies: [path_provider]'));
  assert.equal(parsed.id, 'alpha_widget');
  assert.deepEqual(parsed.tags, ['test', 'golden']);
  assert.deepEqual(parsed.dart_dependencies, ['path_provider']);
  assert.throws(() => parseWidgetManifest(manifest.replace('slot: center', 'slot: nowhere')), /Invalid widget slot/);
});

test('registry codegen matches deterministic golden', () => {
  const actual = generateWidgetRegistry([parseWidgetManifest(manifest)]);
  assert.equal(actual, `// GENERATED BY pif. DO NOT EDIT.\nimport 'core/plugin.dart';\nimport 'widgets/alpha_widget/alpha_widget.dart';\n\nMap<String, PifWidgetPlugin Function()> pifWidgetFactories() {\n  return {\n    'alpha_widget': () => AlphaWidgetPlugin(),\n  };\n}\n`);
});

test('widget path guard line-stops traversal outside managed roots', () => {
  const root = path.join('/tmp', 'pif', 'lib', 'widgets');
  assert.equal(assertSafeWidgetPath(root, path.join(root, 'safe')), path.join(root, 'safe'));
  assert.throws(() => assertSafeWidgetPath(root, path.join(root, '..', '..', 'main.dart')), /escapes/);
});

test('child environment scrubs hub lifecycle variables and credentials', () => {
  const child = childEnvironment({PIF_AUTOSTART: '1', PIF_NO_FLUTTER: '1', PIF_PORT: '31415', PIF_TOKEN: 'secret-token', PIF_ALLOWED_ORIGINS: 'https://app.local', PIF_PI_BIN: '/fake/pi', PATH: '/usr/bin'});
  assert.equal(child.PIF_AUTOSTART, undefined);
  assert.equal(child.PIF_NO_FLUTTER, undefined);
  assert.equal(child.PIF_PORT, undefined);
  assert.equal(child.PIF_TOKEN, undefined, 'children must not inherit the hub token');
  assert.equal(child.PIF_ALLOWED_ORIGINS, undefined);
  assert.equal(child.PIF_PI_BIN, '/fake/pi');
  assert.equal(child.PATH, '/usr/bin');
});

test('packaged hubs resolve the bundled pi runtime for child sessions', () => {
  const source = fs.readFileSync(path.join(repo, 'extensions', 'pif.ts'), 'utf8');
  assert.match(source, /function resolvePiInvocation\(extensionPath: string\)/);
  assert.match(source, /const resources = path\.resolve\(path\.dirname\(extensionPath\), "\.\."\)/);
  assert.match(source, /spawn\(pi\.command, args/);
  assert.doesNotMatch(source, /spawn\(process\.env\.PIF_PI_BIN \|\| "pi"/);
});

test('malformed percent-encoding in the upgrade URL does not throw', () => {
  const token = 'a'.repeat(64);
  assert.equal(extractPifToken('/pif?token=%zz'), null);
  assert.equal(extractPifToken(`/pif?other=1&token=${token}`), token, 'valid pairs still parse');
});

test('hub upgrade authorization requires token and allowlisted browser origins', () => {
  const token = 'a'.repeat(64);
  assert.equal(extractPifToken('/pif?token=' + token), token);
  assert.equal(extractPifToken('/pif'), null);
  assert.equal(extractPifToken('/pif?other=1'), null);
  assert.equal(pifUpgradeAuthorized('/pif?token=' + token, undefined, token), true);
  assert.equal(pifUpgradeAuthorized('/pif?token=' + 'b'.repeat(64), undefined, token), false);
  assert.equal(pifUpgradeAuthorized('/pif', undefined, token), false);
  assert.equal(pifUpgradeAuthorized('/pif?token=' + token, 'https://evil.example', token), false);
  assert.equal(pifUpgradeAuthorized('/pif?token=' + token, 'https://app.local', token, ['https://app.local']), true);
});

test('probe proof is an HMAC of the nonce under the hub token', async () => {
  const { createHmac } = await import('node:crypto');
  const token = 't'.repeat(64);
  const nonce = 'nonce-value';
  assert.equal(pifProbeProof(nonce, token), createHmac('sha256', token).update(nonce).digest('hex'));
  assert.equal(pifProbeValid(nonce, token, pifProbeProof(nonce, token)), true);
  assert.equal(pifProbeValid(nonce, token, '0'.repeat(64)), false);
  assert.equal(pifProbeValid(nonce, 'other-token', pifProbeProof(nonce, token)), false);
  assert.equal(pifProbeValid(nonce, token, null), false);
  assert.equal(pifProbeValid(nonce, token, undefined), false);
});

test('hub source preserves phase-one process and analyze gates', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(new URL('./pif.ts', import.meta.url), 'utf8'));
  assert.match(source, /dart[^\n]+analyze/);
  assert.match(source, /--mode", "rpc"/);
  assert.match(source, /flutter[^\n]+run/);
  assert.match(source, /child\.kill\("SIGTERM"\)/);
  assert.match(source, /Core widget .* cannot be uninstalled/);
});

test('board config parsing validates column blocks', () => {
  const config = parseBoardConfig('# board\n\ncolumn todo:\n  name: To Do\n  label: status:todo\n\ncolumn doing:\n  name: Doing\n  label: status:doing\n\ncolumn shipped:\n  name: Shipped\n  state: closed\n');
  assert.deepEqual(config.columns.map(({id, name}) => ({id, name})), [
    {id: 'todo', name: 'To Do'},
    {id: 'doing', name: 'Doing'},
    {id: 'shipped', name: 'Shipped'},
  ]);
  assert.equal(config.columns[2].state, 'closed');
  assert.equal(config.columns[0].label, 'status:todo');
  assert.throws(() => parseBoardConfig('column todo:\n  name: To Do\ncolumn todo:\n  name: Twice\n'), /Duplicate column id/);
  assert.throws(() => parseBoardConfig('column todo:\n  label: status:todo\n'), /missing a name/);
  assert.throws(() => parseBoardConfig('column todo:\n  name: To Do\n  state: maybe\n'), /Invalid column state/);
  assert.throws(() => parseBoardConfig('column todo:\n  name: To Do\n  status: sometimes\n'), /Invalid column status rule/);
  assert.throws(() => parseBoardConfig('name: orphan\n'), /must follow a column header/);
  assert.throws(() => parseBoardConfig('# only comments\n'), /at least one column/);
});

test('default board derives columns from state and status labels', () => {
  const config = defaultBoardConfig();
  assert.equal(columnForCard([], 'open', config), 'backlog');
  assert.equal(columnForCard(['status:in-progress'], 'open', config), 'in_progress');
  assert.equal(columnForCard(['status:blocked'], 'open', config), 'in_progress');
  assert.equal(columnForCard(['task', 'status:review'], 'open', config), 'in_progress');
  assert.equal(columnForCard([], 'closed', config), 'done');
  assert.equal(columnForCard(['status:in-progress'], 'closed', config), 'done');
});

test('gh issue normalization detects types and caps bodies', () => {
  const config = defaultBoardConfig();
  const epic = normalizeGhIssue({number: 10, title: 'Epic: widgets', state: 'OPEN', labels: [{name: 'epic'}, {name: 'planning'}], body: '# Body', updatedAt: '2026-08-23T01:00:00Z', url: 'u10'}, config);
  assert.equal(epic.type, 'epic');
  assert.equal(epic.state, 'open');
  assert.equal(epic.column, 'backlog');
  const task = normalizeGhIssue({number: 11, title: 'Task: build', state: 'open', labels: [{name: 'task'}, {name: 'status:in-progress'}], body: 'x'.repeat(25_000), updatedAt: '2026-08-23T02:00:00Z', url: 'u11'}, config);
  assert.equal(task.type, 'task');
  assert.equal(task.column, 'in_progress');
  assert.equal(task.body.length, 20_000);
  const closed = normalizeGhIssue({number: 12, title: 'Done thing', state: 'CLOSED', labels: [], body: '', updatedAt: '2026-08-22T00:00:00Z', url: 'u12'}, config);
  assert.equal(closed.state, 'closed');
  assert.equal(closed.column, 'done');
  const plain = normalizeGhIssue({number: 13, title: 'Plain issue'}, config);
  assert.equal(plain.type, 'issue');
  assert.deepEqual(plain.labels, []);
});

test('planned tracker moves map columns to label and state mutations', () => {
  const config = parseBoardConfig('column todo:\n  name: To Do\n  label: status:todo\n\ncolumn doing:\n  name: Doing\n  label: status:doing\n\ncolumn shipped:\n  name: Shipped\n  state: closed\n');
  const card = {number: 11, title: 'Task', type: 'task', state: 'open', labels: ['task', 'status:todo'], body: '', updatedAt: '', url: '', column: 'todo'};
  assert.deepEqual(plannedTrackerMove(card, config.columns[1]), {add: ['status:doing'], remove: ['status:todo'], state: 'open'});
  assert.deepEqual(plannedTrackerMove(card, config.columns[0]), {add: [], remove: [], state: 'open'});
  assert.deepEqual(plannedTrackerMove(card, config.columns[2]), {add: [], remove: ['status:todo'], state: 'closed'});
});

function stubRunner(responses) {
  const calls = [];
  const runner = (command, args) => {
    calls.push({command, args});
    for (const response of responses) if (response.match(command, args)) return {status: response.status ?? 0, stdout: response.stdout ?? '', stderr: response.stderr ?? ''};
    return {status: 0, stdout: '', stderr: ''};
  };
  runner.calls = calls;
  return runner;
}

const ghIssuesFixture = [
  {number: 10, title: 'Epic: widgets', state: 'OPEN', labels: [{name: 'epic'}, {name: 'planning'}], body: '# Epic body', updatedAt: '2026-08-23T01:00:00Z', url: 'https://github.com/acme/widgets/issues/10'},
  {number: 11, title: 'Task: build', state: 'open', labels: [{name: 'task'}, {name: 'status:todo'}], body: 'Task body', updatedAt: '2026-08-23T02:00:00Z', url: 'https://github.com/acme/widgets/issues/11'},
  {number: 12, title: 'Done thing', state: 'closed', labels: [], body: '', updatedAt: '2026-08-22T00:00:00Z', url: 'https://github.com/acme/widgets/issues/12'},
];

function onlineRunner() {
  return stubRunner([
    {match: (command) => command === 'git', stdout: 'https://github.com/acme/widgets.git\n'},
    {match: (command, args) => command === 'gh' && args[1] === 'list', stdout: JSON.stringify(ghIssuesFixture)},
  ]);
}

test('tracker sync refreshes via gh, caches offline, and reloads the cache', async () => {
  const workspace = tempDir('pif-tracker-');
  const boards = [];
  const tracker = new TrackerSync(workspace, (state) => boards.push(state), onlineRunner(), true);
  await tracker.init();
  assert.equal(tracker.state.cards.length, 0);
  const refreshed = tracker.refresh();
  assert.equal(refreshed.ok, true);
  assert.equal(tracker.state.repo, 'acme/widgets');
  assert.deepEqual(tracker.state.columns.map((column) => column.id), ['backlog', 'in_progress', 'done']);
  assert.equal(tracker.state.cards.length, 3);
  assert.equal(tracker.state.stale, false);
  assert.ok(fs.existsSync(path.join(workspace, '.pi', 'pif', 'cache', 'tracker-cache.json')));
  const listed = tracker.list();
  assert.ok(listed.cards.every((card) => !('body' in card)));
  assert.equal(boards.length, 1);

  const offline = new TrackerSync(workspace, () => {}, stubRunner([
    {match: (command) => command === 'git', stdout: 'https://github.com/acme/widgets.git\n'},
    {match: (command, args) => command === 'gh' && args[1] === 'list', status: 1, stderr: 'gh: authentication required'},
  ]), true);
  await offline.init();
  assert.equal(offline.state.cards.length, 3);
  assert.equal(offline.state.stale, true);
  const failed = offline.refresh();
  assert.equal(failed.ok, false);
  assert.match(offline.state.error, /authentication required/);
  assert.equal(offline.state.cards.length, 3);
  fs.rmSync(workspace, {recursive: true, force: true});
});

test('tracker move writes back through gh and reverts nothing on failure', async () => {
  const workspace = tempDir('pif-tracker-');
  fs.mkdirSync(path.join(workspace, '.pif'), {recursive: true});
  fs.writeFileSync(path.join(workspace, '.pif', 'board.yaml'), 'column todo:\n  name: To Do\n  label: status:todo\n\ncolumn doing:\n  name: Doing\n  label: status:doing\n\ncolumn shipped:\n  name: Shipped\n  state: closed\n');
  const runner = onlineRunner();
  const tracker = new TrackerSync(workspace, () => {}, runner, true);
  await tracker.init();
  tracker.refresh();

  const moved = tracker.move({number: 11, column: 'doing'});
  assert.equal(moved.ok, true);
  const edit = runner.calls.find((call) => call.args[1] === 'edit');
  assert.deepEqual(edit.args, ['issue', 'edit', '11', '-R', 'acme/widgets', '--add-label', 'status:doing', '--remove-label', 'status:todo']);
  const card = tracker.state.cards.find((candidate) => candidate.number === 11);
  assert.deepEqual(card.labels, ['task', 'status:doing']);
  assert.equal(card.column, 'doing');

  const shipped = tracker.move({number: 11, column: 'shipped'});
  assert.equal(shipped.ok, true);
  const flip = runner.calls.filter((call) => call.args[1] !== 'list').pop();
  assert.deepEqual(flip.args, ['issue', 'close', '11', '-R', 'acme/widgets']);
  assert.equal(card.state, 'closed');
  assert.equal(card.column, 'shipped');

  const rejected = tracker.move({number: 404, column: 'doing'});
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /Unknown card/);

  const failing = new TrackerSync(workspace, () => {}, stubRunner([
    {match: (command) => command === 'git', stdout: 'https://github.com/acme/widgets.git\n'},
    {match: (command, args) => command === 'gh' && args[1] === 'list', stdout: JSON.stringify(ghIssuesFixture)},
    {match: (command, args) => command === 'gh' && args[1] === 'edit', status: 1, stderr: 'gh: label does not exist'},
  ]), true);
  await failing.init();
  failing.refresh();
  const failed = failing.move({number: 11, column: 'doing'});
  assert.equal(failed.ok, false);
  assert.match(failed.error, /label does not exist/);
  const unchanged = failing.state.cards.find((candidate) => candidate.number === 11);
  assert.equal(unchanged.column, 'todo');
  assert.deepEqual(unchanged.labels, ['task', 'status:todo']);
  fs.rmSync(workspace, {recursive: true, force: true});
});

test('tracker create writes through gh, falls back without labels, and prepends the card', async () => {
  const workspace = tempDir('pif-tracker-');
  fs.mkdirSync(path.join(workspace, '.pif'), {recursive: true});
  fs.writeFileSync(path.join(workspace, '.pif', 'board.yaml'), 'column todo:\n  name: To Do\n  label: status:todo\ncolumn doing:\n  name: Doing\n  label: status:doing\ncolumn shipped:\n  name: Shipped\n  state: closed\n');
  const runner = stubRunner([
    {match: (command) => command === 'git', stdout: 'git@github.com:acme/widgets.git\n'},
    {match: (command, args) => command === 'gh' && args[0] === 'issue' && args[1] === 'list', stdout: JSON.stringify(ghIssuesFixture)},
    {match: (command, args) => command === 'gh' && args[1] === 'create' && args.includes('status:todo'), status: 1, stderr: "could not add label: 'status:todo' not found"},
    {match: (command, args) => command === 'gh' && args[1] === 'create', stdout: 'https://github.com/acme/widgets/issues/20\n'},
  ]);
  const tracker = new TrackerSync(workspace, () => {}, runner, true);
  await tracker.init();
  tracker.refresh();
  const missingTitle = tracker.create({body: 'no title'});
  assert.equal(missingTitle.ok, false);
  assert.match(missingTitle.error, /Title is required/);
  const badColumn = tracker.create({title: 'X', column: 'nowhere'});
  assert.equal(badColumn.ok, false);
  assert.match(badColumn.error, /Unknown column/);
  const created = tracker.create({title: 'New ticket', body: 'Body text', type: 'task', column: 'todo'});
  assert.equal(created.ok, true);
  assert.equal(created.number, 20);
  const createArgs = runner.calls.filter((call) => call.args[1] === 'create');
  assert.equal(createArgs.length, 2);
  assert.ok(createArgs[0].args.includes('status:todo'));
  assert.ok(!createArgs[1].args.includes('--label'));
  const card = tracker.state.cards.find((candidate) => candidate.number === 20);
  assert.equal(card.title, 'New ticket');
  assert.equal(card.type, 'task');
  assert.equal(card.column, 'todo');
  assert.equal(tracker.state.cards[0].number, 20);
  fs.rmSync(workspace, {recursive: true, force: true});
});

test('tracker update edits title and body through gh and patches locally', async () => {
  const workspace = tempDir('pif-tracker-');
  const runner = onlineRunner();
  const tracker = new TrackerSync(workspace, () => {}, runner, true);
  await tracker.init();
  tracker.refresh();
  const empty = tracker.update({number: 11, title: '  '});
  assert.equal(empty.ok, false);
  assert.match(empty.error, /Title cannot be empty/);
  const nothing = tracker.update({number: 11});
  assert.equal(nothing.ok, false);
  const unknown = tracker.update({number: 999, title: 'x'});
  assert.equal(unknown.ok, false);
  const updated = tracker.update({number: 11, title: 'Task: renamed', body: 'New body'});
  assert.equal(updated.ok, true);
  const edit = runner.calls.filter((call) => call.args[1] === 'edit').pop();
  assert.deepEqual(edit.args, ['issue', 'edit', '11', '-R', 'acme/widgets', '--title', 'Task: renamed', '--body', 'New body']);
  const card = tracker.state.cards.find((candidate) => candidate.number === 11);
  assert.equal(card.title, 'Task: renamed');
  assert.equal(card.body, 'New body');
  fs.rmSync(workspace, {recursive: true, force: true});
});

test('tracker delete removes the card through gh and keeps state on failure', async () => {
  const workspace = tempDir('pif-tracker-');
  const failing = stubRunner([
    {match: (command) => command === 'git', stdout: 'https://github.com/acme/widgets.git\n'},
    {match: (command, args) => command === 'gh' && args[1] === 'list', stdout: JSON.stringify(ghIssuesFixture)},
    {match: (command, args) => command === 'gh' && args[1] === 'delete', status: 1, stderr: 'gh: no delete permission'},
  ]);
  const tracker = new TrackerSync(workspace, () => {}, failing, true);
  await tracker.init();
  tracker.refresh();
  const failed = tracker.delete({number: 11});
  assert.equal(failed.ok, false);
  assert.match(failed.error, /no delete permission/);
  assert.ok(tracker.state.cards.some((candidate) => candidate.number === 11));

  const runner = onlineRunner();
  const working = new TrackerSync(workspace, () => {}, runner, true);
  await working.init();
  working.refresh();
  const removed = working.delete({number: 11});
  assert.equal(removed.ok, true);
  const deleteCall = runner.calls.filter((call) => call.args[1] === 'delete').pop();
  assert.deepEqual(deleteCall.args, ['issue', 'delete', '11', '-R', 'acme/widgets', '--yes']);
  assert.ok(!working.state.cards.some((candidate) => candidate.number === 11));
  fs.rmSync(workspace, {recursive: true, force: true});
});

test('tracker surfaces invalid board config and missing github remote as errors', async () => {
  const workspace = tempDir('pif-tracker-');
  fs.mkdirSync(path.join(workspace, '.pif'), {recursive: true});
  fs.writeFileSync(path.join(workspace, '.pif', 'board.yaml'), 'column broken:\n  state: sideways\n');
  const invalid = new TrackerSync(workspace, () => {}, onlineRunner(), true);
  await invalid.init();
  const result = invalid.refresh();
  assert.equal(result.ok, false);
  assert.match(invalid.state.error, /Invalid board\.yaml/);

  const remoteless = new TrackerSync(tempDir('pif-tracker-'), () => {}, stubRunner([
    {match: (command) => command === 'git', status: 1, stderr: 'fatal: no such remote'},
  ]), true);
  await remoteless.init();
  const noRepo = remoteless.refresh();
  assert.equal(noRepo.ok, false);
  assert.match(remoteless.state.error, /no GitHub origin remote/);
  fs.rmSync(workspace, {recursive: true, force: true});
});

// ---------------------------------------------------------------------------
// Layered widget sources (#155): base app -> global catalog -> project overlay
// ---------------------------------------------------------------------------

function writeWidgetFixture(root, id, overrides = {}) {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, {recursive: true});
  const fields = {slot: 'center', core: 'false', name: `${id} name`, ...overrides};
  fs.writeFileSync(path.join(dir, 'widget.yaml'), `id: ${id}\nname: "${fields.name}"\nversion: 0.1.0\ndescription: "Layered fixture"\nslot: ${fields.slot}\ncore: ${fields.core}\ntags: [test]\ndart_dependencies: []\n`);
  fs.writeFileSync(path.join(dir, `${id}.dart`), `// ${id} fixture source\n`);
  return dir;
}

/** Clean non-repo workspace + app dir + global catalog, all temp dirs, wired
 * through env overrides (this is the #130 "install once, use in any project"
 * shape: the app never has to live inside the workspace). */
function layeredFixture(t) {
  const workspace = tempDir('pif-layered-ws-');
  const appDir = tempDir('pif-layered-app-');
  const globalCatalog = tempDir('pif-layered-global-');
  fs.mkdirSync(path.join(appDir, 'lib', 'widgets'), {recursive: true});
  fs.mkdirSync(path.join(appDir, 'catalog'), {recursive: true});
  const previousAppDir = process.env.PIF_APP_DIR;
  const previousGlobalCatalog = process.env.PIF_GLOBAL_CATALOG;
  process.env.PIF_APP_DIR = appDir;
  process.env.PIF_GLOBAL_CATALOG = globalCatalog;
  t.after(() => {
    if (previousAppDir === undefined) delete process.env.PIF_APP_DIR; else process.env.PIF_APP_DIR = previousAppDir;
    if (previousGlobalCatalog === undefined) delete process.env.PIF_GLOBAL_CATALOG; else process.env.PIF_GLOBAL_CATALOG = previousGlobalCatalog;
    for (const dir of [workspace, appDir, globalCatalog]) fs.rmSync(dir, {recursive: true, force: true});
  });
  return {workspace, appDir, globalCatalog};
}

function layeredHub(workspace) {
  return new __pif.PifHub({}, {}, workspace, 0);
}

test('required widget resolution pins complete source layers deterministically (#209)', async (t) => {
  const {resolveRequiredWidgetSet} = await import('./pif-shared.ts');
  const f = layeredFixture(t);
  const base = path.join(f.appDir, 'lib', 'widgets');
  const project = path.join(f.workspace, 'pif_app', 'widgets');
  writeWidgetFixture(base, 'shared_widget', {name: 'Base'});
  writeWidgetFixture(f.globalCatalog, 'shared_widget', {name: 'Catalog'});
  writeWidgetFixture(project, 'shared_widget', {name: 'Project'});
  writeWidgetFixture(base, 'base_only');
  writeWidgetFixture(f.globalCatalog, 'catalog_only');
  const roots = {base, catalog: f.globalCatalog, project};
  const resolved = resolveRequiredWidgetSet(['shared_widget', 'catalog_only', 'base_only'], roots);
  assert.equal(resolved.ok, true);
  assert.deepEqual(resolved.resolved.map((entry) => [entry.id, entry.source]), [
    ['base_only', 'base'], ['catalog_only', 'catalog'], ['shared_widget', 'project'],
  ]);
  assert.equal(resolved.resolved[2].name, 'Project');
  assert.deepEqual(resolveRequiredWidgetSet([], roots).resolved, []);
  fs.rmSync(path.join(project, 'shared_widget'), {recursive: true});
  assert.equal(resolveRequiredWidgetSet(['shared_widget'], roots).resolved[0].source, 'catalog');
  const archive = path.join(f.appDir, 'catalog');
  writeWidgetFixture(archive, 'archived_widget');
  fs.mkdirSync(path.join(f.workspace, '.pi', 'pif'), {recursive: true});
  fs.writeFileSync(path.join(f.workspace, '.pi', 'pif', 'registry.json'), '{"enabled":[]}');
  const explicitRequirements = resolveRequiredWidgetSet(['base_only', 'archived_widget'], {...roots, base: [base, archive]});
  assert.equal(explicitRequirements.ok, true, 'complete explicit requirements remain available regardless of IDE enable/archive state');
  assert.deepEqual(explicitRequirements.resolved.map((entry) => entry.id), ['archived_widget', 'base_only']);
});

test('required widget preflight rejects bad or incomplete requirements without fallback (#209)', async (t) => {
  const {resolveRequiredWidgetSet} = await import('./pif-shared.ts');
  const f = layeredFixture(t);
  const base = path.join(f.appDir, 'lib', 'widgets');
  const project = path.join(f.workspace, 'pif_app', 'widgets');
  writeWidgetFixture(base, 'same_widget');
  const higher = writeWidgetFixture(project, 'same_widget');
  const roots = {base, catalog: f.globalCatalog, project};
  for (const ids of [['../escape'], ['SameWidget'], [''], ['same_widget', 'same_widget'], ['absent_widget']]) {
    const result = resolveRequiredWidgetSet(ids, roots);
    assert.equal(result.ok, false, JSON.stringify(ids));
    assert.ok(result.problems.every((problem) => problem.message.length > 10));
  }
  fs.rmSync(path.join(higher, 'same_widget.dart'));
  const sourceMissing = resolveRequiredWidgetSet(['same_widget'], roots);
  assert.equal(sourceMissing.ok, false, 'must not fall back to complete base source');
  assert.match(sourceMissing.problems[0].message, /dart|entrypoint|source/i);
});

test('public build preflight rejects required widgets before any build process (#209)', async (t) => {
  const f = layeredFixture(t);
  const hub = layeredHub(f.workspace);
  const {harness, restore} = patchBuildSpawn([]);
  t.after(restore);
  for (const dependencies of [['missing_widget'], ['../invalid'], ['agent_console', 'agent_console']]) {
    hub.state.app = {id: 'fixture', name: 'Fixture', version: '0.1.0', home: 'home', pages: ['home'], dependencies};
    await assert.rejects(hub.control('pif_app.build', {}), /required widget/i);
    assert.equal(harness.calls.length, 0);
    assert.equal(hub.exportBuilds.size, 0);
  }
});

test('layered widget sources resolve deterministically with provenance (#155)', async (t) => {
  const f = layeredFixture(t);
  writeWidgetFixture(path.join(f.appDir, 'lib', 'widgets'), 'alpha_widget', {core: 'true'});
  writeWidgetFixture(path.join(f.appDir, 'lib', 'widgets'), 'shared_widget', {name: 'Base Shared'});
  writeWidgetFixture(path.join(f.appDir, 'catalog'), 'archived_widget');
  writeWidgetFixture(path.join(f.appDir, 'catalog'), 'catalog_shadow', {name: 'Archive Shadow'});
  writeWidgetFixture(f.globalCatalog, 'global_only');
  writeWidgetFixture(f.globalCatalog, 'catalog_shadow', {name: 'Global Shadow'});
  writeWidgetFixture(path.join(f.workspace, 'pif_app', 'widgets'), 'shared_widget', {name: 'Project Shared'});
  writeWidgetFixture(path.join(f.workspace, 'pif_app', 'widgets'), 'project_only');
  const hub = layeredHub(f.workspace);
  assert.equal(hub.appDir, f.appDir, 'PIF_APP_DIR pins the base app outside the workspace');
  assert.equal(hub.globalCatalogPath, f.globalCatalog);

  hub.loadRegistryState();
  hub.scanWidgets();
  // Wholesale shadowing: project wins over base for shared_widget.
  assert.deepEqual(Object.keys(hub.state.widgets).sort(), ['alpha_widget', 'project_only', 'shared_widget']);
  assert.equal(hub.state.widgets.shared_widget.source, 'project');
  assert.equal(hub.state.widgets.shared_widget.name, 'Project Shared', 'the later layer shadows the earlier id wholesale');
  assert.equal(hub.state.widgets.alpha_widget.source, 'base');
  assert.equal(hub.state.widgets.alpha_widget.enabled, true, 'core base widgets stay enabled');
  assert.equal(hub.state.widgets.project_only.source, 'project');
  // Catalog layer: global catalog entries shadow app-archive entries on the same id.
  assert.deepEqual(Object.keys(hub.state.catalog).sort(), ['archived_widget', 'catalog_shadow', 'global_only']);
  assert.equal(hub.state.catalog.archived_widget.source, 'base');
  assert.equal(hub.state.catalog.catalog_shadow.source, 'catalog');
  assert.equal(hub.state.catalog.catalog_shadow.name, 'Global Shadow');
  assert.equal(hub.state.catalog.global_only.source, 'catalog');
  assert.equal(hub.state.catalog.global_only.installed, false);

  // Determinism: widget.list rescans and must surface the identical resolved set.
  const first = JSON.stringify({widgets: hub.state.widgets, catalog: hub.state.catalog});
  const listed = await hub.control('widget.list');
  assert.equal(JSON.stringify({widgets: listed.installed, catalog: listed.catalog}), first);
  // Provenance flows through the snapshot the shell renders.
  const snap = hub.snapshot();
  assert.equal(snap.widgets.shared_widget.source, 'project');
  assert.equal(snap.catalog.global_only.source, 'catalog');
});

test('registry codegen carries provenance and project import paths (#155)', () => {
  const base = {...parseWidgetManifest(manifest), source: 'base'};
  const project = {...parseWidgetManifest(manifest.replace('alpha_widget', 'beta_page')), source: 'project', importPath: 'file:///ws/pif_app/widgets/beta_page/beta_page.dart'};
  const actual = generateWidgetRegistry([project, base]);
  assert.equal(actual, `// GENERATED BY pif. DO NOT EDIT.\nimport 'core/plugin.dart';\nimport 'widgets/alpha_widget/alpha_widget.dart';\nimport 'file:///ws/pif_app/widgets/beta_page/beta_page.dart';\n\nMap<String, PifWidgetPlugin Function()> pifWidgetFactories() {\n  return {\n    // source: base\n    'alpha_widget': () => AlphaWidgetPlugin(),\n    // source: project\n    'beta_page': () => BetaPagePlugin(),\n  };\n}\n`);
  assert.equal(dartFileUri('/tmp/some ws/pif_app/widgets/x/x.dart').startsWith('file://'), true);
  assert.throws(() => dartFileUri("/tmp/qu'ote/x.dart"), /Unsafe Dart import URI/);
  assert.throws(() => generateWidgetRegistry([{...base, importPath: 'has space.dart'}]), /Unsafe registry import path/);
  assert.throws(() => generateWidgetRegistry([{...base, importPath: '/abs/x.dart'}]), /Unsafe registry import path/);
});

class StubbedAnalyzeHub extends __pif.PifHub {
  analyzeWidget() { return {ok: true, diagnostics: 'stub-clean'}; }
}

function fakePeer(messages) {
  return {
    sendRaw(payload) {
      messages.push(JSON.parse(Buffer.from(payload).toString()));
    },
    close() {},
  };
}

function makeBundledHub(workspace) {
  return new StubbedAnalyzeHub({}, { ui: { setStatus() {}, notify() {} }, model: { id: 'fixture-model' }, thinkingLevel: 'low' }, workspace, 0);
}

function bundledFixture(t, options = {}) {
  const root = tempDir('pif-bundled-root-');
  const workspace = tempDir('pif-bundled-ws-');
  const globalCatalog = tempDir('pif-bundled-global-');
  const appDir = path.join(root, 'Fixture.app', 'Contents', 'Resources', 'app');
  const agentDir = path.join(workspace, '.pi', 'agent');
  const modelsPath = path.join(agentDir, 'models.json');
  const registryPath = path.join(workspace, '.pi', 'pif', 'registry.json');
  fs.mkdirSync(path.join(appDir, 'lib', 'widgets'), {recursive: true});
  fs.mkdirSync(path.join(appDir, 'catalog'), {recursive: true});
  fs.mkdirSync(path.join(agentDir, 'agents'), {recursive: true});
  fs.mkdirSync(path.join(agentDir, 'extensions'), {recursive: true});
  fs.mkdirSync(path.join(agentDir, 'state'), {recursive: true});
  fs.mkdirSync(path.dirname(registryPath), {recursive: true});
  fs.writeFileSync(registryPath, `${JSON.stringify({enabled: [...(options.enabledIds ?? [])].sort()}, null, 2)}\n`);
  fs.writeFileSync(modelsPath, `${JSON.stringify({providers: {}}, null, 2)}\n`);
  const previousEnv = {
    PIF_APP_DIR: process.env.PIF_APP_DIR,
    PIF_GLOBAL_CATALOG: process.env.PIF_GLOBAL_CATALOG,
    PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
    PIF_MODELS_PATH: process.env.PIF_MODELS_PATH,
    PIF_COMPILED_WIDGET_IDS: process.env.PIF_COMPILED_WIDGET_IDS,
  };
  process.env.PIF_APP_DIR = appDir;
  process.env.PIF_GLOBAL_CATALOG = globalCatalog;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PIF_MODELS_PATH = modelsPath;
  if (Object.prototype.hasOwnProperty.call(options, 'compiledIds')) process.env.PIF_COMPILED_WIDGET_IDS = JSON.stringify(options.compiledIds);
  else delete process.env.PIF_COMPILED_WIDGET_IDS;
  t.after(() => {
    if (previousEnv.PIF_APP_DIR === undefined) delete process.env.PIF_APP_DIR; else process.env.PIF_APP_DIR = previousEnv.PIF_APP_DIR;
    if (previousEnv.PIF_GLOBAL_CATALOG === undefined) delete process.env.PIF_GLOBAL_CATALOG; else process.env.PIF_GLOBAL_CATALOG = previousEnv.PIF_GLOBAL_CATALOG;
    if (previousEnv.PI_CODING_AGENT_DIR === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousEnv.PI_CODING_AGENT_DIR;
    if (previousEnv.PIF_MODELS_PATH === undefined) delete process.env.PIF_MODELS_PATH; else process.env.PIF_MODELS_PATH = previousEnv.PIF_MODELS_PATH;
    if (previousEnv.PIF_COMPILED_WIDGET_IDS === undefined) delete process.env.PIF_COMPILED_WIDGET_IDS; else process.env.PIF_COMPILED_WIDGET_IDS = previousEnv.PIF_COMPILED_WIDGET_IDS;
    for (const dir of [root, workspace, globalCatalog]) fs.rmSync(dir, {recursive: true, force: true});
  });
  return {root, appDir, workspace, globalCatalog, agentDir, modelsPath, registryPath};
}

function snapshotPaths(root) {
  const entries = [];
  const walk = (dir, rel = '') => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const next = rel ? path.posix.join(rel, entry.name) : entry.name;
      entries.push(`${entry.isDirectory() ? 'd' : 'f'}:${next}`);
      if (entry.isDirectory()) walk(path.join(dir, entry.name), next);
    }
  };
  walk(root);
  return entries.sort();
}

function patchNoProcessLaunches() {
  const originalSpawn = childProcess.spawn;
  const originalSpawnSync = childProcess.spawnSync;
  const harness = {spawnCalls: [], spawnSyncCalls: []};
  childProcess.spawn = (...args) => {
    harness.spawnCalls.push(args);
    throw new Error(`Unexpected spawn: ${String(args[0])}`);
  };
  childProcess.spawnSync = (...args) => {
    harness.spawnSyncCalls.push(args);
    throw new Error(`Unexpected spawnSync: ${String(args[0])}`);
  };
  syncBuiltinESMExports();
  return {
    harness,
    restore() {
      childProcess.spawn = originalSpawn;
      childProcess.spawnSync = originalSpawnSync;
      syncBuiltinESMExports();
    },
  };
}

test('project widgets install in place and global catalog installs copy into the overlay (#155)', async (t) => {
  const f = layeredFixture(t);
  writeWidgetFixture(path.join(f.appDir, 'lib', 'widgets'), 'alpha_widget');
  writeWidgetFixture(path.join(f.appDir, 'catalog'), 'archived_widget');
  writeWidgetFixture(f.globalCatalog, 'global_only');
  const projectDir = writeWidgetFixture(path.join(f.workspace, 'pif_app', 'widgets'), 'project_only');
  const projectShared = writeWidgetFixture(path.join(f.workspace, 'pif_app', 'widgets'), 'shared_widget', {name: 'Project Shared'});
  writeWidgetFixture(path.join(f.appDir, 'lib', 'widgets'), 'shared_widget', {name: 'Base Shared'});
  const hub = new StubbedAnalyzeHub({}, {}, f.workspace, 0);
  hub.loadRegistryState();
  hub.scanWidgets();

  const result = await hub.installWidget({id: 'project_only'});
  assert.equal(result.ok, true);
  assert.equal(result.source, 'project');
  assert.ok(fs.existsSync(path.join(projectDir, 'widget.yaml')), 'project source never moves');
  assert.ok(!fs.existsSync(path.join(f.appDir, 'lib', 'widgets', 'project_only')), 'no copy escapes into the base app');
  assert.equal(hub.state.widgets.project_only.enabled, true);
  const registry = fs.readFileSync(path.join(f.appDir, 'lib', 'widget_registry.g.dart'), 'utf8');
  assert.match(registry, /\/\/ source: project\n    'project_only'/);
  assert.match(registry, new RegExp(`import 'file://${projectDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/project_only\\.dart';`));

  // Shadowed base ids install the project definition, in place.
  const shadowInstall = await hub.installWidget({id: 'shared_widget'});
  assert.equal(shadowInstall.source, 'project');
  assert.equal(hub.state.widgets.shared_widget.name, 'Project Shared');
  assert.ok(fs.existsSync(projectShared));

  // Global catalog install copies into the project overlay; the catalog source stays put.
  const globalInstall = await hub.installWidget({id: 'global_only'});
  assert.equal(globalInstall.ok, true);
  assert.equal(globalInstall.source, 'project');
  assert.ok(fs.existsSync(path.join(f.workspace, 'pif_app', 'widgets', 'global_only', 'widget.yaml')), 'global catalog installs copy into the project overlay');
  assert.ok(fs.existsSync(path.join(f.globalCatalog, 'global_only', 'widget.yaml')), 'global catalog source never moves');
  assert.equal(hub.state.widgets.global_only.source, 'project');
  assert.equal(hub.state.catalog.global_only, undefined);

  // App-archive installs keep the existing copy-into-base behaviour.
  const archiveInstall = await hub.installWidget({id: 'archived_widget'});
  assert.equal(archiveInstall.source, 'base');
  assert.ok(fs.existsSync(path.join(f.appDir, 'lib', 'widgets', 'archived_widget', 'widget.yaml')));
  assert.equal(hub.state.widgets.archived_widget.source, 'base');

  await assert.rejects(() => hub.installWidget({id: 'missing_widget'}), /not found in widgets or catalog/);
  await assert.rejects(() => hub.installWidget({id: '../escape'}), /snake_case/);
  // Writes stayed inside the declared roots: the workspace only gained the overlay and hub state.
  assert.deepEqual(fs.readdirSync(f.workspace).sort(), ['.pi', 'pif_app']);
});

test('project uninstall deregisters only; base uninstall archives; core refuses (#155)', async (t) => {
  const f = layeredFixture(t);
  writeWidgetFixture(path.join(f.appDir, 'lib', 'widgets'), 'core_widget', {core: 'true'});
  writeWidgetFixture(path.join(f.appDir, 'lib', 'widgets'), 'base_widget');
  const projectDir = writeWidgetFixture(path.join(f.workspace, 'pif_app', 'widgets'), 'project_only');
  const hub = new StubbedAnalyzeHub({}, {}, f.workspace, 0);
  hub.loadRegistryState();
  hub.scanWidgets();
  await hub.installWidget({id: 'project_only'});
  await hub.installWidget({id: 'base_widget'});
  assert.match(fs.readFileSync(path.join(f.appDir, 'lib', 'widget_registry.g.dart'), 'utf8'), /'project_only'/);

  const removed = await hub.uninstallWidget({id: 'project_only'});
  assert.equal(removed.ok, true);
  assert.equal(removed.source, 'project');
  assert.equal(removed.deregistered, true);
  assert.ok(fs.existsSync(path.join(projectDir, 'project_only.dart')), 'uninstalling a project widget keeps its source in place');
  assert.equal(hub.state.widgets.project_only.enabled, false, 'deregistered project widget stays present but disabled');
  assert.ok(!fs.readFileSync(path.join(f.appDir, 'lib', 'widget_registry.g.dart'), 'utf8').includes("'project_only'"), 'registry drops the deregistered widget');
  assert.equal(hub.state.catalog.project_only, undefined);

  const archived = await hub.uninstallWidget({id: 'base_widget'});
  assert.equal(archived.source, 'base');
  assert.ok(fs.existsSync(path.join(f.appDir, 'catalog', 'base_widget', 'widget.yaml')), 'base widgets archive to the app-local catalog');
  assert.ok(!fs.existsSync(path.join(f.appDir, 'lib', 'widgets', 'base_widget')));
  assert.equal(hub.state.catalog.base_widget.source, 'base');

  await assert.rejects(() => hub.uninstallWidget({id: 'core_widget'}), /Core widget .* cannot be uninstalled/);
  await assert.rejects(() => hub.uninstallWidget({id: 'never_was'}), /Unknown installed widget/);
});

// ---------------------------------------------------------------------------
// Bundled runtime guards (#187): compiled inventory and source write rejection
// ---------------------------------------------------------------------------

test('bundled scans ignore workspace shadows and core toggle persists only in registry (#187)', async (t) => {
  const f = bundledFixture(t, {enabledIds: ['alpha_widget', 'core_widget'], compiledIds: ['alpha_widget', 'core_widget']});
  writeWidgetFixture(path.join(f.appDir, 'lib', 'widgets'), 'alpha_widget', {name: 'Bundled Alpha'});
  writeWidgetFixture(path.join(f.appDir, 'lib', 'widgets'), 'core_widget', {core: 'true', name: 'Bundled Core'});
  writeWidgetFixture(path.join(f.appDir, 'lib', 'widgets'), 'shadowed_widget', {name: 'Bundled Shadow'});
  writeWidgetFixture(path.join(f.workspace, 'pif_app', 'widgets'), 'alpha_widget', {name: 'Workspace Alpha'});
  writeWidgetFixture(path.join(f.workspace, 'pif_app', 'widgets'), 'shadowed_widget', {name: 'Workspace Shadow'});
  writeWidgetFixture(path.join(f.workspace, 'pif_app', 'widgets'), 'workspace_only');
  const hub = makeBundledHub(f.workspace);
  const peerMessages = [];
  hub.peers.add(fakePeer(peerMessages));
  hub.loadRegistryState();
  hub.scanWidgets();

  const listed = await hub.control('widget.list');
  assert.deepEqual(Object.keys(listed.installed).sort(), ['alpha_widget', 'core_widget']);
  assert.equal(listed.installed.alpha_widget.name, 'Bundled Alpha');
  assert.equal(listed.installed.core_widget.name, 'Bundled Core');
  assert.equal(listed.installed.shadowed_widget, undefined);
  assert.equal(listed.installed.workspace_only, undefined);

  const registryBefore = fs.readFileSync(f.registryPath, 'utf8');
  const previousGenerateRegistry = hub.generateRegistry;
  const previousReload = hub.supervisor.reload;
  hub.generateRegistry = () => { throw new Error('unexpected bundled codegen'); };
  hub.supervisor.process = {kill() { throw new Error('unexpected cleanup'); }};
  hub.supervisor.reload = async () => { throw new Error('unexpected bundled reload'); };
  try {
    const toggled = await hub.control('widget.toggle', {id: 'core_widget', enabled: false});
    assert.equal(toggled.enabled, false);
    assert.equal(fs.existsSync(path.join(f.appDir, 'lib', 'widget_registry.g.dart')), false);
    assert.notEqual(fs.readFileSync(f.registryPath, 'utf8'), registryBefore);
    assert.deepEqual(JSON.parse(fs.readFileSync(f.registryPath, 'utf8')), {enabled: ['alpha_widget']});
    assert.equal(peerMessages.length, 1);
    assert.equal(peerMessages[0].channel, 'widget/registry');
    assert.equal(peerMessages[0].type, 'registry_state');
    assert.equal(peerMessages[0].payload.widgets.core_widget.enabled, false);
    assert.equal(hub.state.widgets.core_widget.enabled, false);

    hub.scanWidgets();
    assert.equal(hub.state.widgets.core_widget.enabled, false);

    const reopened = makeBundledHub(f.workspace);
    reopened.loadRegistryState();
    reopened.scanWidgets();
    assert.equal(reopened.state.widgets.alpha_widget.enabled, true);
    assert.equal(reopened.state.widgets.core_widget.enabled, false);
  } finally {
    hub.generateRegistry = previousGenerateRegistry;
    hub.supervisor.reload = previousReload;
  }
});

test('bundled create/install/uninstall reject before any filesystem writes (#187)', async (t) => {
  const f = bundledFixture(t, {enabledIds: ['alpha_widget'], compiledIds: ['alpha_widget']});
  writeWidgetFixture(path.join(f.appDir, 'lib', 'widgets'), 'alpha_widget', {name: 'Bundled Alpha'});
  writeWidgetFixture(path.join(f.workspace, 'pif_app', 'widgets'), 'workspace_only');
  const hub = makeBundledHub(f.workspace);
  hub.loadRegistryState();
  hub.scanWidgets();
  const {restore} = patchNoProcessLaunches();
  const before = {
    app: snapshotPaths(f.appDir),
    workspace: snapshotPaths(f.workspace),
    globalCatalog: snapshotPaths(f.globalCatalog),
    agent: snapshotPaths(f.agentDir),
  };
  try {
    await assert.rejects(() => hub.control('widget.create', {id: 'new_widget', name: 'New Widget'}), /compiled into this app|bundled/i);
    await assert.rejects(() => hub.control('widget.install', {id: 'alpha_widget'}), /compiled into this app|bundled/i);
    await assert.rejects(() => hub.control('widget.uninstall', {id: 'alpha_widget'}), /compiled into this app|bundled/i);
    assert.deepEqual(snapshotPaths(f.appDir), before.app);
    assert.deepEqual(snapshotPaths(f.workspace), before.workspace);
    assert.deepEqual(snapshotPaths(f.globalCatalog), before.globalCatalog);
    assert.deepEqual(snapshotPaths(f.agentDir), before.agent);
    assert.equal(fs.existsSync(path.join(f.appDir, 'lib', 'widget_registry.g.dart')), false);
  } finally {
    restore();
  }
});

test('bundled app scaffold entry points reject before source generation (#187)', async (t) => {
  const f = bundledFixture(t, {enabledIds: ['home'], compiledIds: ['home']});
  writeWidgetFixture(path.join(f.appDir, 'lib', 'widgets'), 'home', {core: 'true', name: 'Home'});
  const hub = makeBundledHub(f.workspace);
  hub.loadRegistryState();
  hub.scanWidgets();
  const {restore} = patchNoProcessLaunches();
  const beforeInit = {
    app: snapshotPaths(f.appDir),
    workspace: snapshotPaths(f.workspace),
    globalCatalog: snapshotPaths(f.globalCatalog),
    agent: snapshotPaths(f.agentDir),
  };
  try {
    await assert.rejects(() => hub.control('pif_app.init', {name: 'Bundled App'}), /compiled into this app|bundled/i);
    assert.deepEqual(snapshotPaths(f.appDir), beforeInit.app);
    assert.deepEqual(snapshotPaths(f.workspace), beforeInit.workspace);
    assert.deepEqual(snapshotPaths(f.globalCatalog), beforeInit.globalCatalog);
    assert.deepEqual(snapshotPaths(f.agentDir), beforeInit.agent);
    assert.equal(fs.existsSync(path.join(f.workspace, 'pif_app', 'app.yaml')), false);

    const appManifestPath = path.join(f.workspace, 'pif_app', 'app.yaml');
    fs.mkdirSync(path.dirname(appManifestPath), {recursive: true});
    fs.writeFileSync(appManifestPath, renderAppManifest({id: 'bundled-app', name: 'Bundled App', version: '0.1.0', home: 'home', pages: ['home'], dependencies: []}));
    hub.scanWidgets();
    const beforePageWidget = {
      app: snapshotPaths(f.appDir),
      workspace: snapshotPaths(f.workspace),
      globalCatalog: snapshotPaths(f.globalCatalog),
      agent: snapshotPaths(f.agentDir),
    };
    await assert.rejects(() => hub.control('pif_app.page_add', {name: 'Reports'}), /compiled into this app|bundled/i);
    await assert.rejects(() => hub.control('pif_app.widget_add', {name: 'Reports', slot: 'center'}), /compiled into this app|bundled/i);
    assert.deepEqual(snapshotPaths(f.appDir), beforePageWidget.app);
    assert.deepEqual(snapshotPaths(f.workspace), beforePageWidget.workspace);
    assert.deepEqual(snapshotPaths(f.globalCatalog), beforePageWidget.globalCatalog);
    assert.deepEqual(snapshotPaths(f.agentDir), beforePageWidget.agent);
  } finally {
    restore();
  }
});

test('bundled relaunch rejects before Flutter spawn (#187)', async (t) => {
  const f = bundledFixture(t, {enabledIds: ['alpha_widget'], compiledIds: ['alpha_widget']});
  writeWidgetFixture(path.join(f.appDir, 'lib', 'widgets'), 'alpha_widget', {name: 'Bundled Alpha'});
  const hub = makeBundledHub(f.workspace);
  hub.loadRegistryState();
  hub.scanWidgets();
  const {restore} = patchNoProcessLaunches();
  try {
    assert.throws(() => hub.relaunchShell(), /compiled into this app|bundled/i);
    assert.throws(() => hub.generateRegistry(), /compiled into this app|bundled/i);
    assert.equal(fs.existsSync(path.join(f.appDir, 'lib', 'widget_registry.g.dart')), false);
  } finally {
    restore();
  }
});

test('bundled inventory fails closed when compiled ids are missing, malformed, or incomplete (#187)', async (t) => {
  const f = bundledFixture(t);
  writeWidgetFixture(path.join(f.appDir, 'lib', 'widgets'), 'alpha_widget', {name: 'Bundled Alpha'});
  writeWidgetFixture(path.join(f.appDir, 'lib', 'widgets'), 'beta_widget', {name: 'Bundled Beta'});

  await assert.rejects(async () => {
    const hub = makeBundledHub(f.workspace);
    await hub.control('widget.list');
  }, /compiled inventory|PIF_COMPILED_WIDGET_IDS|inventory/i);

  process.env.PIF_COMPILED_WIDGET_IDS = '{bad json';
  await assert.rejects(async () => {
    const hub = makeBundledHub(f.workspace);
    await hub.control('widget.list');
  }, /compiled inventory|PIF_COMPILED_WIDGET_IDS|inventory/i);

  process.env.PIF_COMPILED_WIDGET_IDS = JSON.stringify(['alpha_widget', 'missing_widget']);
  await assert.rejects(async () => {
    const hub = makeBundledHub(f.workspace);
    await hub.control('widget.list');
  }, /compiled inventory|PIF_COMPILED_WIDGET_IDS|inventory/i);
});

// --- #188: tracker parent index + card excerpt ---

test('runtime session storage rejects bundle-directed files and SQLite sidecars (#187)', async (t) => {
  const f = bundledFixture(t, {compiledIds: ['alpha_widget']});
  writeWidgetFixture(path.join(f.appDir, 'lib', 'widgets'), 'alpha_widget');
  const sentinel = path.join(f.appDir, 'sealed-session-sentinel');
  fs.writeFileSync(sentinel, 'sealed bytes');
  for (const name of ['sessions.db', 'sessions.db-wal', 'sessions.db-shm', 'sessions.db-journal', 'sessions.json', 'sessions.json.tmp']) {
    const destination = path.join(f.workspace, '.pi', 'pif', name);
    fs.symlinkSync(sentinel, destination);
    let hub;
    try {
      await assert.rejects(async () => {
        hub = makeBundledHub(f.workspace);
        await hub.store.init();
      }, /bundle|\.app\/Contents/i, name);
      assert.equal(fs.readFileSync(sentinel, 'utf8'), 'sealed bytes', name);
    } finally {
      hub?.store?.db?.close();
      fs.rmSync(destination, {force: true});
    }
  }
});

test('tracker cache rejects bundle-directed files and SQLite sidecars before fallback (#187)', async (t) => {
  const f = bundledFixture(t, {compiledIds: ['alpha_widget']});
  writeWidgetFixture(path.join(f.appDir, 'lib', 'widgets'), 'alpha_widget');
  const sentinel = path.join(f.appDir, 'sealed-tracker-sentinel');
  fs.writeFileSync(sentinel, 'sealed bytes');
  const cache = path.join(f.workspace, '.pi', 'pif', 'cache');
  fs.mkdirSync(cache, {recursive: true});
  for (const name of ['tracker.db', 'tracker.db-wal', 'tracker.db-shm', 'tracker.db-journal', 'tracker-cache.json']) {
    const destination = path.join(cache, name);
    fs.symlinkSync(sentinel, destination);
    const tracker = new TrackerSync(f.workspace, () => {}, () => { throw new Error('unexpected remote runner'); });
    try {
      await assert.rejects(tracker.init(), /bundle|\.app\/Contents/i, name);
      assert.equal(fs.readFileSync(sentinel, 'utf8'), 'sealed bytes', name);
    } finally {
      tracker.db?.close();
      fs.rmSync(destination, {force: true});
    }
  }
});

test('hub startup rejects bundle-directed token temporary files and control secrets (#187)', async (t) => {
  const f = bundledFixture(t, {compiledIds: ['alpha_widget']});
  writeWidgetFixture(path.join(f.appDir, 'lib', 'widgets'), 'alpha_widget');
  const sentinel = path.join(f.appDir, 'sealed-startup-sentinel');
  for (const name of ['token.tmp', 'control.secret']) {
    fs.writeFileSync(sentinel, 'sealed bytes');
    const destination = path.join(f.workspace, '.pi', 'pif', name);
    fs.symlinkSync(sentinel, destination);
    const hub = makeBundledHub(f.workspace);
    hub.store.init = async () => {};
    hub.tracker.init = async () => {};
    hub.tracker.start = () => {};
    hub.startWebSocket = async () => { throw new Error('unexpected server startup'); };
    try {
      await assert.rejects(hub.start(false), /bundle|\.app\/Contents/i, name);
      assert.equal(fs.readFileSync(sentinel, 'utf8'), 'sealed bytes', name);
    } finally {
      fs.rmSync(destination, {force: true});
    }
  }
});

test('shell preference save rejects a bundle-directed atomic temporary file (#187)', async (t) => {
  const f = bundledFixture(t, {compiledIds: ['alpha_widget']});
  writeWidgetFixture(path.join(f.appDir, 'lib', 'widgets'), 'alpha_widget');
  const sentinel = path.join(f.appDir, 'sealed-shell-sentinel');
  fs.writeFileSync(sentinel, 'sealed bytes');
  const storage = path.join(f.workspace, '.pi', 'pif', 'storage');
  fs.mkdirSync(storage, {recursive: true});
  fs.symlinkSync(sentinel, path.join(storage, 'shell.json.tmp'));
  const hub = makeBundledHub(f.workspace);
  await assert.rejects(hub.control('shell.dev_mode', {enabled: true}), /bundle|\.app\/Contents/i);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'sealed bytes');
  assert.equal(hub.state.devMode, false, 'failed publication does not change the authoritative preference');
});

test('native host normalization keeps custom input echoes and non-text deltas out of answers (#215)', (t) => {
  const f = layeredFixture(t);
  const hub = layeredHub(f.workspace);
  hub.state.sessions.host = {id: 'host', name: 'Host', host: true, state: 'idle', model: 'fixture', thinking: 'low', cwd: f.workspace, transcript: [{type: 'input', content: 'hello'}]};
  const custom = {role: 'custom', customType: 'pif-input', content: 'hello', timestamp: 1000};
  hub.hostEvent('message_start', {message: custom});
  hub.hostEvent('message_end', {message: custom});
  const assistant = {role: 'assistant', timestamp: 2000, content: [{type: 'text', text: 'Hello'}]};
  for (const assistantMessageEvent of [
    {type: 'thinking_delta', delta: 'PRIVATE_SYNTHETIC_REASONING'},
    {type: 'toolcall_delta', delta: '{"synthetic":"tool arguments"}'},
    {type: 'text_end', content: 'Hello'},
  ]) hub.hostEvent('message_update', {message: assistant, assistantMessageEvent});
  const visible = () => hub.state.sessions.host.transcript.filter((entry) => Boolean(entry.text || entry.delta || entry.content));
  assert.deepEqual(visible(), [{type: 'input', content: 'hello'}]);
  hub.hostEvent('message_update', {message: assistant, assistantMessageEvent: {type: 'text_delta', delta: 'Hel'}});
  hub.hostEvent('message_update', {message: assistant, assistantMessageEvent: {type: 'text_delta', delta: 'lo'}});
  hub.hostEvent('message_end', {message: assistant});
  assert.deepEqual(visible().map((entry) => entry.content || entry.delta || entry.text), ['hello', 'Hel', 'lo', 'Hello']);
  assert.equal(visible().filter((entry) => entry.text === 'Hello').length, 1);
});

test('native tool normalization preserves correlated structured errors for the console (#215)', (t) => {
  const f = layeredFixture(t);
  const hub = layeredHub(f.workspace);
  hub.state.sessions.host = {id: 'host', name: 'Host', host: true, state: 'running', model: 'fixture', thinking: 'low', cwd: f.workspace, transcript: []};
  hub.hostEvent('tool_execution_start', {toolCallId: 'fixture-call', toolName: 'fixture_read', args: {path: 'fixture.txt'}});
  hub.hostEvent('tool_execution_update', {toolCallId: 'fixture-call', toolName: 'fixture_read', partialResult: {content: [{type: 'text', text: 'opening fixture'}]}});
  hub.hostEvent('tool_execution_end', {toolCallId: 'fixture-call', toolName: 'fixture_read', isError: true, result: {content: [{type: 'text', text: 'Fixture access denied'}]}});
  const events = hub.state.sessions.host.transcript;
  assert.deepEqual(events.map((entry) => entry.toolCallId), ['fixture-call', 'fixture-call', 'fixture-call']);
  assert.match(events[0].args, /fixture\.txt/);
  assert.equal(events[2].isError, true);
  assert.match(events[2].result, /Fixture access denied/);
  assert.doesNotMatch(events[2].result, /\[object Object\]/);
});

test('native stored custom inputs and tool results hydrate once with correct roles (#215)', (t) => {
  const f = layeredFixture(t);
  const hub = layeredHub(f.workspace);
  const sessionFile = path.join(f.workspace, 'fixture-history.jsonl');
  const records = [
    {type: 'session', id: 'fixture-session'},
    {type: 'custom_message', customType: 'pif-input', content: 'Check fixture', timestamp: '2026-08-31T03:00:00Z'},
    {type: 'message', message: {role: 'assistant', content: [{type: 'thinking', thinking: 'SYNTHETIC_PRIVATE_THINKING'}, {type: 'text', text: 'Checking.'}], timestamp: 1000}},
    {type: 'message', message: {role: 'toolResult', toolCallId: 'history-call', toolName: 'fixture_read', isError: true, content: [{type: 'text', text: 'Fixture unavailable'}], timestamp: 2000}},
    {type: 'message', message: {role: 'assistant', content: [{type: 'text', text: 'Could not read it.'}], timestamp: 3000}},
  ];
  fs.writeFileSync(sessionFile, records.map((record) => JSON.stringify(record)).join('\n') + '\n');
  const session = {id: 'history', host: false, state: 'ended', transcript: [], sessionFile};
  hub.hydrateTranscript(session);
  const count = session.transcript.length;
  hub.hydrateTranscript(session);
  assert.equal(session.transcript.length, count);
  assert.deepEqual(session.transcript.filter((entry) => entry.type === 'input').map((entry) => entry.content), ['Check fixture']);
  assert.deepEqual(session.transcript.filter((entry) => entry.text).map((entry) => entry.text), ['Checking.', 'Could not read it.']);
  const tool = session.transcript.find((entry) => entry.toolCallId === 'history-call');
  assert.equal(tool?.isError, true);
  assert.match(tool?.result ?? '', /Fixture unavailable/);
  assert.ok(!JSON.stringify(session.transcript).includes('SYNTHETIC_PRIVATE_THINKING'));
});

test('native empty failures and cancellation reasons survive normalization (#215)', (t) => {
  const f = layeredFixture(t);
  const hub = layeredHub(f.workspace);
  hub.state.sessions.host = {id: 'host', host: true, state: 'running', transcript: []};
  const failed = {role: 'assistant', content: [], stopReason: 'error', errorMessage: 'Fixture provider unavailable'};
  hub.hostEvent('message_end', {message: failed});
  const failure = hub.state.sessions.host.transcript.at(-1);
  assert.equal(failure.stopReason, 'error');
  assert.equal(failure.errorMessage, 'Fixture provider unavailable');
  assert.equal(failure.text, '');
  const aborted = {role: 'assistant', content: [], stopReason: 'aborted', errorMessage: 'Request was aborted'};
  hub.hostEvent('message_end', {message: aborted});
  assert.equal(hub.state.sessions.host.transcript.at(-1).aborted, true);
  hub.hostEvent('agent_end', {messages: [aborted]});
  assert.equal(hub.state.sessions.host.transcript.at(-1).aborted, true);
  assert.equal(hub.state.sessions.host.state, 'idle');
});

test('new child initial prompt is visible once before native user echoes (#215)', async (t) => {
  const f = layeredFixture(t);
  const hub = layeredHub(f.workspace);
  // This case exercises transcript routing, not persistence; the hub is not started.
  hub.store.upsert = () => {};
  const {harness, restore} = patchBuildSpawn([{kind: 'child'}]);
  t.after(restore);
  const events = [];
  hub.broadcast = (channel, type, payload) => events.push({channel, type, payload});
  const session = await hub.control('session.spawn', {prompt: 'Initial child fixture', model: 'fixture/model'});
  assert.equal(harness.children.length, 1);
  assert.deepEqual(session.transcript.filter((entry) => entry.type === 'input').map((entry) => entry.content), ['Initial child fixture']);
  const user = {role: 'user', content: [{type: 'text', text: 'Initial child fixture'}]};
  hub.childEvent(session, JSON.stringify({type: 'message_start', message: user}));
  hub.childEvent(session, JSON.stringify({type: 'message_end', message: user}));
  assert.equal(session.transcript.filter((entry) => entry.type === 'input').length, 1);
  assert.equal(events.filter((event) => event.channel === 'session/event' && event.type === 'input').length, 1);
  harness.children[0].emit('exit', 0, null);
});

test('hub model files follow the native profile with legacy override preserved (#201)', (t) => {
  const f = layeredFixture(t);
  const previous = process.env.PI_CODING_AGENT_DIR;
  const previousModels = process.env.PIF_MODELS_PATH;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    if (previousModels === undefined) delete process.env.PIF_MODELS_PATH; else process.env.PIF_MODELS_PATH = previousModels;
  });
  const profile = path.join(f.workspace, 'native profile');
  fs.mkdirSync(profile);
  fs.writeFileSync(path.join(profile, 'models.json'), JSON.stringify({providers: {fixture: {models: [{id: 'profile-model'}]}}}));
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({enabledModels: ['fixture/enabled-model']}));
  process.env.PI_CODING_AGENT_DIR = profile;
  delete process.env.PIF_MODELS_PATH;
  const hub = layeredHub(f.workspace);
  assert.equal(hub.modelsPath, path.join(profile, 'models.json'));
  assert.deepEqual(hub.readModelsList(), ['fixture/enabled-model', 'fixture/profile-model']);
  const legacy = path.join(profile, 'legacy-models.json');
  fs.writeFileSync(legacy, '{"providers":{}}');
  process.env.PIF_MODELS_PATH = legacy;
  assert.equal(layeredHub(f.workspace).modelsPath, legacy);
});

test('fresh exported launch starts in app mode without erasing the saved preference (#211)', (t) => {
  const f = layeredFixture(t);
  const prior = process.env.PIF_EXPORTED;
  t.after(() => { if (prior === undefined) delete process.env.PIF_EXPORTED; else process.env.PIF_EXPORTED = prior; });
  const hub = layeredHub(f.workspace);
  fs.mkdirSync(path.dirname(hub.shellStatePath), {recursive: true});
  const saved = JSON.stringify({devMode: true, unrelated: 'keep'});
  fs.writeFileSync(hub.shellStatePath, saved);
  process.env.PIF_EXPORTED = '1';
  hub.loadShellState();
  assert.equal(hub.state.devMode, false);
  assert.equal(fs.readFileSync(hub.shellStatePath, 'utf8'), saved);
  delete process.env.PIF_EXPORTED;
  hub.loadShellState();
  assert.equal(hub.state.devMode, true);
});

test('tracker results echo request identity for success and failure (#216)', async (t) => {
  const f = layeredFixture(t);
  const hub = layeredHub(f.workspace);
  const events = [];
  hub.broadcast = (channel, type, payload) => events.push({channel, type, payload});
  for (const op of ['create', 'update', 'delete']) {
    for (const ok of [true, false]) {
      const requestId = `fixture-${op}-${ok}`;
      hub.tracker[op] = () => ok ? {ok: true, number: 11} : {ok: false, error: 'Fixture write rejected'};
      await hub.control(`tracker.${op}`, {number: 11, requestId});
      const event = events.at(-1);
      assert.equal(event.channel, 'tracker/op');
      assert.equal(event.type, 'op_result');
      assert.equal(event.payload.requestId, requestId);
      assert.equal(event.payload.op, op);
      assert.equal(event.payload.ok, ok);
    }
  }
});

test('trackerParentRef binds tasks to their sprint, else epic; ambiguity resolves to null', () => {
  const body = '### Reference Index\n- **Epic**: #152 · **Sprint**: #153 (slotted before #157)\n\n## Task\nDo the thing.';
  assert.equal(trackerParentRef(body, 'task'), 153);
  const epicOnly = '### Reference Index\n- **Epic**: #152\n\n## Task\nGo.';
  assert.equal(trackerParentRef(epicOnly, 'task'), 152);
  assert.equal(trackerParentRef(epicOnly, 'sprint'), 152);
  const ambiguous = 'Epic: #152\nEpic: #155\nSprint: #1\nSprint: #2';
  assert.equal(trackerParentRef(ambiguous, 'task'), null);
  assert.equal(trackerParentRef(ambiguous, 'sprint'), null);
  assert.equal(trackerParentRef('No references at all', 'task'), null);
  assert.equal(trackerParentRef('Epic: #10', 'epic'), null);
  assert.equal(trackerParentRef('anything', 'issue'), null);
});

test('trackerExcerpt strips markdown, skips Reference Index, caps with ellipsis', () => {
  const body = '### Reference Index\n- **Epic**: #152 · **Sprint**: #153\n\n## Task\nGive the tracker board an **epic drill-down** so work is viewed per-epic.\n\n## Atomicity\n- Complexity score: 4.0';
  const excerpt = trackerExcerpt(body);
  assert.ok(excerpt.startsWith('Give the tracker board'), excerpt);
  assert.ok(!excerpt.includes('Reference Index'), excerpt);
  assert.ok(!excerpt.includes('**'), excerpt);
  assert.equal(trackerExcerpt('Plain task body'), 'Plain task body');
  assert.equal(trackerExcerpt(''), '');
  const long = trackerExcerpt('word '.repeat(200).trim(), 240);
  assert.ok(long.length <= 241, `${long.length}`);
  assert.ok(long.endsWith('…'));
});

test('plannedLabelChange diffs tags while preserving status and type labels', () => {
  const plan = plannedLabelChange(['task', 'status:todo', 'old-tag'], ['task', 'status:todo', 'new-tag'], 'task');
  assert.deepEqual(plan.add, ['new-tag']);
  assert.deepEqual(plan.remove, ['old-tag']);
  const none = plannedLabelChange(['task', 'status:todo'], ['task', 'status:todo'], 'task');
  assert.deepEqual(none.add, []);
  assert.deepEqual(none.remove, []);
  const protect = plannedLabelChange(['task', 'status:in-progress'], ['design'], 'task');
  assert.deepEqual(protect.add, ['design']);
  assert.deepEqual(protect.remove, []);
});

test('parseAppManifest accepts block and inline list forms with s-prefixed ids', () => {
  const good = parseAppManifest('id: notes\nname: Notes\nversion: 0.1.0\nhome: settings\npages:\n  - settings\n  - search\n  - ss_panel\ntemplate: mercury\ndependencies:\n  - search_index\n  - ss_catalog\n');
  assert.equal(good.error, undefined);
  assert.deepEqual(good.manifest, { id: 'notes', name: 'Notes', version: '0.1.0', home: 'settings', pages: ['settings', 'search', 'ss_panel'], template: 'mercury', dependencies: ['search_index', 'ss_catalog'] });
  const inline = parseAppManifest('id: notes\nname: Notes\nhome: settings\npages: [settings, search, ss_panel]\ndependencies: [search_index, ss_catalog]\n');
  assert.deepEqual(inline.manifest, { id: 'notes', name: 'Notes', version: '0.1.0', home: 'settings', pages: ['settings', 'search', 'ss_panel'], template: undefined, dependencies: ['search_index', 'ss_catalog'] });
  assert.deepEqual(parseAppManifest(renderAppManifest(good.manifest)).manifest, good.manifest);
  assert.deepEqual(parseAppManifest(renderAppManifest(inline.manifest)).manifest, { ...inline.manifest, template: undefined });
  assert.match(parseAppManifest('id: Bad Id\nname: X\nhome: a\npages: [a]').error, /kebab identifier/);
  assert.match(parseAppManifest('id: notes\nhome: home\npages: [home]').error, /'name' is required/);
  assert.match(parseAppManifest('id: notes\nname: N\nhome: editor\npages: [home]').error, /'home' must be one of the declared pages/);
  assert.match(parseAppManifest('id: notes\nname: N\nhome: settings\npages: [settings, settings]').error, /duplicate/);
  assert.match(parseAppManifest('id: notes\nname: N\nhome: settings\npages: [settings]\ntemplate: not valid template!\n').error, /template/);
  assert.match(parseAppManifest('what is this line\n', ).error, /line 1/);
});

test('app manifest updates validate and render round-trips', () => {
  const base = parseAppManifest('id: notes\nname: Notes\nhome: settings\npages: [settings]\ndependencies: [search_index]\n').manifest;
  const withPage = addAppPage(base, 'search');
  assert.deepEqual(withPage.manifest.pages, ['settings', 'search']);
  assert.match(addAppPage(base, 'settings').error, /already declared/);
  assert.match(addAppPage(base, 'Not Kebab').error, /widget identifier/);
  const newHome = setAppHome(withPage.manifest, 'search');
  assert.equal(newHome.manifest.home, 'search');
  assert.match(setAppHome(withPage.manifest, 'missing').error, /must be one of the declared pages/);
  assert.equal(slugifyAppId('My Fancy App!'), 'my-fancy-app');
  const rendered = renderAppManifest(newHome.manifest);
  const reparsed = parseAppManifest(rendered);
  assert.equal(reparsed.error, undefined);
  assert.deepEqual(reparsed.manifest, newHome.manifest);
});

test('pif_app.build publishes correlated build_result envelopes and stays responsive (#192)', async () => {
  const workspace = tempDir('pif-build-');
  const appDir = tempDir('pif-build-app-');
  const globalCatalog = tempDir('pif-build-catalog-');
  const modelsPath = path.join(workspace, '.pi', 'agent', 'models.json');
  const agentDir = path.join(workspace, '.pi', 'agent');
  const previousEnv = {
    PIF_APP_DIR: process.env.PIF_APP_DIR,
    PIF_GLOBAL_CATALOG: process.env.PIF_GLOBAL_CATALOG,
    PIF_MODELS_PATH: process.env.PIF_MODELS_PATH,
    PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
  };
  fs.mkdirSync(path.join(agentDir, 'agents'), {recursive: true});
  fs.mkdirSync(path.join(agentDir, 'extensions'), {recursive: true});
  fs.mkdirSync(path.join(agentDir, 'state'), {recursive: true});
  fs.mkdirSync(appDir, {recursive: true});
  fs.mkdirSync(globalCatalog, {recursive: true});
  fs.writeFileSync(path.join(appDir, 'pubspec.yaml'), 'name: pif_build_app\n');
  fs.writeFileSync(modelsPath, JSON.stringify({providers: {}}, null, 2) + '\n');
  const peerMessages = [];
  const peer = { sendRaw(payload) { peerMessages.push(JSON.parse(Buffer.from(payload).toString())); }, close() {} };
  const { harness, restore } = patchBuildSpawn([
    {kind: 'child'},
    {kind: 'child'},
    {kind: 'error', message: 'spawn failed asynchronously', code: 127},
    {kind: 'throw', message: 'spawn denied by fixture'},
  ]);
  let hub;
  try {
    process.env.PIF_APP_DIR = appDir;
    process.env.PIF_GLOBAL_CATALOG = globalCatalog;
    process.env.PIF_MODELS_PATH = modelsPath;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    hub = new __pif.PifHub({}, { ui: { setStatus() {}, notify() {} }, model: { id: 'fixture-model' }, thinkingLevel: 'low' }, workspace, 0);
    hub.state.app = parseAppManifest('id: notes\nname: Notes\nhome: home\npages: [home]\ndependencies: []\n').manifest;
    hub.peers.add(peer);
    const buildScript = path.join(repo, 'scripts', 'build-pif-project-app.sh');
    // Fake children only: this checks the app/build contract, not real process cleanup.

    const success = hub.control('pif_app.build', { name: 'Exported App' });
    const successChild = harness.children[0];
    assert.equal(path.basename(harness.calls[0].command), path.basename(buildScript));
    assert.deepEqual(harness.calls[0].args, [workspace, 'Exported App']);
    successChild.emitSpawn();
    const successAck = await success;
    assert.equal(successAck.ok, true);
    assert.equal(successAck.started, true);
    assert.equal(successAck.name, 'Exported App');
    const statusDuringSuccess = await hub.control('shell.status');
    assert.equal(statusDuringSuccess.app.id, 'notes');
    const stdoutChunk = 'stdout-'.repeat(400);
    const stderrChunk = 'stderr-'.repeat(400);
    successChild.stdout.emit('data', stdoutChunk);
    successChild.stderr.emit('data', stderrChunk);
    successChild.emitClose(0);
    successChild.emitClose(0);
    await waitFor(() => peerMessages.length === 1, 'first build_result');
    assert.equal(peerMessages.length, 1);
    assert.equal(peerMessages[0].channel, 'app/build');
    assert.equal(peerMessages[0].type, 'build_result');
    assert.equal(peerMessages[0].payload.buildId, successAck.buildId);
    assert.equal(peerMessages[0].payload.name, 'Exported App');
    assert.equal(peerMessages[0].payload.ok, true);
    assert.equal(peerMessages[0].payload.code, 0);
    assert.equal(peerMessages[0].payload.output.length, 4000);
    assert.equal(peerMessages[0].payload.output, `${stdoutChunk}${stderrChunk}`.slice(-4000));

    const nonzero = hub.control('pif_app.build', { name: 'Broken App' });
    const nonzeroChild = harness.children[1];
    assert.deepEqual(harness.calls[1].args, [workspace, 'Broken App']);
    nonzeroChild.emitSpawn();
    const nonzeroAck = await nonzero;
    assert.equal(nonzeroAck.ok, true);
    const statusDuringFailure = await hub.control('shell.status');
    assert.equal(statusDuringFailure.app.id, 'notes');
    nonzeroChild.stdout.emit('data', 'warn ');
    nonzeroChild.emitClose(17);
    await waitFor(() => peerMessages.length === 2, 'second build_result');
    assert.equal(peerMessages[1].payload.buildId, nonzeroAck.buildId);
    assert.equal(peerMessages[1].payload.ok, false);
    assert.equal(peerMessages[1].payload.code, 17);
    assert.equal(peerMessages[1].payload.output, 'warn ');
    assert.equal(peerMessages[1].payload.error, undefined);

    const asyncError = await hub.control('pif_app.build', { name: 'Async Fail App' });
    assert.equal(harness.calls[2].args[1], 'Async Fail App');
    assert.equal(asyncError.ok, false);
    assert.equal(asyncError.started, false);
    assert.match(asyncError.error, /spawn failed asynchronously/);
    const statusAfterAsyncError = await hub.control('shell.status');
    assert.equal(statusAfterAsyncError.app.id, 'notes');
    await waitFor(() => peerMessages.length === 3, 'async-error build_result');
    assert.equal(peerMessages[2].payload.buildId, asyncError.buildId);
    assert.equal(peerMessages[2].payload.ok, false);
    assert.equal(peerMessages[2].payload.code, -1);
    assert.match(peerMessages[2].payload.error, /spawn failed asynchronously/);
    assert.equal(peerMessages[2].payload.output, '');

    const spawnError = await hub.control('pif_app.build', { name: 'Denied App' });
    assert.equal(harness.calls[3].args[1], 'Denied App');
    assert.equal(spawnError.ok, false);
    assert.equal(spawnError.started, false);
    assert.match(spawnError.error, /spawn denied by fixture/);
    const statusAfterError = await hub.control('shell.status');
    assert.equal(statusAfterError.app.id, 'notes');
    await waitFor(() => peerMessages.length === 4, 'spawn-error build_result');
    assert.equal(peerMessages[3].payload.buildId, spawnError.buildId);
    assert.equal(peerMessages[3].payload.ok, false);
    assert.equal(peerMessages[3].payload.code, -1);
    assert.match(peerMessages[3].payload.error, /spawn denied by fixture/);
    assert.equal(peerMessages[3].payload.output, '');
  } finally {
    if (hub) await hub.stop();
    restore();
    if (previousEnv.PIF_APP_DIR === undefined) delete process.env.PIF_APP_DIR; else process.env.PIF_APP_DIR = previousEnv.PIF_APP_DIR;
    if (previousEnv.PIF_GLOBAL_CATALOG === undefined) delete process.env.PIF_GLOBAL_CATALOG; else process.env.PIF_GLOBAL_CATALOG = previousEnv.PIF_GLOBAL_CATALOG;
    if (previousEnv.PIF_MODELS_PATH === undefined) delete process.env.PIF_MODELS_PATH; else process.env.PIF_MODELS_PATH = previousEnv.PIF_MODELS_PATH;
    if (previousEnv.PI_CODING_AGENT_DIR === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousEnv.PI_CODING_AGENT_DIR;
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(appDir, { recursive: true, force: true });
    fs.rmSync(globalCatalog, { recursive: true, force: true });
  }
});
