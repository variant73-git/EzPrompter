// lib/billing/pricing.js
/**
 * Per-operation pricing — the ONE place business levers live (spec §3).
 * mult = multiplier over real µ¢ cost · floorCredits = value floor ·
 * flat = fixed price (no token cost, e.g. static site clone) ·
 * free/meterOnly = charge 0 (usage still recorded).
 * Longest-prefix match: 'extract.clone' beats 'extract'.
 */
// Fixed customer price for one successful, explicit live-reference conversion.
export const CLONE_EDIT_CREDIT_ESTIMATE = 275;

export const OP_PRICING = {
  'clone.edit':         { flat: CLONE_EDIT_CREDIT_ESTIMATE },
  'compose':            { mult: 3 },
  'extract':            { mult: 3 },
  'extract.clone':      { mult: 4 },
  'extract.styleclone': { mult: 4 },
  'extract.html':       { flat: 25 },
  'transplant':         { mult: 3 },
  'edit':               { mult: 3 },
  'reconstruct':        { mult: 10, floorCredits: 150 },
  'image.generate':     { mult: 4 },
  'chat':               { free: true },
  'capture':            { free: true },
};

export function pricingFor(op) {
  let key = String(op || '');
  while (key) {
    if (OP_PRICING[key]) return OP_PRICING[key];
    const i = key.lastIndexOf('.');
    key = i === -1 ? '' : key.slice(0, i);
  }
  return { mult: 3 }; // conservative default for unmapped ops
}

export function roundCredits(raw) {
  return Math.max(5, Math.ceil(raw / 5) * 5);
}

export function creditsForOperation({ op, totalMicrocents = 0 }) {
  const p = pricingFor(op);
  if (p.free) return 0;
  if (p.flat != null) return p.flat;
  const raw = (totalMicrocents * (p.mult || 3)) / 10_000; // µ¢ → credits (1 credit = 1¢)
  const rounded = roundCredits(raw);
  return p.floorCredits != null ? Math.max(p.floorCredits, rounded) : rounded;
}

// Pre-flight estimates (spec §4) — recalibrate later from ledger data.
export const OP_ESTIMATES = {
  'extract.clone': 250,
  'extract.styleclone': 300,
  'extract.html': 25,
  'extract': 30,
  'compose': 75,
  'transplant': 75,
  'edit': 50,
  'clone.edit': CLONE_EDIT_CREDIT_ESTIMATE,
  'reconstruct': 200,
  'image.generate.openai': 100,
  'image.generate.gemini': 20,
  'image.generate': 100,
  'chat': 0,
  'capture': 0,
};

export function estimateOp(op) {
  let key = String(op || '');
  while (key) {
    if (OP_ESTIMATES[key] != null) return OP_ESTIMATES[key];
    const i = key.lastIndexOf('.');
    key = i === -1 ? '' : key.slice(0, i);
  }
  return 30;
}

export function estimateChain(ops) {
  return (ops || []).reduce((sum, op) => sum + estimateOp(op), 0);
}
