import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PropertyScopeButton from './PropertyScopeButton.jsx';

const property = {
  property: 'opacity',
  propertyKey: 'hero:opacity',
  label: 'Opacity',
  value: '0.8',
  binding: { elementId: 'hero', kind: 'style', property: 'opacity' },
};

describe('PropertyScopeButton', () => {
  it('shows the approved connected-chain tooltip and requests a blocking unlink', () => {
    const onRequest = vi.fn();
    render(<PropertyScopeButton
      {...property}
      device={{ id: 'desktop', label: 'Desktop' }}
      scope={{ mode: 'shared', effectiveValue: '0.8', relevant: true }}
      onRequest={onRequest}
    />);

    const button = screen.getByRole('button', { name: 'Change device scope for Opacity' });
    expect(button).toHaveAttribute('title', 'Applied to all devices');
    fireEvent.click(button);
    expect(onRequest).toHaveBeenCalledWith(expect.objectContaining({
      action: 'unlink',
      propertyKey: 'hero:opacity',
      deviceId: 'desktop',
      visibleValue: '0.8',
    }));
  });

  it('reconnects an unlinked property immediately without asking for a dialog', () => {
    const onRequest = vi.fn();
    render(<PropertyScopeButton
      {...property}
      device={{ id: 'tablet', label: 'Tablet' }}
      scope={{ mode: 'per-device', effectiveValue: '0.6', relevant: true }}
      onRequest={onRequest}
    />);

    fireEvent.click(screen.getByRole('button', { name: 'Apply Opacity to all devices' }));
    expect(onRequest).toHaveBeenCalledWith(expect.objectContaining({
      action: 'reconnect',
      deviceId: 'tablet',
      visibleValue: '0.6',
    }));
  });

  it('communicates computed ownership and disables invalid scope actions', () => {
    render(<PropertyScopeButton
      {...property}
      device={{ id: 'mobile', label: 'Mobile' }}
      scope={{ mode: 'computed', effectiveValue: '0.8', provenance: 'runtime', relevant: true }}
      onRequest={vi.fn()}
    />);

    const button = screen.getByRole('button', { name: 'Opacity is calculated by this website' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Calculated by this website');
  });
});
