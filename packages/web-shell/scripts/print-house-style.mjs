#!/usr/bin/env node
// Print Uncraft's house style (the taste spine) to stdout.
//
// THE POINT: any agent, in any project, on this machine, can get the CURRENT
// criteria with one command — instead of keeping a copy that silently rots.
// A copy is how the original 53-item list was lost (see
// docs/superpowers/specs/2026-08-12-anti-slop-lista-1-53-proveniencia.md).
//
//   node scripts/print-house-style.mjs              # full directive (guardrails + absorb + invent)
//   node scripts/print-house-style.mjs --guardrails # only the always-on rules
//   node scripts/print-house-style.mjs --absorb     # only the "a source was provided" block
//   node scripts/print-house-style.mjs --invent     # only the "no source, invent it" block
//   node scripts/print-house-style.mjs --list       # the switchboard: id, group, on/off, decision note
//   node scripts/print-house-style.mjs --json       # machine-readable criteria
//
// Runs from anywhere: paths resolve relative to this file, not to your cwd.

import {
  buildAbsorb,
  buildGuardrails,
  buildHouseStyle,
  buildInvent,
  listCriteria,
  CRITERIA,
} from '../lib/design/house-style.js';

const flag = process.argv.find((a) => a.startsWith('--')) || '';

switch (flag) {
  case '--guardrails':
    console.log(buildGuardrails());
    break;
  case '--absorb':
    console.log(buildAbsorb());
    break;
  case '--invent':
    console.log(buildInvent());
    break;
  case '--list': {
    const rows = listCriteria();
    const w = Math.max(...rows.map((r) => r.id.length));
    console.log(`${rows.length} criteria (${rows.filter((r) => r.on).length} on)\n`);
    for (const r of rows) {
      console.log(`${r.on ? '●' : '○'} ${r.id.padEnd(w)}  ${r.group}/${r.mode}${r.note ? `  — ${r.note}` : ''}`);
    }
    break;
  }
  case '--json':
    console.log(JSON.stringify(CRITERIA.filter((c) => c.on), null, 2));
    break;
  default:
    console.log(buildHouseStyle());
}
