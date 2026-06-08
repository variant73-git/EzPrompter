import { describe, it, expect } from 'vitest';
import { buildSafeRegistry, buildFullRegistry, buildAssetRegistry } from './index.js';

describe('buildSafeRegistry', () => {
  it('registers safe write tools + exploration tools', () => {
    const r = buildSafeRegistry();
    expect(r.get('createNode')).toBeDefined();
    expect(r.get('addEdge')).toBeDefined();
    expect(r.get('updateNode')).toBeDefined();
    expect(r.get('queryNodes')).toBeDefined();
    expect(r.get('getNodeOutput')).toBeDefined();
    expect(r.get('listAssets')).toBeDefined();
    expect(r.get('addAssetFromUrl')).toBeDefined();
    // Exploration tools — the canvas-side equivalents of ls / cat / grep.
    expect(r.get('viewNode')).toBeDefined();
    expect(r.get('listBoard')).toBeDefined();
    expect(r.get('findNearest')).toBeDefined();
    expect(r.get('getWorkflow')).toBeDefined();
  });
});

describe('buildFullRegistry', () => {
  it('registers safe + destructive + site-pipeline tools', () => {
    const r = buildFullRegistry();
    const names = r.all().map((t) => t.name).sort();
    expect(names).toEqual([
      'addAssetFromUrl', 'addEdge', 'applyDesign', 'captureUrl',
      'createImage', 'createNode', 'deleteNode', 'editSite',
      'extractDesign', 'findNearest', 'getNodeOutput', 'getWorkflow',
      'listAssets', 'listBoard', 'queryNodes', 'runFlow',
      'updateNode', 'viewNode',
    ]);
  });
});

describe('buildAssetRegistry', () => {
  it('registers safe tools + createImage (no destructive graph tools)', () => {
    const r = buildAssetRegistry();
    const names = r.all().map((t) => t.name).sort();
    expect(names).toEqual([
      'addAssetFromUrl', 'addEdge', 'createImage', 'createNode',
      'findNearest', 'getNodeOutput', 'getWorkflow', 'listAssets',
      'listBoard', 'queryNodes', 'updateNode', 'viewNode',
    ]);
  });

  it('does NOT register destructive graph tools', () => {
    const r = buildAssetRegistry();
    const names = r.all().map((t) => t.name);
    expect(names).not.toContain('deleteNode');
    expect(names).not.toContain('runFlow');
    expect(names).not.toContain('editSite');
    expect(names).not.toContain('captureUrl');
    expect(names).not.toContain('extractDesign');
    expect(names).not.toContain('applyDesign');
  });
});
