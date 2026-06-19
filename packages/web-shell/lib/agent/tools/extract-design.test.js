import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db.js', () => {
  const sql = vi.fn();
  return { sql };
});
vi.mock('../../design-md.js', () => ({
  generateDesignMd: vi.fn(),
}));

const { sql } = await import('../../db.js');
const { generateDesignMd } = await import('../../design-md.js');
const { extractDesignTool } = await import('./extract-design.js');

const SRC_ROW = {
  id: 'site-1',
  kind: 'site',
  meta: { name: 'farm' },
  current_snapshot_id: 'snap-src',
  html: '<html><body><h1>Farm</h1></body></html>',
};

function mockHappyPathSql() {
  sql.mockResolvedValueOnce([SRC_ROW]);                       // SELECT source node
  sql.mockResolvedValueOnce([]);                              // placeStackDown (empty board)
  sql.mockResolvedValueOnce([{ id: 'node-design' }]);         // INSERT designmd node
  sql.mockResolvedValueOnce([{ id: 'snap-design' }]);         // INSERT snapshot
  sql.mockResolvedValueOnce([]);                              // UPDATE current_snapshot_id
  sql.mockResolvedValueOnce([]);                              // INSERT edge
}

describe('extractDesign tool', () => {
  beforeEach(() => {
    sql.mockReset();
    generateDesignMd.mockReset();
  });

  it('generates a real DESIGN.md and stores BOTH design_md and html in the snapshot', async () => {
    generateDesignMd.mockResolvedValueOnce({
      md: '# Design System\n\n## Overview\nDark, editorial.',
      truncated: false,
      inputChars: SRC_ROW.html.length,
    });
    mockHappyPathSql();

    const result = await extractDesignTool.execute(
      { siteNodeId: 'site-1' },
      { boardId: 'board-1', userId: 42 },
    );

    expect(result.extracted).toBe(true);
    expect(result.designNodeId).toBe('node-design');
    expect(result.warning).toBeUndefined();
    expect(generateDesignMd).toHaveBeenCalledWith({ html: SRC_ROW.html });

    // 4th sql call is the snapshot INSERT — interpolated values are the
    // tagged-template args after the strings array: [nodeId, html, designMd].
    const snapInsertArgs = sql.mock.calls[3].slice(1);
    expect(snapInsertArgs[0]).toBe('node-design');
    expect(snapInsertArgs[1]).toBe(SRC_ROW.html);
    expect(snapInsertArgs[2]).toMatch(/^# Design System/);
  });

  it('surfaces truncation as a warning in the result and flags node meta', async () => {
    generateDesignMd.mockResolvedValueOnce({
      md: '# Design System\n\n## Overview\nHuge page.',
      truncated: true,
      inputChars: 999_999,
    });
    mockHappyPathSql();

    const result = await extractDesignTool.execute(
      { siteNodeId: 'site-1' },
      { boardId: 'board-1', userId: 42 },
    );

    expect(result.extracted).toBe(true);
    expect(result.warning).toBe('source_truncated');

    // 3rd sql call is the node INSERT — meta JSON carries the flag.
    const nodeInsertArgs = sql.mock.calls[2].slice(1);
    const metaArg = nodeInsertArgs.find((a) => typeof a === 'string' && a.includes('extractTruncated'));
    expect(metaArg).toBeTruthy();
    expect(JSON.parse(metaArg).extractTruncated).toBe(true);
  });

  it('fails clean (no DB writes) when DESIGN.md generation fails', async () => {
    generateDesignMd.mockRejectedValueOnce(new Error('model returned no usable markdown'));
    sql.mockResolvedValueOnce([SRC_ROW]); // SELECT source node only

    const result = await extractDesignTool.execute(
      { siteNodeId: 'site-1' },
      { boardId: 'board-1', userId: 42 },
    );

    expect(result.error).toBe('extract_failed');
    expect(result.message).toMatch(/no usable markdown/);
    // Only the ownership SELECT ran — nothing was inserted.
    expect(sql.mock.calls.length).toBe(1);
  });

  it('rejects non-site nodes', async () => {
    sql.mockResolvedValueOnce([{ ...SRC_ROW, kind: 'asset' }]);
    const result = await extractDesignTool.execute(
      { siteNodeId: 'site-1' },
      { boardId: 'board-1', userId: 42 },
    );
    expect(result.error).toBe('invalid_args');
    expect(generateDesignMd).not.toHaveBeenCalled();
  });

  it('rejects sites without a snapshot', async () => {
    sql.mockResolvedValueOnce([{ ...SRC_ROW, current_snapshot_id: null, html: null }]);
    const result = await extractDesignTool.execute(
      { siteNodeId: 'site-1' },
      { boardId: 'board-1', userId: 42 },
    );
    expect(result.error).toBe('no_snapshot');
    expect(generateDesignMd).not.toHaveBeenCalled();
  });

  it('returns invalid_args when siteNodeId missing', async () => {
    const result = await extractDesignTool.execute({}, { boardId: 'b1', userId: 42 });
    expect(result.error).toBe('invalid_args');
  });
});
