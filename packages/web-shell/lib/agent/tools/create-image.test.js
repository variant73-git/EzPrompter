import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db.js', () => {
  const sql = vi.fn();
  sql._nextResult = null;
  sql.mockImplementation(() => Promise.resolve(sql._nextResult || []));
  sql._reset = () => { sql._nextResult = null; sql.mockClear(); };
  return { sql };
});

const { sql } = await import('../../db.js');

const fetchMock = vi.fn();
globalThis.fetch = fetchMock;

beforeEach(() => {
  sql._reset();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => ({
    ok: true,
    json: async () => ({
      provider: 'gemini',
      base64: 'B64',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,B64',
      prompt: 'cat',
      model: 'imagen-3.0-fast-generate-001',
    }),
  }));
});

const { createImageTool } = await import('./create-image.js');

describe('createImageTool', () => {
  it('classification is needs_choice', () => {
    expect(createImageTool.classification).toBe('needs_choice');
  });

  it('choices() returns 2 options when Claude conversation + auto provider', () => {
    const cs = createImageTool.choices({ prompt: 'x', provider: 'auto' }, { conversationModel: 'claude-sonnet-4-6' });
    expect(cs).toHaveLength(2);
    expect(cs.map((c) => c.id).sort()).toEqual(['gemini', 'openai']);
  });

  it('choices() returns 1 option when GPT model + auto', () => {
    const cs = createImageTool.choices({ prompt: 'x', provider: 'auto' }, { conversationModel: 'gpt-5.5' });
    expect(cs).toHaveLength(1);
  });

  it('choices() returns 1 option when Gemini model + auto', () => {
    const cs = createImageTool.choices({ prompt: 'x', provider: 'auto' }, { conversationModel: 'gemini-2.5-flash' });
    expect(cs).toHaveLength(1);
  });

  it('choices() returns 1 option when provider explicit', () => {
    const cs = createImageTool.choices({ prompt: 'x', provider: 'gemini' }, { conversationModel: 'claude-sonnet-4-6' });
    expect(cs).toHaveLength(1);
  });

  it('returns error when prompt missing', async () => {
    const r = await createImageTool.execute({}, { boardId: 'b1', userId: 42 });
    expect(r.error).toBe('invalid_args');
  });

  it('uses choice provider when ctx.choice is set', async () => {
    sql._nextResult = [{ id: 'asset-1' }];
    await createImageTool.execute(
      { prompt: 'cat', provider: 'auto' },
      { boardId: 'b1', userId: 42, conversationModel: 'claude-sonnet-4-6', choice: 'openai' }
    );
    expect(fetchMock).toHaveBeenCalled();
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.provider).toBe('openai');
  });

  it('persists asset and returns assetId', async () => {
    sql._nextResult = [{ id: 'asset-1' }];
    const r = await createImageTool.execute(
      { prompt: 'cat' },
      { boardId: 'b1', userId: 42, conversationModel: 'gemini-2.5-flash' }
    );
    expect(r.assetId).toBe('asset-1');
    expect(r.dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('attachToBoard creates a node and returns nodeId', async () => {
    let call = 0;
    sql.mockImplementation(() => {
      call++;
      if (call === 1) return Promise.resolve([{ id: 'asset-1' }]); // asset insert
      return Promise.resolve([{ id: 'node-1' }]); // node insert
    });
    const r = await createImageTool.execute(
      { prompt: 'cat', attachToBoard: true },
      { boardId: 'b1', userId: 42, conversationModel: 'gemini-2.5-flash' }
    );
    expect(r.assetId).toBe('asset-1');
    expect(r.nodeId).toBe('node-1');
  });

  it('returns image_gen_failed when route returns !ok', async () => {
    fetchMock.mockImplementation(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: 'boom' }),
    }));
    const r = await createImageTool.execute(
      { prompt: 'cat' },
      { boardId: 'b1', userId: 42, conversationModel: 'gemini-2.5-flash' }
    );
    expect(r.error).toBe('image_gen_failed');
    expect(r.message).toBe('boom');
  });
});
