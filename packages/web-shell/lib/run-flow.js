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

const DEFAULT_MODEL = process.env.UNCRAFT_LLM_MODEL || 'claude-sonnet-4-6';

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

async function callLLM({ model, system, user, maxTokens = 32000, temperature = 0.4 }) {
  if (isAnthropic(model)) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY missing');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    // Anthropic SDK enforces streaming for operations that may exceed
    // the 10-minute soft cap. With max_tokens at 32k this is exactly
    // that bucket; .stream() + finalMessage() collects the full text
    // without us having to write a token-by-token reducer.
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
  return parts.join('\n\n');
}

export async function runCompose({ target, sources, model = DEFAULT_MODEL }) {
  const buckets = bucketSources(sources);

  // Today's slice: only HTML-bearing targets supported.
  const targetIsHtml = ['site', 'html', 'template', 'chunk'].includes(target.kind);
  if (!targetIsHtml) {
    throw new Error(`Target kind "${target.kind}" is not yet supported by run-flow. Use a site/html target.`);
  }
  if (!target.current_html) {
    throw new Error('Target node has no snapshot yet. Capture or upload content before running.');
  }

  // Asset / screenshot sources need vision routing — deferred to Slice 2
  // when OpenAI / GPT 5.5 wiring lands.
  if (buckets.asset.length > 0) {
    throw new Error('Image/screenshot sources require vision routing (coming next). For now connect site or design.md sources.');
  }

  // Skill sources aren't wired yet either — treat as no-op for this slice.
  if (
    buckets.html.length === 0 &&
    buckets.md.length === 0 &&
    buckets.prompt.length === 0
  ) {
    throw new Error('No actionable inputs. Connect a site, design.md, or prompt source.');
  }

  const userPrompt = assemblePrompt({ targetHtml: target.current_html, buckets });
  const { text } = await callLLM({
    model,
    system: COMPOSE_SYSTEM,
    user: userPrompt,
    maxTokens: 32000,
    temperature: 0.4
  });
  const html = stripCodeFences(text);
  if (!html || !/<html/i.test(html)) {
    throw new Error('Model returned no usable HTML.');
  }
  return { html };
}
