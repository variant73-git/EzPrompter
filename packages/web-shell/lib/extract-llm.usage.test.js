// lib/extract-llm.usage.test.js
import { describe, it, expect, vi } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      stream: () => ({
        finalMessage: async () => ({
          content: [{ text: '<html>x</html>' }],
          usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 200, cache_creation_input_tokens: 0 },
        }),
      }),
    };
  },
}));
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: async () => (async function* () {
      yield { choices: [{ delta: { content: 'hi' } }] };
      yield { choices: [], usage: { prompt_tokens: 900, completion_tokens: 150, prompt_tokens_details: { cached_tokens: 100 } } };
    })() } };
  },
}));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: async () => ({
      text: 'tokens md',
      usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 80, cachedContentTokenCount: 0 },
    }) };
  },
}));

import { describeImageAsTokens } from './extract-llm.js';
import { runMeteredOperation } from './billing/context.js';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('extract-llm usage metering', () => {
  it('records Gemini usage into the ambient billing context', async () => {
    process.env.GEMINI_API_KEY = 'test';
    const settle = vi.fn(async () => ({ balanceAfter: 0 }));
    await runMeteredOperation({ sql: () => Promise.resolve([]), userId: 'u1', op: 'extract.tokens' }, async () => {
      await describeImageAsTokens({ dataUrl: PNG, model: 'gemini-2.5-flash' });
    }, { holdCredits: vi.fn(), refundHold: vi.fn(), settleOperation: settle });
    const events = settle.mock.calls[0][0].events;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ provider: 'gemini', model: 'gemini-2.5-flash', tokensIn: 500, tokensOut: 80 });
  });
});
