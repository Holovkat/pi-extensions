import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

test('package manifest exposes council extension entrypoints', () => {
  assert.equal(pkg.name, '@holovkat/pi-council');
  assert.deepEqual(pkg.pi.extensions, ['./extensions/coms.ts', './extensions/council.ts']);
  for (const ext of pkg.pi.extensions) {
    assert.equal(existsSync(ext.replace('./', '')), true, `${ext} exists`);
  }
});

test('package includes council server and documentation files', () => {
  for (const file of ['scripts/council-server.ts', 'docs/comms.md', 'extensions/coms-shared.ts', 'extensions/themeMap.ts']) {
    assert.equal(existsSync(file), true, `${file} exists`);
  }
});
