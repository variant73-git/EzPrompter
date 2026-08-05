import { getReferenceTagPreset } from './reference-design-taxonomy.js';

const PRODUCT_SIGNALS = {
  'landing-page': ['landing page', 'homepage', 'one-page'],
  'corporate-site': ['corporate', 'institutional', 'business site', 'company site'],
  portfolio: ['portfolio', 'case studies', 'personal site'],
  'agency-site': ['agency', 'studio', 'consultancy'],
  saas: ['saas', 'software service', 'platform'],
  tool: ['tool', 'builder', 'editor', 'developer product'],
  app: ['app', 'application', 'mobile product'],
  ecommerce: ['ecommerce', 'e-commerce', 'shop', 'store'],
  marketplace: ['marketplace', 'directory'],
  editorial: ['editorial', 'magazine', 'publication'],
  community: ['community', 'membership'],
  'event-campaign': ['event', 'festival', 'campaign', 'launch'],
  documentation: ['documentation', 'docs', 'developer portal'],
};

const STYLE_SIGNALS = {
  'soft-tech': ['soft tech', 'soft-tech', 'calm tech', 'approachable tech'],
  techy: ['techy', 'technical', 'developer'],
  futuristic: ['futuristic', 'future-facing', 'sci-fi', 'frontier'],
  fancy: ['fancy', 'polished', 'premium'],
  corporate: ['corporate', 'business', 'institutional'],
  playful: ['playful visual style', 'ludic composition', 'colorful'],
  editorial: ['editorial', 'magazine'],
  fashion: ['fashion', 'style-led'],
  experimental: ['experimental', 'unconventional', 'artistic'],
  luxury: ['luxury', 'exclusive'],
  minimal: ['minimal', 'quiet', 'restrained'],
};

const MOTION_SIGNALS = {
  subtle: ['subtle motion', 'restrained motion'],
  'scroll-driven': ['animated', 'animation', 'scroll', 'motion'],
  pinned: ['pinned', 'sticky'],
  'video-led': ['video', 'film', 'cinematic'],
  webgl: ['webgl', 'three.js', 'threejs', '3d'],
  playful: ['playful motion', 'game-like', 'interactive'],
};

const BRAND_SIGNALS = {
  playful: ['playful', 'fun', 'lúdico', 'lúdica', 'ludico', 'ludica', 'divertido', 'divertida', 'brincalhão', 'brincalhona'],
  extroverted: ['extroverted', 'expressive', 'energetic', 'extrovertido', 'extrovertida', 'expressivo', 'expressiva', 'energético', 'energética'],
  sober: ['sober', 'serious', 'restrained', 'sóbrio', 'sobrio', 'sério', 'serio', 'contido'],
  neutral: ['neutral', 'clean', 'quiet', 'neutro', 'discreto'],
  corporate: ['corporate', 'enterprise', 'business', 'corporativo', 'empresarial'],
  authoritative: ['authoritative', 'trusted', 'expert', 'autoridade', 'confiável', 'especialista'],
  approachable: ['approachable', 'friendly', 'human', 'acessível', 'amigável', 'humano'],
  bold: ['bold', 'confident', 'ousado', 'marcante'],
  technical: ['technical', 'complex', 'developer', 'técnico', 'tecnico', 'complexo'],
  premium: ['premium', 'sophisticated', 'luxury', 'sofisticado', 'luxo'],
  rebellious: ['rebellious', 'irreverent', 'rebelde', 'irreverente'],
  warm: ['warm', 'welcoming', 'caloroso', 'acolhedor'],
};

function inferTags(text, dictionary) {
  const normalized = text.toLowerCase();
  const matches = (signal) => {
    const escaped = signal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'iu').test(normalized);
  };
  return Object.entries(dictionary).flatMap(([tag, words]) => words.some(matches) ? [tag] : []);
}

export function inferReferenceBrief(brief) {
  const text = String(brief || '').trim();
  const productTypes = inferTags(text, PRODUCT_SIGNALS);
  const styleTags = inferTags(text, STYLE_SIGNALS).slice(0, 2);
  const motionTags = inferTags(text, MOTION_SIGNALS);
  const brandAttributes = inferTags(text, BRAND_SIGNALS).slice(0, 3);
  return {
    text,
    productTypes,
    styleTags,
    brandAttributes,
    motionTags,
    // Compatibility aliases for persisted v1/v2 plans and existing consumers.
    businessTags: productTypes,
    visualTags: styleTags,
  };
}

function overlap(left = [], right = []) {
  const other = new Set(right);
  return left.filter((value) => other.has(value));
}

const SCORE_WEIGHTS = {
  briefHints: 0.15,
  manualQuality: 0.20,
  structuralPortability: 0.30,
  visualQuality: 0.20,
  motion: 0.10,
  sourceConfidence: 0.05,
};

const DIMENSION_PROFILES = {
  balanced: { visualQuality: 0.24, structureQuality: 0.24, motionQuality: 0.12, originality: 0.12, transferability: 0.18, commercialClarity: 0.10 },
  precision: { visualQuality: 0.18, structureQuality: 0.28, motionQuality: 0.07, originality: 0.07, transferability: 0.20, commercialClarity: 0.20 },
  expressive: { visualQuality: 0.27, structureQuality: 0.17, motionQuality: 0.17, originality: 0.19, transferability: 0.14, commercialClarity: 0.06 },
  conversion: { visualQuality: 0.21, structureQuality: 0.25, motionQuality: 0.08, originality: 0.08, transferability: 0.18, commercialClarity: 0.20 },
  technical: { visualQuality: 0.19, structureQuality: 0.27, motionQuality: 0.12, originality: 0.08, transferability: 0.21, commercialClarity: 0.13 },
};

function normalizedRating(value, fallback = 3) {
  const rating = Number(value ?? fallback);
  return Math.min(1, Math.max(0, (rating - 1) / 4));
}

function dimensionValue(preference, key) {
  return normalizedRating(preference.dimensionRatings?.[key], preference.rating ?? 3);
}

export function getBriefWeightProfile(profile) {
  const products = new Set(profile.productTypes || profile.businessTags || []);
  const styles = new Set(profile.styleTags || profile.visualTags || []);
  const brand = new Set(profile.brandAttributes || []);
  let name = 'balanced';
  if (styles.has('experimental') || styles.has('fashion') || styles.has('playful') || ['playful', 'extroverted', 'bold', 'rebellious'].some((tag) => brand.has(tag)) || products.has('portfolio') || products.has('agency-site')) name = 'expressive';
  else if (products.has('ecommerce') || products.has('marketplace')) name = 'conversion';
  else if (products.has('corporate-site')) name = 'precision';
  else if (products.has('saas') || products.has('tool') || products.has('app') || styles.has('techy') || styles.has('futuristic') || styles.has('soft-tech')) name = 'technical';
  return { name, dimensions: DIMENSION_PROFILES[name] };
}

function dimensionQuality(preference, weighting) {
  return Object.entries(weighting.dimensions)
    .reduce((total, [key, weight]) => total + dimensionValue(preference, key) * weight, 0);
}

function fitScore(matches, expected) {
  return expected.length ? matches.length / expected.length : null;
}

export function scoreReferenceCandidate(candidate, profile) {
  const preference = candidate.preference || {};
  const preset = getReferenceTagPreset(candidate.url || candidate.host);
  const products = overlap(preference.businessTags, profile.productTypes || profile.businessTags);
  const styles = overlap(preference.visualTags, profile.styleTags || profile.visualTags);
  const motion = overlap(preference.motionTags, profile.motionTags);
  const brand = overlap(preference.brandAttributes || preset?.brandAttributes, profile.brandAttributes);
  const fitParts = [
    fitScore(products, profile.productTypes || profile.businessTags),
    fitScore(styles, profile.styleTags || profile.visualTags),
    fitScore(motion, profile.motionTags),
    fitScore(brand, profile.brandAttributes),
  ].filter((value) => value != null);
  const briefHints = fitParts.length ? fitParts.reduce((total, value) => total + value, 0) / fitParts.length : 0.5;
  const weighting = profile.weighting || getBriefWeightProfile(profile);
  const dimensions = dimensionQuality(preference, weighting);
  const verdict = preference.decision === 'keep' ? 1 : 0.55;
  const overall = preference.rating == null ? 0.5 : normalizedRating(preference.rating);
  const manualQuality = overall * 0.55 + dimensions * 0.25 + verdict * 0.20;
  const structuralPortability = dimensionValue(preference, 'structureQuality') * 0.55 + dimensionValue(preference, 'transferability') * 0.45;
  const visualQuality = dimensionValue(preference, 'visualQuality') * 0.70 + dimensionValue(preference, 'originality') * 0.30;
  const motionFit = profile.motionTags.length ? motion.length / profile.motionTags.length : 0.5;
  const motionScore = motionFit * 0.35 + dimensionValue(preference, 'motionQuality') * 0.65;
  const sourceConfidence = Math.min(1, Math.max(0, Number(candidate.sourceConfidence ?? 0.6)));
  const components = { briefHints, manualQuality, structuralPortability, visualQuality, motion: motionScore, sourceConfidence };
  const score = Object.entries(SCORE_WEIGHTS).reduce((total, [key, weight]) => total + components[key] * weight, 0) * 100;
  const breakdown = Object.fromEntries(Object.entries(components).map(([key, value]) => [key, Math.round(value * 100)]));
  const reasons = [
    preference.decision === 'keep' ? 'explicitly kept during review' : 'retained as an uncertain candidate',
    preference.rating ? `optional taste calibration ${preference.rating}/5` : null,
    products.length ? `product hint: ${products.join(', ')}` : null,
    styles.length ? `style hint: ${styles.join(', ')}` : null,
    motion.length ? `motion hint: ${motion.join(', ')}` : null,
    brand.length ? `brand personality hint: ${brand.join(', ')}` : null,
    `structural portability ${breakdown.structuralPortability}%`,
    `visual quality ${breakdown.visualQuality}%`,
  ].filter(Boolean);
  return { candidate, score: Number(score.toFixed(2)), breakdown, reasons };
}

function supportingInfluence(candidate, index) {
  const styles = candidate.preference?.visualTags || [];
  const motion = candidate.preference?.motionTags || [];
  if (motion.some((tag) => ['scroll-driven', 'pinned', 'video-led', 'webgl'].includes(tag))) return 'one semantically portable interaction or section rhythm';
  if (styles.some((tag) => ['editorial', 'fashion', 'experimental'].includes(tag))) return 'one bounded text or media composition';
  return index === 0 ? 'one compatible section structure' : 'one bounded structural alternative';
}

export function createReferencePlan({ brief, candidates, maxReferences = 3 }) {
  const inferredProfile = inferReferenceBrief(brief);
  const profile = { ...inferredProfile, weighting: getBriefWeightProfile(inferredProfile) };
  const eligible = (candidates || []).filter((candidate) => ['keep', 'maybe'].includes(candidate.preference?.decision));
  if (profile.text.length < 12) return { ok: false, error: 'brief_too_short' };
  if (!eligible.length) return { ok: false, error: 'review_required', required: 1, current: 0 };

  const limit = Math.max(1, Math.min(3, Number(maxReferences) || 3));
  const ranked = eligible
    .map((candidate) => scoreReferenceCandidate(candidate, profile))
    .sort((a, b) => b.score - a.score || Number(b.candidate.curationWeight || 0) - Number(a.candidate.curationWeight || 0) || a.candidate.title.localeCompare(b.candidate.title))
    .slice(0, limit);
  const selectedReferences = ranked.map((entry, index) => ({
    id: entry.candidate.id,
    title: entry.candidate.title,
    url: entry.candidate.url,
    influence: index === 0 ? 'scale-owner' : 'section-source',
    scaleOwner: index === 0,
    score: entry.score,
    scoreBreakdown: entry.breakdown,
    owns: index === 0 ? 'page-wide type and media scale, spacing cadence, and responsive consistency' : supportingInfluence(entry.candidate, index - 1),
    reasons: entry.reasons,
  }));

  return {
    ok: true,
    plan: {
      schemaVersion: 3,
      mode: 'shadow',
      generationTriggered: false,
      briefProfile: profile,
      rule: 'No fixed roles per site. One contextual scale owner; optional references contribute bounded section structures.',
      scoringWeights: SCORE_WEIGHTS,
      selectedReferences,
      composition: {
        preserve: ['section topology and reading order', 'alignment and anchoring logic', 'media-to-copy proportions', 'density rhythm', 'mobile coherence'],
        adapt: selectedReferences.slice(1).map((reference) => `${reference.title}: ${reference.owns}`),
        replace: ['brand identity', 'copy', 'imagery', 'decorative treatment', 'semantically specific motion'],
      },
      warnings: [
        ...(!profile.productTypes.length ? ['Product type was not explicit; use it only as a weak search hint.'] : []),
        ...(!profile.styleTags.length ? ['Style was not explicit; brainstorm before treating a reference family as intentional.'] : []),
        ...(!profile.brandAttributes.length ? ['Brand personality was not explicit; ask before defaulting from the business category.'] : []),
        ...(selectedReferences.some((reference) => reference.scoreBreakdown.motion > 60) ? ['Validate motion for semantic portability before borrowing it.'] : []),
      ],
    },
  };
}
