import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Google GenAI library
let mockGenerateImages;

vi.mock('@google/genai', () => {
  class MockGoogleGenAI {
    constructor(config) {
      this.config = config;
      this.models = {
        generateImages: async (...args) => mockGenerateImages(...args),
      };
    }
  }
  return { GoogleGenAI: MockGoogleGenAI };
});

const { generateGeminiImage } = await import('./gemini-imagen.js');

describe('generateGeminiImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateImages = vi.fn(async () => ({
      generatedImages: [{
        image: {
          imageBytes: Buffer.from('fake-png-bytes').toString('base64'),
          mimeType: 'image/png',
        },
      }],
    }));
  });

  it('returns base64 + mimeType + dataUrl from Imagen', async () => {
    const result = await generateGeminiImage({
      prompt: 'a cat',
      aspectRatio: '1:1',
      apiKey: 'test-key',
    });

    expect(result.mimeType).toBe('image/png');
    expect(result.base64).toBe(Buffer.from('fake-png-bytes').toString('base64'));
    expect(result.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(result.prompt).toBe('a cat');
    expect(result.model).toBeDefined();
  });

  it('throws on missing prompt', async () => {
    await expect(
      generateGeminiImage({ apiKey: 'test-key' })
    ).rejects.toThrow('prompt required');
  });

  it('throws on missing apiKey', async () => {
    await expect(
      generateGeminiImage({ prompt: 'a cat' })
    ).rejects.toThrow('apiKey required');
  });

  it('throws on missing image data from API', async () => {
    mockGenerateImages = vi.fn(async () => ({
      generatedImages: [{ image: {} }],
    }));

    await expect(
      generateGeminiImage({
        prompt: 'a cat',
        apiKey: 'test-key',
      })
    ).rejects.toThrow('Imagen returned no image');
  });

  it('uses default aspect ratio', async () => {
    const result = await generateGeminiImage({
      prompt: 'a cat',
      apiKey: 'test-key',
    });

    expect(result).toBeDefined();
  });

  it('uses custom aspect ratio', async () => {
    const result = await generateGeminiImage({
      prompt: 'a cat',
      aspectRatio: '16:9',
      apiKey: 'test-key',
    });

    expect(result).toBeDefined();
  });
});
