import { describe, it, expect } from 'vitest';
import { buildSafeRegistry, buildFullRegistry } from './index.js';

describe('buildSafeRegistry', () => {
  it('registers the 6 Phase-1 safe tools', () => {
    const r = buildSafeRegistry();
    expect(r.get('createNode')).toBeDefined();
    expect(r.get('addEdge')).toBeDefined();
    expect(r.get('updateNode')).toBeDefined();
    expect(r.get('queryNodes')).toBeDefined();
    expect(r.get('getNodeOutput')).toBeDefined();
    expect(r.get('listAssets')).toBeDefined();
    expect(r.all()).toHaveLength(6);
  });
});

describe('buildFullRegistry', () => {
  it('registers all 9 Phase 2 tools', () => {
    const r = buildFullRegistry();
    const names = r.all().map((t) => t.name).sort();
    expect(names).toEqual([
      'addEdge', 'createNode', 'deleteNode', 'editSite',
      'getNodeOutput', 'listAssets', 'queryNodes', 'runFlow', 'updateNode',
    ]);
  });
});
