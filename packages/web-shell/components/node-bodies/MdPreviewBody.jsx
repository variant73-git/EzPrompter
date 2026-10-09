'use client';

import { useMemo } from 'react';
import { designMdPreviewModel, swatchInk } from '../../lib/design-md-preview.js';

export default function MdPreviewBody({ node }) {
  const preview = useMemo(() => {
    const md = node.current_design_md || node.design_md || '';
    return designMdPreviewModel(md, node.meta?.name);
  }, [node.current_design_md, node.design_md, node.meta?.name]);

  const { surface, ink, accents, headingFont, bodyFont, palette, scale, sampleSize, title } = preview;
  const accent = accents[0] || ink;

  // Sizes are in source-document px. The node body itself can be any size,
  // so we keep them absolute — when the canvas zooms, the whole node scales
  // alongside. The user gets a faithful sample of the design system's scale.
  return (
    <div
      className="cnode-md-preview"
      style={{
        background: surface,
        color: ink,
        fontFamily: `'${bodyFont}', system-ui, sans-serif`
      }}
    >
      <header className="cnode-md-preview-header">
        <span>Design map</span>
        <strong>{title}</strong>
      </header>

      <div className="cnode-md-preview-type">
        <div
          className="cnode-md-preview-glyph"
          style={{
            fontFamily: `'${headingFont}', system-ui, sans-serif`,
            fontSize: sampleSize,
            color: ink,
          }}
        >
          Aa
        </div>
        <div className="cnode-md-preview-fonts">
          <div><span>Display</span><strong style={{ fontFamily: `'${headingFont}', system-ui, sans-serif` }}>{headingFont}</strong></div>
          <div><span>Text</span><strong style={{ fontFamily: `'${bodyFont}', system-ui, sans-serif` }}>{bodyFont}</strong></div>
        </div>
      </div>

      <div className="cnode-md-preview-scale" aria-label="Modular type scale">
        {scale.map((item) => (
          <div className="cnode-md-preview-scale-row" key={item.role}>
            <span>{item.role}</span>
            <i style={{ background: item.role === 'H2' ? accent : ink, width: `${Math.min(100, Math.max(20, item.size / scale[0].size * 100))}%` }} />
            <b>{item.size}</b>
          </div>
        ))}
      </div>

      <div className="cnode-md-preview-palette">
        {palette.slice(0, 6).map((c, i) => (
          <div
            key={c + i}
            className="cnode-md-preview-swatch"
            style={{ background: c, color: swatchInk(c) }}
            title={c}
          >
            <span>{String(i + 1).padStart(2, '0')}</span>
            <b>{c}</b>
          </div>
        ))}
      </div>
    </div>
  );
}
