/**
 * extract-llm.js — isolated text + vision LLM seam for extract.js.
 *
 * Keeps the dispatcher unit-testable (vi.mock('./extract-llm.js')).
 * Client construction mirrors design-md.js exactly: Anthropic default import,
 * GoogleGenAI named import, same method signatures.
 */

import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';

const DEFAULT_MODEL = 'gemini-2.5-flash';
const MAX_HTML = 60000;

function isAnthropic(m) {
  return /^(claude|opus|sonnet|haiku)/i.test(m);
}

async function callText({ model = DEFAULT_MODEL, system, user, maxTokens = 1200 }) {
  if (isAnthropic(model)) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY missing');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const final = await client.messages.stream({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }).finalMessage();
    return (final.content?.map((b) => b.text || '').join('') || '').trim();
  }
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY missing');
  const ai = new GoogleGenAI({ apiKey });
  const resp = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: user }] }],
    config: { systemInstruction: system, maxOutputTokens: maxTokens },
  });
  return (
    resp.text ||
    resp.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') ||
    ''
  ).trim();
}

// Vision: dataUrl (base64) → text. Anthropic image block / Gemini inlineData.
async function callVision({ model = DEFAULT_MODEL, system, user, dataUrl, maxTokens = 1200 }) {
  const [, mediaType, b64] = /^data:([^;]+);base64,(.+)$/.exec(dataUrl) || [];
  if (!b64) throw new Error('callVision: dataUrl must be base64');

  if (isAnthropic(model)) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY missing');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const final = await client.messages.stream({
      model,
      max_tokens: maxTokens,
      system,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
            { type: 'text', text: user },
          ],
        },
      ],
    }).finalMessage();
    return (final.content?.map((b) => b.text || '').join('') || '').trim();
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY missing');
  const ai = new GoogleGenAI({ apiKey });
  const resp = await ai.models.generateContent({
    model,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: mediaType, data: b64 } },
          { text: user },
        ],
      },
    ],
    config: { systemInstruction: system, maxOutputTokens: maxTokens },
  });
  return (
    resp.text ||
    resp.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') ||
    ''
  ).trim();
}

export async function describeSiteAsPrompt({ html, model }) {
  const system =
    'You write concise, reusable image/site GENERATION PROMPTS. Given a website HTML, output ONE paragraph (<= 80 words) capturing its art direction — layout feel, color palette, typography character, mood. No preamble, no markdown, just the prompt text.';
  return callText({
    model,
    system,
    user: `HTML:\n${String(html).slice(0, MAX_HTML)}`,
  });
}

export async function describeImageAsTokens({ dataUrl, model }) {
  const system =
    'You are a design-tokens extractor. Given an image, output a short DESIGN.md (markdown) listing the palette (hex), type character, spacing/shape feel. Be concrete and brief. Markdown only.';
  return callVision({
    model,
    system,
    user: 'Extract the design tokens from this image.',
    dataUrl,
  });
}

export async function describeImageAsPrompt({ dataUrl, model }) {
  const system =
    'You reverse-engineer a concise image GENERATION PROMPT from an image. Output ONE paragraph (<= 60 words): subject, composition, lighting, palette, style. No preamble, just the prompt.';
  return callVision({
    model,
    system,
    user: 'Describe this image as a generation prompt.',
    dataUrl,
  });
}
