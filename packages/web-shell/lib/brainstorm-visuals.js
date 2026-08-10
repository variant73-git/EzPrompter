const START_MARKER = '<uncraft-brainstorm>';
const END_MARKER = '</uncraft-brainstorm>';

export const BRAINSTORM_VISUAL_KINDS = new Set([
  'structure',
  'alignment',
  'typography',
  'palette',
]);

export const BRAINSTORM_LAYOUT_PATTERNS = new Set([
  'media-anchored',
  'split',
  'centered',
  'offset',
  'edge-distributed',
  'editorial-grid',
  'stacked',
  'horizontal-sequence',
]);

export const BRAINSTORM_TYPE_STYLES = new Set([
  'neutral-sans',
  'humanist-sans',
  'geometric-sans',
  'editorial-serif',
  'display-serif',
  'condensed-sans',
]);

function shortText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function safeId(value, fallback) {
  const cleaned = shortText(value, 48)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || fallback;
}

function safeColors(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((color) => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color))
    .slice(0, 4)
    .map((color) => color.toUpperCase());
}

export function normalizeBrainstormVisual(value) {
  if (!value || typeof value !== 'object' || !BRAINSTORM_VISUAL_KINDS.has(value.kind)) return null;
  if (!Array.isArray(value.options) || value.options.length < 2) return null;

  const options = value.options.map((option, index) => {
    if (!option || typeof option !== 'object') return null;
    const title = shortText(option.title, 44);
    const fit = shortText(option.fit, 64);
    const signal = shortText(option.signal, 48);
    if (!title || !fit || !signal) return null;

    const normalized = {
      id: safeId(option.id, `option-${index + 1}`),
      title,
      fit,
      signal,
      reply: shortText(option.reply, 160) || `Selected direction: ${title}.`,
    };

    if (value.kind === 'structure' || value.kind === 'alignment') {
      normalized.pattern = BRAINSTORM_LAYOUT_PATTERNS.has(option.pattern)
        ? option.pattern
        : 'stacked';
    }
    if (value.kind === 'typography') {
      normalized.typeStyle = BRAINSTORM_TYPE_STYLES.has(option.typeStyle)
        ? option.typeStyle
        : 'neutral-sans';
      normalized.sample = shortText(option.sample, 18) || 'Aa';
    }
    if (value.kind === 'palette') {
      normalized.colors = safeColors(option.colors);
      if (normalized.colors.length < 3) return null;
    }
    return normalized;
  }).filter(Boolean).slice(0, 3);

  if (options.length < 2) return null;
  return { kind: value.kind, options };
}

/**
 * Extracts one bounded visual-choice payload from assistant prose. An opening
 * marker without a closing marker is hidden while streaming so partial JSON
 * never flashes in the chat.
 */
export function parseBrainstormMessage(content) {
  const source = typeof content === 'string' ? content : '';
  const start = source.indexOf(START_MARKER);
  if (start < 0) return { text: source, visual: null };

  const end = source.indexOf(END_MARKER, start + START_MARKER.length);
  if (end < 0) return { text: source.slice(0, start).trimEnd(), visual: null };

  const before = source.slice(0, start).trimEnd();
  const after = source.slice(end + END_MARKER.length).trimStart();
  const text = [before, after].filter(Boolean).join('\n\n');

  try {
    const payload = JSON.parse(source.slice(start + START_MARKER.length, end).trim());
    return { text, visual: normalizeBrainstormVisual(payload) };
  } catch {
    return { text, visual: null };
  }
}

export const BRAINSTORM_VISUAL_PROTOCOL = `When the next high-information question is about structure, alignment, typography, or palette, make it VISUAL. Write the short question as normal prose, then append exactly one machine-readable block using this format:
<uncraft-brainstorm>
{"kind":"structure|alignment|typography|palette","options":[...]}
</uncraft-brainstorm>

The block is rendered as visual choice cards and is never shown as code. Rules:
- Offer 2 or 3 meaningfully contrasting options, never more.
- Every option needs: id, title (2-4 words), fit (an ultra-short phrase saying what it suits), signal (an ultra-short phrase saying what it conveys), and reply (a concise first-person selection sentence in the user's language).
- structure/alignment options also need pattern, chosen only from: media-anchored, split, centered, offset, edge-distributed, editorial-grid, stacked, horizontal-sequence.
- typography options also need typeStyle, chosen only from: neutral-sans, humanist-sans, geometric-sans, editorial-serif, display-serif, condensed-sans; sample is optional.
- palette options also need colors with 3 or 4 six-digit hex colors.
- Keep fit and signal concrete and extremely short. Do not repeat the full explanation in prose.
- Use cards only when visual comparison materially helps. For audience, purpose, content, constraints, approval, or other non-visual questions, ask normally without a block.
- Never explain or mention the block, tags, JSON, or rendering protocol to the user.`;
