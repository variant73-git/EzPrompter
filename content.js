// EzPrompter - Content Script

let overlay = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'describeImage') {
    processImage(message.imageUrl);
  }
});

async function processImage(imageUrl) {
  showOverlay('Analyzing image with AI...');

  try {
    const result = await sendToBackground({
      action: 'processImage',
      imageUrl: imageUrl,
      pageUrl: window.location.href,
      pageTitle: document.title
    });

    if (result.success) {
      showOverlay(null, result.data);
    } else {
      showOverlay(`Error: ${result.error}`, null, true);
    }
  } catch (error) {
    showOverlay(`Error: ${error.message}`, null, true);
  }
}

function sendToBackground(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, response => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

function showOverlay(loadingText, result, isError) {
  removeOverlay();

  overlay = document.createElement('div');
  overlay.id = 'ezprompter-overlay';

  if (loadingText && !result) {
    // Loading state
    overlay.innerHTML = `
      <div class="ezp-modal">
        <div class="ezp-header">
          <span class="ezp-logo">EzPrompter</span>
          <button class="ezp-close" id="ezp-close">&times;</button>
        </div>
        <div class="ezp-body">
          <div class="ezp-spinner"></div>
          <p class="ezp-status">${escapeHtml(loadingText)}</p>
        </div>
      </div>
    `;
  } else if (isError) {
    // Error state
    overlay.innerHTML = `
      <div class="ezp-modal">
        <div class="ezp-header">
          <span class="ezp-logo">EzPrompter</span>
          <button class="ezp-close" id="ezp-close">&times;</button>
        </div>
        <div class="ezp-body">
          <p class="ezp-error">${escapeHtml(loadingText)}</p>
        </div>
      </div>
    `;
  } else {
    // Success state
    overlay.innerHTML = `
      <div class="ezp-modal">
        <div class="ezp-header">
          <span class="ezp-logo">EzPrompter</span>
          <button class="ezp-close" id="ezp-close">&times;</button>
        </div>
        <div class="ezp-body">
          <div class="ezp-success-badge">Saved!</div>
          <p class="ezp-filename">${escapeHtml(result.fileName)}</p>
          <div class="ezp-prompt-box">
            <label>Generated Prompt:</label>
            <div class="ezp-prompt-text">${escapeHtml(result.prompt)}</div>
          </div>
          <button class="ezp-copy-btn" id="ezp-copy">Copy Prompt</button>
        </div>
      </div>
    `;
  }

  document.body.appendChild(overlay);

  // Event listeners
  overlay.querySelector('#ezp-close')?.addEventListener('click', removeOverlay);
  overlay.addEventListener('click', e => {
    if (e.target === overlay) removeOverlay();
  });

  const copyBtn = overlay.querySelector('#ezp-copy');
  if (copyBtn && result) {
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(result.prompt).then(() => {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy Prompt'; }, 2000);
      });
    });
  }
}

function removeOverlay() {
  if (overlay) {
    overlay.remove();
    overlay = null;
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
