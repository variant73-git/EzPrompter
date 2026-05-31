import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createChatStream } from './chat-client.js';

let lastEs;
beforeEach(() => {
  lastEs = null;
  globalThis.EventSource = class {
    constructor(url) { this.url = url; this.listeners = {}; lastEs = this; }
    addEventListener(type, cb) { (this.listeners[type] ||= []).push(cb); }
    removeEventListener(type, cb) { this.listeners[type] = (this.listeners[type] || []).filter((x) => x !== cb); }
    dispatch(type, data) { (this.listeners[type] || []).forEach((cb) => cb({ data: typeof data === 'string' ? data : JSON.stringify(data) })); }
    close() { this.readyState = 2; }
  };
});

describe('createChatStream', () => {
  it('subscribes to typed events and parses JSON payloads', () => {
    const stream = createChatStream({ url: '/api/chat?runId=abc' });
    const onToken = vi.fn();
    stream.on('assistant_token', onToken);
    lastEs.dispatch('assistant_token', { delta: 'hello' });
    expect(onToken).toHaveBeenCalledWith({ delta: 'hello' });
  });

  it('handles malformed JSON gracefully', () => {
    const stream = createChatStream({ url: '/api/chat?runId=abc' });
    const onErr = vi.fn();
    stream.on('error', onErr);
    lastEs.dispatch('assistant_token', 'not json');
    expect(onErr).toHaveBeenCalled();
  });

  it('close() shuts down the EventSource', () => {
    const stream = createChatStream({ url: '/api/chat?runId=abc' });
    stream.close();
    expect(lastEs.readyState).toBe(2);
  });
});
