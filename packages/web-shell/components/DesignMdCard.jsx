'use client';

import { swatchInk } from '../lib/design-md-preview.js';

// Click-to-copy feedback, anchored to the PRODUCT spec: "uma mensagem de
// feedback próxima ao cursor do mouse". Imperative on purpose — a fixed,
// pointer-events-none toast at the click point, removed after it fades.
async function copyHexAtCursor(hex, event) {
  // Capture coordinates BEFORE awaiting — React pools/neutralizes the event.
  const x = event.clientX;
  const y = event.clientY;
  // writeText is a PROMISE: a sync try/catch missed permission failures and
  // the toast lied "Copied" (Sol 2026-08-17 #2). Await it; say what happened.
  let copied = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(hex);
      copied = true;
    }
  } catch { /* denied or unavailable */ }
  const toast = document.createElement('div');
  toast.className = 'dmd-copy-toast';
  toast.textContent = copied ? `Copied ${hex}` : 'Copy failed';
  toast.style.left = `${x + 12}px`;
  toast.style.top = `${y - 8}px`;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 180); }, 900);
}

const CopyGlyph = ({ ink }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={ink} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

/**
 * DesignMdCard — the Aura-style DESIGN.MD presentation (product spec
 * 2026-08-17). ONE component, two surfaces:
 *   variant="panel" — the inspector section shown when a cloned site /
 *                     design node is selected on the canvas;
 *   variant="node"  — the .md node body, painted in the SYSTEM's own
 *                     surface/ink so the card previews the design it carries.
 *
 * Colors: a proportional bar (segment width = measured pixel share from the
 * capture screenshot; token palettes fall back to equal segments) over a
 * legend of role + hex. Typography: each role's FAMILY NAME set in its own
 * font at a proportional specimen size (largest role = 40px cap), with the
 * metadata ("64px / w500 · Display Lg") in the neutral UI type.
 */
export default function DesignMdCard({ model, variant = 'panel' }) {
  if (!model) return null;
  const { colorRows = [], typeRoles = [], hasTypography } = model;
  const isNode = variant === 'node';
  const style = isNode
    ? { background: model.surface, color: model.ink }
    : undefined;

  return (
    <div className={`dmd-card dmd-${variant}`} style={style}>
      {isNode && (
        <header className="dmd-header">
          <span>Design.md</span>
          <strong>{model.title}</strong>
        </header>
      )}

      {colorRows.length > 0 && (
        <section className="dmd-section" aria-label="Color palette">
          <h4 className="dmd-section-title">Colors</h4>
          <div className="dmd-color-bar" aria-label="Color proportions">
            {colorRows.map((row, i) => (
              <button
                type="button"
                key={row.hex + i}
                className="dmd-chip"
                title={`${row.hex}${row.share != null ? ` · ${Math.round(row.share * 100)}%` : ''} — click to copy`}
                onClick={(e) => copyHexAtCursor(row.hex, e)}
                style={{
                  background: row.hex,
                  flexGrow: row.share != null ? Math.max(row.share, 0.04) : 1,
                }}
              >
                <CopyGlyph ink={swatchInk(row.hex)} />
              </button>
            ))}
          </div>
          <ul className="dmd-color-legend">
            {colorRows.slice(0, 6).map((row, i) => (
              <li key={row.hex + i}>
                <i style={{ background: row.hex }} />
                <span>{row.role || `Color ${String(i + 1).padStart(2, '0')}`}</span>
                <b>{row.hex}</b>
              </li>
            ))}
          </ul>
        </section>
      )}

      {hasTypography && typeRoles.length > 0 && (
        <section className="dmd-section" aria-label="Typography">
          <h4 className="dmd-section-title">Typography</h4>
          {typeRoles.map((t) => (
            <div className="dmd-type-row" key={t.role}>
              <div
                className="dmd-type-specimen"
                style={{
                  fontFamily: `'${t.family}', system-ui, sans-serif`,
                  fontSize: t.specimenPx,
                  fontWeight: t.weight,
                }}
              >
                {t.family}
              </div>
              <div className="dmd-type-meta">
                <span>{t.label}</span>
                <b>{t.size}px / w{t.weight}</b>
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
