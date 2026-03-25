// EzPrompter - Content Script (minimal - overlay is injected by background.js via scripting API)
// This file exists as a fallback listener in case direct scripting injection fails.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'showOverlay') {
    showOverlayInPage(message.state);
  }
});

function showOverlayInPage(state) {
  const existing = document.getElementById('ezprompter-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'ezprompter-overlay';

  function esc(text) {
    const d = document.createElement('div');
    d.textContent = text || '';
    return d.innerHTML;
  }

  let body = '';
  if (state.loading) {
    body = `<div class="ezp-spinner"></div><p class="ezp-status">${esc(state.text)}</p>`;
  } else if (state.error) {
    body = `<p class="ezp-error">${esc(state.text)}</p>`;
  } else if (state.success) {
    body = `
      <div class="ezp-success-badge">Saved!</div>
      <p class="ezp-filename">${esc(state.fileName)}</p>
      <div class="ezp-prompt-box">
        <label>Generated Prompt:</label>
        <div class="ezp-prompt-text">${esc(state.prompt)}</div>
      </div>
      <button class="ezp-copy-btn" id="ezp-copy">Copy Prompt</button>`;
  }

  overlay.innerHTML = `
    <div class="ezp-modal">
      <div class="ezp-header">
        <span class="ezp-logo">EzPrompter</span>
        <button class="ezp-close" id="ezp-close">&times;</button>
      </div>
      <div class="ezp-body">${body}</div>
    </div>`;

  document.body.appendChild(overlay);
  overlay.querySelector('#ezp-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  const copyBtn = overlay.querySelector('#ezp-copy');
  if (copyBtn && state.prompt) {
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(state.prompt).then(() => {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy Prompt'; }, 2000);
      });
    });
  }
}
