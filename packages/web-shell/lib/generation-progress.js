// Pure helpers for the node generation progress ring. No React, no DOM.
//
// The percentage is a reassurance ESTIMATE, not real progress: the backend
// emits discrete stages (and image generation emits nothing), so a true
// 0–100 does not exist. The curve climbs toward an asymptote of 95 and is
// replaced wholesale by the real result the instant generation finishes —
// at whatever number it was on. There is no "100% / done" state.

const ASYMPTOTE = 95;

// Typical wall-clock duration per generation path, in ms. `3τ ≈ duration`,
// so the curve reaches ~95% of the asymptote at roughly the typical time.
// Tune these with real telemetry later — they only affect pacing, never
// correctness (the ring is swapped out on the real `done`).
const DURATIONS_MS = {
  clone: 150000,   // site captured from a URL
  compose: 45000,  // blank site assembled from connected inputs
  image: 25000,    // createImage / asset generation
};

export function estimatedDurationMs(node) {
  if (!node) return DURATIONS_MS.compose;
  if (node.kind === 'image' || node.kind === 'asset') return DURATIONS_MS.image;
  if (node.kind === 'site' && node.origin_url) return DURATIONS_MS.clone;
  return DURATIONS_MS.compose;
}

// Eased exponential climb: pct = 95 · (1 − e^(−t/τ)), τ = duration / 3.
// Fast at first, decelerating, asymptotic at 95, never reaching 100.
export function progressAt(elapsedMs, durationMs) {
  const tau = durationMs / 3;
  const pct = ASYMPTOTE * (1 - Math.exp(-elapsedMs / tau));
  return Math.min(ASYMPTOTE, Math.round(pct));
}
