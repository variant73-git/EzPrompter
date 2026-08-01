import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  parseMinimalGalleryListingPayload,
  parseSiteOfSitesListingPayload,
  selectSiteOfSitesSitemapIncrement,
} from '../../packages/web-shell/lib/reference-bank-ingest.js';

const root = process.cwd();
const firecrawlDir = path.join(root, '.firecrawl');
const proofDir = path.join(firecrawlDir, 'reference-proof');
const incrementDir = path.join(firecrawlDir, 'reference-increment-1');
const concurrency = 1;
const requestIntervalMs = 8_000;
const retryDelayMs = 45_000;
const maxAttempts = 3;
const minimalPages = [3, 4];
const siteOfSitesLimit = 36;

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

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
  throw new Error(`Missing required prior proof input: ${paths.join(' or ')}`);
}

async function ensureScrape({ url, output, format = 'markdown,links,images,html' }) {
  if (await exists(output)) {
    try {
      const payload = await readJson(output);
      const usable = format === 'map'
        ? Array.isArray(payload?.data?.links)
        : format.split(',').every((key) => payload?.[key] != null);
      if (usable) return { filename: output, payload, reused: true };
    } catch {
      // A power loss can leave a partial output. Firecrawl will replace it below.
    }
  }

  await fs.mkdir(path.dirname(output), { recursive: true });
  const args = format === 'map'
    ? ['map', url, '--sitemap', 'only', '--limit', '1000', '--ignore-query-parameters', '--wait', '-o', output, '--json', '--pretty']
    : ['scrape', url, '-f', format, '-o', output, '--json', '--pretty'];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await new Promise((resolve, reject) => {
        const child = spawn('firecrawl', args, { cwd: root, stdio: 'inherit' });
        child.on('error', reject);
        child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Firecrawl exited with ${code} for ${url}`))));
      });
      break;
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      await wait(retryDelayMs);
    }
  }
  return { filename: output, payload: await readJson(output), reused: false };
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

async function existingDetailSnapshots() {
  const filenames = await walkJson(firecrawlDir);
  const snapshots = new Map();
  for (const filename of filenames.sort()) {
    if (!path.basename(filename).startsWith('detail-') && !path.basename(filename).startsWith('discovery-detail-')) continue;
    try {
      const payload = await readJson(filename);
      const key = comparableUrl(payload?.metadata?.sourceURL);
      if (key && !snapshots.has(key)) snapshots.set(key, filename);
    } catch {
      // Malformed unrelated snapshots are ignored and never enter the increment.
    }
  }
  return snapshots;
}

function safeRecordId(value) {
  return String(value || 'unknown').toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
}

function detailRecordId(detailUrl) {
  try {
    return new URL(detailUrl).pathname.split('/').filter(Boolean).at(-1) || detailUrl;
  } catch {
    return detailUrl;
  }
}

async function runQueue(jobs) {
  let cursor = 0;
  let fetched = 0;
  async function worker() {
    while (cursor < jobs.length) {
      const job = jobs[cursor];
      cursor += 1;
      await ensureScrape(job);
      fetched += 1;
      if (cursor < jobs.length) await wait(requestIntervalMs);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, () => worker()));
  return fetched;
}

await fs.mkdir(incrementDir, { recursive: true });

const minimalListings = [];
for (const page of minimalPages) {
  const listingUrl = `https://minimal.gallery/websites/page/${page}/`;
  const result = await ensureScrape({
    url: listingUrl,
    output: path.join(incrementDir, 'minimal-gallery', `listing-page-${page}.json`),
  });
  minimalListings.push({ page, listingUrl, payload: result.payload });
  if (!result.reused && page !== minimalPages.at(-1)) await wait(requestIntervalMs);
}

const sitemapResult = await ensureScrape({
  url: 'https://www.siteofsites.co/',
  output: path.join(incrementDir, 'site-of-sites', 'sitemap.json'),
  format: 'map',
});
const priorSiteListing = await readFirst([
  path.join(proofDir, 'site-of-sites', 'listing-current.json'),
  path.join(firecrawlDir, 'discovery-siteofsites.json'),
]);
const priorSiteItems = parseSiteOfSitesListingPayload(priorSiteListing);
const priorDetailUrls = [...new Set(priorSiteItems.map((item) => comparableUrl(item.sourceDetailUrl)).filter(Boolean))];
if (priorDetailUrls.length !== 36) {
  throw new Error(`Expected 36 prior Site of Sites proof details, found ${priorDetailUrls.length}.`);
}
const sitemapLinks = sitemapResult.payload?.data?.links || [];
const selectedSiteDetailUrls = selectSiteOfSitesSitemapIncrement(
  sitemapLinks,
  priorDetailUrls,
  siteOfSitesLimit,
);
if (selectedSiteDetailUrls.length !== siteOfSitesLimit) {
  throw new Error(`Expected ${siteOfSitesLimit} new Site of Sites details, found ${selectedSiteDetailUrls.length}.`);
}
const sitemapText = await fs.readFile(sitemapResult.filename, 'utf8');
const manifest = {
  scope: 'bounded-two-source-increment-1',
  generatedAt: '2026-08-01T00:00:00.000Z',
  minimalGallery: {
    pages: minimalPages,
    maximumListingRecords: 46,
    listingUrls: minimalListings.map((item) => item.listingUrl),
  },
  siteOfSites: {
    selectionLimit: siteOfSitesLimit,
    priorProofDetailCount: priorDetailUrls.length,
    priorProofDetailUrlsSha256: digest(`${[...priorDetailUrls].sort().join('\n')}\n`),
    sitemapSha256: digest(sitemapText),
    selectedDetailUrls: selectedSiteDetailUrls,
  },
};
await fs.writeFile(
  path.join(incrementDir, 'collection-manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

const minimalItems = minimalListings.flatMap(({ listingUrl, payload }) => (
  parseMinimalGalleryListingPayload(payload, listingUrl)
));
const uniqueMinimalItems = [...new Map(minimalItems.map((item) => [item.source.recordId, item])).values()];
if (uniqueMinimalItems.length < 1 || uniqueMinimalItems.length > manifest.minimalGallery.maximumListingRecords) {
  throw new Error(`Minimal Gallery increment must contain 1-${manifest.minimalGallery.maximumListingRecords} records; found ${uniqueMinimalItems.length}.`);
}

const requestedDetails = [
  ...uniqueMinimalItems.map((item) => ({
    sourceId: item.source.id,
    recordId: item.source.recordId,
    detailUrl: item.sourceDetailUrl,
  })),
  ...selectedSiteDetailUrls.map((detailUrl) => ({
    sourceId: 'siteofsites',
    recordId: detailRecordId(detailUrl),
    detailUrl,
  })),
];
const existing = await existingDetailSnapshots();
const jobs = requestedDetails.flatMap((item) => {
  if (!item.detailUrl || existing.has(comparableUrl(item.detailUrl))) return [];
  const suffix = digest(item.detailUrl).slice(0, 8);
  return [{
    url: item.detailUrl,
    output: path.join(
      incrementDir,
      item.sourceId === 'minimalgallery' ? 'minimal-gallery' : 'site-of-sites',
      `detail-${safeRecordId(item.recordId)}-${suffix}.json`,
    ),
  }];
});

const fetched = await runQueue(jobs);
process.stdout.write(`${JSON.stringify({
  scope: manifest.scope,
  listings: {
    minimalgallery: uniqueMinimalItems.length,
    siteofsites: selectedSiteDetailUrls.length,
  },
  detailSnapshots: {
    requested: requestedDetails.length,
    reused: requestedDetails.length - jobs.length,
    fetched,
  },
  manifest: path.relative(root, path.join(incrementDir, 'collection-manifest.json')),
}, null, 2)}\n`);
