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
const slice = process.argv.includes('--slice=pages-6-10') ? 'pages-6-10' : 'pilot';
const profiles = {
  pilot: {
    scope: 'bounded-landbook-thumbnail-link-pilot',
    directory: 'reference-landbook-pilot',
    listingPages: [1, 2],
    maximumWebsiteRecords: 100,
    expectedEnvelope: null,
    listingEvidence: null,
    priorSelection: null,
  },
  'pages-6-10': {
    scope: 'bounded-landbook-pages-6-10',
    directory: 'reference-landbook-pages-6-10',
    listingPages: [6, 7, 8, 9, 10],
    maximumWebsiteRecords: 100,
    expectedEnvelope: {
      websiteCards: 77,
      uniqueWebsiteCards: 77,
      selectedWebsiteCards: 77,
      templates: 23,
      advertisements: 4,
      rejections: 0,
      perPage: {
        6: { websiteCards: 15, templates: 5, advertisements: 1, rejections: 0 },
        7: { websiteCards: 16, templates: 4, advertisements: 0, rejections: 0 },
        8: { websiteCards: 15, templates: 5, advertisements: 1, rejections: 0 },
        9: { websiteCards: 15, templates: 5, advertisements: 1, rejections: 0 },
        10: { websiteCards: 16, templates: 4, advertisements: 1, rejections: 0 },
      },
    },
    listingEvidence: {
      6: {
        filename: 'reference-landbook-pagination-investigation/listing-page-6.json',
        sha256: '63f20d4ed105def5dd03d0091cc249f71fef8c0fcbef44fcebc75d6b753a5811',
      },
      7: {
        filename: 'reference-landbook-pagination-investigation/direct-page-7.html',
        sha256: 'fc3418342c09cb2064722e9625e8fbf939d04f36feedbe961bc13798bfee7197',
      },
      8: {
        filename: 'reference-landbook-pagination-investigation/direct-page-8.html',
        sha256: '222aa9014ffbbf55ab99199ef894dada6b1d3423db77863c9506ee2f766153c3',
      },
      9: {
        filename: 'reference-landbook-pagination-investigation/direct-page-9.html',
        sha256: '02ff833cb379bc4eb2013f4c6460afc4a86b073e2efc9cb6dc42c92bd6cefe25',
      },
      10: {
        filename: 'reference-landbook-pagination-investigation/direct-page-10.html',
        sha256: 'f05246402199046492c53b487181a241a0de33a78ed53aebb943348fa8067738',
      },
    },
    priorSelection: {
      manifest: 'reference-landbook-pilot/collection-manifest.json',
      selectedRecordIdsSha256: '0a0b85c7a5552a0bf527f5466b268c20081e118cc1766c566745ad050d790f4e',
    },
  },
};
const profile = profiles[slice];
const collectionDir = path.join(firecrawlDir, profile.directory);
const listingDir = path.join(collectionDir, 'listings');
const detailDir = path.join(collectionDir, 'details');
const manifestPath = path.join(collectionDir, 'collection-manifest.json');
const resultPath = path.join(collectionDir, 'collection-result.json');
const { listingPages, maximumWebsiteRecords } = profile;
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

async function readListingPayload(filename, listingUrl) {
  const raw = await fs.readFile(filename, 'utf8');
  if (filename.endsWith('.json')) return { raw, payload: JSON.parse(raw) };
  return { raw, payload: { html: raw, metadata: { sourceURL: listingUrl } } };
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
  const records = parsed.flatMap((page) => (
    slice === 'pilot' ? [...page.appearances, ...page.websiteCandidates] : page.websiteRecords
  ).map((item) => (
    listingRecord(item, item.lane === 'website_candidate' ? 'detail_required' : 'listing_and_detail')
  )));
  const uniqueRecords = [...new Map(records.map((item) => [item.sourceRecordId, item])).values()];
  const selectedRecords = uniqueRecords.slice(0, maximumWebsiteRecords);
  const pageLaneCounts = Object.fromEntries(parsed.map((page) => [page.page, {
    websiteCards: page.websiteRecords.length,
    templates: page.templates.length,
    advertisements: page.advertisements.length,
    rejections: page.rejections.length,
  }]));
  return {
    parsed,
    records,
    uniqueRecords,
    selectedRecords,
    pageLaneCounts,
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
      throw new Error(`Existing Landbook ${slice} manifest differs from the approved frozen scope.`);
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

await fs.mkdir(collectionDir, { recursive: true });
const reusable = await reusableSnapshots();
const listingSnapshots = [];
for (const page of listingPages) {
  const listingUrl = landbookListingPageUrl(page);
  let result;
  let evidenceSource = null;
  let evidenceSha256 = null;
  if (profile.listingEvidence) {
    const evidence = profile.listingEvidence[page];
    evidenceSource = path.join(firecrawlDir, evidence.filename);
    const extension = path.extname(evidenceSource);
    const output = path.join(listingDir, `listing-page-${page}${extension}`);
    await fs.mkdir(listingDir, { recursive: true });
    const evidenceRaw = await fs.readFile(evidenceSource, 'utf8');
    evidenceSha256 = digest(evidenceRaw);
    if (evidenceSha256 !== evidence.sha256) {
      throw new Error(`Landbook page ${page} discovery evidence no longer matches its approved hash.`);
    }
    if (await exists(output)) {
      const outputRaw = await fs.readFile(output, 'utf8');
      if (outputRaw !== evidenceRaw) {
        throw new Error(`Existing Landbook page ${page} snapshot differs from approved discovery evidence.`);
      }
    } else {
      await fs.copyFile(evidenceSource, output);
    }
    result = { filename: output, reused: true };
  } else {
    result = await ensureSnapshot({
      url: listingUrl,
      output: path.join(listingDir, `listing-page-${page}.json`),
      reusable,
    });
  }
  const { raw, payload } = await readListingPayload(result.filename, listingUrl);
  listingSnapshots.push({
    page,
    listingUrl,
    filename: path.relative(root, result.filename),
    sha256: digest(raw),
    ...(evidenceSource ? {
      evidenceSourceFilename: path.relative(root, evidenceSource),
      evidenceSourceSha256: evidenceSha256,
    } : {}),
    reused: result.reused,
    payload,
  });
  if (!result.reused && page !== listingPages.at(-1)) await wait(requestIntervalMs);
}

const {
  records,
  uniqueRecords,
  selectedRecords,
  pageLaneCounts,
  laneCounts,
} = parsePilotListings(listingSnapshots.map((item) => ({
  listingUrl: item.listingUrl,
  payload: item.payload,
})));
if (!selectedRecords.length || selectedRecords.length > maximumWebsiteRecords) {
  throw new Error(`Landbook pilot must select 1-${maximumWebsiteRecords} website records; found ${selectedRecords.length}.`);
}
if (selectedRecords.some((item) => !item.sourceRecordId || !item.detailUrl || !item.listingThumbnailUrl)) {
  throw new Error('Every selected Landbook listing record must retain its ID, detail URL, and thumbnail.');
}
if (profile.expectedEnvelope) {
  for (const page of listingPages) {
    const expected = profile.expectedEnvelope.perPage[page];
    const actual = pageLaneCounts[page];
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`Landbook page ${page} moved outside the approved discovery envelope.`);
    }
    const logicalCards = actual.websiteCards + actual.templates + actual.rejections;
    if (logicalCards !== 20) {
      throw new Error(`Landbook page ${page} must contain exactly the first 20 logical website cards.`);
    }
  }
  const { perPage, ...expectedTotals } = profile.expectedEnvelope;
  if (JSON.stringify(laneCounts) !== JSON.stringify(expectedTotals)) {
    throw new Error('Landbook pages 6-10 totals moved outside the approved discovery envelope.');
  }
  if (records.length !== uniqueRecords.length) {
    throw new Error('Landbook pages 6-10 contain duplicate ordinary IDs within the approved slice.');
  }
}

let priorSelectionExclusion = null;
if (profile.priorSelection) {
  const priorManifestPath = path.join(firecrawlDir, profile.priorSelection.manifest);
  const priorManifest = await readJson(priorManifestPath);
  if (priorManifest.selectedRecordIdsSha256 !== profile.priorSelection.selectedRecordIdsSha256) {
    throw new Error('The prior Landbook pilot selection no longer matches its approved hash.');
  }
  const priorIds = new Set(priorManifest.selectedRecords.map((item) => String(item.sourceRecordId)));
  const overlap = selectedRecords.filter((item) => priorIds.has(item.sourceRecordId));
  if (overlap.length) {
    throw new Error(`Landbook pages 6-10 overlap ${overlap.length} prior pilot records.`);
  }
  priorSelectionExclusion = {
    manifest: path.relative(root, priorManifestPath),
    selectedRecordIdsSha256: priorManifest.selectedRecordIdsSha256,
    selectedRecords: priorManifest.selectedRecords.length,
    overlap: 0,
  };
}

const manifest = {
  scope: profile.scope,
  generatedAt,
  listingPages,
  maximumWebsiteRecords,
  listingSnapshots: listingSnapshots.map(({ payload, reused, ...item }) => item),
  selectedRecords,
  selectedRecordIdsSha256: digest(`${selectedRecords.map((item) => item.sourceRecordId).join('\n')}\n`),
  laneCounts,
  ...(profile.expectedEnvelope ? { pageLaneCounts } : {}),
  ...(priorSelectionExclusion ? { priorSelectionExclusion } : {}),
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

if (process.argv.includes('--freeze-only')) {
  process.stdout.write(`${JSON.stringify({
    scope: manifest.scope,
    listingPages,
    maximumWebsiteRecords,
    laneCounts,
    pageLaneCounts,
    selectedRecordIdsSha256: manifest.selectedRecordIdsSha256,
    priorSelectionExclusion,
    manifest: path.relative(root, manifestPath),
    detailsFetched: 0,
  }, null, 2)}\n`);
  process.exit(0);
}

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
