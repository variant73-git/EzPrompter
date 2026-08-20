import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import DevWidget, { buildRows } from './DevWidget.jsx';
import { devClockRecord } from '../lib/dev-clock.js';

describe('buildRows — fusão wall-clock × meta do servidor', () => {
  it('enriquece o registro do cliente com cloneTelemetry do node', () => {
    const nodes = [{ id: 'n1', meta: { cloneTelemetry: {
      engine: 'native-bundle', url: 'https://www.farmminerals.com/promo',
      stages: { capture: 19000 }, totalMs: 22000, credits: 275, costUsd: 0.12, at: '2026-08-20T00:00:00Z',
    } } }];
    const wall = [{ at: 5, kind: 'reconstruct', nodeId: 'n1', wallMs: 31000, ok: true }];
    const rows = buildRows(nodes, wall);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('native-bundle');       // engine do servidor vence o kind do cliente
    expect(rows[0].label).toBe('farmminerals.com');
    expect(rows[0].wallMs).toBe(31000);               // o que o usuário sentiu
    expect(rows[0].serverMs).toBe(22000);             // o que o servidor gastou
    expect(rows[0].costUsd).toBe(0.12);
  });

  it('clone estático: deriva serverMs de meta.timings e custo de meta.cloneCost', () => {
    const nodes = [{ id: 'n2', meta: {
      extractTo: 'clone',
      timings: { visaoMs: 20000, recorteMs: 4000 },
      cloneCost: { credits: 215, costUsd: 0.53 },
      similarity: { ssim: 0.941 },
    } }];
    const wall = [{ at: 9, kind: 'extract.clone', nodeId: 'n2', wallMs: 26000, ok: true }];
    const [row] = buildRows(nodes, wall);
    expect(row.serverMs).toBe(24000);
    expect(row.credits).toBe(215);
    expect(row.costUsd).toBe(0.53);
    expect(row.ssim).toBe(0.941);
  });

  it('nodes com telemetria mas sem registro do cliente também aparecem (sessão anterior)', () => {
    const nodes = [{ id: 'n3', meta: { cloneTelemetry: { engine: 'iter9', totalMs: 177000, stages: {}, credits: 150, costUsd: 0.2, at: '2026-08-19T00:00:00Z', url: 'https://a.com' } } }];
    const rows = buildRows(nodes, []);
    expect(rows).toHaveLength(1);
    expect(rows[0].wallMs).toBe(null);
    expect(rows[0].serverMs).toBe(177000);
  });
});

describe('DevWidget', () => {
  it('fechado por padrão; ⌥D abre e mostra o registro', async () => {
    render(<DevWidget nodes={[]} />);
    expect(screen.queryByTestId('dev-widget')).toBeNull();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', altKey: true }));
    });
    expect(screen.getByTestId('dev-widget')).toBeTruthy();
    await act(async () => { devClockRecord({ kind: 'capture', label: 'https://b.com', wallMs: 8000, ok: true }); });
    expect(screen.getByText('capture')).toBeTruthy();
    expect(screen.getByText('8.0s')).toBeTruthy();
  });
});
