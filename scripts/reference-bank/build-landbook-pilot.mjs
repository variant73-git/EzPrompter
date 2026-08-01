import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseLandbookDetailPayload } from '../../packages/web-shell/lib/reference-bank-landbook.js';
import { mergeReferenceAppearances } from '../../packages/web-shell/lib/reference-bank-ingest.js';
import { canonicalizeReferenceUrl } from '../../packages/web-shell/lib/reference-bank-normalize.js';

const root = process.cwd();
const pilotDir = path.join(root, '.firecrawl', 'reference-landbook-pilot');
const manifestPath = path.join(pilotDir, 'collection-manifest.json');
const resultPath = path.join(pilotDir, 'collection-result.json');
const outputSeedPath = path.join(pilotDir, 'reference-bank.landbook.seed.json');
const outputReportPath = path.join(pilotDir, 'reference-bank.landbook.report.json');
const approvedPages = [1, 2];
const approvedMaximum = 100;

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function readJson(filename) {
  return JSON.parse(await fs.readFile(filename, 'utf8'));
}

function isHttpUrl(value) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
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
        sourceRecordId: item.source.recordId,
        targetUrl: item.url,
      })).sort((a, b) => a.sourceRecordId.localeCompare(b.sourceRecordId)),
    }))
    .sort((a, b) => a.canonicalKey.localeCompare(b.canonicalKey));
}

const [manifestText, resultText] = await Promise.all([
  fs.readFile(manifestPath, 'utf8'),
  fs.readFile(resultPath, 'utf8'),
]);
const manifest = JSON.parse(manifestText);
const result = JSON.parse(resultText);
if (manifest.scope !== 'bounded-landbook-thumbnail-link-pilot') {
  throw new Error(`Unexpected Landbook pilot scope: ${manifest.scope}`);
}
if (JSON.stringify(manifest.listingPages) !== JSON.stringify(approvedPages)) {
  throw new Error('Landbook pilot must remain limited to public listing pages 1 and 2.');
}
if (manifest.maximumWebsiteRecords !== approvedMaximum || manifest.selectedRecords.length > approvedMaximum) {
  throw new Error(`Landbook pilot must remain capped at ${approvedMaximum} website records.`);
}
if (
  manifest.constraints?.detailDepth !== 1
  || manifest.constraints?.destinationSiteFetches !== 0
  || manifest.constraints?.databaseTarget !== 'isolated-only'
  || manifest.constraints?.templatesImportable !== false
  || manifest.constraints?.advertisementsImportable !== false
  || manifest.constraints?.generationTriggered !== false
) throw new Error('Landbook pilot constraints no longer match the approved minimal scope.');
if (result.scope !== manifest.scope || result.manifestSha256 !== digest(manifestText)) {
  throw new Error('Landbook collection result does not match the frozen manifest.');
}
const selectedIdsHash = digest(`${manifest.selectedRecords.map((item) => item.sourceRecordId).join('\n')}\n`);
if (selectedIdsHash !== manifest.selectedRecordIdsSha256) {
  throw new Error('Landbook selected record IDs no longer match the frozen manifest hash.');
}

for (const snapshot of manifest.listingSnapshots) {
  const raw = await fs.readFile(path.join(root, snapshot.filename), 'utf8');
  if (digest(raw) !== snapshot.sha256) {
    throw new Error(`Landbook listing snapshot changed after manifest freeze: ${snapshot.filename}`);
  }
}

const detailByRecordId = new Map(result.detailSnapshots.map((item) => [String(item.sourceRecordId), item]));
if (detailByRecordId.size !== manifest.selectedRecords.length) {
  throw new Error('Landbook collection result must contain exactly one detail snapshot per selected record.');
}

const appearances = [];
const rejections = [];
for (const selected of manifest.selectedRecords) {
  const snapshot = detailByRecordId.get(String(selected.sourceRecordId));
  if (!snapshot || snapshot.detailUrl !== selected.detailUrl) {
    rejections.push({ sourceRecordId: selected.sourceRecordId, reason: 'missing_detail_snapshot' });
    continue;
  }
  const filename = path.join(root, snapshot.filename);
  const raw = await fs.readFile(filename, 'utf8');
  if (digest(raw) !== snapshot.sha256) {
    throw new Error(`Landbook detail snapshot changed after collection: ${snapshot.filename}`);
  }
  const payload = JSON.parse(raw);
  const fallback = {
    sourceRecordId: selected.sourceRecordId,
    listingUrl: selected.listingUrl,
    sourceDetailUrl: selected.detailUrl,
    title: selected.title,
    thumbnailUrl: selected.listingThumbnailUrl,
    categories: ['Website'],
    tags: [],
    sourceTaxonomy: {
      lane: 'website',
      listingPage: selected.listingPage,
      minimalPilot: 'thumbnail-link-v1',
    },
  };
  const [parsed] = parseLandbookDetailPayload(payload, fallback);
  if (!parsed) {
    rejections.push({ sourceRecordId: selected.sourceRecordId, reason: 'detail_parse_failed' });
    continue;
  }
  if (!canonicalizeReferenceUrl(parsed.url)) {
    rejections.push({ sourceRecordId: selected.sourceRecordId, reason: 'invalid_target_url' });
    continue;
  }
  if (!isHttpUrl(parsed.thumbnailUrl)) {
    rejections.push({ sourceRecordId: selected.sourceRecordId, reason: 'missing_thumbnail_url' });
    continue;
  }
  const taxonomy = {
    lane: 'website',
    listingPage: selected.listingPage,
    minimalPilot: 'thumbnail-link-v1',
  };
  appearances.push({
    ...parsed,
    description: 'Featured in the Landbook website collection.',
    categories: ['Website'],
    tags: [],
    publishedAt: null,
    sourceTaxonomy: taxonomy,
    source: {
      ...parsed.source,
      taxonomy,
    },
  });
}
if (!appearances.length) throw new Error('Landbook pilot produced no consultable thumbnail-and-link references.');

const references = mergeReferenceAppearances(appearances, manifest.generatedAt);
const duplicates = duplicateGroups(appearances);
const stats = {
  selectedWebsiteRecords: manifest.selectedRecords.length,
  acceptedAppearances: appearances.length,
  rejectedRecords: rejections.length,
  canonicalReferences: references.length,
  duplicatesMerged: appearances.length - references.length,
  templatesExcluded: manifest.laneCounts.templates,
  advertisementsExcluded: manifest.laneCounts.advertisements,
};
const seed = {
  generatedAt: manifest.generatedAt,
  stats: {
    proof: {
      scope: manifest.scope,
      listingPages: manifest.listingPages,
      maximumWebsiteRecords: manifest.maximumWebsiteRecords,
      requiredFields: ['thumbnailUrl', 'url'],
    },
    appearances: appearances.length,
    references: references.length,
    duplicatesMerged: appearances.length - references.length,
    sources: { landbook: appearances.length },
    landbookPilot: stats,
  },
  references,
};
const seedText = `${JSON.stringify(seed, null, 2)}\n`;
const seedSha256 = digest(seedText);
const report = {
  generatedAt: manifest.generatedAt,
  scope: manifest.scope,
  databaseTarget: 'isolated-only',
  generationTriggered: false,
  destinationSiteFetches: 0,
  importedFields: ['title', 'thumbnailUrl', 'url', 'Landbook provenance'],
  selection: {
    listingPages: manifest.listingPages,
    maximumWebsiteRecords: manifest.maximumWebsiteRecords,
    selectedRecordIdsSha256: manifest.selectedRecordIdsSha256,
  },
  laneCounts: manifest.laneCounts,
  stats,
  rejectedByReason: Object.fromEntries([...new Set(rejections.map((item) => item.reason))].sort().map((reason) => [
    reason,
    rejections.filter((item) => item.reason === reason).length,
  ])),
  rejections,
  canonicalizationSamples: appearances.slice(0, 5).map((item) => ({
    sourceRecordId: item.source.recordId,
    input: item.url,
    output: canonicalizeReferenceUrl(item.url)?.canonicalUrl || null,
  })),
  duplicateGroups: duplicates,
  queryContract: {
    catalogFields: ['id', 'title', 'url', 'thumbnailUrl', 'sourceIds'],
    sourceFilter: 'landbook',
    creationHandoffField: 'url',
  },
  outputSeed: path.relative(root, outputSeedPath),
  outputSeedSha256: seedSha256,
};
const reportText = `${JSON.stringify(report, null, 2)}\n`;

await Promise.all([
  fs.writeFile(outputSeedPath, seedText),
  fs.writeFile(outputReportPath, reportText),
]);
process.stdout.write(`${JSON.stringify({
  stats,
  outputSeedSha256: seedSha256,
  outputReportSha256: digest(reportText),
  outputSeedPath: path.relative(root, outputSeedPath),
  outputReportPath: path.relative(root, outputReportPath),
}, null, 2)}\n`);
