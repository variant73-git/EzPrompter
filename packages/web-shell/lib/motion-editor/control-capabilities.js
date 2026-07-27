import {
  createStableControlId,
  parseControlProposal,
} from './control-manifest.js';

export const CONTROL_LADDER = Object.freeze({
  DIRECT: 'direct',
  KNOWN: 'known-library',
  DECLARATIVE: 'declarative-adapter',
  CUSTOM: 'custom-adapter',
  CODE: 'code-only',
});

const LADDER_ORDER = Object.freeze([
  CONTROL_LADDER.DIRECT,
  CONTROL_LADDER.KNOWN,
  CONTROL_LADDER.DECLARATIVE,
  CONTROL_LADDER.CUSTOM,
  CONTROL_LADDER.CODE,
]);

const KNOWN_ENGINES = new Set(['gsap', 'scrolltrigger', 'lottie', 'webflow']);

function safeId(value, fallback) {
  const normalized = String(value || fallback || 'control')
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalized || fallback || 'control';
}

function defaultSliderDomain(value) {
  const numeric = Number(value);
  const current = Number.isFinite(numeric) ? numeric : 1;
  const magnitude = Math.max(1, Math.abs(current));
  const min = current < 0 ? -magnitude * 2 : 0;
  const max = current > 0 ? magnitude * 2 : magnitude;
  const step = Math.max(0.01, (max - min) / 100);
  return { min, max, step };
}

function inferControlType(candidate) {
  if (candidate.controlType) return candidate.controlType;
  if (typeof candidate.currentValue === 'boolean') return 'toggle';
  if (candidate.property?.toLowerCase().includes('color')) return 'color';
  if (candidate.property?.toLowerCase().includes('easing')) return 'easing';
  return 'slider-number';
}

function inferUnit(controlType, property) {
  if (controlType === 'toggle') return 'boolean';
  if (controlType === 'color') return 'color';
  if (controlType === 'easing') return 'easing';
  const normalized = String(property || '').toLowerCase();
  if (normalized.includes('duration') || normalized.includes('delay')) return 'ms';
  if (normalized.includes('rotate') || normalized.includes('angle')) return 'degrees';
  if (normalized.includes('percent') || normalized.includes('progress')) return 'percent';
  if (normalized.includes('distance') || normalized.endsWith('.x') || normalized.endsWith('.y')) return 'px';
  return 'number';
}

function candidateDomain(candidate, controlType, currentValue) {
  if (candidate.domain) return candidate.domain;
  if (controlType === 'toggle') return {};
  if (controlType === 'select') return { options: candidate.options || [{ label: 'First', value: 'first' }, { label: 'Second', value: 'second' }] };
  if (controlType === 'color') {
    const value = /^#[0-9a-f]{6}$/i.test(String(currentValue || '')) ? String(currentValue).toLowerCase() : '#2966ea';
    return { options: [value] };
  }
  if (controlType === 'easing') return { options: [String(currentValue || 'ease')] };
  return defaultSliderDomain(currentValue);
}

function normalizeScalar(candidate, controlType, domain) {
  let value = candidate.currentValue ?? candidate.value;
  if (controlType === 'toggle') value = typeof value === 'boolean' ? value : false;
  else if (controlType === 'select') value = value ?? domain.options[0].value;
  else if (controlType === 'color') value = /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value).toLowerCase() : domain.options[0];
  else if (controlType === 'easing') value = value ?? domain.options[0];
  else {
    value = Number(value);
    if (!Number.isFinite(value)) value = Math.max(domain.min, Math.min(domain.max, 1));
  }
  return value;
}

function normalizeBinding(candidate, ladder) {
  if (candidate.binding && typeof candidate.binding === 'object') return candidate.binding;
  const property = safeId(candidate.property, 'timing.duration');
  if (ladder === CONTROL_LADDER.KNOWN) {
    return { kind: 'known-runtime', engine: safeId(candidate.engine, 'gsap'), property };
  }
  if (ladder === CONTROL_LADDER.DECLARATIVE) {
    return { kind: 'dom-attribute', attribute: `data-${safeId(candidate.id, 'motion')}` };
  }
  if (ladder === CONTROL_LADDER.CUSTOM) {
    return { kind: 'custom-capability', capability: 'motion.scalar', property };
  }
  return { kind: 'typed-command', command: 'motion.set', property };
}

export function classifyControlCandidate(candidate = {}, detectedEngines = []) {
  const kind = String(candidate.binding?.kind || candidate.kind || '').toLowerCase();
  const engine = String(candidate.binding?.engine || candidate.engine || candidate.evidence?.engine || '').toLowerCase();
  const detected = new Set((detectedEngines || []).map((value) => String(value).toLowerCase()));
  if (kind === 'typed-command' || kind === 'css-custom-property') return CONTROL_LADDER.DIRECT;
  if (kind === 'known-runtime' && (KNOWN_ENGINES.has(engine) || detected.has(engine))) return CONTROL_LADDER.KNOWN;
  if (kind === 'dom-attribute') return CONTROL_LADDER.DECLARATIVE;
  if (kind === 'custom-capability') return CONTROL_LADDER.CUSTOM;
  return CONTROL_LADDER.CODE;
}

export function normalizeControlCandidate(candidate, {
  ladder = classifyControlCandidate(candidate),
  detectedEngines = [],
} = {}) {
  const id = safeId(candidate.id, 'motion-control');
  const property = safeId(candidate.property || candidate.binding?.property, 'timing.duration');
  const engine = safeId(candidate.engine || candidate.binding?.engine || candidate.evidence?.engine, detectedEngines[0] || 'runtime');
  const controlType = inferControlType(candidate);
  const provisionalDomain = candidateDomain(candidate, controlType, candidate.currentValue ?? candidate.value);
  const currentValue = normalizeScalar(candidate, controlType, provisionalDomain);
  const domain = candidateDomain(candidate, controlType, currentValue);
  const originalValue = candidate.originalValue ?? currentValue;
  const semanticTargetId = safeId(candidate.semanticTargetId || candidate.target?.semanticTargetId, id);
  const elementId = safeId(candidate.elementId || candidate.target?.elementId, `${semanticTargetId}-element`);
  const motionId = safeId(candidate.motionId || candidate.target?.motionId, `${semanticTargetId}-motion`);
  const binding = normalizeBinding(candidate, ladder);
  const label = String(candidate.label || id.replace(/[._:-]+/g, ' ')).trim().slice(0, 48) || 'Motion control';
  return {
    ...candidate,
    ladder,
    scope: candidate.scope || 'animation',
    label,
    description: String(candidate.description || `Controls ${label.toLowerCase()}.`).trim().slice(0, 160),
    controlType,
    unit: candidate.unit || inferUnit(controlType, property),
    currentValue,
    originalValue,
    targets: Array.isArray(candidate.targets) && candidate.targets.length
      ? candidate.targets
      : [{ semanticTargetId, elementId, motionId, property }],
    binding,
    domain,
    teardown: candidate.teardown || (binding.kind === 'custom-capability'
      ? { required: true, capability: `${binding.capability}.release` }
      : { required: false, capability: null }),
    limits: candidate.limits || { executionMs: 500, mutationCount: 12, targetCount: 1, network: false },
    provenance: candidate.provenance || { source: 'reconstruction', engine, decisionCode: `${ladder.replaceAll('-', '_')}_candidate` },
  };
}

function proposalFields(candidate) {
  return {
    scope: candidate.scope,
    label: candidate.label,
    description: candidate.description,
    controlType: candidate.controlType,
    unit: candidate.unit,
    currentValue: candidate.currentValue,
    originalValue: candidate.originalValue,
    targets: candidate.targets,
    binding: candidate.binding,
    domain: candidate.domain,
    teardown: candidate.teardown,
    limits: candidate.limits,
  };
}

export function classifyControlCandidates({
  bundleId,
  runtimeFingerprint,
  detectedEngines = [],
  candidates = [],
} = {}) {
  return candidates.map((candidate, index) => {
    const ladder = classifyControlCandidate(candidate, detectedEngines);
    return {
      ...normalizeControlCandidate(candidate, { ladder, detectedEngines }),
      bundleId,
      runtimeFingerprint,
      candidateIndex: index,
    };
  }).sort((left, right) => (
    LADDER_ORDER.indexOf(left.ladder) - LADDER_ORDER.indexOf(right.ladder)
    || left.candidateIndex - right.candidateIndex
  ));
}

export function needsCustomGeneration(classifiedControls, { target = 3 } = {}) {
  const useful = (classifiedControls || []).filter((candidate) => candidate.ladder !== CONTROL_LADDER.CODE);
  return (classifiedControls || []).length === 0 || useful.length < target;
}

function valuesEqual(left, right) {
  if (Object.is(left, right)) return true;
  try { return JSON.stringify(left) === JSON.stringify(right); } catch { return false; }
}

function uniqueIdentifiers(values) {
  return [...new Set((values || []).filter((value) => typeof value === 'string' && value))];
}

export function evaluateControlSemanticPromise({ control = {}, evidence = {} } = {}) {
  const declaredTargetIds = uniqueIdentifiers([
    ...(control.targets || []).map((target) => target?.semanticTargetId),
    ...(evidence.declaredTargetIds || []),
  ]);
  const affectedTargetIds = new Set(uniqueIdentifiers(evidence.affectedTargetIds));
  const unhandledTargetIds = uniqueIdentifiers(evidence.unhandledTargetIds);
  const requiredEngines = uniqueIdentifiers([
    ...(control.semanticPromise?.requiredEngines || []),
    ...(evidence.declaredEngines || []),
  ]);
  const affectedEngines = new Set(uniqueIdentifiers(evidence.affectedEngines));
  const unhandledEngines = uniqueIdentifiers(evidence.unhandledEngines);
  const missingTargetIds = uniqueIdentifiers([
    ...declaredTargetIds.filter((targetId) => !affectedTargetIds.has(targetId)),
    ...unhandledTargetIds,
  ]);
  const missingEngines = uniqueIdentifiers([
    ...requiredEngines.filter((engine) => !affectedEngines.has(engine)),
    ...unhandledEngines,
  ]);
  const requiresCompleteCoverage = control.scope === 'site';
  return {
    satisfied: !requiresCompleteCoverage || (missingTargetIds.length === 0 && missingEngines.length === 0),
    declaredTargetIds,
    affectedTargetIds: [...affectedTargetIds],
    missingTargetIds,
    requiredEngines,
    affectedEngines: [...affectedEngines],
    missingEngines,
  };
}

function hasVisibleEffectEvidence(result, expectsEffect) {
  if (!expectsEffect) return true;
  return Boolean(
    result?.visualOracle?.changed === true
    || result?.computedStateEvidence?.changed === true
    || result?.screenshotEvidence?.changed === true,
  );
}

function hasRestoreEvidence(result) {
  return Boolean(
    result?.restoreEvidence?.restored === true
    || result?.computedStateEvidence?.restored === true
    || result?.screenshotEvidence?.restored === true,
  );
}

function rejected(code, stage, details = {}) {
  return {
    accepted: false,
    code,
    stage,
    diagnostics: {
      code,
      stage,
      ...(Number.isFinite(details.mutations) ? { mutations: details.mutations } : {}),
      ...(Array.isArray(details.outsideTargets) ? { outsideTargetCount: details.outsideTargets.length } : {}),
    },
  };
}

function validationValues(proposal) {
  if (proposal.controlType === 'slider-number') {
    const { min, max } = proposal.domain;
    return [...new Set([min, min + (max - min) / 2, max])];
  }
  if (proposal.controlType === 'select') return proposal.domain.options.map((option) => option.value);
  if (proposal.controlType === 'color' || proposal.controlType === 'easing') return [...proposal.domain.options];
  return [!proposal.currentValue];
}

export function createRuntimeControlValidator({
  transport,
  now = () => new Date(),
  requireVisibleEvidence = false,
  requireSemanticCoverage = false,
} = {}) {
  if (typeof transport !== 'function') throw new TypeError('A runtime validation transport is required');
  return async function validate(candidate, { bundleId, runtimeFingerprint, signal } = {}) {
    if (candidate.runtimeFingerprint && candidate.runtimeFingerprint !== runtimeFingerprint) {
      return rejected('fingerprint_mismatch', 'fingerprint');
    }
    let normalized;
    let proposal;
    try {
      normalized = normalizeControlCandidate(candidate, {
        ladder: candidate.ladder || classifyControlCandidate(candidate),
      });
      proposal = parseControlProposal(proposalFields(normalized));
    } catch {
      return rejected('schema_invalid', 'schema');
    }
    const context = {
      bundleId,
      runtimeFingerprint,
      targets: proposal.targets,
      binding: proposal.binding,
      limits: proposal.limits,
      validationValues: validationValues(proposal),
      signal,
    };
    const read = await transport('read', proposal, context).catch(() => ({ ok: false }));
    if (!read?.ok || read.before === undefined) return rejected(read?.code || 'read_failed', 'read');
    let visualOracleUsed = false;
    for (const validationValue of context.validationValues) {
      const valueContext = { ...context, before: read.before, value: validationValue };
      const applied = await transport('apply', proposal, valueContext).catch(() => ({ ok: false }));
      if (!applied?.ok) return rejected(applied?.code || 'apply_failed', 'apply');
      if (applied.outsideTargets?.length) return rejected('scope_escape', 'apply', applied);
      if (applied.networkAccess || applied.layoutBreakage || applied.mutations > proposal.limits.mutationCount) {
        return rejected(applied.layoutBreakage ? 'layout_breakage' : applied.networkAccess ? 'network_access' : 'mutation_limit', 'apply', applied);
      }
      const expectsEffect = !valuesEqual(validationValue, read.before);
      if (expectsEffect && !applied.effect?.changed && !applied.visualOracle?.changed) return rejected('no_effect', 'effect');
      if (requireVisibleEvidence && !hasVisibleEffectEvidence(applied, expectsEffect)) {
        return rejected('visible_evidence_missing', 'effect');
      }
      if (requireSemanticCoverage) {
        const semantic = evaluateControlSemanticPromise({ control: proposal, evidence: applied.semanticCoverage });
        if (!semantic.satisfied) return rejected('semantic_promise_incomplete', 'effect');
      }
      visualOracleUsed ||= Boolean(applied.visualOracle);
      const restored = await transport('restore', proposal, { ...valueContext, applied }).catch(() => ({ ok: false }));
      if (!restored?.ok || restored.restored !== true || !valuesEqual(restored.value, read.before)) return rejected('restore_failed', 'restore');
      if (requireVisibleEvidence && !hasRestoreEvidence(restored)) {
        return rejected('restore_evidence_missing', 'restore');
      }
      const reapplied = await transport('reapply', proposal, valueContext).catch(() => ({ ok: false }));
      if (!reapplied?.ok
        || (expectsEffect && !reapplied.effect?.changed && !reapplied.visualOracle?.changed)
        || !valuesEqual(reapplied.value, applied.value)) return rejected('non_deterministic', 'deterministic');
      if (requireVisibleEvidence && !hasVisibleEffectEvidence(reapplied, expectsEffect)) {
        return rejected('visible_evidence_missing', 'deterministic');
      }
      if (requireSemanticCoverage) {
        const semantic = evaluateControlSemanticPromise({ control: proposal, evidence: reapplied.semanticCoverage });
        if (!semantic.satisfied) return rejected('semantic_promise_incomplete', 'deterministic');
      }
      const finalRestore = await transport('final-restore', proposal, { ...valueContext, applied: reapplied }).catch(() => ({ ok: false }));
      if (!finalRestore?.ok || finalRestore.restored !== true || !valuesEqual(finalRestore.value, read.before)) return rejected('restore_failed', 'restore');
      if (requireVisibleEvidence && !hasRestoreEvidence(finalRestore)) {
        return rejected('restore_evidence_missing', 'restore');
      }
      const leaks = finalRestore.leaks || {};
      if (Object.values(leaks).some((value) => Number(value) > 0)) return rejected('teardown_leak', 'teardown');
    }
    const timestamp = now();
    const validatedAt = timestamp instanceof Date ? timestamp.toISOString() : new Date(timestamp).toISOString();
    const ladder = normalized.ladder === CONTROL_LADDER.CODE ? CONTROL_LADDER.CUSTOM : normalized.ladder;
    const ready = {
      ...proposal,
      id: candidate.id && /^control-[0-9a-f]{24}$/.test(candidate.id)
        ? candidate.id
        : createStableControlId({ ...proposal, ladder }),
      ladder,
      bundleId,
      runtimeFingerprint,
      compatibleLineage: candidate.compatibleLineage || [{ bundleId, runtimeFingerprint }],
      validation: {
        schema: 'passed', read: 'passed', apply: 'passed', effect: 'passed',
        restore: 'passed', deterministic: 'passed', teardown: 'passed', fingerprint: 'passed',
        ...(visualOracleUsed ? { visualOracle: 'passed' } : {}),
        validatedAt,
      },
      provenance: normalized.provenance,
      status: 'ready',
    };
    return { accepted: true, control: ready };
  };
}

export { LADDER_ORDER as CONTROL_LADDER_ORDER };
