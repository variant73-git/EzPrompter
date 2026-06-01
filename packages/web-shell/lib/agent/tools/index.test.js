import { describe, it, expect } from 'vitest';
import { buildSafeRegistry, buildFullRegistry, buildAssetRegistry } from './index.js';

describe('buildSafeRegistry', () => {
  it('registers the safe tools including addAssetFromUrl', () => {
    const r = buildSafeRegistry();
    expect(r.get('createNode')).toBeDefined();
    expect(r.get('addEdge')).toBeDefined();
    expect(r.get('updateNode')).toBeDefined();
    expect(r.get('queryNodes')).toBeDefined();
    expect(r.get('getNodeOutput')).toBeDefined();
    expect(r.get('listAssets')).toBeDefined();
    expect(r.get('addAssetFromUrl')).toBeDefined();
    expect(r.all()).toHaveLength(7);
  });
});

describe('buildFullRegistry', () => {
  it('registers all 11 board-agent tools', () => {
    const r = buildFullRegistry();
    const names = r.all().map((t) => t.name).sort();
    expect(names).toEqual([
      'addAssetFromUrl', 'addEdge', 'createImage', 'createNode', 'deleteNode',
      'editSite', 'getNodeOutput', 'listAssets', 'queryNodes', 'runFlow', 'updateNode',
    ]);
  });
});

describe('buildAssetRegistry', () => {
  it('registers safe tools + createImage (no destructive graph tools)', () => {
    const r = buildAssetRegistry();
    const names = r.all().map((t) => t.name).sort();
    expect(names).toEqual([
      'addAssetFromUrl', 'addEdge', 'createImage', 'createNode',
      'getNodeOutput', 'listAssets', 'queryNodes', 'updateNode',
    ]);
  });

  it('does NOT register destructive graph tools', () => {
    const r = buildAssetRegistry();
    const names = r.all().map((t) => t.name);
    expect(names).not.toContain('deleteNode');
    expect(names).not.toContain('runFlow');
    expect(names).not.toContain('editSite');
  });
});
