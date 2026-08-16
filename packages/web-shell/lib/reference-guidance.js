const GUIDANCE_PREFIX = 'uncraft-reference-guidance:v1:';
const MAX_GUIDANCE_LENGTH = 1800;

function clean(value) {
  return String(value || '').trim().slice(0, MAX_GUIDANCE_LENGTH);
}

export function decodeReferenceGuidance(notes) {
  const stored = String(notes || '');
  if (!stored.startsWith(GUIDANCE_PREFIX)) {
    return { worthBorrowing: clean(stored), avoid: '' };
  }
  try {
    const parsed = JSON.parse(stored.slice(GUIDANCE_PREFIX.length));
    return {
      worthBorrowing: clean(parsed?.worthBorrowing),
      avoid: clean(parsed?.avoid),
    };
  } catch {
    return { worthBorrowing: '', avoid: '' };
  }
}

export function encodeReferenceGuidance({ worthBorrowing = '', avoid = '' } = {}) {
  const guidance = { worthBorrowing: clean(worthBorrowing), avoid: clean(avoid) };
  if (!guidance.worthBorrowing && !guidance.avoid) return null;
  return `${GUIDANCE_PREFIX}${JSON.stringify(guidance)}`;
}
