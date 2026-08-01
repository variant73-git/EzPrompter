import { parseHTML } from 'linkedom';
import { uniqueText } from './reference-bank-normalize.js';

const SOURCE = {
  id: 'landbook',
  name: 'Landbook',
};

const LISTING_ROOT = 'https://land-book.com/';

function sourceHost(value) {
  return String(value || '').toLowerCase().replace(/^www\./, '');
}

function resolvedUrl(value, base = LISTING_ROOT) {
  try {
    return new URL(value, base);
  } catch {
    return null;
  }
}

function normalizedLandbookDetail(value, base = LISTING_ROOT) {
  const url = resolvedUrl(value, base);
  if (!url || sourceHost(url.hostname) !== 'land-book.com') return null;
  const match = url.pathname.match(/^\/websites\/(\d+)-[^/]+\/?$/i);
  if (!match) return null;
  url.protocol = 'https:';
  url.hostname = 'land-book.com';
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/$/, '');
  return { recordId: match[1], url: url.href };
}

function isExternalTarget(value, base = LISTING_ROOT) {
  const url = resolvedUrl(value, base);
  return Boolean(
    url
    && /^https?:$/.test(url.protocol)
    && sourceHost(url.hostname) !== 'land-book.com'
  );
}

function payloadDocument(payload) {
  return parseHTML(String(payload?.html || payload?.rawHtml || '')).document;
}

function sourceAppearance(listingUrl, item) {
  const taxonomy = item.sourceTaxonomy || {};
  return {
    ...item,
    source: {
      id: SOURCE.id,
      name: SOURCE.name,
      listingUrl,
      recordId: String(item.sourceRecordId || item.sourceDetailUrl || item.url || ''),
      taxonomy,
    },
  };
}

function exactLandbookPath(link, pathname, base) {
  const url = resolvedUrl(link?.getAttribute('href'), base);
  return Boolean(url && sourceHost(url.hostname) === 'land-book.com' && url.pathname === pathname);
}

function cardTitle(card, detailUrl) {
  const titleLink = [...card.querySelectorAll('a[href]')].find((link) => {
    const candidate = normalizedLandbookDetail(link.getAttribute('href'), detailUrl);
    return candidate?.url === detailUrl && link.textContent?.trim();
  });
  return titleLink?.textContent?.trim() || card.querySelector('img[alt]')?.getAttribute('alt')?.trim() || '';
}

function listingCategories(card, listingUrl) {
  return uniqueText([...card.querySelectorAll('a[href]')].flatMap((link) => {
    const url = resolvedUrl(link.getAttribute('href'), listingUrl);
    return sourceHost(url?.hostname) === 'land-book.com' && url.pathname.startsWith('/design/')
      ? [link.textContent]
      : [];
  }));
}

function explicitTemplate(card, listingUrl) {
  return [...card.querySelectorAll('a[href]')].some((link) => (
    exactLandbookPath(link, '/templates', listingUrl)
    && link.textContent?.trim().toLowerCase() === 'template'
  ));
}

function detailTarget(scope, recordId, listingUrl, allowCardFallback = false) {
  const exact = [...scope.querySelectorAll('a[href]')].find((link) => (
    link.getAttribute('data-analytics-link-type') === 'visit_button'
    && link.getAttribute('data-analytics-website-id') === recordId
    && isExternalTarget(link.getAttribute('href'), listingUrl)
  ));
  if (exact || !allowCardFallback) return exact;
  return [...scope.querySelectorAll('a[aria-label="Visit website"][href]')].find((link) => (
    isExternalTarget(link.getAttribute('href'), listingUrl)
  ));
}

export function landbookListingPageNumber(value) {
  const url = resolvedUrl(value);
  if (
    !url
    || url.protocol !== 'https:'
    || url.username
    || url.password
    || url.port
    || sourceHost(url.hostname) !== 'land-book.com'
    || url.pathname !== '/'
    || url.hash
  ) return null;
  const keys = [...url.searchParams.keys()];
  if (keys.some((key) => key !== 'page') || url.searchParams.getAll('page').length > 1) return null;
  if (!url.searchParams.has('page')) return 1;
  const rawPage = url.searchParams.get('page');
  if (!/^[1-9]\d*$/.test(rawPage || '')) return null;
  const page = Number(rawPage);
  return Number.isSafeInteger(page) ? page : null;
}

export function landbookListingPageUrl(page = 1) {
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new RangeError('Landbook listing page must be a positive integer');
  }
  const url = new URL(LISTING_ROOT);
  if (page > 1) url.searchParams.set('page', String(page));
  return url.href;
}

export function parseLandbookListingPayload(payload, listingUrl = payload?.metadata?.sourceURL || LISTING_ROOT) {
  const page = landbookListingPageNumber(listingUrl);
  if (!page) throw new Error(`Unapproved Landbook listing URL: ${listingUrl}`);

  const normalizedListingUrl = landbookListingPageUrl(page);
  const document = payloadDocument(payload);
  const appearances = [];
  const websiteCandidates = [];
  const websiteRecords = [];
  const templates = [];
  const advertisements = [];
  const rejections = [];

  for (const [index, ad] of [...document.querySelectorAll('a.campaign-ad-link[rel~="sponsored"][href]')].entries()) {
    advertisements.push({
      lane: 'advertisement',
      sourceRecordId: `page-${page}-ad-${index + 1}`,
      listingUrl: normalizedListingUrl,
      title: ad.getAttribute('aria-label')?.trim()
        || ad.querySelector('.campaign-text')?.textContent?.trim()
        || 'Landbook sponsored placement',
      targetUrl: ad.getAttribute('href'),
      thumbnailUrl: ad.querySelector('img[src]')?.getAttribute('src') || '',
      sponsored: true,
    });
  }

  for (const card of document.querySelectorAll('.website-item')) {
    const detailLink = card.querySelector('a[data-website-link][href]')
      || card.querySelector('a[href*="/websites/"]');
    const detail = normalizedLandbookDetail(detailLink?.getAttribute('href'), normalizedListingUrl);
    const fallbackId = card.getAttribute('data-analytics-item-id')?.trim() || null;
    const recordId = detail?.recordId || fallbackId;
    if (!detail || !recordId || (fallbackId && fallbackId !== detail.recordId)) {
      rejections.push({
        lane: 'unknown',
        sourceRecordId: recordId,
        reason: 'invalid_detail_identity',
      });
      continue;
    }

    const title = cardTitle(card, detail.url);
    const thumbnailUrl = card.querySelector('.website-item-picture img[src]')?.getAttribute('src')
      || card.querySelector('img[src]')?.getAttribute('src')
      || '';
    const categories = listingCategories(card, normalizedListingUrl);
    if (explicitTemplate(card, normalizedListingUrl)) {
      templates.push({
        lane: 'template',
        sourceRecordId: recordId,
        listingUrl: normalizedListingUrl,
        sourceDetailUrl: detail.url,
        title,
        thumbnailUrl,
        categories,
        priceLabel: card.querySelector('.website-item-details a.website-item-link')?.textContent?.trim() || null,
      });
      continue;
    }

    const target = detailTarget(card, recordId, normalizedListingUrl, true);
    if (!target) {
      const candidate = {
        lane: 'website_candidate',
        sourceRecordId: recordId,
        listingUrl: normalizedListingUrl,
        sourceDetailUrl: detail.url,
        title,
        thumbnailUrl,
        categories: uniqueText(['Website', ...categories]),
        tags: [],
        sourceTaxonomy: {
          lane: 'website',
          listingPage: page,
          targetRequiresDetail: true,
        },
      };
      websiteCandidates.push(candidate);
      websiteRecords.push(candidate);
      continue;
    }

    const appearance = sourceAppearance(normalizedListingUrl, {
      sourceRecordId: recordId,
      title: title || new URL(target.getAttribute('href')).hostname,
      url: target.getAttribute('href'),
      description: 'Featured in the Landbook website collection.',
      thumbnailUrl,
      categories: uniqueText(['Website', ...categories]),
      tags: [],
      publishedAt: null,
      featured: true,
      sourceDetailUrl: detail.url,
      sourceTaxonomy: {
        lane: 'website',
        listingPage: page,
      },
    });
    appearances.push(appearance);
    websiteRecords.push(appearance);
  }

  return {
    page,
    listingUrl: normalizedListingUrl,
    appearances,
    websiteCandidates,
    websiteRecords,
    templates,
    advertisements,
    rejections,
  };
}

function detailTaxonomy(document) {
  const values = {};
  for (const link of document.querySelectorAll('.website-sidebar-responsive a[aria-label^="Filter websites by "]')) {
    const match = link.getAttribute('aria-label')?.match(/^Filter websites by ([^:]+):\s*(.+)$/i);
    if (!match) continue;
    const key = match[1].trim().toLowerCase();
    values[key] = uniqueText([...(values[key] || []), match[2]]);
  }
  return values;
}

export function parseLandbookDetailPayload(payload, fallback = {}) {
  if (fallback.lane === 'template' || fallback.source?.taxonomy?.lane === 'template') return [];

  const document = payloadDocument(payload);
  const detail = normalizedLandbookDetail(
    payload?.metadata?.sourceURL || fallback.sourceDetailUrl,
    fallback.sourceDetailUrl || LISTING_ROOT,
  );
  if (!detail) return [];
  const fallbackRecordId = String(fallback.source?.recordId || fallback.sourceRecordId || '');
  if (fallbackRecordId && fallbackRecordId !== detail.recordId) return [];

  const target = detailTarget(document, detail.recordId, detail.url);
  const url = target?.getAttribute('href') || fallback.url;
  if (!isExternalTarget(url, detail.url)) return [];

  const title = document.querySelector('h1')?.textContent?.trim()
    || fallback.title
    || new URL(url).hostname;
  const desktopImage = document.querySelector(`img[data-website-img][src*="/website/${detail.recordId}/"]`)
    || document.querySelector('img[data-website-img]');
  const mobileImage = document.querySelector(`img[data-expandable-content-img][src*="/website/${detail.recordId}/"]`)
    || document.querySelector('img[data-expandable-content-img]');
  const taxonomy = detailTaxonomy(document);
  const categories = uniqueText([
    'Website',
    ...(fallback.categories || []),
    ...(taxonomy.category || []),
  ]);
  const tags = uniqueText([
    ...(fallback.tags || []),
    ...Object.entries(taxonomy).flatMap(([key, values]) => (key === 'category' ? [] : values)),
  ]);
  const verifiedLabel = [...document.querySelectorAll('span')]
    .map((node) => node.textContent?.trim())
    .find((text) => /^Verified\s+/i.test(text || '')) || null;
  const sourceTaxonomy = {
    ...(fallback.source?.taxonomy || fallback.sourceTaxonomy || {}),
    lane: 'website',
    ...taxonomy,
    ...(verifiedLabel ? { verifiedLabel } : {}),
    ...(mobileImage?.getAttribute('src')
      ? { mobileThumbnailUrl: mobileImage.getAttribute('src') }
      : {}),
  };
  const listingUrl = fallback.source?.listingUrl || fallback.listingUrl || LISTING_ROOT;

  return [sourceAppearance(listingUrl, {
    sourceRecordId: detail.recordId,
    title,
    url,
    description: fallback.description || 'Featured in the Landbook website collection.',
    thumbnailUrl: desktopImage?.getAttribute('src') || fallback.thumbnailUrl || '',
    categories,
    tags,
    publishedAt: null,
    featured: true,
    sourceDetailUrl: detail.url,
    sourceTaxonomy,
  })];
}
