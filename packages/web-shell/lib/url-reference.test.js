import { describe, expect, it } from 'vitest';
import {
  isLiveUrlReference,
  liveReferenceMeta,
  remapLiveReferenceSelection,
  shouldMountLiveReference,
} from './url-reference.js';

describe('URL reference nodes', () => {
  it('recognizes a live URL reference without snapshot HTML', () => {
    expect(isLiveUrlReference({
      kind: 'site',
      origin_url: 'https://example.com',
      current_html: null,
      meta: { referenceMode: 'live' },
    })).toBe(true);
  });

  it('stops treating the node as a live reference after a clone lands', () => {
    expect(isLiveUrlReference({
      kind: 'site',
      origin_url: 'https://example.com',
      current_html: '<html></html>',
      meta: { referenceMode: 'live' },
    })).toBe(false);
  });

  it('builds honest lightweight metadata from the hostname', () => {
    expect(liveReferenceMeta('https://www.example.com/work')).toEqual({
      name: 'example.com',
      source: 'url-reference',
      referenceMode: 'live',
    });
  });

  it('mounts remote runtime only for the active onscreen reference', () => {
    const reference = {
      kind: 'site', origin_url: 'https://example.com', current_html: null,
      meta: { referenceMode: 'live' },
    };
    expect(shouldMountLiveReference(reference, { active: false, offscreen: false })).toBe(false);
    expect(shouldMountLiveReference(reference, { active: true, offscreen: true })).toBe(false);
    expect(shouldMountLiveReference(reference, { active: true, offscreen: false, placing: true })).toBe(false);
    expect(shouldMountLiveReference(reference, { active: true, offscreen: false })).toBe(true);
  });

  it('keeps a newly persisted reference active without stealing later user focus', () => {
    expect(remapLiveReferenceSelection('temp-1', 'temp-1', 'node-1')).toBe('node-1');
    expect(remapLiveReferenceSelection('another-node', 'temp-1', 'node-1')).toBe('another-node');
  });
});
