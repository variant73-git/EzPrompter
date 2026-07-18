export const NODE_KIND_META = {
  site: { label: 'Site', color: '#2966EA', width: 1280, height: 800 },
  designmd: { label: 'design.md', color: '#EEA665', width: 560, height: 760 },
  prompt: { label: 'Prompt', color: '#ECEBF1', width: 420, height: 300 },
  asset: { label: 'Image', color: '#7951C2', width: 560, height: 560 },
  skill: { label: 'Code', color: '#F472B6', width: 620, height: 480 },
  chunk: { label: 'HTML', color: '#F97316', width: 720, height: 620 },
};

const node = (key, kind, label, col, row = 0, meta = {}) => ({ key, kind, label, col, row, meta });
const edge = (from, to, kind = 'generic') => ({ from, to, kind });

export const BUILTIN_WORKFLOWS = [
  {
    id: 'builder',
    name: 'Builder',
    eyebrow: 'From an idea',
    description: 'Turn an editable brief into a complete website, then keep refining both sides of the chain.',
    accent: '#2966EA',
    icon: 'sparkles',
    featuredSpan: 3,
    primary: true,
    nodes: [node('brief', 'prompt', 'Website brief', 0), node('result', 'site', 'Generated website', 1)],
    edges: [edge('brief', 'result')],
  },
  {
    id: 'clone',
    name: 'Clone / Recreate',
    eyebrow: 'From an existing site',
    description: 'Capture a live site as source material and rebuild it as an editable result.',
    accent: '#F97316',
    icon: 'copy',
    featuredSpan: 2,
    primary: true,
    nodes: [node('source', 'site', 'Source website', 0), node('result', 'site', 'Editable recreation', 1)],
    edges: [edge('source', 'result')],
  },
  {
    id: 'style-website',
    name: 'Style Transplant from Website',
    eyebrow: 'Target + live reference',
    description: 'Keep one site’s structure while transplanting the design language of another.',
    accent: '#EEA665',
    icon: 'palette',
    featuredSpan: 2,
    primary: true,
    nodes: [
      node('target', 'site', 'Target website', 0, 0),
      node('reference', 'site', 'Style reference', 0, 1),
      node('tokens', 'designmd', 'Extracted design.md', 1),
      node('result', 'site', 'Restyled website', 2),
    ],
    edges: [edge('reference', 'tokens'), edge('target', 'result'), edge('tokens', 'result', 'token-swap')],
  },
  {
    id: 'style-screenshot',
    name: 'Style Transplant from Screenshot',
    eyebrow: 'Target + screenshot',
    description: 'Extract visual language from a screenshot and apply it to an editable target site.',
    accent: '#7951C2',
    icon: 'scan',
    featuredSpan: 2,
    primary: true,
    nodes: [
      node('target', 'site', 'Target website', 0, 0),
      node('screenshot', 'asset', 'Style screenshot', 0, 1),
      node('tokens', 'designmd', 'Extracted design.md', 1),
      node('result', 'site', 'Restyled website', 2),
    ],
    edges: [edge('screenshot', 'tokens'), edge('target', 'result'), edge('tokens', 'result', 'token-swap')],
  },
  {
    id: 'multiple-references',
    name: 'Website from Multiple References',
    eyebrow: 'Curated synthesis',
    description: 'Combine structure, visual language, imagery, and intent from separate references into one original site.',
    accent: '#2966EA',
    icon: 'layers',
    featuredSpan: 3,
    primary: true,
    nodes: [
      node('brief', 'prompt', 'Creative direction', 0, 0),
      node('structure', 'site', 'Structure reference', 0, 1),
      node('visual', 'asset', 'Visual reference', 0, 2),
      node('tokens', 'designmd', 'Synthesized design.md', 1),
      node('result', 'site', 'Original website', 2),
    ],
    edges: [edge('visual', 'tokens'), edge('brief', 'result'), edge('structure', 'result'), edge('tokens', 'result', 'token-swap')],
  },
  {
    id: 'site-md-site',
    name: 'Extract and Reapply a Design System',
    eyebrow: 'Site → design.md → site',
    description: 'Turn a site into reusable tokens, then apply those tokens to a new website.',
    accent: '#EEA665',
    icon: 'file',
    featuredSpan: 2,
    nodes: [node('source', 'site', 'Source website', 0), node('tokens', 'designmd', 'design.md', 1), node('result', 'site', 'New website', 2)],
    edges: [edge('source', 'tokens'), edge('tokens', 'result', 'token-swap')],
  },
  {
    id: 'hero-remix',
    name: 'Hero Remix',
    eyebrow: 'Site → prompt → site',
    description: 'Isolate the intent of a hero, rewrite its direction, and generate an alternate site.',
    accent: '#ECEBF1',
    icon: 'message',
    featuredSpan: 2,
    nodes: [node('source', 'site', 'Source website', 0), node('hero', 'prompt', 'Hero direction', 1), node('result', 'site', 'Hero variation', 2)],
    edges: [edge('source', 'hero'), edge('hero', 'result')],
  },
  {
    id: 'image-md-site',
    name: 'Website from an Image System',
    eyebrow: 'Image → design.md → site',
    description: 'Read color, type, rhythm, and composition from one image before generating a site.',
    accent: '#7951C2',
    icon: 'image',
    featuredSpan: 2,
    nodes: [node('image', 'asset', 'Visual reference', 0), node('tokens', 'designmd', 'design.md', 1), node('result', 'site', 'Generated website', 2)],
    edges: [edge('image', 'tokens'), edge('tokens', 'result', 'token-swap')],
  },
  {
    id: 'image-plus-md',
    name: 'Image + Design System to Website',
    eyebrow: 'Composition + rules',
    description: 'Use an image for art direction and an existing design.md for consistent implementation.',
    accent: '#7951C2',
    icon: 'combine',
    featuredSpan: 2,
    nodes: [node('image', 'asset', 'Visual reference', 0, 0), node('tokens', 'designmd', 'Existing design.md', 0, 1), node('result', 'site', 'Generated website', 1)],
    edges: [edge('image', 'result'), edge('tokens', 'result', 'token-swap')],
  },
  {
    id: 'screenshot-md-site',
    name: 'Screenshot to Website System',
    eyebrow: 'Screenshot → design.md → site',
    description: 'Translate a screenshot into explicit design rules before producing a responsive site.',
    accent: '#7951C2',
    icon: 'scan',
    featuredSpan: 2,
    nodes: [node('shot', 'asset', 'Screenshot', 0), node('tokens', 'designmd', 'design.md', 1), node('result', 'site', 'Responsive website', 2)],
    edges: [edge('shot', 'tokens'), edge('tokens', 'result', 'token-swap')],
  },
  {
    id: 'screenshot-plus-md',
    name: 'Screenshot + Design System to Website',
    eyebrow: 'Screenshot + design.md → site',
    description: 'Use a screenshot for composition while an existing design.md controls the implementation rules.',
    accent: '#7951C2',
    icon: 'scan',
    featuredSpan: 2,
    nodes: [node('shot', 'asset', 'Screenshot', 0, 0), node('tokens', 'designmd', 'Existing design.md', 0, 1), node('result', 'site', 'Generated website', 1)],
    edges: [edge('shot', 'result'), edge('tokens', 'result', 'token-swap')],
  },
  {
    id: 'brand-image-site',
    name: 'Brand Guideline + Image to Website',
    eyebrow: 'Brand constraints + art direction',
    description: 'Balance explicit brand rules with the atmosphere and composition of an image.',
    accent: '#EEA665',
    icon: 'book',
    featuredSpan: 3,
    nodes: [node('brand', 'designmd', 'Brand guideline', 0, 0), node('image', 'asset', 'Art direction', 0, 1), node('result', 'site', 'On-brand website', 1)],
    edges: [edge('brand', 'result', 'token-swap'), edge('image', 'result')],
  },
  {
    id: 'image-fusion-site',
    name: 'Image Fusion to Website',
    eyebrow: 'Image + image → image → site',
    description: 'Generate a new visual from two references, then use it as the art direction for a site.',
    accent: '#7951C2',
    icon: 'blend',
    featuredSpan: 3,
    nodes: [
      node('image-a', 'asset', 'Reference image A', 0, 0),
      node('image-b', 'asset', 'Reference image B', 0, 1),
      node('fusion', 'asset', 'Generated art direction', 1),
      node('result', 'site', 'Generated website', 2),
    ],
    edges: [edge('image-a', 'fusion'), edge('image-b', 'fusion'), edge('fusion', 'result')],
  },
  {
    id: 'brand-md-site',
    name: 'Merge Brand and Product Systems',
    eyebrow: 'Brand guideline + design.md → site',
    description: 'Reconcile brand rules with an existing product design system before generating a site.',
    accent: '#EEA665',
    icon: 'merge',
    featuredSpan: 2,
    nodes: [node('brand', 'designmd', 'Brand guideline', 0, 0), node('system', 'designmd', 'Product design.md', 0, 1), node('result', 'site', 'Unified website', 1)],
    edges: [edge('brand', 'result', 'token-swap'), edge('system', 'result', 'token-swap')],
  },
  {
    id: 'brand-to-system',
    name: 'Operationalize a Brand Guideline',
    eyebrow: 'Brand guideline → design.md → site',
    description: 'Convert prose-heavy brand guidance into practical tokens and prove them in a working page.',
    accent: '#EEA665',
    icon: 'wand',
    featuredSpan: 2,
    nodes: [node('brand', 'designmd', 'Brand guideline', 0), node('tokens', 'designmd', 'Operational design.md', 1), node('result', 'site', 'Validation website', 2)],
    edges: [edge('brand', 'tokens'), edge('tokens', 'result', 'token-swap')],
  },
  {
    id: 'motion-transplant',
    name: 'Motion and Shader Transplant',
    eyebrow: 'Site + React shader → site',
    description: 'Bring a reusable motion or shader skill into a site without losing its existing structure.',
    accent: '#F472B6',
    icon: 'code',
    featuredSpan: 2,
    nodes: [node('target', 'site', 'Target website', 0, 0), node('shader', 'skill', 'React shader', 0, 1, { subtype: 'shader' }), node('result', 'site', 'Motion-enhanced website', 1)],
    edges: [edge('target', 'result'), edge('shader', 'result')],
  },
  {
    id: 'feedback-revision',
    name: 'Feedback-Led Revision',
    eyebrow: 'Site + feedback prompt → site',
    description: 'Keep a precise critique beside the source and produce a traceable revision.',
    accent: '#ECEBF1',
    icon: 'pin',
    featuredSpan: 2,
    nodes: [node('source', 'site', 'Website', 0, 0), node('feedback', 'prompt', 'Feedback', 0, 1), node('revision', 'site', 'Revised website', 1)],
    edges: [edge('source', 'revision'), edge('feedback', 'revision')],
  },
];

export function layoutWorkflowNodes(nodes) {
  const byCol = new Map();
  for (const item of nodes) {
    const col = Number(item.col ?? 0);
    if (!byCol.has(col)) byCol.set(col, []);
    byCol.get(col).push(item);
  }
  const cols = [...byCol.keys()].sort((a, b) => a - b);
  const colX = new Map();
  let x = 600;
  for (const col of cols) {
    colX.set(col, x);
    const maxWidth = Math.max(...byCol.get(col).map((item) => item.width || NODE_KIND_META[item.kind]?.width || 560));
    x += maxWidth + 360;
  }
  return nodes.map((item) => {
    const siblings = [...byCol.get(Number(item.col ?? 0))].sort((a, b) => Number(a.row ?? 0) - Number(b.row ?? 0));
    const index = siblings.findIndex((candidate) => candidate.key === item.key);
    let y = 700;
    for (let i = 0; i < index; i += 1) {
      const previous = siblings[i];
      y += (previous.height || NODE_KIND_META[previous.kind]?.height || 560) + 260;
    }
    const defaults = NODE_KIND_META[item.kind] || NODE_KIND_META.site;
    return {
      ...item,
      posX: item.posX ?? colX.get(Number(item.col ?? 0)),
      posY: item.posY ?? y,
      width: item.width || defaults.width,
      height: item.height || defaults.height,
    };
  });
}

export function savedWorkflowToTemplate(row) {
  const definition = row?.definition && typeof row.definition === 'object' ? row.definition : {};
  return {
    id: `saved-${row.id}`,
    savedId: row.id,
    name: row.name || 'Saved workflow',
    eyebrow: 'Your workflow',
    description: row.description || 'A reusable node chain saved from your canvas.',
    accent: '#B5B3AC',
    icon: 'bookmark',
    featuredSpan: 2,
    saved: true,
    nodes: definition.nodes || [],
    edges: definition.edges || [],
  };
}
