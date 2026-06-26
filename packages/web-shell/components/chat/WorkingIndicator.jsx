'use client';

import { useEffect, useState } from 'react';

// "working on it" in 10 languages — cycled while the agent works.
export const WORKING_PHRASES = [
  'working on it',
  'trabalhando nisso',
  'trabajando en ello',
  "j'y travaille",
  'ich arbeite daran',
  'ci sto lavorando',
  '作業中です',
  '正在处理',
  'работаю над этим',
  'جاري العمل',
];

const CYCLE_MS = 1500;

// Build the inline style for the text: solid node color for one category,
// a gradient across categories when more than one distinct node color is
// involved, accent fallback when none.
export function colorStyle(colors) {
  const uniq = [...new Set((colors || []).filter(Boolean))];
  if (uniq.length > 1) {
    // Repeat the first colour at the end + 200% background so the gradient can
    // scroll seamlessly (the .is-gradient class animates background-position).
    return {
      backgroundImage: `linear-gradient(90deg, ${[...uniq, uniq[0]].join(', ')})`,
      backgroundSize: '200% auto',
      WebkitBackgroundClip: 'text',
      backgroundClip: 'text',
      color: 'transparent',
    };
  }
  return { color: uniq[0] || 'var(--accent)' };
}

/**
 * Animated "working on it" feedback shown while the agent runs. The phrase
 * changes language every 1.5s with a fade. Colored by the involved node's
 * category (or a gradient of categories). `dots` appends an animated "…".
 */
export default function WorkingIndicator({ colors = [], dots = false, className = '' }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((v) => (v + 1) % WORKING_PHRASES.length), CYCLE_MS);
    return () => clearInterval(id);
  }, []);
  const style = colorStyle(colors);
  // More than one distinct node colour → animate the gradient (is-gradient).
  const isGradient = [...new Set((colors || []).filter(Boolean))].length > 1;
  const g = isGradient ? ' is-gradient' : '';
  return (
    <span className={`working-indicator ${className}`.trim()} aria-live="polite">
      <span key={i} className={`working-indicator-text${g}`} style={style}>{WORKING_PHRASES[i]}</span>
      {dots && <span className={`working-indicator-dots${g}`} style={style}>…</span>}
    </span>
  );
}
