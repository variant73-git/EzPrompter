import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AssetSmartEditDock from './AssetSmartEditDock.jsx';

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    body: {
      getReader: () => {
        const events = [
          'event: thread_id\ndata: {"threadId":"t1"}\n\n',
          'event: run_id\ndata: {"runId":"r1"}\n\n',
          'event: tool_call\ndata: {"id":"tc1","name":"createImage","args":{},"classification":"needs_choice"}\n\n',
          'event: tool_status\ndata: {"id":"tc1","status":"done","result":{"dataUrl":"data:image/png;base64,XYZ","assetId":"a1"}}\n\n',
          'event: run_status\ndata: {"status":"completed"}\n\n',
        ];
        let i = 0;
        return {
          read: () => Promise.resolve(
            i < events.length
              ? { value: new TextEncoder().encode(events[i++]), done: false }
              : { value: undefined, done: true }
          ),
        };
      },
    },
  }));
});

describe('AssetSmartEditDock', () => {
  it('renders textarea + send button in idle state', () => {
    render(<AssetSmartEditDock boardId="b1" assetId="a1" />);
    expect(screen.getByPlaceholderText(/tell the ai/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument();
  });

  it('submits + renders result image when SSE completes', async () => {
    render(<AssetSmartEditDock boardId="b1" assetId="a1" />);
    const ta = screen.getByPlaceholderText(/tell the ai/i);
    await userEvent.type(ta, 'make it teal');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => {
      const img = screen.getByRole('img');
      expect(img.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    });
    expect(screen.getByRole('button', { name: /generate another/i })).toBeInTheDocument();
  });

  it('returns to idle when Generate another clicked', async () => {
    render(<AssetSmartEditDock boardId="b1" assetId="a1" />);
    const ta = screen.getByPlaceholderText(/tell the ai/i);
    await userEvent.type(ta, 'make it teal');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => screen.getByRole('button', { name: /generate another/i }));
    await userEvent.click(screen.getByRole('button', { name: /generate another/i }));
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByPlaceholderText(/tell the ai/i)).toBeInTheDocument();
  });
});
