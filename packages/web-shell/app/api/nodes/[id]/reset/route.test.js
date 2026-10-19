// Reset devolve a IDENTIDADE da versão original (origem, pacote, versão do manifesto), não só o HTML: o canvas
// ficava com o pacote da cópia na memória até recarregar — editor errado e a trava das telas presa (Astra r2 #3).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../lib/auth.js', () => ({
  requireUser: vi.fn(async () => ({ user: { id: 42 } })),
}));

const sqlMock = vi.fn();
sqlMock.mockImplementation((template) => {
  sqlMock._templates.push(Array.isArray(template) ? template.join(' ') : String(template));
  return Promise.resolve(sqlMock._results.shift() || []);
});
vi.mock('../../../../../lib/db.js', () => ({ db: async () => sqlMock }));

const { POST } = await import('./route.js');

beforeEach(() => { sqlMock.mockClear(); sqlMock._results = []; sqlMock._templates = []; });

const chamar = () => POST(new Request('http://test/api/nodes/n1/reset', { method: 'POST' }), { params: Promise.resolve({ id: 'n1' }) });

describe('POST /api/nodes/[id]/reset', () => {
  it('devolve a origem, o pacote e a versão do manifesto da versão original', async () => {
    const bundle = '22222222-2222-5222-8222-222222222222';
    sqlMock._results = [
      [{ id: 'n1' }],
      [{ id: 's1', html: '<html>', design_md: null, screenshot_url: null, source: 'native-bundle', native_bundle_id: bundle, motion_manifest_version: 2 }],
      [],
    ];
    const body = await (await chamar()).json();
    expect(body).toMatchObject({ ok: true, snapshot_id: 's1', html: '<html>', source: 'native-bundle', native_bundle_id: bundle, motion_manifest_version: 2 });
    expect(sqlMock._templates[1]).toMatch(/source, native_bundle_id, motion_manifest_version/);
  });

  it('versão original sem pacote volta sem pacote (nada de herdar o da cópia)', async () => {
    sqlMock._results = [
      [{ id: 'n1' }],
      [{ id: 's0', html: '<p>', design_md: null, screenshot_url: null, source: 'capture', native_bundle_id: null, motion_manifest_version: null }],
      [],
    ];
    const body = await (await chamar()).json();
    expect(body).toMatchObject({ source: 'capture', native_bundle_id: null, motion_manifest_version: null });
  });
});
