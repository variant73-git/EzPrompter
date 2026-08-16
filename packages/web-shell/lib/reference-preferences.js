import { MAX_STYLE_TAGS, PRODUCT_TYPE_TAGS, STYLE_TAGS } from './reference-design-taxonomy.js';
import { encodeReferenceGuidance } from './reference-guidance.js';

export const REFERENCE_DECISIONS = ['keep', 'maybe', 'pass'];
// Kept only for database compatibility with the first shadow-planner schema.
// Human review no longer assigns fixed roles to a reference.
export const REFERENCE_ROLES = ['chassis', 'donor', 'either'];
export const REFERENCE_RATING_LABELS = {
  1: 'Discardable',
  2: 'One useful idea',
  3: 'Good, but familiar',
  4: 'Very strong',
  5: 'Reference-defining',
};
export const REFERENCE_DIMENSIONS = {
  visualQuality: { label: 'Visual craft', description: 'Finish, art direction, and visual coherence.' },
  structureQuality: { label: 'Structure', description: 'Hierarchy, layout rhythm, and content capacity.' },
  motionQuality: { label: 'Motion', description: 'Choreography, timing, and interaction quality.' },
  originality: { label: 'Originality', description: 'Distinctive decisions rather than trend repetition.' },
  transferability: { label: 'Transferability', description: 'How safely its system can support a new brief.' },
  commercialClarity: { label: 'Commercial clarity', description: 'How clearly it communicates offer and action.' },
};
export const REFERENCE_TAGS = {
  product: PRODUCT_TYPE_TAGS,
  style: STYLE_TAGS,
  motion: ['static', 'subtle', 'scroll-driven', 'pinned', 'video-led', 'webgl', 'playful'],
};
// Storage/API aliases. The current database columns retain their old names.
REFERENCE_TAGS.business = REFERENCE_TAGS.product;
REFERENCE_TAGS.visual = REFERENCE_TAGS.style;

function allowedTags(values, allowed, limit = Infinity) {
  const set = new Set(allowed);
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value).toLowerCase()).filter((value) => set.has(value)))].slice(0, limit);
}

function normalizeDimensionRatings(input, enabled) {
  const source = input && typeof input === 'object' ? input : {};
  const ratings = {};
  for (const key of Object.keys(REFERENCE_DIMENSIONS)) {
    if (!enabled) {
      ratings[key] = null;
      continue;
    }
    const raw = source[key];
    if (raw == null || raw === '') {
      ratings[key] = null;
      continue;
    }
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1 || value > 5) return { ok: false, error: 'invalid_dimension_rating' };
    ratings[key] = value;
  }
  return { ok: true, value: ratings };
}

export function normalizeReferencePreference(input = {}) {
  const decision = REFERENCE_DECISIONS.includes(input.decision) ? input.decision : null;
  const ratingWasProvided = input.rating != null && input.rating !== '';
  const numericRating = ratingWasProvided ? Number(input.rating) : null;
  const rating = ratingWasProvided && Number.isInteger(numericRating) && numericRating >= 1 && numericRating <= 5 ? numericRating : null;
  const hasStructuredGuidance = Object.hasOwn(input, 'worthBorrowing') || Object.hasOwn(input, 'avoid');
  const notes = hasStructuredGuidance
    ? encodeReferenceGuidance({ worthBorrowing: input.worthBorrowing, avoid: input.avoid })
    : String(input.notes || '').trim().slice(0, 4000) || null;
  if (!decision) return { ok: false, error: 'invalid_decision' };
  if (ratingWasProvided && rating == null) return { ok: false, error: 'invalid_rating' };
  const dimensions = normalizeDimensionRatings(input.dimensionRatings, rating >= 4);
  if (!dimensions.ok) return dimensions;
  const productTypes = input.productTypes ?? input.businessTags;
  const styleTags = input.styleTags ?? input.visualTags;
  return {
    ok: true,
    value: {
      decision,
      rating,
      preferredRole: 'either',
      businessTags: allowedTags(productTypes, REFERENCE_TAGS.product),
      visualTags: allowedTags(styleTags, REFERENCE_TAGS.style, MAX_STYLE_TAGS),
      motionTags: allowedTags(input.motionTags, REFERENCE_TAGS.motion),
      dimensionRatings: dimensions.value,
      notes,
    },
  };
}
