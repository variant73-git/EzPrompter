import { describe, it, expect, vi, beforeEach } from 'vitest';

let mockCreate;

vi.mock('openai', () => {
  class MockOpenAI {
    constructor(config) {
      this.config = config;
      this.audio = {
        transcriptions: {
          create: async (...args) => mockCreate(...args),
        },
      };
    }
  }
  return { default: MockOpenAI };
});

vi.mock('openai/uploads', () => ({
  toFile: async (buffer, filename, opts) => ({ __mockFile: true, filename, type: opts?.type, byteLength: buffer.byteLength }),
}));

const { transcribeAudio, parseAudioDataUrl } = await import('./transcription.js');

const webmDataUrl = (bytes = 'fake-opus-bytes') =>
  `data:audio/webm;codecs=opus;base64,${Buffer.from(bytes).toString('base64')}`;

describe('parseAudioDataUrl', () => {
  it('parses mime + buffer and strips the codecs param', () => {
    const { mime, buffer, ext } = parseAudioDataUrl(webmDataUrl('abc'));
    expect(mime).toBe('audio/webm');
    expect(ext).toBe('webm');
    expect(buffer.toString()).toBe('abc');
  });

  it('maps Safari audio/mp4 to .mp4', () => {
    const url = `data:audio/mp4;base64,${Buffer.from('x').toString('base64')}`;
    expect(parseAudioDataUrl(url).ext).toBe('mp4');
  });

  it('rejects non-audio payloads', () => {
    const url = `data:image/png;base64,${Buffer.from('x').toString('base64')}`;
    expect(() => parseAudioDataUrl(url)).toThrow('expected a base64 audio data URL');
  });

  it('rejects empty audio', () => {
    expect(() => parseAudioDataUrl('data:audio/webm;base64,')).toThrow('empty audio payload');
  });
});

describe('transcribeAudio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.UNCRAFT_TRANSCRIBE_MODEL;
    mockCreate = vi.fn(async () => ({ text: '  hello canvas  ' }));
  });

  it('transcribes and trims via whisper-1 by default', async () => {
    const result = await transcribeAudio({ audioDataUrl: webmDataUrl(), apiKey: 'sk-test' });
    expect(result.text).toBe('hello canvas');
    expect(result.model).toBe('whisper-1');

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.model).toBe('whisper-1');
    expect(callArgs.file.filename).toBe('dictation.webm');
    expect(callArgs.file.type).toBe('audio/webm');
    expect(callArgs.language).toBeUndefined();
  });

  it('passes language through when provided', async () => {
    await transcribeAudio({ audioDataUrl: webmDataUrl(), apiKey: 'sk-test', language: 'pt' });
    expect(mockCreate.mock.calls[0][0].language).toBe('pt');
  });

  it('honors UNCRAFT_TRANSCRIBE_MODEL override', async () => {
    process.env.UNCRAFT_TRANSCRIBE_MODEL = 'gpt-4o-mini-transcribe';
    const result = await transcribeAudio({ audioDataUrl: webmDataUrl(), apiKey: 'sk-test' });
    expect(result.model).toBe('gpt-4o-mini-transcribe');
    expect(mockCreate.mock.calls[0][0].model).toBe('gpt-4o-mini-transcribe');
  });

  it('throws on missing apiKey', async () => {
    await expect(transcribeAudio({ audioDataUrl: webmDataUrl() })).rejects.toThrow('apiKey required');
  });
});
