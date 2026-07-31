export const REFERENCE_DECISIONS = ['keep', 'maybe', 'pass'];
export const REFERENCE_ROLES = ['chassis', 'donor', 'either'];
export const REFERENCE_TAGS = {
  business: ['portfolio', 'agency', 'technology', 'finance', 'commerce', 'hospitality', 'culture', 'industrial', 'nonprofit'],
  visual: ['editorial', 'minimal', 'immersive', 'typographic', 'product-led', 'photographic', '3d', 'monochrome', 'colorful'],
  motion: ['static', 'subtle', 'scroll-driven', 'pinned', 'video-led', 'webgl', 'playful'],
};

function allowedTags(values, allowed) {
  const set = new Set(allowed);
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value).toLowerCase()).filter((value) => set.has(value)))];
}

export function normalizeReferencePreference(input = {}) {
  const decision = REFERENCE_DECISIONS.includes(input.decision) ? input.decision : null;
  const preferredRole = REFERENCE_ROLES.includes(input.preferredRole) ? input.preferredRole : 'either';
  const numericRating = input.rating == null || input.rating === '' ? null : Number(input.rating);
  const rating = Number.isInteger(numericRating) && numericRating >= 1 && numericRating <= 5 ? numericRating : null;
  const notes = String(input.notes || '').trim().slice(0, 4000) || null;
  if (!decision) return { ok: false, error: 'invalid_decision' };
  if (input.rating != null && input.rating !== '' && rating == null) return { ok: false, error: 'invalid_rating' };
  return {
    ok: true,
    value: {
      decision,
      rating,
      preferredRole,
      businessTags: allowedTags(input.businessTags, REFERENCE_TAGS.business),
      visualTags: allowedTags(input.visualTags, REFERENCE_TAGS.visual),
      motionTags: allowedTags(input.motionTags, REFERENCE_TAGS.motion),
      notes,
    },
  };
}
