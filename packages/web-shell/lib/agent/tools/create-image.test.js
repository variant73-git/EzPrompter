import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db.js', () => {
  const sql = vi.fn();
  sql._nextResult = null;
  sql.mockImplementation(() => Promise.resolve(sql._nextResult || []));
  sql._reset = () => { sql._nextResult = null; sql.mockClear(); };
  return { sql };
});

// Billing (Task 14): the tool wraps the generation step in runBilledOperation —
// mock the ledger so hold/settle don't consume the scripted sql sequences.
vi.mock('../../billing/ledger.js', () => ({
  holdCredits: vi.fn(async () => ({ held: true, balance: 500 })),
  refundHold: vi.fn(async () => ({ balance: 500 })),
  settleOperation: vi.fn(async ({ chargeCredits }) => ({ balanceAfter: 500 - chargeCredits })),
  grantCredits: vi.fn(async () => ({ balanceAfter: 500 })),
  getBalance: vi.fn(async () => 500),
  recentLedger: vi.fn(async () => []),
}));

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

  it('passes styleReferenceDataUrls through when refs resolved', async () => {
    let call = 0;
    sql.mockImplementation(() => {
      call++;
      // Calls in order:
      // 1) SELECT base asset
      // 2) SELECT ref assets (returns 2 rows)
      // 3) INSERT placeholder asset
      if (call === 1) return Promise.resolve([{ meta: { dataUrl: 'data:image/png;base64,BASE' } }]);
      if (call === 2) return Promise.resolve([
        { id: 'ref-1', meta: { dataUrl: 'data:image/png;base64,REF1' } },
        { id: 'ref-2', meta: { dataUrl: 'data:image/png;base64,REF2' } },
      ]);
      return Promise.resolve([{ id: 'asset-new' }]);
    });
    await createImageTool.execute(
      {
        prompt: 'warmer palette',
        baseImageAssetId: 'asset-base',
        styleReferenceAssetIds: ['ref-1', 'ref-2'],
      },
      { boardId: 'b1', userId: 42, conversationModel: 'gemini-2.5-flash' }
    );
    expect(generateOpenAIImage).toHaveBeenCalledWith(expect.objectContaining({
      baseImageDataUrl: 'data:image/png;base64,BASE',
      styleReferenceDataUrls: ['data:image/png;base64,REF1', 'data:image/png;base64,REF2'],
    }));
    // The agent's prompt now passes through verbatim — we removed the
    // hardcoded preservation template because gpt-image-1 was reading
    // "PRESERVE composition" as "preserve the subject" and filling the
    // canvas, dropping any blank space the original had.
    const callArgs = generateOpenAIImage.mock.calls[0][0];
    expect(callArgs.prompt).toBe('warmer palette');
  });

  it('passes the agent prompt verbatim in edit mode without refs', async () => {
    sql.mockImplementation(() => Promise.resolve([{ meta: { dataUrl: 'data:image/png;base64,BASE' } }]));
    await createImageTool.execute(
      { prompt: 'remove the background', baseImageAssetId: 'asset-base' },
      { boardId: 'b1', userId: 42, conversationModel: 'gemini-2.5-flash' }
    );
    const callArgs = generateOpenAIImage.mock.calls[0][0];
    expect(callArgs.prompt).toBe('remove the background');
    // styleReferenceDataUrls should be null/undefined when no refs.
    expect(callArgs.styleReferenceDataUrls).toBeFalsy();
  });

  it('falls back to a minimal safety prompt when edit-mode prompt is empty', async () => {
    sql.mockImplementation(() => Promise.resolve([{ meta: { dataUrl: 'data:image/png;base64,BASE' } }]));
    await createImageTool.execute(
      { prompt: '', baseImageAssetId: 'asset-base' },
      { boardId: 'b1', userId: 42, conversationModel: 'gemini-2.5-flash' }
    );
    const callArgs = generateOpenAIImage.mock.calls[0][0];
    // Non-empty default so gpt-image-1 has something to act on.
    expect(callArgs.prompt.length).toBeGreaterThan(0);
    expect(callArgs.prompt).toMatch(/preserve/i);
  });

  it('does NOT impose template in pure text-to-image (no base)', async () => {
    sql._nextResult = [{ id: 'asset-1' }];
    await createImageTool.execute(
      { prompt: 'a sleeping cat in space' },
      { boardId: 'b1', userId: 42, conversationModel: 'gemini-2.5-flash' }
    );
    const callArgs = generateGeminiImage.mock.calls[0][0];
    expect(callArgs.prompt).toBe('a sleeping cat in space');
    expect(callArgs.prompt).not.toMatch(/PRESERVE/);
  });

  it('replaceAssetId path skips INSERT and returns the same assetId + linked nodeId', async () => {
    let call = 0;
    sql.mockImplementation(() => {
      call++;
      // 1) SELECT replaceAssetId asset (verify ownership + existence)
      if (call === 1) return Promise.resolve([{ id: 'asset-existing', meta: { prompt: 'old', mode: 'edit', baseImageAssetId: 'asset-base' } }]);
      // 2) SELECT linked node by board + meta->>'assetId'
      if (call === 2) return Promise.resolve([{ id: 'node-existing' }]);
      // 3) SELECT base asset (for baseImageAssetId resolution)
      if (call === 3) return Promise.resolve([{ meta: { dataUrl: 'data:image/png;base64,BASE' } }]);
      // 4+ UPDATE assets/nodes — no shape inspected
      return Promise.resolve([]);
    });
    const r = await createImageTool.execute(
      { prompt: 'tweak the lighting', baseImageAssetId: 'asset-base', replaceAssetId: 'asset-existing' },
      { boardId: 'b1', userId: 42, conversationModel: 'gemini-2.5-flash' }
    );
    expect(r.assetId).toBe('asset-existing');
    expect(r.nodeId).toBe('node-existing');
    expect(generateOpenAIImage).toHaveBeenCalled();
  });

  it('replaceAssetId rejects when asset not owned by user', async () => {
    sql.mockImplementation(() => Promise.resolve([])); // SELECT returns 0 rows
    const r = await createImageTool.execute(
      { prompt: 'x', replaceAssetId: 'asset-stranger' },
      { boardId: 'b1', userId: 42, conversationModel: 'gemini-2.5-flash' }
    );
    expect(r.error).toBe('invalid_args');
    expect(r.message).toMatch(/replaceAssetId not found/);
  });

  it('dedupes styleReferenceAssetIds and filters baseImageAssetId out of refs', async () => {
    let call = 0;
    sql.mockImplementation(() => {
      call++;
      if (call === 1) return Promise.resolve([{ meta: { dataUrl: 'data:image/png;base64,BASE' } }]);
      // call 2 = SELECT refs (only ref-1 — duplicate + base-equal were filtered before SQL)
      if (call === 2) return Promise.resolve([
        { id: 'ref-1', meta: { dataUrl: 'data:image/png;base64,REF1' } },
      ]);
      return Promise.resolve([{ id: 'asset-new' }]);
    });
    await createImageTool.execute(
      {
        prompt: '',
        baseImageAssetId: 'asset-base',
        // 'asset-base' should be filtered (same as base); 'ref-1' deduped
        styleReferenceAssetIds: ['ref-1', 'ref-1', 'asset-base'],
      },
      { boardId: 'b1', userId: 42, conversationModel: 'gemini-2.5-flash' }
    );
    const callArgs = generateOpenAIImage.mock.calls[0][0];
    expect(callArgs.styleReferenceDataUrls).toEqual(['data:image/png;base64,REF1']);
  });
});
