'use client';

import { useMemo } from 'react';
import { parseDesignMdTokens, defaultTokens } from '../../lib/md-tokens.js';

const LOREM_H1 = 'Lorem ipsum dolor';
const LOREM_H2 = 'Sit amet consectetur';
const LOREM_BODY =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Praesent ' +
  'condimentum, nibh quis suscipit pulvinar, eros felis tincidunt nibh, ' +
  'vitae fermentum dolor velit ac libero.';

export default function MdPreviewBody({ node }) {
  const tokens = useMemo(() => {
    const md = node.current_design_md || node.design_md || '';
    return md ? parseDesignMdTokens(md) : defaultTokens();
  }, [node.current_design_md, node.design_md]);

  const { surface, ink, accents, headingFont, bodyFont, sizes, palette } = tokens;
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
      <div className="cnode-md-preview-stack">
        <div
          className="cnode-md-preview-h1"
          style={{
            fontFamily: `'${headingFont}', system-ui, sans-serif`,
            fontSize: sizes.h1,
            color: ink
          }}
        >
          {LOREM_H1}
        </div>
        <div
          className="cnode-md-preview-h2"
          style={{
            fontFamily: `'${headingFont}', system-ui, sans-serif`,
            fontSize: sizes.h2,
            color: accent
          }}
        >
          {LOREM_H2}
        </div>
        <div
          className="cnode-md-preview-body"
          style={{ fontSize: sizes.body, color: ink, opacity: 0.8 }}
        >
          {LOREM_BODY}
        </div>
      </div>

      <div className="cnode-md-preview-palette">
        {palette.slice(0, 6).map((c, i) => (
          <span
            key={c + i}
            className="cnode-md-preview-swatch"
            style={{ background: c }}
            title={c}
          />
        ))}
      </div>
    </div>
  );
}
