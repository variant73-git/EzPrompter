'use client';

import { useEffect } from 'react';

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
//   onConfirm   — fires on confirm click / Enter
//   onCancel    — fires on cancel click / Esc / click-outside
export default function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); onCancel?.(); }
      if (e.key === 'Enter' && !busy) { e.preventDefault(); onConfirm?.(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onConfirm, onCancel]);

  if (!open) return null;

  return (
    <div className="confirm-modal-overlay" onClick={busy ? undefined : onCancel}>
      <div className="confirm-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-modal-title">{title}</div>
        {message ? <div className="confirm-modal-text">{message}</div> : null}
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
            onClick={onConfirm}
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
