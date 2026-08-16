import { createHash } from 'node:crypto';
import { parseHTML } from 'linkedom';
import { captureSnapshot } from './snapshot.js';
import { assertPublicReferenceUrl } from './public-reference-url.js';

const TARGET_VIEWPORT = { width: 1280, height: 900 };

function clean(value, max = 240) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function sha256(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function normalizeHex(value) {
  const raw = clean(value, 12).toUpperCase();
  if (/^#[0-9A-F]{3}$/.test(raw)) return `#${raw.slice(1).split('').map((part) => part + part).join('')}`;
  if (/^#[0-9A-F]{6}$/.test(raw)) return raw;
  if (/^#[0-9A-F]{8}$/.test(raw)) return raw.slice(0, 7);
  return null;
}

function colorDistanceFromNeutral(hex) {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  return Math.max(...channels) - Math.min(...channels);
}

function extractColors(html, document) {
  const counts = new Map();
  const theme = normalizeHex(document.querySelector('meta[name="theme-color"]')?.getAttribute('content'));
  if (theme) counts.set(theme, 1000);
  for (const match of String(html || '').matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
    const color = normalizeHex(match[0]);
    if (!color) continue;
    counts.set(color, (counts.get(color) || 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1] || colorDistanceFromNeutral(b[0]) - colorDistanceFromNeutral(a[0]))
    .map(([color]) => color)
    .slice(0, 8);
}

function firstFamily(value) {
  const family = clean(value, 180).split(',')[0]?.replace(/^['"]|['"]$/g, '').trim() || '';
  return /^var\(/i.test(family) ? '' : family;
}

function extractFonts(chassisEvidence) {
  const fonts = new Set();
  for (const section of chassisEvidence?.sections || []) {
    const heading = firstFamily(section.text?.heading?.typography?.family);
    const body = firstFamily(section.text?.body?.typography?.family);
    if (heading) fonts.add(heading);
    if (body) fonts.add(body);
  }
  return [...fonts].slice(0, 6);
}

function extractDeclaredFonts(html) {
  const fonts = new Set();
  for (const match of String(html || '').matchAll(/font-family\s*:\s*([^;}]+)/gi)) {
    const family = firstFamily(match[1]);
    if (family && !/^(inherit|initial|unset|system-ui|sans-serif|serif)$/i.test(family)) fonts.add(family);
  }
  return [...fonts].slice(0, 6);
}

function extractBrand(document, sourceUrl, fallbackTitle = '') {
  const explicit = clean(
    document.querySelector('meta[property="og:site_name"]')?.getAttribute('content')
      || document.querySelector('meta[name="application-name"]')?.getAttribute('content'),
    160,
  );
  if (explicit) return explicit;
  const title = clean(document.title || fallbackTitle, 160).split(/\s+[—|·]\s+|\s+-\s+/)[0];
  if (title && !/^home$/i.test(title)) return title;
  return new URL(sourceUrl).hostname.replace(/^www\./, '').split('.')[0].replace(/[-_]+/g, ' ');
}

function extractLogoCandidates(document, sourceUrl) {
  const candidates = [];
  const add = (raw, kind) => {
    if (!raw) return;
    try {
      const url = new URL(raw, sourceUrl).toString();
      if (!candidates.some((item) => item.url === url)) candidates.push({ url, kind });
    } catch {}
  };
  for (const image of document.querySelectorAll('img[src]')) {
    const signal = `${image.getAttribute('alt') || ''} ${image.getAttribute('class') || ''} ${image.id || ''}`;
    if (/logo|brand|mark/i.test(signal)) add(image.getAttribute('src'), 'logo');
  }
  for (const icon of document.querySelectorAll('link[rel*="icon"][href]')) add(icon.getAttribute('href'), 'icon');
  return candidates.slice(0, 5);
}

function extractCtas(document) {
  return [...document.querySelectorAll('a,button')]
    .map((element) => clean(element.textContent, 80))
    .filter((value, index, list) => value && list.indexOf(value) === index)
    .slice(0, 8);
}

function summarizeHtml({ html = '', title = '', sourceUrl, chassisEvidence = null, mediaCountOverride = null } = {}) {
  const { document } = parseHTML(String(html || '<html></html>'));
  const sections = chassisEvidence?.sections || [];
  const headings = (sections.length
    ? sections.map((section) => clean(section.text?.heading?.value, 160))
    : [...document.querySelectorAll('h1,h2,h3')].map((heading) => clean(heading.textContent, 160)))
    .filter(Boolean).slice(0, 8);
  const visibleCharacters = sections.length
    ? sections.reduce((sum, section) => sum + Number(section.text?.visibleCharacters || 0), 0)
    : clean(document.body?.textContent, 10000).length;
  const mediaCount = mediaCountOverride
    ?? (chassisEvidence
      ? (chassisEvidence.mediaSlots || []).filter((slot) => slot.kind !== 'svg').length
      : document.querySelectorAll('img,picture,video,canvas').length);
  const summary = {
    sourceUrl,
    brand: extractBrand(document, sourceUrl, title),
    title: clean(document.title || title, 200),
    description: clean(
      document.querySelector('meta[name="description"]')?.getAttribute('content')
        || document.querySelector('meta[property="og:description"]')?.getAttribute('content'),
      360,
    ),
    language: clean(document.documentElement?.getAttribute('lang'), 24) || null,
    headings,
    callsToAction: extractCtas(document),
    colors: extractColors(html, document),
    fonts: [...new Set([...extractFonts(chassisEvidence), ...extractDeclaredFonts(html)])].slice(0, 6),
    logos: extractLogoCandidates(document, sourceUrl),
    counts: {
      sections: sections.length,
      visibleCharacters,
      media: mediaCount,
    },
  };
  return { ...summary, hash: sha256(summary) };
}

export function targetEvidenceFromHtml(input = {}) {
  return summarizeHtml(input);
}

function projectEvidence(project) {
  const sourceUrl = project?.source_url || `project:${project?.id || 'unknown'}`;
  const html = `${project?.source_html || ''}\n<style>${project?.design_md || ''}</style>`;
  const evidence = summarizeHtml({
    html,
    title: project?.name || 'Untitled project',
    sourceUrl: /^https?:/i.test(sourceUrl) ? sourceUrl : 'https://project.invalid/',
    mediaCountOverride: Number(project?.asset_count || 0),
  });
  return {
    ...evidence,
    sourceUrl,
    brand: clean(project?.name, 160) || evidence.brand,
    counts: { ...evidence.counts, nodes: Number(project?.node_count || 0) },
    hash: sha256({ ...evidence, sourceUrl, brand: clean(project?.name, 160) || evidence.brand }),
  };
}

export async function analyzeTargetAuthority({
  input = {},
  project = null,
  capture = captureSnapshot,
  validate = assertPublicReferenceUrl,
} = {}) {
  if (input.authorityType === 'project') return projectEvidence(project);
  if (input.authorityType === 'provided') {
    const sourceLabel = clean(input.sourceLabel, 240);
    const summary = {
      sourceUrl: `provided:${sourceLabel}`,
      brand: clean(input.brand, 160),
      title: sourceLabel,
      description: '', language: null, headings: [], callsToAction: [], colors: [], fonts: [], logos: [],
      counts: { sections: 0, visibleCharacters: 0, media: 0 },
    };
    return { ...summary, hash: sha256(summary) };
  }

  const sourceUrl = await validate(input.url);
  const snapshot = await capture(sourceUrl, {
    viewport: TARGET_VIEWPORT,
    includeChassisEvidence: true,
    publicNetworkOnly: true,
  });
  return summarizeHtml({
    html: snapshot.html,
    title: snapshot.title,
    sourceUrl,
    chassisEvidence: snapshot.chassisEvidence,
  });
}
