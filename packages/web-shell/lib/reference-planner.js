const BUSINESS_SIGNALS = {
  portfolio: ['portfolio', 'designer', 'developer', 'studio', 'personal'],
  agency: ['agency', 'creative', 'consultancy', 'branding'],
  technology: ['technology', 'software', 'saas', 'ai', 'developer', 'platform'],
  finance: ['finance', 'fintech', 'bank', 'payment', 'investment'],
  commerce: ['commerce', 'shop', 'store', 'retail', 'product'],
  hospitality: ['restaurant', 'hotel', 'food', 'travel', 'hospitality'],
  culture: ['museum', 'music', 'film', 'culture', 'art', 'festival'],
  industrial: ['industry', 'industrial', 'manufacturing', 'agriculture', 'energy'],
  nonprofit: ['nonprofit', 'foundation', 'social', 'community'],
};

const VISUAL_SIGNALS = {
  editorial: ['editorial', 'magazine', 'premium', 'luxury'],
  minimal: ['minimal', 'clean', 'quiet', 'simple'],
  immersive: ['immersive', 'cinematic', 'experiential'],
  typographic: ['typographic', 'type-led', 'bold type'],
  'product-led': ['product-led', 'product', 'device'],
  photographic: ['photographic', 'photography', 'photo'],
  '3d': ['3d', 'three.js', 'threejs'],
  monochrome: ['monochrome', 'black and white'],
  colorful: ['colorful', 'vibrant', 'bright'],
};

const MOTION_SIGNALS = {
  subtle: ['subtle', 'restrained motion'],
  'scroll-driven': ['animated', 'animation', 'scroll', 'motion'],
  pinned: ['pinned', 'sticky'],
  'video-led': ['video', 'film', 'cinematic'],
  webgl: ['webgl', 'three.js', 'threejs', '3d'],
  playful: ['playful', 'game', 'interactive'],
};

function inferTags(text, dictionary) {
  const normalized = text.toLowerCase();
  return Object.entries(dictionary).flatMap(([tag, words]) => words.some((word) => normalized.includes(word)) ? [tag] : []);
}

export function inferReferenceBrief(brief) {
  const text = String(brief || '').trim();
  return {
    text,
    businessTags: inferTags(text, BUSINESS_SIGNALS),
    visualTags: inferTags(text, VISUAL_SIGNALS),
    motionTags: inferTags(text, MOTION_SIGNALS),
  };
}

function overlap(left = [], right = []) {
  const other = new Set(right);
  return left.filter((value) => other.has(value));
}

const SCORE_WEIGHTS = {
  briefFit: 0.35,
  manualQuality: 0.25,
  compositionCompatibility: 0.15,
  motion: 0.10,
  transferability: 0.10,
  sourceConfidence: 0.05,
};

const DIMENSION_PROFILES = {
  balanced: {
    visualQuality: 0.18, structureQuality: 0.15, motionQuality: 0.14, originality: 0.12,
    transferability: 0.15, commercialClarity: 0.10, chassisPotential: 0.08, donorPotential: 0.08,
  },
  precision: {
    visualQuality: 0.12, structureQuality: 0.22, motionQuality: 0.08, originality: 0.06,
    transferability: 0.16, commercialClarity: 0.22, chassisPotential: 0.08, donorPotential: 0.06,
  },
  expressive: {
    visualQuality: 0.22, structureQuality: 0.10, motionQuality: 0.18, originality: 0.18,
    transferability: 0.12, commercialClarity: 0.06, chassisPotential: 0.08, donorPotential: 0.06,
  },
  conversion: {
    visualQuality: 0.16, structureQuality: 0.18, motionQuality: 0.10, originality: 0.07,
    transferability: 0.17, commercialClarity: 0.20, chassisPotential: 0.06, donorPotential: 0.06,
  },
  technical: {
    visualQuality: 0.14, structureQuality: 0.20, motionQuality: 0.15, originality: 0.08,
    transferability: 0.16, commercialClarity: 0.15, chassisPotential: 0.07, donorPotential: 0.05,
  },
};

function normalizedRating(value, fallback = 3) {
  const rating = Number(value ?? fallback);
  return Math.min(1, Math.max(0, (rating - 1) / 4));
}

function dimensionValue(preference, key) {
  return normalizedRating(preference.dimensionRatings?.[key], preference.rating || 3);
}

export function getBriefWeightProfile(profile) {
  const business = new Set(profile.businessTags || []);
  let name = 'balanced';
  if (business.has('finance')) name = 'precision';
  else if (['culture', 'portfolio', 'agency'].some((tag) => business.has(tag))) name = 'expressive';
  else if (['commerce', 'hospitality'].some((tag) => business.has(tag))) name = 'conversion';
  else if (['technology', 'industrial'].some((tag) => business.has(tag))) name = 'technical';
  return { name, dimensions: DIMENSION_PROFILES[name] };
}

function manualQuality(preference, weighting) {
  const dimensionScore = Object.entries(weighting.dimensions)
    .reduce((total, [key, weight]) => total + dimensionValue(preference, key) * weight, 0);
  const overall = normalizedRating(preference.rating);
  const decisionConfidence = preference.decision === 'keep' ? 1 : 0.55;
  return overall * 0.35 + dimensionScore * 0.55 + decisionConfidence * 0.10;
}

function fitScore(matches, expected) {
  return expected.length ? matches.length / expected.length : null;
}

export function scoreReferenceCandidate(candidate, profile, role) {
  const preference = candidate.preference || {};
  const business = overlap(preference.businessTags, profile.businessTags);
  const visual = overlap(preference.visualTags, profile.visualTags);
  const motion = overlap(preference.motionTags, profile.motionTags);
  const fitParts = [
    fitScore(business, profile.businessTags),
    fitScore(visual, profile.visualTags),
    fitScore(motion, profile.motionTags),
  ].filter((value) => value != null);
  const briefFit = fitParts.length ? fitParts.reduce((total, value) => total + value, 0) / fitParts.length : 0.5;
  const weighting = profile.weighting || getBriefWeightProfile(profile);
  const quality = manualQuality(preference, weighting);
  const roleMatch = preference.preferredRole === role ? 1 : preference.preferredRole === 'either' ? 0.72 : 0.15;
  const rolePotential = dimensionValue(preference, role === 'chassis' ? 'chassisPotential' : 'donorPotential');
  const motionOwnerBoost = role === 'chassis' && preference.motionTags?.some((tag) => ['scroll-driven', 'pinned', 'video-led', 'webgl'].includes(tag)) ? 0.1 : 0;
  const compositionCompatibility = Math.min(1, roleMatch * 0.62 + rolePotential * 0.38 + motionOwnerBoost);
  const motionTagFit = profile.motionTags.length ? motion.length / profile.motionTags.length : 0.5;
  const motionScore = motionTagFit * 0.55 + dimensionValue(preference, 'motionQuality') * 0.45;
  const transferability = dimensionValue(preference, 'transferability');
  const sourceConfidence = Math.min(1, Math.max(0, Number(candidate.sourceConfidence ?? 0.6)));
  const components = {
    briefFit,
    manualQuality: quality,
    compositionCompatibility,
    motion: motionScore,
    transferability,
    sourceConfidence,
  };
  const score = Object.entries(SCORE_WEIGHTS)
    .reduce((total, [key, weight]) => total + components[key] * weight, 0) * 100;
  const breakdown = Object.fromEntries(Object.entries(components).map(([key, value]) => [key, Math.round(value * 100)]));
  const reasons = [
    preference.decision === 'keep' ? 'explicitly kept during review' : 'kept as a possible ingredient',
    preference.rating ? `taste score ${preference.rating}/5` : null,
    business.length ? `business match: ${business.join(', ')}` : null,
    visual.length ? `visual match: ${visual.join(', ')}` : null,
    motion.length ? `motion match: ${motion.join(', ')}` : null,
    `weighted fit ${breakdown.briefFit}%`,
    `quality ${breakdown.manualQuality}%`,
    `composition ${breakdown.compositionCompatibility}%`,
  ].filter(Boolean);
  return { candidate, score: Number(score.toFixed(2)), breakdown, reasons };
}

function donorOwnership(candidate, index) {
  const tags = candidate.preference?.visualTags || [];
  const motion = candidate.preference?.motionTags || [];
  if (tags.includes('photographic') || motion.includes('video-led')) return 'media treatment and compatible image or video slots';
  if (tags.some((tag) => ['typographic', 'minimal', 'colorful', 'monochrome'].includes(tag))) return 'typography, palette, and component language';
  return index === 0 ? 'content density and compatible section pattern' : 'one bounded section pattern';
}

export function createReferencePlan({ brief, candidates, maxReferences = 4 }) {
  const inferredProfile = inferReferenceBrief(brief);
  const profile = { ...inferredProfile, weighting: getBriefWeightProfile(inferredProfile) };
  const eligible = (candidates || []).filter((candidate) => ['keep', 'maybe'].includes(candidate.preference?.decision));
  if (profile.text.length < 12) return { ok: false, error: 'brief_too_short' };
  if (eligible.length < 2) return { ok: false, error: 'review_required', required: 2, current: eligible.length };

  const chassisPool = eligible.filter((candidate) => candidate.preference.preferredRole !== 'donor');
  const chassis = (chassisPool.length ? chassisPool : eligible)
    .map((candidate) => scoreReferenceCandidate(candidate, profile, 'chassis'))
    .sort((a, b) => b.score - a.score || Number(b.candidate.curationWeight || 0) - Number(a.candidate.curationWeight || 0) || a.candidate.title.localeCompare(b.candidate.title))[0];
  const donorLimit = Math.max(1, Math.min(3, Number(maxReferences || 4) - 1));
  const donors = eligible
    .filter((candidate) => candidate.id !== chassis.candidate.id && candidate.preference.preferredRole !== 'chassis')
    .map((candidate) => scoreReferenceCandidate(candidate, profile, 'donor'))
    .sort((a, b) => b.score - a.score || Number(b.candidate.curationWeight || 0) - Number(a.candidate.curationWeight || 0) || a.candidate.title.localeCompare(b.candidate.title))
    .slice(0, donorLimit);
  if (!donors.length) return { ok: false, error: 'donor_required' };

  const selectedReferences = [
    {
      id: chassis.candidate.id,
      title: chassis.candidate.title,
      url: chassis.candidate.url,
      role: 'chassis',
      score: chassis.score,
      scoreBreakdown: chassis.breakdown,
      owns: 'section order, layout rhythm, scroll model, primary motion system, and layering',
      reasons: chassis.reasons,
    },
    ...donors.map((donor, index) => ({
      id: donor.candidate.id,
      title: donor.candidate.title,
      url: donor.candidate.url,
      role: 'donor',
      score: donor.score,
      scoreBreakdown: donor.breakdown,
      owns: donorOwnership(donor.candidate, index),
      reasons: donor.reasons,
    })),
  ];

  return {
    ok: true,
    plan: {
      schemaVersion: 2,
      mode: 'shadow',
      generationTriggered: false,
      briefProfile: profile,
      rule: 'One dominant chassis and bounded donors. No competing page spines.',
      scoringWeights: SCORE_WEIGHTS,
      selectedReferences,
      composition: {
        preserve: ['chassis section order', 'chassis scroll model', 'chassis primary motion and layering'],
        adapt: selectedReferences.slice(1).map((reference) => `${reference.title}: ${reference.owns}`),
        replace: ['brand identity', 'copy', 'media whose semantics do not match the brief'],
      },
      warnings: profile.businessTags.length ? [] : ['Business category was not explicit; reviewer confirmation is recommended before generation.'],
    },
  };
}
