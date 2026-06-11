'use client';

import { useEffect, useState } from 'react';

// Lightweight confirmation modal — frosted family, Esc/Enter shortcuts,
// click-outside cancels. Reusable across the canvas wherever an action
// has a credit/cost or destructive consequence we want to surface before
// firing. Style sits in the .confirm-modal-* family in globals.css.
//
// Props:
//   open        — render gate
//   title       — string headline
//   message     — string body (or ReactNode)
//   confirmLabel / cancelLabel — button text
//   destructive — when true, confirm button uses red accent
//   busy        — while running the confirm action, disables buttons + shows spinner
//   checkboxLabel — optional; renders a checkbox ("don't ask again" etc).
//                   Its checked state is passed to onConfirm.
//   onConfirm   — fires on confirm click / Enter; receives (checked)
//   onCancel    — fires on cancel click / Esc / click-outside
export default function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  busy = false,
  checkboxLabel = null,
  onConfirm,
  onCancel,
}) {
  const [checked, setChecked] = useState(false);
  // Fresh modal = fresh checkbox; the pref only persists when the user
  // actively ticks it AND confirms.
  useEffect(() => { if (open) setChecked(false); }, [open]);
  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); onCancel?.(); }
      if (e.key === 'Enter' && !busy) { e.preventDefault(); onConfirm?.(checked); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onConfirm, onCancel, checked]);

  if (!open) return null;

  return (
    <div className="confirm-modal-overlay" onClick={busy ? undefined : onCancel}>
      <div className="confirm-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-modal-title">{title}</div>
        {message ? <div className="confirm-modal-text">{message}</div> : null}
        {checkboxLabel ? (
          <label className="confirm-modal-checkbox">
            <input
              type="checkbox"
              checked={checked}
              disabled={busy}
              onChange={(e) => setChecked(e.target.checked)}
            />
            <span>{checkboxLabel}</span>
          </label>
        ) : null}
        <div className="confirm-modal-actions">
          <button
            type="button"
            className="confirm-modal-btn confirm-modal-btn-cancel"
            disabled={busy}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`confirm-modal-btn ${destructive ? 'confirm-modal-btn-destructive' : 'confirm-modal-btn-primary'}`}
            disabled={busy}
            onClick={() => onConfirm?.(checked)}
          >
            {busy ? (
              <span className="confirm-modal-spinner" aria-hidden="true" />
            ) : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
