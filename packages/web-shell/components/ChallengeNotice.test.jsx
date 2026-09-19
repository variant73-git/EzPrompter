import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ChallengeNotice from './ChallengeNotice.jsx';

describe('ChallengeNotice', () => {
  it('shows the English copy with an OK button and no site link', () => {
    const onOk = vi.fn();
    render(<ChallengeNotice host="amigosecreto.curriculum.com.br" onOk={onOk} onCancel={vi.fn()} />);
    expect(screen.getByRole('heading').textContent).toMatch(/quick.*check needed/i);
    expect(screen.getByText(/needs a quick check/i)).toBeTruthy();
    expect(screen.queryByText(/open amigosecreto/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onOk).toHaveBeenCalled();
  });
});
