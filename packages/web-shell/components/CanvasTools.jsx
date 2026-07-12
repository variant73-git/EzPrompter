'use client';

// Floating tool rail, top-center — "Working Table" chrome (unspirit import,
// 2026-07-12). Select/Hand/Frame/Text/Draw are PLACEHOLDERS (disabled,
// honest tooltips) until real canvas tools ship; the "+" is live and opens
// the add-to-canvas menu at the viewport center.

const T = {
  Select: () => (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m4 3 7.5 18 2.2-7.3L21 11.5 4 3z"/>
    </svg>
  ),
  Hand: () => (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 11V6.5a1.5 1.5 0 0 0-3 0V11m0-6a1.5 1.5 0 0 0-3 0v5m0-4a1.5 1.5 0 0 0-3 0v7l-1.8-2.2a1.6 1.6 0 0 0-2.4 2L8.5 19a5 5 0 0 0 4 2h1a4.5 4.5 0 0 0 4.5-4.5V11"/>
    </svg>
  ),
  Frame: () => (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3v18M18 3v18M3 6h18M3 18h18"/>
    </svg>
  ),
  Text: () => (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 6V4h16v2M12 4v16M9 20h6"/>
    </svg>
  ),
  Draw: () => (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 19c-2.8 0-5-2.2-5-5 0-4 5-11 5-11s5 7 5 11c0 2.8-2.2 5-5 5z" transform="rotate(45 12 12)"/>
    </svg>
  ),
  Plus: () => (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5v14"/><path d="M5 12h14"/>
    </svg>
  )
};

const PLACEHOLDERS = [
  ['select', T.Select, 'Select — coming soon'],
  ['hand', T.Hand, 'Hand — coming soon'],
  ['frame', T.Frame, 'Frame — coming soon'],
  ['text', T.Text, 'Text — coming soon'],
  ['draw', T.Draw, 'Draw — coming soon'],
];

export default function CanvasTools({ onAdd }) {
  return (
    <div className="canvas-tools" role="toolbar" aria-label="Tools">
      {PLACEHOLDERS.map(([name, IconCmp, title], i) => (
        <button
          key={name}
          type="button"
          className={`canvas-tools-btn${i === 0 ? ' active' : ''}`}
          disabled
          title={title}
          aria-label={title}
        >
          <IconCmp />
        </button>
      ))}
      <i className="canvas-tools-sep" aria-hidden="true" />
      <button
        type="button"
        className="canvas-tools-btn canvas-tools-add"
        onClick={onAdd}
        title="Add to canvas"
        aria-label="Add to canvas"
      >
        <T.Plus />
      </button>
    </div>
  );
}
