import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A guarda de rede e' a mesma do produtor de clone nativo (achado P0 do Sol em
// 2026-08-10): buscar um endereco interno e devolver o CORPO ao usuario nao e'
// so buscar uma URL — e' exfiltracao. Esta ferramenta nao tinha a guarda, e a
// colagem no canvas passou a ser um segundo jeito de dispara-la.
vi.mock('../../native-clone/capture-bundle.js', () => ({
  hostEhPublico: vi.fn(async (host) => !/^(127\.|10\.|169\.254\.|192\.168\.|localhost$)/.test(host)),
}));

vi.mock('../../db.js', () => {
  const sql = vi.fn();
  sql._reset = () => sql.mockReset();
  return { sql };
});

const { sql } = await import('../../db.js');
const { addAssetFromUrlTool } = await import('./add-asset-from-url.js');

// Minimal PNG (transparent 1x1) — base64-decoded into a Buffer for the
// arrayBuffer mock so the byte-size + content-type pipeline runs end-to-end.
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const PNG_BYTES = Buffer.from(PNG_BASE64, 'base64');

function mockFetchPng({ contentType = 'image/png', contentLength = String(PNG_BYTES.byteLength) } = {}) {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    headers: {
      get(name) {
        const n = name.toLowerCase();
        if (n === 'content-type') return contentType;
        if (n === 'content-length') return contentLength;
        return null;
      },
    },
    arrayBuffer: async () => PNG_BYTES.buffer.slice(PNG_BYTES.byteOffset, PNG_BYTES.byteOffset + PNG_BYTES.byteLength),
  }));
}

beforeEach(() => {
  sql._reset();
});

afterEach(() => {
  delete globalThis.fetch;
});

describe('addAssetFromUrl tool', () => {
  it('rejects non-http urls', async () => {
    const r = await addAssetFromUrlTool.execute(
      { url: 'ftp://example.com/cat.png' },
      { boardId: 'b1', userId: 42 },
    );
    expect(r.error).toBe('invalid_args');
  });

  it('rejects when board not owned', async () => {
    sql.mockResolvedValueOnce([]); // SELECT board → empty
    const r = await addAssetFromUrlTool.execute(
      { url: 'https://i.pinimg.com/x.jpg' },
      { boardId: 'b1', userId: 42 },
    );
    expect(r.error).toBe('forbidden');
  });

  it('ingests + inserts asset and node by default', async () => {
    mockFetchPng();
    sql
      .mockResolvedValueOnce([{ id: 'b1' }])              // SELECT board
      .mockResolvedValueOnce([{ id: 'asset-1' }])         // INSERT asset
      // New placeStackDown(): SELECT pos_x, pos_y, width, height of every
      // node on the board. One existing node 512x512 at (200, 100).
      .mockResolvedValueOnce([{ pos_x: 200, pos_y: 100, width: 512, height: 512 }]) // placeStackDown: nodes
      .mockResolvedValueOnce([])                          // placeStackDown: edges (section detection)
      .mockResolvedValueOnce([{ id: 'node-1' }]);         // INSERT node

    const r = await addAssetFromUrlTool.execute(
      { url: 'https://i.pinimg.com/736x/a/b/c.png' },
      { boardId: 'b1', userId: 42 },
    );
    expect(r.ingested).toBe(true);
    expect(r.assetId).toBe('asset-1');
    expect(r.nodeId).toBe('node-1');
    expect(r.name).toBe('c.png');
    expect(r.mimeType).toBe('image/png');
    // Same column as the existing node (pos_x=200), stacked under it
    // (pos_y = 100 + 512 + 200 gap).
    expect(r.posX).toBe(200);
    expect(r.posY).toBe(812);
  });

  it('skips node creation when attachToBoard:false', async () => {
    mockFetchPng();
    sql
      .mockResolvedValueOnce([{ id: 'b1' }])
      .mockResolvedValueOnce([{ id: 'asset-1' }]);
    const r = await addAssetFromUrlTool.execute(
      { url: 'https://example.com/x.png', attachToBoard: false },
      { boardId: 'b1', userId: 42 },
    );
    expect(r.assetId).toBe('asset-1');
    expect(r.nodeId).toBeNull();
    expect(sql.mock.calls.length).toBe(2);
  });

  it('rejects non-image content-type', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      headers: { get: (n) => n.toLowerCase() === 'content-type' ? 'text/html' : null },
      arrayBuffer: async () => PNG_BYTES.buffer,
    }));
    sql.mockResolvedValueOnce([{ id: 'b1' }]);
    const r = await addAssetFromUrlTool.execute(
      { url: 'https://example.com/page' },
      { boardId: 'b1', userId: 42 },
    );
    expect(r.error).toBe('not_image');
  });

  it('rejects HTTP errors', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 403, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) }));
    sql.mockResolvedValueOnce([{ id: 'b1' }]);
    const r = await addAssetFromUrlTool.execute(
      { url: 'https://example.com/protected.jpg' },
      { boardId: 'b1', userId: 42 },
    );
    expect(r.error).toBe('fetch_failed');
    expect(r.message).toMatch(/403/);
  });

  it('rejects oversized images via content-length header', async () => {
    mockFetchPng({ contentLength: String(15 * 1024 * 1024) });
    sql.mockResolvedValueOnce([{ id: 'b1' }]);
    const r = await addAssetFromUrlTool.execute(
      { url: 'https://example.com/big.png' },
      { boardId: 'b1', userId: 42 },
    );
    expect(r.error).toBe('too_large');
  });
});


describe('addAssetFromUrl — a guarda de rede', () => {
  // Achado do Sol: checar so o primeiro endereco nao fecha nada. Um host
  // PUBLICO pode responder 302 para um endereco interno, e o `redirect:
  // 'follow'` seguia sem perguntar. A guarda tem que valer em cada salto.
  it('refuses a public host that redirects into a private address', async () => {
    const saltos = [];
    globalThis.fetch = vi.fn(async (u) => {
      saltos.push(String(u));
      if (saltos.length === 1) {
        return {
          ok: false, status: 302,
          headers: { get: (n) => (n.toLowerCase() === 'location' ? 'http://169.254.169.254/latest/meta-data/' : null) },
          arrayBuffer: async () => new ArrayBuffer(0),
        };
      }
      throw new Error('nao pode ter seguido');
    });
    sql.mockResolvedValueOnce([{ id: 'board-1' }]);
    const out = await addAssetFromUrlTool.execute(
      { url: 'https://exemplo.com/redireciona' },
      { userId: 1, boardId: 'board-1' },
    );
    expect(out.error).toBe('blocked_host');
    expect(saltos).toHaveLength(1);
  });

  it('refuses a host that resolves to a private address', async () => {
    mockFetchPng();
    sql.mockResolvedValueOnce([{ id: 'board-1' }]);
    const out = await addAssetFromUrlTool.execute(
      { url: 'http://169.254.169.254/latest/meta-data/iam/' },
      { userId: 1, boardId: 'board-1' },
    );
    expect(out.error).toBe('blocked_host');
    // e nao pode nem ter chegado a buscar
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('still ingests a public image', async () => {
    mockFetchPng();
    sql.mockResolvedValueOnce([{ id: 'board-1' }]);
    sql.mockResolvedValueOnce([{ id: 'asset-1' }]);
    const out = await addAssetFromUrlTool.execute(
      { url: 'https://exemplo.com/foto.png', attachToBoard: false },
      { userId: 1, boardId: 'board-1' },
    );
    expect(out.error).toBeUndefined();
    expect(globalThis.fetch).toHaveBeenCalled();
  });
});
