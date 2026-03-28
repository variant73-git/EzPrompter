// Repix - Content Script (minimal - overlay is injected by background.js via scripting API)
// This file exists as a fallback listener in case direct scripting injection fails.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'showOverlay') {
    showOverlayInPage(message.state);
  }
});

function showOverlayInPage(state) {
  const existing = document.getElementById('repix-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'repix-overlay';

  function esc(text) {
    const d = document.createElement('div');
    d.textContent = text || '';
    return d.innerHTML;
  }

  let body = '';
  if (state.loading) {
    body = `<div class="ezp-spinner"><span></span></div><p class="ezp-status">${esc(state.text)}</p>`;
  } else if (state.error) {
    body = `<p class="ezp-error">${esc(state.text)}</p>`;
  } else if (state.success) {
    const jsonStr = state.metadata ? JSON.stringify(state.metadata, null, 2) : '{}';
    body = `
      <div class="ezp-success-badge">Saved!</div>
      <p class="ezp-filename">${esc(state.fileName)}</p>
      <div class="ezp-tabs">
        <button class="ezp-tab ezp-tab-active" data-tab="both">Prompt + Json</button>
        <button class="ezp-tab" data-tab="prompt">Prompt</button>
        <button class="ezp-tab" data-tab="json">Json</button>
      </div>
      <div class="ezp-tab-content ezp-tab-visible" data-content="both">
        <div class="ezp-prompt-box">
          <label>Generated Prompt:</label>
          <div class="ezp-prompt-text">${esc(state.prompt)}</div>
        </div>
        <div class="ezp-prompt-box">
          <label>Metadata (JSON):</label>
          <div class="ezp-prompt-text ezp-json-text">${esc(jsonStr)}</div>
        </div>
      </div>
      <div class="ezp-tab-content" data-content="prompt">
        <div class="ezp-prompt-box">
          <label>Generated Prompt:</label>
          <div class="ezp-prompt-text">${esc(state.prompt)}</div>
        </div>
      </div>
      <div class="ezp-tab-content" data-content="json">
        <div class="ezp-prompt-box">
          <label>Metadata (JSON):</label>
          <div class="ezp-prompt-text ezp-json-text">${esc(jsonStr)}</div>
        </div>
      </div>
      <button class="ezp-copy-btn" id="ezp-copy">Copy Prompt</button>
      <div class="ezp-openin">
        <label>Open in...</label>
        <div class="ezp-ai-grid">
          <button class="ezp-ai-btn" data-url="https://chatgpt.com/" data-name="ChatGPT">
            <span class="ezp-ai-icon">✦</span> ChatGPT
          </button>
          <button class="ezp-ai-btn" data-url="https://gemini.google.com/app" data-name="Gemini">
            <span class="ezp-ai-icon">◆</span> Gemini
          </button>
          <button class="ezp-ai-btn" data-url="https://leonardo.ai/ai-art-generator" data-name="Leonardo">
            <span class="ezp-ai-icon">▲</span> Leonardo
          </button>
          <button class="ezp-ai-btn" data-url="https://ideogram.ai/" data-name="Ideogram">
            <span class="ezp-ai-icon">◎</span> Ideogram
          </button>
          <button class="ezp-ai-btn" data-url="https://www.midjourney.com/" data-name="Midjourney">
            <span class="ezp-ai-icon">⬡</span> Midjourney
          </button>
          <button class="ezp-ai-btn" data-url="https://dreamstudio.ai/" data-name="DreamStudio">
            <span class="ezp-ai-icon">★</span> DreamStudio
          </button>
        </div>
      </div>`;
  }

  overlay.innerHTML = `
    <div class="ezp-modal">
      <div class="ezp-header">
        <div class="ezp-header-left">
          <span class="ezp-logo">Repix</span>
          <span class="ezp-tagline">Copy, paste, create.</span>
        </div>
        <button class="ezp-close" id="ezp-close">&times;</button>
      </div>
      <div class="ezp-body">${body}</div>
    </div>`;

  document.body.appendChild(overlay);
  overlay.querySelector('#ezp-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  // Tab switching
  const tabs = overlay.querySelectorAll('.ezp-tab');
  const contents = overlay.querySelectorAll('.ezp-tab-content');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('ezp-tab-active'));
      contents.forEach(c => c.classList.remove('ezp-tab-visible'));
      tab.classList.add('ezp-tab-active');
      const target = tab.getAttribute('data-tab');
      const content = overlay.querySelector(`.ezp-tab-content[data-content="${target}"]`);
      if (content) content.classList.add('ezp-tab-visible');
      const copyBtn = overlay.querySelector('#ezp-copy');
      if (copyBtn) {
        if (target === 'json') copyBtn.textContent = 'Copy JSON';
        else if (target === 'prompt') copyBtn.textContent = 'Copy Prompt';
        else copyBtn.textContent = 'Copy All';
      }
    });
  });

  // Copy button
  const copyBtn = overlay.querySelector('#ezp-copy');
  if (copyBtn && state.prompt) {
    const jsonStr = state.metadata ? JSON.stringify(state.metadata, null, 2) : '{}';
    copyBtn.addEventListener('click', () => {
      const activeTab = overlay.querySelector('.ezp-tab-active');
      const target = activeTab ? activeTab.getAttribute('data-tab') : 'both';
      let textToCopy = '';
      if (target === 'json') textToCopy = jsonStr;
      else if (target === 'prompt') textToCopy = state.prompt;
      else textToCopy = state.prompt + '\n\n---\n\n' + jsonStr;
      navigator.clipboard.writeText(textToCopy).then(() => {
        const origLabel = copyBtn.textContent;
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = origLabel; }, 2000);
      });
    });
  }

  // Open in... buttons
  overlay.querySelectorAll('.ezp-ai-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const url = btn.getAttribute('data-url');
      const name = btn.getAttribute('data-name');
      if (state.prompt) {
        navigator.clipboard.writeText(state.prompt).then(() => {
          btn.classList.add('ezp-ai-btn-copied');
          const orig = btn.innerHTML;
          btn.innerHTML = `<span class="ezp-ai-icon">✓</span> Copied! Opening...`;
          window.open(url, '_blank');
          setTimeout(() => {
            btn.innerHTML = orig;
            btn.classList.remove('ezp-ai-btn-copied');
          }, 2000);
        });
      } else {
        window.open(url, '_blank');
      }
    });
  });
}
