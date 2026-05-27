'use client';

import { useEffect, useState } from 'react';

// Check at mount time only — the extension's content script sets this
// flag synchronously on the initial document_idle injection. If it's
// missing, prompt the user to install (Phase 2 needs it to ferry the
// verified DOM back).
function hasExtensionPresent() {
  return typeof window !== 'undefined' && window.__uncraftExtensionPresent === true;
}

// Friendly labels for the bot-protection kinds detectChallengePage emits.
// Generic fallback for anything new we haven't named yet.
const KIND_LABEL = {
  cloudflare: 'Cloudflare',
  hcaptcha:   'hCaptcha',
  recaptcha:  'Google reCAPTCHA',
  akamai:     'Akamai Bot Manager',
  perimeterx: 'PerimeterX',
  generic_challenge: 'a bot-protection check'
};

function hostnameOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url; }
}

/**
 * ChallengeModal — shown when captureSnapshot returns 409 challenge_required.
 *
 * Explains the situation (bot protection blocked the server-side capture)
 * and offers the only thing we can actually do today: open the site in
 * the user's own browser. The Uncraft extension handoff (Phase 2) will
 * close the loop end-to-end; this Phase 1 ships honest UX in the meantime.
 */
export default function ChallengeModal({ challenge, onCancel, onOpenSite }) {
  const [opened, setOpened] = useState(false);
  const extPresent = hasExtensionPresent();

  // Esc → cancel. Enter → primary action (open site, then close).
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onCancel?.();
      else if (e.key === 'Enter') handleOpen();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenge]);

  if (!challenge) return null;
  const host = hostnameOf(challenge.url);
  const kindName = KIND_LABEL[challenge.kind] || KIND_LABEL.generic_challenge;

  function handleOpen() {
    if (opened) return;
    // Register the handoff with the Uncraft extension content script
    // BEFORE opening the tab — the content script that runs on the
    // target tab needs the entry in chrome.storage to recognise the URL
    // and mount the "Send to Uncraft" banner. The web-shell content
    // script (same extension, runs on our origin) picks up this
    // postMessage and writes to chrome.storage.local.
    if (challenge.handoffToken) {
      try {
        window.postMessage({
          source: 'uncraft-web-shell',
          type: 'uncraft.handoff.register',
          payload: {
            token: challenge.handoffToken,
            url: challenge.url,
            nodeId: challenge.nodeId || challenge.placeholderId || null,
            webShellOrigin: window.location.origin,
            expiresAt: Date.now() + 5 * 60 * 1000  // mirrors token TTL
          }
        }, window.location.origin);
      } catch (e) {
        console.warn('handoff register postMessage failed', e);
      }
    }
    // Open in a new tab so the user's verified session lives in their
    // own browser context. noopener stops the new tab from getting a
    // window.opener reference back at us.
    try { window.open(challenge.url, '_blank', 'noopener,noreferrer'); }
    catch (e) {}
    setOpened(true);
    // Give the modal a beat to show the post-open state, then close.
    // Without a delay it feels jumpy — user clicks, tab opens, modal
    // vanishes mid-action.
    setTimeout(() => onOpenSite?.(), 350);
  }

  return (
    <div className="challenge-modal-overlay" onMouseDown={(e) => e.stopPropagation()}>
      <div
        className="challenge-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="challenge-modal-title"
      >
        <div className="challenge-modal-icon" aria-hidden="true">
          {/* shield-with-check — speaks "this is a protection thing" */}
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            <path d="M9 12l2 2 4-4"/>
          </svg>
        </div>

        <h3 id="challenge-modal-title" className="challenge-modal-title">
          Human verification needed
        </h3>

        <p className="challenge-modal-body">
          <strong>{host}</strong> is protected by {kindName}. The site is
          asking us to prove we're not a bot — something we can't do from
          our servers without your help.
        </p>

        <div className="challenge-modal-steps">
          <div className="challenge-modal-step">
            <span className="challenge-modal-step-num">1</span>
            <span>We'll open <strong>{host}</strong> in a new tab.</span>
          </div>
          <div className="challenge-modal-step">
            <span className="challenge-modal-step-num">2</span>
            <span>You pass the verification (usually 10 seconds).</span>
          </div>
          <div className="challenge-modal-step">
            <span className="challenge-modal-step-num">3</span>
            {extPresent ? (
              <span>
                Click <strong>Send to Uncraft</strong> on the Uncraft banner
                that appears in the verified tab. Your canvas updates
                automatically.
              </span>
            ) : (
              <span>
                Install the <strong>Uncraft browser extension</strong> to ferry
                the verified page back automatically.
                <span className="challenge-modal-soon"> (extension not detected)</span>
              </span>
            )}
          </div>
        </div>

        <div className="challenge-modal-actions">
          <button
            type="button"
            className="btn-outline challenge-modal-btn"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary challenge-modal-btn"
            onClick={handleOpen}
            disabled={opened}
            autoFocus
          >
            {opened ? 'Opening…' : `Open ${host} →`}
          </button>
        </div>
      </div>
    </div>
  );
}
