// lib/run-flow.usage.test.js — metering seams for compose (Task 9) + demarcelize (Task 10)
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    constructor() {
      this.messages = {
        stream: () => ({
          finalMessage: async () => ({
            content: [{ text: '<html><body>composed</body></html>' }],
            usage: { input_tokens: 2000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          }),
        }),
      };
    }
  },
}));
vi.mock('openai', () => ({
  default: class {
    constructor() {
      this.chat = { completions: { create: async () => (async function* () {
        yield { choices: [{ delta: { content: '<html>x</html>' } }] };
        yield { choices: [], usage: { prompt_tokens: 800, completion_tokens: 200 } };
      })() } };
    }
  },
}));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    constructor() {
      this.models = { generateContent: async () => ({
        text: '<html>g</html>',
        usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 50 },
      }) };
    }
  },
}));

const { runCompose } = await import('./run-flow.js');
const { runMeteredOperation } = await import('./billing/context.js');

const target = { kind: 'site', current_html: '<html><body>target</body></html>' };
const noDb = { holdCredits: vi.fn(), refundHold: vi.fn() };

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  process.env.OPENAI_API_KEY = 'sk-test';
});

describe('run-flow usage metering', () => {
  it('records the Anthropic compose call into the ambient billing context', async () => {
    const settle = vi.fn(async () => ({ balanceAfter: 0 }));
    await runMeteredOperation({ sql: () => Promise.resolve([]), userId: 'u1', op: 'compose' }, async () => {
      await runCompose({ target, sources: [{ kind: 'prompt', meta: { prompt: 'make it blue' } }] });
    }, { ...noDb, settleOperation: settle });
    const events = settle.mock.calls[0][0].events;
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]).toMatchObject({ provider: 'anthropic', tokensIn: 2000, tokensOut: 500 });
  });
});

describe('demarcelize usage metering (Task 10)', () => {
  it('records the Anthropic reskin call into the ambient billing context', async () => {
    const { reskin } = await import('./demarcelize.js');
    const settle = vi.fn(async () => ({ balanceAfter: 0 }));
    await runMeteredOperation({ sql: () => Promise.resolve([]), userId: 'u1', op: 'transplant' }, async () => {
      await reskin({ targetHtml: '<html>t</html>', referenceHtml: '<html>r</html>' });
    }, { ...noDb, settleOperation: settle });
    const events = settle.mock.calls[0][0].events;
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]).toMatchObject({ provider: 'anthropic', tokensIn: 2000, tokensOut: 500 });
  });
});
