'use client';

import { useEffect, useRef } from 'react';
import styles from './native-motion-canvas.module.css';

const DEVICE_LABELS = Object.freeze({
  desktop: 'Desktop',
  tablet: 'Tablet',
  mobile: 'Mobile',
});

function focusTarget(target) {
  return target?.current || target || null;
}

export default function MotionDeviceScopeDialog({
  open,
  deviceId = 'desktop',
  returnFocus = null,
  onCancel,
  onConfirm,
}) {
  const dialogRef = useRef(null);
  const cancelRef = useRef(null);
  const returnFocusRef = useRef(null);
  const deviceLabel = DEVICE_LABELS[deviceId] || DEVICE_LABELS.desktop;

  useEffect(() => {
    if (!open) return undefined;
    returnFocusRef.current = focusTarget(returnFocus) || document.activeElement;
    cancelRef.current?.focus();
    return () => {};
  }, [open, returnFocus]);

  if (!open) return null;

  function restoreFocus() {
    const target = focusTarget(returnFocus) || returnFocusRef.current;
    target?.focus?.();
  }

  function cancel() {
    onCancel?.();
    restoreFocus();
  }

  function confirm() {
    onConfirm?.();
    restoreFocus();
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll('button:not(:disabled)') || []);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className={styles.scopeDialogBackdrop} data-native-motion-scope-dialog="true">
      <div
        ref={dialogRef}
        className={styles.scopeDialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="native-motion-scope-dialog-title"
        aria-describedby="native-motion-scope-dialog-copy"
        onKeyDown={handleKeyDown}
      >
        <h2 id="native-motion-scope-dialog-title">Change device scope</h2>
        <p id="native-motion-scope-dialog-copy">This will set this value to {deviceId}-only.</p>
        <div className={styles.scopeDialogActions}>
          <button ref={cancelRef} type="button" onClick={cancel}>Cancel</button>
          <button type="button" className={styles.scopeDialogConfirm} onClick={confirm}>
            Set {deviceLabel}-Only
          </button>
        </div>
      </div>
    </div>
  );
}
