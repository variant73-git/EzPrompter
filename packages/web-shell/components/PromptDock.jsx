'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { normalizeUrl, looksLikeUrl } from '../lib/url.js';

const ICON_PLUS = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14"/><path d="M5 12h14"/>
  </svg>
);

const ICON_GLOBE = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <path d="M2 12h20"/>
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
  </svg>
);

const ICON_PIN = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" x2="12" y1="17" y2="22"/>
    <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/>
  </svg>
);

const ICON_BRAIN = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z"/>
    <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z"/>
  </svg>
);

const ICON_ARROW_UP = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>
  </svg>
);

const ICON_X = (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
  </svg>
);

const ACCEPT_TYPES = 'image/*,.md,.markdown,.html,text/markdown,text/html';
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const TEXTAREA_MAX_HEIGHT = 240;

export default function PromptDock({ onAddUrl, onUploadMd, onUploadHtml, nodeCount }) {
  const [text, setText] = useState('');
  const [imageFile, setImageFile] = useState(null);   // attached image (preview only)
  const [imagePreview, setImagePreview] = useState(null);
  const [showAddUrl, setShowAddUrl] = useState(false);
  const [showBrain, setShowBrain] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const taRef = useRef(null);

  // Auto-resize textarea
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, TEXTAREA_MAX_HEIGHT) + 'px';
  }, [text]);

  function fileKind(file) {
    const name = (file.name || '').toLowerCase();
    if (file.type.startsWith('image/')) return 'image';
    if (file.type === 'text/markdown' || /\.(md|markdown)$/.test(name)) return 'md';
    if (file.type === 'text/html' || /\.html?$/.test(name)) return 'html';
    return 'unknown';
  }

  async function handlePickedFile(file) {
    const kind = fileKind(file);
    if (kind === 'md') {
      setBusy(true);
      try { await onUploadMd(file); } finally { setBusy(false); }
      return;
    }
    if (kind === 'html') {
      setBusy(true);
      try { await onUploadHtml(file); } finally { setBusy(false); }
      return;
    }
    if (kind === 'image') {
      if (file.size > MAX_IMAGE_SIZE) {
        alert('Image too large (max 10MB).');
        return;
      }
      setImageFile(file);
      const r = new FileReader();
      r.onload = (e) => setImagePreview(e.target.result);
      r.readAsDataURL(file);
      return;
    }
    alert('Unsupported file type. Use image, .md, or .html.');
  }

  function clearImage() {
    setImageFile(null);
    setImagePreview(null);
  }

  async function submit() {
    const value = text.trim();
    if (!value && !imageFile) return;

    if (showAddUrl) {
      const url = normalizeUrl(value);
      if (!url) {
        alert('Enter a domain (example.com) or full URL.');
        return;
      }
      setBusy(true);
      try {
        await onAddUrl(url);
        setText('');
        setShowAddUrl(false);
      } finally {
        setBusy(false);
      }
      return;
    }

    // Free-text path (chat / feedback) — wired later. For now, log + clear.
    // eslint-disable-next-line no-console
    console.log('[prompt-dock] submit (no chat handler yet):', { text: value, imageFile });
    setText('');
    clearImage();
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function handlePaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const it of items) {
      if (it.type.indexOf('image') !== -1) {
        const f = it.getAsFile();
        if (f) {
          e.preventDefault();
          handlePickedFile(f);
          break;
        }
      }
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    const f = e.dataTransfer.files?.[0];
    if (f) handlePickedFile(f);
  }

  const hasContent = text.trim() !== '' || imageFile !== null;
  const placeholder = showAddUrl
    ? 'example.com or full URL…'
    : showBrain
      ? 'Brainstorm…'
      : showPin
        ? 'Pin feedback on the canvas…'
        : nodeCount === 0
          ? 'Add a site URL or design.md to start your canvas…'
          : 'Add another node…';

  return (
    <div
      className="prompt-dock"
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDrop={handleDrop}
    >
      <AnimatePresence>
        {imagePreview && (
          <motion.div
            className="prompt-dock-chips"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
          >
            <div className="prompt-dock-chip">
              <img src={imagePreview} alt={imageFile.name} />
              <button className="prompt-dock-chip-x" onClick={clearImage} aria-label="Remove image">
                {ICON_X}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <textarea
        ref={taRef}
        className="prompt-dock-textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder={placeholder}
        rows={1}
        disabled={busy}
      />

      <div className="prompt-dock-actions">
        <div className="prompt-dock-actions-left">
          <button
            type="button"
            className="prompt-dock-icon-btn"
            onClick={() => fileRef.current?.click()}
            title="Add file (image, .md, .html)"
            disabled={busy}
          >
            {ICON_PLUS}
          </button>

          <button
            type="button"
            className={`prompt-dock-pill ${showAddUrl ? 'active add-url' : ''}`}
            onClick={() => { setShowAddUrl((p) => !p); setShowBrain(false); setShowPin(false); }}
            disabled={busy}
          >
            <motion.span
              className="prompt-dock-pill-icon"
              animate={{ rotate: showAddUrl ? 360 : 0, scale: showAddUrl ? 1.1 : 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 25 }}
            >
              {ICON_GLOBE}
            </motion.span>
            <AnimatePresence initial={false}>
              {showAddUrl && (
                <motion.span
                  className="prompt-dock-pill-label"
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: 'auto', opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  transition={{ duration: 0.18 }}
                >
                  Add URL
                </motion.span>
              )}
            </AnimatePresence>
          </button>

          <button
            type="button"
            className={`prompt-dock-pill ${showBrain ? 'active brain' : ''}`}
            onClick={() => { setShowBrain((p) => !p); setShowAddUrl(false); setShowPin(false); }}
            title="Brainstorming"
            disabled={busy}
          >
            <motion.span
              className="prompt-dock-pill-icon"
              animate={{ rotate: showBrain ? 360 : 0, scale: showBrain ? 1.1 : 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 25 }}
            >
              {ICON_BRAIN}
            </motion.span>
            <AnimatePresence initial={false}>
              {showBrain && (
                <motion.span
                  className="prompt-dock-pill-label"
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: 'auto', opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  transition={{ duration: 0.18 }}
                >
                  Brainstorming
                </motion.span>
              )}
            </AnimatePresence>
          </button>

          <button
            type="button"
            className={`prompt-dock-pill ${showPin ? 'active pin' : ''}`}
            onClick={() => { setShowPin((p) => !p); setShowAddUrl(false); setShowBrain(false); }}
            title="Feedback mode (coming next)"
            disabled={busy}
          >
            <motion.span
              className="prompt-dock-pill-icon"
              animate={{ rotate: showPin ? 360 : 0, scale: showPin ? 1.1 : 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 25 }}
            >
              {ICON_PIN}
            </motion.span>
            <AnimatePresence initial={false}>
              {showPin && (
                <motion.span
                  className="prompt-dock-pill-label"
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: 'auto', opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  transition={{ duration: 0.18 }}
                >
                  Feedback Mode
                </motion.span>
              )}
            </AnimatePresence>
          </button>
        </div>

        <motion.button
          type="button"
          className={`prompt-dock-send ${hasContent ? 'active' : ''}`}
          whileHover={hasContent ? { scale: 1.06 } : {}}
          whileTap={hasContent ? { scale: 0.94 } : {}}
          transition={{ type: 'spring', stiffness: 400, damping: 22 }}
          disabled={busy || !hasContent}
          onClick={submit}
          aria-label="Send"
        >
          {ICON_ARROW_UP}
        </motion.button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT_TYPES}
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handlePickedFile(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}
