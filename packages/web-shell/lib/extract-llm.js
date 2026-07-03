/**
 * extract-llm.js — isolated text + vision LLM seam for extract.js.
 *
 * Keeps the dispatcher unit-testable (vi.mock('./extract-llm.js')).
 * Client construction mirrors design-md.js exactly: Anthropic default import,
 * GoogleGenAI named import, same method signatures.
 */

import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import { samplePalette } from './design/sample-palette.js';

const DEFAULT_MODEL = 'gemini-2.5-flash';
// Image → site clone / reconstruction brief is a HARD vision task: a weak model
// (e.g. Flash) returns shallow or blank HTML. Route those through a strong,
// funded model. Default to GPT-5.5 — the same model reconstruct.js uses for URL
// clones, and what the picker selects. Tunable via env (claude-*, gemini-*).
const STRONG_VISION_MODEL = process.env.UNCRAFT_CLONE_MODEL || 'gpt-5.5';
const MAX_HTML = 60000;

function isOpenAI(m) {
  return /^(gpt|openai|o[1-9])/i.test(m);
}
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

  if (isOpenAI(model)) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing');
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const stream = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: [
          { type: 'text', text: user },
          { type: 'image_url', image_url: { url: dataUrl } },
        ] },
      ],
      max_completion_tokens: maxTokens,
      stream: true,
    });
    let text = '';
    for await (const chunk of stream) {
      const delta = chunk?.choices?.[0]?.delta?.content;
      if (typeof delta === 'string') text += delta;
    }
    return text.trim();
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

// asset → prompt. ADAPTIVE: a full-site screenshot becomes a pixel-faithful
// RECONSTRUCTION brief; a fragment/component or a non-UI image is interpreted
// precisely for what it actually is (so we never pretend a logo or a photo is a
// whole website).
export async function describeImageAsPrompt({ dataUrl, model }) {
  const system =
    'You turn an image into a precise GENERATION BRIEF. FIRST decide what the image is, then brief accordingly:\n' +
    '• A FULL website / landing page / app screen → produce an EXHAUSTIVE, pixel-faithful RECONSTRUCTION brief: the exact layout structure (every section top-to-bottom, grids, columns, alignment), the spacing rhythm, the FULL colour palette as hex, typography (family character, weights, sizes, hierarchy, tracking), every component and its states, imagery, and ALL visible copy transcribed verbatim. Omit nothing visible.\n' +
    '• A PIECE of a site (a single component/section) OR a non-UI image (photo, illustration, logo, product shot) → do NOT pretend it is a full site. Read and INTERPRET precisely what it actually is — subject, content, composition, style, palette, mood — as a faithful generation prompt for that thing.\n' +
    'Either way: concrete and precise, invent nothing not shown, no preamble. Markdown allowed.';
  return callVision({
    model: model || STRONG_VISION_MODEL,
    system,
    user: 'Read this image, decide what it is, and write the precise brief.',
    dataUrl,
    maxTokens: 2400,
  });
}

// Strip a leading ```html / trailing ``` fence the model may add despite being
// asked for raw HTML.
function stripFences(s) {
  return String(s || '').replace(/^\s*```(?:html)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
}

// asset → site CLONE. A faithful, pixel-accurate reproduction of the website in
// the screenshot as a single self-contained responsive HTML document. NO house
// style is applied — a clone reproduces the source, it does not reinterpret it.
export async function cloneImageToHtml({ dataUrl, model }) {
  const system =
    'You reproduce a website from a screenshot with extreme fidelity. Output ONE self-contained, responsive, navigable HTML document with an inline <style> block that recreates the page in the image as faithfully as possible. Transcribe ALL visible text verbatim, sample colours to hex from the pixels, match typography character (family feel, weights, sizes, hierarchy, tracking), and recreate icons/shapes with CSS/SVG. Use semantic HTML. Invent, omit, or restyle nothing that is not in the image.\n\n' +
    'OBSERVE CAREFULLY before you build — these are the mistakes to avoid:\n' +
    '• ISOLATE THE REAL SITE (most important). The screenshot often shows the design FLOATING on a presentation backdrop — a grey/coloured canvas, a device frame, a drop-shadow, or margins around the UI (a Dribbble-style shot). That backdrop is NOT part of the site. Reproduce ONLY the actual UI, FULL-BLEED: it fills the viewport edge to edge and the page background is the UI\'s OWN background — never the grey the shot sits on. Do NOT island the site in the middle of a canvas, and do NOT reproduce the surrounding margin/backdrop.\n' +
    '• NO INVENTED FRAME. Do not wrap the page in an outer border, card, rounded container, or inset "device" frame unless the screenshot CLEARLY shows one. By default the page is full-bleed: the background reaches every edge. Most sites have NO enclosing frame — do not add one.\n' +
    '• PILL vs CIRCLE. A PILL is a rounded RECTANGLE — width clearly greater than height, border-radius ≈ half its height, usually a text label. A CIRCULAR button is 1:1 — equal width and height, fully round, usually a single icon. Measure the proportion before choosing; never turn a pill into a circle or a circle into a pill.\n' +
    '• NAV / MENU STYLE — pick the ONE the image uses, reproduce only that: (a) LOOSE items — standalone pills/links sitting directly on the page background with gaps between them; or (b) ENCAPSULATED — several items grouped INSIDE one larger container pill/bar (a segmented nav). Do NOT add a surrounding container the original lacks, and do NOT scatter items the original groups inside one pill.\n' +
    '• WHITE vs OFF-WHITE. Distinguish pure white (#ffffff) from off-white / cream / light grey (e.g. #faf9f6, #f5f5f4). Sample the real hex per surface — a warm off-white page background with true-white cards on top is common and must be preserved; never collapse every light surface to #fff.\n' +
    '• RASTER IMAGES — CROP the real pixels, never redraw them. Mark EVERY photograph, 3D render, illustration, and image-logo with `data-clone-crop="X,Y,W,H"` (its bounding box as PERCENTAGES of the whole screenshot, top-left origin): a container `<div data-clone-crop="…">` sized/positioned like the image, holding the IMAGE PLACEHOLDER (below) as its ONLY content — the real pixels REPLACE the container\'s contents. (`<img data-clone-crop="…" alt="…">` with empty src is also accepted.)\n' +
    '  Crop-mark a region even when it is LARGE, floats, or bleeds over the page background — a big hero render over a plain background is the BEST possible crop, not a hazard. Draw the box generously around the FULL artwork, including every extremity (a nose, a wing, a cast shadow). Chips/badges TOUCHING or overlapping the artwork belong inside the box (they get baked into the crop — do NOT rebuild them as separate elements); anything separated from the artwork by background is page UI — keep it OUT of the box and build it in HTML.\n' +
    '  The ONLY reason not to crop-mark: real, functional UI overlaps the image — toolbars, buttons, form fields, text blocks, or cards that belong to the page. Then place the IMAGE PLACEHOLDER at the image\'s size/position and build that overlapping UI as SEPARATE elements on top — never bake functional UI into a picture, and NEVER paint your own approximation of a photo/render.\n' +
    '  IMAGE PLACEHOLDER — the ONLY stand-in for any raster image: a block of the image\'s exact size/position containing a 1px outline, both diagonals crossed corner-to-corner with a white→grey gradient stroke, everything at 30% opacity, and a centred label naming the image in 2-3 words + "not generated" (e.g. "plane image not generated"), same colour as the lines. Template (give each placeholder a unique gradient id; the crop container itself carries NO border/frame/shadow — only this inner block does):\n' +
    '  <div style="position:absolute;inset:0;border:1px solid rgba(153,153,153,.3)"><svg width="100%" height="100%" preserveAspectRatio="none" style="position:absolute;inset:0;opacity:.3"><defs><linearGradient id="ph1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#777777"/></linearGradient></defs><line x1="0" y1="0" x2="100%" y2="100%" stroke="url(#ph1)"/><line x1="100%" y1="0" x2="0" y2="100%" stroke="url(#ph1)"/></svg><span style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:#999;opacity:.3;font-size:12px;white-space:nowrap">plane image not generated</span></div>\n' +
    '  Reserve CSS/SVG for simple icons and geometric shapes.\n\n' +
    'Output ONLY the HTML document — no markdown fences, no commentary.';
  // Deterministic colour ground-truth — measure the real background gradient +
  // palette and pin the exact hexes so the clone stops drifting colour.
  let truth = '';
  try { truth = await samplePalette({ imageDataUrl: dataUrl }); } catch { /* best-effort */ }
  const html = await callVision({
    model: model || STRONG_VISION_MODEL,
    system,
    user: 'Reproduce the website shown in this image as a single faithful, navigable HTML document.' + (truth || ''),
    dataUrl,
    maxTokens: 16000,
  });
  return stripFences(html);
}
