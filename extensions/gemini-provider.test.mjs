import test from 'node:test';
import assert from 'node:assert/strict';

import { __test } from './gemini-provider.ts';

test('normalizeDiscoveredModels keeps text Gemini/Gemma models and strips models/ prefix', () => {
  const models = __test.normalizeDiscoveredModels({
    models: [
      {
        name: 'models/gemini-2.5-pro',
        displayName: 'Gemini 2.5 Pro',
        supportedGenerationMethods: ['generateContent', 'countTokens'],
        inputTokenLimit: 1048576,
        outputTokenLimit: 65536,
      },
      {
        name: 'models/gemini-2.5-flash-preview-tts',
        displayName: 'Gemini 2.5 Flash Preview TTS',
        supportedGenerationMethods: ['generateContent'],
        inputTokenLimit: 8192,
        outputTokenLimit: 16384,
      },
      {
        name: 'models/gemma-4-31b-it',
        displayName: 'Gemma 4 31B IT',
        supportedGenerationMethods: ['generateContent'],
        inputTokenLimit: 262144,
        outputTokenLimit: 32768,
      },
    ],
  });

  assert.deepEqual(
    models.map((model) => model.id),
    ['gemini-2.5-pro', 'gemma-4-31b-it'],
  );
  assert.equal(models[0].contextWindow, 1048576);
  assert.equal(models[0].maxTokens, 65536);
});

test('buildDiscoveryUrl appends api key as a query parameter', () => {
  const url = new URL(__test.buildDiscoveryUrl('secret-key'));
  assert.equal(url.origin, 'https://generativelanguage.googleapis.com');
  assert.equal(url.pathname, '/v1beta/models');
  assert.equal(url.searchParams.get('key'), 'secret-key');
  assert.equal(url.searchParams.get('pageSize'), '1000');
});

test('buildChatPayload omits unsupported store field', () => {
  const payload = __test.buildChatPayload(
    {
      id: 'gemma-4-26b-a4b-it',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      api: 'openai-completions',
      provider: 'google-gemini-cli',
      maxTokens: 32000,
    },
    {
      systemPrompt: 'You are helpful.',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [
        {
          name: 'echo',
          description: 'Echo text',
          parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        },
      ],
    },
    {},
  );

  assert.equal('store' in payload, false);
  assert.equal(payload.model, 'gemma-4-26b-a4b-it');
  assert.equal(payload.messages[0].role, 'system');
  assert.equal(payload.messages[1].role, 'user');
  assert.equal(payload.tools[0].function.strict, false);
});

test('parseThoughtTaggedContent splits Gemini thought tags from user-visible text', () => {
  const blocks = __test.parseThoughtTaggedContent(
    '<thought>think 1\\nthink 2</thought>Hello! How can I help you today?'
  );

  assert.deepEqual(blocks, [
    { type: 'thinking', thinking: 'think 1\\nthink 2' },
    { type: 'text', text: 'Hello! How can I help you today?' },
  ]);
});

test('buildChatPayload includes explicit reasoning disable when thinking is off', () => {
  const payload = __test.buildChatPayload(
    {
      id: 'gemini-2.5-pro',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      api: 'openai-completions',
      provider: 'google-gemini-cli',
      maxTokens: 32000,
    },
    {
      systemPrompt: 'You are helpful.',
      messages: [{ role: 'user', content: 'hi' }],
    },
    { reasoning: 'off' },
  );

  assert.deepEqual(payload.reasoning, { effort: 'none' });
});

test('Gemma 4 reasoning maps into supported low/medium/high range', () => {
  assert.equal(__test.mapGeminiReasoningEffort({ id: 'gemma-4-31b-it', reasoning: true }, 'minimal'), 'low');
  assert.equal(__test.mapGeminiReasoningEffort({ id: 'gemma-4-31b-it', reasoning: true }, 'medium'), 'medium');
  assert.equal(__test.mapGeminiReasoningEffort({ id: 'gemma-4-31b-it', reasoning: true }, 'xhigh'), 'high');
});

test('Gemini Flash Lite reasoning budget respects 512-token minimum', () => {
  assert.equal(__test.getGeminiReasoningBudget({ id: 'gemini-2.5-flash-lite', reasoning: true }, 'minimal'), 1024);
  assert.equal(__test.isGeminiFlashLiteModel('gemini-2.5-flash-lite'), true);
});
