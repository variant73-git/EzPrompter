'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.24 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" fill="#34A853"/>
    <path d="M5.84 14.11A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.11V7.05H2.18A11 11 0 0 0 1 12c0 1.78.43 3.46 1.18 4.95l3.66-2.84z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.07.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.05l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" fill="#EA4335"/>
  </svg>
);

const GithubIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
    <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.55 0-.27-.01-.99-.01-1.94-3.2.69-3.87-1.54-3.87-1.54-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.74.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.16 1.18A10.94 10.94 0 0 1 12 6.78c.97 0 1.95.13 2.86.39 2.2-1.49 3.16-1.18 3.16-1.18.62 1.58.23 2.75.11 3.04.74.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.4-5.25 5.69.41.36.78 1.06.78 2.13 0 1.54-.01 2.78-.01 3.16 0 .3.21.66.8.55C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z"/>
  </svg>
);

export default function HomePage() {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Surface OAuth start/callback errors that the API redirected back with.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oerr = params.get('oauth_error');
    if (oerr) {
      setError(oerr);
      // Clean the URL so a refresh doesn't re-show the message.
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/signup';
    const body = mode === 'login'
      ? { email, password }
      : { email, password, name };

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Something went wrong');
        setLoading(false);
        return;
      }

      localStorage.setItem('token', data.token);
      window.location.href = '/canvas';
    } catch (err) {
      setError('Network error. Please try again.');
      setLoading(false);
    }
  }

  function handleOAuth(provider) {
    setError('');
    window.location.href = `/api/auth/oauth/${provider}/start`;
  }

  return (
    <div className="signin-shell">
      <motion.section
        className="signin-brand"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      >
        <h1 className="signin-wordmark">
          Un<span className="craft-half">craft</span>
        </h1>
        <p className="signin-tagline">
          A node-based design tool for the open web. Capture, remix, ship — without leaving the browser.
        </p>
        <span className="signin-corner-mark">v 0.1 — preview</span>
      </motion.section>

      <motion.section
        className="signin-form-wrap"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: 0.12 }}
      >
        <div className="signin-card">
          <h2>{mode === 'login' ? 'Sign in' : 'Create your account'}</h2>
          <p className="signin-subtitle">
            {mode === 'login'
              ? 'Continue to your canvas.'
              : 'A canvas, a few clicks, and your first remix.'}
          </p>

          <AnimatePresence>
            {error && (
              <motion.div
                className="error"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
              >
                {error}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="signin-providers">
            <motion.button
              type="button"
              className="signin-provider"
              onClick={() => handleOAuth('google')}
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              transition={{ type: 'spring', stiffness: 400, damping: 22 }}
            >
              <GoogleIcon />
              <span>Continue with Google</span>
            </motion.button>
            <motion.button
              type="button"
              className="signin-provider"
              onClick={() => handleOAuth('github')}
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              transition={{ type: 'spring', stiffness: 400, damping: 22 }}
            >
              <GithubIcon />
              <span>Continue with GitHub</span>
            </motion.button>
          </div>

          <div className="signin-divider">or with email</div>

          <form className="signin-form-fields" onSubmit={handleSubmit}>
            {mode === 'signup' && (
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                aria-label="Name"
                suppressHydrationWarning
              />
            )}
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com"
              aria-label="Email"
              required
              suppressHydrationWarning
            />
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'login' ? 'Password' : 'At least 8 characters'}
              aria-label="Password"
              required
              suppressHydrationWarning
            />
            <motion.button
              type="submit"
              className="btn"
              disabled={loading}
              whileTap={{ scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 400, damping: 22 }}
            >
              {loading
                ? 'Please wait…'
                : mode === 'login'
                  ? 'Sign in'
                  : 'Create account'}
            </motion.button>
          </form>

          <div className="toggle-link">
            {mode === 'login' ? (
              <span>
                New to Uncraft?{' '}
                <button onClick={() => { setMode('signup'); setError(''); }}>
                  Create an account
                </button>
              </span>
            ) : (
              <span>
                Already have an account?{' '}
                <button onClick={() => { setMode('login'); setError(''); }}>
                  Sign in
                </button>
              </span>
            )}
          </div>
        </div>
      </motion.section>
    </div>
  );
}
