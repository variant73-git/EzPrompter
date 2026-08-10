const TEMPLATE_MARKETPLACE_MATCHERS = Object.freeze([
  { platform: 'framer', host: /(^|\.)framer\.com$/, path: /^\/community\/marketplace\/templates(?:\/|$)/ },
  { platform: 'webflow', host: /(^|\.)webflow\.com$/, path: /^\/templates(?:\/|$)/ },
  { platform: 'aura', host: /(^|\.)aura\.build$/, path: /\// },
  { platform: 'neuform', host: /(^|\.)neuform\.(?:design|site|com)$/, path: /\// },
]);

const TEMPLATE_TAXONOMY_VALUES = new Set(['template', 'templates', 'webbuilder-template', 'builder-template']);

function normalizedUrl(value) {
  try {
    return new URL(/^https?:\/\//i.test(String(value || '')) ? value : `https://${value}`);
  } catch {
    return null;
  }
}

function marketplaceFromUrl(value) {
  const url = normalizedUrl(value);
  if (!url) return null;
  const host = url.hostname.toLowerCase();
  return TEMPLATE_MARKETPLACE_MATCHERS.find((candidate) => (
    candidate.host.test(host) && candidate.path.test(url.pathname)
  ))?.platform || null;
}

function marketplaceFromTaxonomy(taxonomy = {}) {
  if (!taxonomy || typeof taxonomy !== 'object' || Array.isArray(taxonomy)) return null;
  const platform = String(
    taxonomy.templatePlatform
      || taxonomy.webbuilder
      || taxonomy.builder
      || taxonomy.platform
      || '',
  ).trim().toLowerCase();
  const kind = String(taxonomy.recordType || taxonomy.kind || taxonomy.lane || '').trim().toLowerCase();
  const explicitlyTemplate = taxonomy.isTemplate === true
    || taxonomy.template === true
    || TEMPLATE_TAXONOMY_VALUES.has(kind);
  return explicitlyTemplate ? platform || 'other-webbuilder' : null;
}

export function detectWebbuilderTemplate(reference = {}) {
  const explicitPlatform = String(
    reference.templatePlatform
      || reference.templateSource
      || reference.webbuilder
      || '',
  ).trim().toLowerCase();
  if (explicitPlatform) return { detected: true, platform: explicitPlatform, reason: 'webbuilder-template' };

  const sources = [reference.source, ...(Array.isArray(reference.sources) ? reference.sources : [])].filter(Boolean);
  for (const source of sources) {
    const taxonomyPlatform = marketplaceFromTaxonomy(source.taxonomy || source.sourceTaxonomy || reference.sourceTaxonomy);
    if (taxonomyPlatform) return { detected: true, platform: taxonomyPlatform, reason: 'webbuilder-template' };
  }

  const urls = [
    reference.templateListingUrl,
    reference.marketplaceUrl,
    ...sources.flatMap((source) => [source.listingUrl, source.detailUrl]),
    reference.url,
  ];
  for (const value of urls) {
    const platform = marketplaceFromUrl(value);
    if (platform) return { detected: true, platform, reason: 'webbuilder-template' };
  }
  return { detected: false, platform: null, reason: null };
}

export function referencePrivacy(reference = {}) {
  const template = detectWebbuilderTemplate(reference);
  const explicitlySet = typeof reference.isPrivate === 'boolean';
  const isPrivate = explicitlySet ? reference.isPrivate : template.detected;
  return {
    isPrivate,
    privacyReason: isPrivate
      ? String(reference.privacyReason || template.reason || 'manual-curation')
      : null,
    templatePlatform: template.platform,
    automatic: !explicitlySet && template.detected,
  };
}

export function canCuratePrivateReferences(user, env = process.env) {
  if (!user) return false;
  const configured = String(env.REFERENCE_CURATOR_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (configured.length) return configured.includes(String(user.email || '').trim().toLowerCase());
  return env.NODE_ENV !== 'production';
}
