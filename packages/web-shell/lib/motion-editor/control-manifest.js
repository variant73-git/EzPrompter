import { createHash } from 'node:crypto';

export const CONTROL_MANIFEST_SCHEMA_VERSION = 1;

export const CONTROL_LADDER_VALUES = Object.freeze([
  'direct',
  'known-library',
  'declarative-adapter',
  'custom-adapter',
  'code-only',
]);

export const CONTROL_TYPES = Object.freeze([
  'slider-number',
  'toggle',
  'select',
  'color',
  'easing',
]);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const CONTROL_ID_PATTERN = /^control-[0-9a-f]{24}$/;
const SAFE_IDENTIFIER = /^[a-z][a-z0-9._:-]{0,95}$/i;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const LADDER = new Set(CONTROL_LADDER_VALUES);
const TYPES = new Set(CONTROL_TYPES);
const SCOPES = new Set(['animation', 'group', 'site']);
const UNITS = new Set(['ms', 's', 'px', 'percent', 'degrees', 'multiplier', 'count', 'number', 'boolean', 'color', 'easing']);
const BINDING_KINDS = new Set(['css-custom-property', 'dom-attribute', 'known-runtime', 'typed-command', 'custom-capability']);
const VALIDATION_STAGES = ['schema', 'read', 'apply', 'effect', 'restore', 'deterministic', 'teardown', 'fingerprint'];
const FORBIDDEN_KEYS = new Set([
  '__proto__', 'prototype', 'constructor', 'code', 'sourceCode', 'adapterSource',
  'script', 'javascript', 'eval', 'selector', 'querySelector', 'html', 'prompt', 'rawResponse',
]);

function fail(message) {
  const error = new TypeError(`Invalid control manifest: ${message}`);
  error.code = 'invalid_control_manifest';
  throw error;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${label} contains unsupported field ${key}`);
  }
}

function cloneJson(value, label) {
  const seen = new Set();
  const visit = (candidate) => {
    if (candidate == null || ['string', 'boolean'].includes(typeof candidate)) return;
    if (typeof candidate === 'number') {
      if (!Number.isFinite(candidate)) fail(`${label} contains a non-finite number`);
      return;
    }
    if (!candidate || typeof candidate !== 'object') fail(`${label} contains non-JSON values`);
    if (seen.has(candidate)) fail(`${label} contains a cycle`);
    seen.add(candidate);
    if (Array.isArray(candidate)) candidate.forEach(visit);
    else for (const [key, child] of Object.entries(candidate)) {
      if (FORBIDDEN_KEYS.has(key)) fail(`${label} contains unsafe field ${key}`);
      visit(child);
    }
    seen.delete(candidate);
  };
  visit(value);
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    fail(`${label} must be JSON serializable`);
  }
}

function assertString(value, label, { max = 120, pattern = null, nullable = false } = {}) {
  if (nullable && value == null) return null;
  if (typeof value !== 'string' || !value.trim()) fail(`${label} must be a non-empty string`);
  const trimmed = value.trim();
  if (trimmed.length > max) fail(`${label} is too long`);
  if (pattern && !pattern.test(trimmed)) fail(`${label} has an unsupported format`);
  return trimmed;
}

function assertUuid(value, label) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) fail(`${label} must be a UUID`);
  return value.toLowerCase();
}

function assertFingerprint(value, label = 'runtimeFingerprint') {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) fail(`${label} must be a sha256 digest`);
  return value;
}

function primitive(value, label) {
  if (!['string', 'number', 'boolean'].includes(typeof value)) fail(`${label} must be a scalar JSON value`);
  if (typeof value === 'number' && !Number.isFinite(value)) fail(`${label} must be finite`);
  return value;
}

function parseTarget(input, scope) {
  if (!isPlainObject(input)) fail('targets must contain objects');
  exactKeys(input, new Set(['semanticTargetId', 'elementId', 'motionId', 'property']), 'target');
  const target = {
    semanticTargetId: assertString(input.semanticTargetId, 'target semanticTargetId', { pattern: SAFE_IDENTIFIER }),
    elementId: assertString(input.elementId, 'target elementId', { pattern: SAFE_IDENTIFIER }),
    motionId: input.motionId == null ? null : assertString(input.motionId, 'target motionId', { pattern: SAFE_IDENTIFIER }),
    property: assertString(input.property, 'target property', { pattern: SAFE_IDENTIFIER }),
  };
  if (scope === 'animation' && !target.motionId) fail('animation controls require a motion target');
  return target;
}

function parseBinding(input) {
  if (!isPlainObject(input)) fail('binding must be an object');
  const kind = input.kind;
  if (!BINDING_KINDS.has(kind)) fail(`unsupported binding kind ${String(kind)}`);
  const allowed = {
    'css-custom-property': new Set(['kind', 'property']),
    'dom-attribute': new Set(['kind', 'attribute']),
    'known-runtime': new Set(['kind', 'engine', 'property']),
    'typed-command': new Set(['kind', 'command', 'property']),
    'custom-capability': new Set(['kind', 'capability', 'property']),
  }[kind];
  exactKeys(input, allowed, 'binding');
  if (kind === 'css-custom-property') {
    const property = assertString(input.property, 'binding property', { max: 80 });
    if (!/^--[a-z0-9_-]+$/i.test(property)) fail('CSS custom-property binding is invalid');
    return { kind, property };
  }
  if (kind === 'dom-attribute') {
    const attribute = assertString(input.attribute, 'binding attribute', { max: 80 });
    if (!/^data-[a-z0-9_-]+$/i.test(attribute)) fail('declarative attributes must use a declared data-* attribute');
    return { kind, attribute };
  }
  if (kind === 'known-runtime') {
    const engine = assertString(input.engine, 'binding engine', { pattern: SAFE_IDENTIFIER });
    if (!['gsap', 'scrolltrigger', 'lottie', 'webflow', 'waapi', 'css'].includes(engine.toLowerCase())) {
      fail('known-runtime binding uses an unknown engine');
    }
    return { kind, engine: engine.toLowerCase(), property: assertString(input.property, 'binding property', { pattern: SAFE_IDENTIFIER }) };
  }
  if (kind === 'typed-command') {
    const command = assertString(input.command, 'binding command', { pattern: SAFE_IDENTIFIER });
    if (!['motion.set', 'style.set', 'attribute.set'].includes(command)) fail('typed command is not in the capability registry');
    return { kind, command, property: assertString(input.property, 'binding property', { pattern: SAFE_IDENTIFIER }) };
  }
  const capability = assertString(input.capability, 'binding capability', { pattern: SAFE_IDENTIFIER });
  if (!/^motion\.[a-z0-9._:-]+$/i.test(capability)) fail('custom capability is outside the motion registry');
  return { kind, capability, property: assertString(input.property, 'binding property', { pattern: SAFE_IDENTIFIER }) };
}

function parseOption(input, label) {
  if (!isPlainObject(input)) fail(`${label} options must be objects`);
  exactKeys(input, new Set(['label', 'value']), `${label} option`);
  return {
    label: assertString(input.label, `${label} option label`, { max: 48 }),
    value: primitive(input.value, `${label} option value`),
  };
}

function parseDomain(controlType, input) {
  if (!isPlainObject(input)) fail('domain must be an object');
  if (controlType === 'slider-number') {
    exactKeys(input, new Set(['min', 'max', 'step']), 'slider domain');
    const min = Number(input.min);
    const max = Number(input.max);
    const step = Number(input.step);
    if (![min, max, step].every(Number.isFinite) || max <= min || step <= 0 || step > max - min) {
      fail('slider domain requires a stable finite range and step');
    }
    return { min, max, step };
  }
  if (controlType === 'toggle') {
    exactKeys(input, new Set(), 'toggle domain');
    return {};
  }
  if (controlType === 'select') {
    exactKeys(input, new Set(['options']), 'select domain');
    if (!Array.isArray(input.options) || input.options.length < 2 || input.options.length > 12) {
      fail('select domain requires two to twelve curated options');
    }
    const options = input.options.map((option) => parseOption(option, 'select'));
    if (new Set(options.map((option) => JSON.stringify(option.value))).size !== options.length) fail('select options must be unique');
    return { options };
  }
  if (controlType === 'color') {
    exactKeys(input, new Set(['options']), 'color domain');
    if (!Array.isArray(input.options) || input.options.length < 1 || input.options.length > 12) {
      fail('color domain requires curated options');
    }
    const options = input.options.map((value) => {
      if (typeof value !== 'string' || !HEX_COLOR.test(value)) fail('color options must be six-digit hex values');
      return value.toLowerCase();
    });
    return { options: [...new Set(options)] };
  }
  exactKeys(input, new Set(['options']), 'easing domain');
  if (!Array.isArray(input.options) || input.options.length < 1 || input.options.length > 12) {
    fail('easing domain requires curated options');
  }
  const options = input.options.map((value) => assertString(value, 'easing option', { max: 80 }));
  return { options: [...new Set(options)] };
}

function assertValueForType(value, controlType, domain, label) {
  const parsed = primitive(value, label);
  if (controlType === 'slider-number') {
    if (typeof parsed !== 'number' || parsed < domain.min || parsed > domain.max) fail(`${label} is outside the slider domain`);
    const stepOffset = (parsed - domain.min) / domain.step;
    if (Math.abs(stepOffset - Math.round(stepOffset)) > 1e-7) fail(`${label} is not aligned to the slider step`);
  } else if (controlType === 'toggle') {
    if (typeof parsed !== 'boolean') fail(`${label} must be boolean`);
  } else if (controlType === 'select') {
    if (!domain.options.some((option) => Object.is(option.value, parsed))) fail(`${label} is not a curated option`);
  } else if (controlType === 'color') {
    if (typeof parsed !== 'string' || !HEX_COLOR.test(parsed) || !domain.options.includes(parsed.toLowerCase())) {
      fail(`${label} must be a curated six-digit hex color`);
    }
    return parsed.toLowerCase();
  } else if (typeof parsed !== 'string' || !domain.options.includes(parsed)) {
    fail(`${label} is not a curated easing value`);
  }
  return parsed;
}

function parseLineage(input, bundleId, runtimeFingerprint) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 20) fail('compatibleLineage must contain bounded lineage evidence');
  const parsed = input.map((entry) => {
    if (!isPlainObject(entry)) fail('compatibleLineage entries must be objects');
    exactKeys(entry, new Set(['bundleId', 'runtimeFingerprint']), 'lineage entry');
    return { bundleId: assertUuid(entry.bundleId, 'lineage bundleId'), runtimeFingerprint: assertFingerprint(entry.runtimeFingerprint, 'lineage runtimeFingerprint') };
  });
  if (!parsed.some((entry) => entry.bundleId === bundleId && entry.runtimeFingerprint === runtimeFingerprint)) {
    fail('compatibleLineage must include the current bundle and runtime fingerprint');
  }
  return parsed;
}

function parseValidation(input) {
  if (!isPlainObject(input)) fail('validation must be an object');
  exactKeys(input, new Set([...VALIDATION_STAGES, 'visualOracle', 'validatedAt']), 'validation');
  const validation = {};
  for (const stage of VALIDATION_STAGES) {
    if (input[stage] !== 'passed') fail(`validation stage ${stage} must pass before promotion`);
    validation[stage] = 'passed';
  }
  if (input.visualOracle != null) {
    if (!['passed', 'not-required'].includes(input.visualOracle)) fail('visual oracle validation is invalid');
    validation.visualOracle = input.visualOracle;
  }
  if (typeof input.validatedAt !== 'string' || !Number.isFinite(Date.parse(input.validatedAt))) fail('validation requires a timestamp');
  validation.validatedAt = new Date(input.validatedAt).toISOString();
  return validation;
}

function parseProvenance(input) {
  if (!isPlainObject(input)) fail('provenance must be an object');
  exactKeys(input, new Set(['source', 'engine', 'decisionCode']), 'provenance');
  const source = assertString(input.source, 'provenance source', { pattern: SAFE_IDENTIFIER });
  if (!['runtime', 'reconstruction', 'model', 'migration'].includes(source)) fail('provenance source is unsupported');
  return {
    source,
    engine: input.engine == null ? null : assertString(input.engine, 'provenance engine', { pattern: SAFE_IDENTIFIER }),
    decisionCode: assertString(input.decisionCode, 'provenance decisionCode', { pattern: SAFE_IDENTIFIER }),
  };
}

function parseTeardown(input, binding) {
  if (!isPlainObject(input)) fail('teardown must be an object');
  exactKeys(input, new Set(['required', 'capability']), 'teardown');
  if (typeof input.required !== 'boolean') fail('teardown required must be boolean');
  const capability = input.capability == null ? null : assertString(input.capability, 'teardown capability', { pattern: SAFE_IDENTIFIER });
  if (binding.kind === 'custom-capability' && (!input.required || !capability)) fail('custom capabilities require an explicit teardown capability');
  return { required: input.required, capability };
}

function parseLimits(input) {
  if (!isPlainObject(input)) fail('limits must be an object');
  exactKeys(input, new Set(['executionMs', 'mutationCount', 'targetCount', 'network']), 'limits');
  const executionMs = Number(input.executionMs);
  const mutationCount = Number(input.mutationCount);
  const targetCount = Number(input.targetCount);
  if (!Number.isSafeInteger(executionMs) || executionMs < 1 || executionMs > 2000) fail('execution limit is unsafe');
  if (!Number.isSafeInteger(mutationCount) || mutationCount < 1 || mutationCount > 100) fail('mutation limit is unsafe');
  if (!Number.isSafeInteger(targetCount) || targetCount < 1 || targetCount > 50) fail('target limit is unsafe');
  if (input.network !== false) fail('custom controls may not access the network');
  return { executionMs, mutationCount, targetCount, network: false };
}

const PROPOSAL_KEYS = new Set([
  'scope', 'label', 'description', 'controlType', 'unit', 'currentValue', 'originalValue',
  'targets', 'binding', 'domain', 'teardown', 'limits',
]);

export function parseControlProposal(input) {
  if (!isPlainObject(input)) fail('control proposal must be an object');
  exactKeys(input, PROPOSAL_KEYS, 'control proposal');
  const scope = input.scope;
  if (!SCOPES.has(scope)) fail(`unsupported control scope ${String(scope)}`);
  const controlType = input.controlType;
  if (!TYPES.has(controlType)) fail(`unsupported control type ${String(controlType)}`);
  const unit = input.unit;
  if (!UNITS.has(unit)) fail(`unsupported control unit ${String(unit)}`);
  if ((controlType === 'toggle' && unit !== 'boolean')
    || (controlType === 'color' && unit !== 'color')
    || (controlType === 'easing' && unit !== 'easing')
    || (controlType === 'slider-number' && ['boolean', 'color', 'easing'].includes(unit))) {
    fail('control unit does not match its type');
  }
  if (!Array.isArray(input.targets) || !input.targets.length || input.targets.length > 50) fail('control requires bounded declared targets');
  const targets = input.targets.map((target) => parseTarget(target, scope));
  const binding = parseBinding(input.binding);
  const domain = parseDomain(controlType, input.domain);
  const currentValue = assertValueForType(input.currentValue, controlType, domain, 'currentValue');
  const originalValue = assertValueForType(input.originalValue, controlType, domain, 'originalValue');
  const limits = parseLimits(input.limits);
  if (limits.targetCount !== targets.length) fail('target limit must match the complete declared target set');
  return {
    scope,
    label: assertString(input.label, 'label', { max: 48 }),
    description: assertString(input.description, 'description', { max: 160 }),
    controlType,
    unit,
    currentValue,
    originalValue,
    targets,
    binding,
    domain,
    teardown: parseTeardown(input.teardown, binding),
    limits,
  };
}

const CONTROL_KEYS = new Set([
  'id', 'ladder', ...PROPOSAL_KEYS, 'bundleId', 'runtimeFingerprint', 'compatibleLineage',
  'validation', 'provenance', 'status',
]);

export function parseReadyControl(input, { bundleId: expectedBundleId = null, runtimeFingerprint: expectedFingerprint = null } = {}) {
  if (!isPlainObject(input)) fail('controls must be objects');
  exactKeys(input, CONTROL_KEYS, 'control');
  if (typeof input.id !== 'string' || !CONTROL_ID_PATTERN.test(input.id)) fail('control requires a stable ID');
  if (!LADDER.has(input.ladder) || input.ladder === 'code-only') fail('ready controls require an editable ladder classification');
  if (input.status !== 'ready') fail('only ready controls may persist');
  const proposal = parseControlProposal(Object.fromEntries([...PROPOSAL_KEYS].map((key) => [key, input[key]])));
  const bundleId = assertUuid(input.bundleId, 'bundleId');
  const runtimeFingerprint = assertFingerprint(input.runtimeFingerprint);
  if (expectedBundleId && bundleId !== assertUuid(expectedBundleId, 'expected bundleId')) fail('control bundle does not match manifest');
  if (expectedFingerprint && runtimeFingerprint !== assertFingerprint(expectedFingerprint, 'expected runtimeFingerprint')) fail('control runtime fingerprint does not match manifest');
  return {
    id: input.id,
    ladder: input.ladder,
    ...proposal,
    bundleId,
    runtimeFingerprint,
    compatibleLineage: parseLineage(input.compatibleLineage, bundleId, runtimeFingerprint),
    validation: parseValidation(input.validation),
    provenance: parseProvenance(input.provenance),
    teardown: proposal.teardown,
    limits: proposal.limits,
    status: 'ready',
  };
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isPlainObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function createStableControlId(input) {
  const targets = (input?.targets || []).map((target) => ({
    semanticTargetId: target.semanticTargetId,
    motionId: target.motionId || null,
    property: target.property,
  })).sort((left, right) => canonical(left).localeCompare(canonical(right)));
  const binding = input?.binding || {};
  const identity = {
    ladder: input?.ladder || null,
    scope: input?.scope || 'animation',
    targets,
    binding: Object.fromEntries(['kind', 'engine', 'command', 'capability', 'attribute', 'property']
      .filter((key) => binding[key] != null)
      .map((key) => [key, binding[key]])),
  };
  return `control-${createHash('sha256').update(canonical(identity)).digest('hex').slice(0, 24)}`;
}

export function parseControlManifest(input, options = {}) {
  let parsed = input;
  if (typeof input === 'string') {
    try { parsed = JSON.parse(input); } catch { fail('manifest must be valid JSON'); }
  }
  if (!isPlainObject(parsed)) fail('manifest must be an object');
  exactKeys(parsed, new Set(['schemaVersion', 'bundleId', 'runtimeFingerprint', 'controls']), 'manifest');
  if (parsed.schemaVersion !== CONTROL_MANIFEST_SCHEMA_VERSION) fail(`unsupported schema version ${String(parsed.schemaVersion)}`);
  const bundleId = assertUuid(parsed.bundleId, 'bundleId');
  const runtimeFingerprint = assertFingerprint(parsed.runtimeFingerprint);
  if (options.expectedBundleId && bundleId !== assertUuid(options.expectedBundleId, 'expected bundleId')) fail('manifest bundle does not match');
  if (options.expectedRuntimeFingerprint && runtimeFingerprint !== assertFingerprint(options.expectedRuntimeFingerprint, 'expected runtimeFingerprint')) fail('manifest runtime fingerprint does not match');
  if (!Array.isArray(parsed.controls)) fail('controls must be an array');
  const controls = parsed.controls.map((control) => parseReadyControl(control, { bundleId, runtimeFingerprint }));
  const ids = new Set();
  const scopedCounts = new Map();
  for (const control of controls) {
    if (ids.has(control.id)) fail('control IDs must be unique');
    ids.add(control.id);
    const targetKey = control.scope === 'site'
      ? 'site'
      : `${control.scope}:${control.targets.map((target) => target.motionId || target.semanticTargetId).sort().join(',')}`;
    const count = (scopedCounts.get(targetKey) || 0) + 1;
    if (count > 5) fail('no animation or group may expose more than five controls');
    scopedCounts.set(targetKey, count);
  }
  return { schemaVersion: CONTROL_MANIFEST_SCHEMA_VERSION, bundleId, runtimeFingerprint, controls };
}

export function createControlManifest({ bundleId, runtimeFingerprint, controls = [] }) {
  return parseControlManifest({ schemaVersion: CONTROL_MANIFEST_SCHEMA_VERSION, bundleId, runtimeFingerprint, controls });
}

export function serializeControlManifest(input, options = {}) {
  return JSON.stringify(parseControlManifest(input, options));
}

const targetSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    semanticTargetId: { type: 'string', minLength: 1, maxLength: 96 },
    elementId: { type: 'string', minLength: 1, maxLength: 96 },
    motionId: { type: ['string', 'null'], maxLength: 96 },
    property: { type: 'string', minLength: 1, maxLength: 96 },
  },
  required: ['semanticTargetId', 'elementId', 'motionId', 'property'],
};

const bindingSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: [...BINDING_KINDS] },
    engine: { type: ['string', 'null'], maxLength: 40 },
    command: { type: ['string', 'null'], maxLength: 60 },
    capability: { type: ['string', 'null'], maxLength: 96 },
    attribute: { type: ['string', 'null'], maxLength: 80 },
    property: { type: ['string', 'null'], maxLength: 96 },
  },
  required: ['kind', 'engine', 'command', 'capability', 'attribute', 'property'],
};

const optionSchema = {
  anyOf: [
    { type: 'string', maxLength: 96 },
    { type: 'number' },
    { type: 'boolean' },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        label: { type: 'string', minLength: 1, maxLength: 48 },
        value: { type: ['string', 'number', 'boolean'] },
      },
      required: ['label', 'value'],
    },
  ],
};

export const CONTROL_PROPOSAL_JSON_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    controls: {
      type: 'array', minItems: 1, maxItems: 5,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          scope: { type: 'string', enum: [...SCOPES] },
          label: { type: 'string', minLength: 1, maxLength: 48 },
          description: { type: 'string', minLength: 1, maxLength: 160 },
          controlType: { type: 'string', enum: [...CONTROL_TYPES] },
          unit: { type: 'string', enum: [...UNITS] },
          currentValue: { type: ['string', 'number', 'boolean'] },
          originalValue: { type: ['string', 'number', 'boolean'] },
          targets: { type: 'array', minItems: 1, maxItems: 50, items: targetSchema },
          binding: bindingSchema,
          domain: {
            type: 'object', additionalProperties: false,
            properties: {
              min: { type: ['number', 'null'] }, max: { type: ['number', 'null'] }, step: { type: ['number', 'null'] },
              options: { anyOf: [{ type: 'null' }, { type: 'array', maxItems: 12, items: optionSchema }] },
            },
            required: ['min', 'max', 'step', 'options'],
          },
          teardown: {
            type: 'object', additionalProperties: false,
            properties: { required: { type: 'boolean' }, capability: { type: ['string', 'null'], maxLength: 96 } },
            required: ['required', 'capability'],
          },
          limits: {
            type: 'object', additionalProperties: false,
            properties: {
              executionMs: { type: 'integer', minimum: 1, maximum: 2000 },
              mutationCount: { type: 'integer', minimum: 1, maximum: 100 },
              targetCount: { type: 'integer', minimum: 1, maximum: 50 },
              network: { type: 'boolean', const: false },
            },
            required: ['executionMs', 'mutationCount', 'targetCount', 'network'],
          },
        },
        required: [...PROPOSAL_KEYS],
      },
    },
  },
  required: ['controls'],
});

export { cloneJson as cloneControlJson };
