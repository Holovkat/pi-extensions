import test from 'node:test';
import assert from 'node:assert/strict';

import { __test } from './lmstudio-provider.ts';

test('detectCompat enables qwen thinking compat for qwen-family LM Studio models', () => {
  const compat = __test.detectCompat({
    id: 'unsloth/qwen3.5-32b-reasoner',
    architecture: { type: 'qwen3' },
  });

  assert.equal(compat.supportsReasoningEffort, true);
  assert.equal(compat.thinkingFormat, 'qwen');
});

test('buildDiscoveredModel carries qwen compat into discovered model', () => {
  const model = __test.buildDiscoveredModel({
    id: 'qwen3-coder-30b',
    architecture: { type: 'qwen3', input_modalities: ['text'] },
    max_context_length: 131072,
  });

  assert.ok(model);
  assert.equal(model.compat.supportsReasoningEffort, true);
  assert.equal(model.compat.thinkingFormat, 'qwen');
});
