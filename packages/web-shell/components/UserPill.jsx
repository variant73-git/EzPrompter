'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// Circular initial-letter avatar with a dropdown menu (Account, Billing,
// Preferences, Sign out). Reused in the boards sidebar and intended to
// land in the editor's inspector header next.

export default function UserPill({ name, email, onSignOut }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const initial = (name || email || '?').trim().charAt(0).toUpperCase();
  const display = name || email;

  useEffect(() => {
    if (!open) return;
    function onDown(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="user-pill-wrap" ref={ref}>
      <button
        type="button"
        className={`user-pill ${open ? 'open' : ''}`}
        onClick={() => setOpen((p) => !p)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="user-pill-avatar">{initial}</span>
        <span className="user-pill-label">
          <span className="user-pill-name">{display}</span>
          <span className="user-pill-sub">Account</span>
        </span>
        <svg className="user-pill-chevron" viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="m3 7.5 3-3 3 3"/>
        </svg>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="user-menu"
            initial={{ opacity: 0, y: 6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 320, damping: 26 }}
            role="menu"
          >
            <a className="user-menu-item" href="#account" onClick={() => setOpen(false)}>Account</a>
            <a className="user-menu-item" href="#billing" onClick={() => setOpen(false)}>Billing</a>
            <a className="user-menu-item" href="#preferences" onClick={() => setOpen(false)}>Preferences</a>
            <div className="user-menu-divider" />
            <button
              type="button"
              className="user-menu-item user-menu-danger"
              onClick={() => { setOpen(false); onSignOut(); }}
            >
              Sign out
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
