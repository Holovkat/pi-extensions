import test from 'node:test';
import assert from 'node:assert/strict';

import { __test } from './coms-net-server.ts';

function resetState() {
  __test.state.projects.clear();
}

function fakeStream() {
  const frames = [];
  return {
    frames,
    writer: {
      session_id: 'unused',
      lastId: 0,
      enqueue(frame) { frames.push(frame); },
      close() {},
    },
  };
}

test('queued coms-net messages replay when target SSE stream reconnects', () => {
  resetState();
  const p = __test.getOrCreateProject('default');
  p.agents.set('sender', {
    session_id: 'sender', name: 'sender', purpose: '', model: 'm', color: '#fff', cwd: '/tmp', project: 'default', explicit: false,
    started_at: new Date().toISOString(), context_used_pct: 0, queue_depth: 0, status: 'online', registered_at: new Date().toISOString(), last_seen_at: new Date().toISOString(),
  });
  p.agents.set('target', {
    session_id: 'target', name: 'target', purpose: '', model: 'm', color: '#fff', cwd: '/tmp', project: 'default', explicit: false,
    started_at: new Date().toISOString(), context_used_pct: 0, queue_depth: 0, status: 'online', registered_at: new Date().toISOString(), last_seen_at: new Date().toISOString(),
  });
  const targetStream = fakeStream();
  const senderStream = fakeStream();
  p.streams.set('target', { ...targetStream.writer, session_id: 'target' });
  p.streams.set('sender', { ...senderStream.writer, session_id: 'sender' });
  p.messages.set('msg1', {
    msg_id: 'msg1', project: 'default', sender_session: 'sender', target_session: 'target', prompt: 'hello',
    conversation_id: null, response_schema: null, hops: 0, status: 'queued', response: null, error: null,
    created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60_000).toISOString(),
  });

  assert.equal(__test.flushQueuedPromptsForTarget(p, 'default', 'target'), 1);
  assert.equal(p.messages.get('msg1').status, 'delivered');
  assert.match(targetStream.frames.join('\n'), /event: prompt/);
  assert.match(senderStream.frames.join('\n'), /"status":"delivered"/);
});

test('expired queued messages become observable terminal errors before retention deletion', () => {
  resetState();
  const p = __test.getOrCreateProject('default');
  p.agents.set('target', {
    session_id: 'target', name: 'target', purpose: '', model: 'm', color: '#fff', cwd: '/tmp', project: 'default', explicit: false,
    started_at: new Date().toISOString(), context_used_pct: 0, queue_depth: 0, status: 'online', registered_at: new Date().toISOString(), last_seen_at: new Date().toISOString(),
  });
  const senderStream = fakeStream();
  p.streams.set('sender', { ...senderStream.writer, session_id: 'sender' });
  p.messages.set('expired', {
    msg_id: 'expired', project: 'default', sender_session: 'sender', target_session: 'target', prompt: 'hello',
    conversation_id: null, response_schema: null, hops: 0, status: 'queued', response: null, error: null,
    created_at: new Date(Date.now() - 120_000).toISOString(), expires_at: new Date(Date.now() - 60_000).toISOString(),
  });

  __test.ttlScanTick();
  const msg = p.messages.get('expired');
  assert.equal(msg.status, 'error');
  assert.equal(msg.error, 'expired');
  assert.ok(msg.completed_at);
  assert.match(senderStream.frames.join('\n'), /"error":"expired"/);
});

test('server registry project path segments are sanitized without collisions', () => {
  assert.equal(__test.sanitizePathSegment('../evil/project'), '..%2Fevil%2Fproject');
  assert.equal(__test.sanitizePathSegment('..'), '%2E%2E');
  assert.equal(__test.sanitizePathSegment(''), '%00default');
  assert.notEqual(__test.sanitizePathSegment('evil/project'), __test.sanitizePathSegment('evil-project'));
});
