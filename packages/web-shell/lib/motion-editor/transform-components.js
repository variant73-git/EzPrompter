const TRANSFORM_COMPONENTS = new Set([
  'translateX',
  'translateY',
  'scaleX',
  'scaleY',
  'rotate',
  'skewX',
  'skewY',
  'transformOriginX',
  'transformOriginY',
]);

const COMPLEX_TRANSFORM_PATTERN = /\b(?:matrix3d|translate3d|translateZ|scale3d|scaleZ|rotate3d|rotateX|rotateY|perspective)\s*\(|\b(?:var|calc|min|max|clamp)\s*\(/i;
const FUNCTION_PATTERN = /([a-zA-Z][a-zA-Z0-9]*)\(([^()]*)\)/g;

function round(value, digits = 6) {
  if (!Number.isFinite(value)) return 0;
  const power = 10 ** digits;
  const result = Math.round(value * power) / power;
  return Object.is(result, -0) ? 0 : result;
}

function numberText(value) {
  return String(round(value));
}

function splitArgs(value) {
  return String(value || '')
    .trim()
    .split(/\s*,\s*|\s+/)
    .filter(Boolean);
}

function numeric(value, fallback = 0) {
  const result = Number.parseFloat(String(value || ''));
  return Number.isFinite(result) ? result : fallback;
}

function lengthValue(value, fallback = '0px') {
  const text = String(value ?? '').trim();
  if (!text) return fallback;
  if (/^-?(?:\d+|\d*\.\d+)(?:px|%|em|rem|vw|vh)?$/i.test(text)) {
    return /[a-z%]$/i.test(text) ? text : `${text}px`;
  }
  throw new TypeError('Transform length must be a finite CSS length');
}

function angleValue(value, fallback = '0deg') {
  const text = String(value ?? '').trim();
  if (!text) return fallback;
  if (/^-?(?:\d+|\d*\.\d+)(?:deg|rad|turn|grad)?$/i.test(text)) {
    return /[a-z]$/i.test(text) ? text : `${text}deg`;
  }
  throw new TypeError('Transform angle must be a finite CSS angle');
}

function scaleValue(value, fallback = '1') {
  const text = String(value ?? '').trim();
  if (!text) return fallback;
  const result = Number(text);
  if (!Number.isFinite(result)) throw new TypeError('Transform scale must be finite');
  return numberText(result);
}

function parseOrigin(value) {
  const parts = splitArgs(value || '50% 50%');
  return [
    parts[0] || '50%',
    parts[1] || '50%',
  ];
}

function decomposeMatrix(args) {
  if (args.length !== 6 || args.some((value) => !Number.isFinite(Number(value)))) return null;
  const [a, b, c, d, e, f] = args.map(Number);
  const scaleX = Math.hypot(a, b);
  if (scaleX < 1e-9) return null;
  const determinant = (a * d) - (b * c);
  const scaleY = determinant / scaleX;
  const rotate = Math.atan2(b, a);
  const skewX = Math.atan2((a * c) + (b * d), scaleX * scaleX);
  return {
    translateX: e,
    translateY: f,
    scaleX,
    scaleY,
    rotate: rotate * (180 / Math.PI),
    skewX: skewX * (180 / Math.PI),
    skewY: 0,
  };
}

function cloneState(state) {
  return {
    ...state,
    origin: [...state.origin],
    operations: state.operations.map((operation) => ({
      ...operation,
      args: [...operation.args],
      ...(operation.components ? { components: { ...operation.components } } : {}),
    })),
  };
}

function operationValue(operation, component) {
  const args = operation.args;
  if (operation.type === 'translateX' && component === 'translateX') return lengthValue(args[0]);
  if (operation.type === 'translateY' && component === 'translateY') return lengthValue(args[0]);
  if (operation.type === 'translate') {
    if (component === 'translateX') return lengthValue(args[0]);
    if (component === 'translateY') return lengthValue(args[1] || '0px');
  }
  if (operation.type === 'scaleX' && component === 'scaleX') return scaleValue(args[0]);
  if (operation.type === 'scaleY' && component === 'scaleY') return scaleValue(args[0]);
  if (operation.type === 'scale') {
    if (component === 'scaleX') return scaleValue(args[0]);
    if (component === 'scaleY') return scaleValue(args[1] || args[0]);
  }
  if (operation.type === 'rotate' && component === 'rotate') return angleValue(args[0]);
  if (operation.type === 'skewX' && component === 'skewX') return angleValue(args[0]);
  if (operation.type === 'skewY' && component === 'skewY') return angleValue(args[0]);
  if (operation.type === 'skew') {
    if (component === 'skewX') return angleValue(args[0]);
    if (component === 'skewY') return angleValue(args[1] || '0deg');
  }
  return null;
}

function operationAccepts(operation, component) {
  return operationValue(operation, component) != null;
}

function updateOperation(operation, component, value) {
  if (operation.type === 'translate') {
    operation.args = [
      component === 'translateX' ? lengthValue(value) : lengthValue(operation.args[0]),
      component === 'translateY' ? lengthValue(value) : lengthValue(operation.args[1] || '0px'),
    ];
  } else if (operation.type === 'scale') {
    operation.args = [
      component === 'scaleX' ? scaleValue(value) : scaleValue(operation.args[0]),
      component === 'scaleY' ? scaleValue(value) : scaleValue(operation.args[1] || operation.args[0]),
    ];
  } else if (operation.type === 'skew') {
    operation.args = [
      component === 'skewX' ? angleValue(value) : angleValue(operation.args[0]),
      component === 'skewY' ? angleValue(value) : angleValue(operation.args[1] || '0deg'),
    ];
  } else if (component.startsWith('translate')) {
    operation.args = [lengthValue(value)];
  } else if (component.startsWith('scale')) {
    operation.args = [scaleValue(value)];
  } else {
    operation.args = [angleValue(value)];
  }
}

function appendOperation(component, value) {
  if (component.startsWith('translate')) return { type: component, args: [lengthValue(value)] };
  if (component.startsWith('scale')) return { type: component, args: [scaleValue(value)] };
  return { type: component, args: [angleValue(value)] };
}

export function isTransformComponent(property) {
  return TRANSFORM_COMPONENTS.has(property);
}

export function decomposeTransform(transform = 'none', transformOrigin = '50% 50%') {
  const source = String(transform || 'none').trim() || 'none';
  const origin = parseOrigin(transformOrigin);
  if (source === 'none') {
    return {
      reliable: true,
      classification: 'direct',
      format: 'functions',
      source,
      origin,
      operations: [],
    };
  }
  if (COMPLEX_TRANSFORM_PATTERN.test(source)) {
    return {
      reliable: false,
      classification: 'code',
      reason: /\b(?:var|calc|min|max|clamp)\s*\(/i.test(source) ? 'procedural' : 'complex-3d',
      format: 'unsupported',
      source,
      origin,
      operations: [],
    };
  }

  const operations = [];
  let consumedUntil = 0;
  let match;
  FUNCTION_PATTERN.lastIndex = 0;
  while ((match = FUNCTION_PATTERN.exec(source))) {
    if (source.slice(consumedUntil, match.index).trim()) {
      return {
        reliable: false,
        classification: 'code',
        reason: 'unparsed-transform',
        format: 'unsupported',
        source,
        origin,
        operations: [],
      };
    }
    const type = match[1];
    const args = splitArgs(match[2]);
    const supported = new Set([
      'matrix',
      'translate',
      'translateX',
      'translateY',
      'scale',
      'scaleX',
      'scaleY',
      'rotate',
      'skew',
      'skewX',
      'skewY',
    ]);
    if (!supported.has(type)) {
      return {
        reliable: false,
        classification: 'code',
        reason: 'unsupported-transform',
        format: 'unsupported',
        source,
        origin,
        operations: [],
      };
    }
    if (type === 'matrix') {
      const components = decomposeMatrix(args);
      if (!components || operations.length || source.slice(FUNCTION_PATTERN.lastIndex).trim()) {
        return {
          reliable: false,
          classification: 'code',
          reason: 'invalid-matrix',
          format: 'unsupported',
          source,
          origin,
          operations: [],
        };
      }
      return {
        reliable: true,
        classification: 'direct',
        format: 'matrix',
        source,
        origin,
        operations: [{ type: 'matrix', args: args.map(String), components }],
      };
    }
    operations.push({ type, args });
    consumedUntil = FUNCTION_PATTERN.lastIndex;
  }
  if (!operations.length || source.slice(consumedUntil).trim()) {
    return {
      reliable: false,
      classification: 'code',
      reason: 'unparsed-transform',
      format: 'unsupported',
      source,
      origin,
      operations: [],
    };
  }
  try {
    TRANSFORM_COMPONENTS.forEach((component) => {
      if (component.startsWith('transformOrigin')) return;
      operations.forEach((operation) => {
        if (operationAccepts(operation, component)) operationValue(operation, component);
      });
    });
  } catch {
    return {
      reliable: false,
      classification: 'code',
      reason: 'invalid-component',
      format: 'unsupported',
      source,
      origin,
      operations: [],
    };
  }
  return {
    reliable: true,
    classification: 'direct',
    format: 'functions',
    source,
    origin,
    operations,
  };
}

export function transformComponentValue(state, component) {
  if (!state?.reliable || !TRANSFORM_COMPONENTS.has(component)) return null;
  if (component === 'transformOriginX') return state.origin[0];
  if (component === 'transformOriginY') return state.origin[1];
  if (state.format === 'matrix') {
    const value = state.operations[0].components[component];
    if (component.startsWith('translate')) return `${numberText(value)}px`;
    if (component === 'rotate' || component.startsWith('skew')) return `${numberText(value)}deg`;
    return numberText(value);
  }
  for (let index = state.operations.length - 1; index >= 0; index -= 1) {
    const value = operationValue(state.operations[index], component);
    if (value != null) return value;
  }
  if (component.startsWith('translate') || component.startsWith('skew') || component === 'rotate') {
    return component.startsWith('translate') ? '0px' : '0deg';
  }
  return '1';
}

export function updateTransformComponent(state, component, value) {
  if (!state?.reliable || !TRANSFORM_COMPONENTS.has(component)) {
    throw new TypeError('The transform cannot be decomposed safely');
  }
  const next = cloneState(state);
  if (component === 'transformOriginX') {
    next.origin[0] = String(value).trim();
    return next;
  }
  if (component === 'transformOriginY') {
    next.origin[1] = String(value).trim();
    return next;
  }
  if (next.format === 'matrix') {
    const components = next.operations[0].components;
    if (component.startsWith('translate')) components[component] = numeric(lengthValue(value));
    else if (component === 'rotate' || component.startsWith('skew')) components[component] = numeric(angleValue(value));
    else components[component] = numeric(scaleValue(value), 1);
    return next;
  }
  const operation = next.operations.findLast((candidate) => operationAccepts(candidate, component));
  if (operation) updateOperation(operation, component, value);
  else next.operations.push(appendOperation(component, value));
  return next;
}

export function serializeTransform(state) {
  if (!state?.reliable) return state?.source || 'none';
  if (state.format === 'matrix') {
    const {
      translateX,
      translateY,
      scaleX,
      scaleY,
      rotate,
      skewX,
    } = state.operations[0].components;
    const radians = rotate * (Math.PI / 180);
    const skew = Math.tan(skewX * (Math.PI / 180));
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const a = cos * scaleX;
    const b = sin * scaleX;
    const c = ((cos * skew) - sin) * scaleY;
    const d = ((sin * skew) + cos) * scaleY;
    return `matrix(${[a, b, c, d, translateX, translateY].map((value) => numberText(value)).join(', ')})`;
  }
  if (!state.operations.length) return 'none';
  return state.operations
    .map((operation) => `${operation.type}(${operation.args.join(', ')})`)
    .join(' ');
}

export function serializeTransformOrigin(state) {
  return state?.origin?.join(' ') || '50% 50%';
}
