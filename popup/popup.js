// RepixBridge - Popup Script

const API_BASE = 'https://repix.vercel.app';

const MODEL_DEFAULTS = {
  gemini: 'gemini-2.0-flash',
  ollama: 'moondream',
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-6'
};

const SYNC_DEFAULTS = {
  onboardingDone: false,
  activeMode: 'dark',
  apiProvider: 'gemini',
  apiKey: '',
  model: 'gemini-2.0-flash',
  designTool: 'figma',
  ollamaUrl: 'http://localhost:11434',
  language: 'en',
  authToken: ''
};

const AI_SERVICES = [
  { name: 'ChatGPT', url: 'https://chat.openai.com/' },
  { name: 'Gemini', url: 'https://gemini.google.com/' },
  { name: 'Leonardo', url: 'https://app.leonardo.ai/' },
  { name: 'Ideogram', url: 'https://ideogram.ai/' },
  { name: 'Midjourney', url: 'https://www.midjourney.com/' },
  { name: 'DreamStudio', url: 'https://dreamstudio.ai/' }
];

// ─── Utility Functions ──────────────────────────────────────────

function timeAgo(timestamp) {
  if (!timestamp) return '';
  const ts = typeof timestamp === 'string' ? new Date(timestamp).getTime() : timestamp;
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days > 1 ? 's' : ''} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months > 1 ? 's' : ''} ago`;
}

function truncate(text, maxLen) {
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + '...';
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ─── View Management ────────────────────────────────────────────

function showView(viewName) {
  const viewMap = {
    onboarding: 'viewOnboarding',
    main: 'viewMain',
    settings: 'viewSettings'
  };
  Object.values(viewMap).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  });
  const target = document.getElementById(viewMap[viewName]);
  if (target) target.hidden = false;
}

// ─── Main Init ──────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {

  // ─── Onboarding ─────────────────────────────────────────────

  const slides = document.querySelectorAll('.rb-slide');
  const dots = document.querySelectorAll('.rb-dot');
  const nextBtn = document.getElementById('onboardingNext');
  const skipBtn = document.getElementById('skipOnboarding');
  let onboardIndex = 0;

  function updateOnboarding() {
    slides.forEach((slide, i) => {
      slide.hidden = i !== onboardIndex;
    });
    dots.forEach((dot, i) => {
      dot.classList.toggle('active', i === onboardIndex);
    });
    if (nextBtn) {
      nextBtn.textContent = onboardIndex === slides.length - 1 ? 'Get Started' : 'Next';
    }
  }

  function finishOnboarding() {
    chrome.storage.sync.set({ onboardingDone: true }, () => {
      showView('main');
      loadMainContent();
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (onboardIndex >= slides.length - 1) {
        finishOnboarding();
      } else {
        onboardIndex++;
        updateOnboarding();
      }
    });
  }

  if (skipBtn) {
    skipBtn.addEventListener('click', finishOnboarding);
  }

  // Initial onboarding state
  updateOnboarding();

  // Decide initial view
  chrome.storage.sync.get(SYNC_DEFAULTS, (data) => {
    if (!data.onboardingDone) {
      showView('onboarding');
    } else {
      showView('main');
      loadMainContent();
    }
    // Apply saved mode
    applyMode(data.activeMode || 'dark');
  });

  // ─── Mode Toggle ────────────────────────────────────────────

  const modeToggle = document.querySelector('.rb-toggle');

  function applyMode(mode) {
    document.body.dataset.mode = mode;
    const htmlContent = document.getElementById('contentDark');
    const remixContent = document.getElementById('contentLight');
    if (htmlContent) htmlContent.hidden = mode !== 'dark';
    if (remixContent) remixContent.hidden = mode !== 'light';

    // Update toggle button states
    if (modeToggle) {
      modeToggle.querySelectorAll('.rb-toggle-seg').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
      });
    }
  }

  if (modeToggle) {
    modeToggle.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-mode]');
      if (!btn) return;
      const mode = btn.dataset.mode;
      applyMode(mode);
      chrome.storage.sync.set({ activeMode: mode });
      loadMainContent();
    });
  }

  // ─── Settings Navigation ────────────────────────────────────

  const cogBtn = document.getElementById('cogBtn');
  const settingsBack = document.getElementById('settingsBack');

  if (cogBtn) {
    cogBtn.addEventListener('click', () => {
      showView('settings');
      loadSettings();
    });
  }

  if (settingsBack) {
    settingsBack.addEventListener('click', () => {
      showView('main');
    });
  }

  // ─── Settings Form ─────────────────────────────────────────

  const settingsForm = document.getElementById('settingsForm');
  const providerSelect = document.getElementById('apiProvider');
  const apiKeyInput = document.getElementById('apiKey');
  const modelInput = document.getElementById('model');
  const designToolSelect = document.getElementById('designTool');
  const ollamaUrlInput = document.getElementById('ollamaUrl');
  const ollamaUrlField = document.getElementById('ollamaUrlField');
  const languageSelect = document.getElementById('language');
  const toggleKeyBtn = document.getElementById('toggleKey');
  const status = document.getElementById('status');

  function updateProviderUI(provider) {
    const isOllama = provider === 'ollama';
    if (ollamaUrlField) ollamaUrlField.style.display = isOllama ? 'block' : 'none';
    if (apiKeyInput && apiKeyInput.parentElement) {
      apiKeyInput.parentElement.style.display = isOllama ? 'none' : 'block';
    }
  }

  function loadSettings() {
    chrome.storage.sync.get(SYNC_DEFAULTS, (settings) => {
      if (providerSelect) providerSelect.value = settings.apiProvider;
      if (apiKeyInput) apiKeyInput.value = settings.apiKey;
      if (modelInput) modelInput.value = settings.model;
      if (designToolSelect) designToolSelect.value = settings.designTool || 'figma';
      if (ollamaUrlInput) ollamaUrlInput.value = settings.ollamaUrl || 'http://localhost:11434';
      if (languageSelect) languageSelect.value = settings.language;
      updateProviderUI(settings.apiProvider);
    });
    checkAuth();
  }

  if (toggleKeyBtn && apiKeyInput) {
    toggleKeyBtn.addEventListener('click', () => {
      if (apiKeyInput.type === 'password') {
        apiKeyInput.type = 'text';
        toggleKeyBtn.textContent = 'Hide';
      } else {
        apiKeyInput.type = 'password';
        toggleKeyBtn.textContent = 'Show';
      }
    });
  }

  if (providerSelect && modelInput) {
    providerSelect.addEventListener('change', () => {
      const provider = providerSelect.value;
      const current = modelInput.value;
      const isDefault = Object.values(MODEL_DEFAULTS).includes(current) || !current;
      if (isDefault) modelInput.value = MODEL_DEFAULTS[provider];
      updateProviderUI(provider);
    });
  }

  if (settingsForm) {
    settingsForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const settings = {
        apiProvider: providerSelect ? providerSelect.value : 'gemini',
        apiKey: apiKeyInput ? apiKeyInput.value.trim() : '',
        model: modelInput ? modelInput.value.trim() || MODEL_DEFAULTS[providerSelect ? providerSelect.value : 'gemini'] : '',
        designTool: designToolSelect ? designToolSelect.value : 'figma',
        ollamaUrl: ollamaUrlInput ? ollamaUrlInput.value.trim() || 'http://localhost:11434' : 'http://localhost:11434',
        language: languageSelect ? languageSelect.value : 'en'
      };
      chrome.storage.sync.set(settings, () => {
        if (status) {
          status.textContent = 'Settings saved!';
          setTimeout(() => { status.textContent = ''; }, 2000);
        }
      });
    });
  }

  // ─── Account Integration ────────────────────────────────────

  const accountSection = document.getElementById('account-section');
  const loggedOutEl = document.getElementById('logged-out');
  const loggedInEl = document.getElementById('logged-in');
  const userEmailEl = document.getElementById('userEmail');
  const userPlanEl = document.getElementById('userPlan');
  const signInBtn = document.getElementById('signInBtn');
  const logoutBtn = document.getElementById('logoutBtn');

  function showLoggedIn(user) {
    if (loggedOutEl) loggedOutEl.style.display = 'none';
    if (loggedInEl) loggedInEl.style.display = 'block';
    if (userEmailEl) userEmailEl.textContent = user.email || '';
    if (userPlanEl) {
      const isPro = user.plan === 'pro';
      userPlanEl.textContent = isPro ? 'PRO' : 'FREE';
      userPlanEl.className = 'account-badge' + (isPro ? ' badge-pro' : '');
    }
  }

  function showLoggedOut() {
    if (loggedOutEl) loggedOutEl.style.display = 'block';
    if (loggedInEl) loggedInEl.style.display = 'none';
  }

  async function checkAuth() {
    const { authToken } = await chrome.storage.sync.get({ authToken: '' });
    if (!authToken) {
      showLoggedOut();
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/auth/validate`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (!res.ok) throw new Error('Invalid token');
      const { user } = await res.json();
      showLoggedIn(user);
    } catch (e) {
      chrome.storage.sync.remove('authToken');
      showLoggedOut();
    }
  }

  if (signInBtn) {
    signInBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: API_BASE });
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      chrome.storage.sync.remove('authToken', () => {
        showLoggedOut();
      });
    });
  }

  // Re-check auth when token changes externally
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.authToken) checkAuth();
  });

  // ─── Main Content Loading ───────────────────────────────────

  function loadMainContent() {
    chrome.storage.sync.get({ activeMode: 'dark' }, (data) => {
      if (data.activeMode === 'light') {
        loadImageRemixContent();
      } else {
        loadHtmlDesignContent();
      }
    });
  }

  // ─── Image Remix Content (Light Mode) ───────────────────────

  function loadImageRemixContent() {
    const container = document.getElementById('contentLight');
    if (!container) return;

    chrome.storage.local.get({ recentPrompts: [] }, (data) => {
      const prompts = data.recentPrompts || [];

      if (prompts.length === 0) {
        container.innerHTML = '<p class="rb-empty">No prompts yet. Right-click any image to get started.</p>';
        return;
      }

      container.innerHTML = '';
      prompts.forEach((item) => {
        const card = createPromptCard(item);
        container.appendChild(card);
      });
    });
  }

  function createPromptCard(item) {
    const card = document.createElement('div');
    card.className = 'rb-card';
    card.dataset.id = item.id || '';

    const titleText = escapeHtml(truncate(item.title || item.prompt || 'Untitled', 60));
    const promptText = escapeHtml(truncate(item.prompt || '', 100));
    const style = escapeHtml(item.style || '');
    const aspectRatio = escapeHtml(item.aspectRatio || '');

    let tagsHtml = '';
    if (style) {
      tagsHtml += `<span class="rb-tag" data-field="style" title="Click to edit">${style}</span>`;
    }
    if (aspectRatio) {
      tagsHtml += `<span class="rb-tag" data-field="aspectRatio" title="Click to edit">${aspectRatio}</span>`;
    }

    const aiButtonsHtml = AI_SERVICES.map(svc =>
      `<button class="rb-pill ai-btn" data-url="${escapeHtml(svc.url)}" title="Open in ${escapeHtml(svc.name)}">${escapeHtml(svc.name)}</button>`
    ).join('');

    card.innerHTML = `
      <div class="rb-card-header">
        <span class="rb-card-prompt">"${titleText}"</span>
        <button type="button" class="rb-edit edit-prompt-link" data-id="${escapeHtml(item.id || '')}">Edit</button>
      </div>
      ${tagsHtml ? `<div class="rb-card-meta">${tagsHtml}</div>` : ''}
      <div class="rb-card-actions">${aiButtonsHtml}</div>
      <div class="rb-card-edit" hidden>
        <textarea class="rb-edit-textarea">${escapeHtml(item.prompt || '')}</textarea>
        <button class="rb-btn rb-btn-sm rb-btn-primary prompt-save-btn">Save</button>
      </div>
    `;

    // Event delegation for this card
    card.addEventListener('click', (e) => {
      // AI button click
      const aiBtn = e.target.closest('.ai-btn');
      if (aiBtn) {
        e.preventDefault();
        const prompt = item.prompt || '';
        navigator.clipboard.writeText(prompt).then(() => {
          chrome.tabs.create({ url: aiBtn.dataset.url });
        }).catch(() => {
          chrome.tabs.create({ url: aiBtn.dataset.url });
        });
        return;
      }

      // Edit link click
      const editLink = e.target.closest('.edit-prompt-link');
      if (editLink) {
        e.preventDefault();
        const editSection = card.querySelector('.rb-card-edit');
        if (editSection) {
          editSection.hidden = !editSection.hidden;
        }
        return;
      }

      // Save button click
      const saveBtn = e.target.closest('.prompt-save-btn');
      if (saveBtn) {
        e.preventDefault();
        const textarea = card.querySelector('.rb-edit-textarea');
        if (textarea && item.id) {
          const newPrompt = textarea.value;
          chrome.storage.local.get({ recentPrompts: [] }, (data) => {
            const prompts = data.recentPrompts || [];
            const idx = prompts.findIndex(p => p.id === item.id);
            if (idx !== -1) {
              prompts[idx].prompt = newPrompt;
              chrome.storage.local.set({ recentPrompts: prompts }, () => {
                loadImageRemixContent();
              });
            }
          });
        }
        return;
      }

      // Inline tag editing
      const tag = e.target.closest('.tag');
      if (tag) {
        e.preventDefault();
        const field = tag.dataset.field;
        if (!field) return;
        const currentVal = tag.textContent;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'tag-edit-input';
        input.value = currentVal;
        tag.replaceWith(input);
        input.focus();
        input.select();

        const commitEdit = () => {
          const newVal = input.value.trim();
          if (newVal && item.id) {
            chrome.storage.local.get({ recentPrompts: [] }, (data) => {
              const prompts = data.recentPrompts || [];
              const idx = prompts.findIndex(p => p.id === item.id);
              if (idx !== -1) {
                prompts[idx][field] = newVal;
                chrome.storage.local.set({ recentPrompts: prompts }, () => {
                  loadImageRemixContent();
                });
              }
            });
          } else {
            loadImageRemixContent();
          }
        };

        input.addEventListener('blur', commitEdit);
        input.addEventListener('keydown', (ke) => {
          if (ke.key === 'Enter') { ke.preventDefault(); input.blur(); }
          if (ke.key === 'Escape') { loadImageRemixContent(); }
        });
        return;
      }
    });

    return card;
  }

  // ─── HTML→Design Content (Dark Mode) ───────────────────────

  function loadHtmlDesignContent() {
    const container = document.getElementById('contentDark');
    if (!container) return;

    chrome.storage.local.get({ recentCaptures: [] }, (data) => {
      const captures = data.recentCaptures || [];

      if (captures.length === 0) {
        container.innerHTML = '<p class="rb-empty">No captures yet. Right-click any page to capture layout.</p>';
        return;
      }

      chrome.storage.sync.get({ designTool: 'figma' }, (syncData) => {
        const tool = syncData.designTool || 'figma';
        const toolName = tool.charAt(0).toUpperCase() + tool.slice(1);

        container.innerHTML = '';
        captures.forEach((item) => {
          const card = createCaptureCard(item, toolName);
          container.appendChild(card);
        });
      });
    });
  }

  function createCaptureCard(item, toolName) {
    const card = document.createElement('div');
    card.className = 'rb-card';
    card.dataset.id = item.id || '';

    const domain = escapeHtml(item.domain || 'Unknown');
    const ago = timeAgo(item.timestamp);
    const title = escapeHtml(truncate(item.title || domain, 50));

    card.innerHTML = `
      <div class="rb-card-header">
        <span class="rb-card-domain">${domain}</span>
        <span class="rb-card-time">${ago}</span>
      </div>
      <div class="rb-card-actions">
        <button type="button" class="rb-btn rb-btn-outline rb-btn-sm capture-open-btn" data-capture-id="${escapeHtml(item.captureId || '')}">Open in ${escapeHtml(toolName)}</button>
        <button type="button" class="rb-btn rb-btn-outline rb-btn-sm capture-preview-btn" data-url="${escapeHtml(item.url || '')}">Preview</button>
      </div>
      <div class="rb-card-export">
        <span class="rb-export-label">Export</span>
        <button type="button" class="rb-pill rb-export-btn" data-format="svg" data-capture-id="${escapeHtml(item.captureId || '')}">SVG</button>
        <button type="button" class="rb-pill rb-export-btn" data-format="png" data-capture-id="${escapeHtml(item.captureId || '')}">PNG</button>
        <button type="button" class="rb-pill rb-export-btn" data-format="jpg" data-capture-id="${escapeHtml(item.captureId || '')}">JPG</button>
        <button type="button" class="rb-pill rb-export-btn" data-format="figma" data-capture-id="${escapeHtml(item.captureId || '')}">Figma</button>
      </div>
    `;

    card.addEventListener('click', (e) => {
      const openBtn = e.target.closest('.capture-open-btn');
      if (openBtn) {
        e.preventDefault();
        // Send message to background to open in design tool
        chrome.runtime.sendMessage({
          action: 'openInDesignTool',
          captureId: openBtn.dataset.captureId
        });
        return;
      }

      const previewBtn = e.target.closest('.capture-preview-btn');
      if (previewBtn) {
        e.preventDefault();
        const url = previewBtn.dataset.url;
        if (url) chrome.tabs.create({ url });
        return;
      }

      const exportBtn = e.target.closest('.rb-export-btn');
      if (exportBtn) {
        e.preventDefault();
        const format = exportBtn.dataset.format;
        const captureId = exportBtn.dataset.captureId;
        chrome.runtime.sendMessage({
          action: 'exportCapture',
          captureId,
          format
        });
        exportBtn.textContent = 'Exporting...';
        setTimeout(() => {
          const labels = { svg: 'SVG', png: 'PNG', jpg: 'JPG', figma: 'Figma' };
          exportBtn.textContent = labels[format] || format;
        }, 2000);
        return;
      }
    });

    return card;
  }
});
