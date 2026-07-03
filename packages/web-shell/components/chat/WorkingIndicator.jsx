'use client';

import { useEffect, useState } from 'react';

// IDE-style "code being written" indicator shown while the agent works.
// Fake, ILLUSTRATIVE code lines — deliberately not real project code, so
// nothing sensitive can ever leak into the UI.
//
// Terminal-overwrite model: the indicator is ALWAYS exactly MAX_LEN chars
// wide (lines padded with spaces). Each new line overwrites the previous
// one character by character — a block write-head with a scramble glyph
// advances over the old text, "decrypting" the new line in real time.
// The whole text is painted with an animated gradient built from the five
// pastel syntax colors (blue, light green, yellow, pink, white — no red).
export const CODE_LINES = [
  "const node = canvas.createNode('site')",
  'await layout.place(node, { gap: 40 })',
  'const brief = extractStyle(image)',
  'edges.connect(prompt, node).run()',
  'const palette = samplePixels(hero)',
  'render(snapshot, { width: 1280 })',
  'applyTokens({ radius: 12, blur: 28 })',
  'await compose(sources, { model })',
];

export const CHAR_MS = 16;      // typing speed per character (2× the original)
export const HOLD_TICKS = 34;   // ~550ms rest on the finished line
export const MAX_LEN = Math.max(...CODE_LINES.map((l) => l.length));

const PADDED = CODE_LINES.map((l) => l.padEnd(MAX_LEN, ' '));
const BLANK = ' '.repeat(MAX_LEN);

// Glyph pool for the scramble character inside the write head.
const GLYPHS = '{}[]()<>=+*/$#@%&;:';

/**
 * Animated code-typing feedback shown while the agent runs. Constant-width;
 * each line overwrites the previous one char-by-char. The write-head block
 * picks up the involved node's category color (accent fallback).
 */
export default function WorkingIndicator({ colors = [], className = '' }) {
  const [pos, setPos] = useState({ line: 0, prev: null, chars: 0 });
  useEffect(() => {
    const id = setInterval(() => {
      setPos(({ line, prev, chars }) => {
        if (chars < MAX_LEN + HOLD_TICKS) return { line, prev, chars: chars + 1 };
        return { line: (line + 1) % CODE_LINES.length, prev: line, chars: 0 };
      });
    }, CHAR_MS);
    return () => clearInterval(id);
  }, []);

  const typed = Math.min(pos.chars, MAX_LEN);
  const isTyping = typed < MAX_LEN;
  // What the write head hasn't reached yet still shows the PREVIOUS line
  // (blank on the very first sweep) — the overwrite effect.
  const oldBase = pos.prev == null ? BLANK : PADDED[pos.prev];
  const headGlyph = isTyping ? GLYPHS[Math.floor(Math.random() * GLYPHS.length)] : null;
  const caretColor = (colors || []).filter(Boolean)[0] || 'var(--accent)';

  return (
    <span className={`working-indicator ${className}`.trim()} role="status" aria-label="working">
      <span className="working-indicator-code" aria-hidden="true">
        <span className="wi-new">{PADDED[pos.line].slice(0, typed)}</span>
        {isTyping && (
          <span className="wi-head" style={{ background: caretColor }}>{headGlyph}</span>
        )}
        {isTyping && <span className="wi-old">{oldBase.slice(typed + 1)}</span>}
      </span>
    </span>
  );
}
