/**
 * style-extract.js — Layer B: turn an image/screenshot into a clean STYLE BRIEF.
 *
 * The point: run a dedicated vision call that isolates the REAL design in the
 * image (discarding presentation backdrops, device frames, the room behind a
 * laptop, gutters between mockups) and emits design tokens by ROLE. Compose then
 * receives only this text brief — so a backdrop colour (e.g. a Dribbble shot's
 * green gradient) physically cannot leak into the generated site.
 *
 * Two modes:
 *   layout      — the image contains a real UI screen; extract its tokens.
 *   inspiration — the image is not a layout (photo, illustration, object, game
 *                 art); abstract its style and propose UI tokens (invented).
 *
 * Spec: docs/superpowers/specs/2026-06-25-layer-B-style-extraction-from-images.md
 * Provider routing mirrors run-flow/demarcelize (claude/opus → Anthropic,
 * gpt/openai → OpenAI, else Gemini). Default to a vision model.
 */

import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';

const DEFAULT_VISION_MODEL = process.env.UNCRAFT_VISION_MODEL || 'gpt-5.5';

const EXTRACT_SYSTEM = `You analyze ONE image and output a structured STYLE BRIEF describing only its real design, as markdown the restyler of a website can apply. The brief carries DESIGN TOKENS, not a description of the picture.

STEP 1 — CLASSIFY
- layout: the image contains a real UI screen (website / mobile app / tablet). Cues: a bounded rectangular region with a screen aspect ratio (16:9, 16:10, 4:3 = desktop; 9:16, 9:19.5 = mobile; 4:3, 3:4 = tablet), rounded screen corners, a device frame, or internal UI (nav, buttons, cards, text).
- inspiration: the image is NOT a layout (photo, illustration, texture, object, render, game art). Abstract its style and propose UI tokens.

STEP 2 — ISOLATE (layout mode). Read ONLY the real screen(s); IGNORE everything that is presentation, not design:
- a backdrop the screens float on (gradient, solid colour, scene) — DISCARD it; never read colours from it.
- device frames, bezels, browser chrome — DISCARD; read only the screen inside.
- the room/desk behind a device photo — DISCARD; the design is the image INSIDE the screen.
- gutters between multiple screens — DISCARD.
If several screens of the same product are shown, MERGE their tokens (agreement across screens = higher confidence).

STEP 3 — EXTRACT TOKENS, by ROLE not by area:
- TONE: one line, the vibe.
- COLOUR by role: surface (the canvas content sits ON — identify by function even if little of it is visible; a surface can be small in visible pixels if elements cover it, so do NOT equate "largest flat area" with surface), neutrals (text, hairlines, muted), accent (small, saturated, repeated). Separate brand from neutral. Give hex values sampled from UI pixels ONLY, never the discarded backdrop.
- TYPOGRAPHY: family character (serif/sans, geometric/humanist), weight contrast, scale, case. ITALIC: state explicitly whether the type is upright or italic and, if italic, exactly where it is used (e.g. only on a highlighted value). If the type is upright, say "upright, no italic" so the restyler never introduces italic.
- SHAPE: corner-radius scale (cards vs buttons vs pills) and character (soft/large vs sharp).
- SPACING: density (airy / balanced / dense) and rhythm — relative, not exact px.
- PROPORTIONS & PADDING (pay close attention — easy to get wrong): the size of text RELATIVE to its buttons, pills, and containers (e.g. "small label inside a tall pill"), and the INTERNAL padding — the gap between content and the container's edges (generous vs tight). Capture these ratios so the restyler keeps the same breathing room.
- ELEVATION, BORDERS & SHADOWS: state explicitly whether cards / containers have (a) a border/outline at all and (b) a drop-shadow at all. If they are flat (separated by fill alone), say "no borders, no shadows" so the restyler invents NEITHER (AIs force both). Report a border or shadow only when the source actually shows it, and note its tint.
- UI BACKGROUND: the screen's own canvas colour (NOT the discarded image backdrop — name them separately).

INSPIRATION mode instead: read style family (skeuomorphic / flat / brutalist / editorial / glassy / ...), materials & textures, mood, palette, illustration style; THEN translate into concrete UI token suggestions (surface, accent, type, radius, depth). Mark these as invented.

OUTPUT — markdown, no code fences, no preface. Start with exactly two lines:
mode: layout | inspiration
confidence: high | medium | low
Then the brief using the sections above, as a design.md the restyler can apply.`;

function isAnthropic(model) { return /^(claude|opus|sonnet|haiku)/i.test(model); }
function isOpenAI(model) { return /^(gpt|openai|o[1-9])/i.test(model); }

function parseDataUrl(dataUrl) {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(dataUrl || '');
  if (!m) return null;
  return { mediaType: m[1], base64: m[2] };
}

async function callVision({ model, system, instruction, dataUrl, maxTokens = 4000 }) {
  if (isAnthropic(model)) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY missing');
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) throw new Error('style-extract: unparseable image data URL');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const stream = client.messages.stream({
      model, max_tokens: maxTokens, system,
      messages: [{ role: 'user', content: [
        { type: 'text', text: instruction },
        { type: 'image', source: { type: 'base64', media_type: parsed.mediaType, data: parsed.base64 } }
      ] }]
    });
    const final = await stream.finalMessage();
    return final.content?.map((b) => b.text || '').join('') || '';
  }
  if (isOpenAI(model)) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing');
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const stream = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: [
          { type: 'text', text: instruction },
          { type: 'image_url', image_url: { url: dataUrl } }
        ] }
      ],
      max_completion_tokens: maxTokens,
      stream: true
    });
    let text = '';
    for await (const chunk of stream) {
      const delta = chunk?.choices?.[0]?.delta?.content;
      if (typeof delta === 'string') text += delta;
    }
    return text;
  }
  // Gemini
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY missing');
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) throw new Error('style-extract: unparseable image data URL');
  const ai = new GoogleGenAI({ apiKey });
  const resp = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [
      { text: instruction },
      { inlineData: { mimeType: parsed.mediaType, data: parsed.base64 } }
    ] }],
    config: { systemInstruction: system, maxOutputTokens: maxTokens }
  });
  return resp.text || resp.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
}

function parseModeConfidence(text) {
  const mode = /mode:\s*(layout|inspiration)/i.exec(text)?.[1]?.toLowerCase() || 'layout';
  const confidence = /confidence:\s*(high|medium|low)/i.exec(text)?.[1]?.toLowerCase() || 'medium';
  return { mode, confidence };
}

/**
 * Extract a clean style brief from one image data URL.
 * @returns {Promise<{brief:string, mode:'layout'|'inspiration', confidence:string}>}
 */
export async function extractStyleFromImage({ imageDataUrl, model = DEFAULT_VISION_MODEL } = {}) {
  if (!imageDataUrl) throw new Error('style-extract: no image provided');
  const instruction = 'Analyze the attached image and produce its style brief.';
  const raw = await callVision({ model, system: EXTRACT_SYSTEM, instruction, dataUrl: imageDataUrl });
  const brief = (raw || '').replace(/^```[a-z]*\n/, '').replace(/```\s*$/, '').trim();
  if (!brief) throw new Error('style-extract: model returned an empty brief');
  return { brief, ...parseModeConfidence(brief) };
}
