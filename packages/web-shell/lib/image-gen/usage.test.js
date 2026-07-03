// lib/image-gen/usage.test.js — image adapters record into billing context (Task 11)
import { describe, it, expect, vi } from 'vitest';

vi.mock('openai', () => ({
  default: class {
    constructor() {
      this.images = {
        generate: async () => ({ data: [{ b64_json: 'aGVsbG8=' }] }),
        edit: async () => ({ data: [{ b64_json: 'aGVsbG8=' }] }),
      };
    }
  },
}));
vi.mock('openai/uploads', () => ({ toFile: async (buf, name, opts) => ({ buf, name, opts }) }));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    constructor() {
      this.models = {
        generateImages: async () => ({ generatedImages: [{ image: { imageBytes: 'aGVsbG8=', mimeType: 'image/png' } }] }),
      };
    }
  },
}));

const { generateOpenAIImage } = await import('./openai-image.js');
const { generateGeminiImage } = await import('./gemini-imagen.js');
const { runMeteredOperation } = await import('../billing/context.js');

const noDb = { holdCredits: vi.fn(), refundHold: vi.fn() };

describe('image adapter metering', () => {
  it('generateOpenAIImage records one high-quality image event (250,000 µ¢)', async () => {
    const settle = vi.fn(async () => ({ balanceAfter: 0 }));
    await runMeteredOperation({ sql: () => Promise.resolve([]), userId: 'u1', op: 'image.generate' }, async () => {
      await generateOpenAIImage({ prompt: 'a plane', apiKey: 'k' });
    }, { ...noDb, settleOperation: settle });
    const events = settle.mock.calls[0][0].events;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ provider: 'openai', images: 1, costMicrocents: 250000 });
  });
  it('generateGeminiImage records one Imagen event (40,000 µ¢)', async () => {
    const settle = vi.fn(async () => ({ balanceAfter: 0 }));
    await runMeteredOperation({ sql: () => Promise.resolve([]), userId: 'u1', op: 'image.generate' }, async () => {
      await generateGeminiImage({ prompt: 'a plane', apiKey: 'k' });
    }, { ...noDb, settleOperation: settle });
    const events = settle.mock.calls[0][0].events;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ provider: 'gemini', images: 1, costMicrocents: 40000 });
  });
});
