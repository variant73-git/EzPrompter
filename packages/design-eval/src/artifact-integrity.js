/**
 * artifact-integrity.js — is the generated document INTACT?
 *
 * Deliberately source-level, and deliberately separate from taste. A truncated
 * response or a placeholder <img> is a broken artifact, not a design opinion, and
 * it must never be folded into a taste verdict.
 *
 * This is the one job that legitimately stays on the source string: truncation is
 * a property of what the model EMITTED. Load it in a browser and the parser
 * silently repairs it — the evidence is destroyed by the act of rendering. Taste
 * checks went the other way, to the DOM, for exactly the mirrored reason
 * (slop-observe.js).
 *
 * `div-balance` was removed rather than fixed: a browser repairs unbalanced tags,
 * and counting `<div>` in the source produced false failures on `content:"<div"`
 * and on tag-like text inside <script>. A check that cannot be made reliable is
 * worse than no check, because its failures look like findings.
 *
 * SCOPE, stated honestly: this detects ONE thing — an EOF inside an unclosed tag.
 * It does not prove a document is "intact". A model that stopped at a tag boundary
 * looks complete here, and that is the deliberate trade: see the note on the check.
 */

export const INTEGRITY_CHECKS = [
  {
    id: 'no-truncation',
    // STRUCTURAL ONLY: the document ends in the middle of a tag.
    //
    // The lexical markers are gone. Three consecutive audit rounds landed on this
    // one check, and round 6 produced complete documents that it accused —
    // `<p>Screen readers announce clipped labels as [truncated]`,
    // `<p>Read the summary first... rest of the document follows in print.`,
    // `<p>Decorative ellipsis:</p><!-- ... -->`. Optional end tags make all three
    // valid and finished. No phrase distinguishes "the model stopped writing" from
    // "the page is talking about truncation", so the phrases were dropped.
    //
    // WHAT THIS COSTS, stated plainly: a model that wrote "... rest of the code"
    // and then closed its tags is no longer detected. That is a miss. The check
    // only ever asserts `violation`, and a wrong accusation on real copy costs
    // more than a missed marker — a false positive teaches people to ignore it.
    run: (html) => {
      const body = String(html).replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ');
      const trimmed = body.trimEnd();
      const lastOpen = trimmed.lastIndexOf('<');
      const lastClose = trimmed.lastIndexOf('>');
      return lastOpen > lastClose
        ? { pass: false, detail: 'the document ends inside an unclosed tag' }
        : { pass: true };
    },
  },
];

/** @returns { results, failed, passed } — integrity is reported, never scored as taste. */
export function checkArtifactIntegrity(html) {
  const results = INTEGRITY_CHECKS.map((check) => {
    const out = check.run(html) || {};
    const pass = out.pass === undefined ? null : out.pass;
    // Same vocabulary as the taste verdicts: no boolean anywhere in the public shape.
    return {
      id: check.id,
      status: pass === false ? 'violation' : pass === true ? 'notDetected' : 'unjudged',
      detail: out.detail || '',
    };
  });
  return {
    results,
    failed: results.filter((r) => r.status === 'violation').map((r) => r.id),
    passed: results.filter((r) => r.status === 'notDetected').map((r) => r.id),
  };
}
