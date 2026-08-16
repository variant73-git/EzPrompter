/**
 * rubric.js — the anti-slop eval rubric, DERIVED from the house-style switchboard.
 *
 * Pendência 5 of docs/superpowers/handoffs/
 * 2026-07-22-skills-audit-housestyle-switchboard-handoff.md: "esboçar o rubric do
 * eval espelhando o switchboard (cada critério → 1 check pontuado)".
 *
 * WHY DERIVED AND NOT WRITTEN BY HAND
 *   A hand-written rubric is a second copy of the taste spine, and second copies
 *   drift. Worse, they drift SILENTLY — the guardrail changes, the rubric keeps
 *   scoring the old rule, and the eval reports green while the product regresses.
 *   Deriving from `CRITERIA` guarantees the rubric can never MISS or invent a
 *   criterion. It does NOT guarantee that a deterministic check still means what
 *   its criterion says — that is a semantic claim no derivation can make, which
 *   is why coverage is declared per criterion in slop-verdicts.js and audited there.
 *
 *   This is also why it does NOT invent criteria. The 2026-07-06 eval handoff is
 *   explicit: the moat is the user's codified criteria, not a generic checklist.
 *   Every check here traces to a criterion the user adjudicated.
 *
 * ROUTING
 *   The cheap layer (slop-observe.js + slop-verdicts.js) runs the page in a real
 *   browser and reports VIOLATIONS it can see. It never certifies: three audit
 *   rounds established that no criterion is fully covered statically, so every
 *   criterion still reaches the vision JUDGE. The cheap pass buys early, free
 *   evidence — not a way to skip the judge.
 *
 * NOT A GRADER
 *   There is no threshold and no weight, by decision. The criteria are build
 *   instructions — objective orders about what to do and what not to do — so the
 *   only honest question is "was this instruction followed?". A violation is a
 *   thing to fix, not points deducted. Where a violation has a mechanical fix
 *   (swap Inter for another grotesque) the verdict says so; where the rule is
 *   absolute (JetBrains) it does not offer one. An explicit user request beats
 *   both, because an instruction the user overrode was never a violation.
 */

import { CRITERIA } from './house-style.js';
import { COVERAGE, coveredCriterionIds, partiallyCoveredCriterionIds } from '@uncraft/design-eval';

const SOURCE = 'packages/web-shell/lib/design/house-style.js';

/**
 * Pull the decision provenance out of a criterion note.
 * Keeps COMPOSITE numbers whole: "decision 38/39: ..." → "38/39", not "38".
 * Dropping half of a composite is the same class of loss this file documents.
 */
function decisionOf(note) {
  const m = /(?:decisions?|items?)\s+(\d+(?:\s*\/\s*\d+)*)/i.exec(String(note || ''));
  return m ? m[1].replace(/\s+/g, '') : null;
}

/**
 * Turn a criterion's prompt fragment into a question for the vision judge.
 * The criterion text IS the standard; the judge is asked whether the rendered
 * screenshot honours it, one criterion at a time (per-check scores localise
 * regressions — a single holistic grade does not).
 */
function judgeQuestion(criterion) {
  const rule = String(criterion.text).replace(/^\s*-\s*/, '').replace(/\s+/g, ' ').trim();
  return `Looking ONLY at the rendered screenshot, does the design honour this rule? RULE: ${rule} Answer pass or fail, then one sentence naming the specific element that decided it. If the rule does not apply to this page, answer n/a.`;
}

/**
 * Build the rubric.
 * @param opts.off  criterion ids to exclude from this render
 * @returns { version, source, generatedFrom, thresholds, blockedOn, checks[] }
 */
export function buildRubric(opts = {}) {
  const off = new Set(opts.off || []);
  const fullyCovered = new Set(coveredCriterionIds());
  const partlyCovered = new Set(partiallyCoveredCriterionIds());

  const checks = CRITERIA.filter((c) => c.on && !off.has(c.id)).map((c) => {
    const isFull = fullyCovered.has(c.id);
    const isPartial = partlyCovered.has(c.id);
    return {
      criterion: c.id,
      group: c.group,
      mode: c.mode,
      decision: decisionOf(c.note),
      note: c.note || null,
      // Only FULL deterministic coverage retires the judge. A partial check runs
      // as well, but the criterion still gets asked — otherwise the unchecked
      // half of the rule would go unmeasured while the report reads "covered".
      method: isFull ? 'deterministic' : 'judge',
      alsoDeterministic: isPartial || undefined,
      deterministicBlindSpot: isPartial ? COVERAGE[c.id]?.blind || null : undefined,
      question: isFull ? null : judgeQuestion(c),
      criterionText: isFull ? null : c.text,
    };
  });

  return {
    version: 1,
    source: SOURCE,
    generatedFrom: 'CRITERIA (switchboard) — regenerate whenever a criterion changes',
    // NO threshold, NO weights, and that is a decision, not a gap (Adilson, 2026-08-12):
    // "a ideia desse eval são critérios para construir algo e os critérios são ordens
    // objetivas do que fazer ou não". The criteria are BUILD INSTRUCTIONS. The eval
    // asks whether each instruction was followed and reports what was not — it does
    // not grade a page, so there is nothing to weigh and no bar to clear.
    verdictModel: 'compliance',
    calibration: {
      source: 'the reference bank',
      selector: "sites the user marked 'keep' during review",
      why: "5 hand-picked gold references cannot represent good design — they are 5 examples out of millions, each tied to one client, one palette, one case. The bank already holds the user's own verdicts, each with a 1-5 rating and six dimension scores, and it grows with every review.",
      standingOrder: "a site marked 'keep' should become a gold-standard reference automatically — not yet wired",
    },
    checks,
  };
}

/** How much of the taste spine the cheap layer covers, measured not guessed. */
export function rubricCoverage(opts = {}) {
  const checks = buildRubric(opts).checks;
  const total = checks.length;
  const det = checks.filter((c) => c.method === 'deterministic').length;
  const partial = checks.filter((c) => c.alsoDeterministic).length;
  return {
    total,
    deterministic: det,
    partial,               // cheap check runs, judge still asked
    judge: total - det,
    deterministicPct: total ? det / total : 0,
  };
}
