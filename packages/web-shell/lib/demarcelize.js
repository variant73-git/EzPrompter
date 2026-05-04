/**
 * demarcelize.js — port of Demarcelizer 2.0's reskin pipeline.
 *
 * Three operations:
 *   extractContent({html}) → JSON of structured target content
 *   inject({referenceHtml, content}) → reference HTML with target content slotted
 *   reskin({targetHtml, referenceHtml}) → end-to-end (extract + inject)
 *
 * Models: defaults to Sonnet 4.6 for cost/quality balance. Override via
 * UNCRAFT_LLM_MODEL env or per-call options.
 *
 * Routing: model name regex picks provider. claude/opus → Anthropic, gemini → Google.
 */

import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';

const DEFAULT_MODEL = process.env.UNCRAFT_LLM_MODEL || 'claude-sonnet-4-6';

const TASTE_PRINCIPLES = `
TASTE PRINCIPLES (apply with strong influence to every visual decision):

CONTENT AUTHENTICITY
- Use the target's exact words. Never paraphrase into AI marketing clichés ("Elevate", "Seamless", "Unleash", "Next-Gen", "Empower", "Transform", "Discover", "Revolutionize").
- Preserve real numbers, prices, percentages, dates, proper nouns. No fake "99%", "50%", "10x", "John Doe", "Sarah Chan", "Acme", "Nexus", "SmartFlow".
- Zero emojis in any output.

TYPOGRAPHY
- Use the reference's exact display + body fonts as declared. Never silently substitute "Inter" if the reference uses something else.
- Control hierarchy with weight and color, not just oversized H1s.
- Mono fonts ONLY where the reference explicitly uses them — never on body copy.

COLOR
- Use the reference's exact hex tokens. Don't shift toward "AI purple/blue" gradients or oversaturated accents.
- Maximum one accent color. Saturation below 80%.
- Avoid pure #000000 — render as #0a0a0a if needed.
- No outer/neon glows. Inner shadows or shadows tinted to the background hue only.

LAYOUT
- Preserve the reference's section count and order verbatim (chassis contract).
- Avoid generic three-equal-card rows; prefer asymmetric grids, 2-column zig-zag, bento layouts.
- Constrain outer containers with max-w-7xl mx-auto or max-w-[1400px].
- Hero sections must use min-h-[100dvh], never h-screen.

MOTION
- Animate exclusively transform and opacity. Never animate top, left, width, or height.
- Stagger reveal sequences with 80–120ms cascading delays.

INTERACTIVE STATES
- Buttons on :active should translate-y-[1px] or scale-[0.98] for tactile feedback.
- Provide hover feedback on every clickable element.
`;

const EXTRACT_SYSTEM = `You extract visible content from a website's HTML. Output ONLY a single JSON object — no markdown fences, no preface, no commentary, no surrounding text.

When extracting, preserve the target's exact wording, real numbers, real names, and real proper nouns. Do NOT paraphrase to generic AI clichés. Do NOT round numbers to clean fakes (99%, 50%). Do NOT substitute names with placeholders. Capture what the page actually says.`;

const INJECT_SYSTEM = `You receive STRUCTURED CONTENT (JSON) and a REFERENCE HTML chassis. Your job: emit the REFERENCE HTML with every visible text node REPLACED by values from STRUCTURED CONTENT.

MAPPING (apply slot-by-slot)
- content.brand → every brand/logo/product-name text node (nav title, hero brand mentions, footer signature, badges).
- content.tagline → small tagline element if present near the hero/badge.
- content.hero.headline → the primary hero headline (largest h1).
- content.hero.subheadline → the supporting line under the headline.
- content.hero.cta_primary → primary CTA button label.
- content.hero.cta_secondary → secondary CTA / nav action button label.
- content.nav[] → nav link labels (truncate to fit reference's nav count).
- content.features[] → feature card titles + descriptions (fill in order).
- content.stats[] → metric/stat label-value pairs.
- content.testimonials[] → testimonial cards.
- content.pricing[] → pricing tier cards.
- content.faq[] → FAQ items.
- content.sections[] → remaining section content (about/CTA/other).
- content.footer.tagline / links / copyright → footer text.

PRESERVE EXACTLY (do not modify)
- Reference's HTML structure, tag tree, classes, IDs, inline styles, attributes.
- Reference's <script> blocks (animation, canvas, GSAP, ScrollTrigger, init code) — copy verbatim.
- Reference's <style> blocks and CSS.
- Reference's section count and order.
- Reference's component shapes, colors, typography, motion.
- Reference's canvas/WebGL/SVG decorative elements.

HARD RULES (failure if violated)
- Every visible word in your output that came from the reference's original placeholder copy must be replaced by values from STRUCTURED CONTENT or by adaptations of those values.
- The reference's original brand/headline/feature copy must NOT appear in the output.
- If STRUCTURED CONTENT has a value for a slot, USE IT verbatim. Numbers, prices, proper nouns stay literal.
- If STRUCTURED CONTENT has null/missing for a slot, expand from related fields in the same brand/domain — do NOT keep the reference's placeholder.

OUTPUT
Single complete self-contained HTML5 document starting with <!DOCTYPE html>. No commentary, no markdown fences, no preface, no truncation.
${TASTE_PRINCIPLES}`;

const RESKIN_SYSTEM = `You receive two HTML documents:

A) TARGET COPY — the SOURCE OF CONTENT. Extract every visible string from it (brand name, hero headline, sub-headline, button labels, nav links, section titles, paragraph copy, list items, footer text, badge text, pricing, CTAs). These strings are the ONLY copy allowed in your output.

B) REFERENCE TEMPLATE — an empty visual chassis. Treat its current copy as PLACEHOLDER LOREM IPSUM. Discard ALL its words. Keep its layout, sections, components, classes, inline styles, scripts, CSS, motion, canvas/WebGL/SVG, hero composition, and every visual decision.

YOUR JOB
Emit the REFERENCE TEMPLATE with every visible text node REPLACED by content from TARGET COPY.

PROCESS (do this internally before writing)
1. Read TARGET COPY. Mentally list its strings:
   - Brand / product name = ?
   - Main hero headline = ?
   - Sub-headline / tagline = ?
   - Primary CTA label = ?
   - Secondary CTAs / nav links = ?
   - Top 3–8 features / value props (title + 1-line desc each) = ?
   - Footer / contact / pricing / testimonials = ?
2. Walk the REFERENCE TEMPLATE top to bottom. For each visible text node, decide which TARGET string belongs there.
3. Substitute. Repeat until no reference placeholder copy remains visible.

HARD RULES (failure if violated)
- Output MUST contain target's exact brand/product name in the brand slot (logo text, nav title, footer signature).
- Output MUST contain target's main headline in the hero — not the reference's hero copy.
- Output MUST contain target's CTA wording on primary/secondary buttons.
- Output MUST contain target's feature titles and descriptions on the reference's feature cards.
- Output MUST contain target's nav link labels — not the reference's.
- NO placeholder phrase from the reference may survive in visible text. If you would emit a string that exists in the reference but not in the target, replace it.

PRESERVE EXACTLY FROM REFERENCE
- Section count, order, hierarchy, hero composition, grid density.
- Component shapes: cards, buttons, pills, badges, inputs, navs, radii, shadows.
- Color tokens, typography (display + body + label fonts + sizes), spacing rhythm.
- Motion: GSAP timelines, ScrollTrigger, hover lifts, masked reveals.
- Canvas/WebGL/dither effects, decorative SVGs, gradient meshes.
- ALL <script> blocks (animation logic, canvas draw loops, init code) — copy verbatim.

ADAPTATION (when shapes don't match)
- Target has MORE content than reference slots: pick the highest-impact items. Don't add new sections.
- Target has FEWER items than reference slots: expand inline using target's tone, domain, and existing copy. Never invent unrelated facts.
- Numbers, prices, dates, proper nouns from target stay literal.

OUTPUT
Single complete self-contained HTML5 document starting with <!DOCTYPE html>. No commentary, no markdown fences, no preface, no truncation.
${TASTE_PRINCIPLES}`;

function isAnthropic(model) {
  return /^(claude|opus|sonnet|haiku)/i.test(model);
}

async function callLLM({ model, system, user, maxTokens = 16000, temperature = 0.4 }) {
  if (isAnthropic(model)) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY missing');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const resp = await client.messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      system,
      messages: [{ role: 'user', content: user }]
    });
    const text = resp.content?.map((b) => b.text || '').join('') || '';
    return { text, tokens: { input: resp.usage?.input_tokens, output: resp.usage?.output_tokens } };
  }
  if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) {
    throw new Error('GEMINI_API_KEY missing');
  }
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY });
  const resp = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: user }] }],
    config: { systemInstruction: system, maxOutputTokens: maxTokens, temperature }
  });
  const text = resp.text || resp.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  return { text, tokens: { input: resp.usageMetadata?.promptTokenCount, output: resp.usageMetadata?.candidatesTokenCount } };
}

function stripCodeFences(s) {
  return s.replace(/^```[a-z]*\n/, '').replace(/```\s*$/, '').trim();
}

export async function extractContent({ html, model = DEFAULT_MODEL }) {
  const prompt = `TARGET HTML:\n\n${html}\n\nReturn JSON shape:\n{"brand":"","tagline":"","hero":{"headline":"","subheadline":"","cta_primary":"","cta_secondary":""},"nav":[],"features":[{"title":"","description":""}],"stats":[],"testimonials":[],"pricing":[],"faq":[],"sections":[],"footer":{"tagline":"","links":[],"copyright":""}}`;
  const { text } = await callLLM({ model, system: EXTRACT_SYSTEM, user: prompt, maxTokens: 8000, temperature: 0.2 });
  const cleaned = stripCodeFences(text);
  try { return JSON.parse(cleaned); } catch (e) {
    throw new Error(`extractContent: model returned non-JSON: ${cleaned.slice(0, 200)}…`);
  }
}

export async function inject({ referenceHtml, content, model = DEFAULT_MODEL }) {
  const prompt = `STRUCTURED CONTENT:\n${JSON.stringify(content, null, 2)}\n\nREFERENCE HTML:\n${referenceHtml}`;
  const { text } = await callLLM({ model, system: INJECT_SYSTEM, user: prompt, maxTokens: 32000, temperature: 0.4 });
  return stripCodeFences(text);
}

export async function reskin({ targetHtml, referenceHtml, model = DEFAULT_MODEL }) {
  const prompt = `TARGET COPY:\n${targetHtml}\n\nREFERENCE TEMPLATE:\n${referenceHtml}`;
  const { text } = await callLLM({ model, system: RESKIN_SYSTEM, user: prompt, maxTokens: 32000, temperature: 0.4 });
  return stripCodeFences(text);
}
