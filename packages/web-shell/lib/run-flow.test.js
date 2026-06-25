import { describe, it, expect, vi, beforeEach } from 'vitest';

// Layer B extraction — mocked so we control the brief and can assert it ran.
const extractMock = vi.fn(async () => ({
  brief: 'mode: layout\nconfidence: high\n# Brief\nsurface: #ffffff\naccent: #c8e85a',
  mode: 'layout',
  confidence: 'high',
}));
vi.mock('./design/style-extract.js', () => ({ extractStyleFromImage: extractMock }));

// Anthropic compose path (default model claude-sonnet-4-6).
const anthropicStream = vi.fn(() => ({
  finalMessage: async () => ({ content: [{ text: '<html><body>composed</body></html>' }], usage: {} }),
}));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    constructor() {
      this.messages = { stream: anthropicStream };
    }
  },
}));

// OpenAI vision path (used only on fallback / forced vision).
const openaiCreate = vi.fn();
vi.mock('openai', () => ({
  default: class {
    constructor() {
      this.chat = { completions: { create: openaiCreate } };
    }
  },
}));

const { runCompose } = await import('./run-flow.js');

function openaiStreamOf(text) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { choices: [{ delta: { content: text } }] };
    },
  };
}

const target = { kind: 'site', current_html: '<html><body>target content</body></html>' };

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  process.env.OPENAI_API_KEY = 'sk-test';
  extractMock.mockClear();
  anthropicStream.mockClear();
  openaiCreate.mockClear();
});

describe('runCompose — Layer B image → style brief', () => {
  it('extracts a brief from an image and composes on the text model (no vision leak)', async () => {
    const sources = [{ kind: 'asset', meta: { dataUrl: 'data:image/png;base64,AAA' } }];
    const { html } = await runCompose({ target, sources });

    expect(extractMock).toHaveBeenCalledTimes(1);
    expect(html).toContain('composed');
    // Compose ran on Anthropic (text), NOT forced to OpenAI vision.
    expect(anthropicStream).toHaveBeenCalledTimes(1);
    expect(openaiCreate).not.toHaveBeenCalled();
    // The brief reached compose as a DESIGN.MD source; the raw image did not.
    const userText = anthropicStream.mock.calls[0][0].messages[0].content;
    expect(userText).toContain('DESIGN.MD SOURCE');
    expect(userText).toContain('accent: #c8e85a');
    expect(userText).not.toContain('base64');
  });

  it('falls back to a raw vision compose when extraction fails', async () => {
    extractMock.mockRejectedValueOnce(new Error('vision down'));
    openaiCreate.mockResolvedValue(openaiStreamOf('<html><body>vision composed</body></html>'));
    const sources = [{ kind: 'asset', meta: { dataUrl: 'data:image/png;base64,AAA' } }];

    const { html } = await runCompose({ target, sources });

    expect(extractMock).toHaveBeenCalledTimes(1);
    expect(openaiCreate).toHaveBeenCalledTimes(1); // forced gpt-5.5 vision
    expect(html).toContain('vision composed');
  });

  it('does not call extraction when there are no image sources', async () => {
    const sources = [{ kind: 'prompt', meta: { prompt: 'make the hero bolder' } }];
    const { html } = await runCompose({ target, sources });

    expect(extractMock).not.toHaveBeenCalled();
    expect(anthropicStream).toHaveBeenCalledTimes(1);
    expect(html).toContain('composed');
  });
});
