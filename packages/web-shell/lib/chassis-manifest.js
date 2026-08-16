import { createHash } from 'node:crypto';

export const CHASSIS_MANIFEST_VERSION = 1;

const TYPE_SIGNALS = {
  'landing-page': ['landing page', 'one page', 'one-page', 'página de lançamento', 'pagina de lancamento'],
  'corporate-site': ['corporate', 'institutional', 'company site', 'site institucional', 'empresa'],
  portfolio: ['portfolio', 'portfólio', 'case studies', 'cases'],
  'agency-site': ['agency', 'creative studio', 'design studio', 'agência', 'agencia', 'estúdio', 'estudio'],
  saas: ['saas', 'software as a service', 'plataforma de software'],
  tool: ['tool', 'builder', 'editor', 'developer product', 'ferramenta', 'construtor'],
  app: ['mobile app', 'web app', 'aplicativo', 'aplicação'],
  ecommerce: ['ecommerce', 'e-commerce', 'shop', 'store', 'loja'],
  marketplace: ['marketplace', 'directory', 'diretório', 'diretorio'],
  editorial: ['editorial', 'magazine', 'publication', 'revista', 'publicação', 'publicacao'],
  community: ['community', 'membership', 'comunidade'],
  'event-campaign': ['event', 'festival', 'campaign', 'launch', 'evento', 'campanha'],
  documentation: ['documentation', 'developer portal', 'docs', 'documentação', 'documentacao'],
};

function normalized(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function matchesSignal(text, signal) {
  const escaped = normalized(signal).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, 'i').test(text);
}

export function inferReferenceTypes(input = {}) {
  const explicit = [...new Set([...(input.businessTags || []), ...(input.categories || [])].filter((tag) => TYPE_SIGNALS[tag]))];
  if (explicit.length) return explicit;
  const text = normalized([input.title, input.description, ...(input.tags || []), input.brief].filter(Boolean).join(' '));
  return Object.entries(TYPE_SIGNALS).flatMap(([type, signals]) => signals.some((signal) => matchesSignal(text, signal)) ? [type] : []);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

export function hashChassisManifest(value) {
  const copy = { ...value };
  delete copy.hash;
  delete copy.createdAt;
  return createHash('sha256').update(JSON.stringify(stable(copy))).digest('hex');
}

function sectionSignature(capture) {
  return (capture?.sections || []).map((section) => `${section.role}:${section.id}`);
}

function responsivePersistence(captures) {
  if (captures.length < 2) return { compared: false, score: null, stableRoles: [], changedRoles: [], notes: ['Capture a second viewport to verify structural persistence.'] };
  const [wide, narrow] = [...captures].sort((a, b) => b.viewport.width - a.viewport.width);
  const wideRoles = wide.sections.map((section) => section.role);
  const narrowRoles = narrow.sections.map((section) => section.role);
  const stableRoles = wideRoles.filter((role, index) => narrowRoles[index] === role);
  const changedRoles = [...new Set([...wideRoles, ...narrowRoles].filter((role) => !stableRoles.includes(role)))];
  const score = Math.round((stableRoles.length / Math.max(wideRoles.length, narrowRoles.length, 1)) * 100);
  return {
    compared: true, score, stableRoles, changedRoles,
    notes: changedRoles.length ? ['Some section roles move, collapse, or disappear on the narrow viewport.'] : ['Section roles and reading order persist across both viewports.'],
  };
}

function normalizedGuidance(guidance = {}) {
  return {
    worthBorrowing: String(guidance.worthBorrowing || '').trim(),
    avoid: String(guidance.avoid || '').trim(),
  };
}

export function validateChassisManifest(manifest) {
  const issues = [];
  if (manifest?.schemaVersion !== CHASSIS_MANIFEST_VERSION) issues.push('unsupported_schema');
  if (!manifest?.reference?.url) issues.push('reference_url_required');
  if (!manifest?.structure?.sections?.length) issues.push('sections_required');
  if (!manifest?.evidence?.viewports?.length) issues.push('viewport_evidence_required');
  if (!manifest?.transplant?.preserve?.length || !manifest?.transplant?.replace?.length) issues.push('transplant_directives_required');
  return { ok: issues.length === 0, issues };
}

export function buildChassisManifest({ reference = {}, captures = [], guidance = {}, createdAt = new Date().toISOString() } = {}) {
  const validCaptures = captures.filter((capture) => capture?.viewport && Array.isArray(capture.sections));
  if (!reference.url) throw new Error('buildChassisManifest: reference.url required');
  if (!validCaptures.length) throw new Error('buildChassisManifest: at least one evidence capture required');
  const primary = [...validCaptures].sort((a, b) => b.viewport.width - a.viewport.width)[0];
  const curatorGuidance = normalizedGuidance(guidance);
  const persistence = responsivePersistence(validCaptures);
  const sectionOrder = primary.sections.map((section) => section.role);
  const motionTracks = primary.motionTracks || [];
  const mediaSlots = primary.mediaSlots || [];
  const manifest = {
    schemaVersion: CHASSIS_MANIFEST_VERSION,
    createdAt,
    reference: {
      id: reference.id || null, title: reference.title || reference.url,
      url: reference.url, siteTypes: inferReferenceTypes(reference),
    },
    evidence: {
      mode: 'runtime-dom',
      viewports: validCaptures.map((capture) => capture.viewport),
      capturedAt: validCaptures.map((capture) => capture.capturedAt).filter(Boolean),
      confidence: persistence.compared && primary.sections.length >= 3 ? 'high' : primary.sections.length >= 2 ? 'medium' : 'low',
      gaps: [
        ...(!persistence.compared ? ['mobile-not-compared'] : []),
        ...(!motionTracks.length ? ['motion-not-observed'] : []),
      ],
    },
    structure: {
      sectionOrder,
      signature: sectionSignature(primary),
      sections: primary.sections,
      anchors: primary.anchors || [],
      density: primary.metrics || {},
    },
    media: { slots: mediaSlots },
    motion: {
      tracks: motionTracks,
      portability: motionTracks.map((track) => ({ id: track.id, driver: track.driver, portable: track.driver !== 'media', reason: track.driver === 'media' ? 'Requires replacement media timing.' : 'Semantic driver can be retained with new content.' })),
    },
    responsive: persistence,
    guidance: curatorGuidance,
    transplant: {
      preserve: [
        'section order and reading hierarchy', 'grid, alignment, proportions, and density rhythm',
        'text anchoring and media-slot roles', 'animation drivers and responsive composition logic',
        ...(curatorGuidance.worthBorrowing ? [`Curator guidance: ${curatorGuidance.worthBorrowing}`] : []),
      ],
      adapt: ['copy length to measured text capacity', 'media crop to the recorded slot aspect ratio', 'motion timing to replacement media and content semantics'],
      replace: [
        'brand identity, typography, color tokens, copy, imagery, and decorative treatment',
        ...(curatorGuidance.avoid ? [`Exclude from transfer: ${curatorGuidance.avoid}`] : []),
      ],
    },
  };
  manifest.hash = hashChassisManifest(manifest);
  const validation = validateChassisManifest(manifest);
  if (!validation.ok) throw new Error(`buildChassisManifest: invalid manifest (${validation.issues.join(', ')})`);
  return manifest;
}
