/**
 * run-flow.js — Smart compose engine for canvas graph execution.
 *
 * Per the model agreed with the user:
 *   - Target type = output type. HTML target → HTML output.
 *   - Engine collapses to ONE smart compose call that reads whatever
 *     inputs the incoming edges provide (html / md / prompt / asset).
 *   - For HTML targets, all combinations of (html, md, prompt) route
 *     through a single LLM call with a preset system prompt that
 *     adapts behaviour to the source mix.
 *   - Asset/screenshot inputs are deferred (need GPT 5.5 vision wiring).
 *
 * The legacy 3 edge kinds (transplant / token-swap / reskin) remain
 * supported by the per-edge `/api/edges/[id]/apply` route — run-flow
 * supersedes them with a unified composer that ignores `edge.kind`
 * entirely and decides by source kind.
 */

import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';

const DEFAULT_MODEL = process.env.UNCRAFT_LLM_MODEL || 'claude-sonnet-4-6';

// Map picker-friendly model IDs (set in PromptDock's MODEL_OPTIONS) to
// the actual provider model strings. The picker uses short product
// names; the SDKs expect longer ones.
const MODEL_ALIAS = {
  'gpt-5.5':         'gpt-5.5',
  'claude-4.6-opus': 'claude-opus-4-6',
  'gemini-3.1-pro':  'gemini-3.1-pro-preview',
  'kimi-k2.6':       'kimi-k2.6'
};
function resolveModel(modelId) {
  if (!modelId) return DEFAULT_MODEL;
  return MODEL_ALIAS[modelId] || modelId;
}

const COMPOSE_SYSTEM = `You receive a TARGET HTML document and one or more SOURCE INPUTS. Your job is to apply the sources to the target and emit the resulting HTML.

INPUTS YOU MAY RECEIVE
- HTML SOURCE — a reference HTML document. Use it as design chassis (layout / typography / colour tokens) when no design.md is provided, otherwise as additional design reference.
- DESIGN.MD SOURCE — a markdown design-system spec describing colours, fonts, spacing, components. Treat as the authoritative source of design tokens; override the HTML source's defaults when the two disagree.
- PROMPT INSTRUCTION — explicit user direction. ALWAYS follow the prompt over the defaults below.

OPERATION MATRIX (compose, do not pick one)
- HTML only → reskin: preserve the target's exact text content, replace the target's structural chassis with the source HTML's chassis.
- DESIGN.MD only → restyle: keep the target's HTML structure verbatim; apply the md tokens (colours, type scale, font families, spacing) by injecting / overriding the target's style block.
- HTML + DESIGN.MD → reskin with the HTML chassis + md tokens as overrides.
- PROMPT only → execute the instruction directly on the target.
- PROMPT + any other source → follow the prompt as the primary directive; use the other sources as material.

PRESERVE EVERY TIME (do not break, do not paraphrase)
- The target's exact text content (real words, numbers, prices, names, proper nouns). No AI clichés ("Elevate", "Empower", "Seamless", "Next-Gen", "Transform").
- The target's image src attributes unless the prompt explicitly requests change.
- Real numbers exactly as the target shows them. No fake "99%", "10x".
- Zero emojis in any output.

TYPOGRAPHY / COLOUR RULES
- Use the source's / md's exact fonts and hex colours. Never silently substitute "Inter" or generic AI-purple gradients.
- One accent colour max. Saturation below 80%. Avoid pure #000000 (render as #0a0a0a).
- Hierarchy through weight and colour, not just oversized H1s. Mono fonts only where the source explicitly uses them.

LAYOUT
- Preserve section count + order from the chosen chassis.
- Constrain outer containers with max-w-7xl mx-auto or similar.
- Hero sections use min-h-[100dvh], not h-screen.

OUTPUT
- A single complete HTML document. No markdown code fences, no preface, no commentary. Just the HTML.`;

function isAnthropic(model) {
  return /^(claude|opus|sonnet|haiku)/i.test(model);
}
function isOpenAI(model) {
  return /^(gpt|openai|o[1-9])/i.test(model);
}

async function callLLM({ model, system, user, images = [], maxTokens = 32000, temperature = 0.4 }) {
  const hasImages = images && images.length > 0;
  if (isAnthropic(model)) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY missing');
    if (hasImages) throw new Error('Image sources require GPT 5.5 (or another OpenAI vision model). Switch the model picker and try again.');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const stream = client.messages.stream({
      model,
      max_tokens: maxTokens,
      temperature,
      system,
      messages: [{ role: 'user', content: user }]
    });
    const final = await stream.finalMessage();
    const text = final.content?.map((b) => b.text || '').join('') || '';
    return { text };
  }
  if (isOpenAI(model)) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing');
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    // Multimodal Chat Completions content. Text first, then images as
    // image_url parts pointing at the data URL the user uploaded. GPT
    // 5+ accepts data URLs directly — no need to upload to a CDN.
    const userContent = hasImages
      ? [
          { type: 'text', text: user },
          ...images.map((url) => ({ type: 'image_url', image_url: { url } }))
        ]
      : user;
    // GPT-5 family and the reasoning (o-series) models reject custom
    // temperature — they only accept the default (1.0). Older GPT-4
    // variants accept it. Easiest portable approach: omit the param
    // entirely for OpenAI and let the API use its default.
    const stream = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userContent }
      ],
      max_completion_tokens: maxTokens,
      stream: true
    });
    let text = '';
    for await (const chunk of stream) {
      const delta = chunk?.choices?.[0]?.delta?.content;
      if (typeof delta === 'string') text += delta;
    }
    return { text };
  }
  // Gemini (default fallback)
  if (hasImages) throw new Error('Image sources require GPT 5.5 (or another OpenAI vision model). Switch the model picker and try again.');
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY missing');
  const ai = new GoogleGenAI({ apiKey });
  const resp = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: user }] }],
    config: { systemInstruction: system, maxOutputTokens: maxTokens, temperature }
  });
  const text =
    resp.text ||
    resp.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') ||
    '';
  return { text };
}

function stripCodeFences(s) {
  return s.replace(/^```[a-z]*\n/, '').replace(/```\s*$/, '').trim();
}

function bucketSources(sources) {
  const buckets = { html: [], md: [], prompt: [], asset: [], skill: [] };
  for (const s of sources) {
    const k = s.kind;
    if (k === 'site' || k === 'html' || k === 'template' || k === 'chunk') buckets.html.push(s);
    else if (k === 'designmd') buckets.md.push(s);
    else if (k === 'prompt') buckets.prompt.push(s);
    else if (k === 'screenshot' || k === 'asset') buckets.asset.push(s);
    else if (k === 'skill') buckets.skill.push(s);
  }
  return buckets;
}

function assemblePrompt({ targetHtml, buckets }) {
  const parts = [`TARGET HTML:\n${targetHtml}`];
  buckets.html.forEach((s, i) => {
    if (s.source_html) parts.push(`HTML SOURCE${buckets.html.length > 1 ? ` ${i + 1}` : ''}:\n${s.source_html}`);
  });
  buckets.md.forEach((s, i) => {
    if (s.source_design_md) parts.push(`DESIGN.MD SOURCE${buckets.md.length > 1 ? ` ${i + 1}` : ''}:\n${s.source_design_md}`);
  });
  buckets.prompt.forEach((s) => {
    const text = s.meta?.prompt || s.meta?.text || '';
    if (text) parts.push(`PROMPT INSTRUCTION:\n${text}`);
  });
  // Reference the images by index so the system prompt can talk about
  // them; the actual image content rides in a separate `images` array.
  buckets.asset.forEach((s, i) => {
    const label = buckets.asset.length > 1 ? `IMAGE SOURCE ${i + 1}` : 'IMAGE SOURCE';
    parts.push(`${label}: see attached image #${i + 1} (treat as design / layout reference unless the prompt says otherwise).`);
  });
  // Extract image data URLs for the vision pipeline.
  const images = buckets.asset
    .map((s) => s.meta?.dataUrl)
    .filter(Boolean);
  return { text: parts.join('\n\n'), images };
}

export async function runCompose({ target, sources, model, modelId }) {
  // Caller can pass either the resolved provider model string (`model`)
  // or the picker's short id (`modelId`). resolveModel() maps the
  // short id to the SDK-friendly value via MODEL_ALIAS.
  const resolvedModel = model || resolveModel(modelId);
  const buckets = bucketSources(sources);

  // Today's slice: only HTML-bearing targets supported.
  const targetIsHtml = ['site', 'html', 'template', 'chunk'].includes(target.kind);
  if (!targetIsHtml) {
    throw new Error(`Target kind "${target.kind}" is not yet supported by run-flow. Use a site/html target.`);
  }
  if (!target.current_html) {
    throw new Error('Target node has no snapshot yet. Capture or upload content before running.');
  }

  // Need at least one actionable source — skills alone don't move.
  if (
    buckets.html.length === 0 &&
    buckets.md.length === 0 &&
    buckets.prompt.length === 0 &&
    buckets.asset.length === 0
  ) {
    throw new Error('No actionable inputs. Connect a site, design.md, screenshot, or prompt source.');
  }

  // Routing rule: if any image source is present, force a vision-capable
  // model regardless of what the picker said. Falls back to gpt-5.5 if
  // the user picked a text-only model with images attached.
  let effectiveModel = resolvedModel;
  if (buckets.asset.length > 0 && !/^(gpt|openai|o[1-9])/i.test(effectiveModel)) {
    effectiveModel = 'gpt-5.5';
  }

  const { text: userPrompt, images } = assemblePrompt({ targetHtml: target.current_html, buckets });
  const { text } = await callLLM({
    model: effectiveModel,
    system: COMPOSE_SYSTEM,
    user: userPrompt,
    images,
    maxTokens: 32000,
    temperature: 0.4
  });
  const html = stripCodeFences(text);
  if (!html || !/<html/i.test(html)) {
    throw new Error('Model returned no usable HTML.');
  }
  return { html };
}
