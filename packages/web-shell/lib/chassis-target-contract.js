import { createHash } from 'node:crypto';
import { createTransplantBlueprint } from './chassis-transplant.js';
import { inferTargetStrategy } from './chassis-target-strategy.js';

export const CHASSIS_TARGET_CONTRACT_VERSION = 2;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function clean(value, max = 6000) {
  return String(value || '').trim().slice(0, max);
}

function normalizeUrl(value) {
  let url;
  try { url = new URL(clean(value, 2048)); } catch { throw new Error('target_url_invalid'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('target_url_invalid');
  url.hash = '';
  return url.toString();
}

function normalizeAuthority(input = {}, project = null, evidence = {}) {
  const authorityType = clean(input.authorityType, 24);
  const brand = clean(input.brand, 160) || clean(evidence.brand, 160) || clean(project?.name, 160);
  if (!brand) throw new Error('target_brand_required');
  if (!['project', 'url', 'provided'].includes(authorityType)) throw new Error('invalid_authority_type');

  let authority;
  if (authorityType === 'project') {
    if (!clean(input.projectId, 120)) throw new Error('target_project_required');
    if (!project || String(project.id) !== clean(input.projectId, 120)) throw new Error('target_project_not_found');
    authority = { type: 'project', id: String(project.id), label: clean(project.name, 160) || 'Untitled project' };
  } else if (authorityType === 'url') {
    const url = normalizeUrl(input.url);
    authority = { type: 'url', url, label: new URL(url).hostname };
  } else {
    const label = clean(input.sourceLabel, 240);
    if (!label) throw new Error('provided_source_required');
    authority = { type: 'provided', label };
  }

  return {
    brand,
    authority,
    intent: clean(input.intent, 2000) || `Improve ${brand} while preserving its factual content and product identity.`,
    notes: clean(input.notes, 2000),
  };
}

function authoritySources(target) {
  if (target.authority.type === 'project') {
    const source = `project:${target.authority.id}`;
    return { contentSource: source, designSystemSource: source, mediaSource: source };
  }
  if (target.authority.type === 'url') {
    return { contentSource: target.authority.url, designSystemSource: target.authority.url, mediaSource: target.authority.url };
  }
  return {
    contentSource: `provided:${target.authority.label}`,
    designSystemSource: `provided:${target.authority.label}`,
    mediaSource: `provided:${target.authority.label}`,
  };
}

function derivedReadiness(evidence, strategy) {
  const content = Number(evidence?.counts?.visibleCharacters || 0) >= 40
    && Boolean(evidence?.headings?.length || evidence?.description);
  const designSystem = Boolean(evidence?.colors?.length || evidence?.fonts?.length || strategy?.suppliedPalette?.length);
  const media = strategy?.mediaPlan?.status === 'planned';
  return { content, designSystem, media };
}

function collectGaps(manifest, readiness) {
  const gaps = [];
  if (!readiness.content) gaps.push({ code: 'target-content-missing', label: 'No usable target copy was detected. Add an accessible source before approval.' });
  if (!readiness.designSystem) gaps.push({ code: 'target-design-system-missing', label: 'No usable identity tokens were detected. Add a palette, typography direction, or brand source.' });
  if (!readiness.media) gaps.push({ code: 'replacement-media-missing', label: 'Choose a target-safe media plan before approval.' });
  for (const gap of manifest.evidence?.gaps || []) {
    gaps.push({ code: `manifest-evidence:${gap}`, label: `Chassis evidence gap: ${gap}.` });
  }
  return gaps;
}

function sectionLedger(blueprint, manifest, strategy) {
  const portability = new Map((manifest.motion?.portability || []).map((item) => [item.id, item]));
  return blueprint.sections.map((section) => ({
    id: section.chassisSectionId,
    role: section.role,
    order: section.order,
    capacity: section.capacity,
    mediaBindings: section.mediaSlots.map((slot) => ({
      id: slot.id,
      role: slot.role || 'media',
      source: blueprint.target.mediaSource,
      status: strategy.mediaPlan.mode === 'target-media'
        ? 'ready-to-map'
        : strategy.mediaPlan.mode === 'original-people'
          ? 'planned-original'
          : strategy.mediaPlan.mode === 'graphic-identities'
            ? 'approved-graphic-substitute'
            : 'not-required',
    })),
    motionPortability: section.motionTracks.map((track) => ({
      id: track.id,
      driver: track.driver || 'unknown',
      ...(portability.get(track.id) || { portable: false, reason: 'Portability was not measured.' }),
    })),
    directive: section.directive,
  }));
}

function contractBody(contract) {
  const copy = { ...contract };
  delete copy.hash;
  delete copy.status;
  delete copy.approvedAt;
  return copy;
}

export function hashChassisTargetContract(contract) {
  return createHash('sha256').update(JSON.stringify(stable(contractBody(contract)))).digest('hex');
}

export function createChassisTargetContractPreview({ manifest, input = {}, project = null, evidence = {} } = {}) {
  const target = normalizeAuthority(input, project, evidence);
  const sources = authoritySources(target);
  const blueprint = createTransplantBlueprint({ manifest, target: { brand: target.brand, ...sources } });
  const mediaCount = blueprint.sections.reduce((sum, section) => sum + section.mediaSlots.length, 0);
  const motionCount = blueprint.sections.reduce((sum, section) => sum + section.motionTracks.length, 0);
  const strategy = inferTargetStrategy({
    prompt: target.intent,
    evidence,
    manifest,
    selections: input.strategySelections,
  });
  const readiness = derivedReadiness(evidence, strategy);
  target.readiness = readiness;
  const gaps = collectGaps(manifest, readiness);
  const contract = {
    schemaVersion: CHASSIS_TARGET_CONTRACT_VERSION,
    manifestHash: manifest.hash,
    target,
    targetEvidence: {
      hash: evidence.hash || null,
      sourceUrl: evidence.sourceUrl || target.authority.url || null,
      brand: evidence.brand || target.brand,
      title: evidence.title || '',
      description: evidence.description || '',
      language: evidence.language || null,
      headings: evidence.headings || [],
      callsToAction: evidence.callsToAction || [],
      colors: evidence.colors || [],
      fonts: evidence.fonts || [],
      logos: evidence.logos || [],
      counts: evidence.counts || { sections: 0, visibleCharacters: 0, media: 0 },
    },
    strategy,
    blueprint: {
      target: blueprint.target,
      directives: {
        ...blueprint.directives,
        adapt: [...blueprint.directives.adapt, ...strategy.directives],
      },
      acceptance: blueprint.acceptance,
    },
    guidance: {
      worthBorrowing: clean(manifest.guidance?.worthBorrowing, 2000),
      avoid: clean(manifest.guidance?.avoid, 2000),
    },
    ledger: sectionLedger(blueprint, manifest, strategy),
    summary: {
      sections: blueprint.sections.length,
      mediaSlots: mediaCount,
      motionTracks: motionCount,
    },
    gaps,
    approvable: gaps.length === 0,
    locks: { generationAuthorized: false, creditSpendAuthorized: false, canvasMutationAuthorized: false },
    status: 'preview',
  };
  contract.hash = hashChassisTargetContract(contract);
  return contract;
}

export function approveChassisTargetContract(contract, expectedHash) {
  if (!contract?.hash || contract.hash !== expectedHash || hashChassisTargetContract(contract) !== expectedHash) {
    throw new Error('target_contract_stale');
  }
  if (!contract.approvable || contract.gaps?.length) throw new Error('target_contract_blocked');
  return { ...contract, status: 'approved', approvedAt: new Date().toISOString() };
}
