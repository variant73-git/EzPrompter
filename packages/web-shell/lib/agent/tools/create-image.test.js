import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db.js', () => {
  const sql = vi.fn();
  sql._nextResult = null;
  sql.mockImplementation(() => Promise.resolve(sql._nextResult || []));
  sql._reset = () => { sql._nextResult = null; sql.mockClear(); };
  return { sql };
});

vi.mock('../../image-gen/gemini-imagen.js', () => ({
  generateGeminiImage: vi.fn(async () => ({
    base64: 'B64',
    mimeType: 'image/png',
    dataUrl: 'data:image/png;base64,B64',
    prompt: 'cat',
    model: 'imagen-3.0-fast-generate-001',
  })),
}));

vi.mock('../../image-gen/openai-image.js', () => ({
  generateOpenAIImage: vi.fn(async () => ({
    base64: 'B64',
    mimeType: 'image/png',
    dataUrl: 'data:image/png;base64,B64',
    prompt: 'cat',
    model: 'gpt-image-1',
  })),
}));

const { sql } = await import('../../db.js');
const { generateGeminiImage } = await import('../../image-gen/gemini-imagen.js');
const { generateOpenAIImage } = await import('../../image-gen/openai-image.js');

beforeEach(() => {
  sql._reset();
  vi.mocked(generateGeminiImage).mockClear();
  vi.mocked(generateGeminiImage).mockResolvedValue({
    base64: 'B64',
    mimeType: 'image/png',
    dataUrl: 'data:image/png;base64,B64',
    prompt: 'cat',
    model: 'imagen-3.0-fast-generate-001',
  });
  vi.mocked(generateOpenAIImage).mockClear();
  vi.mocked(generateOpenAIImage).mockResolvedValue({
    base64: 'B64',
    mimeType: 'image/png',
    dataUrl: 'data:image/png;base64,B64',
    prompt: 'cat',
    model: 'gpt-image-1',
  });
  process.env.GEMINI_API_KEY = 'gem';
  process.env.OPENAI_API_KEY = 'oai';
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
    expect(generateOpenAIImage).toHaveBeenCalled();
    expect(generateGeminiImage).not.toHaveBeenCalled();
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
    // 3 SQL calls now: asset insert, SELECT max(pos_x + width) for auto-place, node insert.
    let call = 0;
    sql.mockImplementation(() => {
      call++;
      if (call === 1) return Promise.resolve([{ id: 'asset-1' }]); // asset insert
      if (call === 2) return Promise.resolve([{ right_edge: -240, top_edge: 0 }]); // auto-place
      return Promise.resolve([{ id: 'node-1' }]); // node insert
    });
    const r = await createImageTool.execute(
      { prompt: 'cat', attachToBoard: true },
      { boardId: 'b1', userId: 42, conversationModel: 'gemini-2.5-flash' }
    );
    expect(r.assetId).toBe('asset-1');
    expect(r.nodeId).toBe('node-1');
  });

  it('returns image_gen_failed when adapter throws', async () => {
    vi.mocked(generateGeminiImage).mockRejectedValueOnce(new Error('boom'));
    const r = await createImageTool.execute(
      { prompt: 'cat' },
      { boardId: 'b1', userId: 42, conversationModel: 'gemini-2.5-flash' }
    );
    expect(r.error).toBe('image_gen_failed');
    expect(r.message).toBe('boom');
  });

  it('forces openai when baseImageAssetId provided + passes dataUrl through', async () => {
    let call = 0;
    sql.mockImplementation(() => {
      call++;
      if (call === 1) return Promise.resolve([{ meta: { dataUrl: 'data:image/png;base64,BASE' } }]); // SELECT base asset
      return Promise.resolve([{ id: 'asset-new' }]); // asset insert
    });
    await createImageTool.execute(
      { prompt: 'remix this', baseImageAssetId: 'asset-base', provider: 'gemini' }, // gemini req should be ignored
      { boardId: 'b1', userId: 42, conversationModel: 'gemini-2.5-flash' }
    );
    expect(generateOpenAIImage).toHaveBeenCalledWith(expect.objectContaining({
      baseImageDataUrl: 'data:image/png;base64,BASE',
    }));
    expect(generateGeminiImage).not.toHaveBeenCalled();
  });

  it('rejects baseImageAssetId that does not belong to the user', async () => {
    // Use mockImplementation directly — sql._reset() only clears history,
    // so a prior test's mockImplementation can leak otherwise.
    sql.mockImplementation(() => Promise.resolve([])); // SELECT returns 0 rows
    const r = await createImageTool.execute(
      { prompt: 'x', baseImageAssetId: 'asset-stranger' },
      { boardId: 'b1', userId: 42, conversationModel: 'gemini-2.5-flash' }
    );
    expect(r.error).toBe('invalid_args');
    expect(r.message).toMatch(/not found/);
  });

  it('rejects baseImageAssetId when asset has no dataUrl', async () => {
    sql.mockImplementation(() => Promise.resolve([{ meta: { provider: 'manual', model: 'unknown' } }])); // no dataUrl
    const r = await createImageTool.execute(
      { prompt: 'x', baseImageAssetId: 'asset-no-data' },
      { boardId: 'b1', userId: 42, conversationModel: 'gemini-2.5-flash' }
    );
    expect(r.error).toBe('invalid_args');
    expect(r.message).toMatch(/no dataUrl/);
  });
});
