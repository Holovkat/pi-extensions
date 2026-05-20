import test from 'node:test';
import assert from 'node:assert/strict';

import { __test } from './council-server.ts';

function resetState() {
  __test.state.projects.clear();
}

function now() {
  return new Date().toISOString();
}

function agent(session_id, name, secret = `${session_id}-secret`) {
  return {
    session_id, name, purpose: '', model: 'm', color: '#fff', cwd: '/tmp', project: 'default', explicit: false,
    started_at: now(), context_used_pct: 0, queue_depth: 0, status: 'online', registered_at: now(), last_seen_at: now(),
    session_secret: secret,
  };
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

function jsonRequest(body, secret) {
  const headers = { 'content-type': 'application/json' };
  if (secret) headers['x-pi-council-session-secret'] = secret;
  return new Request('http://council.test/v1', { method: 'POST', headers, body: JSON.stringify(body) });
}

function rawRequest(path, bodyText, secret) {
  const headers = { 'content-type': 'application/json' };
  if (secret) headers['x-pi-council-session-secret'] = secret;
  return new Request(`http://council.test${path}`, { method: 'POST', headers, body: bodyText });
}

async function responseJson(resp) {
  return JSON.parse(await resp.text());
}

test('queued council messages replay when target SSE stream reconnects', () => {
  resetState();
  const p = __test.getOrCreateProject('default');
  p.agents.set('sender', agent('sender', 'sender'));
  p.agents.set('target', agent('target', 'target'));
  const targetStream = fakeStream();
  const senderStream = fakeStream();
  p.streams.set('target', { ...targetStream.writer, session_id: 'target' });
  p.streams.set('sender', { ...senderStream.writer, session_id: 'sender' });
  p.messages.set('msg1', {
    msg_id: 'msg1', project: 'default', sender_session: 'sender', target_session: 'target', prompt: 'hello',
    conversation_id: null, response_schema: null, hops: 0, status: 'queued', response: null, error: null,
    created_at: now(), expires_at: new Date(Date.now() + 60_000).toISOString(),
  });

  assert.equal(__test.flushQueuedPromptsForTarget(p, 'default', 'target'), 1);
  assert.equal(p.messages.get('msg1').status, 'running');
  assert.match(targetStream.frames.join('\n'), /event: prompt/);
  assert.match(senderStream.frames.join('\n'), /"status":"running"/);
});

test('expired queued messages become observable terminal errors before retention deletion', () => {
  resetState();
  const p = __test.getOrCreateProject('default');
  p.agents.set('target', agent('target', 'target'));
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

test('message logs redact prompt bodies by default', () => {
  const detail = __test.formatMessageSendDetail('alice', 'bob', 'msg123456', 'secret prompt body', 0, true);
  assert.match(detail, /bytes=18/);
  assert.doesNotMatch(detail, /secret prompt body/);
});

test('offline name-addressed messages queue and replay when the agent returns', async () => {
  resetState();
  const p = __test.getOrCreateProject('default');
  p.agents.set('sender', agent('sender', 'sender', 'sender-secret'));
  const senderStream = fakeStream();
  const targetStream = fakeStream();
  p.streams.set('sender', { ...senderStream.writer, session_id: 'sender' });

  const resp = await __test.handleSendMessage(jsonRequest({
    project: 'default', sender_session: 'sender', target: 'net-bob', target_session: null,
    prompt: 'Reply exactly REPLAY-PONG', conversation_id: null, response_schema: null, hops: 0,
  }, 'sender-secret'));
  assert.equal(resp.status, 200);
  const body = await responseJson(resp);
  assert.equal(body.status, 'queued');
  assert.equal(body.target_session, null);
  assert.equal(body.target_name, 'net-bob');

  p.agents.set('target', agent('target', 'net-bob', 'target-secret'));
  p.streams.set('target', { ...targetStream.writer, session_id: 'target' });
  assert.equal(__test.flushQueuedPromptsForTarget(p, 'default', 'target'), 1);
  const msg = p.messages.get(body.msg_id);
  assert.equal(msg.target_session, 'target');
  assert.equal(msg.status, 'running');
  assert.match(targetStream.frames.join('\n'), /REPLAY-PONG/);
});

test('session secret is required for sender lifecycle operations and schema cap is enforced', async () => {
  resetState();
  const p = __test.getOrCreateProject('default');
  p.agents.set('sender', agent('sender', 'sender', 'sender-secret'));
  p.agents.set('target', agent('target', 'target', 'target-secret'));

  const base = {
    project: 'default', sender_session: 'sender', target: 'target', target_session: null,
    prompt: 'hello', conversation_id: null, response_schema: null, hops: 0,
  };
  const bad = await __test.handleSendMessage(jsonRequest(base, 'wrong-secret'));
  assert.equal(bad.status, 403);
  assert.equal((await responseJson(bad)).error, 'invalid_session_secret');

  const tooLargeSchema = await __test.handleSendMessage(jsonRequest({ ...base, response_schema: { x: 'x'.repeat(20_000) } }, 'sender-secret'));
  assert.equal(tooLargeSchema.status, 413);
  assert.equal((await responseJson(tooLargeSchema)).error, 'schema_too_large');
});

test('session secret prevents response and delete impersonation', async () => {
  resetState();
  const p = __test.getOrCreateProject('default');
  p.agents.set('sender', agent('sender', 'sender', 'sender-secret'));
  p.agents.set('target', agent('target', 'target', 'target-secret'));
  p.messages.set('msg1', {
    msg_id: 'msg1', project: 'default', sender_session: 'sender', target_session: 'target', prompt: 'hello',
    conversation_id: null, response_schema: null, hops: 0, status: 'running', response: null, error: null,
    created_at: now(), expires_at: new Date(Date.now() + 60_000).toISOString(),
  });

  const forgedResponse = await __test.handleSubmitResponse(jsonRequest({ project: 'default', responder_session: 'target', response: 'ok', error: null }, 'sender-secret'), 'msg1');
  assert.equal(forgedResponse.status, 403);
  assert.equal((await responseJson(forgedResponse)).error, 'invalid_session_secret');

  const forgedDelete = __test.handleDeleteAgent(jsonRequest({}, 'sender-secret'), new URL('http://council.test/v1/agents/target?project=default'), 'target');
  assert.equal(forgedDelete.status, 403);
  assert.equal((await responseJson(forgedDelete)).error, 'invalid_session_secret');
});

test('send endpoint rejects malformed JSON without changing server message state', async () => {
  resetState();
  const p = __test.getOrCreateProject('default');
  p.agents.set('sender', agent('sender', 'sender', 'sender-secret'));

  const beforeMessages = p.messages.size;
  const resp = await __test.handleSendMessage(rawRequest('/v1/messages', '{"project":"default","sender_session":"sender","target":"target","prompt":"oops"', 'sender-secret'));

  assert.equal(resp.status, 400);
  assert.equal((await responseJson(resp)).error, 'invalid_json');
  assert.equal(p.messages.size, beforeMessages);
});

test('send endpoint rejects oversized prompts and malformed target/payload types without mutating state', async () => {
  resetState();
  const p = __test.getOrCreateProject('default');
  p.agents.set('sender', agent('sender', 'sender', 'sender-secret'));
  p.agents.set('target', agent('target', 'target', 'target-secret'));

  const senderStream = fakeStream();
  p.streams.set('sender', { ...senderStream.writer, session_id: 'sender' });

  const base = {
    project: 'default', sender_session: 'sender', target: 'target', target_session: null,
    prompt: 'hello', conversation_id: null, response_schema: null, hops: 0,
  };

  const badTargetSession = await __test.handleSendMessage(jsonRequest({ ...base, target_session: 123 }, 'sender-secret'));
  assert.equal(badTargetSession.status, 400);
  assert.equal((await responseJson(badTargetSession)).error, 'invalid_request');

  const oversize = 'a'.repeat(70_000);
  const beforeMessages = p.messages.size;
  const senderFramesBefore = senderStream.frames.length;
  const tooLarge = await __test.handleSendMessage(jsonRequest({ ...base, prompt: oversize }, 'sender-secret'));
  assert.equal(tooLarge.status, 413);
  assert.equal((await responseJson(tooLarge)).error, 'prompt_too_large');
  assert.equal(p.messages.size, beforeMessages);
  assert.equal(p.messages.has('msg1'), false);
  assert.equal(senderStream.frames.length, senderFramesBefore);

  const badTarget = await __test.handleSendMessage(jsonRequest({ ...base, target: { name: 'target' } }, 'sender-secret'));
  assert.equal(badTarget.status, 400);
  assert.equal((await responseJson(badTarget)).error, 'invalid_request');

  const badPromptType = await __test.handleSendMessage(jsonRequest({ ...base, prompt: { text: 'hi' } }, 'sender-secret'));
  assert.equal(badPromptType.status, 400);
  assert.equal((await responseJson(badPromptType)).error, 'invalid_request');
  assert.equal(p.messages.size, beforeMessages);
});

test('send endpoint blocks suspicious or null-byte prompt payloads with stable rejection', async () => {
  resetState();
  const p = __test.getOrCreateProject('default');
  p.agents.set('sender', agent('sender', 'sender', 'sender-secret'));
  p.agents.set('target', agent('target', 'target', 'target-secret'));

  const base = {
    project: 'default', sender_session: 'sender', target: 'target', target_session: null,
    conversation_id: null, response_schema: null, hops: 0,
  };

  const script = await __test.handleSendMessage(jsonRequest({ ...base, prompt: '<script>alert(1)</script>' }, 'sender-secret'));
  assert.equal(script.status, 400);
  assert.equal((await responseJson(script)).error, 'malicious_payload');

  const nullBytes = await __test.handleSendMessage(jsonRequest({ ...base, prompt: 'safe\u0000payload' }, 'sender-secret'));
  assert.equal(nullBytes.status, 400);
  assert.equal((await responseJson(nullBytes)).error, 'malicious_payload');
  assert.equal(p.messages.size, 0);
});

test('submit response endpoint rejects malformed JSON and oversized or suspicious responses without mutating state', async () => {
  resetState();
  const p = __test.getOrCreateProject('default');
  p.agents.set('sender', agent('sender', 'sender', 'sender-secret'));
  p.agents.set('target', agent('target', 'target', 'target-secret'));

  const msg = {
    msg_id: 'msg1', project: 'default', sender_session: 'sender', target_session: 'target', target_name: 'target', prompt: 'hello',
    conversation_id: null, response_schema: null, hops: 0, status: 'running', response: null, error: null,
    created_at: now(), expires_at: new Date(Date.now() + 60_000).toISOString(),
  };
  p.messages.set('msg1', msg);
  const senderStream = fakeStream();
  p.streams.set('sender', { ...senderStream.writer, session_id: 'sender' });

  const malformed = await __test.handleSubmitResponse(rawRequest('/v1/messages/msg1/response', '{"project":"default","responder_session":"target"', 'target-secret'), 'msg1');
  assert.equal(malformed.status, 400);
  assert.equal((await responseJson(malformed)).error, 'invalid_json');

  const beforeStatus = p.messages.get('msg1').status;
  const tooLarge = await __test.handleSubmitResponse(jsonRequest({ project: 'default', responder_session: 'target', response: 'x'.repeat(70_000), error: null }, 'target-secret'), 'msg1');
  assert.equal(tooLarge.status, 413);
  assert.equal((await responseJson(tooLarge)).error, 'response_too_large');
  assert.equal(p.messages.get('msg1').status, beforeStatus);
  assert.equal(p.messages.get('msg1').response, null);

  const suspicious = await __test.handleSubmitResponse(jsonRequest({ project: 'default', responder_session: 'target', response: '<script>alert(1)</script>', error: null }, 'target-secret'), 'msg1');
  assert.equal(suspicious.status, 400);
  assert.equal((await responseJson(suspicious)).error, 'malicious_payload');
  assert.equal(p.messages.get('msg1').status, beforeStatus);
});
