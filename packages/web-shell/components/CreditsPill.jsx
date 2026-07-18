'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Coins } from 'lucide-react';

// Human labels for ledger rows. `meta.op` gives the operation for charges;
// `reason` covers grants (welcome / grant / purchase / refund).
const OP_LABELS = {
  'compose': 'Compose',
  'transplant': 'Transplant',
  'edit': 'Edit',
  'reconstruct': 'Reconstruct',
  'extract.clone': 'Clone',
  'extract.styleclone': 'Style clone',
  'extract.html': 'Site clone',
  'chat': 'Chat',
};
const REASON_LABELS = {
  welcome: 'Welcome',
  grant: 'Bonus',
  purchase: 'Purchase',
  refund: 'Refund',
};

export function ledgerLabel(row) {
  if (row.reason === 'charge') {
    const op = row.meta?.op || '';
    if (OP_LABELS[op]) return OP_LABELS[op];
    if (op.startsWith('extract.')) return 'Extract';
    if (op.startsWith('image.generate')) return 'Image';
    return 'Operation';
  }
  return REASON_LABELS[row.reason] || row.reason;
}

export default function CreditsPill() {
  const [credits, setCredits] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/billing/balance', { credentials: 'include' });
      if (!r.ok) return;
      const j = await r.json();
      setCredits(j.credits);
      setLedger(j.ledger || []);
    } catch (_) { /* transient — pill just keeps its last value */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Instant update after any billed api call (dispatched by canvas-api.js).
  useEffect(() => {
    const onBalance = (e) => {
      const b = e?.detail?.balance;
      if (typeof b === 'number') setCredits(b);
    };
    window.addEventListener('uncraft:balance', onBalance);
    return () => window.removeEventListener('uncraft:balance', onBalance);
  }, []);

  // Click-outside closes the dropdown.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const toggle = () => {
    setOpen((v) => !v);
    if (!open) refresh(); // fresh ledger on open
  };

  return (
    <div className="credits-pill-root" ref={rootRef}>
      <button
        type="button"
        className="credits-pill canvas-topbar-credits"
        onClick={toggle}
        title={credits == null ? 'Credits' : `${credits.toLocaleString('en-US')} credits`}
        aria-label="Credits balance"
      >
        <Coins aria-hidden="true" />
        <span className="credits-pill-value">{credits == null ? '—' : credits.toLocaleString('en-US')}</span>
      </button>
      {open && (
        <div className="credits-pill-menu" role="menu">
          <div className="credits-pill-menu-header">Recent activity</div>
          {ledger.length === 0 && <div className="credits-pill-empty">No activity yet</div>}
          {ledger.map((row, i) => (
            <div className="credits-pill-row" key={i}>
              <span className="credits-pill-row-label">{ledgerLabel(row)}</span>
              <span className={`credits-pill-row-delta ${row.delta_credits < 0 ? 'neg' : 'pos'}`}>
                {row.delta_credits > 0 ? `+${row.delta_credits}` : row.delta_credits}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
