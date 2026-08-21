import { describe, expect, it } from 'vitest';
import { decideEditAction } from './edit-action-decision.js';

const BUNDLE_ID = '33333333-3333-4333-8333-333333333333';
const inconsistent = {
  id: 'site-1', kind: 'site', origin_url: 'https://example.com',
  current_snapshot_source: 'native-edit',
  current_native_bundle_id: 'not-a-uuid',
  current_motion_manifest_version: 2,
  meta: {},
};
const ready = {
  id: 'site-2', kind: 'site', origin_url: 'https://example.com',
  current_snapshot_source: 'native-bundle',
  current_native_bundle_id: BUNDLE_ID,
  current_motion_manifest_version: 2,
  meta: {},
};

describe('deliberate repair (Sol final round #3)', () => {
  it('a repair press is a nominal native request: it BILLS, so the surface must disclose cost', () => {
    // The button said "Repair" and did nothing but show a toast. A repair
    // rebuilds through the native engine — a real, billed operation.
    const decision = decideEditAction({ node: inconsistent, engineOverride: 'native' });
    expect(decision).toMatchObject({ billable: true, integrityError: false });
  });

  it('without the deliberate repair, an inconsistent node still never bills on its own', () => {
    expect(decideEditAction({ node: inconsistent })).toMatchObject({ billable: false, integrityError: true });
  });

  it('a ready node is untouched by the repair path', () => {
    expect(decideEditAction({ node: ready })).toMatchObject({ billable: false, integrityError: false });
  });
});

describe('preconditions mirror the reconstruction route (kind x origin_url x engine)', () => {
  // The route's ONE structural precondition is the origin URL (400
  // `no_origin_url`); it does NOT filter by kind. The decision mirrors that
  // instead of inventing a stricter rule — the first attempt failed in both
  // directions at once (Sol final round).
  const orphan = { ...inconsistent, origin_url: null };

  it('an origin-less node offers nothing — not even under a nominal engine', () => {
    expect(decideEditAction({ node: orphan })).toMatchObject({ billable: false, integrityError: false });
    for (const engine of ['native', 'iter9']) {
      expect(decideEditAction({ node: orphan, engineOverride: engine }))
        .toMatchObject({ billable: false, integrityError: false });
    }
  });

  it('a nominal engine on a non-site node with an origin URL still bills — the server accepts it', () => {
    for (const kind of ['template', 'chunk']) {
      expect(decideEditAction({ node: { ...ready, kind }, engineOverride: 'iter9' }))
        .toMatchObject({ billable: true, integrityError: false });
    }
  });

  it('the automatic upgrade stays site-only (reconstructionReason owns that rule)', () => {
    const legacyTemplate = {
      id: 'tpl-1', kind: 'template', origin_url: 'https://example.com',
      current_snapshot_source: 'capture', meta: {},
    };
    expect(decideEditAction({ node: legacyTemplate })).toMatchObject({ billable: false });
  });

  it('a site node with an origin URL is still repairable', () => {
    expect(decideEditAction({ node: inconsistent })).toMatchObject({ integrityError: true });
  });
});
