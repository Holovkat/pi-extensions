import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

test('package manifest exposes only comms extension entrypoints', () => {
  assert.equal(pkg.name, '@holovkat/pi-comms');
  assert.deepEqual(pkg.pi.extensions, ['./extensions/coms.ts', './extensions/coms-net.ts']);
  for (const ext of pkg.pi.extensions) {
    assert.equal(existsSync(ext.replace('./', '')), true, `${ext} exists`);
  }
});

test('package includes coms-net server and documentation files', () => {
  for (const file of ['scripts/coms-net-server.ts', 'docs/comms.md', 'extensions/coms-shared.ts', 'extensions/themeMap.ts']) {
    assert.equal(existsSync(file), true, `${file} exists`);
  }
});
