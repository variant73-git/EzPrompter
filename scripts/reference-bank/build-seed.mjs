import fs from 'node:fs/promises';
import path from 'node:path';
import {
  mergeReferenceAppearances,
  parseCodropsPayload,
  parsePafoliosPayload,
  parseSiteInspirePayload,
} from '../../packages/web-shell/lib/reference-bank-ingest.js';

const root = process.cwd();
const inputDir = path.join(root, '.firecrawl');
const outputPath = path.join(root, 'packages/web-shell/lib/reference-bank.seed.json');
const filenames = await fs.readdir(inputDir);

async function readPayload(filename) {
  return JSON.parse(await fs.readFile(path.join(inputDir, filename), 'utf8'));
}

const appearances = [];
for (const filename of filenames.sort()) {
  if (!filename.endsWith('.json')) continue;
  const payload = await readPayload(filename);
  if (filename.startsWith('codrops-webzibition')) {
    const page = filename.match(/page-(\d+)/)?.[1];
    const listingUrl = page
      ? `https://tympanus.net/codrops/webzibition/page/${page}/`
      : 'https://tympanus.net/codrops/webzibition/';
    appearances.push(...parseCodropsPayload(payload, listingUrl));
  } else if (filename.startsWith('pafolios')) {
    appearances.push(...parsePafoliosPayload(payload));
  } else if (filename.startsWith('siteinspire')) {
    const page = filename.match(/page-(\d+)/)?.[1];
    const listingUrl = page ? `https://www.siteinspire.com/websites/page/${page}` : 'https://www.siteinspire.com';
    appearances.push(...parseSiteInspirePayload(payload, listingUrl));
  }
}

const generatedAt = new Date().toISOString();
const references = mergeReferenceAppearances(appearances, generatedAt);
const sourceCounts = appearances.reduce((counts, item) => {
  counts[item.source.id] = (counts[item.source.id] || 0) + 1;
  return counts;
}, {});
const output = {
  generatedAt,
  stats: {
    appearances: appearances.length,
    references: references.length,
    duplicatesMerged: appearances.length - references.length,
    sources: sourceCounts,
  },
  references,
};

await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(output.stats)}\n`);
