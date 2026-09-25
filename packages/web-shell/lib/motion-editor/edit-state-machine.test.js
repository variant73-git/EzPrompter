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

describe('masked/reloading (runtime failure keeps the editor mounted)', () => {
  function activeEditingState() {
    // "Edição ativa" = o runtime anunciou pronto neste mount; o próprio
    // runtime-ready é quem liga o flag — nada de fabricar shape à mão.
    let state = transitionEditState(createEditState(), { type: 'runtime-ready' });
    state = transitionEditState(state, { type: 'select', elementId: 'hero' });
    return state;
  }

  it('runtime-ready marks the state as ready', () => {
    expect(transitionEditState(createEditState(), { type: 'runtime-ready' }).ready).toBe(true);
  });

  it('runtime-unavailable during ACTIVE editing lands on MASKED with the failure code', () => {
    const next = transitionEditState(activeEditingState(), {
      type: 'runtime-unavailable',
      code: 'session_scope_mismatch',
    });
    expect(next).toMatchObject({ value: EDIT_STATES.MASKED, code: 'session_scope_mismatch' });
  });

  it('runtime-unavailable during INITIAL opening (never ready) keeps the current teardown state', () => {
    const next = transitionEditState(createEditState(), { type: 'runtime-unavailable', code: 'x' });
    expect(next.value).toBe(EDIT_STATES.UNAVAILABLE);
  });

  it('ready survives ordinary editing transitions (select does not drop it)', () => {
    let state = transitionEditState(createEditState(), { type: 'runtime-ready' });
    state = transitionEditState(state, { type: 'select', elementId: 'hero' });
    state = transitionEditState(state, { type: 'scroll-started' });
    state = transitionEditState(state, { type: 'scroll-settled' });
    expect(state.ready).toBe(true);
  });

  it('reload request enters RELOADING', () => {
    const masked = transitionEditState(activeEditingState(), { type: 'runtime-unavailable', code: 'x' });
    expect(transitionEditState(masked, { type: 'runtime-reload-requested' }).value).toBe(EDIT_STATES.RELOADING);
  });

  it('a FAILED reload returns to MASKED — never teardown', () => {
    const masked = transitionEditState(activeEditingState(), { type: 'runtime-unavailable', code: 'x' });
    const reloading = transitionEditState(masked, { type: 'runtime-reload-requested' });
    const next = transitionEditState(reloading, { type: 'runtime-unavailable', code: 'still_down' });
    expect(next).toMatchObject({ value: EDIT_STATES.MASKED, code: 'still_down' });
  });

  it('a successful reload (runtime-ready) leaves the mask into a fresh ready state', () => {
    const masked = transitionEditState(activeEditingState(), { type: 'runtime-unavailable', code: 'x' });
    const reloading = transitionEditState(masked, { type: 'runtime-reload-requested' });
    const next = transitionEditState(reloading, { type: 'runtime-ready' });
    expect(next).toMatchObject({ value: EDIT_STATES.NAVIGATING, ready: true, code: null });
  });

  it('reload request from any non-masked state is ignored', () => {
    const state = activeEditingState();
    expect(transitionEditState(state, { type: 'runtime-reload-requested' })).toBe(state);
  });

  it('released clears the mask and the ready flag (deliberate exit stays an exit)', () => {
    const masked = transitionEditState(activeEditingState(), { type: 'runtime-unavailable', code: 'x' });
    const next = transitionEditState(masked, { type: 'released' });
    expect(next).toMatchObject({ value: EDIT_STATES.NAVIGATING, ready: false });
  });
});
