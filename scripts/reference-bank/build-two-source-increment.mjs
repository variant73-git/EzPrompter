import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  mergeReferenceAppearances,
  parseMinimalGalleryDetailPayload,
  parseMinimalGalleryListingPayload,
  parseSiteOfSitesDetailPayload,
  parseSiteOfSitesListingPayload,
  selectSiteOfSitesSitemapIncrement,
} from '../../packages/web-shell/lib/reference-bank-ingest.js';
import { canonicalizeReferenceUrl } from '../../packages/web-shell/lib/reference-bank-normalize.js';

const root = process.cwd();
const firecrawlDir = path.join(root, '.firecrawl');
const proofDir = path.join(firecrawlDir, 'reference-proof');
const incrementDir = path.join(firecrawlDir, 'reference-increment-1');
const outputSeedPath = path.join(incrementDir, 'reference-bank.increment.seed.json');
const outputReportPath = path.join(incrementDir, 'reference-bank.increment.report.json');
const generatedAt = process.env.REFERENCE_INCREMENT_GENERATED_AT || '2026-08-01T00:00:00.000Z';

function comparableUrl(value) {
  try {
    const url = new URL(value);
    url.protocol = 'https:';
    url.hostname = url.hostname.toLowerCase();
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname === '/' ? '/' : url.pathname.replace(/\/$/, '');
    return url.href;
  } catch {
    return null;
  }
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function exists(filename) {
  try {
    await fs.access(filename);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filename) {
  return JSON.parse(await fs.readFile(filename, 'utf8'));
}

async function readFirst(paths) {
  for (const filename of paths) {
    if (await exists(filename)) return readJson(filename);
  }
  throw new Error(`Missing increment input: ${paths.join(' or ')}`);
}

async function walkJson(directory) {
  if (!(await exists(directory))) return [];
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkJson(filename);
    return entry.isFile() && entry.name.endsWith('.json') ? [filename] : [];
  }));
  return nested.flat();
}

async function detailPayloadsByUrl() {
  const filenames = await walkJson(firecrawlDir);
  const payloads = new Map();
  for (const filename of filenames.sort()) {
    if (!path.basename(filename).startsWith('detail-') && !path.basename(filename).startsWith('discovery-detail-')) continue;
    try {
      const payload = await readJson(filename);
      const key = comparableUrl(payload?.metadata?.sourceURL);
      if (key && !payloads.has(key)) payloads.set(key, { filename, payload });
    } catch {
      // Malformed unrelated snapshots never enter the increment.
    }
  }
  return payloads;
}

function seedAppearances(seed) {
  return (seed.references || []).flatMap((reference) => (reference.sources || []).map((source) => ({
    title: reference.title,
    url: reference.url,
    description: reference.description || '',
    thumbnailUrl: source.thumbnailUrl || reference.thumbnailUrl || '',
    categories: reference.categories || [],
    tags: reference.tags || [],
    featured: Boolean(reference.featured),
    publishedAt: reference.publishedAt || null,
    sourceDetailUrl: source.detailUrl || null,
    sourceTaxonomy: source.taxonomy || {},
    source: {
      id: source.id,
      name: source.name,
      listingUrl: source.listingUrl,
      recordId: String(source.recordId || source.detailUrl || reference.url),
      taxonomy: source.taxonomy || {},
    },
  })));
}

function sourceCounts(appearances) {
  return appearances.reduce((counts, item) => {
    counts[item.source.id] = (counts[item.source.id] || 0) + 1;
    return counts;
  }, {});
}

function duplicateGroups(appearances) {
  const groups = new Map();
  for (const item of appearances) {
    const canonical = canonicalizeReferenceUrl(item.url);
    if (!canonical) continue;
    const current = groups.get(canonical.canonicalKey) || [];
    current.push(item);
    groups.set(canonical.canonicalKey, current);
  }
  return [...groups.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([canonicalKey, items]) => ({
      canonicalKey,
      appearances: items.map((item) => ({
        sourceId: item.source.id,
        sourceRecordId: item.source.recordId,
        targetUrl: item.url,
      })).sort((a, b) => (
        a.sourceId.localeCompare(b.sourceId)
        || a.sourceRecordId.localeCompare(b.sourceRecordId)
      )),
    }))
    .sort((a, b) => a.canonicalKey.localeCompare(b.canonicalKey));
}

const manifestPath = path.join(incrementDir, 'collection-manifest.json');
const sitemapPath = path.join(incrementDir, 'site-of-sites', 'sitemap.json');
const [manifest, minimalPage3, minimalPage4, sitemap, priorSiteListing, priorSeed, details] = await Promise.all([
  readJson(manifestPath),
  readJson(path.join(incrementDir, 'minimal-gallery', 'listing-page-3.json')),
  readJson(path.join(incrementDir, 'minimal-gallery', 'listing-page-4.json')),
  readJson(sitemapPath),
  readFirst([
    path.join(proofDir, 'site-of-sites', 'listing-current.json'),
    path.join(firecrawlDir, 'discovery-siteofsites.json'),
  ]),
  readJson(path.join(proofDir, 'reference-bank.proof.seed.json')),
  detailPayloadsByUrl(),
]);

if (manifest.scope !== 'bounded-two-source-increment-1') {
  throw new Error(`Unexpected increment scope: ${manifest.scope}`);
}
if (JSON.stringify(manifest.minimalGallery?.pages) !== JSON.stringify([3, 4])) {
  throw new Error('Increment manifest must remain limited to Minimal Gallery pages 3 and 4.');
}
if (manifest.siteOfSites?.selectionLimit !== 36 || manifest.siteOfSites.selectedDetailUrls?.length !== 36) {
  throw new Error('Increment manifest must remain limited to 36 Site of Sites details.');
}
const sitemapText = await fs.readFile(sitemapPath, 'utf8');
if (digest(sitemapText) !== manifest.siteOfSites.sitemapSha256) {
  throw new Error('Site of Sites sitemap snapshot no longer matches the frozen manifest hash.');
}
const priorSiteItems = parseSiteOfSitesListingPayload(priorSiteListing);
const priorDetailUrls = [...new Set(priorSiteItems.map((item) => comparableUrl(item.sourceDetailUrl)).filter(Boolean))];
if (priorDetailUrls.length !== manifest.siteOfSites.priorProofDetailCount) {
  throw new Error('Prior Site of Sites proof detail count no longer matches the frozen manifest.');
}
const priorDetailUrlsSha256 = digest(`${[...priorDetailUrls].sort().join('\n')}\n`);
if (priorDetailUrlsSha256 !== manifest.siteOfSites.priorProofDetailUrlsSha256) {
  throw new Error('Prior Site of Sites proof detail URLs no longer match the frozen manifest hash.');
}
const selectedAgain = selectSiteOfSitesSitemapIncrement(
  sitemap?.data?.links || [],
  priorDetailUrls,
  manifest.siteOfSites.selectionLimit,
);
if (JSON.stringify(selectedAgain) !== JSON.stringify(manifest.siteOfSites.selectedDetailUrls)) {
  throw new Error('Site of Sites selection no longer matches the frozen sitemap cursor.');
}

const rawMinimalItems = [
  ...parseMinimalGalleryListingPayload(minimalPage3, 'https://minimal.gallery/websites/page/3/'),
  ...parseMinimalGalleryListingPayload(minimalPage4, 'https://minimal.gallery/websites/page/4/'),
];
const minimalItems = [...new Map(rawMinimalItems.map((item) => [item.source.recordId, item])).values()];
if (minimalItems.length < 1 || minimalItems.length > manifest.minimalGallery.maximumListingRecords) {
  throw new Error(`Minimal Gallery increment exceeds its bound: ${minimalItems.length}.`);
}
const siteItems = manifest.siteOfSites.selectedDetailUrls.map((sourceDetailUrl) => ({
  sourceDetailUrl,
  source: {
    id: 'siteofsites',
    name: 'Site of Sites',
    listingUrl: 'https://www.siteofsites.co/',
    recordId: new URL(sourceDetailUrl).pathname.split('/').filter(Boolean).at(-1),
    taxonomy: {
      selectedFromSitemap: true,
      sitemapSha256: manifest.siteOfSites.sitemapSha256,
      increment: 1,
    },
  },
}));
const listingItems = [...minimalItems, ...siteItems].sort((a, b) => (
  a.source.id.localeCompare(b.source.id)
  || a.source.recordId.localeCompare(b.source.recordId)
));

const rejections = [];
const incrementalAppearances = [];
for (const fallback of listingItems) {
  const detailKey = comparableUrl(fallback.sourceDetailUrl);
  if (!detailKey || !details.has(detailKey)) {
    rejections.push({ sourceId: fallback.source.id, sourceRecordId: fallback.source.recordId, reason: 'missing_detail_snapshot' });
    continue;
  }
  const { payload } = details.get(detailKey);
  const parsed = fallback.source.id === 'minimalgallery'
    ? parseMinimalGalleryDetailPayload(payload, fallback)
    : parseSiteOfSitesDetailPayload(payload, fallback);
  if (!parsed.length) {
    rejections.push({ sourceId: fallback.source.id, sourceRecordId: fallback.source.recordId, reason: 'detail_parse_failed' });
    continue;
  }
  if (!canonicalizeReferenceUrl(parsed[0].url)) {
    rejections.push({ sourceId: fallback.source.id, sourceRecordId: fallback.source.recordId, reason: 'invalid_target_url' });
    continue;
  }
  incrementalAppearances.push(parsed[0]);
}

const priorAppearances = seedAppearances(priorSeed);
const combinedAppearances = [...priorAppearances, ...incrementalAppearances];
const incrementalReferences = mergeReferenceAppearances(incrementalAppearances, generatedAt);
const combinedReferences = mergeReferenceAppearances(combinedAppearances, generatedAt);
const priorKeys = new Map((priorSeed.references || []).flatMap((reference) => {
  const key = canonicalizeReferenceUrl(reference.url)?.canonicalKey;
  return key ? [[key, reference]] : [];
}));
const incrementalKeys = new Set(incrementalReferences.map((reference) => canonicalizeReferenceUrl(reference.url)?.canonicalKey).filter(Boolean));
const duplicates = duplicateGroups(incrementalAppearances);
const crossSourceDuplicates = duplicates.filter((group) => new Set(group.appearances.map((item) => item.sourceId)).size > 1);
const existingCanonicalMatches = [...incrementalKeys]
  .filter((key) => priorKeys.has(key))
  .sort()
  .map((canonicalKey) => ({
    canonicalKey,
    existingSourceIds: priorKeys.get(canonicalKey).sourceIds || [],
    incrementalAppearances: incrementalAppearances
      .filter((item) => canonicalizeReferenceUrl(item.url)?.canonicalKey === canonicalKey)
      .map((item) => ({
        sourceId: item.source.id,
        sourceRecordId: item.source.recordId,
        targetUrl: item.url,
      })),
  }));

const incrementalStats = {
  listingRecords: sourceCounts(listingItems),
  acceptedAppearances: sourceCounts(incrementalAppearances),
  rejectedRecords: rejections.length,
  incrementalAppearances: incrementalAppearances.length,
  incrementalReferences: incrementalReferences.length,
  incrementalDuplicatesMerged: incrementalAppearances.length - incrementalReferences.length,
  crossSourceDuplicateGroups: crossSourceDuplicates.length,
  newCanonicalSites: [...incrementalKeys].filter((key) => !priorKeys.has(key)).length,
  existingCanonicalSitesMatched: existingCanonicalMatches.length,
};
const combinedSeed = {
  generatedAt,
  stats: {
    ...priorSeed.stats,
    appearances: combinedAppearances.length,
    references: combinedReferences.length,
    duplicatesMerged: combinedAppearances.length - combinedReferences.length,
    sources: sourceCounts(combinedAppearances),
    incremental: incrementalStats,
  },
  references: combinedReferences,
};
const seedText = `${JSON.stringify(combinedSeed, null, 2)}\n`;
const seedSha256 = digest(seedText);
const canonicalizationSamples = Object.fromEntries(['minimalgallery', 'siteofsites'].map((sourceId) => [
  sourceId,
  incrementalAppearances
    .filter((item) => item.source.id === sourceId)
    .slice(0, 5)
    .map((item) => ({
      sourceRecordId: item.source.recordId,
      input: item.url,
      output: canonicalizeReferenceUrl(item.url)?.canonicalUrl || null,
    })),
]));
const report = {
  generatedAt,
  scope: manifest.scope,
  databaseTarget: 'isolated-only',
  generationTriggered: false,
  deepCaptureTriggered: false,
  ratingsInferred: false,
  selection: {
    minimalGalleryPages: manifest.minimalGallery.pages,
    minimalGalleryMaximumListingRecords: manifest.minimalGallery.maximumListingRecords,
    siteOfSitesSelectionLimit: manifest.siteOfSites.selectionLimit,
    siteOfSitesSitemapSha256: manifest.siteOfSites.sitemapSha256,
    siteOfSitesSelectedDetailUrls: manifest.siteOfSites.selectedDetailUrls,
  },
  incrementalStats,
  rejectedByReason: Object.fromEntries([...new Set(rejections.map((item) => item.reason))].sort().map((reason) => [
    reason,
    rejections.filter((item) => item.reason === reason).length,
  ])),
  rejections,
  canonicalizationSamples,
  duplicateGroups: duplicates,
  crossSourceDuplicates,
  existingCanonicalMatches,
  outputSeed: path.relative(root, outputSeedPath),
  outputSeedSha256: seedSha256,
};
const reportText = `${JSON.stringify(report, null, 2)}\n`;

await fs.mkdir(incrementDir, { recursive: true });
await fs.writeFile(outputSeedPath, seedText);
await fs.writeFile(outputReportPath, reportText);

process.stdout.write(`${JSON.stringify({
  incrementalStats,
  outputSeedSha256: seedSha256,
  outputReportSha256: digest(reportText),
  outputSeedPath: path.relative(root, outputSeedPath),
  outputReportPath: path.relative(root, outputReportPath),
}, null, 2)}\n`);
