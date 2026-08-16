import { createHash } from 'node:crypto';
import { inferReferenceTypes } from './chassis-manifest.js';
import { isPrivateReferenceHost } from './public-reference-url.js';

export const CHASSIS_PREVIEW_PAGE_SIZE = 3;
export const CHASSIS_PLANNER_CONTRACT_VERSION = 5;

export function inferReferenceBrief(brief) {
  const text = String(brief || '').trim();
  const productTypes = inferReferenceTypes({ brief: text });
  return { text, productTypes, businessTags: productTypes };
}

export function createManualReferenceCandidate({ url, brief } = {}) {
  let parsed;
  try { parsed = new URL(String(url || '').trim()); } catch { throw new Error('invalid_reference_url'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || isPrivateReferenceHost(parsed.hostname)) throw new Error('invalid_reference_url');
  parsed.hash = '';
  const normalizedUrl = parsed.toString();
  const productTypes = inferReferenceBrief(brief).productTypes;
  return {
    id: `manual_${createHash('sha256').update(normalizedUrl).digest('hex').slice(0, 16)}`,
    title: parsed.hostname.replace(/^www\./, ''),
    url: normalizedUrl,
    manual: true,
    curationWeight: 0,
    preference: { decision: 'keep', businessTags: productTypes, worthBorrowing: '', avoid: '' },
  };
}

function overlap(left = [], right = []) {
  const other = new Set(right);
  return left.filter((value) => other.has(value));
}

export function scoreReferenceCandidate(candidate, profile) {
  if (candidate.manual) return { candidate, score: 100, breakdown: { typeFit: 100 }, reasons: ['direct reference supplied for this brief'] };
  const preference = candidate.preference || {};
  const expectedTypes = profile.productTypes || profile.businessTags || [];
  const candidateTypes = inferReferenceTypes({ ...candidate, businessTags: preference.businessTags });
  const matches = overlap(candidateTypes, expectedTypes);
  const typeFit = expectedTypes.length ? matches.length / expectedTypes.length : 0.5;
  const score = Number((typeFit * 100).toFixed(2));
  const reasons = matches.length
    ? [`site type: ${matches.join(', ')}`]
    : [expectedTypes.length ? 'kept chassis; site type needs visual verification' : 'kept chassis; site type was not explicit in the brief'];
  return { candidate, score, breakdown: { typeFit: Math.round(typeFit * 100) }, reasons };
}

function guidanceFor(candidate) {
  return {
    worthBorrowing: candidate.preference?.worthBorrowing || '',
    avoid: candidate.preference?.avoid || '',
  };
}

function compositionFor(guidance) {
  return {
    preserve: [
      'section topology and reading order',
      'grid, alignment, proportions, and density rhythm',
      'text anchoring and media-slot roles',
      'animation and responsive composition logic',
      ...(guidance.worthBorrowing ? [`Curator guidance: ${guidance.worthBorrowing}`] : []),
    ],
    adapt: ['copy length to the chassis capacity', 'motion semantics to the new content and audience'],
    replace: [
      'brand identity, typography, colors, copy, imagery, and decorative treatment',
      ...(guidance.avoid ? [`Exclude from transfer: ${guidance.avoid}`] : []),
    ],
  };
}

function asPreviewOption(scored) {
  const guidance = guidanceFor(scored.candidate);
  return {
    id: scored.candidate.id,
    title: scored.candidate.title,
    url: scored.candidate.url,
    thumbnailUrl: scored.candidate.thumbnailUrl || '',
    sourceNames: scored.candidate.sourceNames || [],
    influence: 'chassis',
    scaleOwner: true,
    score: scored.score,
    scoreBreakdown: scored.breakdown,
    owns: 'section order, wireframe geometry, text composition, media roles, animation logic, and responsive structure',
    guidance,
    source: scored.candidate.manual ? 'direct-url' : 'curated-keep',
    reasons: scored.reasons,
    composition: compositionFor(guidance),
  };
}

function compareOptions(left, right) {
  const leftTitle = String(left.candidate.title || '').toLocaleLowerCase('en');
  const rightTitle = String(right.candidate.title || '').toLocaleLowerCase('en');
  if (leftTitle < rightTitle) return -1;
  if (leftTitle > rightTitle) return 1;
  return String(left.candidate.id).localeCompare(String(right.candidate.id));
}

function previewHashFor(preview) {
  return createHash('sha256').update(JSON.stringify({
    plannerContractVersion: preview.plannerContractVersion,
    brief: preview.briefProfile.text,
    selectionMode: preview.selectionMode,
    scoringBasis: preview.scoringBasis,
    optionOffset: preview.optionOffset,
    options: preview.options,
    totalOptions: preview.totalOptions,
    bestScore: preview.bestScore,
    warnings: preview.warnings,
  })).digest('hex');
}

function normalizeOptionOffset(optionOffset, totalOptions) {
  const requested = Math.max(0, Math.floor(Number(optionOffset) || 0));
  const lastPageOffset = Math.max(0, Math.floor((totalOptions - 1) / CHASSIS_PREVIEW_PAGE_SIZE) * CHASSIS_PREVIEW_PAGE_SIZE);
  return Math.min(requested - (requested % CHASSIS_PREVIEW_PAGE_SIZE), lastPageOffset);
}

export function createReferencePlanPreview({ brief, candidates, optionOffset = 0 }) {
  const profile = inferReferenceBrief(brief);
  const eligible = (candidates || []).filter((candidate) => candidate.preference?.decision === 'keep');
  if (profile.text.length < 12) return { ok: false, error: 'brief_too_short' };
  if (!eligible.length) return { ok: false, error: 'review_required', required: 1, current: 0 };

  const scored = eligible.map((candidate) => scoreReferenceCandidate(candidate, profile));
  const bestScore = Math.max(...scored.map((item) => item.score));
  const tied = scored.filter((item) => item.score === bestScore).sort(compareOptions);
  const safeOffset = normalizeOptionOffset(optionOffset, tied.length);
  const options = tied.slice(safeOffset, safeOffset + CHASSIS_PREVIEW_PAGE_SIZE).map(asPreviewOption);
  const directReference = options[0]?.source === 'direct-url';
  const preview = {
    schemaVersion: 3,
    plannerContractVersion: CHASSIS_PLANNER_CONTRACT_VERSION,
    mode: 'preview',
    strategy: 'single-chassis',
    selectionMode: directReference ? 'direct-url' : 'curated-keeps',
    generationTriggered: false,
    briefProfile: profile,
    rule: 'One approved chassis owns the wireframe; design system, content, and imagery are replaced.',
    scoringBasis: directReference ? 'direct-reference' : 'site-type-only',
    options,
    optionOffset: safeOffset,
    pageSize: CHASSIS_PREVIEW_PAGE_SIZE,
    totalOptions: tied.length,
    bestScore,
    hasPrevious: safeOffset > 0,
    hasMore: safeOffset + options.length < tied.length,
    warnings: [
      ...(!profile.productTypes.length ? ['Site type was not explicit; all kept chassis need visual verification.'] : []),
      ...(bestScore === 0 ? ['No kept reference matched the requested site type; these fallback options need visual verification.'] : []),
    ],
  };
  preview.previewHash = previewHashFor(preview);

  return { ok: true, preview };
}

function finalizePlan(preview, selectedReferenceId) {
  const selected = preview.options.find((option) => option.id === selectedReferenceId);
  if (!selected) return { ok: false, error: 'invalid_preview_selection' };
  const { composition, ...selectedReference } = selected;

  return {
    ok: true,
    plan: {
      schemaVersion: 3,
      plannerContractVersion: CHASSIS_PLANNER_CONTRACT_VERSION,
      mode: 'shadow',
      strategy: 'single-chassis',
      selectionMode: preview.selectionMode,
      generationTriggered: false,
      briefProfile: preview.briefProfile,
      rule: preview.rule,
      scoringBasis: preview.scoringBasis,
      selectedReferences: [selectedReference],
      composition,
      previewHash: preview.previewHash,
      warnings: preview.warnings,
    },
  };
}

export function approveReferencePlanPreview({ brief, candidates, optionOffset = 0, previewHash, selectedReferenceId }) {
  const result = createReferencePlanPreview({ brief, candidates, optionOffset });
  if (!result.ok) return result;
  if (!previewHash || previewHash !== result.preview.previewHash) return { ok: false, error: 'preview_stale' };
  return finalizePlan(result.preview, selectedReferenceId);
}

export function createReferencePlan({ brief, candidates }) {
  const result = createReferencePlanPreview({ brief, candidates });
  if (!result.ok) return result;
  return finalizePlan(result.preview, result.preview.options[0].id);
}
