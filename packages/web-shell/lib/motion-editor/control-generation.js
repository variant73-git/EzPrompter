import {
  CONTROL_PROPOSAL_JSON_SCHEMA,
  createControlManifest,
  parseControlProposal,
  parseReadyControl,
} from './control-manifest.js';
import {
  CONTROL_LADDER,
  classifyControlCandidates,
  createRuntimeControlValidator,
  needsCustomGeneration,
  normalizeControlCandidate,
} from './control-capabilities.js';

export const CONTROL_GENERATION_MODEL = 'gpt-5.6-terra';
export const CONTROL_GENERATION_PROVIDER_CEILING_USD = 0.25;
export const CONTROL_GENERATION_MAX_OUTPUT_TOKENS = 4096;
export const CONTROL_GENERATION_MAX_EVIDENCE_BYTES = 32 * 1024;

const MODEL_RATES_PER_MILLION = Object.freeze({
  input: 2.5,
  cachedInput: 0.25,
  cacheWrite: 3.125,
  output: 15,
});

class ControlGenerationError extends Error {
  constructor(code, message = code, details = {}) {
    super(message);
    this.name = 'ControlGenerationError';
    this.code = code;
    Object.assign(this, details);
  }
}

function safeIdentifier(value, fallback = 'unknown') {
  const normalized = String(value || fallback).replace(/[^a-z0-9._:-]+/gi, '-').slice(0, 96);
  return normalized || fallback;
}

function safeStrings(values, limit = 24) {
  return [...new Set((Array.isArray(values) ? values : [])
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.trim().slice(0, 96)))].slice(0, limit);
}

function minimalMotion(motion) {
  if (!motion || typeof motion !== 'object') return null;
  return {
    id: safeIdentifier(motion.id || motion.motionId),
    semanticTargetId: safeIdentifier(motion.semanticTargetId || motion.targetId || motion.elementId, 'target'),
    elementId: safeIdentifier(motion.elementId, 'element'),
    engine: safeIdentifier(motion.engine, 'unknown'),
    driver: safeIdentifier(typeof motion.driver === 'string' ? motion.driver : motion.driver?.type, 'time'),
    properties: safeStrings(motion.properties || motion.tracks?.map((track) => track.property), 24),
    capabilities: safeStrings(
      Array.isArray(motion.capabilities)
        ? motion.capabilities
        : Object.entries(motion.capabilities || {}).filter(([, enabled]) => enabled).map(([name]) => name),
      24,
    ),
  };
}

function jsonBytes(value) {
  const serialized = JSON.stringify(value);
  if (typeof TextEncoder === 'function') return new TextEncoder().encode(serialized).byteLength;
  return serialized.length;
}

export function buildMinimalMotionEvidence(input = {}) {
  const evidence = {
    schemaVersion: 1,
    engines: safeStrings(input.engines || input.detectedEngines, 16).map((engine) => engine.toLowerCase()),
    motions: (Array.isArray(input.motions) ? input.motions : []).slice(0, 120).map(minimalMotion).filter(Boolean),
    declarativeSurfaces: (Array.isArray(input.declarativeSurfaces) ? input.declarativeSurfaces : []).slice(0, 120).map((surface) => ({
      semanticTargetId: safeIdentifier(surface?.semanticTargetId, 'target'),
      elementId: safeIdentifier(surface?.elementId, 'element'),
      kind: safeIdentifier(surface?.kind, 'unknown'),
      property: safeIdentifier(surface?.property, 'unknown'),
    })),
  };
  while (evidence.motions.length && jsonBytes(evidence) >= CONTROL_GENERATION_MAX_EVIDENCE_BYTES) evidence.motions.pop();
  while (evidence.declarativeSurfaces.length && jsonBytes(evidence) >= CONTROL_GENERATION_MAX_EVIDENCE_BYTES) evidence.declarativeSurfaces.pop();
  if (jsonBytes(evidence) >= CONTROL_GENERATION_MAX_EVIDENCE_BYTES) {
    throw new ControlGenerationError('evidence_too_large', 'Minimal motion evidence exceeds the provider boundary.');
  }
  return evidence;
}

function buildMinimalGaps(gaps = []) {
  return (Array.isArray(gaps) ? gaps : []).slice(0, 80).map((gap) => ({
    semanticTargetId: safeIdentifier(gap?.semanticTargetId || gap?.targetId, 'target'),
    elementId: safeIdentifier(gap?.elementId, 'element'),
    motionId: safeIdentifier(gap?.motionId, 'motion'),
    properties: safeStrings(gap?.properties || (gap?.property ? [gap.property] : []), 16),
    engine: safeIdentifier(gap?.engine, 'unknown'),
  }));
}

function providerCostUsd(usage = {}) {
  const input = Math.max(0, Number(usage.input_tokens) || 0);
  const output = Math.max(0, Number(usage.output_tokens) || 0);
  const cached = Math.min(input, Math.max(0, Number(usage.input_tokens_details?.cached_tokens) || 0));
  const cacheWrite = Math.max(0, Number(usage.input_tokens_details?.cache_write_tokens) || 0);
  const fresh = Math.max(0, input - cached);
  return (fresh * MODEL_RATES_PER_MILLION.input
    + cached * MODEL_RATES_PER_MILLION.cachedInput
    + cacheWrite * MODEL_RATES_PER_MILLION.cacheWrite
    + output * MODEL_RATES_PER_MILLION.output) / 1_000_000;
}

function normalizeUsage(response, costUsd) {
  const usage = response?.usage || {};
  return {
    provider: 'openai',
    model: CONTROL_GENERATION_MODEL,
    inputTokens: Math.max(0, Number(usage.input_tokens) || 0),
    outputTokens: Math.max(0, Number(usage.output_tokens) || 0),
    cachedInputTokens: Math.max(0, Number(usage.input_tokens_details?.cached_tokens) || 0),
    cacheWriteTokens: Math.max(0, Number(usage.input_tokens_details?.cache_write_tokens) || 0),
    costUsd: Number(costUsd.toFixed(8)),
  };
}

function outputText(response) {
  if (typeof response?.output_text === 'string') return response.output_text;
  for (const output of response?.output || []) {
    for (const content of output?.content || []) {
      if (content?.type === 'refusal') throw new ControlGenerationError('provider_refusal');
      if (content?.type === 'output_text' && typeof content.text === 'string') return content.text;
    }
  }
  throw new ControlGenerationError('provider_output_missing');
}

function stripStructuredNulls(value, key = null) {
  if (Array.isArray(value)) return value.map((child) => stripStructuredNulls(child));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [childKey, child] of Object.entries(value)) {
    if (child == null && (key === 'binding' || key === 'domain')) continue;
    out[childKey] = stripStructuredNulls(child, childKey);
  }
  return out;
}

function parseProposalResponse(response) {
  let decoded;
  try { decoded = JSON.parse(outputText(response)); }
  catch (error) {
    if (error instanceof ControlGenerationError) throw error;
    throw new ControlGenerationError('structured_output_invalid');
  }
  if (!decoded || typeof decoded !== 'object' || !Array.isArray(decoded.controls)
    || decoded.controls.length < 1 || decoded.controls.length > 5) {
    throw new ControlGenerationError('structured_output_invalid');
  }
  try {
    return decoded.controls.map((control) => parseControlProposal(stripStructuredNulls(control)));
  } catch {
    throw new ControlGenerationError('structured_output_invalid');
  }
}

function createAbortSignal(timeoutMs, parentSignal = null) {
  const controller = new AbortController();
  const abort = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) abort();
  else parentSignal?.addEventListener?.('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('provider_timeout')), Math.max(1, timeoutMs));
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      parentSignal?.removeEventListener?.('abort', abort);
    },
  };
}

function requestBody({ evidence, remainingGaps, repair = false }) {
  const instructions = [
    'Propose only useful motion controls for the declared targets and properties.',
    'Return about three controls and never more than five.',
    'Use only the supplied narrow binding registry. Never return code, selectors, scripts, free text fields, JSON editors, network access, or undeclared targets.',
    'Default to animation scope. Use group or site only when every target is explicitly declared.',
    'Ranges and options must be curated, finite, reversible, and safe.',
    repair ? 'The previous proposal did not satisfy the strict local contract. Produce a fresh proposal that follows every constraint.' : '',
  ].filter(Boolean).join(' ');
  return {
    model: CONTROL_GENERATION_MODEL,
    store: false,
    reasoning: { effort: 'medium' },
    max_output_tokens: CONTROL_GENERATION_MAX_OUTPUT_TOKENS,
    instructions,
    input: [{
      role: 'user',
      content: [{
        type: 'input_text',
        text: JSON.stringify({ evidence, remainingGaps }),
      }],
    }],
    text: {
      format: {
        type: 'json_schema',
        name: 'uncraft_motion_controls',
        strict: true,
        schema: CONTROL_PROPOSAL_JSON_SCHEMA,
      },
    },
  };
}

async function callProvider({ client, evidence, remainingGaps, timeoutMs, signal, repair }) {
  const timed = createAbortSignal(timeoutMs, signal);
  try {
    return await client.responses.create(requestBody({ evidence, remainingGaps, repair }), { signal: timed.signal });
  } catch (error) {
    if (timed.signal.aborted || error?.name === 'AbortError') throw new ControlGenerationError('provider_timeout');
    if (error instanceof ControlGenerationError) throw error;
    throw new ControlGenerationError('provider_failed');
  } finally {
    timed.dispose();
  }
}

export async function generateControlProposals({
  client,
  evidence = {},
  remainingGaps = [],
  timeoutMs = 45_000,
  repairTimeoutMs = 25_000,
  providerCostCeilingUsd = CONTROL_GENERATION_PROVIDER_CEILING_USD,
  signal = null,
  zdrApproved = false,
} = {}) {
  if (!client?.responses?.create) throw new ControlGenerationError('provider_unavailable');
  if ((evidence.privateCapture || evidence.authenticatedCapture || evidence.private) && !zdrApproved) {
    throw new ControlGenerationError('zdr_required');
  }
  const minimalEvidence = buildMinimalMotionEvidence(evidence);
  const minimalGaps = buildMinimalGaps(remainingGaps);
  const usages = [];
  let cumulativeCostUsd = 0;
  let repaired = false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await callProvider({
      client,
      evidence: minimalEvidence,
      remainingGaps: minimalGaps,
      timeoutMs: attempt === 0 ? timeoutMs : repairTimeoutMs,
      signal,
      repair: attempt === 1,
    });
    const costUsd = providerCostUsd(response?.usage);
    cumulativeCostUsd += costUsd;
    usages.push(normalizeUsage(response, costUsd));
    if (cumulativeCostUsd > providerCostCeilingUsd) {
      throw new ControlGenerationError('provider_cost_ceiling', 'Custom control generation exceeded its provider-cost ceiling.', {
        usage: usages,
        costUsd: cumulativeCostUsd,
      });
    }
    try {
      const proposals = parseProposalResponse(response);
      return {
        proposals,
        repaired,
        usage: usages,
        costUsd: Number(cumulativeCostUsd.toFixed(8)),
      };
    } catch (error) {
      if (attempt === 1 || !['structured_output_invalid', 'provider_output_missing'].includes(error?.code)) throw error;
      repaired = true;
    }
  }
  throw new ControlGenerationError('structured_output_invalid');
}

function sanitizedDiagnostic(candidate, result) {
  return {
    candidateId: safeIdentifier(candidate?.id || candidate?.label, 'candidate'),
    ladder: candidate?.ladder || CONTROL_LADDER.CUSTOM,
    code: safeIdentifier(result?.code, 'validation_failed'),
    stage: safeIdentifier(result?.stage, 'validation'),
  };
}

export async function generateValidatedControlManifest({
  bundleId,
  runtimeFingerprint,
  detectedEngines = [],
  candidates = [],
  evidence = {},
  remainingGaps = null,
  client = null,
  validateCandidate,
  signal = null,
  onUsage = null,
  zdrApproved = false,
} = {}) {
  if (typeof validateCandidate !== 'function') throw new TypeError('A control candidate validator is required');
  const classified = classifyControlCandidates({ bundleId, runtimeFingerprint, detectedEngines, candidates });
  const diagnostics = [];
  const accepted = [];

  for (const candidate of classified.filter((item) => item.ladder !== CONTROL_LADDER.CODE)) {
    const result = await validateCandidate(candidate, { bundleId, runtimeFingerprint, signal });
    if (result?.accepted && result.control) accepted.push(result.control);
    else diagnostics.push(sanitizedDiagnostic(candidate, result));
    if (accepted.length >= 5) break;
  }

  let provider = null;
  if (accepted.length < 3 && needsCustomGeneration(classified) && client) {
    const generation = await generateControlProposals({
      client,
      evidence: { ...evidence, engines: evidence.engines || detectedEngines },
      remainingGaps: remainingGaps || classified.filter((item) => item.ladder === CONTROL_LADDER.CODE),
      signal,
      zdrApproved,
    });
    provider = {
      provider: 'openai',
      model: CONTROL_GENERATION_MODEL,
      repaired: generation.repaired,
      usage: generation.usage,
      costUsd: generation.costUsd,
    };
    for (const usage of generation.usage) onUsage?.(usage);
    for (const proposal of generation.proposals) {
      if (accepted.length >= 5) break;
      const candidate = normalizeControlCandidate({
        ...proposal,
        ladder: CONTROL_LADDER.CUSTOM,
        provenance: { source: 'model', engine: detectedEngines[0] || 'custom', decisionCode: 'custom_validated' },
      }, { ladder: CONTROL_LADDER.CUSTOM, detectedEngines });
      const result = await validateCandidate(candidate, { bundleId, runtimeFingerprint, signal });
      if (result?.accepted && result.control) accepted.push(result.control);
      else diagnostics.push(sanitizedDiagnostic(candidate, result));
    }
  }

  const ready = [];
  for (const control of accepted) {
    try { ready.push(parseReadyControl(control, { bundleId, runtimeFingerprint })); }
    catch { diagnostics.push(sanitizedDiagnostic(control, { code: 'promotion_invalid', stage: 'schema' })); }
  }
  const manifest = createControlManifest({ bundleId, runtimeFingerprint, controls: ready });
  return { manifest, provider, diagnostics };
}

export function createRemoteControlValidationTransport({
  url,
  secret,
  fetcher = (...args) => globalThis.fetch(...args),
} = {}) {
  if (typeof url !== 'string' || !url) throw new ControlGenerationError('validator_unavailable');
  if (typeof secret !== 'string' || !secret) throw new ControlGenerationError('validator_unavailable');
  return async (operation, proposal, context = {}) => {
    const response = await fetcher(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${secret}`,
      },
      cache: 'no-store',
      signal: context.signal,
      body: JSON.stringify({
        schemaVersion: 1,
        operation,
        bundleId: context.bundleId,
        runtimeFingerprint: context.runtimeFingerprint,
        proposal,
        validationValues: context.validationValues,
        before: context.before,
        value: context.value,
        applied: context.applied ? {
          value: context.applied.value,
          effect: context.applied.effect,
        } : null,
      }),
    });
    if (!response.ok) return { ok: false, code: 'validator_failed' };
    const body = await response.json().catch(() => null);
    return body && typeof body === 'object' ? body : { ok: false, code: 'validator_failed' };
  };
}

async function defaultOpenAIClientFactory({ apiKey }) {
  const { default: OpenAI } = await import('openai');
  return new OpenAI({ apiKey, maxRetries: 0, timeout: 50_000 });
}

export async function generateControlsForReconstruction({
  descriptor,
  reconstructionOutput = {},
  signal = null,
  apiKey = process.env.OPENAI_API_KEY,
  zdrApproved = process.env.OPENAI_ZERO_DATA_RETENTION_APPROVED === 'true',
  clientFactory = defaultOpenAIClientFactory,
  validationTransport = reconstructionOutput.controlValidationTransport || null,
  validateCandidate = reconstructionOutput.validateControlCandidate || null,
  onUsage = null,
} = {}) {
  if (!descriptor?.bundleId || !descriptor?.runtimeFingerprint) {
    throw new ControlGenerationError('native_descriptor_invalid');
  }
  const capabilities = descriptor.reconstructionCapabilities || {};
  const candidates = Array.isArray(capabilities.candidateControls) ? capabilities.candidateControls : [];
  const detectedEngines = Array.isArray(capabilities.detectedEngines) ? capabilities.detectedEngines : [];
  const classified = classifyControlCandidates({
    bundleId: descriptor.bundleId,
    runtimeFingerprint: descriptor.runtimeFingerprint,
    detectedEngines,
    candidates,
  });
  const privateCapture = Boolean(
    reconstructionOutput.privateCapture
    || reconstructionOutput.authenticatedCapture
    || reconstructionOutput.motionEvidence?.privateCapture
    || reconstructionOutput.motionEvidence?.authenticatedCapture,
  );
  const canUseProvider = !privateCapture || zdrApproved;
  const providerNeeded = needsCustomGeneration(classified);
  let client = null;
  if (providerNeeded && canUseProvider) {
    if (!apiKey) throw new ControlGenerationError('provider_unavailable');
    client = await clientFactory({ apiKey });
  }
  const validator = typeof validateCandidate === 'function'
    ? validateCandidate
    : validationTransport
      ? createRuntimeControlValidator({ transport: validationTransport })
      : null;
  if (!validator) throw new ControlGenerationError('validator_unavailable');
  return generateValidatedControlManifest({
    bundleId: descriptor.bundleId,
    runtimeFingerprint: descriptor.runtimeFingerprint,
    detectedEngines,
    candidates,
    evidence: {
      ...(reconstructionOutput.motionEvidence || {}),
      engines: detectedEngines,
      privateCapture,
      authenticatedCapture: Boolean(reconstructionOutput.authenticatedCapture),
    },
    client,
    validateCandidate: validator,
    signal,
    onUsage,
    zdrApproved,
  });
}

export { ControlGenerationError };
