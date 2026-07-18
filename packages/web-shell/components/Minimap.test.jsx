import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import Minimap from './Minimap.jsx';

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Minimap node menu', () => {
  it('opens a compact node list and selects a node', async () => {
    const onSelectNode = vi.fn();
    render(
      <Minimap
        nodes={[
          { id: 'n1', kind: 'site', origin_url: 'https://example.com', meta: { name: 'Landing' }, pos_x: 0, pos_y: 0, width: 1280, height: 720 },
          { id: 'n2', kind: 'prompt', meta: { name: 'Brief' }, pos_x: 1400, pos_y: 0, width: 600, height: 200 },
        ]}
        transformRef={{ current: null }}
        onSelectNode={onSelectNode}
      />
    );

    const trigger = await screen.findByRole('button', { name: 'Browse nodes' });
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Canvas nodes' })).toBeTruthy();
    expect(screen.getByText('Landing')).toBeTruthy();
    expect(screen.getByText('Brief')).toBeTruthy();

    fireEvent.click(screen.getByText('Brief'));
    await waitFor(() => expect(onSelectNode).toHaveBeenCalledWith('n2'));
  });
});
