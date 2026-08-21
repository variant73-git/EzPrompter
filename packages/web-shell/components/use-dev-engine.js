'use client';

import { useSyncExternalStore } from 'react';
import { DEV_ENGINE_EVENT, getDevEngine } from '../lib/dev-toggles.js';

function subscribe(onChange) {
  window.addEventListener(DEV_ENGINE_EVENT, onChange);   // same document
  window.addEventListener('storage', onChange);          // other tabs
  return () => {
    window.removeEventListener(DEV_ENGINE_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/**
 * The dev widget's engine choice, kept in sync across every surface.
 *
 * Two hazards this closes, both about a label that talks about money:
 *  - the canvas is a client component that Next STILL renders on the server,
 *    where `localStorage` does not exist; the server snapshot is therefore
 *    `null`, so first paint matches and hydration cannot diverge;
 *  - a same-document storage write fires no `storage` event, so a one-shot
 *    read would go stale the moment the widget switches engines — the button
 *    would say "Edit" while the click bills a clone (Sol final round).
 */
export function useDevEngine() {
  return useSyncExternalStore(subscribe, getDevEngine, () => null);
}
