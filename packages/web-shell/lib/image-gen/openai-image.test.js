import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the OpenAI library
let mockGenerate;

vi.mock('openai', () => {
  class MockOpenAI {
    constructor(config) {
      this.config = config;
      this.images = {
        generate: async (...args) => mockGenerate(...args),
      };
    }
  }
  return { default: MockOpenAI };
});

const { generateOpenAIImage } = await import('./openai-image.js');

describe('generateOpenAIImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerate = vi.fn(async () => ({
      data: [{
        b64_json: Buffer.from('fake-png-bytes').toString('base64'),
      }],
    }));
  });

  it('returns base64 + mimeType + dataUrl from gpt-image-1', async () => {
    const result = await generateOpenAIImage({
      prompt: 'a dog',
      aspectRatio: '1:1',
      apiKey: 'sk-test-key',
    });

    expect(result.mimeType).toBe('image/png');
    expect(result.base64).toBe(Buffer.from('fake-png-bytes').toString('base64'));
    expect(result.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(result.prompt).toBe('a dog');
    expect(result.model).toBeDefined();
  });

  it('throws on missing prompt', async () => {
    await expect(
      generateOpenAIImage({ apiKey: 'sk-test-key' })
    ).rejects.toThrow('prompt required');
  });

  it('throws on missing apiKey', async () => {
    await expect(
      generateOpenAIImage({ prompt: 'a dog' })
    ).rejects.toThrow('apiKey required');
  });

  it('throws on missing image data from API', async () => {
    mockGenerate = vi.fn(async () => ({
      data: [{}],
    }));

    await expect(
      generateOpenAIImage({
        prompt: 'a dog',
        apiKey: 'sk-test-key',
      })
    ).rejects.toThrow('gpt-image-1 returned no image');
  });

  it('maps aspectRatio 1:1 to 1024x1024', async () => {
    await generateOpenAIImage({
      prompt: 'a dog',
      aspectRatio: '1:1',
      apiKey: 'sk-test-key',
    });

    expect(mockGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ size: '1024x1024' })
    );
  });

  it('maps aspectRatio 16:9 to 1792x1024', async () => {
    await generateOpenAIImage({
      prompt: 'a dog',
      aspectRatio: '16:9',
      apiKey: 'sk-test-key',
    });

    expect(mockGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ size: '1792x1024' })
    );
  });

  it('maps aspectRatio 9:16 to 1024x1792', async () => {
    await generateOpenAIImage({
      prompt: 'a dog',
      aspectRatio: '9:16',
      apiKey: 'sk-test-key',
    });

    expect(mockGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ size: '1024x1792' })
    );
  });

  it('uses default aspect ratio 1:1 when not provided', async () => {
    await generateOpenAIImage({
      prompt: 'a dog',
      apiKey: 'sk-test-key',
    });

    expect(mockGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ size: '1024x1024' })
    );
  });

  it('uses custom model when provided', async () => {
    await generateOpenAIImage({
      prompt: 'a dog',
      apiKey: 'sk-test-key',
      model: 'gpt-image-2',
    });

    expect(mockGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-image-2' })
    );
  });
});
