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
  it('keeps the image AND adds the brief so compose absorbs the full style (vision)', async () => {
    openaiCreate.mockResolvedValue(openaiStreamOf('<html><body>composed</body></html>'));
    const sources = [{ kind: 'asset', meta: { dataUrl: 'data:image/png;base64,AAA' } }];
    const { html } = await runCompose({ target, sources });

    expect(extractMock).toHaveBeenCalledTimes(1);
    expect(html).toContain('composed');
    // Image kept → compose runs on OpenAI vision (sees the style), not the text model.
    expect(openaiCreate).toHaveBeenCalledTimes(1);
    expect(anthropicStream).not.toHaveBeenCalled();
    // Compose receives BOTH the brief (DESIGN.MD) and the actual image.
    const userContent = openaiCreate.mock.calls[0][0].messages[1].content;
    const textPart = userContent.find((p) => p.type === 'text').text;
    expect(textPart).toContain('DESIGN.MD SOURCE');
    expect(textPart).toContain('accent: #c8e85a');
    expect(userContent.some((p) => p.type === 'image_url' && p.image_url.url.includes('AAA'))).toBe(true);
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
