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
import { HOUSE_STYLE } from './design/house-style.js';
import { buildReferenceDirective, referencesEnabled } from './design/reference-directive.js';
import { extractStyleFromImage } from './design/style-extract.js';
import { recordUsage } from './billing/context.js';

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

const COMPOSE_SYSTEM = `You are Demarcelizer 4.0. You receive a TARGET HTML document and one or more CONNECTED NODES. Compose them into one production-ready HTML document.

CORE PRINCIPLE
The connected nodes are the creative direction and source material. Do not replace explicit connected evidence with your own generic design taste. Preserve the reference experience, then transplant the identity, content and media supplied by the graph.

INPUTS YOU MAY RECEIVE
- HTML SOURCE — a structural and behavioural reference. Preserve its scene order, layout rhythm and motion system when it is the chosen chassis.
- DESIGN.MD SOURCE — the authoritative identity and style map: palette, typography, scale, spacing, components, image treatment and written motion guidance.
- MEDIA SOURCE — a literal connected image or video. Use the exact placeholder supplied for src, poster or CSS background-image; never fabricate a substitute URL.
- SKILL SOURCE — executable or written behaviour such as a shader, animation or interaction adapter.
- PROMPT INSTRUCTION — explicit user direction and content priority.

PRIORITY WHEN SOURCES DISAGREE
1. Explicit prompt instructions.
2. Edge binding notes and literal media assignments.
3. DESIGN.MD for identity, palette, typography and component language.
4. HTML source for structure, layering, responsive logic and motion choreography.
5. Target content and existing behaviour.
Only invent where every connected source is silent.

OPERATION MATRIX (compose, do not pick one)
- HTML only → reskin: preserve the target's exact text content, replace the target's structural chassis with the source HTML's chassis.
- DESIGN.MD only → restyle: keep the target's HTML structure verbatim; apply the md tokens (colours, type scale, font families, spacing) by injecting / overriding the target's style block.
- HTML + DESIGN.MD → reskin with the HTML chassis + md tokens as overrides.
- MEDIA → replace the most semantically compatible image/video slots with the exact connected media placeholders. Names and binding notes indicate intended roles.
- SKILL → preserve the target/chassis and integrate the supplied behaviour at the compatible semantic target.
- PROMPT only → execute the instruction directly on the target.
- PROMPT + any other source → follow the prompt as the primary directive; use the other sources as material.

PRESERVE EVERY TIME (do not break, do not paraphrase)
- The target's exact text content (real words, numbers, prices, names, proper nouns).
- The target's existing media only when no connected media source replaces its semantic slot.
- When a source design is provided, use ITS exact fonts and hex tokens; preserve the chosen chassis's section count + order.

MOTION TRANSPLANT RULES
- Preserve all script blocks, dependencies, animation initialization and selectors from the chosen animated chassis unless a connected skill explicitly replaces them.
- Preserve pinned/sticky scenes, scroll ranges, scrub/pin/snap behaviour, reveal order, masks, transforms, easing, stagger, pointer interactions and media timing.
- Keep animated DOM targets and their class/id hooks present. Adapt content inside those targets instead of deleting the targets.
- When replacement copy or media changes dimensions, adapt crop, line wrapping and scroll distance while preserving the same choreography and relative timing.
- Do not flatten animation into a video, screenshot or static approximation.
- Include a prefers-reduced-motion resolution that presents the final readable composition.

MEDIA PLACEHOLDERS
- Copy placeholders such as {{UNCRAFT_MEDIA_1}} exactly into the appropriate src/poster/style URL.
- Images may be used as visual art direction as well as literal replacement media.
- Videos must remain real <video> elements. Preserve autoplay/muted/loop/playsinline or scroll-scrub behaviour when compatible with the chassis.

${HOUSE_STYLE}

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
    recordUsage({
      provider: 'anthropic', model,
      tokensIn: final.usage?.input_tokens || 0,
      tokensOut: final.usage?.output_tokens || 0,
      cachedIn: final.usage?.cache_read_input_tokens || 0,
      cacheWrite: final.usage?.cache_creation_input_tokens || 0,
    });
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
      stream: true,
      stream_options: { include_usage: true }
    });
    let text = '';
    let usage = null;
    for await (const chunk of stream) {
      const delta = chunk?.choices?.[0]?.delta?.content;
      if (typeof delta === 'string') text += delta;
      if (chunk?.usage) usage = chunk.usage;
    }
    recordUsage({
      provider: 'openai', model,
      tokensIn: usage?.prompt_tokens || 0,
      tokensOut: usage?.completion_tokens || 0,
      cachedIn: usage?.prompt_tokens_details?.cached_tokens || 0,
    });
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
  const gu = resp.usageMetadata || {};
  recordUsage({ provider: 'gemini', model, tokensIn: gu.promptTokenCount || 0, tokensOut: gu.candidatesTokenCount || 0, cachedIn: gu.cachedContentTokenCount || 0 });
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

function assetMime(source) {
  return String(source?.meta?.mimeType || source?.meta?.mediaType || '').toLowerCase();
}

function isImageSource(source) {
  const mime = assetMime(source);
  const value = String(source?.meta?.dataUrl || '');
  return mime.startsWith('image/') || value.startsWith('data:image/');
}

function sourceBindingNote(source) {
  const payload = source?.edge_payload;
  if (!payload || typeof payload !== 'object') return '';
  const binding = payload.binding || payload.role || payload.channel || payload.channels;
  if (!binding) return '';
  return typeof binding === 'string' ? binding : JSON.stringify(binding);
}

function assemblePrompt({ targetHtml, buckets }) {
  const parts = [`TARGET HTML:\n${targetHtml}`];
  buckets.html.forEach((s, i) => {
    if (s.source_html) parts.push(`HTML SOURCE${buckets.html.length > 1 ? ` ${i + 1}` : ''}:\n${s.source_html}`);
  });
  buckets.md.forEach((s, i) => {
    if (s.source_design_md) {
      const binding = sourceBindingNote(s);
      parts.push(`DESIGN.MD SOURCE${buckets.md.length > 1 ? ` ${i + 1}` : ''}${binding ? ` (binding: ${binding})` : ''}:\n${s.source_design_md}`);
    }
  });
  buckets.prompt.forEach((s) => {
    const text = s.meta?.prompt || s.meta?.text || '';
    if (text) parts.push(`PROMPT INSTRUCTION:\n${text}`);
  });
  // Media placeholders keep large data URLs out of the model context while
  // still letting the output bind the exact connected files. After compose,
  // replaceMediaPlaceholders resolves the stable tokens deterministically.
  const mediaBindings = [];
  buckets.asset.forEach((s, i) => {
    const placeholder = `{{UNCRAFT_MEDIA_${i + 1}}}`;
    const dataUrl = s.meta?.dataUrl || s.meta?.blobUrl || s.meta?.sourceUrl || '';
    const mime = assetMime(s) || (isImageSource(s) ? 'image/*' : 'application/octet-stream');
    const name = s.meta?.name || `Media ${i + 1}`;
    const binding = sourceBindingNote(s);
    mediaBindings.push({ placeholder, value: dataUrl });
    parts.push(`CONNECTED MEDIA ${i + 1}:\n- name: ${name}\n- mime: ${mime}\n- exact placeholder: ${placeholder}${binding ? `\n- binding: ${binding}` : ''}\nUse this exact media in the most compatible semantic slot. Treat an attached image as art direction too; treat video as real motion media, never a poster-only substitute.`);
  });
  buckets.skill.forEach((s, i) => {
    const body = s.meta?.instructions || s.meta?.code || s.meta?.prompt || s.source_html || '';
    if (!body) return;
    const binding = sourceBindingNote(s);
    parts.push(`SKILL SOURCE${buckets.skill.length > 1 ? ` ${i + 1}` : ''}${binding ? ` (binding: ${binding})` : ''}:\n${body}`);
  });
  // Extract image data URLs for the vision pipeline.
  const images = buckets.asset
    .filter(isImageSource)
    .map((s) => s.meta?.dataUrl || s.meta?.blobUrl || s.meta?.sourceUrl)
    .filter(Boolean);
  return { text: parts.join('\n\n'), images, mediaBindings };
}

export function replaceMediaPlaceholders(html, bindings = []) {
  let output = String(html || '');
  for (const binding of bindings) {
    if (!binding?.placeholder || !binding?.value) continue;
    output = output.split(binding.placeholder).join(binding.value);
  }
  return output;
}

export async function runCompose({ target, sources, model, modelId, systemPromptOverride, referencePlan = null, referenceEvidence = {} }) {
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

  // Every connected artifact with actual content can direct a transplant.
  if (
    buckets.html.length === 0 &&
    buckets.md.length === 0 &&
    buckets.prompt.length === 0 &&
    buckets.asset.length === 0 &&
    !buckets.skill.some((s) => s.meta?.instructions || s.meta?.code || s.meta?.prompt || s.source_html)
  ) {
    throw new Error('No actionable inputs. Connect a site, design.md, screenshot, or prompt source.');
  }

  // Layer B: extract a style brief from each image source up front. The brief
  // isolates the real design (naming any presentation backdrop / device frame
  // to ignore) and pins exact tokens (palette, radius, spacing, font-style,
  // shadows, padding). We feed the brief as a design.md guide AND KEEP the
  // image as a vision source — so compose both READS the precise tokens AND
  // SEES the actual style. Full absorption of every characteristic, which a
  // lossy text brief alone cannot convey (spacing, proportions, the exact feel).
  // The brief + the STYLE ABSORPTION rule keep the backdrop out of the result.
  const imageSources = buckets.asset.filter(isImageSource);
  if (imageSources.length > 0) {
    for (const a of imageSources) {
      const dataUrl = a.meta?.dataUrl;
      if (!dataUrl) continue;
      try {
        const { brief } = await extractStyleFromImage({ imageDataUrl: dataUrl });
        if (brief) buckets.md.push({ kind: 'designmd', source_design_md: brief, _fromImage: true });
      } catch { /* brief failed — the image still rides as a raw vision source */ }
    }
    // assets are KEPT (not consumed) so compose sees the style, guided by the brief.
  }

  // Routing rule: if any image source is present, force a vision-capable
  // model regardless of what the picker said. Falls back to gpt-5.5 if
  // the user picked a text-only model with images attached.
  let effectiveModel = resolvedModel;
  if (imageSources.length > 0 && !/^(gpt|openai|o[1-9])/i.test(effectiveModel)) {
    effectiveModel = 'gpt-5.5';
  }

  const { text: userPrompt, images, mediaBindings } = assemblePrompt({ targetHtml: target.current_html, buckets });
  // A direcao do banco de referencias entra na mensagem de USUARIO, junto dos
  // artefatos conectados: ela e' evidencia DESTA execucao, nao regra do sistema.
  // O contrato de quem manda em que dimensao viaja com ela (ver
  // `reference-directive.js`) para que a autoridade nunca chegue sem o material
  // a que ela se refere.
  const referenceDirective = referencePlan && referencesEnabled()
    ? buildReferenceDirective(referencePlan, { evidence: referenceEvidence })
    : '';
  const composedUserPrompt = referenceDirective ? `${referenceDirective}\n\n${userPrompt}` : userPrompt;
  const systemPrompt = systemPromptOverride || COMPOSE_SYSTEM;
  const { text } = await callLLM({
    model: effectiveModel,
    system: systemPrompt,
    user: composedUserPrompt,
    images,
    maxTokens: 32000,
    temperature: 0.4
  });
  const generatedHtml = stripCodeFences(text);
  const usedMedia = mediaBindings.filter((binding) => binding.value && generatedHtml.includes(binding.placeholder));
  const html = replaceMediaPlaceholders(generatedHtml, mediaBindings);
  if (!html || !/<html/i.test(html)) {
    throw new Error('Model returned no usable HTML.');
  }
  return {
    html,
    transplant: {
      engine: 'demarcelizer-4',
      mediaBound: usedMedia.length,
      mediaUnbound: mediaBindings
        .filter((binding) => binding.value && !generatedHtml.includes(binding.placeholder))
        .map((binding) => binding.placeholder),
      sourceKinds: Object.entries(buckets).flatMap(([kind, items]) => items.length ? [kind] : []),
      motionPreserved: buckets.html.some((source) => (
        source.meta?.animatedDetected
        || source.meta?.animatedRuntime
        || source.meta?.nativeMotion
        || source.meta?.runtime === 'native'
        || source.meta?.runtime === 'animated'
      )),
    },
  };
}
