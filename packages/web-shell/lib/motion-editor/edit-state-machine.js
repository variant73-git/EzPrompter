export const EDIT_STATES = Object.freeze({
  NAVIGATING: 'navigating',
  SELECTION_PENDING: 'selection-pending',
  SETTLING: 'settling',
  EDITING_FROZEN: 'editing-frozen',
  SCRUBBING: 'scrubbing',
  PREVIEWING: 'previewing',
  RECOVERING: 'recovering',
  UNAVAILABLE: 'unavailable',
});

const VALID_STATES = new Set(Object.values(EDIT_STATES));

export function createEditState(input = {}) {
  return {
    value: VALID_STATES.has(input.value) ? input.value : EDIT_STATES.NAVIGATING,
    selectionId: input.selectionId || null,
    operationId: input.operationId || null,
    loop: input.loop === true,
    code: input.code || null,
  };
}

function staleSettlement(state, event) {
  if (event.elementId && state.selectionId && event.elementId !== state.selectionId) return true;
  return Boolean(event.operationId && state.operationId && event.operationId !== state.operationId);
}

export function transitionEditState(current, event) {
  const state = createEditState(current);
  switch (event?.type) {
    case 'runtime-ready':
    case 'released':
      return createEditState();
    case 'select':
      return createEditState({
        value: event.elementId ? EDIT_STATES.SELECTION_PENDING : EDIT_STATES.NAVIGATING,
        selectionId: event.elementId || null,
      });
    case 'settlement-started':
      if (event.elementId && state.selectionId && event.elementId !== state.selectionId) return current;
      return createEditState({
        ...state,
        value: EDIT_STATES.SETTLING,
        selectionId: event.elementId || state.selectionId,
        operationId: event.operationId || null,
      });
    case 'settlement-completed':
      if (staleSettlement(state, event)) return current;
      return createEditState({
        ...state,
        value: EDIT_STATES.EDITING_FROZEN,
        operationId: event.operationId || state.operationId,
        loop: event.loop === true,
        code: null,
      });
    case 'settlement-skipped':
      if (staleSettlement(state, event)) return current;
      return createEditState({ ...state, value: EDIT_STATES.EDITING_FROZEN, code: event.reason || null });
    case 'scroll-started':
      return createEditState({ ...state, value: EDIT_STATES.NAVIGATING, operationId: null, loop: false });
    case 'scroll-settled':
      return createEditState({
        ...state,
        value: state.selectionId ? EDIT_STATES.SELECTION_PENDING : EDIT_STATES.NAVIGATING,
        operationId: null,
        loop: false,
      });
    case 'scrub-started':
      return createEditState({ ...state, value: EDIT_STATES.SCRUBBING, operationId: null });
    case 'scrub-ended':
      return createEditState({ ...state, value: EDIT_STATES.EDITING_FROZEN, loop: event.loop === true || state.loop });
    case 'preview-started':
      return createEditState({ ...state, value: EDIT_STATES.PREVIEWING, operationId: null });
    case 'preview-ended':
      return createEditState({
        ...state,
        value: state.selectionId ? EDIT_STATES.SELECTION_PENDING : EDIT_STATES.NAVIGATING,
        operationId: null,
      });
    case 'recovery-started':
      return createEditState({ ...state, value: EDIT_STATES.RECOVERING, code: event.code || 'recovery' });
    case 'runtime-unavailable':
      return createEditState({ ...state, value: EDIT_STATES.UNAVAILABLE, code: event.code || 'runtime_unavailable' });
    default:
      return current;
  }
}
