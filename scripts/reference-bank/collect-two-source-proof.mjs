import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  parseMinimalGalleryListingPayload,
  parseSiteOfSitesListingPayload,
} from '../../packages/web-shell/lib/reference-bank-ingest.js';

const root = process.cwd();
const firecrawlDir = path.join(root, '.firecrawl');
const proofDir = path.join(firecrawlDir, 'reference-proof');
const concurrency = 1;
const requestIntervalMs = 8_000;
const retryDelayMs = 45_000;
const maxAttempts = 3;

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

async function ensureScrape({ url, output, fallbacks = [], format = 'markdown,links,images,html' }) {
  for (const candidate of [output, ...fallbacks]) {
    if (!(await exists(candidate))) continue;
    const payload = await readJson(candidate);
    const usable = format === 'map'
      ? Array.isArray(payload?.data?.links)
      : format.split(',').every((key) => payload?.[key] != null);
    if (usable) return { filename: candidate, payload, reused: true };
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
  const filenames = [
    ...(await fs.readdir(firecrawlDir))
      .filter((name) => name.startsWith('discovery-detail-') && name.endsWith('.json'))
      .map((name) => path.join(firecrawlDir, name)),
    ...(await walkJson(proofDir)),
  ];
  const snapshots = new Map();
  for (const filename of filenames.sort()) {
    try {
      const payload = await readJson(filename);
      const key = comparableUrl(payload?.metadata?.sourceURL);
      if (key && !snapshots.has(key)) snapshots.set(key, filename);
    } catch {
      // A malformed unrelated snapshot is ignored and never treated as proof input.
    }
  }
  return snapshots;
}

function safeRecordId(value) {
  return String(value || 'unknown').toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
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

await fs.mkdir(proofDir, { recursive: true });

const minimalPage1 = await ensureScrape({
  url: 'https://minimal.gallery/websites/',
  output: path.join(proofDir, 'minimal-gallery', 'listing-page-1.json'),
  fallbacks: [path.join(firecrawlDir, 'discovery-minimal-gallery.json')],
});
const minimalPage2 = await ensureScrape({
  url: 'https://minimal.gallery/websites/page/2/',
  output: path.join(proofDir, 'minimal-gallery', 'listing-page-2.json'),
  fallbacks: [path.join(firecrawlDir, 'discovery-page-minimal-gallery-2.json')],
});
const siteOfSitesListing = await ensureScrape({
  url: 'https://www.siteofsites.co/',
  output: path.join(proofDir, 'site-of-sites', 'listing-current.json'),
  fallbacks: [path.join(firecrawlDir, 'discovery-siteofsites.json')],
});
await ensureScrape({
  url: 'https://www.siteofsites.co/',
  output: path.join(proofDir, 'site-of-sites', 'sitemap.json'),
  fallbacks: [path.join(firecrawlDir, 'discovery-map-siteofsites-sitemap-1000.json')],
  format: 'map',
});

const listingItems = [
  ...parseMinimalGalleryListingPayload(minimalPage1.payload, 'https://minimal.gallery/websites/'),
  ...parseMinimalGalleryListingPayload(minimalPage2.payload, 'https://minimal.gallery/websites/page/2/'),
  ...parseSiteOfSitesListingPayload(siteOfSitesListing.payload),
];
const uniqueItems = [...new Map(listingItems.map((item) => [
  `${item.source.id}\u0000${item.source.recordId}`,
  item,
])).values()];

const existing = await existingDetailSnapshots();
const jobs = uniqueItems.flatMap((item) => {
  const detailUrl = item.sourceDetailUrl;
  if (!detailUrl || existing.has(comparableUrl(detailUrl))) return [];
  return [{
    url: detailUrl,
    output: path.join(
      proofDir,
      item.source.id === 'minimalgallery' ? 'minimal-gallery' : 'site-of-sites',
      `detail-${safeRecordId(item.source.recordId)}.json`,
    ),
  }];
});

const fetched = await runQueue(jobs);
const sourceCounts = uniqueItems.reduce((counts, item) => {
  counts[item.source.id] = (counts[item.source.id] || 0) + 1;
  return counts;
}, {});

process.stdout.write(`${JSON.stringify({
  listings: sourceCounts,
  detailSnapshots: {
    requested: uniqueItems.length,
    reused: uniqueItems.length - jobs.length,
    fetched,
  },
}, null, 2)}\n`);
