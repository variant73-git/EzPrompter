import { describe, expect, it } from 'vitest';
import {
  CREDIT_PRESETS,
  DEV_ENGINES,
  devToolsAllowed,
  resolveEditEngineOverride,
} from './dev-toggles.js';

describe('dev toggles (pre-launch developer widget)', () => {
  it('is fail-closed in production without the server env', () => {
    expect(devToolsAllowed({ NODE_ENV: 'production' })).toBe(false);
    expect(devToolsAllowed({ NODE_ENV: 'production', UNCRAFT_DEV_TOOLS: '1' })).toBe(true);
    expect(devToolsAllowed({ NODE_ENV: 'development' })).toBe(true);
    expect(devToolsAllowed({ NODE_ENV: 'test' })).toBe(true);
  });

  it('exposes the three credit presets the widget promises', () => {
    expect(CREDIT_PRESETS).toEqual({ infinite: 10_000_000, starter: 500, zero: 0 });
    expect(DEV_ENGINES).toEqual(['native', 'iter9']);
  });

  it('engine override never forces a re-clone of a node that already matches', () => {
    // Nominal engine beats "already ready" server-side, so the widget must
    // withhold the engine when the node is already of that lineage —
    // otherwise every Edit re-runs (and re-charges) the clone.
    const nativeNode = { current_snapshot_source: 'native-bundle', meta: {} };
    const iter9Node = { current_snapshot_source: 'reconstruct', meta: { reconstructionEngine: 'iter9' } };
    const legacyNode = { current_snapshot_source: 'capture', meta: {} };

    expect(resolveEditEngineOverride(nativeNode, 'native')).toBe(null);
    expect(resolveEditEngineOverride(iter9Node, 'iter9')).toBe(null);
    expect(resolveEditEngineOverride(legacyNode, 'native')).toBe('native');
    expect(resolveEditEngineOverride(legacyNode, 'iter9')).toBe('iter9');
    expect(resolveEditEngineOverride(nativeNode, 'iter9')).toBe('iter9');
    expect(resolveEditEngineOverride(iter9Node, 'native')).toBe('native');
    expect(resolveEditEngineOverride(legacyNode, null)).toBe(null);
  });
});
