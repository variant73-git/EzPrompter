import { describe, it, expect, vi, beforeEach } from 'vitest';

const createMock = vi.fn();
vi.mock('openai', () => ({
  default: class {
    constructor() {
      this.chat = { completions: { create: createMock } };
    }
  },
}));
// Don't launch a browser in unit tests — the deterministic colour sampler has
// its own suite (sample-palette.test.js).
vi.mock('./sample-palette.js', () => ({ samplePalette: vi.fn(async () => '') }));

const { extractStyleFromImage } = await import('./style-extract.js');

function streamOf(text) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { choices: [{ delta: { content: text } }] };
    },
  };
}

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'sk-test';
  createMock.mockReset();
});

describe('extractStyleFromImage', () => {
  it('returns the brief with parsed layout mode + confidence', async () => {
    createMock.mockResolvedValue(streamOf('mode: layout\nconfidence: high\n# Brief\nsurface: #ffffff'));
    const r = await extractStyleFromImage({ imageDataUrl: 'data:image/png;base64,AAA' });
    expect(r.mode).toBe('layout');
    expect(r.confidence).toBe('high');
    expect(r.brief).toContain('surface');
  });

  it('parses inspiration mode', async () => {
    createMock.mockResolvedValue(streamOf('mode: inspiration\nconfidence: low\n# Brief'));
    const r = await extractStyleFromImage({ imageDataUrl: 'data:image/jpeg;base64,BBB' });
    expect(r.mode).toBe('inspiration');
    expect(r.confidence).toBe('low');
  });

  it('defaults mode=layout, confidence=medium when the header is absent', async () => {
    createMock.mockResolvedValue(streamOf('# Brief without a header'));
    const r = await extractStyleFromImage({ imageDataUrl: 'data:image/png;base64,AAA' });
    expect(r.mode).toBe('layout');
    expect(r.confidence).toBe('medium');
  });

  it('strips code fences from the model output', async () => {
    createMock.mockResolvedValue(streamOf('```markdown\nmode: layout\nconfidence: high\nX\n```'));
    const r = await extractStyleFromImage({ imageDataUrl: 'data:image/png;base64,AAA' });
    expect(r.brief.startsWith('```')).toBe(false);
    expect(r.brief.endsWith('```')).toBe(false);
  });

  it('sends the image as a multimodal content part', async () => {
    createMock.mockResolvedValue(streamOf('mode: layout\nconfidence: high\nX'));
    await extractStyleFromImage({ imageDataUrl: 'data:image/png;base64,ZZZ' });
    const body = createMock.mock.calls[0][0];
    const userParts = body.messages.find((m) => m.role === 'user').content;
    expect(userParts.some((p) => p.type === 'image_url' && p.image_url.url.includes('ZZZ'))).toBe(true);
  });

  it('throws when no image is provided', async () => {
    await expect(extractStyleFromImage({})).rejects.toThrow(/no image/i);
  });

  it('throws when the model returns an empty brief', async () => {
    createMock.mockResolvedValue(streamOf(''));
    await expect(
      extractStyleFromImage({ imageDataUrl: 'data:image/png;base64,AAA' })
    ).rejects.toThrow(/empty/i);
  });
});
