'use client';

import { useEffect, useState } from 'react';

// Toast — minimal floating notification replacing intrusive alert()
// calls. Single global toast at the bottom-right of the canvas; new
// toasts replace older ones (queueing felt noisier than helpful).
//
// Mount once via <ToastRoot /> at the top of CanvasClient. Fire
// anywhere with `toast.info(text)` / `toast.error(text)`. Style sits
// in the .popup-toast family in globals.css — Instrument typography,
// solid surface, matches the rest of the popup design language.

const listeners = new Set();
let lastId = 0;

function emit(toast) {
  for (const fn of listeners) fn(toast);
}

export const toast = {
  info(text) { emit({ id: ++lastId, text, kind: 'info' }); },
  error(text) { emit({ id: ++lastId, text, kind: 'error' }); }
};

export function ToastRoot() {
  const [current, setCurrent] = useState(null);

  useEffect(() => {
    function handler(next) { setCurrent(next); }
    listeners.add(handler);
    return () => { listeners.delete(handler); };
  }, []);

  // Auto-dismiss — 3.2s for info, 5.5s for error (longer so the user
  // can read what failed). Cancelled when a new toast supersedes.
  useEffect(() => {
    if (!current) return;
    const dur = current.kind === 'error' ? 5500 : 3200;
    const t = setTimeout(() => setCurrent((c) => (c && c.id === current.id ? null : c)), dur);
    return () => clearTimeout(t);
  }, [current]);

  if (!current) return null;
  const cls = `popup-toast${current.kind === 'error' ? ' popup-toast-error' : ''}`;
  return (
    <div className={cls} role="status" aria-live="polite" onClick={() => setCurrent(null)}>
      {current.kind === 'error' ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9"/>
          <line x1="12" y1="8" x2="12" y2="13"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      ) : null}
      <span>{current.text}</span>
    </div>
  );
}
