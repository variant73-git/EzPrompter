import { describe, it, expect } from 'vitest';
import { Registry } from './registry.js';

describe('Registry', () => {
  it('registers a tool and returns it by name', () => {
    const r = new Registry();
    const tool = {
      name: 'foo',
      description: 'demo',
      classification: 'safe',
      inputSchema: { type: 'object', properties: {} },
      async execute() { return { ok: true }; },
    };
    r.register(tool);
    expect(r.get('foo')).toBe(tool);
  });

  it('throws on duplicate name', () => {
    const r = new Registry();
    r.register({ name: 'x', classification: 'safe', execute: async () => ({}) });
    expect(() => r.register({ name: 'x', classification: 'safe', execute: async () => ({}) })).toThrow();
  });

  it('throws on invalid classification', () => {
    const r = new Registry();
    expect(() => r.register({ name: 'y', classification: 'wat', execute: async () => ({}) })).toThrow();
  });

  it('toAnthropicSpec() emits the Anthropic tools[] array shape', () => {
    const r = new Registry();
    r.register({
      name: 'foo',
      description: 'demo',
      classification: 'safe',
      inputSchema: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] },
      execute: async () => ({}),
    });
    const spec = r.toAnthropicSpec();
    expect(spec).toEqual([{
      name: 'foo',
      description: 'demo',
      input_schema: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] },
    }]);
  });

  it('toAnthropicSpec() respects allowlist', () => {
    const r = new Registry();
    r.register({ name: 'foo', description: 'd', classification: 'safe', inputSchema: { type: 'object' }, execute: async () => ({}) });
    r.register({ name: 'bar', description: 'd', classification: 'safe', inputSchema: { type: 'object' }, execute: async () => ({}) });
    const spec = r.toAnthropicSpec(['foo']);
    expect(spec).toHaveLength(1);
    expect(spec[0].name).toBe('foo');
  });

  it('toOpenAISpec() emits the OpenAI chat.completions tools[] shape', () => {
    const r = new Registry();
    r.register({
      name: 'foo',
      description: 'demo',
      classification: 'safe',
      inputSchema: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] },
      execute: async () => ({}),
    });
    const spec = r.toOpenAISpec();
    expect(spec).toEqual([{
      type: 'function',
      function: {
        name: 'foo',
        description: 'demo',
        parameters: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] },
      },
    }]);
  });

  it('toOpenAISpec() respects allowlist', () => {
    const r = new Registry();
    r.register({ name: 'foo', description: 'd', classification: 'safe', inputSchema: { type: 'object' }, execute: async () => ({}) });
    r.register({ name: 'bar', description: 'd', classification: 'safe', inputSchema: { type: 'object' }, execute: async () => ({}) });
    const spec = r.toOpenAISpec(['bar']);
    expect(spec).toHaveLength(1);
    expect(spec[0].function.name).toBe('bar');
  });

  it('toGeminiSpec() emits the Gemini functionDeclarations[] shape', () => {
    const r = new Registry();
    r.register({
      name: 'foo',
      description: 'demo',
      classification: 'safe',
      inputSchema: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] },
      execute: async () => ({}),
    });
    const spec = r.toGeminiSpec();
    // Gemini wants a single tool object with functionDeclarations[]
    expect(spec).toEqual([{
      functionDeclarations: [{
        name: 'foo',
        description: 'demo',
        parameters: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] },
      }],
    }]);
  });

  it('toGeminiSpec() respects allowlist + returns empty array when no tools match', () => {
    const r = new Registry();
    r.register({ name: 'foo', description: 'd', classification: 'safe', inputSchema: { type: 'object' }, execute: async () => ({}) });
    expect(r.toGeminiSpec(['nonexistent'])).toEqual([{ functionDeclarations: [] }]);
  });
});
