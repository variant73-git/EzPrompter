'use client';

import { useState, useEffect } from 'react';

export default function DashboardPage() {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [upgrading, setUpgrading] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('token');
    if (!stored) {
      window.location.href = '/';
      return;
    }
    setToken(stored);

    fetch('/api/auth/validate', {
      headers: { Authorization: `Bearer ${stored}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error('Invalid session');
        return res.json();
      })
      .then((data) => {
        setUser(data.user);
        setLoading(false);
      })
      .catch(() => {
        localStorage.removeItem('token');
        window.location.href = '/';
      });
  }, []);

  function handleLogout() {
    localStorage.removeItem('token');
    window.location.href = '/';
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      const textarea = document.createElement('textarea');
      textarea.value = token;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  async function handleUpgrade() {
    setUpgrading(true);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch {
      setUpgrading(false);
    }
  }

  if (loading) {
    return (
      <div className="container" style={{ paddingTop: '4rem' }}>
        <div className="text-center">
          <p style={{ color: '#94a3b8' }}>Loading...</p>
        </div>
      </div>
    );
  }

  const capturesDisplay =
    user.capturesLimit === -1
      ? `${user.capturesUsed} (unlimited)`
      : `${user.capturesUsed} / ${user.capturesLimit}`;

  return (
    <div className="container" style={{ paddingTop: '3rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.5rem', marginBottom: 0 }}>Repix</h1>
        <button className="btn btn-danger" style={{ width: 'auto', padding: '0.5rem 1rem', fontSize: '0.875rem' }} onClick={handleLogout}>
          Log out
        </button>
      </div>

      <div className="card section">
        <h2>Account</h2>
        <div className="stat-row">
          <span className="stat-label">Email</span>
          <span className="stat-value">{user.email}</span>
        </div>
        <div className="stat-row">
          <span className="stat-label">Plan</span>
          <span>
            {user.plan === 'pro' ? (
              <span className="badge badge-pro">Pro Plan &mdash; Active</span>
            ) : (
              <span className="badge badge-free">Free</span>
            )}
          </span>
        </div>
        <div className="stat-row">
          <span className="stat-label">Captures this month</span>
          <span className="stat-value">{capturesDisplay}</span>
        </div>
      </div>

      {user.plan === 'free' && (
        <div className="card section">
          <h2>Upgrade to Pro</h2>
          <p style={{ color: '#94a3b8', fontSize: '0.875rem', marginBottom: '1rem' }}>
            Unlimited captures for $7/month. Cancel anytime.
          </p>
          <button className="btn" onClick={handleUpgrade} disabled={upgrading}>
            {upgrading ? 'Redirecting...' : 'Upgrade to Pro'}
          </button>
        </div>
      )}

      <div className="card section">
        <h2>Your Extension Token</h2>
        <p style={{ color: '#94a3b8', fontSize: '0.875rem', marginBottom: '0.75rem' }}>
          Paste this token in the Repix extension popup to link your account.
        </p>
        <div className="token-box">{token}</div>
        <button className="btn btn-outline" onClick={handleCopy}>
          {copied ? 'Copied!' : 'Copy Token'}
        </button>
      </div>
    </div>
  );
}
