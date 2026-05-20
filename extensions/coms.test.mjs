import test from 'node:test';
import assert from 'node:assert/strict';

import { __test as shared } from './coms-shared.ts';

test('reply extraction ignores stale assistant text before the inbound boundary', () => {
  const branch = [
    { id: 'old-user', type: 'message', message: { role: 'user', content: 'earlier' } },
    { id: 'old-assistant', type: 'message', message: { role: 'assistant', content: 'stale response' } },
    { id: 'boundary', type: 'message', message: { role: 'user', content: 'inbound prompt marker' } },
    { id: 'new-assistant', type: 'message', message: { role: 'assistant', content: 'fresh response' } },
  ];

  assert.equal(shared.latestAssistantTextAfterBoundary(branch, 'boundary'), 'fresh response');
});

test('reply extraction returns an empty response when the triggered turn has not produced output', () => {
  const branch = [
    { id: 'old-assistant', type: 'message', message: { role: 'assistant', content: 'stale response' } },
    { id: 'boundary', type: 'message', message: { role: 'user', content: 'inbound prompt marker' } },
  ];

  assert.equal(shared.latestAssistantTextAfterBoundary(branch, 'boundary'), '');
});

test('response truncation preserves UTF-8 boundaries and caps byte length', () => {
  const original = '🙂'.repeat(100);
  const truncated = shared.truncateUtf8(original, 96, 'council');
  const tiny = shared.truncateUtf8(original, 8, 'council');

  assert.equal(truncated.truncated, true);
  assert.ok(shared.byteLength(truncated.text) <= 96);
  assert.match(truncated.text, /council: response truncated/);
  assert.equal(tiny.truncated, true);
  assert.ok(shared.byteLength(tiny.text) <= 8);
});

test('project and agent path segments are sanitized against traversal without collisions', () => {
  assert.equal(shared.sanitizePathSegment('../other/project'), '..%2Fother%2Fproject');
  assert.equal(shared.sanitizePathSegment('..'), '%2E%2E');
  assert.equal(shared.sanitizePathSegment(''), '%00default');
  assert.equal(shared.sanitizePathSegment('agent/name'), 'agent%2Fname');
  assert.notEqual(shared.sanitizePathSegment('agent/name'), shared.sanitizePathSegment('agent-name'));
});
