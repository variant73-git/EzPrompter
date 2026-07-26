import { describe, expect, it } from 'vitest';
import {
  TRANSACTION_LIMITS,
  beginGesture,
  cancelGesture,
  commitGesture,
  createTransaction,
  createTransactionLedger,
  updateGesture,
} from './transaction.js';

function patch(overrides = {}) {
  return {
    id: overrides.id || 'patch-1',
    elementId: overrides.elementId || 'hero',
    kind: overrides.kind || 'style',
    property: overrides.property || 'opacity',
    before: overrides.before ?? '1',
    value: overrides.value ?? '0.5',
    ...overrides,
  };
}

describe('motion transaction contract', () => {
  it('creates one bounded transaction from one or more patches', () => {
    const transaction = createTransaction({ id: 'tx-1', requestId: 'request-1', patches: [patch()] });
    expect(transaction).toMatchObject({ id: 'tx-1', requestId: 'request-1', patches: [{ elementId: 'hero' }] });
    expect(transaction.createdAt).toEqual(expect.any(String));

    expect(() => createTransaction({ patches: [] })).toThrow('at least one patch');
    expect(() => createTransaction({
      patches: Array.from({ length: TRANSACTION_LIMITS.maxPatches + 1 }, (_, index) => patch({ id: `patch-${index}` })),
    })).toThrow('patch limit');
  });

  it('releases acknowledgements in user order even when the runtime responds out of order', () => {
    const ledger = createTransactionLedger();
    ledger.stage(createTransaction({ id: 'tx-1', requestId: 'request-1', patches: [patch({ id: 'a' })] }), { operation: 'apply' });
    ledger.stage(createTransaction({ id: 'tx-2', requestId: 'request-2', patches: [patch({ id: 'b' })] }), { operation: 'apply' });

    expect(ledger.settle('tx-2', 'committed', { patches: [patch({ id: 'b' })] })).toEqual([]);
    expect(ledger.settle('tx-1', 'committed', { patches: [patch({ id: 'a' })] }))
      .toMatchObject([
        { transaction: { id: 'tx-1' }, status: 'committed', meta: { operation: 'apply' } },
        { transaction: { id: 'tx-2' }, status: 'committed', meta: { operation: 'apply' } },
      ]);
  });

  it('treats duplicate acknowledgements as idempotent', () => {
    const ledger = createTransactionLedger();
    ledger.stage(createTransaction({ id: 'tx-1', requestId: 'request-1', patches: [patch()] }));
    expect(ledger.settle('tx-1', 'committed', {})).toHaveLength(1);
    expect(ledger.settle('tx-1', 'committed', {})).toEqual([]);
  });

  it('captures gesture before once, coalesces previews, and commits one after value', () => {
    const gesture = beginGesture({ id: 'gesture-1', patch: patch({ before: '1', value: '1' }) });
    const first = updateGesture(gesture, '0.8');
    const second = updateGesture(first, '0.4');
    const transaction = commitGesture(second, { id: 'tx-gesture', requestId: 'request-gesture' });

    expect(second.before).toBe('1');
    expect(transaction.patches).toHaveLength(1);
    expect(transaction.patches[0]).toMatchObject({ before: '1', value: '0.4' });
  });

  it('cancels a gesture with a restore patch and no transaction', () => {
    const gesture = updateGesture(beginGesture({ patch: patch({ before: '1', value: '1' }) }), '0.2');
    expect(cancelGesture(gesture)).toMatchObject({ before: '0.2', value: '1' });
  });
});
