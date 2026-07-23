import { describe, it, expect } from 'vitest';
import {
  withDeadline,
  assertProvider,
  providerFor,
  LlmTimeoutError,
  LlmProviderError,
} from './llm-deadline.js';

describe('llm-deadline', () => {
  describe('providerFor', () => {
    it('classifies each provider and unknowns', () => {
      expect(providerFor('claude-sonnet-4-6')).toBe('anthropic');
      expect(providerFor('opus-4-8')).toBe('anthropic');
      expect(providerFor('fable-5')).toBe('anthropic');
      expect(providerFor('gemini-2.5-flash')).toBe('gemini');
      expect(providerFor('gemini-3.1-pro-preview')).toBe('gemini');
      // Fully-qualified forms the @google/genai SDK also accepts (regression
      // guard: assertProvider must not reject a valid Gemini route).
      expect(providerFor('models/gemini-2.5-flash')).toBe('gemini');
      expect(providerFor('tunedModels/my-tuned-123')).toBe('gemini');
      expect(providerFor('gpt-5.5')).toBe('openai');
      expect(providerFor('o1-preview')).toBe('openai');
      expect(providerFor('llama-3')).toBe('unknown');
      expect(providerFor('')).toBe('unknown');
      expect(providerFor(undefined)).toBe('unknown');
    });
  });

  describe('assertProvider', () => {
    it('returns the provider when the seam supports it', () => {
      expect(assertProvider('gemini-2.5-flash', ['anthropic', 'gemini'])).toBe('gemini');
      expect(assertProvider('models/gemini-2.5-flash', ['anthropic', 'gemini'])).toBe('gemini');
      expect(assertProvider('claude-sonnet-4-6', ['anthropic', 'gemini'])).toBe('anthropic');
      expect(assertProvider('gpt-5.5', ['anthropic', 'openai', 'gemini'])).toBe('openai');
    });
    it('fast-fails a misrouted model (gpt-* into an Anthropic/Gemini seam)', () => {
      expect(() => assertProvider('gpt-5.5', ['anthropic', 'gemini'])).toThrow(LlmProviderError);
    });
    it('fast-fails an unknown model id', () => {
      expect(() => assertProvider('llama-3', ['anthropic', 'gemini'])).toThrow(LlmProviderError);
    });
  });

  describe('withDeadline', () => {
    it('resolves when the call finishes in time', async () => {
      const r = await withDeadline(() => Promise.resolve('ok'), { ms: 1000, label: 't' });
      expect(r).toBe('ok');
    });

    it('rejects with LlmTimeoutError when the call exceeds the deadline', async () => {
      const slow = () => new Promise((resolve) => setTimeout(() => resolve('late'), 300));
      await expect(withDeadline(slow, { ms: 20, label: 't' })).rejects.toBeInstanceOf(LlmTimeoutError);
    });

    it('aborts the provided signal on timeout', async () => {
      let aborted = false;
      const run = (signal) => new Promise((resolve) => {
        signal.addEventListener('abort', () => { aborted = true; });
        setTimeout(() => resolve('late'), 300);
      });
      await expect(withDeadline(run, { ms: 20, label: 't' })).rejects.toBeInstanceOf(LlmTimeoutError);
      expect(aborted).toBe(true);
    });

    it('propagates the underlying error unchanged', async () => {
      const boom = () => Promise.reject(new Error('boom'));
      await expect(withDeadline(boom, { ms: 1000, label: 't' })).rejects.toThrow('boom');
    });
  });
});
