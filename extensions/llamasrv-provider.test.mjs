import test from 'node:test';
import assert from 'node:assert/strict';

import { __test } from './llamasrv-provider.ts';

test('loadConfigEntriesText parses alias config rows', () => {
  const entries = __test.loadConfigEntriesText(`
# alias|path|port|ctx|preset|extra_args

gemma26|/models/gemma-4-26B-it-Q8_0.gguf|48080|32768|gemma|
qwen36|/models/Qwen3.6-35B-A3B-Q8_0.gguf|48081|65536|qwen|--metrics
`);

  assert.equal(entries.length, 2);
  assert.equal(entries[0].alias, 'gemma26');
  assert.equal(entries[0].port, 48080);
  assert.equal(entries[1].alias, 'qwen36');
  assert.deepEqual(entries[1].extraArgs, ['--metrics']);
});

test('createProviderModel builds alias-backed provider model metadata', () => {
  const model = __test.createProviderModel({
    alias: 'gemma26',
    path: '/models/gemma-4-26B-A4B-it-Q8_0.gguf',
    port: 48080,
    contextWindow: 32768,
    preset: 'gemma',
    extraArgs: [],
    baseUrl: 'http://127.0.0.1:48080/v1',
  });

  assert.equal(model.id, 'gemma26');
  assert.equal(model.baseUrl, 'http://127.0.0.1:48080/v1');
  assert.equal(model.contextWindow, 32768);
  assert.equal(model.maxTokens, 8192);
  assert.equal(model.input[0], 'text');
});

test('detectCompat enables Qwen chat-template thinking mode for qwen aliases', () => {
  const compat = __test.detectCompat({
    alias: 'qwen36',
    path: '/models/Qwen3.6-35B-A3B-Q8_0.gguf',
    preset: 'qwen',
  });

  assert.equal(compat.supportsReasoningEffort, true);
  assert.equal(compat.thinkingFormat, 'qwen-chat-template');
});

test('inferReasoning marks Gemma 4 and Qwen aliases as reasoning-capable', () => {
  assert.equal(__test.inferReasoning({ alias: 'gemma26', path: '/models/gemma-4-26B.gguf', preset: 'gemma' }), true);
  assert.equal(__test.inferReasoning({ alias: 'qwen36', path: '/models/Qwen3.6-35B.gguf', preset: 'qwen' }), true);
});
