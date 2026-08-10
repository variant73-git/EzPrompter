import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseLandbookDetailPayload } from '../../packages/web-shell/lib/reference-bank-landbook.js';
import { mergeReferenceAppearances } from '../../packages/web-shell/lib/reference-bank-ingest.js';
import { canonicalizeReferenceUrl } from '../../packages/web-shell/lib/reference-bank-normalize.js';

const root = process.cwd();
const slice = process.argv.includes('--slice=pages-6-10') ? 'pages-6-10' : 'pilot';
const profiles = {
  pilot: {
    scope: 'bounded-landbook-thumbnail-link-pilot',
    directory: 'reference-landbook-pilot',
    outputName: 'reference-bank.landbook',
    approvedPages: [1, 2],
    approvedMaximum: 100,
    expectedSelectedRecords: null,
    expectedLaneCounts: null,
    taxonomy: { minimalPilot: 'thumbnail-link-v1' },
  },
  'pages-6-10': {
    scope: 'bounded-landbook-pages-6-10',
    directory: 'reference-landbook-pages-6-10',
    outputName: 'reference-bank.landbook-pages-6-10',
    approvedPages: [6, 7, 8, 9, 10],
    approvedMaximum: 100,
    expectedSelectedRecords: 77,
    expectedLaneCounts: {
      websiteCards: 77,
      uniqueWebsiteCards: 77,
      selectedWebsiteCards: 77,
      templates: 23,
      advertisements: 4,
      rejections: 0,
    },
    priorSelectionHash: '0a0b85c7a5552a0bf527f5466b268c20081e118cc1766c566745ad050d790f4e',
    taxonomy: { boundedSlice: 'pages-6-10' },
  },
};
const profile = profiles[slice];
const collectionDir = path.join(root, '.firecrawl', profile.directory);
const manifestPath = path.join(collectionDir, 'collection-manifest.json');
const resultPath = path.join(collectionDir, 'collection-result.json');
const outputSeedPath = path.join(collectionDir, `${profile.outputName}.seed.json`);
const outputReportPath = path.join(collectionDir, `${profile.outputName}.report.json`);
const { approvedPages, approvedMaximum } = profile;

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
if (manifest.scope !== profile.scope) {
  throw new Error(`Unexpected Landbook ${slice} scope: ${manifest.scope}`);
}
if (JSON.stringify(manifest.listingPages) !== JSON.stringify(approvedPages)) {
  throw new Error(`Landbook ${slice} must remain limited to its approved public listing pages.`);
}
if (manifest.maximumWebsiteRecords !== approvedMaximum || manifest.selectedRecords.length > approvedMaximum) {
  throw new Error(`Landbook ${slice} must remain capped at ${approvedMaximum} website records.`);
}
if (
  manifest.constraints?.detailDepth !== 1
  || manifest.constraints?.destinationSiteFetches !== 0
  || manifest.constraints?.databaseTarget !== 'isolated-only'
  || manifest.constraints?.templatesImportable !== false
  || manifest.constraints?.advertisementsImportable !== false
  || manifest.constraints?.generationTriggered !== false
) throw new Error(`Landbook ${slice} constraints no longer match the approved scope.`);
if (
  profile.expectedSelectedRecords != null
  && manifest.selectedRecords.length !== profile.expectedSelectedRecords
) throw new Error(`Landbook ${slice} must contain exactly ${profile.expectedSelectedRecords} selected records.`);
if (
  profile.expectedLaneCounts
  && JSON.stringify(manifest.laneCounts) !== JSON.stringify(profile.expectedLaneCounts)
) throw new Error(`Landbook ${slice} lane counts no longer match the approved envelope.`);
if (
  profile.priorSelectionHash
  && (
    manifest.priorSelectionExclusion?.selectedRecordIdsSha256 !== profile.priorSelectionHash
    || manifest.priorSelectionExclusion?.overlap !== 0
  )
) throw new Error(`Landbook ${slice} prior-selection exclusion is invalid.`);
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
      ...profile.taxonomy,
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
    ...profile.taxonomy,
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
if (!appearances.length) throw new Error(`Landbook ${slice} produced no consultable thumbnail-and-link references.`);

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
    ...(slice === 'pilot' ? { landbookPilot: stats } : { landbookPages6To10: stats }),
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
    ...(manifest.priorSelectionExclusion
      ? { priorSelectionExclusion: manifest.priorSelectionExclusion }
      : {}),
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
