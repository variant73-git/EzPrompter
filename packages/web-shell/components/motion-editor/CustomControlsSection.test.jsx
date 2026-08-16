import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CustomControlsSection from './CustomControlsSection.jsx';

function control(overrides = {}) {
  return {
    id: 'control-1234567890abcdef12345678',
    status: 'ready',
    scope: 'animation',
    label: 'Parallax depth',
    description: 'Controls how far the layer travels while scrolling.',
    controlType: 'slider-number',
    unit: 'multiplier',
    currentValue: 1,
    originalValue: 0.5,
    domain: { min: 0, max: 2, step: 0.1 },
    targets: [{ motionId: 'motion-1' }],
    ...overrides,
  };
}

describe('CustomControlsSection', () => {
  it('renders only ready controls relevant to the active animation with no generation UI', () => {
    render(<CustomControlsSection
      controls={[
        control(),
        control({ id: 'control-aaaaaaaaaaaaaaaaaaaaaaaa', status: 'pending', label: 'Hidden pending' }),
        control({ id: 'control-bbbbbbbbbbbbbbbbbbbbbbbb', label: 'Other motion', targets: [{ motionId: 'motion-2' }] }),
      ]}
      activeMotionId="motion-1"
      onChange={() => {}}
      onReset={() => {}}
    />);
    expect(screen.getByText('Parallax depth')).toBeInTheDocument();
    expect(screen.queryByText('Hidden pending')).not.toBeInTheDocument();
    expect(screen.queryByText('Other motion')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /generate|retry|repair|regenerate/i })).not.toBeInTheDocument();
  });

  it('commits numeric edits and resets to the compatible clone original', () => {
    const onChange = vi.fn();
    const onReset = vi.fn();
    render(<CustomControlsSection controls={[control()]} activeMotionId="motion-1" onChange={onChange} onReset={onReset} />);
    const number = screen.getByRole('spinbutton', { name: 'Parallax depth value' });
    fireEvent.change(number, { target: { value: '1.4' } });
    fireEvent.blur(number);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ label: 'Parallax depth' }), 1.4);
    fireEvent.click(screen.getByRole('button', { name: 'Reset Parallax depth to original' }));
    expect(onReset).toHaveBeenCalledWith(expect.objectContaining({ originalValue: 0.5 }));
  });

  it('uses familiar controls for toggle, curated select, curated color, and easing', () => {
    render(<CustomControlsSection
      controls={[
        control({ id: 'control-aaaaaaaaaaaaaaaaaaaaaaaa', label: 'Loop', controlType: 'toggle', unit: 'boolean', currentValue: true, originalValue: false, domain: {} }),
        control({ id: 'control-bbbbbbbbbbbbbbbbbbbbbbbb', label: 'Mode', controlType: 'select', unit: 'number', currentValue: 'soft', originalValue: 'soft', domain: { options: [{ label: 'Soft', value: 'soft' }, { label: 'Strong', value: 'strong' }] } }),
        control({ id: 'control-cccccccccccccccccccccccc', label: 'Glow', controlType: 'color', unit: 'color', currentValue: '#2966ea', originalValue: '#2966ea', domain: { options: ['#2966ea', '#eea665'] } }),
        control({ id: 'control-dddddddddddddddddddddddd', label: 'Curve', controlType: 'easing', unit: 'easing', currentValue: 'ease-out', originalValue: 'ease-out', domain: { options: ['linear', 'ease-out'] } }),
      ]}
      activeMotionId="motion-1"
      onChange={() => {}}
      onReset={() => {}}
    />);
    expect(screen.getByRole('switch', { name: 'Loop' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Mode' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Glow' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Curve' })).toBeInTheDocument();
  });

  it('keeps an exhausted control visible but unavailable with the approved tooltip', () => {
    render(<CustomControlsSection
      controls={[
        control({ disabled: true, recoveryStatus: 'unavailable' }),
        control({ id: 'control-aaaaaaaaaaaaaaaaaaaaaaaa', label: 'Still available' }),
      ]}
      activeMotionId="motion-1"
      onChange={() => {}}
      onReset={() => {}}
    />);

    const unavailable = screen.getByText('Parallax depth').closest('[data-control-unavailable]');
    expect(unavailable).toHaveAttribute('title', "This website doesn't support this control.");
    expect(screen.getByRole('slider', { name: 'Parallax depth slider' })).toBeDisabled();
    expect(screen.getByRole('spinbutton', { name: 'Parallax depth value' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reset Parallax depth to original' }))
      .toHaveAttribute('title', "This website doesn't support this control.");
    expect(screen.getByRole('slider', { name: 'Still available slider' })).not.toBeDisabled();
    expect(screen.queryByRole('button', { name: /generate|retry|repair|regenerate/i })).not.toBeInTheDocument();
  });
});
