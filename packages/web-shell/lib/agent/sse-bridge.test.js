import { describe, it, expect } from 'vitest';
import { createSseStream } from './sse-bridge.js';

describe('createSseStream', () => {
  it('produces a ReadableStream emitting SSE-formatted events', async () => {
    const { stream, send, close } = createSseStream();
    const reader = stream.getReader();
    const decoder = new TextDecoder();

    send('hello', { foo: 1 });
    close();

    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value);
    }
    expect(buf).toContain('event: hello');
    expect(buf).toContain('data: {"foo":1}');
  });
});
