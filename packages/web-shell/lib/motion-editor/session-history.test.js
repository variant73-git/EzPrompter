import { describe, expect, it } from 'vitest';
import {
  acknowledgeSessionTransaction,
  createSessionHistory,
  redoSessionHistory,
  scopeSessionHistory,
  sessionHistoryCount,
  sessionHistoryFromPatches,
  sessionHistoryPatches,
  undoSessionHistory,
} from './session-history.js';

function patch(id, overrides = {}) {
  return {
    id,
    elementId: 'hero',
    kind: 'style',
    property: 'opacity',
    before: '1',
    value: '0.5',
    ...overrides,
  };
}

function transaction(id, patches = [patch(`${id}-patch`)], source = 'properties') {
  return { id, requestId: `${id}-request`, source, createdAt: '2026-07-26T00:00:00.000Z', patches };
}

describe('native motion edit-session history', () => {
  it('contains only acknowledged user transactions from the active session', () => {
    let history = createSessionHistory({ sessionId: 'session-a' });
    history = acknowledgeSessionTransaction(history, transaction('tx-a'), { sessionId: 'session-a' });
    history = acknowledgeSessionTransaction(history, transaction('tx-other'), { sessionId: 'session-b' });
    history = acknowledgeSessionTransaction(history, transaction('tx-replay', [], 'replay'), { sessionId: 'session-a' });

    expect(history.past.map((entry) => entry.transaction.id)).toEqual(['tx-a']);
    expect(sessionHistoryCount(history)).toBe(1);
    expect(sessionHistoryPatches(history).map((item) => item.id)).toEqual(['tx-a-patch']);
  });

  it('undoes newest-first and redoes in chronological order', () => {
    let history = createSessionHistory({ sessionId: 'session-a' });
    history = acknowledgeSessionTransaction(history, transaction('tx-1'), { sessionId: 'session-a' });
    history = acknowledgeSessionTransaction(history, transaction('tx-2'), { sessionId: 'session-a' });

    let result = undoSessionHistory(history);
    expect(result.transaction.id).toBe('tx-2');
    history = result.history;
    result = undoSessionHistory(history);
    expect(result.transaction.id).toBe('tx-1');
    history = result.history;

    result = redoSessionHistory(history);
    expect(result.transaction.id).toBe('tx-1');
    history = result.history;
    result = redoSessionHistory(history);
    expect(result.transaction.id).toBe('tx-2');
  });

  it('clears only the abandoned redo branch after a new acknowledged change', () => {
    let history = createSessionHistory({ sessionId: 'session-a' });
    history = acknowledgeSessionTransaction(history, transaction('tx-1'), { sessionId: 'session-a' });
    history = acknowledgeSessionTransaction(history, transaction('tx-2'), { sessionId: 'session-a' });
    history = undoSessionHistory(history).history;
    expect(history.future.map((entry) => entry.transaction.id)).toEqual(['tx-2']);

    history = acknowledgeSessionTransaction(history, transaction('tx-3'), { sessionId: 'session-a' });
    expect(history.past.map((entry) => entry.transaction.id)).toEqual(['tx-1', 'tx-3']);
    expect(history.future).toEqual([]);
  });

  it('keeps automatic repairs nested in the transaction that caused them', () => {
    const repair = patch('repair-1', { property: 'transform', before: 'none', value: 'translateX(0px)' });
    const history = acknowledgeSessionTransaction(
      createSessionHistory({ sessionId: 'session-a' }),
      transaction('tx-1'),
      { sessionId: 'session-a', repairs: [repair] },
    );

    expect(history.past).toHaveLength(1);
    expect(history.past[0].repairs).toEqual([repair]);
    expect(sessionHistoryCount(history)).toBe(1);
    expect(sessionHistoryPatches(history).map((item) => item.id)).toEqual(['tx-1-patch', 'repair-1']);

    const undone = undoSessionHistory(history);
    expect(undone.transaction.id).toBe('tx-1');
    expect(undone.repairs).toEqual([repair]);
  });

  it('restores persisted automatic repairs as part of the same history entry', () => {
    const repair = patch('repair-1', { property: 'transform', before: 'none', value: 'translateX(0px)' });
    const history = createSessionHistory({
      sessionId: 'session-a',
      transactions: [{ ...transaction('tx-1'), automaticRepairs: [repair] }],
    });
    expect(history.past[0].repairs).toEqual([repair]);
    expect(sessionHistoryPatches(history).map((item) => item.id)).toEqual(['tx-1-patch', 'repair-1']);
  });

  it('adapts legacy patch arrays by consecutive group without creating cross-session history', () => {
    const legacy = [
      patch('a', { groupId: 'group-1' }),
      patch('b', { groupId: 'group-1', property: 'color' }),
      patch('c', { property: 'width' }),
    ];
    const history = sessionHistoryFromPatches(legacy, { sessionId: 'session-a' });
    expect(history.past.map((entry) => entry.transaction.patches.map((item) => item.id))).toEqual([['a', 'b'], ['c']]);
    expect(sessionHistoryPatches(history)).toEqual(legacy);

    expect(scopeSessionHistory(history, 'session-a')).toBe(history);
    expect(scopeSessionHistory(history, 'session-b')).toEqual(createSessionHistory({ sessionId: 'session-b' }));
  });
});
