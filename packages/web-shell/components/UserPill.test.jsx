import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import UserPill from './UserPill.jsx';

describe('UserPill admin entry', () => {
  it('shows Motion diagnostics only for an explicit admin', () => {
    const { unmount } = render(
      <UserPill name="Ada" email="ada@example.com" role="member" onSignOut={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /ada/i }));
    expect(screen.queryByRole('link', { name: 'Motion diagnostics' })).toBeNull();

    unmount();
    render(<UserPill name="Ada" email="ada@example.com" role="admin" onSignOut={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /ada/i }));
    const link = screen.getByRole('link', { name: 'Motion diagnostics' });
    expect(link.getAttribute('href')).toBe('/admin/motion-diagnostics');
    expect(screen.getByText('Admin')).toBeTruthy();
  });
});
