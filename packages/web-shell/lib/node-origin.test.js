import { describe, it, expect } from 'vitest';
import { nodeOrigin, ORIGIN_COLORS, originColor } from './node-origin.js';

describe('nodeOrigin', () => {
  it('captured URL site → url (blue)', () => {
    expect(nodeOrigin({ kind: 'site', origin_url: 'https://x.com' })).toBe('url');
  });
  it('blank composition site → blank (blue)', () => {
    expect(nodeOrigin({ kind: 'site', meta: { source: 'blank' } })).toBe('blank');
  });
  it('an HTML upload (site, no url, no source) → html (orange)', () => {
    expect(nodeOrigin({ kind: 'site', meta: {} })).toBe('html');
  });
  it('a site CLONED from an image reads BLUE (url), never orange', () => {
    const clone = { kind: 'site', meta: { source: 'extract', extractTo: 'clone' } };
    expect(nodeOrigin(clone)).toBe('url');
    expect(originColor(clone)).toBe(ORIGIN_COLORS.url);
    expect(originColor(clone)).not.toBe(ORIGIN_COLORS.html);
  });
  it('design.md / image / prompt map to their own origins', () => {
    expect(nodeOrigin({ kind: 'designmd' })).toBe('md');
    expect(nodeOrigin({ kind: 'asset' })).toBe('screenshot');
    expect(nodeOrigin({ kind: 'prompt' })).toBe('prompt');
  });
  it('blue identities share the same colour code', () => {
    expect(ORIGIN_COLORS.url).toBe(ORIGIN_COLORS.blank);
  });
  it('design.md uses the approved warm ochre', () => {
    expect(ORIGIN_COLORS.md).toBe('#EEA665');
  });
});
