#!/usr/bin/env node
// Emit evals/anti-slop/rubric.json from the live house-style switchboard, and
// print how much of the taste spine the cheap deterministic layer covers.
//
//   node evals/anti-slop/build-rubric.mjs          # write + report
//   node evals/anti-slop/build-rubric.mjs --check  # fail if the file is stale
//
// The JSON is a DERIVED artifact. Never edit it by hand — edit house-style.js and
// regenerate. --check exists so CI can catch a criterion change that never made
// it into the rubric.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRubric, rubricCoverage } from '../../lib/design/rubric.js';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'rubric.json');
const rubric = buildRubric();
const json = JSON.stringify(rubric, null, 2) + '\n';

if (process.argv.includes('--check')) {
  const current = existsSync(out) ? readFileSync(out, 'utf8') : '';
  if (current !== json) {
    console.error('rubric.json is STALE — house-style.js changed. Run: node evals/anti-slop/build-rubric.mjs');
    process.exit(1);
  }
  console.log('rubric.json is up to date.');
  process.exit(0);
}

mkdirSync(here, { recursive: true });
writeFileSync(out, json);

const cov = rubricCoverage();
const pct = (n) => `${(n * 100).toFixed(0)}%`;
console.log(`wrote ${out}`);
console.log(`  ${cov.total} checks — ${cov.deterministic} fully deterministic (${pct(cov.deterministicPct)}), ${cov.judge} need the vision judge`);
console.log(`  of those judged, ${cov.partial} ALSO get a cheap partial check (it samples the rule; it does not retire the judge)`);
console.log(`  verdict model: ${rubric.verdictModel} — no threshold, no weights (the criteria are build instructions, not a grade)`);
console.log(`  calibration: ${rubric.calibration.selector} in ${rubric.calibration.source}`);
console.log(`    standing order: ${rubric.calibration.standingOrder}`);
