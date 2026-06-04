import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getOrCreateActiveThread,
  appendMessage,
  loadMessages,
  archiveActiveThread,
  startAgentRun,
  updateAgentRunStatus,
  finishAgentRun,
} from './chat-persistence.js';

// Mock the sql tagged template
vi.mock('./db.js', () => {
  const sqlCalls = [];
  const defaultImpl = (strings, ...values) => {
    sqlCalls.push({ query: strings.join('?'), values });
    return Promise.resolve(sql._nextResult || []);
  };
  const sql = vi.fn(defaultImpl);
  sql._nextResult = null;
  sql._reset = () => {
    sqlCalls.length = 0;
    sql._nextResult = null;
    sql.mockReset();
    sql.mockImplementation(defaultImpl);
  };
  sql._calls = sqlCalls;
  return { sql, db: async () => sql };
});

const { sql } = await import('./db.js');

beforeEach(() => sql._reset());

describe('getOrCreateActiveThread', () => {
  it('returns existing active board-scope thread when one exists', async () => {
    sql._nextResult = [{ id: 'thread-1', board_id: 'b1', scope: 'board', status: 'active' }];
    const t = await getOrCreateActiveThread({ boardId: 'b1', userId: 42, scope: 'board' });
    expect(t.id).toBe('thread-1');
    expect(sql).toHaveBeenCalled();
  });

  it('creates a new thread when none exists', async () => {
    let n = 0;
    sql.mockImplementation(() => {
      n++;
      return Promise.resolve(n === 1 ? [] : [{ id: 'thread-new', board_id: 'b1', scope: 'board' }]);
    });
    const t = await getOrCreateActiveThread({ boardId: 'b1', userId: 42, scope: 'board' });
    expect(t.id).toBe('thread-new');
    expect(sql).toHaveBeenCalledTimes(2);
  });
});

describe('appendMessage', () => {
  it('inserts a user message with content', async () => {
    sql._nextResult = [{ id: 'msg-1', thread_id: 't1', role: 'user', content: 'hi' }];
    const m = await appendMessage({ threadId: 't1', role: 'user', content: 'hi' });
    expect(m.id).toBe('msg-1');
  });

  it('inserts an assistant message with tool_calls JSONB', async () => {
    sql._nextResult = [{ id: 'msg-2', thread_id: 't1', role: 'assistant', tool_calls: [{ name: 'createNode' }] }];
    const m = await appendMessage({
      threadId: 't1',
      role: 'assistant',
      content: 'doing it',
      toolCalls: [{ name: 'createNode' }],
      model: 'claude-sonnet-4-6',
      agentRunId: 'run-1',
    });
    expect(m.id).toBe('msg-2');
  });
});

describe('loadMessages', () => {
  it('returns messages ordered by created_at ascending', async () => {
    sql._nextResult = [
      { id: 'm2', role: 'assistant', created_at: '2026-01-01T00:00:01Z' },
      { id: 'm1', role: 'user', created_at: '2026-01-01T00:00:00Z' },
    ];
    const msgs = await loadMessages({ threadId: 't1', limit: 50 });
    // loadMessages queries DESC then reverses → ascending order
    expect(msgs).toHaveLength(2);
    expect(msgs[0].id).toBe('m1');
  });
});

describe('archiveActiveThread', () => {
  it('marks active thread of given board+scope as archived', async () => {
    sql._nextResult = [{ id: 't1', status: 'archived' }];
    const r = await archiveActiveThread({ boardId: 'b1', scope: 'board' });
    expect(r?.status).toBe('archived');
  });
});

describe('agent_runs helpers', () => {
  it('startAgentRun inserts a row with status=running and returns it', async () => {
    sql._nextResult = [{ id: 'run-1', thread_id: 't1', status: 'running', iterations: 0 }];
    const r = await startAgentRun({ threadId: 't1' });
    expect(r.id).toBe('run-1');
    expect(r.status).toBe('running');
  });

  it('updateAgentRunStatus updates status', async () => {
    sql._nextResult = [{ id: 'run-1', status: 'paused_confirm' }];
    const r = await updateAgentRunStatus({ runId: 'run-1', status: 'paused_confirm' });
    expect(r.status).toBe('paused_confirm');
  });

  it('finishAgentRun updates status + iterations + tool_call_counts + completed_at', async () => {
    sql._nextResult = [{ id: 'run-1', status: 'completed', iterations: 4, tool_call_counts: { createNode: 3, addEdge: 1 } }];
    const r = await finishAgentRun({
      runId: 'run-1', status: 'completed', iterations: 4,
      toolCallCounts: { createNode: 3, addEdge: 1 },
    });
    expect(r.status).toBe('completed');
    expect(r.iterations).toBe(4);
  });
});
