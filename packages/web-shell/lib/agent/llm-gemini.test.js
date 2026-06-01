import { describe, it, expect, vi } from 'vitest';

const capturedStreamArgs = [];

vi.mock('@google/genai', () => {
  // Mock generateContentStream — Gemini SDK uses an async generator.
  async function* mockGen() {
    yield { candidates: [{ content: { parts: [{ text: 'hi' }] } }] };
    yield {
      candidates: [{
        content: {
          parts: [{ functionCall: { name: 'queryNodes', args: {} } }],
        },
        finishReason: 'STOP', // Gemini emits STOP even when there are function calls
      }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
    };
  }
  class GoogleGenAI {
    constructor() {
      this.models = {
        generateContentStream: vi.fn(async (args) => {
          capturedStreamArgs.push(args);
          return mockGen();
        }),
      };
    }
  }
  return { GoogleGenAI };
});

const { callGemini } = await import('./llm-gemini.js');

describe('callGemini', () => {
  it('streams text deltas, captures function calls, emits message_complete with usage', async () => {
    const events = [];
    const final = await callGemini({
      model: 'gemini-3.1-pro-preview',
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ functionDeclarations: [{ name: 'queryNodes', description: 'd', parameters: { type: 'object' } }] }],
      apiKey: 'fake',
      onEvent: (ev) => events.push(ev),
    });

    expect(events.some((e) => e.type === 'text_delta' && e.text === 'hi')).toBe(true);
    expect(events.some((e) => e.type === 'tool_use' && e.name === 'queryNodes')).toBe(true);
    expect(final.stop_reason).toBe('tool_use'); // because function calls present, even though Gemini said STOP
    expect(final.usage.input_tokens).toBe(10);
    expect(final.usage.output_tokens).toBe(5);
  });

  it('translates {type:image, dataUrl} into Gemini inlineData parts', async () => {
    capturedStreamArgs.length = 0;
    await callGemini({
      model: 'gemini-2.5-flash',
      system: 'sys',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'what is this?' },
            { type: 'image', dataUrl: 'data:image/jpeg;base64,XYZ' },
          ],
        },
      ],
      tools: [],
      apiKey: 'fake',
      onEvent: () => {},
    });
    expect(capturedStreamArgs.length).toBe(1);
    const parts = capturedStreamArgs[0].contents[0].parts;
    expect(parts[0]).toEqual({ text: 'what is this?' });
    expect(parts[1]).toEqual({ inlineData: { mimeType: 'image/jpeg', data: 'XYZ' } });
  });
});
