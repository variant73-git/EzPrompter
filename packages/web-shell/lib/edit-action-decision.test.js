import { describe, expect, it } from 'vitest';
import { decideEditAction } from './edit-action-decision.js';

const BUNDLE_ID = '33333333-3333-4333-8333-333333333333';
const base = { id: 'site-1', kind: 'site', origin_url: 'https://example.com' };

const ready = {
  ...base,
  current_snapshot_source: 'native-edit',
  current_native_bundle_id: BUNDLE_ID,
  current_motion_manifest_version: 2,
  meta: { animatedDetected: true },
};
const legacy = { ...base, current_snapshot_source: 'capture', meta: {} };
const inconsistent = {
  ...base,
  current_snapshot_source: 'native-edit',
  current_native_bundle_id: 'not-a-uuid',
  current_motion_manifest_version: 2,
  meta: {},
};

describe('decideEditAction — one decision for every Edit entry point', () => {
  it('a ready node opens free: no charge, no upsell, no repair', () => {
    expect(decideEditAction({ node: ready })).toMatchObject({ billable: false, integrityError: false });
  });

  it('a legacy node is billable (auto-upgrade)', () => {
    expect(decideEditAction({ node: legacy })).toMatchObject({ billable: true, integrityError: false });
  });

  it('an inconsistent node is repair — never billable, so never an upsell', () => {
    expect(decideEditAction({ node: inconsistent })).toMatchObject({ billable: false, integrityError: true });
  });

  it('a nominal engine bills even on a ready node — the label must say so', () => {
    // The server runs and charges any nominal engine regardless of readiness;
    // an inspector reading "Edit" while the click costs credits is dishonest.
    expect(decideEditAction({ node: ready, engineOverride: 'iter9' }))
      .toMatchObject({ billable: true, integrityError: false });
  });

  it('a nominal engine on an inconsistent node is the deliberate repair path (bills, no integrity block)', () => {
    expect(decideEditAction({ node: inconsistent, engineOverride: 'native' }))
      .toMatchObject({ billable: true, integrityError: false });
  });
});
