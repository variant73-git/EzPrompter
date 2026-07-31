export const REFERENCE_DECISIONS = ['keep', 'maybe', 'pass'];
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
  chassisPotential: { label: 'Chassis potential', description: 'Strength as the page spine and motion owner.' },
  donorPotential: { label: 'Donor potential', description: 'Strength as a bounded visual or section ingredient.' },
};
export const REFERENCE_TAGS = {
  business: ['portfolio', 'agency', 'technology', 'finance', 'commerce', 'hospitality', 'culture', 'industrial', 'nonprofit'],
  visual: ['editorial', 'minimal', 'immersive', 'typographic', 'product-led', 'photographic', '3d', 'monochrome', 'colorful'],
  motion: ['static', 'subtle', 'scroll-driven', 'pinned', 'video-led', 'webgl', 'playful'],
};

function allowedTags(values, allowed) {
  const set = new Set(allowed);
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value).toLowerCase()).filter((value) => set.has(value)))];
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
  const preferredRole = REFERENCE_ROLES.includes(input.preferredRole) ? input.preferredRole : 'either';
  const numericRating = input.rating == null || input.rating === '' ? null : Number(input.rating);
  const rating = Number.isInteger(numericRating) && numericRating >= 1 && numericRating <= 5 ? numericRating : null;
  const notes = String(input.notes || '').trim().slice(0, 4000) || null;
  if (!decision) return { ok: false, error: 'invalid_decision' };
  if (rating == null) return { ok: false, error: input.rating == null || input.rating === '' ? 'rating_required' : 'invalid_rating' };
  const dimensions = normalizeDimensionRatings(input.dimensionRatings, rating >= 4);
  if (!dimensions.ok) return dimensions;
  return {
    ok: true,
    value: {
      decision,
      rating,
      preferredRole,
      businessTags: allowedTags(input.businessTags, REFERENCE_TAGS.business),
      visualTags: allowedTags(input.visualTags, REFERENCE_TAGS.visual),
      motionTags: allowedTags(input.motionTags, REFERENCE_TAGS.motion),
      dimensionRatings: dimensions.value,
      notes,
    },
  };
}
