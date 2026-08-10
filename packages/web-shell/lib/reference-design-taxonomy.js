export const PRODUCT_TYPE_TAGS = [
  'landing-page',
  'product-page',
  'corporate-site',
  'portfolio',
  'agency-site',
  'saas',
  'tool',
  'app',
  'ecommerce',
  'marketplace',
  'editorial',
  'community',
  'event-campaign',
  'documentation',
];

export const STYLE_TAGS = [
  'soft-tech',
  'techy',
  'futuristic',
  'fancy',
  'corporate',
  'playful',
  'editorial',
  'fashion',
  'experimental',
  'luxury',
  'minimal',
];

export const MAX_STYLE_TAGS = 2;

export const BRAND_ATTRIBUTE_TAGS = [
  'playful',
  'extroverted',
  'sober',
  'neutral',
  'corporate',
  'authoritative',
  'approachable',
  'bold',
  'technical',
  'premium',
  'rebellious',
  'warm',
];

export const MAX_BRAND_ATTRIBUTES = 3;

export const DESIGN_INGREDIENTS = {
  structure: [
    'media-backed-hero',
    'split-hero',
    'offset-product-hero',
    'editorial-grid',
    'feature-columns',
    'horizontal-product-sequence',
    'pinned-step-sequence',
  ],
  alignment: ['centered', 'margin-left', 'offset-left', 'split', 'edge-anchored', 'edge-distributed', 'mixed'],
  palette: ['restrained-neutral', 'committed-brand-color', 'full-palette', 'drenched', 'earthy-neutral', 'high-contrast-product'],
  typography: ['neutral-grotesk', 'humanist-sans', 'geometric-sans', 'editorial-serif', 'display-serif', 'condensed-display', 'expressive-display'],
  motion: ['subtle', 'balanced', 'playful', 'scroll-narrative', 'product-demonstration', 'cinematic'],
};

export const DESIGN_INGREDIENT_MODEL = {
  formula: 'structure + text composition/alignment + palette + typography + motion',
  selectionRule: 'Choose each ingredient independently from the brief and brand attributes; neither industry nor a single style tag determines the full combination.',
  brandRule: 'Brand attributes describe personality and can cross industries. Playful is valid for food, services, consumer products, and technology when the audience and positioning support it.',
};

export const MACRO_DESIGN_PRIORITIES = [
  'large-media-with-anchored-text',
  'controlled-asymmetry',
  'alternating-density-and-breathing-room',
  'protagonist-typography-without-effect-dependency',
  'mobile-stable-layout',
];

export const SECTION_STRUCTURE_CONTRACT = {
  preserveAsStructure: [
    'section topology and reading order',
    'alignment and anchoring logic',
    'media-to-copy proportions',
    'scroll axis, pinning, and reveal dependencies',
    'density and breathing-room rhythm',
  ],
  treatAsVariables: [
    'brand colors and surface treatment',
    'decorative overlays and background blocks',
    'copy, imagery, logos, and item count',
    'typeface choice and identity details',
    'motion intensity when the original motion is semantically specific',
  ],
  typography: {
    singleReferenceScaleTolerance: 0.15,
    multipleReferenceRule: 'Choose one reference as the scale owner for the whole page.',
    measurementRule: 'Copy measured font-size, line-height, letter-spacing, weight, max-width, and anchor offsets from the live reference. Do not infer exact values from appearance alone.',
  },
  responsiveGate: 'Every selected structure must remain coherent on mobile; a desktop-only composition is ineligible.',
};

export const TEXT_BLOCK_PRESETS = [
  {
    id: 'centered-statement',
    slots: ['eyebrow', 'title', 'subtitle', 'actions'],
    alignment: 'center',
    anchor: 'centered section stack',
    scale: 'display title with restrained supporting copy',
    sourceExample: 'Biograph: What we measure',
    mobile: 'Preserve hierarchy, reduce line length, and stack actions without changing the centered reading order.',
  },
  {
    id: 'editorial-testimonial',
    slots: ['eyebrow', 'title', 'attribution', 'pagination'],
    alignment: 'center',
    anchor: 'full-width statement with attribution below',
    scale: 'oversized serif statement against small sans metadata',
    sourceExample: 'Biograph testimonial',
    mobile: 'Keep the statement dominant while preventing orphaned quote lines and detached attribution.',
  },
  {
    id: 'viewport-display-over-media',
    slots: ['title', 'body', 'actions'],
    alignment: 'left',
    anchor: 'display at the top and support copy at the viewport base',
    scale: 'viewport-filling display over large media',
    sourceExample: 'Hartmann Capital hero',
    mobile: 'Move support copy into normal flow when the viewport cannot sustain two independent anchors.',
  },
  {
    id: 'anchored-conversion-block',
    slots: ['eyebrow', 'title', 'subtitle', 'actions'],
    alignment: 'left',
    anchor: 'offset text column, not necessarily on the page margin',
    scale: 'large two-line sans title with a compact supporting measure',
    sourceExample: 'Neverhack hero',
    mobile: 'Keep the offset as inner padding, wrap actions, and preserve title-to-body contrast.',
  },
  {
    id: 'section-lead-plus-columns',
    slots: ['title', 'actions', 'items'],
    alignment: 'left',
    anchor: 'section lead above a repeated column system',
    scale: 'large section title, small action, medium item headings',
    sourceExample: 'Neverhack principles',
    mobile: 'Collapse columns to a paced vertical sequence and retain each item marker.',
  },
  {
    id: 'distributed-brand-hero',
    slots: ['title', 'product-or-media', 'microcopy', 'controls'],
    alignment: 'edge-distributed',
    anchor: 'dominant title and media in the field, supporting information distributed around the viewport edges',
    scale: 'expressive display against compact functional microcopy',
    sourceExample: "Buck's Sauce hero",
    mobile: 'Bring edge microcopy into a short ordered stack while preserving the title/media dominance.',
  },
  {
    id: 'layered-color-statement',
    slots: ['title', 'support', 'actions'],
    alignment: 'offset-left',
    anchor: 'oversized multiline statement used as the composition itself',
    scale: 'large neutral text with selected words assigned solid palette roles',
    sourceExample: 'Applace hero',
    mobile: 'Reduce the number of line breaks and keep colored phrases legible without turning them into decorative gradient text.',
  },
];

const PRESET_SOURCE = 'user-calibration-2026-08-05';

export const REFERENCE_TAG_PRESETS = {
  'fancy.design': { productTypes: ['agency-site', 'landing-page'], styleTags: ['fancy', 'corporate'], brandAttributes: ['extroverted', 'playful', 'corporate'] },
  'biograph.com': { productTypes: ['landing-page', 'corporate-site'], styleTags: ['soft-tech', 'corporate'], brandAttributes: ['sober', 'premium', 'authoritative'] },
  'bynar.io': { productTypes: ['saas', 'tool'], styleTags: ['soft-tech', 'corporate'] },
  'wonder.design': { productTypes: ['saas', 'tool'], styleTags: ['soft-tech', 'playful'], brandAttributes: ['playful', 'approachable', 'technical'] },
  'reflect.app': { productTypes: ['saas', 'app'], styleTags: ['soft-tech', 'minimal'] },
  'stripe.com': { productTypes: ['saas', 'corporate-site'], styleTags: ['soft-tech', 'corporate'] },
  'retool.com': { productTypes: ['saas', 'tool'], styleTags: ['soft-tech', 'corporate'] },
  'neverhack.com': { productTypes: ['corporate-site', 'saas'], styleTags: ['soft-tech', 'corporate'], brandAttributes: ['sober', 'corporate', 'technical'] },
  'langchain.com': { productTypes: ['saas', 'tool'], styleTags: ['soft-tech', 'corporate'] },
  'mosa-ai.nextjsshop-preview.workers.dev': { productTypes: ['saas', 'landing-page'], styleTags: ['soft-tech', 'corporate'] },
  'assetx-ivory.vercel.app': { productTypes: ['saas', 'tool'], styleTags: ['soft-tech', 'fancy'] },
  'brand.ai': { productTypes: ['saas', 'tool'], styleTags: ['soft-tech', 'corporate'] },
  'pt.squarespace.com': { productTypes: ['saas', 'tool'], styleTags: ['soft-tech', 'fancy'] },
  'io.net': { productTypes: ['saas', 'corporate-site'], styleTags: ['soft-tech', 'corporate'] },
  'paperclip.ing': { productTypes: ['saas', 'tool'], styleTags: ['soft-tech', 'playful'], brandAttributes: ['playful', 'approachable', 'technical'] },
  'lambda.ai': { productTypes: ['saas', 'corporate-site'], styleTags: ['techy', 'corporate'], brandAttributes: ['technical', 'authoritative', 'bold'] },
  'sanity.io': { productTypes: ['saas', 'tool'], styleTags: ['techy', 'corporate'], brandAttributes: ['technical', 'corporate', 'bold'] },
  'cantor8.io': { productTypes: ['saas', 'landing-page'], styleTags: ['techy', 'futuristic'], brandAttributes: ['technical', 'corporate', 'authoritative'] },
  'hartmanncapital.com': { productTypes: ['corporate-site', 'portfolio'], styleTags: ['playful', 'techy'], brandAttributes: ['bold', 'technical', 'extroverted'] },
  'mindmarket.com': { productTypes: ['landing-page', 'corporate-site'], styleTags: ['playful', 'fancy'], brandAttributes: ['playful', 'extroverted', 'approachable'] },
  'mammothmurals.com': { productTypes: ['portfolio', 'agency-site'], styleTags: ['playful', 'fancy'], brandAttributes: ['playful', 'bold', 'extroverted'] },
  'litebox.ai': { productTypes: ['agency-site', 'landing-page'], styleTags: ['techy', 'corporate'], brandAttributes: ['corporate', 'technical', 'bold'] },
  'outfit.hellohello.is': { productTypes: ['portfolio', 'agency-site'], styleTags: ['fashion', 'experimental'] },
  'supersolid.agency': { productTypes: ['agency-site', 'portfolio'], styleTags: ['fancy', 'experimental'] },
  'artefakt.mov': { productTypes: ['portfolio', 'agency-site'], styleTags: ['fashion', 'experimental'] },
  'mikkisindhunata.com': { productTypes: ['portfolio'], styleTags: ['fashion', 'experimental'] },
  'bymonolog.com': { productTypes: ['portfolio', 'agency-site'], styleTags: ['fashion', 'techy'] },
  'studiodialect.com': { productTypes: ['agency-site', 'portfolio'], styleTags: ['techy', 'corporate'] },
  'buckssauce.com': { productTypes: ['ecommerce', 'product-page'], styleTags: ['playful', 'fancy'], brandAttributes: ['playful', 'extroverted', 'rebellious'] },
  'quantumbody.io': { productTypes: ['landing-page', 'ecommerce'], styleTags: ['editorial', 'minimal'], brandAttributes: ['sober', 'neutral', 'premium'] },
  'farmminerals.com': { productTypes: ['product-page', 'corporate-site'], styleTags: ['minimal', 'corporate'], brandAttributes: ['sober', 'technical', 'premium'] },
  'palantir.com': { productTypes: ['saas', 'corporate-site'], styleTags: ['techy', 'corporate'], brandAttributes: ['sober', 'technical', 'authoritative'] },
  'ref.digital': { productTypes: ['agency-site', 'portfolio'], styleTags: ['techy', 'corporate'], brandAttributes: ['corporate', 'bold', 'technical'] },
  'aptosnetwork.com': { productTypes: ['saas', 'corporate-site'], styleTags: ['techy', 'editorial'], brandAttributes: ['technical', 'bold', 'corporate'] },
  'apollo.io': { productTypes: ['saas', 'tool'], styleTags: ['soft-tech', 'corporate'], brandAttributes: ['corporate', 'approachable', 'technical'] },
  'applace.io': { productTypes: ['corporate-site', 'app'], styleTags: ['playful', 'soft-tech'], brandAttributes: ['playful', 'extroverted', 'approachable'] },
  'getanchor.co': { productTypes: ['saas', 'tool'], styleTags: ['soft-tech', 'playful'], brandAttributes: ['playful', 'approachable', 'technical'] },
  'ideogram.ai': { productTypes: ['saas', 'tool'], styleTags: ['soft-tech', 'minimal'], brandAttributes: ['technical', 'bold', 'approachable'] },
  'agentflow.framer.ai': { productTypes: ['landing-page', 'saas', 'tool'], styleTags: ['soft-tech', 'corporate'], brandAttributes: ['technical', 'corporate', 'approachable'] },
};

export const REFERENCE_INGREDIENT_PRESETS = {
  'buckssauce.com': { structure: 'media-backed-hero', alignment: 'edge-distributed', textBlock: 'distributed-brand-hero', palette: 'high-contrast-product', typography: 'condensed-display', motion: 'playful' },
  'quantumbody.io': { structure: 'media-backed-hero', alignment: 'edge-anchored', textBlock: 'viewport-display-over-media', palette: 'earthy-neutral', typography: 'display-serif', motion: 'balanced' },
  'farmminerals.com': { structure: 'offset-product-hero', alignment: 'offset-left', textBlock: 'anchored-conversion-block', palette: 'committed-brand-color', typography: 'neutral-grotesk', motion: 'balanced' },
  'palantir.com': { structure: 'editorial-grid', alignment: 'split', textBlock: 'section-lead-plus-columns', palette: 'restrained-neutral', typography: 'neutral-grotesk', motion: 'product-demonstration' },
  'aptosnetwork.com': { structure: 'split-hero', alignment: 'split', textBlock: 'anchored-conversion-block', palette: 'full-palette', typography: 'editorial-serif', motion: 'balanced' },
  'apollo.io': { structure: 'offset-product-hero', alignment: 'centered', textBlock: 'centered-statement', palette: 'restrained-neutral', typography: 'editorial-serif', motion: 'product-demonstration' },
  'applace.io': { structure: 'editorial-grid', alignment: 'mixed', textBlock: 'layered-color-statement', palette: 'full-palette', typography: 'expressive-display', motion: 'playful' },
  'getanchor.co': { structure: 'horizontal-product-sequence', alignment: 'centered', textBlock: 'centered-statement', palette: 'full-palette', typography: 'geometric-sans', motion: 'playful' },
};

function normalizedHost(value) {
  try {
    const host = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname.toLowerCase();
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    return '';
  }
}

export function getReferenceTagPreset(urlOrHost) {
  const host = normalizedHost(String(urlOrHost || ''));
  const preset = REFERENCE_TAG_PRESETS[host];
  return preset ? { ...preset, productTypes: [...preset.productTypes], styleTags: [...preset.styleTags], brandAttributes: [...(preset.brandAttributes || [])], source: PRESET_SOURCE } : null;
}

export function getReferenceIngredientPreset(urlOrHost) {
  const host = normalizedHost(String(urlOrHost || ''));
  const preset = REFERENCE_INGREDIENT_PRESETS[host];
  return preset ? { ...preset, source: PRESET_SOURCE } : null;
}
