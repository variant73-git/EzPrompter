import { createHash, randomUUID } from 'node:crypto';
import {
  createRuntimeControlValidator,
} from './control-capabilities.js';
import {
  RECOVERY_ACTIONS,
  createRecoveryPolicy,
} from './recovery-policy.js';
import { sanitizeMotionDiagnosticEvent } from './diagnostics.js';

export const MOTION_SMOKE_SCHEMA_VERSION = 1;

export const REQUIRED_SMOKE_FIXTURE_CLASSES = Object.freeze([
  'plain-css-transition',
  'css-keyframes-finite',
  'css-keyframes-infinite',
  'gsap-timeline',
  'gsap-tween',
  'scrolltrigger-scrub',
  'scrolltrigger-pin',
  'scrolltrigger-entrance',
  'waapi',
  'mixed-engine',
  'transform-matrix-skew-perspective',
  'responsive-computed',
  'partially-offscreen',
  'runtime-reload',
  'stale-binding',
]);

const DEVICE_IDS = new Set(['desktop', 'tablet', 'mobile']);
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function smokeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export function fingerprintSmokeFixture(fixture) {
  if (!isPlainObject(fixture)) throw smokeError('invalid_smoke_fixture', 'A smoke fixture is required.');
  return digest({
    id: fixture.id,
    kind: fixture.kind,
    fixtureClasses: fixture.fixtureClasses,
    producerFamily: fixture.producerFamily,
    runtimeFamily: fixture.runtimeFamily,
    siteClass: fixture.siteClass,
    offline: fixture.offline === true,
    bundleId: fixture.bundleId,
    runtimeFingerprint: fixture.runtimeFingerprint,
    buildFingerprint: fixture.buildFingerprint,
  });
}

function validIdentifier(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9._:-]{0,95}$/i.test(value);
}

function validateDevice(device) {
  return isPlainObject(device)
    && DEVICE_IDS.has(device.id)
    && Number.isSafeInteger(device.width) && device.width > 0 && device.width <= 8192
    && Number.isSafeInteger(device.height) && device.height > 0 && device.height <= 8192;
}

function familyKey(value) {
  return `${value.producer}:${value.runtime}`;
}

export function validateSmokeMatrix(input) {
  if (!isPlainObject(input) || input.schemaVersion !== MOTION_SMOKE_SCHEMA_VERSION) {
    throw smokeError('invalid_smoke_matrix', 'Smoke matrix schema version is invalid.');
  }
  if (!validIdentifier(input.buildVersion)) throw smokeError('invalid_smoke_matrix', 'Smoke matrix build version is invalid.');
  if (!Array.isArray(input.devices) || input.devices.length === 0 || !input.devices.every(validateDevice)) {
    throw smokeError('invalid_smoke_matrix', 'Smoke matrix devices are invalid.');
  }
  if (!Array.isArray(input.fixtures) || input.fixtures.length === 0) {
    throw smokeError('invalid_smoke_matrix', 'Smoke matrix requires fixtures.');
  }
  const ids = new Set();
  const fixtures = input.fixtures.map((fixture) => {
    if (!isPlainObject(fixture)
      || !validIdentifier(fixture.id)
      || ids.has(fixture.id)
      || !['deterministic', 'real-clone'].includes(fixture.kind)
      || !validIdentifier(fixture.producerFamily)
      || !validIdentifier(fixture.runtimeFamily)
      || !validIdentifier(fixture.siteClass)
      || !UUID.test(fixture.bundleId || '')
      || !SHA256.test(fixture.runtimeFingerprint || '')
      || !SHA256.test(fixture.buildFingerprint || '')
      || !Array.isArray(fixture.fixtureClasses)) {
      throw smokeError('invalid_smoke_fixture', `Smoke fixture ${fixture?.id || 'unknown'} is invalid.`);
    }
    ids.add(fixture.id);
    return { ...fixture, fixtureClasses: [...new Set(fixture.fixtureClasses)] };
  });
  const presentClasses = new Set(fixtures.flatMap((fixture) => fixture.fixtureClasses));
  const missingRequiredFixtureClasses = REQUIRED_SMOKE_FIXTURE_CLASSES
    .filter((fixtureClass) => !presentClasses.has(fixtureClass));
  const realFamilies = new Set(fixtures
    .filter((fixture) => fixture.kind === 'real-clone')
    .map((fixture) => `${fixture.producerFamily}:${fixture.runtimeFamily}`));
  const availableFamilies = (input.availableFamilies || [])
    .filter((family) => isPlainObject(family) && validIdentifier(family.producer) && validIdentifier(family.runtime));
  const missingRealCloneFamilies = availableFamilies
    .filter((family) => family.producer !== 'fixture' && !realFamilies.has(familyKey(family)))
    .map(familyKey)
    .sort();
  return {
    ...input,
    fixtures,
    availableFamilies,
    coverage: {
      presentFixtureClasses: [...presentClasses].sort(),
      missingRequiredFixtureClasses,
      missingRealCloneFamilies,
      representative: missingRequiredFixtureClasses.length === 0 && missingRealCloneFamilies.length === 0,
    },
  };
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

function percentile(values, percentileValue) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * percentileValue))];
}

export function summarizeSmokeEvidence(results = []) {
  const candidates = results.length;
  const supported = results.filter((result) => result.finalOutcome === 'supported').length;
  const recovered = results.filter((result) => result.finalOutcome === 'recovered').length;
  const disabled = results.filter((result) => result.finalOutcome === 'disabled').length;
  const failed = results.filter((result) => ['failed', 'restored'].includes(result.finalOutcome)).length;
  const sites = new Set(results.map((result) => result.siteId).filter(Boolean));
  const disabledSites = new Set(results
    .filter((result) => result.finalOutcome === 'disabled')
    .map((result) => result.siteId)
    .filter(Boolean));
  const reviewed = results.filter((result) => result.manualReview != null);
  const falsePositives = reviewed.filter((result) => result.manualReview === 'false-positive').length;
  const readyDurations = results.map((result) => Number(result.timeToReadyMs ?? result.durationMs)).filter(Number.isFinite);
  const recoveryDurations = results
    .filter((result) => result.finalOutcome === 'recovered')
    .map((result) => Number(result.recoveryLatencyMs))
    .filter(Number.isFinite);
  const exhaustionDurations = results
    .filter((result) => ['disabled', 'failed', 'restored'].includes(result.finalOutcome))
    .map((result) => Number(result.recoveryLatencyMs))
    .filter(Number.isFinite);
  return {
    candidatesDiscovered: candidates,
    controlsRenderedAutomatically: results.filter((result) => result.renderedAutomatically).length,
    initialValidationSuccess: results.filter((result) => result.initialValidationSuccess).length,
    applySuccess: results.filter((result) => result.applySuccess).length,
    visibleEffectSuccess: results.filter((result) => result.visibleEffectSuccess).length,
    restoreSuccess: results.filter((result) => result.restoreSuccess).length,
    automaticRepairSuccess: recovered,
    exhaustedFailures: disabled + failed,
    disabledControls: disabled,
    supported,
    recovered,
    failed,
    disabledControlIncidence: ratio(disabled, candidates),
    perSiteDisabledIncidence: ratio(disabledSites.size, sites.size),
    falsePositiveRate: reviewed.length === candidates && reviewed.length > 0
      ? ratio(falsePositives, reviewed.length)
      : null,
    manualReviewStatus: reviewed.length === candidates && candidates > 0 ? 'complete' : 'pending',
    medianTimeToReadyMs: percentile(readyDurations, 0.5),
    medianRecoveryLatencyMs: percentile(recoveryDurations, 0.5),
    medianExhaustionLatencyMs: percentile(exhaustionDurations, 0.5),
  };
}

function groupTable(results, keyFor) {
  const groups = new Map();
  results.forEach((result) => {
    const key = keyFor(result) || 'unknown';
    const group = groups.get(key) || { key, candidates: 0, supported: 0, recovered: 0, disabled: 0, failed: 0 };
    group.candidates += 1;
    if (result.finalOutcome === 'supported') group.supported += 1;
    else if (result.finalOutcome === 'recovered') group.recovered += 1;
    else if (result.finalOutcome === 'disabled') group.disabled += 1;
    else group.failed += 1;
    groups.set(key, group);
  });
  return [...groups.values()].sort((left, right) => left.key.localeCompare(right.key));
}

export function aggregateSmokeEvidence(results = []) {
  return {
    byEngine: groupTable(results, (result) => result.engine),
    byProperty: groupTable(results, (result) => result.property),
    byAdapterKind: groupTable(results, (result) => result.adapterKind),
    bySite: groupTable(results, (result) => result.siteId),
  };
}

function traceMetrics(trace) {
  const stages = (name) => trace.filter((entry) => entry.stage === name);
  const allOk = (name) => stages(name).length > 0 && stages(name).every((entry) => entry.response?.ok === true);
  return {
    applySuccess: allOk('apply') && allOk('reapply'),
    visibleEffectSuccess: [...stages('apply'), ...stages('reapply')].some((entry) => (
      entry.response?.visualOracle?.changed === true
      || entry.response?.computedStateEvidence?.changed === true
      || entry.response?.screenshotEvidence?.changed === true
    )),
    restoreSuccess: allOk('restore') && allOk('final-restore')
      && [...stages('restore'), ...stages('final-restore')].every((entry) => (
        entry.response?.restoreEvidence?.restored === true
        || entry.response?.computedStateEvidence?.restored === true
        || entry.response?.screenshotEvidence?.restored === true
      )),
  };
}

function smokeEvent(result, matrix, fixture, device, occurredAt) {
  const supported = ['supported', 'recovered'].includes(result.finalOutcome);
  return sanitizeMotionDiagnosticEvent({
    schemaVersion: 1,
    occurredAt,
    source: 'smoke',
    origin: 'smoke',
    transition: supported ? 'control-ready' : 'control-disabled',
    code: supported ? 'control_validated' : result.failureCode,
    validationStage: result.validationStage || (supported ? 'restore' : 'effect'),
    finalOutcome: result.finalOutcome,
    controlId: result.controlId,
    controlKind: result.adapterKind,
    controlScope: result.controlScope,
    device: device.id,
    viewportWidth: device.width,
    viewportHeight: device.height,
    runtimeFingerprint: fixture.runtimeFingerprint,
    buildVersion: fixture.buildFingerprint,
    appVersion: matrix.buildVersion,
    adapterVersion: result.adapterVersion,
    engine: result.engine,
    siteClass: fixture.siteClass,
    durationMs: result.durationMs,
    recovered: result.finalOutcome === 'recovered',
  }, { now: new Date(occurredAt) });
}

function ensureTrustedRuntime(runtime, fixture) {
  if (runtime?.gateway?.signed !== true
    || runtime?.gateway?.verified !== true
    || runtime?.bridge?.protocol !== 'uncraft-motion-editor/v2') {
    throw smokeError('untrusted_smoke_runtime', 'Smoke runtimes must use the signed gateway and protocol-v2 bridge.');
  }
  if (fixture.offline && Array.isArray(runtime.externalRequests) && runtime.externalRequests.length > 0) {
    throw smokeError('offline_network_access', 'Offline smoke fixtures attempted external network access.');
  }
  if (typeof runtime.createValidationTransport !== 'function') {
    throw smokeError('smoke_validator_unavailable', 'Smoke runtime validation transport is unavailable.');
  }
}

async function runSessionCommands(runtime, context) {
  if (typeof runtime.runSessionCommand !== 'function') return [];
  const commands = ['play', 'pause', 'scrub'];
  const evidence = [];
  for (const command of commands) {
    const result = await runtime.runSessionCommand(command, context);
    const persistentPatches = Number(result?.persistentPatches || 0);
    if (persistentPatches !== 0) {
      throw smokeError('session_command_persisted', `${command} created a persistent patch.`);
    }
    evidence.push({
      fixtureId: context.fixture.id,
      device: context.device.id,
      command,
      acknowledged: result?.acknowledged === true,
      persistentPatches,
    });
  }
  return evidence;
}

async function exhaustRecovery({ runtime, candidate, validation, trace, now, bundleId, runtimeFingerprint }) {
  const policy = createRecoveryPolicy({ now: () => now().getTime(), random: () => 0.5 });
  const startedAt = now().getTime();
  for (let index = 0; index < 8; index += 1) {
    const decision = policy.next({ code: validation.code, controlId: candidate.id, operationId: 'smoke-validation' });
    trace.push({ recoveryAction: decision.action, decision });
    if (decision.action === RECOVERY_ACTIONS.DISABLE_CONTROL) {
      return { validation, recovered: false, disabled: true, recoveryLatencyMs: now().getTime() - startedAt };
    }
    if (typeof runtime.recoverControl !== 'function') continue;
    const recovered = await runtime.recoverControl({ candidate, decision, validation });
    if (!recovered?.recovered) continue;
    const transport = runtime.createValidationTransport(candidate, { recovered, trace });
    const traced = async (stage, proposal, context) => {
      const response = await transport(stage, proposal, context);
      trace.push({ stage, response });
      return response;
    };
    const validate = createRuntimeControlValidator({
      transport: traced,
      requireVisibleEvidence: true,
      requireSemanticCoverage: true,
    });
    const nextValidation = await validate(recovered.candidate || candidate, {
      bundleId,
      runtimeFingerprint,
    });
    if (nextValidation.accepted) {
      policy.recovered();
      return { validation: nextValidation, recovered: true, disabled: false, recoveryLatencyMs: now().getTime() - startedAt };
    }
    validation = nextValidation;
  }
  return { validation, recovered: false, disabled: true, recoveryLatencyMs: now().getTime() - startedAt };
}

function controlEngine(candidate, fixture) {
  return candidate.binding?.engine
    || candidate.provenance?.engine
    || fixture.fixtureClasses.find((value) => /gsap|scrolltrigger|waapi|css|lottie/.test(value))
    || 'unknown';
}

export function createMotionSmokeRunner({
  openRuntime,
  persistEvents = async () => {},
  now = () => new Date(),
} = {}) {
  if (typeof openRuntime !== 'function') throw new TypeError('A smoke runtime opener is required.');
  if (typeof persistEvents !== 'function') throw new TypeError('A trusted smoke evidence sink is required.');
  let runSequence = 0;

  async function run(input) {
    const matrix = validateSmokeMatrix(input);
    const started = now();
    const startedAt = started instanceof Date ? started : new Date(started);
    const matrixFingerprint = digest({
      schemaVersion: matrix.schemaVersion,
      buildVersion: matrix.buildVersion,
      devices: matrix.devices,
      fixtures: matrix.fixtures.map((fixture) => ({
        fixtureFingerprint: fingerprintSmokeFixture(fixture),
        candidateFingerprint: digest(fixture.candidate || null),
        recoveryCandidateFingerprint: digest(fixture.recoveryCandidate || null),
      })),
      availableFamilies: matrix.availableFamilies,
    });
    runSequence += 1;
    const runId = `smoke-${startedAt.toISOString().replace(/[^0-9]/g, '').slice(0, 17)}-${runSequence}-${randomUUID().slice(0, 8)}`;
    const results = [];
    const sessionCommands = [];
    const diagnosticWriteFailures = [];

    for (const fixture of matrix.fixtures) {
      for (const device of matrix.devices) {
        const runtime = await openRuntime({ fixture, device, matrix, runId });
        try {
          ensureTrustedRuntime(runtime, fixture);
          sessionCommands.push(...await runSessionCommands(runtime, { fixture, device, matrix, runId }));
          for (const candidate of runtime.candidates || []) {
            const trace = [];
            const transport = runtime.createValidationTransport(candidate, { trace, fixture, device, runId });
            const traced = async (stage, proposal, context) => {
              const response = await transport(stage, proposal, context);
              trace.push({ stage, response });
              return response;
            };
            const validate = createRuntimeControlValidator({
              transport: traced,
              requireVisibleEvidence: true,
              requireSemanticCoverage: true,
              now,
            });
            const validationStartedAt = now().getTime();
            const initial = await validate(candidate, {
              bundleId: fixture.bundleId,
              runtimeFingerprint: fixture.runtimeFingerprint,
            });
            const recovery = initial.accepted
              ? { validation: initial, recovered: false, disabled: false, recoveryLatencyMs: null }
              : await exhaustRecovery({
                runtime,
                candidate,
                validation: initial,
                trace,
                now,
                bundleId: fixture.bundleId,
                runtimeFingerprint: fixture.runtimeFingerprint,
              });
            const finalValidation = recovery.validation;
            const finalOutcome = finalValidation.accepted
              ? (recovery.recovered ? 'recovered' : 'supported')
              : recovery.disabled ? 'disabled' : 'failed';
            const traceResult = traceMetrics(trace);
            const durationMs = Math.max(0, now().getTime() - validationStartedAt);
            const control = finalValidation.control || candidate;
            const result = {
              runId,
              fixtureId: fixture.id,
              siteId: fixture.id,
              siteClass: fixture.siteClass,
              producerFamily: fixture.producerFamily,
              runtimeFamily: fixture.runtimeFamily,
              device: device.id,
              controlId: control.id || candidate.id,
              controlScope: control.scope || candidate.scope || 'unknown',
              adapterKind: control.ladder || candidate.ladder || 'custom-adapter',
              adapterVersion: control.provenance?.adapterVersion || 'control-manifest-v1',
              engine: controlEngine(control, fixture),
              property: control.binding?.property || control.targets?.[0]?.property || 'unknown',
              initialValidationSuccess: initial.accepted,
              renderedAutomatically: finalValidation.accepted
                && (runtime.renderedControlIds || []).includes(control.id || candidate.id),
              ...traceResult,
              finalOutcome,
              failureCode: finalValidation.accepted ? null : (finalValidation.code || initial.code || 'unknown_failure'),
              validationStage: finalValidation.stage || null,
              recoverySteps: trace.filter((entry) => entry.recoveryAction).map((entry) => entry.recoveryAction),
              timeToReadyMs: finalValidation.accepted ? durationMs : null,
              recoveryLatencyMs: recovery.recoveryLatencyMs,
              durationMs,
              manualReview: runtime.manualReview?.[candidate.id] ?? null,
              evidenceArtifacts: (runtime.evidenceArtifacts || [])
                .filter((artifact) => artifact.controlId === (control.id || candidate.id)),
              fixtureFingerprint: fingerprintSmokeFixture(fixture),
              buildFingerprint: fixture.buildFingerprint,
              runtimeFingerprint: fixture.runtimeFingerprint,
            };
            results.push(result);
            try {
              await persistEvents([
                smokeEvent(result, matrix, fixture, device, now().toISOString()),
              ], { trusted: true, runId, fixtureId: fixture.id });
            } catch {
              diagnosticWriteFailures.push({ fixtureId: fixture.id, device: device.id });
            }
          }
          if (fixture.offline && Array.isArray(runtime.externalRequests) && runtime.externalRequests.length > 0) {
            throw smokeError('offline_network_access', 'Offline smoke fixtures attempted external network access.');
          }
        } finally {
          await runtime?.close?.();
        }
      }
    }

    return {
      schemaVersion: MOTION_SMOKE_SCHEMA_VERSION,
      runId,
      startedAt: startedAt.toISOString(),
      completedAt: now().toISOString(),
      matrixFingerprint,
      matrixCoverage: matrix.coverage,
      summary: summarizeSmokeEvidence(results),
      aggregates: aggregateSmokeEvidence(results),
      sessionCommands,
      results,
      diagnosticWriteFailures,
      decision: {
        status: matrix.coverage.representative
          && results.length > 0
          && results.every((result) => result.manualReview != null)
          ? 'ready-for-owner-review'
          : 'insufficient-evidence',
        currentPresentation: 'disabled',
        universalityThreshold: null,
      },
    };
  }

  return { run };
}
