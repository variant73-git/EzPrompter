import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./design-md.js', () => ({ generateDesignMd: vi.fn(async () => ({ md: '# Design', truncated: false })) }));
vi.mock('./demarcelize.js', () => ({ extractContent: vi.fn(async () => '# Content') }));

const { runExtract } = await import('./extract.js');
const siteNode = { id: 's1', kind: 'site', html: '<html><body>hi</body></html>', meta: { name: 'Acme' } };

describe('runExtract — validation', () => {
  it('rejects an unknown `to`', async () => {
    const r = await runExtract({ to: 'banana', node: siteNode });
    expect(r.error).toBe('invalid_to');
  });
  it('rejects a site-only target on an asset node', async () => {
    const asset = { id: 'a1', kind: 'asset', meta: { dataUrl: 'data:image/png;base64,AAA' } };
    const r = await runExtract({ to: 'content', node: asset });
    expect(r.error).toBe('unsupported_combo');
  });
  it('rejects a site node with no html', async () => {
    const r = await runExtract({ to: 'content', node: { id: 's2', kind: 'site', html: null } });
    expect(r.error).toBe('no_source');
  });
});

describe('runExtract — design system (.md)', () => {
  it('returns a designmd node carrying design_md + html template', async () => {
    const r = await runExtract({ to: 'designmd', node: siteNode });
    expect(r.kind).toBe('designmd');
    expect(r.designMd).toBe('# Design');
    expect(r.html).toBe(siteNode.html);
    expect(r.meta.name).toMatch(/Acme/);
  });
});

describe('runExtract — content (.md)', () => {
  it('returns a designmd node whose design_md is the extracted content', async () => {
    const r = await runExtract({ to: 'content', node: siteNode });
    expect(r.kind).toBe('designmd');
    expect(r.designMd).toBe('# Content');
    expect(r.meta.name).toMatch(/content/i);
  });
});
