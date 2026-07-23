// canvas-api.extract.test.js — the extract client must surface the server's
// clean error TEXT, not only the generic code. The extract route returns
// { error:'extract_failed', message:'LLM call timed out ...' }; jsonOrThrow
// used to read only detail||error, discarding `message` (audit 2026-07-23, Sol).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { api } from './canvas-api.js';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('api.extractNode error surfacing', () => {
  it('surfaces the server message on a failure, not just the generic code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => ({ error: 'extract_failed', message: 'LLM call timed out after 150000ms (design-md:gemini)' }),
    })));
    await expect(api.extractNode('n1', { to: 'designmd' })).rejects.toThrow(/timed out after 150000ms/);
  });
});
