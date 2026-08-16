import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import NativeMotionInspector from './NativeMotionInspector.jsx';

const selected = {
  id: 'hero-title',
  label: 'Hero title',
  tag: 'h1',
  classes: ['hero-title'],
  styles: {},
  rect: {},
  warnings: [],
  motion: [],
};

function controllerFixture(overrides = {}) {
  return {
    runtime: { title: 'Fixture', profile: { colors: [], fonts: [] } },
    selected,
    activeMotion: null,
    activeMotionId: null,
    customControls: [],
    timelineOffset: 0,
    motion: [],
    device: { id: 'desktop', label: 'Desktop', width: 1280, height: 800 },
    responsiveScopeFor: vi.fn((_property, fallbackValue) => ({
      mode: 'shared',
      effectiveValue: fallbackValue,
      relevant: true,
    })),
    commands: {
      applyStyle: vi.fn(),
      applyText: vi.fn(),
      applyAttribute: vi.fn(),
      applyMotion: vi.fn(),
      applyStagger: vi.fn(),
      requestResponsiveScopeChange: vi.fn(),
      applyCustomControl: vi.fn(),
      resetCustomControl: vi.fn(),
    },
    ...overrides,
  };
}

describe('NativeMotionInspector', () => {
  it('offers Properties, Motion, and Code without putting Assets on the right', () => {
    render(<NativeMotionInspector controller={controllerFixture()} />);

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Properties', 'Motion', 'Code']);
    expect(screen.queryByRole('tab', { name: 'Assets' })).toBeNull();
    expect(screen.getByRole('tabpanel', { name: 'Properties' })).toBeTruthy();
    expect(screen.getByText('Hero title')).toBeTruthy();
  });

  it('keeps tab and tabpanel semantics while switching controller-bound views', () => {
    render(<NativeMotionInspector controller={controllerFixture()} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Motion' }));
    expect(screen.getByRole('tabpanel', { name: 'Motion' })).toBeTruthy();
    expect(screen.getByText(/No animation is attached directly/)).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Code' }));
    expect(screen.getByRole('tabpanel', { name: 'Code' })).toBeTruthy();
    expect(screen.getByText('[data-uncraft-id="hero-title"]')).toBeTruthy();
  });

  it('shows Loop in the selected Motion header without placing it over the viewport', () => {
    render(<NativeMotionInspector
      controller={controllerFixture({
        activeMotion: { id: 'marquee', timing: { iterations: Infinity } },
        selectionSettlement: { status: 'settled', elementId: 'hero-title', loop: true },
      })}
      activeTab="motion"
    />);

    expect(screen.getByText('Loop')).toHaveAttribute('data-motion-loop', 'true');
  });

  it('shows a Properties-side multiple-motion indicator and opens the focused Motion choice', () => {
    const focusOwnership = vi.fn();
    const base = controllerFixture();
    const controller = controllerFixture({
      selected: {
        ...selected,
        styles: { opacity: '0.8', transform: 'none', transformOrigin: '50% 50%' },
      },
      propertyOwnership: {
        opacity: {
          status: 'ambiguous',
          property: 'opacity',
          candidates: [
            { channelId: 'entrance:opacity', motionId: 'entrance', label: 'Entrance', engine: 'GSAP' },
            { channelId: 'hover:opacity', motionId: 'hover', label: 'Hover', engine: 'WAAPI' },
          ],
        },
      },
      commands: {
        ...base.commands,
        focusOwnership,
        chooseOwnership: vi.fn(),
      },
    });
    render(<NativeMotionInspector controller={controller} />);

    fireEvent.click(screen.getByRole('button', { name: 'Choose controlling motion for Opacity' }));
    expect(focusOwnership).toHaveBeenCalledWith('opacity');
    expect(screen.getByRole('tab', { name: 'Motion' })).toHaveAttribute('aria-selected', 'true');
  });

  it('disables an unsupported field with a locked indicator instead of raising a chooser', () => {
    const focusOwnership = vi.fn();
    const base = controllerFixture();
    const controller = controllerFixture({
      selected: {
        ...selected,
        styles: { opacity: '0.8', transform: 'none', transformOrigin: '50% 50%' },
      },
      propertyOwnership: {
        opacity: {
          status: 'unsupported',
          property: 'opacity',
          candidates: [
            { channelId: 'entrance:opacity', motionId: 'entrance', label: 'Entrance', engine: 'GSAP', retargetable: false },
          ],
        },
      },
      commands: { ...base.commands, focusOwnership, chooseOwnership: vi.fn() },
    });
    render(<NativeMotionInspector controller={controller} />);

    // The input is disabled up front — an unsafe edit cannot even be attempted
    // (product rule: no blocking chooser without a choice). Query structurally by
    // the field's leaf label text (accessible-name composition is unreliable here —
    // same lesson as the Task 11 e2e locator).
    const opacityInput = screen.getByText('Opacity', { selector: 'span' }).closest('label').querySelector('input');
    expect(opacityInput).toBeDisabled();
    // The locked indicator carries the explanation and routes to Motion for details.
    fireEvent.click(screen.getByRole('button', { name: 'Opacity is driven by an animation — open Motion for details' }));
    expect(focusOwnership).toHaveBeenCalledWith('opacity');
    expect(screen.getByRole('tab', { name: 'Motion' })).toHaveAttribute('aria-selected', 'true');
  });

  it('locks typography controls too and moves focus to Motion on lock activation', () => {
    const focusOwnership = vi.fn();
    const base = controllerFixture();
    const unsupported = (property) => ({
      status: 'unsupported',
      property,
      candidates: [{ channelId: `entrance:${property}`, motionId: 'entrance', label: 'Entrance', engine: 'GSAP', retargetable: false }],
    });
    const controller = controllerFixture({
      selected: {
        ...selected,
        text: 'Hero title',
        styles: {
          fontFamily: 'Inter', textTransform: 'none', textAlign: 'left', fontStyle: 'normal',
          transform: 'none', transformOrigin: '50% 50%',
        },
      },
      propertyOwnership: {
        fontFamily: unsupported('fontFamily'),
        textTransform: unsupported('textTransform'),
        textAlign: unsupported('textAlign'),
        fontStyle: unsupported('fontStyle'),
      },
      commands: { ...base.commands, focusOwnership, chooseOwnership: vi.fn() },
    });
    render(<NativeMotionInspector controller={controller} />);

    // Typography fields lock exactly like transform/appearance ones — the inline
    // ownership fallback in applyStyle reaches them, so a live-looking field with a
    // silently ignored commit would be a new lie.
    const fontInput = screen.getByText('Font', { selector: 'span' }).closest('label').querySelector('input');
    expect(fontInput).toBeDisabled();
    const caseSelect = screen.getByText('Case', { selector: 'span' }).closest('label').querySelector('select');
    expect(caseSelect).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Align left' })).toBeDisabled();

    // Keyboard a11y: activating the lock must land focus on the Motion tab (the
    // button itself may unmount with the tab switch — focus cannot fall to body).
    fireEvent.click(screen.getByRole('button', { name: 'Font is driven by an animation — open Motion for details' }));
    expect(focusOwnership).toHaveBeenCalledWith('fontFamily');
    const motionTab = screen.getByRole('tab', { name: 'Motion' });
    expect(motionTab).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(motionTab);
  });

  it('renders only the contributing Motion channels and forwards the explicit choice', () => {
    const chooseOwnership = vi.fn();
    const base = controllerFixture();
    render(<NativeMotionInspector
      controller={controllerFixture({
        ownershipConflict: {
          requestId: 'ownership-1',
          status: 'ambiguous',
          property: 'opacity',
          label: 'Opacity',
          candidates: [
            { channelId: 'entrance:opacity', motionId: 'entrance', label: 'Entrance', engine: 'GSAP' },
            { channelId: 'hover:opacity', motionId: 'hover', label: 'Hover', engine: 'WAAPI' },
          ],
        },
        commands: {
          ...base.commands,
          chooseOwnership,
        },
      })}
    />);

    expect(screen.getByRole('tab', { name: 'Motion' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Multiple motions control Opacity')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Hover' }));
    expect(chooseOwnership).toHaveBeenCalledWith('hover:opacity');
  });

  it('shows scope per field and omits fields that belong only to another device', () => {
    const requestResponsiveScopeChange = vi.fn();
    const base = controllerFixture();
    const responsiveScopeFor = vi.fn((property, fallbackValue) => ({
      mode: property === 'fontFamily' ? 'computed' : 'shared',
      effectiveValue: fallbackValue,
      provenance: property === 'fontFamily' ? 'runtime' : 'inferred',
      relevant: property !== 'fontSize',
    }));
    render(<NativeMotionInspector controller={controllerFixture({
      selected: {
        ...selected,
        text: 'Hello',
        styles: {
          opacity: '0.8',
          transform: 'none',
          transformOrigin: '50% 50%',
          fontFamily: 'Inter',
          fontSize: '48px',
        },
      },
      responsiveScopeFor,
      commands: {
        ...base.commands,
        requestResponsiveScopeChange,
      },
    })} />);

    const opacityScope = screen.getByRole('button', { name: 'Change device scope for Opacity' });
    expect(opacityScope).toHaveAttribute('title', 'Applied to all devices');
    fireEvent.click(opacityScope);
    expect(requestResponsiveScopeChange).toHaveBeenCalledWith(expect.objectContaining({
      action: 'unlink',
      property: 'opacity',
    }));
    expect(screen.queryByText('Size')).toBeNull();
    expect(screen.getByRole('button', { name: 'Font is calculated by this website' })).toBeDisabled();
    expect(screen.queryByText('All devices')).toBeNull();
  });

  it('shows only ready controls and forwards changes without generation actions', () => {
    const applyCustomControl = vi.fn();
    const resetCustomControl = vi.fn();
    const base = controllerFixture();
    const ready = {
      id: 'control-aaaaaaaaaaaaaaaaaaaaaaaa',
      status: 'ready',
      scope: 'animation',
      label: 'Entrance duration',
      description: 'Adjusts the entrance timing.',
      controlType: 'slider-number',
      unit: 'ms',
      currentValue: 800,
      originalValue: 600,
      domain: { min: 100, max: 1600, step: 50 },
      targets: [{ motionId: 'entrance', elementId: 'hero-title' }],
    };
    render(<NativeMotionInspector
      controller={controllerFixture({
        activeMotionId: 'entrance',
        customControls: [ready, { ...ready, id: 'control-bbbbbbbbbbbbbbbbbbbbbbbb', status: 'pending', label: 'Unsafe control' }],
        commands: { ...base.commands, applyCustomControl, resetCustomControl },
      })}
      activeTab="motion"
    />);

    expect(screen.getByText('Entrance duration')).toBeTruthy();
    expect(screen.queryByText('Unsafe control')).toBeNull();
    expect(screen.queryByRole('button', { name: /generate|retry|repair|regenerate/i })).toBeNull();
    fireEvent.blur(screen.getByRole('spinbutton', { name: 'Entrance duration value' }), { target: { value: '900' } });
    expect(applyCustomControl).toHaveBeenCalledWith(ready, 900);
    fireEvent.click(screen.getByRole('button', { name: 'Reset Entrance duration to original' }));
    expect(resetCustomControl).toHaveBeenCalledWith(ready);
  });
});
