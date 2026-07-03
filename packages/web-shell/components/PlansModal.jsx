'use client';

import { useEffect, useState } from 'react';

// v1 plans modal — pure waitlist (spec §11). Stripe checkout lands in v2;
// every CTA is a "Coming soon" that acknowledges interest with a toast.
const PLANS = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    period: '',
    blurb: '500 welcome credits · pay-as-you-go coming soon',
    current: true,
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$12',
    period: '/mo',
    blurb: '1,500 credits every month',
  },
  {
    id: 'ultimate',
    name: 'Ultimate',
    price: '$39',
    period: '/mo',
    blurb: '6,000 credits every month',
  },
];

export default function PlansModal({ open, onClose }) {
  const [toastMsg, setToastMsg] = useState(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 3000);
    return () => clearTimeout(t);
  }, [toastMsg]);

  if (!open) return null;

  const onPlanClick = (plan) => {
    console.info('[plans] click', plan.id);
    setToastMsg("You're on the list — plans are coming soon.");
  };

  return (
    <div className="plans-modal-overlay" onClick={onClose}>
      <div className="plans-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="plans-modal-close" aria-label="Close" onClick={onClose}>×</button>
        <div className="plans-modal-title">Plans</div>
        <div className="plans-modal-grid">
          {PLANS.map((p) => (
            <div className={`plans-modal-card${p.current ? ' current' : ''}`} key={p.id}>
              {p.current && <div className="plans-modal-badge">Current plan</div>}
              <div className="plans-modal-name">{p.name}</div>
              <div className="plans-modal-price">
                {p.price}<span className="plans-modal-period">{p.period}</span>
              </div>
              <div className="plans-modal-blurb">{p.blurb}</div>
              {!p.current && (
                <button type="button" className="plans-modal-cta" onClick={() => onPlanClick(p)}>
                  Coming soon
                </button>
              )}
            </div>
          ))}
        </div>
        {toastMsg && <div className="plans-modal-toast">{toastMsg}</div>}
      </div>
    </div>
  );
}
