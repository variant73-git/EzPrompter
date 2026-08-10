import { createHash } from 'node:crypto';
import { parseHTML } from 'linkedom';
import { canonicalizeReferenceUrl, uniqueText } from './reference-bank-normalize.js';
import { referencePrivacy } from './reference-privacy.js';

const SOURCE_PRIORITY = {
  codrops: 3,
  siteinspire: 2,
  minimalgallery: 1,
  siteofsites: 1,
  pafolios: 1,
};

const MONTHS = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dec: '12',
};

function stableReferenceId(canonicalKey) {
  return `ref_${createHash('sha256').update(canonicalKey).digest('hex').slice(0, 16)}`;
}

function parseNextFlight(rawHtml) {
  const decoded = [];
  const pattern = /<script>self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g;
  for (const match of String(rawHtml || '').matchAll(pattern)) {
    try {
      const payload = JSON.parse(match[1]);
      if (typeof payload?.[1] === 'string') decoded.push(payload[1]);
    } catch {
      // A malformed or unrelated flight chunk must not poison the whole source.
    }
  }
  return decoded.join('\n');
}

function jsonArrayAfter(text, marker) {
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) return [];
  const start = text.indexOf('[', markerIndex + marker.length);
  if (start < 0) return [];

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '[') depth += 1;
    else if (char === ']') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, index + 1));
        } catch {
          return [];
        }
      }
    }
  }
  return [];
}

function appearance(source, item) {
  return {
    ...item,
    source: {
      id: source.id,
      name: source.name,
      listingUrl: source.listingUrl,
      recordId: String(item.sourceRecordId || item.url || ''),
      taxonomy: item.sourceTaxonomy || {},
    },
  };
}

function payloadDocument(payload) {
  return parseHTML(String(payload?.rawHtml || payload?.html || '')).document;
}

function normalizedDate(value) {
  const text = String(value || '').trim();
  const iso = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const named = text.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),\s+(\d{4})$/);
  if (!named) return null;
  const month = MONTHS[named[1].slice(0, 3).toLowerCase()];
  return month ? `${named[3]}-${month}-${named[2].padStart(2, '0')}` : null;
}

function sourceDetailUrl(payload, fallback) {
  return payload?.metadata?.sourceURL || fallback?.sourceDetailUrl || null;
}

function detailRecordId(detailUrl) {
  try {
    return new URL(detailUrl).pathname.split('/').filter(Boolean).at(-1) || detailUrl;
  } catch {
    return detailUrl;
  }
}

export function parseCodropsPayload(payload, listingUrl = 'https://tympanus.net/codrops/webzibition/') {
  const { document } = parseHTML(String(payload?.rawHtml || ''));
  return [...document.querySelectorAll('article.ct-webzibition')].flatMap((article) => {
    const target = article.querySelector('a.ct-latest-thumb-webzibition');
    const titleLink = article.querySelector('.title-archive a');
    const image = target?.querySelector('img');
    const url = target?.getAttribute('href');
    if (!url) return [];
    return [appearance(
      { id: 'codrops', name: 'Codrops Webzibition', listingUrl },
      {
        sourceRecordId: article.getAttribute('id') || url,
        title: titleLink?.textContent?.trim() || new URL(url).hostname,
        url,
        description: 'Selected for the Codrops Webzibition showcase.',
        thumbnailUrl: image?.getAttribute('src') || '',
        categories: ['Creative website'],
        tags: ['Codrops', 'Webzibition'],
        featured: true,
      },
    )];
  });
}

export function parsePafoliosPayload(payload, listingUrl = 'https://pafolios.com') {
  const flight = parseNextFlight(payload?.rawHtml);
  const portfolios = jsonArrayAfter(flight, '"portfolios":');
  return portfolios.flatMap((item) => {
    if (!item?.websiteUrl) return [];
    return [appearance(
      { id: 'pafolios', name: 'Pafolios', listingUrl },
      {
        sourceRecordId: item.slug || item.id || item.websiteUrl,
        title: item.title || new URL(item.websiteUrl).hostname,
        url: item.websiteUrl,
        description: item.description || '',
        thumbnailUrl: item.imageUrl ? new URL(item.imageUrl, listingUrl).href : '',
        categories: uniqueText(item.categories),
        tags: uniqueText(item.tags),
        publishedAt: item.date || null,
        featured: Boolean(item.featured),
      },
    )];
  });
}

function siteInspireThumbnail(image) {
  const filename = String(image || '').split('?')[0].split('/').pop();
  if (!filename) return '';
  return `https://r2.siteinspire.com/cdn-cgi/image/width=960,height=600,quality=75,format=auto,metadata=none,gravity=top,fit=crop,compress=true/${filename}`;
}

export function parseSiteInspirePayload(payload, listingUrl = 'https://www.siteinspire.com') {
  const { document } = parseHTML(String(payload?.rawHtml || ''));
  const collections = [...document.querySelectorAll('script[type="application/ld+json"]')]
    .flatMap((script) => {
      try {
        const value = JSON.parse(script.textContent || '{}');
        return value?.['@type'] === 'CollectionPage' ? [value] : [];
      } catch {
        return [];
      }
    });
  const parts = collections.flatMap((collection) => collection.hasPart || []);
  const links = Array.isArray(payload?.links) ? payload.links : [];

  return parts.flatMap((item) => {
    const detailUrl = new URL(item.url || '', listingUrl).href;
    const linkIndex = links.findIndex((link) => link === detailUrl);
    const nextDetail = linkIndex < 0
      ? links.length
      : links.findIndex((link, index) => index > linkIndex && /siteinspire\.com\/website\//.test(link));
    const end = nextDetail < 0 ? links.length : nextDetail;
    const targetUrl = links.slice(Math.max(0, linkIndex + 1), end).find((link) => {
      try {
        return !new URL(link).hostname.replace(/^www\./, '').endsWith('siteinspire.com');
      } catch {
        return false;
      }
    });
    if (!targetUrl) return [];
    const recordId = detailUrl.match(/\/website\/(\d+)/)?.[1] || detailUrl;
    return [appearance(
      { id: 'siteinspire', name: 'SiteInspire', listingUrl },
      {
        sourceRecordId: recordId,
        title: item.name || new URL(targetUrl).hostname,
        url: targetUrl,
        description: 'Featured in the SiteInspire website collection.',
        thumbnailUrl: siteInspireThumbnail(item.image),
        categories: ['Website'],
        tags: ['SiteInspire'],
        publishedAt: item.datePublished || null,
        featured: true,
        sourceDetailUrl: detailUrl,
      },
    )];
  });
}

export function parseMinimalGalleryListingPayload(
  payload,
  listingUrl = 'https://minimal.gallery/websites/',
) {
  const document = payloadDocument(payload);
  return [...document.querySelectorAll('.post.website')].flatMap((post) => {
    const detail = post.querySelector('h3 a[href]');
    const target = post.querySelector('a.site-button[title="Visit website"]');
    const image = post.querySelector('.media img');
    const detailUrl = detail?.getAttribute('href');
    const url = target?.getAttribute('href');
    if (!detailUrl || !url) return [];
    return [appearance(
      { id: 'minimalgallery', name: 'Minimal Gallery', listingUrl },
      {
        sourceRecordId: post.getAttribute('id')?.replace(/^post-/, '') || detailRecordId(detailUrl),
        title: detail.textContent?.trim() || new URL(url).hostname,
        url,
        description: 'Featured in the Minimal Gallery website collection.',
        thumbnailUrl: image?.getAttribute('src') || '',
        categories: ['Website'],
        tags: [],
        publishedAt: normalizedDate(post.querySelector('time')?.getAttribute('datetime')),
        featured: true,
        sourceDetailUrl: detailUrl,
      },
    )];
  });
}

export function parseMinimalGalleryDetailPayload(payload, fallback = {}) {
  const document = payloadDocument(payload);
  const detailUrl = sourceDetailUrl(payload, fallback);
  const target = document.querySelector('a.single-post-breadcrumbs-button[title="Visit website"]')
    || document.querySelector('.single-post-meta a.button[href]')
    || document.querySelector('.single-post-media-link[href]');
  const url = target?.getAttribute('href') || fallback.url;
  if (!detailUrl || !url) return [];

  const desktopImage = document.querySelector('.single-post-media .desktop img')
    || document.querySelector('.single-post-media img');
  const mobileImage = document.querySelector('.single-post-media .mobile img')
    || [...document.querySelectorAll('.single-post-media img')]
      .find((image) => /mobile/i.test(image.getAttribute('alt') || image.getAttribute('src') || ''));
  const published = document.querySelector('.meta-date .meta-col:last-child')?.textContent;
  const title = document.querySelector('h1')?.textContent?.trim()
    || fallback.title
    || new URL(url).hostname;
  const recordId = fallback.source?.recordId || detailRecordId(detailUrl);

  return [appearance(
    {
      id: 'minimalgallery',
      name: 'Minimal Gallery',
      listingUrl: fallback.source?.listingUrl || 'https://minimal.gallery/websites/',
    },
    {
      sourceRecordId: recordId,
      title,
      url,
      description: fallback.description || 'Featured in the Minimal Gallery website collection.',
      thumbnailUrl: desktopImage?.getAttribute('src') || fallback.thumbnailUrl || '',
      categories: uniqueText([...(fallback.categories || []), 'Website']),
      tags: uniqueText([...document.querySelectorAll('.meta-tags-list a')].map((tag) => tag.textContent)),
      publishedAt: normalizedDate(published) || fallback.publishedAt || null,
      featured: true,
      sourceDetailUrl: detailUrl,
      sourceTaxonomy: {
        ...(fallback.source?.taxonomy || {}),
        ...(mobileImage?.getAttribute('src')
          ? { mobileThumbnailUrl: mobileImage.getAttribute('src') }
          : {}),
      },
    },
  )];
}

function externalLinkWithin(element, sourceHost) {
  return [...element.querySelectorAll('a[href]')].find((link) => {
    try {
      const host = new URL(link.getAttribute('href')).hostname.replace(/^www\./, '');
      return host !== sourceHost && !/(^|\.)instagram\.com$/.test(host);
    } catch {
      return false;
    }
  });
}

export function parseSiteOfSitesListingPayload(
  payload,
  listingUrl = 'https://www.siteofsites.co/',
) {
  const document = payloadDocument(payload);
  const records = new Map();
  for (const detail of document.querySelectorAll('a[href*="siteofsites.co/websites/"]')) {
    const item = detail.closest('[role="listitem"]');
    const detailUrl = detail.getAttribute('href');
    if (!item || !detailUrl) continue;
    const target = externalLinkWithin(item, 'siteofsites.co');
    const url = target?.getAttribute('href') || detailUrl;
    const image = item.querySelector('img');
    const texts = [...item.querySelectorAll('p')].map((node) => node.textContent?.trim()).filter(Boolean);
    const publishedAt = texts.map((text) => {
      const match = text.match(/^(\d{2})\/(\d{4})$/);
      return match ? `${match[2]}-${match[1]}` : null;
    }).find(Boolean) || null;
    const recordId = detailRecordId(detailUrl);
    if (records.has(recordId)) continue;
    records.set(recordId, appearance(
      { id: 'siteofsites', name: 'Site of Sites', listingUrl },
      {
        sourceRecordId: recordId,
        title: image?.getAttribute('alt') || texts[0] || new URL(url).hostname,
        url,
        description: 'Featured in the Site of Sites website collection.',
        thumbnailUrl: image?.getAttribute('src') || '',
        categories: [],
        tags: [],
        publishedAt,
        featured: true,
        sourceDetailUrl: detailUrl,
        sourceTaxonomy: target ? {} : { targetMissingFromListing: true },
      },
    ));
  }
  return [...records.values()];
}

export function selectSiteOfSitesSitemapIncrement(
  links,
  excludedDetailUrls = [],
  limit = 36,
) {
  if (!Number.isInteger(limit) || limit < 1) return [];

  const normalize = (value) => {
    try {
      const url = new URL(typeof value === 'string' ? value : value?.url);
      if (url.hostname.replace(/^www\./, '').toLowerCase() !== 'siteofsites.co') return null;
      if (!/^\/websites\/[^/]+\/?$/.test(url.pathname)) return null;
      url.protocol = 'https:';
      url.hostname = 'www.siteofsites.co';
      url.hash = '';
      url.search = '';
      url.pathname = url.pathname.replace(/\/$/, '');
      return url.href;
    } catch {
      return null;
    }
  };
  const excluded = new Set(excludedDetailUrls.map(normalize).filter(Boolean));
  const seen = new Set();
  const selected = [];
  for (const link of links || []) {
    const url = normalize(link);
    if (!url || excluded.has(url) || seen.has(url)) continue;
    seen.add(url);
    selected.push(url);
    if (selected.length === limit) break;
  }
  return selected;
}

export function parseSiteOfSitesDetailPayload(payload, fallback = {}) {
  const document = payloadDocument(payload);
  const detailUrl = sourceDetailUrl(payload, fallback);
  const target = document.querySelector('a[aria-label="Live Site"][href]');
  const url = target?.getAttribute('href')
    || (fallback.source?.taxonomy?.targetMissingFromListing ? null : fallback.url);
  if (!detailUrl || !url) return [];

  const title = document.querySelector('h1')?.textContent?.trim()
    || fallback.title
    || new URL(url).hostname;
  const publishedAt = [...document.querySelectorAll('p')]
    .map((node) => normalizedDate(node.textContent))
    .find(Boolean)
    || fallback.publishedAt
    || null;
  const primaryImage = [...document.querySelectorAll('img')]
    .find((image) => image.getAttribute('alt')?.trim() === title)
    || document.querySelector('img[src*="static.wixstatic.com/media/"]');
  const recordId = fallback.source?.recordId || detailRecordId(detailUrl);

  return [appearance(
    {
      id: 'siteofsites',
      name: 'Site of Sites',
      listingUrl: fallback.source?.listingUrl || 'https://www.siteofsites.co/',
    },
    {
      sourceRecordId: recordId,
      title,
      url,
      description: fallback.description || 'Featured in the Site of Sites website collection.',
      thumbnailUrl: primaryImage?.getAttribute('src') || fallback.thumbnailUrl || '',
      categories: fallback.categories || [],
      tags: fallback.tags || [],
      publishedAt,
      featured: true,
      sourceDetailUrl: detailUrl,
      sourceTaxonomy: fallback.source?.taxonomy || {},
    },
  )];
}

function bestText(items, field) {
  return [...items]
    .filter((item) => item[field])
    .sort((a, b) => {
      const priority = (SOURCE_PRIORITY[b.source.id] || 0) - (SOURCE_PRIORITY[a.source.id] || 0);
      if (field === 'description' && Math.abs(String(b[field]).length - String(a[field]).length) > 40) {
        return String(b[field]).length - String(a[field]).length;
      }
      return priority;
    })[0]?.[field] || '';
}

export function mergeReferenceAppearances(appearances, generatedAt = new Date().toISOString()) {
  const groups = new Map();
  for (const item of appearances || []) {
    const canonical = canonicalizeReferenceUrl(item.url);
    if (!canonical) continue;
    const current = groups.get(canonical.canonicalKey) || { canonical, items: [] };
    current.items.push(item);
    groups.set(canonical.canonicalKey, current);
  }

  return [...groups.values()].map(({ canonical, items }) => {
    const sourceIds = uniqueText(items.map((item) => item.source.id));
    const sourceNames = uniqueText(items.map((item) => item.source.name));
    const featured = items.some((item) => item.featured);
    const publishedAt = items.map((item) => item.publishedAt).filter(Boolean).sort().at(-1) || null;
    const thumbnailUrl = [...items]
      .filter((item) => item.thumbnailUrl)
      .sort((a, b) => (SOURCE_PRIORITY[b.source.id] || 0) - (SOURCE_PRIORITY[a.source.id] || 0))[0]?.thumbnailUrl || '';
    const editorialConsensus = sourceIds.length;
    const curationWeight = Number((1 + (editorialConsensus - 1) * 0.4 + (featured ? 0.2 : 0)).toFixed(2));

    const sources = items.map((item) => ({
      ...item.source,
      detailUrl: item.sourceDetailUrl || null,
      thumbnailUrl: item.thumbnailUrl || null,
      taxonomy: item.sourceTaxonomy || item.source.taxonomy || {},
    }));
    const privacy = referencePrivacy({
      url: canonical.canonicalUrl,
      sources,
      isPrivate: items.find((item) => typeof item.isPrivate === 'boolean')?.isPrivate,
      privacyReason: items.find((item) => item.privacyReason)?.privacyReason,
      templatePlatform: items.find((item) => item.templatePlatform)?.templatePlatform,
      templateListingUrl: items.find((item) => item.templateListingUrl)?.templateListingUrl,
    });

    return {
      id: stableReferenceId(canonical.canonicalKey),
      title: bestText(items, 'title') || canonical.host,
      description: bestText(items, 'description'),
      url: canonical.canonicalUrl,
      host: canonical.host,
      thumbnailUrl,
      categories: uniqueText(items.flatMap((item) => item.categories || [])),
      tags: uniqueText(items.flatMap((item) => item.tags || [])),
      sourceIds,
      sourceNames,
      sources,
      editorialConsensus,
      curationWeight,
      featured,
      publishedAt,
      generatedAt,
      analysisStatus: 'listed',
      isPrivate: privacy.isPrivate,
      privacyReason: privacy.privacyReason,
      templatePlatform: privacy.templatePlatform,
    };
  }).sort((a, b) => (
    b.curationWeight - a.curationWeight
    || String(b.publishedAt || '').localeCompare(String(a.publishedAt || ''))
    || a.title.localeCompare(b.title)
  ));
}
