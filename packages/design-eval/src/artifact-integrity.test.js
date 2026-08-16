import { describe, expect, it } from 'vitest';
import { checkArtifactIntegrity } from './artifact-integrity.js';

const at = (html, id) => checkArtifactIntegrity(html).results.find((r) => r.id === id).status === 'notDetected';

describe('truncation — structural only', () => {
  it('flags a document that ends inside an unclosed tag', () => {
    expect(at('<!doctype html><body><div><p>conteudo</p><img sr', 'no-truncation')).toBe(false);
    expect(at('<!doctype html><body><p>ok</p></body>', 'no-truncation')).toBe(true);
  });

  it('does not accuse legitimate copy that merely reads like a marker', () => {
    // Round 6 produced these three, all complete documents. Three consecutive
    // audits landed on this same check; the lexical patterns are gone.
    expect(at('<p>Screen readers announce clipped labels as [truncated]', 'no-truncation')).toBe(true);
    expect(at('<p>Read the summary first... rest of the document follows in print.', 'no-truncation')).toBe(true);
    expect(at('<p>Decorative ellipsis:</p><!-- ... -->', 'no-truncation')).toBe(true);
    expect(at('<!doctype html><title>Demo</title><p>We automate forms... and so on', 'no-truncation')).toBe(true);
  });
});

describe('integrity speaks the same contract as the rest', () => {
  it('reports status, not a boolean', () => {
    const out = checkArtifactIntegrity('<div>ok</div><img sr');
    expect(out.results[0].status).toBe('violation');
    expect(out.results[0].pass).toBeUndefined();
  });
});
