// provider-routing.test.js — the extract seams must DISPATCH to the same SDK
// that assertProvider/providerFor claims will serve the model. The bug (audit
// 2026-07-23, Claude lens A/C + Sol): providerFor maps fable|mythos→anthropic
// and chatgpt→openai, but the seams routed on a narrower local isAnthropic/
// isOpenAI, so those models passed the guard then fell through to the Gemini
// SDK → 404 in the wrong SDK. These tests witness WHICH client is invoked.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const anthropicStream = vi.fn();
const geminiGenerate = vi.fn();
const openaiCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { stream: anthropicStream }; } }));
vi.mock('@google/genai', () => ({ GoogleGenAI: class { models = { generateContent: geminiGenerate }; } }));
vi.mock('openai', () => ({ default: class { chat = { completions: { create: openaiCreate } }; } }));

import { describeSiteAsPrompt, describeImageAsTokens } from './extract-llm.js';
import { generateDesignMd } from './design-md.js';
import { extractContent } from './demarcelize.js';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const anthropicReturns = (text) => anthropicStream.mockReturnValue({ finalMessage: async () => ({ content: [{ text }], usage: {} }) });
const geminiReturns = (text) => geminiGenerate.mockResolvedValue({ text, usageMetadata: {} });
const openaiYields = (text) => openaiCreate.mockImplementation(async () => (async function* () {
  yield { choices: [{ delta: { content: text } }] };
  yield { choices: [], usage: {} };
})());

beforeEach(() => {
  vi.clearAllMocks();
  // Defaults valid for the loose (text-passthrough) seams; strict seams override.
  anthropicReturns('ok');
  geminiReturns('ok');
  openaiYields('ok');
  process.env.ANTHROPIC_API_KEY = 'test';
  process.env.GEMINI_API_KEY = 'test';
  process.env.OPENAI_API_KEY = 'test';
});

describe('extract seams dispatch to the provider the guard resolves', () => {
  it('extract-llm callText: a fable-* model goes to Anthropic, not Gemini', async () => {
    await describeSiteAsPrompt({ html: '<h1>x</h1>', model: 'fable-5' });
    expect(anthropicStream).toHaveBeenCalled();
    expect(geminiGenerate).not.toHaveBeenCalled();
  });

  it('extract-llm callVision: a chatgpt-* model goes to OpenAI, not Gemini', async () => {
    await describeImageAsTokens({ dataUrl: PNG, model: 'chatgpt-4o-latest' });
    expect(openaiCreate).toHaveBeenCalled();
    expect(geminiGenerate).not.toHaveBeenCalled();
  });

  it('design-md callLLM: a fable-* model goes to Anthropic, not Gemini', async () => {
    anthropicReturns('# Design\nok');
    geminiReturns('# Design\nok'); // valid on the (buggy) mis-routed path too → fail on the assertion, not a parse throw
    await generateDesignMd({ html: '<h1>x</h1>', model: 'fable-5' });
    expect(anthropicStream).toHaveBeenCalled();
    expect(geminiGenerate).not.toHaveBeenCalled();
  });

  it('demarcelize callLLM: a fable-* model goes to Anthropic, not Gemini', async () => {
    anthropicReturns('{"ok":true}');
    geminiReturns('{"ok":true}');
    await extractContent({ html: '<h1>x</h1>', model: 'fable-5' });
    expect(anthropicStream).toHaveBeenCalled();
    expect(geminiGenerate).not.toHaveBeenCalled();
  });

  // Regression guard: a real Gemini model must still route to Gemini.
  it('a gemini-* model still routes to Gemini', async () => {
    geminiReturns('# Design\nok');
    await generateDesignMd({ html: '<h1>x</h1>', model: 'gemini-2.5-flash' });
    expect(geminiGenerate).toHaveBeenCalled();
    expect(anthropicStream).not.toHaveBeenCalled();
  });
});
