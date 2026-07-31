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

function scoreCandidate(candidate, profile, role) {
  const preference = candidate.preference || {};
  const business = overlap(preference.businessTags, profile.businessTags);
  const visual = overlap(preference.visualTags, profile.visualTags);
  const motion = overlap(preference.motionTags, profile.motionTags);
  let score = Number(candidate.curationWeight || 0);
  score += Number(preference.rating || 0) * 1.4;
  score += preference.decision === 'keep' ? 4 : 1;
  score += business.length * 3;
  score += visual.length * 2;
  score += motion.length * 2.4;
  if (preference.preferredRole === role) score += 2.5;
  if (preference.preferredRole === 'either') score += 0.75;
  if (role === 'chassis' && preference.motionTags?.some((tag) => ['scroll-driven', 'pinned', 'video-led', 'webgl'].includes(tag))) score += 1.5;
  const reasons = [
    preference.decision === 'keep' ? 'explicitly kept during review' : 'kept as a possible ingredient',
    preference.rating ? `taste score ${preference.rating}/5` : null,
    business.length ? `business match: ${business.join(', ')}` : null,
    visual.length ? `visual match: ${visual.join(', ')}` : null,
    motion.length ? `motion match: ${motion.join(', ')}` : null,
  ].filter(Boolean);
  return { candidate, score: Number(score.toFixed(2)), reasons };
}

function donorOwnership(candidate, index) {
  const tags = candidate.preference?.visualTags || [];
  const motion = candidate.preference?.motionTags || [];
  if (tags.includes('photographic') || motion.includes('video-led')) return 'media treatment and compatible image or video slots';
  if (tags.some((tag) => ['typographic', 'minimal', 'colorful', 'monochrome'].includes(tag))) return 'typography, palette, and component language';
  return index === 0 ? 'content density and compatible section pattern' : 'one bounded section pattern';
}

export function createReferencePlan({ brief, candidates, maxReferences = 4 }) {
  const profile = inferReferenceBrief(brief);
  const eligible = (candidates || []).filter((candidate) => ['keep', 'maybe'].includes(candidate.preference?.decision));
  if (profile.text.length < 12) return { ok: false, error: 'brief_too_short' };
  if (eligible.length < 2) return { ok: false, error: 'review_required', required: 2, current: eligible.length };

  const chassisPool = eligible.filter((candidate) => candidate.preference.preferredRole !== 'donor');
  const chassis = (chassisPool.length ? chassisPool : eligible)
    .map((candidate) => scoreCandidate(candidate, profile, 'chassis'))
    .sort((a, b) => b.score - a.score || a.candidate.title.localeCompare(b.candidate.title))[0];
  const donorLimit = Math.max(1, Math.min(3, Number(maxReferences || 4) - 1));
  const donors = eligible
    .filter((candidate) => candidate.id !== chassis.candidate.id && candidate.preference.preferredRole !== 'chassis')
    .map((candidate) => scoreCandidate(candidate, profile, 'donor'))
    .sort((a, b) => b.score - a.score || a.candidate.title.localeCompare(b.candidate.title))
    .slice(0, donorLimit);
  if (!donors.length) return { ok: false, error: 'donor_required' };

  const selectedReferences = [
    {
      id: chassis.candidate.id,
      title: chassis.candidate.title,
      url: chassis.candidate.url,
      role: 'chassis',
      score: chassis.score,
      owns: 'section order, layout rhythm, scroll model, primary motion system, and layering',
      reasons: chassis.reasons,
    },
    ...donors.map((donor, index) => ({
      id: donor.candidate.id,
      title: donor.candidate.title,
      url: donor.candidate.url,
      role: 'donor',
      score: donor.score,
      owns: donorOwnership(donor.candidate, index),
      reasons: donor.reasons,
    })),
  ];

  return {
    ok: true,
    plan: {
      schemaVersion: 1,
      mode: 'shadow',
      generationTriggered: false,
      briefProfile: profile,
      rule: 'One dominant chassis and bounded donors. No competing page spines.',
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
