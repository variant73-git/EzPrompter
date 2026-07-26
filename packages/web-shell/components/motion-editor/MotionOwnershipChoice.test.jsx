import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MotionOwnershipChoice from './MotionOwnershipChoice.jsx';

const conflict = {
  property: 'opacity',
  label: 'Opacity',
  status: 'ambiguous',
  candidates: [
    { channelId: 'entrance:opacity', motionId: 'entrance', label: 'Entrance', engine: 'GSAP' },
    { channelId: 'hover:opacity', motionId: 'hover', label: 'Hover', engine: 'WAAPI' },
  ],
};

describe('MotionOwnershipChoice', () => {
  it('lists only contributing behaviors in product language and applies nothing before a choice', () => {
    const onChoose = vi.fn();
    render(<MotionOwnershipChoice conflict={conflict} onChoose={onChoose} />);

    expect(screen.getByText('Multiple motions control Opacity')).toBeTruthy();
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      expect.stringContaining('Entrance'),
      expect.stringContaining('Hover'),
    ]);
    expect(screen.queryByText(/entrance:opacity|hover:opacity/)).toBeNull();
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('returns the explicit contributor selected by the user', () => {
    const onChoose = vi.fn();
    render(<MotionOwnershipChoice conflict={conflict} onChoose={onChoose} />);

    fireEvent.click(screen.getByRole('button', { name: /Hover/ }));
    expect(onChoose).toHaveBeenCalledWith('hover:opacity');
  });

  it('explains an unsafe writer without offering a misleading standard edit', () => {
    render(<MotionOwnershipChoice
      conflict={{
        property: 'transform',
        label: 'Transform',
        status: 'unsupported',
        candidates: [
          { channelId: 'orbit:transform', motionId: 'orbit', label: 'Loop', engine: 'GSAP' },
        ],
      }}
      onChoose={vi.fn()}
    />);

    expect(screen.getByText('Transform needs a specific motion control')).toBeTruthy();
    expect(screen.getByText('GSAP · Code only')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
