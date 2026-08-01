import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  landbookListingPageUrl,
  parseLandbookListingPayload,
} from '../../packages/web-shell/lib/reference-bank-landbook.js';

const root = process.cwd();
const firecrawlDir = path.join(root, '.firecrawl');
const pilotDir = path.join(firecrawlDir, 'reference-landbook-pilot');
const listingDir = path.join(pilotDir, 'listings');
const detailDir = path.join(pilotDir, 'details');
const manifestPath = path.join(pilotDir, 'collection-manifest.json');
const resultPath = path.join(pilotDir, 'collection-result.json');
const listingPages = [1, 2];
const maximumWebsiteRecords = 100;
const concurrency = 2;
const requestIntervalMs = 15_000;
const retryDelayMs = 45_000;
const maxAttempts = 3;
const scrapeFormat = 'markdown,links,images,html';
const generatedAt = '2026-08-01T00:00:00.000Z';

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function snapshotKey(value) {
  try {
    const url = new URL(value);
    url.protocol = 'https:';
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    url.hash = '';
    url.searchParams.sort();
    url.pathname = url.pathname === '/' ? '/' : url.pathname.replace(/\/$/, '');
    return url.href;
  } catch {
    return null;
  }
}

function safeRecordId(value) {
  return String(value || 'unknown').toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
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

async function snapshotIsUsable(filename, url) {
  try {
    const payload = await readJson(filename);
    return snapshotKey(payload?.metadata?.sourceURL) === snapshotKey(url)
      && scrapeFormat.split(',').every((key) => payload?.[key] != null);
  } catch {
    return false;
  }
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

async function reusableSnapshots() {
  const snapshots = new Map();
  for (const filename of (await walkJson(firecrawlDir)).sort()) {
    try {
      const payload = await readJson(filename);
      const key = snapshotKey(payload?.metadata?.sourceURL);
      if (
        key
        && scrapeFormat.split(',').every((field) => payload?.[field] != null)
        && !snapshots.has(key)
      ) snapshots.set(key, filename);
    } catch {
      // Invalid or unrelated ignored output is never reused.
    }
  }
  return snapshots;
}

async function scrape(url, output) {
  const args = ['scrape', url, '-f', scrapeFormat, '-o', output, '--json', '--pretty'];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await new Promise((resolve, reject) => {
        const child = spawn('firecrawl', args, { cwd: root, stdio: 'inherit' });
        child.on('error', reject);
        child.on('exit', (code) => (
          code === 0 ? resolve() : reject(new Error(`Firecrawl exited with ${code} for ${url}`))
        ));
      });
      if (!(await snapshotIsUsable(output, url))) {
        throw new Error(`Firecrawl returned an incomplete snapshot for ${url}`);
      }
      return;
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      await wait(retryDelayMs);
    }
  }
}

async function ensureSnapshot({ url, output, reusable }) {
  if (await snapshotIsUsable(output, url)) {
    return { filename: output, reused: true };
  }
  const prior = reusable.get(snapshotKey(url));
  await fs.mkdir(path.dirname(output), { recursive: true });
  if (prior && await snapshotIsUsable(prior, url)) {
    await fs.copyFile(prior, output);
    return { filename: output, reused: true };
  }
  await scrape(url, output);
  return { filename: output, reused: false };
}

function listingRecord(item, resolution) {
  const sourceRecordId = String(item.source?.recordId || item.sourceRecordId || '');
  const listingUrl = item.source?.listingUrl || item.listingUrl;
  const listingPage = item.source?.taxonomy?.listingPage || item.sourceTaxonomy?.listingPage;
  return {
    sourceRecordId,
    listingPage,
    listingUrl,
    detailUrl: item.sourceDetailUrl,
    title: item.title || '',
    listingThumbnailUrl: item.thumbnailUrl || '',
    resolution,
  };
}

function parsePilotListings(listings) {
  const parsed = listings.map(({ listingUrl, payload }) => (
    parseLandbookListingPayload(payload, listingUrl)
  ));
  const records = parsed.flatMap((page) => [
    ...page.appearances.map((item) => listingRecord(item, 'listing_and_detail')),
    ...page.websiteCandidates.map((item) => listingRecord(item, 'detail_required')),
  ]);
  const uniqueRecords = [...new Map(records.map((item) => [item.sourceRecordId, item])).values()];
  const selectedRecords = uniqueRecords.slice(0, maximumWebsiteRecords);
  return {
    parsed,
    selectedRecords,
    laneCounts: {
      websiteCards: records.length,
      uniqueWebsiteCards: uniqueRecords.length,
      selectedWebsiteCards: selectedRecords.length,
      templates: parsed.reduce((total, page) => total + page.templates.length, 0),
      advertisements: parsed.reduce((total, page) => total + page.advertisements.length, 0),
      rejections: parsed.reduce((total, page) => total + page.rejections.length, 0),
    },
  };
}

async function writeFrozenManifest(manifest) {
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  if (await exists(manifestPath)) {
    const prior = await fs.readFile(manifestPath, 'utf8');
    if (prior !== text) {
      throw new Error('Existing Landbook pilot manifest differs from the approved frozen scope.');
    }
    return;
  }
  await fs.writeFile(manifestPath, text);
}

async function runQueue(jobs) {
  let cursor = 0;
  let fetched = 0;
  let reused = 0;
  async function worker() {
    while (cursor < jobs.length) {
      const job = jobs[cursor];
      cursor += 1;
      const result = await ensureSnapshot(job);
      if (result.reused) reused += 1;
      else {
        fetched += 1;
        if (cursor < jobs.length) await wait(requestIntervalMs);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, () => worker()));
  return { fetched, reused };
}

await fs.mkdir(pilotDir, { recursive: true });
const reusable = await reusableSnapshots();
const listingSnapshots = [];
for (const page of listingPages) {
  const listingUrl = landbookListingPageUrl(page);
  const result = await ensureSnapshot({
    url: listingUrl,
    output: path.join(listingDir, `listing-page-${page}.json`),
    reusable,
  });
  const raw = await fs.readFile(result.filename, 'utf8');
  listingSnapshots.push({
    page,
    listingUrl,
    filename: path.relative(root, result.filename),
    sha256: digest(raw),
    reused: result.reused,
    payload: JSON.parse(raw),
  });
  if (!result.reused && page !== listingPages.at(-1)) await wait(requestIntervalMs);
}

const { selectedRecords, laneCounts } = parsePilotListings(listingSnapshots.map((item) => ({
  listingUrl: item.listingUrl,
  payload: item.payload,
})));
if (!selectedRecords.length || selectedRecords.length > maximumWebsiteRecords) {
  throw new Error(`Landbook pilot must select 1-${maximumWebsiteRecords} website records; found ${selectedRecords.length}.`);
}
if (selectedRecords.some((item) => !item.sourceRecordId || !item.detailUrl || !item.listingThumbnailUrl)) {
  throw new Error('Every selected Landbook listing record must retain its ID, detail URL, and thumbnail.');
}

const manifest = {
  scope: 'bounded-landbook-thumbnail-link-pilot',
  generatedAt,
  listingPages,
  maximumWebsiteRecords,
  listingSnapshots: listingSnapshots.map(({ payload, reused, ...item }) => item),
  selectedRecords,
  selectedRecordIdsSha256: digest(`${selectedRecords.map((item) => item.sourceRecordId).join('\n')}\n`),
  laneCounts,
  constraints: {
    detailDepth: 1,
    destinationSiteFetches: 0,
    databaseTarget: 'isolated-only',
    templatesImportable: false,
    advertisementsImportable: false,
    generationTriggered: false,
  },
};
await writeFrozenManifest(manifest);

const detailJobs = selectedRecords.map((item) => ({
  url: item.detailUrl,
  output: path.join(
    detailDir,
    `detail-${safeRecordId(item.sourceRecordId)}-${digest(item.detailUrl).slice(0, 8)}.json`,
  ),
  reusable,
}));
const detailRun = await runQueue(detailJobs);
const detailSnapshots = [];
for (const [index, job] of detailJobs.entries()) {
  const raw = await fs.readFile(job.output, 'utf8');
  detailSnapshots.push({
    sourceRecordId: selectedRecords[index].sourceRecordId,
    detailUrl: selectedRecords[index].detailUrl,
    filename: path.relative(root, job.output),
    sha256: digest(raw),
  });
}
const result = {
  scope: manifest.scope,
  manifestSha256: digest(await fs.readFile(manifestPath, 'utf8')),
  detailSnapshots,
};
await fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);

process.stdout.write(`${JSON.stringify({
  scope: manifest.scope,
  listingPages,
  maximumWebsiteRecords,
  laneCounts,
  detailSnapshots: {
    requested: detailJobs.length,
    ...detailRun,
  },
  manifest: path.relative(root, manifestPath),
  result: path.relative(root, resultPath),
}, null, 2)}\n`);
