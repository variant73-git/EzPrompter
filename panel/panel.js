// RepixBridge — Floating Panel (injected into page)
(function() {
  // Toggle: if already open, close
  const existing = document.getElementById('repixbridge-panel');
  if (existing) { existing.remove(); return; }

  // Inject Google Fonts
  if (!document.getElementById('rb-fonts')) {
    const link = document.createElement('link');
    link.id = 'rb-fonts';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&display=swap';
    document.head.appendChild(link);
  }

  const GEAR_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>';
  const CHEVRON_SVG = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5L6 7.5L9 4.5"/></svg>';
  const DOWNLOAD_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
  const CLOSE_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
  const BACK_SVG = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4L6 9l5 5"/></svg>';

  // Build panel
  const panel = document.createElement('div');
  panel.id = 'repixbridge-panel';
  panel.innerHTML = `
    <div class="rb-inner">
      <header class="rb-header">
        <div class="rb-logo">
          <div class="rb-logo-name">
            <span class="rb-logo-repix"><i>Repix</i></span><span class="rb-logo-bridge">Bridge</span>
          </div>
          <div class="rb-logo-slogan">Design without borders</div>
        </div>
        <div class="rb-header-actions">
          <button type="button" class="rb-icon-btn" id="rb-cog" aria-label="Settings">${GEAR_SVG}</button>
          <button type="button" class="rb-icon-btn" id="rb-close" aria-label="Close">${CLOSE_SVG}</button>
        </div>
      </header>

      <!-- Onboarding -->
      <div class="rb-view rb-onboarding rb-active" id="rb-viewOnboarding">
        <button type="button" class="rb-skip" id="rb-skip">Skip</button>
        <article class="rb-slide" data-step="0">
          <h2 class="rb-slide-title"><em>Bridge</em> the gap</h2>
          <p class="rb-slide-text">Take <em>anything</em> from the web straight into your design tools and AI models.</p>
        </article>
        <article class="rb-slide" data-step="1" hidden>
          <h2 class="rb-slide-title">Two <em>superpowers</em></h2>
          <p class="rb-slide-text"><em>HTML to Design</em> captures full pages. <em>Image Remix</em> reverse-engineers any image's prompt.</p>
        </article>
        <article class="rb-slide" data-step="2" hidden>
          <h2 class="rb-slide-title"><em>Zero-cost</em> start</h2>
          <span class="rb-badge-free">Free setup available</span>
          <p class="rb-slide-text">Use <em>Ollama</em> for AI and <em>Pencil</em> or <em>Paper</em> for design. No API keys, no subscriptions.</p>
        </article>
        <div class="rb-onboarding-footer">
          <div class="rb-dots">
            <span class="rb-dot active" data-dot="0"></span>
            <span class="rb-dot" data-dot="1"></span>
            <span class="rb-dot" data-dot="2"></span>
          </div>
          <button type="button" class="rb-btn rb-btn-outline" id="rb-next">Next</button>
        </div>
      </div>

      <!-- Main -->
      <div class="rb-view" id="rb-viewMain">
        <div class="rb-toggle">
          <button type="button" class="rb-toggle-seg active" data-mode="dark">HTML -> Design</button>
          <button type="button" class="rb-toggle-seg" data-mode="light">Image Remix</button>
        </div>

        <!-- Site Analysis (shown initially, replaced by history when available) -->
        <div class="rb-site-analysis" id="rb-siteAnalysis">
          <div class="rb-site-analysis-center">
            <div class="rb-loader-ring" id="rb-loader">
              <svg viewBox="0 0 80 80" width="80" height="80">
                <circle cx="40" cy="40" r="34" stroke="var(--rb-border)" stroke-width="3" fill="none"/>
                <circle cx="40" cy="40" r="34" stroke="var(--rb-accent)" stroke-width="3" fill="none"
                  stroke-dasharray="214" stroke-dashoffset="214" stroke-linecap="round"
                  transform="rotate(-90 40 40)" class="rb-loader-arc"/>
              </svg>
              <span class="rb-loader-pct" id="rb-loaderPct">0%</span>
            </div>
            <div class="rb-site-msg" id="rb-siteMsg">Analyzing...</div>
            <button type="button" class="rb-btn rb-btn-primary rb-btn-full" id="rb-remixSite" style="display:none">Remix this site</button>
          </div>
          <p class="rb-site-footer" id="rb-siteFooter">No captures yet. Right-click any page to capture.</p>
        </div>

        <div class="rb-content-scroll" id="rb-contentDark" style="display:none"></div>
        <div class="rb-content-scroll" id="rb-contentLight" style="display:none">
          <div class="rb-img-grid" id="rb-imgGrid"></div>
          <div id="rb-genCardContainer"></div>
          <div id="rb-promptsList"></div>
        </div>
      </div>

      <!-- Settings -->
      <div class="rb-view" id="rb-viewSettings">
        <div class="rb-settings-header">
          <button type="button" class="rb-back" id="rb-settingsBack">${BACK_SVG}</button>
          <h2 class="rb-settings-title">Settings</h2>
        </div>
        <form class="rb-settings-form" id="rb-settingsForm">
          <div class="rb-field">
            <label>AI Provider</label>
            <select id="rb-apiProvider">
              <option value="gemini">Google Gemini (Free)</option>
              <option value="ollama">Ollama (Local/Offline)</option>
              <option value="openai">OpenAI (GPT-4o)</option>
              <option value="anthropic">Anthropic (Claude)</option>
            </select>
          </div>
          <div class="rb-field" id="rb-apiKeyField">
            <label>API Key</label>
            <div class="rb-field-row">
              <input type="password" id="rb-apiKey" placeholder="AIza... / sk-... / sk-ant-...">
              <button type="button" class="rb-key-toggle" id="rb-toggleKey">Show</button>
            </div>
          </div>
          <div class="rb-field">
            <label>Model</label>
            <input type="text" id="rb-model" placeholder="gemini-2.0-flash">
          </div>
          <div class="rb-field" id="rb-ollamaField" style="display:none">
            <label>Ollama URL</label>
            <input type="text" id="rb-ollamaUrl" placeholder="http://localhost:11434">
          </div>
          <div class="rb-field">
            <label>Design Tool</label>
            <select id="rb-designTool">
              <option value="figma">Figma</option>
              <option value="sketch">Sketch</option>
              <option value="pencil">Pencil</option>
              <option value="paper">Paper</option>
            </select>
          </div>
          <div class="rb-field">
            <label>Language</label>
            <select id="rb-language">
              <option value="en">English</option>
              <option value="pt">Portugues (BR)</option>
              <option value="es">Espanol</option>
            </select>
          </div>
          <div class="rb-settings-divider"></div>
          <div class="rb-field-group-label">Image Generation</div>
          <div class="rb-field">
            <label>Stability AI Key</label>
            <div class="rb-field-row">
              <input type="password" id="rb-stabilityKey" placeholder="sk-...">
            </div>
          </div>
          <div class="rb-field">
            <label>Replicate Key</label>
            <div class="rb-field-row">
              <input type="password" id="rb-replicateKey" placeholder="r8_...">
            </div>
          </div>
          <button type="submit" class="rb-btn rb-btn-primary rb-btn-full">Save Settings</button>
          <div class="rb-status" id="rb-status"></div>
        </form>
      </div>
    </div>
  `;

  document.body.appendChild(panel);

  // --- State ---
  let currentStep = 0;
  let currentMode = 'dark';
  const MODEL_DEFAULTS = { gemini: 'gemini-2.0-flash', ollama: 'moondream', openai: 'gpt-4o', anthropic: 'claude-sonnet-4-6' };
  const AI_URLS = {
    ChatGPT: 'https://chatgpt.com/', Gemini: 'https://gemini.google.com/app',
    Leonardo: 'https://leonardo.ai/ai-art-generator', Ideogram: 'https://ideogram.ai/',
    Midjourney: 'https://www.midjourney.com/', DreamStudio: 'https://dreamstudio.ai/'
  };

  const $ = (sel) => panel.querySelector(sel);
  const $$ = (sel) => panel.querySelectorAll(sel);

  // --- Close ---
  $('#rb-close').addEventListener('click', () => panel.remove());

  // --- Drag ---
  const header = panel.querySelector('.rb-header');
  let dragging = false, startX, startY, origX, origY;
  header.style.cursor = 'grab';
  header.addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) return;
    dragging = true;
    startX = e.clientX; startY = e.clientY;
    const rect = panel.getBoundingClientRect();
    origX = rect.left; origY = rect.top;
    header.style.cursor = 'grabbing';
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    panel.style.right = 'auto';
    panel.style.left = (origX + e.clientX - startX) + 'px';
    panel.style.top = (origY + e.clientY - startY) + 'px';
  });
  document.addEventListener('mouseup', () => { dragging = false; header.style.cursor = 'grab'; });

  // --- View switching ---
  function showView(name) {
    $$('.rb-view').forEach(v => v.classList.remove('rb-active'));
    const target = $(`#rb-view${name.charAt(0).toUpperCase() + name.slice(1)}`);
    if (target) target.classList.add('rb-active');
  }

  // --- Onboarding ---
  const slides = $$('.rb-slide');
  const dots = $$('.rb-dot');

  function updateSlides() {
    slides.forEach((s, i) => s.hidden = i !== currentStep);
    dots.forEach((d, i) => d.classList.toggle('active', i === currentStep));
    $('#rb-next').textContent = currentStep === 2 ? 'Get Started' : 'Next';
  }

  $('#rb-next').addEventListener('click', () => {
    if (currentStep < 2) { currentStep++; updateSlides(); }
    else { chrome.storage.sync.set({ onboardingDone: true }); showView('main'); loadContent(); }
  });
  $('#rb-skip').addEventListener('click', () => {
    chrome.storage.sync.set({ onboardingDone: true }); showView('main'); loadContent();
  });

  // --- Mode toggle ---
  function applyMode(mode) {
    currentMode = mode;
    panel.classList.toggle('rb-light', mode === 'light');
    $$('.rb-toggle-seg').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    const siteAnalysis = $('#rb-siteAnalysis');
    if (siteAnalysis) siteAnalysis.style.display = mode === 'dark' ? '' : 'none';
    $('#rb-contentDark').style.display = mode === 'dark' ? '' : 'none';
    $('#rb-contentLight').style.display = mode === 'light' ? '' : 'none';
    chrome.storage.sync.set({ activeMode: mode });
  }

  panel.querySelector('.rb-toggle').addEventListener('click', (e) => {
    const btn = e.target.closest('.rb-toggle-seg');
    if (btn) { applyMode(btn.dataset.mode); loadContent(); }
  });

  // --- Settings ---
  $('#rb-cog').addEventListener('click', () => { showView('settings'); loadSettings(); });
  $('#rb-settingsBack').addEventListener('click', () => showView('main'));

  $('#rb-toggleKey').addEventListener('click', () => {
    const inp = $('#rb-apiKey');
    inp.type = inp.type === 'password' ? 'text' : 'password';
    $('#rb-toggleKey').textContent = inp.type === 'password' ? 'Show' : 'Hide';
  });

  $('#rb-apiProvider').addEventListener('change', () => {
    const p = $('#rb-apiProvider').value;
    const isOllama = p === 'ollama';
    $('#rb-ollamaField').style.display = isOllama ? '' : 'none';
    $('#rb-apiKeyField').style.display = isOllama ? 'none' : '';
    const cur = $('#rb-model').value;
    if (!cur || Object.values(MODEL_DEFAULTS).includes(cur)) $('#rb-model').value = MODEL_DEFAULTS[p];
  });

  $('#rb-settingsForm').addEventListener('submit', (e) => {
    e.preventDefault();
    chrome.storage.sync.set({
      apiProvider: $('#rb-apiProvider').value,
      apiKey: $('#rb-apiKey').value.trim(),
      model: $('#rb-model').value.trim() || MODEL_DEFAULTS[$('#rb-apiProvider').value],
      designTool: $('#rb-designTool').value,
      ollamaUrl: $('#rb-ollamaUrl').value.trim() || 'http://localhost:11434',
      language: $('#rb-language').value,
      stabilityApiKey: $('#rb-stabilityKey').value.trim(),
      replicateApiKey: $('#rb-replicateKey').value.trim()
    }, () => {
      $('#rb-status').textContent = 'Settings saved!';
      setTimeout(() => { $('#rb-status').textContent = ''; }, 2000);
    });
  });

  function loadSettings() {
    chrome.storage.sync.get({
      apiProvider: 'gemini', apiKey: '', model: 'gemini-2.0-flash',
      designTool: 'figma', ollamaUrl: 'http://localhost:11434', language: 'en',
      stabilityApiKey: '', replicateApiKey: ''
    }, (s) => {
      $('#rb-apiProvider').value = s.apiProvider;
      $('#rb-apiKey').value = s.apiKey;
      $('#rb-model').value = s.model;
      $('#rb-designTool').value = s.designTool;
      $('#rb-ollamaUrl').value = s.ollamaUrl;
      $('#rb-language').value = s.language;
      $('#rb-stabilityKey').value = s.stabilityApiKey;
      $('#rb-replicateKey').value = s.replicateApiKey;
      $('#rb-ollamaField').style.display = s.apiProvider === 'ollama' ? '' : 'none';
      $('#rb-apiKeyField').style.display = s.apiProvider === 'ollama' ? 'none' : '';
    });
  }

  // --- Content loading ---
  function esc(t) { const d = document.createElement('div'); d.textContent = t || ''; return d.innerHTML; }
  function timeAgo(ts) {
    if (!ts) return '';
    const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
    if (s < 60) return 'just now';
    const m = Math.floor(s/60); if (m < 60) return m + ' min ago';
    const h = Math.floor(m/60); if (h < 24) return h + 'h ago';
    return Math.floor(h/24) + 'd ago';
  }

  function loadContent() {
    if (currentMode === 'light') { loadPageImages(); loadPrompts(); }
    else loadCaptures();
  }

  function loadPrompts() {
    const c = $('#rb-promptsList');
    if (!c) return;
    chrome.storage.local.get({ recentPrompts: [] }, (d) => {
      const items = d.recentPrompts || [];
      if (!items.length) { c.innerHTML = ''; return; }
      c.innerHTML = '';
      items.slice(0, 20).forEach(item => {
        const pills = Object.keys(AI_URLS).map(n =>
          `<button class="rb-pill" data-url="${AI_URLS[n]}">${n}</button>`
        ).join('');
        const card = document.createElement('div');
        card.className = 'rb-card';
        card.innerHTML = `
          <div class="rb-card-header">
            <span class="rb-card-prompt">"${esc((item.title || item.prompt || '').slice(0,60))}"</span>
            <button type="button" class="rb-edit">Edit</button>
          </div>
          <div class="rb-card-meta">
            ${item.style ? `<span class="rb-tag">${esc(item.style)}</span>` : ''}
            ${item.aspectRatio ? `<span class="rb-tag">${esc(item.aspectRatio)}</span>` : ''}
          </div>
          <div class="rb-card-actions">${pills}</div>
          <div class="rb-card-edit" hidden>
            <textarea class="rb-edit-textarea">${esc(item.prompt || '')}</textarea>
            <button class="rb-btn rb-btn-sm rb-btn-primary">Save</button>
          </div>
        `;
        // AI button clicks
        card.querySelectorAll('.rb-pill').forEach(btn => {
          btn.addEventListener('click', () => {
            navigator.clipboard.writeText(item.prompt || '').catch(() => {});
            window.open(btn.dataset.url, '_blank');
          });
        });
        // Edit toggle
        card.querySelector('.rb-edit').addEventListener('click', () => {
          const ed = card.querySelector('.rb-card-edit');
          ed.hidden = !ed.hidden;
        });
        // Save edit
        card.querySelector('.rb-btn-primary').addEventListener('click', () => {
          const newPrompt = card.querySelector('.rb-edit-textarea').value;
          chrome.storage.local.get({ recentPrompts: [] }, (data) => {
            const all = data.recentPrompts || [];
            const idx = all.findIndex(p => p.id === item.id);
            if (idx !== -1) { all[idx].prompt = newPrompt; chrome.storage.local.set({ recentPrompts: all }, loadPrompts); }
          });
        });
        c.appendChild(card);
      });
    });
  }

  function loadCaptures() {
    const c = $('#rb-contentDark');
    chrome.storage.sync.get({ designTool: 'figma' }, (sync) => {
      const tool = sync.designTool || 'figma';
      const toolName = tool.charAt(0).toUpperCase() + tool.slice(1);
      chrome.storage.local.get({ recentCaptures: [] }, (d) => {
        const items = d.recentCaptures || [];
        if (!items.length) { c.innerHTML = '<p class="rb-empty">No captures yet. Right-click any page to capture layout.</p>'; return; }
        c.innerHTML = '';
        items.slice(0, 20).forEach(item => {
          const card = document.createElement('div');
          card.className = 'rb-card';
          card.innerHTML = `
            <div class="rb-card-header">
              <span class="rb-card-domain">${esc(item.domain || 'Unknown')}</span>
              <span class="rb-card-time">${timeAgo(item.timestamp)}</span>
            </div>
            <div class="rb-card-actions">
              <button class="rb-btn rb-btn-outline rb-btn-sm" data-action="open">Open in ${esc(toolName)}</button>
              <button class="rb-btn rb-btn-outline rb-btn-sm" data-action="preview">Preview</button>
            </div>
            <div class="rb-card-export">
              <span class="rb-export-label">Export</span>
              <button class="rb-pill" data-fmt="svg">SVG</button>
              <button class="rb-pill" data-fmt="png">PNG</button>
              <button class="rb-pill" data-fmt="jpg">JPG</button>
              <button class="rb-pill" data-fmt="figma">Figma</button>
            </div>
          `;
          card.querySelector('[data-action="preview"]').addEventListener('click', () => {
            if (item.url) window.open(item.url, '_blank');
          });
          card.querySelector('[data-action="open"]').addEventListener('click', () => {
            chrome.runtime.sendMessage({ action: 'openInDesignTool', captureId: item.captureId });
          });
          card.querySelectorAll('[data-fmt]').forEach(btn => {
            btn.addEventListener('click', () => {
              chrome.runtime.sendMessage({ action: 'exportCapture', captureId: item.captureId, format: btn.dataset.fmt });
              btn.textContent = '...';
              setTimeout(() => { btn.textContent = btn.dataset.fmt.toUpperCase(); }, 2000);
            });
          });
          c.appendChild(card);
        });
      });
    });
  }

  // --- Site Analysis ---
  function analyzeSite() {
    const analysis = $('#rb-siteAnalysis');
    const loader = $('#rb-loader');
    const pct = $('#rb-loaderPct');
    const msg = $('#rb-siteMsg');
    const remixBtn = $('#rb-remixSite');
    if (!analysis) return;

    const domain = window.location.hostname.replace(/^www\./, '');
    const title = document.title || '';
    const desc = (document.querySelector('meta[name="description"]')?.content || '').toLowerCase();
    const images = document.querySelectorAll('img').length;
    const videos = document.querySelectorAll('video, iframe[src*="youtube"], iframe[src*="vimeo"]').length;
    const links = document.querySelectorAll('a').length;

    // Known site detection
    const KNOWN_SITES = {
      'dribbble.com': { type: 'design', label: 'Design showcase' },
      'behance.net': { type: 'design', label: 'Creative portfolio' },
      'pinterest.com': { type: 'inspiration', label: 'Visual inspiration board' },
      'awwwards.com': { type: 'design', label: 'Award-winning design' },
      'figma.com': { type: 'tool', label: 'Design tool' },
      'unsplash.com': { type: 'photo', label: 'Photography library' },
      'pexels.com': { type: 'photo', label: 'Stock photography' },
      'instagram.com': { type: 'social', label: 'Visual feed' },
      'artstation.com': { type: 'art', label: 'Digital art gallery' },
      'deviantart.com': { type: 'art', label: 'Art community' },
      'github.com': { type: 'code', label: 'Code repository' },
      'medium.com': { type: 'editorial', label: 'Editorial content' },
      'youtube.com': { type: 'video', label: 'Video platform' },
    };

    // Detect site type from content
    const bodyText = (desc + ' ' + title).toLowerCase();
    let siteType = 'website';
    if (bodyText.match(/portfolio|designer|creative|agency/)) siteType = 'portfolio';
    else if (bodyText.match(/shop|store|buy|cart|price/)) siteType = 'e-commerce';
    else if (bodyText.match(/blog|article|post|news/)) siteType = 'editorial';
    else if (bodyText.match(/dashboard|analytics|admin/)) siteType = 'dashboard';
    else if (images > 20) siteType = 'visual-heavy';

    const known = KNOWN_SITES[domain];

    // Animate loader
    const arc = panel.querySelector('.rb-loader-arc');
    let progress = 0;
    const interval = setInterval(() => {
      progress += Math.random() * 15 + 5;
      if (progress > 100) progress = 100;
      const offset = 214 - (214 * progress / 100);
      if (arc) arc.style.strokeDashoffset = offset;
      pct.textContent = Math.round(progress) + '%';
      if (progress >= 100) {
        clearInterval(interval);
        showResult();
      }
    }, 120);

    // Store image count for later use in Image Remix tab
    panel._pageImageCount = images;

    function showResult() {
      loader.style.display = 'none';

      let message = '';
      if (known) {
        message = `${known.label}. Great eye.`;
      } else if (siteType === 'portfolio') {
        message = 'Creative portfolio. Good taste.';
      } else if (siteType === 'e-commerce') {
        message = 'Product page. Ready to capture.';
      } else if (siteType === 'visual-heavy') {
        message = 'Visual-heavy page. Let\'s capture it.';
      } else if (siteType === 'editorial') {
        message = 'Editorial layout. Clean structure.';
      } else if (siteType === 'dashboard') {
        message = 'Dashboard UI. Great for components.';
      } else {
        message = 'Nice layout. Let\'s start here?';
      }

      msg.innerHTML = `<span class="rb-site-domain">${esc(domain)}</span><span class="rb-site-tagline">${message}</span>`;
      remixBtn.style.display = '';
    }

    remixBtn.addEventListener('click', () => {
      // Switch to HTML->Design mode and trigger capture
      applyMode('dark');
      chrome.runtime.sendMessage({ action: 'captureCurrentPage' });
      msg.textContent = 'Capturing...';
      remixBtn.style.display = 'none';
      loader.style.display = '';
      pct.textContent = '';
      const arc2 = panel.querySelector('.rb-loader-arc');
      if (arc2) { arc2.style.strokeDashoffset = '160'; }
    });
  }

  // --- Image Gallery (Pinterest-style) ---
  function loadPageImages() {
    const grid = $('#rb-imgGrid');
    if (!grid) return;

    // Collect all images > 100x100 (skip icons, avatars, tracking pixels)
    const allImgs = Array.from(document.querySelectorAll('img'));
    const candidates = [];

    allImgs.forEach(img => {
      const w = img.naturalWidth || img.width || 0;
      const h = img.naturalHeight || img.height || 0;
      const src = img.currentSrc || img.src || '';
      if (!src || src.startsWith('data:image/svg') || src.startsWith('data:image/gif')) return;
      if (w < 100 || h < 100) return;
      // Skip duplicates
      if (candidates.some(c => c.src === src)) return;
      candidates.push({ src, w, h, alt: img.alt || '' });
    });

    // Also check CSS background images on major containers
    document.querySelectorAll('[style*="background-image"], section, div, article').forEach(el => {
      const bg = getComputedStyle(el).backgroundImage;
      if (bg && bg !== 'none') {
        const match = bg.match(/url\(["']?(https?:\/\/[^"')]+)["']?\)/);
        if (match && !candidates.some(c => c.src === match[1])) {
          candidates.push({ src: match[1], w: 200, h: 200, alt: '' });
        }
      }
    });

    // Sort by size (largest first), limit to 12
    candidates.sort((a, b) => (b.w * b.h) - (a.w * a.h));
    const top = candidates.slice(0, 12);

    if (top.length === 0) {
      grid.innerHTML = '<p class="rb-empty">No images found on this page.</p>';
      return;
    }

    const totalImgs = panel._pageImageCount || allImgs.length;
    grid.innerHTML = `<div class="rb-img-grid-header">${totalImgs} image${totalImgs !== 1 ? 's' : ''} found</div>`;
    top.forEach(img => {
      const item = document.createElement('div');
      item.className = 'rb-img-item';
      item.innerHTML = `
        <img src="${esc(img.src)}" alt="${esc(img.alt)}" loading="lazy"/>
        <div class="rb-img-overlay">
          <button class="rb-img-remix" data-src="${esc(img.src)}">Remix</button>
        </div>
      `;
      // Click to remix this specific image
      item.querySelector('.rb-img-remix').addEventListener('click', (e) => {
        e.stopPropagation();
        const btn = e.target;
        btn.textContent = 'Analyzing...';
        btn.disabled = true;
        chrome.runtime.sendMessage({ action: 'describeImage', imageUrl: img.src });
      });
      grid.appendChild(item);
    });
  }

  // ─── Image Generation Card ─────────────────────────────────────────────

  const IMG_PROVIDERS = [
    { id: 'stability', name: 'Stability AI', keyField: 'stabilityApiKey', keyType: 'own' },
    { id: 'openai', name: 'OpenAI DALL-E', keyField: 'apiKey', keyType: 'shared', requireProvider: 'openai' },
    { id: 'gemini', name: 'Gemini Imagen', keyField: 'apiKey', keyType: 'shared', requireProvider: 'gemini' },
    { id: 'replicate', name: 'Replicate', keyField: 'replicateApiKey', keyType: 'own' },
    { id: 'ollama', name: 'Ollama (Local)', keyField: null, keyType: 'none', comingSoon: true }
  ];

  let activeGenProvider = 'stability';

  function buildGenCard(promptText) {
    const container = $('#rb-genCardContainer');
    if (!container) return;

    container.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'rb-gen-card';
    card.innerHTML = `
      <div class="rb-gen-label">Edit prompt & generate</div>
      <textarea class="rb-gen-prompt" id="rb-genPrompt">${esc(promptText)}</textarea>
      <div class="rb-gen-provider-wrap">
        <button type="button" class="rb-gen-provider-btn" id="rb-providerDropdown">
          <span class="rb-gen-provider-name" id="rb-providerName">Stability AI</span>
          ${CHEVRON_SVG}
        </button>
        <div class="rb-gen-provider-list" id="rb-providerList" hidden></div>
      </div>
      <div class="rb-gen-tooltip" id="rb-genTooltip" hidden>
        <p class="rb-gen-tooltip-text" id="rb-genTooltipText"></p>
        <button type="button" class="rb-btn rb-btn-outline rb-btn-sm" id="rb-genTooltipConnect">Connect API</button>
      </div>
      <button type="button" class="rb-btn rb-btn-primary rb-btn-full" id="rb-genBtn">Generate</button>
      <div class="rb-gen-result" id="rb-genResult" hidden>
        <div class="rb-gen-image-wrap">
          <div class="rb-gen-skeleton" id="rb-genSkeleton"></div>
          <img class="rb-gen-image" id="rb-genImage"/>
        </div>
        <div class="rb-gen-actions">
          <button class="rb-pill" id="rb-genDownload">${DOWNLOAD_SVG} Download</button>
          <button class="rb-pill" id="rb-genAgain">Generate again</button>
        </div>
      </div>
    `;
    container.appendChild(card);

    // Dropdown toggle
    const dropdownBtn = card.querySelector('#rb-providerDropdown');
    const dropdownList = card.querySelector('#rb-providerList');

    dropdownBtn.addEventListener('click', () => {
      if (dropdownList.hidden) {
        refreshProviderList();
        dropdownList.hidden = false;
      } else {
        dropdownList.hidden = true;
      }
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!card.contains(e.target)) dropdownList.hidden = true;
    }, { once: false });

    // Generate button
    const genBtn = card.querySelector('#rb-genBtn');
    genBtn.addEventListener('click', () => {
      const prompt = card.querySelector('#rb-genPrompt').value.trim();
      if (!prompt) return;
      startGeneration(prompt);
    });

    // Generate again
    card.querySelector('#rb-genAgain').addEventListener('click', () => {
      const prompt = card.querySelector('#rb-genPrompt').value.trim();
      if (!prompt) return;
      card.querySelector('#rb-genResult').hidden = true;
      startGeneration(prompt);
    });

    // Download
    card.querySelector('#rb-genDownload').addEventListener('click', () => {
      const img = card.querySelector('#rb-genImage');
      if (img.src) {
        const a = document.createElement('a');
        a.href = img.src;
        a.download = 'repixbridge-generated.png';
        a.click();
      }
    });

    // Tooltip connect
    card.querySelector('#rb-genTooltipConnect').addEventListener('click', () => {
      showView('settings');
      loadSettings();
    });

    // Set initial provider
    refreshProviderStatus();
  }

  function refreshProviderList() {
    const list = $('#rb-providerList');
    if (!list) return;
    list.innerHTML = '';

    chrome.storage.sync.get({
      apiKey: '', apiProvider: 'gemini',
      stabilityApiKey: '', replicateApiKey: ''
    }, (s) => {
      IMG_PROVIDERS.forEach(p => {
        let connected = false;
        if (p.comingSoon) {
          connected = false;
        } else if (p.keyType === 'own') {
          connected = !!(s[p.keyField]);
        } else if (p.keyType === 'shared') {
          connected = !!(s.apiKey) && s.apiProvider === p.requireProvider;
        }

        const dotClass = p.comingSoon ? 'rb-dot-gray' : (connected ? 'rb-dot-green' : 'rb-dot-red');
        const statusText = p.comingSoon ? 'coming soon' : (connected ? 'ready' : 'connect API');
        const disabledClass = (p.comingSoon || !connected) ? 'rb-provider-disabled' : '';
        const activeClass = (p.id === activeGenProvider) ? 'rb-provider-active' : '';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `rb-gen-provider-option ${disabledClass} ${activeClass}`.trim();
        btn.dataset.provider = p.id;
        btn.innerHTML = `
          <span class="rb-status-dot ${dotClass}"></span>
          <span class="rb-gen-provider-option-name">${esc(p.name)}</span>
          <span class="rb-provider-status">${statusText}</span>
        `;

        btn.addEventListener('click', () => {
          if (p.comingSoon) return;
          selectProvider(p.id, p.name, connected);
          list.hidden = true;
        });

        list.appendChild(btn);
      });
    });
  }

  function selectProvider(id, name, connected) {
    activeGenProvider = id;
    const nameEl = $('#rb-providerName');
    if (nameEl) nameEl.textContent = name;

    const tooltip = $('#rb-genTooltip');
    const genBtn = $('#rb-genBtn');
    const tooltipText = $('#rb-genTooltipText');

    if (!connected) {
      if (tooltip) {
        tooltip.hidden = false;
        tooltipText.textContent = 'Connect your ' + name + ' API key to generate images.';
      }
      if (genBtn) { genBtn.disabled = true; genBtn.classList.add('rb-btn-disabled'); }
    } else {
      if (tooltip) tooltip.hidden = true;
      if (genBtn) { genBtn.disabled = false; genBtn.classList.remove('rb-btn-disabled'); }
    }
  }

  function refreshProviderStatus() {
    chrome.storage.sync.get({
      apiKey: '', apiProvider: 'gemini',
      stabilityApiKey: '', replicateApiKey: ''
    }, (s) => {
      // Find the best connected provider, default to stability
      const providerConfig = IMG_PROVIDERS.find(p => p.id === activeGenProvider);
      if (!providerConfig) return;

      let connected = false;
      if (providerConfig.keyType === 'own') {
        connected = !!(s[providerConfig.keyField]);
      } else if (providerConfig.keyType === 'shared') {
        connected = !!(s.apiKey) && s.apiProvider === providerConfig.requireProvider;
      }

      selectProvider(activeGenProvider, providerConfig.name, connected);
    });
  }

  function startGeneration(prompt) {
    const genBtn = $('#rb-genBtn');
    const result = $('#rb-genResult');
    const skeleton = $('#rb-genSkeleton');
    const genImage = $('#rb-genImage');

    if (genBtn) {
      genBtn.disabled = true;
      genBtn.innerHTML = '<span class="rb-gen-spinner"></span> Generating...';
      genBtn.classList.add('rb-btn-loading');
    }
    if (result) { result.hidden = false; }
    if (skeleton) { skeleton.style.display = ''; }
    if (genImage) { genImage.style.display = 'none'; genImage.src = ''; }

    chrome.runtime.sendMessage({
      action: 'generateImage',
      prompt: prompt,
      imageProvider: activeGenProvider
    });
  }

  function handleImageGenerated(dataUrl) {
    const genBtn = $('#rb-genBtn');
    const result = $('#rb-genResult');
    const skeleton = $('#rb-genSkeleton');
    const genImage = $('#rb-genImage');

    if (genBtn) {
      genBtn.disabled = false;
      genBtn.textContent = 'Generate';
      genBtn.classList.remove('rb-btn-loading');
    }
    if (result) result.hidden = false;
    if (skeleton) skeleton.style.display = 'none';
    if (genImage) { genImage.src = dataUrl; genImage.style.display = ''; }
  }

  function handleImageGenError(errorMsg) {
    const genBtn = $('#rb-genBtn');
    const result = $('#rb-genResult');
    const skeleton = $('#rb-genSkeleton');

    if (genBtn) {
      genBtn.disabled = false;
      genBtn.textContent = 'Generate';
      genBtn.classList.remove('rb-btn-loading');
    }
    if (skeleton) skeleton.style.display = 'none';
    if (result) {
      result.hidden = false;
      result.innerHTML = `<div class="rb-gen-error">${esc(errorMsg)}</div>`;
    }
  }

  // Listen for prompt results from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'promptReady') {
      // Refresh the image grid buttons
      $$('.rb-img-remix').forEach(btn => { btn.textContent = 'Remix'; btn.disabled = false; });
      // Show generation card with the prompt
      buildGenCard(message.prompt || '');
      loadPrompts();
    }
    if (message.action === 'promptError') {
      $$('.rb-img-remix').forEach(btn => { btn.textContent = 'Remix'; btn.disabled = false; });
    }
    if (message.action === 'imageGenerated') {
      handleImageGenerated(message.dataUrl);
    }
    if (message.action === 'imageGenError') {
      handleImageGenError(message.error);
    }
  });

  // --- Init ---
  chrome.storage.sync.get({ onboardingDone: false, activeMode: 'dark' }, (data) => {
    if (data.onboardingDone) {
      showView('main');
      applyMode(data.activeMode || 'dark');
      loadContent();
      analyzeSite();
    } else {
      showView('onboarding');
    }
  });
})();
