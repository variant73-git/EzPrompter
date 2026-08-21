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

describe('repair preconditions mirror the reconstruction route', () => {
  // The route answers 400 `no_origin_url`, and only site nodes reconstruct.
  // Offering "Repair clone" outside those bounds promises a guaranteed error.
  it('does not offer repair without an origin URL', () => {
    const orphan = { ...inconsistent, origin_url: null };
    expect(decideEditAction({ node: orphan })).toMatchObject({ billable: false, integrityError: false });
  });

  it('does not offer repair for template or chunk nodes', () => {
    for (const kind of ['template', 'chunk', 'designmd']) {
      expect(decideEditAction({ node: { ...inconsistent, kind } }))
        .toMatchObject({ billable: false, integrityError: false });
    }
  });

  it('still offers repair for a site node with an origin URL', () => {
    expect(decideEditAction({ node: inconsistent })).toMatchObject({ integrityError: true });
  });
});
