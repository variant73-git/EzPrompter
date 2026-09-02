import { describe, expect, it, vi } from 'vitest';
import { NODE_UPLOAD_QUOTA_BYTES, UPLOAD_MAX_BYTES, sniffImageType, storeNodeUpload } from './native-uploads.js';

const NODE_ID = '11111111-1111-4111-8111-111111111111';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function makeStore({ existing = false } = {}) {
  return {
    head: vi.fn(async () => (existing ? { byteLength: PNG.length } : null)),
    putImmutable: vi.fn(async () => ({})),
    read: vi.fn(),
  };
}

function makeSql(reserveRows = [[], [{ bytes_used: PNG.length }]]) {
  const calls = [];
  const sql = vi.fn((strings, ...values) => {
    calls.push({ text: Array.isArray(strings) ? strings.join('?') : String(strings), values });
    return Promise.resolve(reserveRows.shift() || []);
  });
  sql.calls = calls;
  return sql;
}

describe('sniffImageType', () => {
  it('recognises raster by magic bytes, not by client claim', () => {
    expect(sniffImageType(PNG)).toMatchObject({ ext: 'png', mime: 'image/png' });
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0]))).toMatchObject({ ext: 'jpg' });
    expect(sniffImageType(new Uint8Array([1, 2, 3, 4]))).toBeNull();
    // SVG is never a raster upload (it carries script).
    expect(sniffImageType(new TextEncoder().encode('<svg></svg>'))).toBeNull();
  });
});

describe('storeNodeUpload', () => {
  it('sniffs, reserves quota atomically, stores, and returns the hashed path', async () => {
    const store = makeStore();
    const sql = makeSql();
    const res = await storeNodeUpload({ store, sql, nodeId: NODE_ID, bytes: PNG });
    expect(res.path).toMatch(/^\.\/_uploads\/[0-9a-f]{32}\.png$/);
    // quota reserve is a conditional UPDATE gated on bytes_used + n <= cap
    const reserve = sql.calls.find((c) => /native_node_upload_quota/.test(c.text) && /<=/.test(c.text));
    expect(reserve).toBeTruthy();
    expect(store.putImmutable).toHaveBeenCalledOnce();
  });

  it('rejects a non-raster payload before any quota or store write', async () => {
    const store = makeStore();
    const sql = makeSql();
    const res = await storeNodeUpload({ store, sql, nodeId: NODE_ID, bytes: new Uint8Array([1, 2, 3, 4]) });
    expect(res.error).toBe('unsupported_image');
    expect(sql).not.toHaveBeenCalled();
    expect(store.putImmutable).not.toHaveBeenCalled();
  });

  it('rejects an oversized payload', async () => {
    const store = makeStore();
    const big = new Uint8Array(UPLOAD_MAX_BYTES + 1);
    big.set(PNG.slice(0, 8));
    const res = await storeNodeUpload({ store, sql: makeSql(), nodeId: NODE_ID, bytes: big });
    expect(res.error).toBe('too_large');
  });

  it('quota exhausted (conditional UPDATE affects no row) -> quota_exceeded, nothing stored', async () => {
    const store = makeStore();
    const sql = makeSql([[]]); // reserve returns no row
    const res = await storeNodeUpload({ store, sql, nodeId: NODE_ID, bytes: PNG });
    expect(res.error).toBe('quota_exceeded');
    expect(store.putImmutable).not.toHaveBeenCalled();
  });

  it('an identical re-upload (same content already stored) does NOT double-count quota', async () => {
    const store = makeStore({ existing: true });
    const sql = makeSql();
    const res = await storeNodeUpload({ store, sql, nodeId: NODE_ID, bytes: PNG });
    expect(res.path).toMatch(/\.png$/);
    expect(sql).not.toHaveBeenCalled(); // no quota reserve
    expect(store.putImmutable).not.toHaveBeenCalled(); // already present
  });

  it('a failed store write releases the reserved quota', async () => {
    const store = makeStore();
    store.putImmutable = vi.fn(async () => { throw new Error('store down'); });
    const sql = makeSql([[], [{ bytes_used: PNG.length }], []]); // insert, reserve, then release
    const res = await storeNodeUpload({ store, sql, nodeId: NODE_ID, bytes: PNG });
    expect(res.error).toBe('store_failed');
    const release = sql.calls.find((c) => /bytes_used = GREATEST/.test(c.text) || /bytes_used - /.test(c.text));
    expect(release).toBeTruthy();
  });

  it('the per-node quota cap is 64MB', () => {
    expect(NODE_UPLOAD_QUOTA_BYTES).toBe(64 * 1024 * 1024);
  });
});
