'use client';

import { useEffect, useState } from 'react';
import { getDevEngine } from '../lib/dev-toggles.js';

/**
 * The dev widget's engine choice, read AFTER mount.
 *
 * The canvas is a client component but Next still renders it on the server,
 * where `localStorage` does not exist. Reading the override during render
 * would make the server emit "Edit" and the client "Clone & Edit" for the
 * same button — a hydration mismatch on a label that talks about money.
 * First paint therefore matches the server (no override); the stored choice
 * lands one tick later, which is right for a pre-launch dev-only lever.
 */
export function useDevEngine() {
  const [engine, setEngine] = useState(null);
  useEffect(() => { setEngine(getDevEngine()); }, []);
  return engine;
}
