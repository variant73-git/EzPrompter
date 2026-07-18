import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import CanvasSidebar from './CanvasSidebar.jsx';

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CanvasSidebar', () => {
  it('keeps project navigation on the logo and exposes the static libraries', () => {
    const onNewNode = vi.fn();
    render(<CanvasSidebar user={{ name: 'Adilson', email: 'a@example.com', plan: 'free' }} onNewNode={onNewNode} />);

    expect(screen.getByRole('link', { name: 'U' }).getAttribute('href')).toBe('/canvas');
    fireEvent.click(screen.getByRole('button', { name: 'New node' }));
    expect(onNewNode).toHaveBeenCalledOnce();
    expect(screen.getByText('Assets')).toBeTruthy();
    expect(screen.getByText('Workflows')).toBeTruthy();
    expect(screen.queryByText('Boards')).toBeNull();
    expect(screen.queryByText(/new board/i)).toBeNull();
  });
});
