'use client';

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
          <div className="dmd-color-bar" role="img" aria-label="Color proportions">
            {colorRows.map((row, i) => (
              <span
                key={row.hex + i}
                title={`${row.hex}${row.share != null ? ` · ${Math.round(row.share * 100)}%` : ''}`}
                style={{
                  background: row.hex,
                  flexGrow: row.share != null ? Math.max(row.share, 0.04) : 1,
                }}
              />
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
