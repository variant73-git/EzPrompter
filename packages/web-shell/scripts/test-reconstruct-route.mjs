/**
 * Drive captureSnapshot directly (bypassing the HTTP layer) to verify the
 * detect-and-route logic kicks in for farmminerals.com/promo and the iter-9
 * reconstruction pipeline produces a non-broken HTML output.
 */
import { captureSnapshot } from '../lib/snapshot.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'spike-out', 'reconstruct-test');
await mkdir(OUT, { recursive: true });

const URL = process.argv[2] || 'https://www.farmminerals.com/promo';
console.log(`Testing captureSnapshot('${URL}')`);
console.time('snapshot');
const r = await captureSnapshot(URL, { onProgress: (s) => console.log(`  [progress] ${s}`) });
console.timeEnd('snapshot');
console.log(`title: ${r.title}`);
console.log(`html len: ${r.html.length}`);
console.log(`screenshot len: ${r.screenshotDataUrl?.length}`);
console.log(`stats:`, r.stats || '(static capture)');
await writeFile(join(OUT, 'output.html'), r.html, 'utf8');
console.log(`Wrote ${join(OUT, 'output.html')}`);
