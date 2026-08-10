import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  mergeReferenceAppearances,
  parseMinimalGalleryDetailPayload,
  parseMinimalGalleryListingPayload,
  parseSiteOfSitesDetailPayload,
  parseSiteOfSitesListingPayload,
} from '../../packages/web-shell/lib/reference-bank-ingest.js';
import { canonicalizeReferenceUrl } from '../../packages/web-shell/lib/reference-bank-normalize.js';

const root = process.cwd();
const firecrawlDir = path.join(root, '.firecrawl');
const proofDir = path.join(firecrawlDir, 'reference-proof');
const outputSeedPath = path.join(proofDir, 'reference-bank.proof.seed.json');
const outputReportPath = path.join(proofDir, 'reference-bank.proof.report.json');
const generatedAt = process.env.REFERENCE_PROOF_GENERATED_AT || '2026-07-31T00:00:00.000Z';

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
  throw new Error(`Missing proof input: ${paths.join(' or ')}`);
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
  const legacy = (await fs.readdir(firecrawlDir))
    .filter((name) => name.startsWith('discovery-detail-') && name.endsWith('.json'))
    .map((name) => path.join(firecrawlDir, name));
  const proof = (await walkJson(proofDir)).filter((filename) => path.basename(filename).startsWith('detail-'));
  const payloads = new Map();
  for (const filename of [...legacy, ...proof].sort()) {
    try {
      const payload = await readJson(filename);
      const key = comparableUrl(payload?.metadata?.sourceURL);
      if (key && !payloads.has(key)) payloads.set(key, { filename, payload });
    } catch {
      // Malformed unrelated files never enter the proof.
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

const [minimalPage1, minimalPage2, siteOfSitesListing, sitemap, currentSeed, details] = await Promise.all([
  readFirst([
    path.join(proofDir, 'minimal-gallery', 'listing-page-1.json'),
    path.join(firecrawlDir, 'discovery-minimal-gallery.json'),
  ]),
  readFirst([
    path.join(proofDir, 'minimal-gallery', 'listing-page-2.json'),
    path.join(firecrawlDir, 'discovery-page-minimal-gallery-2.json'),
  ]),
  readFirst([
    path.join(proofDir, 'site-of-sites', 'listing-current.json'),
    path.join(firecrawlDir, 'discovery-siteofsites.json'),
  ]),
  readFirst([
    path.join(proofDir, 'site-of-sites', 'sitemap.json'),
    path.join(firecrawlDir, 'discovery-map-siteofsites-sitemap-1000.json'),
  ]),
  readJson(path.join(root, 'packages/web-shell/lib/reference-bank.seed.json')),
  detailPayloadsByUrl(),
]);

const rawListingItems = [
  ...parseMinimalGalleryListingPayload(minimalPage1, 'https://minimal.gallery/websites/'),
  ...parseMinimalGalleryListingPayload(minimalPage2, 'https://minimal.gallery/websites/page/2/'),
  ...parseSiteOfSitesListingPayload(siteOfSitesListing),
];
const listingItems = [...new Map(rawListingItems.map((item) => [
  `${item.source.id}\u0000${item.source.recordId}`,
  item,
])).values()].sort((a, b) => (
  a.source.id.localeCompare(b.source.id)
  || a.source.recordId.localeCompare(b.source.recordId)
));
const sitemapUrls = new Set(
  (sitemap?.data?.links || []).map((link) => comparableUrl(link?.url)).filter(Boolean),
);

const rejections = [];
const proofAppearances = [];
for (const fallback of listingItems) {
  const detailKey = comparableUrl(fallback.sourceDetailUrl);
  if (!detailKey || !details.has(detailKey)) {
    rejections.push({ sourceId: fallback.source.id, sourceRecordId: fallback.source.recordId, reason: 'missing_detail_snapshot' });
    continue;
  }
  if (fallback.source.id === 'siteofsites' && !sitemapUrls.has(detailKey)) {
    rejections.push({ sourceId: fallback.source.id, sourceRecordId: fallback.source.recordId, reason: 'detail_not_in_sitemap' });
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
  proofAppearances.push(parsed[0]);
}

const existingAppearances = seedAppearances(currentSeed);
const combinedAppearances = [...existingAppearances, ...proofAppearances];
const proofReferences = mergeReferenceAppearances(proofAppearances, generatedAt);
const combinedReferences = mergeReferenceAppearances(combinedAppearances, generatedAt);
const existingKeys = new Set((currentSeed.references || []).map((reference) => canonicalizeReferenceUrl(reference.url)?.canonicalKey).filter(Boolean));
const proofKeys = new Set(proofReferences.map((reference) => canonicalizeReferenceUrl(reference.url)?.canonicalKey).filter(Boolean));
const duplicates = duplicateGroups(proofAppearances);
const crossSourceDuplicates = duplicates.filter((group) => new Set(group.appearances.map((item) => item.sourceId)).size > 1);

const proofStats = {
  listingRecords: sourceCounts(listingItems),
  acceptedAppearances: sourceCounts(proofAppearances),
  rejectedRecords: rejections.length,
  proofAppearances: proofAppearances.length,
  proofReferences: proofReferences.length,
  proofDuplicatesMerged: proofAppearances.length - proofReferences.length,
  crossSourceDuplicateGroups: crossSourceDuplicates.length,
  newCanonicalSites: [...proofKeys].filter((key) => !existingKeys.has(key)).length,
  existingCanonicalSitesMatched: [...proofKeys].filter((key) => existingKeys.has(key)).length,
};
const combinedSeed = {
  generatedAt,
  stats: {
    appearances: combinedAppearances.length,
    references: combinedReferences.length,
    duplicatesMerged: combinedAppearances.length - combinedReferences.length,
    sources: sourceCounts(combinedAppearances),
    proof: proofStats,
  },
  references: combinedReferences,
};
const seedText = `${JSON.stringify(combinedSeed, null, 2)}\n`;
const seedSha256 = createHash('sha256').update(seedText).digest('hex');
const canonicalizationSamples = Object.fromEntries(['minimalgallery', 'siteofsites'].map((sourceId) => [
  sourceId,
  proofAppearances
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
  scope: 'bounded-two-source-proof',
  databaseTarget: 'isolated-only',
  generationTriggered: false,
  deepCaptureTriggered: false,
  ratingsInferred: false,
  proofStats,
  rejectedByReason: Object.fromEntries([...new Set(rejections.map((item) => item.reason))].sort().map((reason) => [
    reason,
    rejections.filter((item) => item.reason === reason).length,
  ])),
  rejections,
  canonicalizationSamples,
  duplicateGroups: duplicates,
  crossSourceDuplicates,
  nonMergeReview: [
    {
      inputs: ['https://serotoninn.com/?ref=minimal.gallery', 'https://serotoninn.com/terms/#impressum'],
      outputs: ['https://serotoninn.com', 'https://serotoninn.com/terms'],
      reason: 'meaningful paths remain distinct pending manual review',
    },
  ],
  outputSeed: path.relative(root, outputSeedPath),
  outputSeedSha256: seedSha256,
};
const reportText = `${JSON.stringify(report, null, 2)}\n`;

await fs.mkdir(proofDir, { recursive: true });
await fs.writeFile(outputSeedPath, seedText);
await fs.writeFile(outputReportPath, reportText);

process.stdout.write(`${JSON.stringify({
  proofStats,
  outputSeedSha256: seedSha256,
  outputReportSha256: createHash('sha256').update(reportText).digest('hex'),
  outputSeedPath: path.relative(root, outputSeedPath),
  outputReportPath: path.relative(root, outputReportPath),
}, null, 2)}\n`);
