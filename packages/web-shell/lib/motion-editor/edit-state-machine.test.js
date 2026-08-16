import { describe, expect, it } from 'vitest';
import {
  EDIT_STATES,
  createEditState,
  transitionEditState,
} from './edit-state-machine.js';

describe('native motion edit state machine', () => {
  it('moves from navigation through scoped settlement into a frozen edit state', () => {
    let state = createEditState();
    state = transitionEditState(state, { type: 'select', elementId: 'hero' });
    expect(state).toMatchObject({ value: EDIT_STATES.SELECTION_PENDING, selectionId: 'hero' });

    state = transitionEditState(state, { type: 'settlement-started', elementId: 'hero', operationId: 'settle-1' });
    expect(state.value).toBe(EDIT_STATES.SETTLING);

    state = transitionEditState(state, {
      type: 'settlement-completed',
      elementId: 'hero',
      operationId: 'settle-1',
      loop: false,
    });
    expect(state).toMatchObject({
      value: EDIT_STATES.EDITING_FROZEN,
      selectionId: 'hero',
      operationId: 'settle-1',
      loop: false,
    });
  });

  it('restores navigation while scrolling and settles the retained selection afterward', () => {
    let state = createEditState({ value: EDIT_STATES.EDITING_FROZEN, selectionId: 'hero' });
    state = transitionEditState(state, { type: 'scroll-started' });
    expect(state).toMatchObject({ value: EDIT_STATES.NAVIGATING, selectionId: 'hero' });

    state = transitionEditState(state, { type: 'scroll-settled' });
    expect(state).toMatchObject({ value: EDIT_STATES.SELECTION_PENDING, selectionId: 'hero' });
  });

  it('keeps scrub and Preview transient and returns to the selected editing context', () => {
    let state = createEditState({ value: EDIT_STATES.EDITING_FROZEN, selectionId: 'loop' });
    state = transitionEditState(state, { type: 'scrub-started' });
    expect(state.value).toBe(EDIT_STATES.SCRUBBING);

    state = transitionEditState(state, { type: 'scrub-ended', loop: true });
    expect(state).toMatchObject({ value: EDIT_STATES.EDITING_FROZEN, selectionId: 'loop', loop: true });

    state = transitionEditState(state, { type: 'preview-started' });
    expect(state).toMatchObject({ value: EDIT_STATES.PREVIEWING, selectionId: 'loop' });

    state = transitionEditState(state, { type: 'preview-ended' });
    expect(state).toMatchObject({ value: EDIT_STATES.SELECTION_PENDING, selectionId: 'loop' });
  });

  it('ignores stale settlement acknowledgements from a previous selection', () => {
    const state = createEditState({
      value: EDIT_STATES.SETTLING,
      selectionId: 'next',
      operationId: 'settle-next',
    });

    expect(transitionEditState(state, {
      type: 'settlement-completed',
      elementId: 'previous',
      operationId: 'settle-previous',
    })).toBe(state);
  });

  it('keeps recovery scoped and can degrade to unavailable without losing the selection identity', () => {
    let state = createEditState({ value: EDIT_STATES.SETTLING, selectionId: 'hero' });
    state = transitionEditState(state, { type: 'recovery-started', code: 'settlement_timeout' });
    expect(state).toMatchObject({ value: EDIT_STATES.RECOVERING, selectionId: 'hero', code: 'settlement_timeout' });

    state = transitionEditState(state, { type: 'runtime-unavailable', code: 'runtime_unavailable' });
    expect(state).toMatchObject({ value: EDIT_STATES.UNAVAILABLE, selectionId: 'hero', code: 'runtime_unavailable' });
  });
});
