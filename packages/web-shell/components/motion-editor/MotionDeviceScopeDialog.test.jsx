import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MotionDeviceScopeDialog from './MotionDeviceScopeDialog.jsx';

describe('MotionDeviceScopeDialog', () => {
  it.each([
    ['desktop', 'This will set this value to desktop-only.', 'Set Desktop-Only'],
    ['tablet', 'This will set this value to tablet-only.', 'Set Tablet-Only'],
    ['mobile', 'This will set this value to mobile-only.', 'Set Mobile-Only'],
  ])('uses the exact blocking copy for %s', (deviceId, copy, confirmLabel) => {
    render(<MotionDeviceScopeDialog
      open
      deviceId={deviceId}
      onCancel={vi.fn()}
      onConfirm={vi.fn()}
    />);

    expect(screen.getByRole('dialog', { name: 'Change device scope' })).toBeTruthy();
    expect(screen.getByText(copy)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(screen.getByRole('button', { name: confirmLabel })).toBeTruthy();
  });

  it('traps focus, treats Escape as Cancel, and returns focus to the chain button', () => {
    const triggerRef = createRef();
    const onCancel = vi.fn();
    render(<>
      <button ref={triggerRef} type="button">Chain</button>
      <MotionDeviceScopeDialog
        open
        deviceId="desktop"
        returnFocus={triggerRef}
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />
    </>);

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'Set Desktop-Only' });
    expect(cancel).toHaveFocus();

    confirm.focus();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(triggerRef.current).toHaveFocus();
  });
});
