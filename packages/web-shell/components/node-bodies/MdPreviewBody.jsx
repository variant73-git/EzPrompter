'use client';

import { useMemo } from 'react';
import { designPanelModel } from '../../lib/design-md-preview.js';
import DesignMdCard from '../DesignMdCard.jsx';

// The .md node body copies the DESIGN.MD panel format EXACTLY (product spec
// 2026-08-17 — Aura-style): proportional color bar + legend, typography with
// each family name set in its own font at proportional sizes. Painted in the
// system's own surface/ink so the card previews the design it carries.
export default function MdPreviewBody({ node }) {
  const model = useMemo(() => {
    const md = node.current_design_md || node.design_md || '';
    return designPanelModel({ md, name: node.meta?.name });
  }, [node.current_design_md, node.design_md, node.meta?.name]);

  return (
    <div className="cnode-md-preview" style={{ background: model.surface, color: model.ink }}>
      <DesignMdCard model={model} variant="node" />
    </div>
  );
}
