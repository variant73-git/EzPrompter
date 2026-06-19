/**
 * design-md.js — server-side DESIGN.md generation from a site's HTML.
 *
 * generateDesignMd({html}) → markdown design-system spec.
 *
 * This is the server-side counterpart of the extension's
 * `generateDesignMD()` (overlay/extractor.js, DOM-based, Aura-parity).
 * Server-side we hold HTML strings, not a live DOM, so instead of
 * computed-style probing we run one LLM pass that distils the document
 * into the same section structure. The output feeds:
 *   - snapshots.design_md on designmd nodes (extractDesign tool)
 *   - run-flow's md bucket → COMPOSE_SYSTEM "DESIGN.MD SOURCE"
 *
 * Model routing mirrors demarcelize.js: claude/opus/sonnet/haiku →
 * Anthropic, everything else → Gemini. Override via UNCRAFT_LLM_MODEL
 * env or per-call `model` option.
 */

import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';

const DEFAULT_MODEL = process.env.UNCRAFT_LLM_MODEL || 'claude-sonnet-4-6';

// Soft input cap — captured enterprise pages can carry megabytes of
// inlined CSS/SVG. The design system is fully expressed long before
// this limit; truncating beats blowing the context window.
const MAX_HTML_CHARS = 300_000;

export const DESIGN_MD_SYSTEM = `You receive the full HTML (with inline/embedded CSS) of a website. Produce a DESIGN.md — a markdown design-system specification that lets another model rebuild a DIFFERENT page in this exact visual language.

EXTRACT, NEVER INVENT
- Every hex value, font family, weight, size, radius, and shadow must come from the document. If a token is not present, omit it — do not guess defaults.
- Use exact hex colours as written (or convert rgb() to hex). Never round or "normalize" to prettier values.
- Use exact font-family names as declared. Never substitute lookalikes.

STRUCTURE (use exactly these sections, omit a section only when the page truly has nothing for it)

# Design System

## Overview
One short paragraph: the tone of the site (e.g. "dark, editorial, generous whitespace, restrained motion") and the overall layout strategy.

## Color Palette
Bullet list with semantic roles. Format: \`- surface-base: #0a0a0a — page background\`. Cover: surface(s), primary/secondary text, accent(s), borders, states if present. Note gradient stops verbatim.

## Typography
- Families: display vs body vs mono (only if the page uses mono), with fallback stacks as declared.
- Scale: the actual sizes/weights/line-heights/letter-spacing used per level (h1, h2, body, small/captions, buttons).

## Layout & Grid
Container max-widths, section vertical paddings, grid patterns (columns, gaps), sticky elements, use of asymmetry.

## Components
For each distinct component family present (buttons, cards, nav, inputs, badges, footer): shape (radius), padding, background, border, shadow, hover state. Concrete values.

## Graphic Elements & Shapes
Distinctive decorative choices: pills, oversized radii, rotated blocks, blurs, noise/dither, gradient meshes, decorative SVG/canvas. Omit if plain.

## Animations & Interactions
Transitions, keyframes, hover behaviour, scroll effects — name what is animated and how (properties, durations, easings).

## Responsive Behavior
What the @media queries actually change, grouped by breakpoint. Omit if none are present.

## Implementation Cues
5-10 imperative MUST-preserve directives capturing what makes this design itself (e.g. "MUST keep the 1px hairline borders at 8% white", "MUST use Instrument Serif italic for display headlines").

OUTPUT
Markdown only. No code fences around the document, no preface, no commentary. Be terse and token-dense — this is a spec, not prose.`;

function isAnthropic(model) {
  return /^(claude|opus|sonnet|haiku)/i.test(model);
}

async function callLLM({ model, system, user, maxTokens = 8000, temperature = 0.2 }) {
  if (isAnthropic(model)) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY missing');
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

/**
 * @returns {{ md: string, truncated: boolean, inputChars: number }}
 *   `truncated` is true when the source HTML exceeded MAX_HTML_CHARS and
 *   the spec was distilled from the first MAX_HTML_CHARS only. Callers
 *   MUST surface this to the user (tool result / node meta) — silent
 *   truncation is a ghost-bug factory.
 */
export async function generateDesignMd({ html, model = DEFAULT_MODEL }) {
  if (typeof html !== 'string' || html.trim().length === 0) {
    throw new Error('generateDesignMd: html required');
  }
  const truncated = html.length > MAX_HTML_CHARS;
  const clipped = truncated
    ? `${html.slice(0, MAX_HTML_CHARS)}\n<!-- [document truncated at ${MAX_HTML_CHARS} chars — extract from what is present] -->`
    : html;
  const { text } = await callLLM({
    model,
    system: DESIGN_MD_SYSTEM,
    user: `SITE HTML:\n\n${clipped}`
  });
  const md = stripCodeFences(text);
  if (!md || !/^#\s/m.test(md)) {
    throw new Error('generateDesignMd: model returned no usable markdown');
  }
  return { md, truncated, inputChars: html.length };
}
