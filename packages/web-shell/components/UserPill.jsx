'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronsUpDown } from 'lucide-react';

// Circular initial-letter avatar with a dropdown menu. Header shows
// user name + plan badge; "Manage Account" sits underneath in a smaller
// type. When plan === 'free', an Upgrade-to-PRO CTA appears just below
// — the badge swaps automatically once the plan flips to 'pro' (or any
// non-free string) so we never have to update this component when the
// user upgrades.

export default function UserPill({ name, email, plan = 'free', role = 'member', onSignOut, compact = false, workspaceMode = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const parts = (name || email || '?').trim().split(/\s+/).filter(Boolean);
  const initial = workspaceMode
    ? parts.slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join('')
    : parts[0].charAt(0).toUpperCase();
  const display = name || email;
  const visibleName = workspaceMode ? (parts[0] || display) : display;

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
        className={`user-pill ${compact ? 'compact ' : ''}${open ? 'open' : ''}`}
        onClick={() => setOpen((p) => !p)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={compact ? (display || 'Account') : undefined}
      >
        <span className="user-pill-avatar">{initial}</span>
        {!compact && (
          <span className="user-pill-label">
            <span className="user-pill-name">{visibleName}</span>
            <span className="user-pill-sub">{workspaceMode ? 'Local workspace' : 'Account'}</span>
          </span>
        )}
        {workspaceMode ? (
          <ChevronsUpDown className="user-pill-chevron" aria-hidden="true" />
        ) : (
          <svg className="user-pill-chevron" viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            {compact ? <path d="m3 4.5 3 3 3-3"/> : <path d="m3 7.5 3-3 3 3"/>}
          </svg>
        )}
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
            <div className="user-menu-header">
              <div className="user-menu-name-row">
                <span className="user-menu-name">{display || 'Account'}</span>
                <span className={`user-menu-plan-tag plan-${(plan || 'free').toLowerCase()}`}>
                  {(plan || 'free').toUpperCase()}
                </span>
              </div>
              <a className="user-menu-manage" href="#account" onClick={() => setOpen(false)}>
                Manage Account
              </a>
              {(plan || 'free').toLowerCase() === 'free' && (
                <a className="user-menu-upgrade" href="#upgrade" onClick={() => setOpen(false)}>
                  Upgrade to PRO
                </a>
              )}
            </div>
            <div className="user-menu-divider" />
            <a className="user-menu-item" href="#billing" onClick={() => setOpen(false)}>Billing</a>
            <a className="user-menu-item" href="#preferences" onClick={() => setOpen(false)}>Preferences</a>
            {role === 'admin' && (
              <>
                <div className="user-menu-divider" />
                <span className="user-menu-group-label">Admin</span>
                <a className="user-menu-item" href="/admin/motion-diagnostics" onClick={() => setOpen(false)}>
                  Motion diagnostics
                </a>
              </>
            )}
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
