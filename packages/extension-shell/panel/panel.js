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
  const ARROW_RIGHT_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>';
  // Paper-plane — used by the "Send to canvas" header button. Matches
  // the GEAR/CLOSE icon weight (1.5 stroke, 18×18 viewBox) so it sits
  // visually balanced next to them in rb-header-actions.
  const SEND_CANVAS_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2L15 22l-4-9-9-4z"/></svg>';

  // Monochrome tool logos (simplified SVG)
  const LOGO_FIGMA = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 24c2.2 0 4-1.8 4-4v-4H8c-2.2 0-4 1.8-4 4s1.8 4 4 4zm0-20C5.8 4 4 5.8 4 8s1.8 4 4 4h4V4H8zm0 8c-2.2 0-4 1.8-4 4s1.8 4 4 4h4v-8H8zm8-8h-4v8h4c2.2 0 4-1.8 4-4s-1.8-4-4-4zm0 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/></svg>';
  const LOGO_SKETCH = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1.5L3 8.25 12 22.5l9-14.25L12 1.5zm0 2.4l6.15 4.6L12 19.8 5.85 8.5 12 3.9z"/></svg>';
  const LOGO_PENCIL = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
  const LOGO_PAPER = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>';
  const TOOL_LOGOS = { figma: LOGO_FIGMA, sketch: LOGO_SKETCH, pencil: LOGO_PENCIL, paper: LOGO_PAPER };

  // Build panel
  const panel = document.createElement('div');
  panel.id = 'repixbridge-panel';
  panel.innerHTML = `
    <div class="rb-inner">
      <header class="rb-header">
        <div class="rb-logo">
          <div class="rb-logo-name">
            <span class="rb-logo-repix"><i>Un</i></span><span class="rb-logo-bridge">craft</span>
          </div>
          <div class="rb-logo-slogan">Design without borders</div>
        </div>
        <div class="rb-header-actions">
          <!-- Send to canvas is the PRIMARY CTA — labeled pill, fg→bg
               inversion. The conversion moment: this is where the
               session becomes a project. Icons stay as secondary
               affordances next to it. -->
          <button type="button" class="rb-send-cta" id="rb-sendCanvas" aria-label="Send this page to Uncraft canvas" title="Save your work to a canvas project">
            <span class="rb-send-cta-icon" aria-hidden="true">${SEND_CANVAS_SVG}</span>
            <span class="rb-send-cta-label">Send to Canvas</span>
          </button>
          <button type="button" class="rb-icon-btn" id="rb-cog" aria-label="Settings">${GEAR_SVG}</button>
          <button type="button" class="rb-icon-btn" id="rb-close" aria-label="Close">${CLOSE_SVG}</button>
        </div>
      </header>

      <!-- Onboarding -->
      <div class="rb-view rb-onboarding rb-active" id="rb-viewOnboarding">
        <button type="button" class="rb-skip" id="rb-skip">Skip</button>
        <article class="rb-slide" data-step="0">
          <h2 class="rb-slide-title"><span class="rb-serif">HTML</span> <em>to</em>
            <span class="rb-pill-rotate" id="rb-pillRotate">
              <span class="rb-pill-word rb-pill-active">Figma</span>
              <span class="rb-pill-word">Pencil</span>
              <span class="rb-pill-word">Paper</span>
              <span class="rb-pill-word">Sketch</span>
            </span><br><em>from</em> <span class="rb-serif">where it</span><br><span class="rb-serif">happens.</span></h2>
          <p class="rb-slide-text"><span class="rb-sans">Import any website to</span> <em>Figma</em><br><span class="rb-sans">in one click.</span></p>
        </article>
        <article class="rb-slide" data-step="1" hidden>
          <h2 class="rb-slide-title"><span class="rb-sans-title">Two</span> <em>superpowers</em></h2>
          <p class="rb-slide-text"><em>HTML to Design</em> <span class="rb-sans">captures full pages.</span> <em>Image Remix</em> <span class="rb-sans">reverse-engineers any image's prompt.</span></p>
        </article>
        <article class="rb-slide" data-step="2" hidden>
          <h2 class="rb-slide-title"><em>Zero-cost</em> <span class="rb-sans-title">start</span></h2>
          <span class="rb-badge-free">Free setup available</span>
          <p class="rb-slide-text"><span class="rb-sans">Use</span> <em>Ollama</em> <span class="rb-sans">for AI and</span> <em>Pencil</em> <span class="rb-sans">or</span> <em>Paper</em> <span class="rb-sans">for design. No API keys, no subscriptions.</span></p>
        </article>
        <div class="rb-onboarding-footer">
          <div class="rb-dots">
            <span class="rb-dot active" data-dot="0"></span>
            <span class="rb-dot" data-dot="1"></span>
            <span class="rb-dot" data-dot="2"></span>
          </div>
          <button type="button" class="rb-motion-btn rb-motion-outline" id="rb-next"><span class="rb-motion-arrow">${ARROW_RIGHT_SVG}</span><span class="rb-motion-label">next</span></button>
        </div>
      </div>

      <!-- Main -->
      <div class="rb-view" id="rb-viewMain">
        <!-- Handoff callout — appears contextually when an Uncraft canvas
             flagged THIS URL as needing human verification (Cloudflare/
             captcha challenge). Sits above the mode toggle so it's the
             first thing the user sees on a flagged tab. Hidden by default;
             init code below un-hides it after a chrome.storage match. -->
        <section class="rb-callout rb-callout-handoff" id="rb-handoffCallout" hidden>
          <button type="button" class="rb-callout-dismiss" id="rb-handoffDismiss" aria-label="Dismiss">${CLOSE_SVG}</button>
          <div class="rb-callout-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              <path d="M9 12l2 2 4-4"/>
            </svg>
          </div>
          <div class="rb-callout-body">
            <p class="rb-callout-title"><span class="rb-serif"><i>Uncraft</i></span> is waiting</p>
            <p class="rb-callout-text">A placeholder on your canvas is waiting for the verified page. Send it now.</p>
            <button type="button" class="rb-btn rb-btn-primary rb-btn-sm" id="rb-handoffSend">
              <span class="rb-btn-label">Complete capture</span>
            </button>
            <p class="rb-callout-status" id="rb-handoffStatus" hidden></p>
          </div>
        </section>

        <!-- Mode toggle. Labels reflect the v2 positioning:
             - "Design from Website" (dark mode) = the capture-and-rebuild
               family (Mode E / Iter 9 / static, picked contextually by us)
             - "Collect Assets" (light mode) = pick visual artifacts off
               the live site (image, SVG, screenshot of a UI section,
               palette, font) and save it to the user's Uncraft asset
               library. Smart Remix moved out of the widget — it lives
               on the canvas (layers panel → assets tab → per-asset
               edit button opens a side panel right of the layers panel).
             data-mode values kept ("dark" / "light") so existing
             applyMode() logic and storage keys don't churn — just the
             display labels change for now. -->
        <div class="rb-toggle">
          <button type="button" class="rb-toggle-seg active" data-mode="dark">Design from Website</button>
          <button type="button" class="rb-toggle-seg" data-mode="light">Collect Assets</button>
        </div>

        <!-- Site Analysis (shown initially, replaced by history when available) -->
        <div class="rb-site-analysis" id="rb-siteAnalysis">
          <div class="rb-site-analysis-center">
            <div class="rb-dots-loader" id="rb-loader">
              <span class="rb-bounce-dot"></span>
              <span class="rb-bounce-dot"></span>
              <span class="rb-bounce-dot"></span>
            </div>
            <div class="rb-site-msg" id="rb-siteMsg">Analyzing...</div>
            <button type="button" class="rb-motion-btn rb-motion-full" id="rb-remixSite" style="display:none"><span class="rb-motion-arrow">${ARROW_RIGHT_SVG}</span><span class="rb-motion-label">Live Remix</span></button>
          </div>
          <p class="rb-site-footer" id="rb-siteFooter">Don't know where to start?<br><span style="text-decoration:underline;cursor:pointer">Use the Quick Setup Wizard</span></p>
        </div>

        <div class="rb-content-scroll" id="rb-contentDark" style="display:none"></div>
        <div class="rb-content-scroll" id="rb-contentLight" style="display:none">
          <div class="rb-img-row-header">
            <div class="rb-img-grid-header" id="rb-imgCount"></div>
            <div style="position:relative">
              <button type="button" class="rb-api-pill" id="rb-apiPill">
                <span class="rb-status-dot rb-dot-red" id="rb-apiPillDot"></span>
                <span id="rb-apiPillLabel">connect API</span>
                ${CHEVRON_SVG}
              </button>
              <div class="rb-api-dropdown" id="rb-apiDropdown" hidden></div>
            </div>
          </div>
          <div class="rb-img-grid" id="rb-imgGrid"></div>
          <div id="rb-genCardContainer"></div>
          <div id="rb-promptsList"></div>
        </div>
      </div>

      <!-- Send to canvas -->
      <div class="rb-view" id="rb-viewSendToCanvas">
        <div class="rb-settings-header">
          <button type="button" class="rb-back" id="rb-stcBack">${BACK_SVG}</button>
          <h2 class="rb-settings-title">Send to canvas</h2>
        </div>
        <div class="rb-content-scroll rb-stc-scroll">
          <div class="rb-stc-tab-meta">
            <div class="rb-stc-tab-favicon" id="rb-stcFavicon" aria-hidden="true"></div>
            <div class="rb-stc-tab-text">
              <p class="rb-stc-tab-title" id="rb-stcTitle">Loading…</p>
              <p class="rb-stc-tab-url" id="rb-stcUrl"></p>
            </div>
          </div>

          <div class="rb-stc-section">
            <label class="rb-stc-label">Send to</label>
            <div class="rb-stc-board-list" id="rb-stcBoardList">
              <div class="rb-stc-status">Looking for Uncraft…</div>
            </div>
            <div class="rb-stc-new-board" id="rb-stcNewBoardRow" hidden>
              <input type="text" class="rb-stc-input" id="rb-stcNewBoardName" placeholder="Board name" maxlength="120">
              <button type="button" class="rb-btn rb-btn-outline rb-btn-sm" id="rb-stcCreateBoard">
                <span class="rb-btn-label">Create</span>
              </button>
            </div>
          </div>

          <div class="rb-stc-actions">
            <button type="button" class="rb-btn rb-btn-primary rb-btn-full" id="rb-stcSend" disabled>
              <span class="rb-btn-label">Send to canvas</span>
            </button>
            <p class="rb-stc-status-msg" id="rb-stcStatus" hidden></p>
            <a id="rb-stcOpenCanvas" class="rb-stc-followlink" hidden target="_blank" rel="noopener">Open canvas →</a>
            <a id="rb-stcSignin" class="rb-stc-followlink" hidden target="_blank" rel="noopener">Sign in to Uncraft →</a>
          </div>
        </div>
      </div>

      <!-- Settings -->
      <div class="rb-view" id="rb-viewSettings">
        <div class="rb-settings-header">
          <button type="button" class="rb-back" id="rb-settingsBack">${BACK_SVG}</button>
          <h2 class="rb-settings-title">Settings</h2>
        </div>
        <div class="rb-content-scroll">
          <!-- Quick Setup shortcut -->
          <div class="rb-preset" id="rb-settingsQuickSetup">
            <div class="rb-preset-row">
              <div class="rb-preset-body">
                <div class="rb-preset-top"><span class="rb-preset-name">Preset Assist</span></div>
                <div class="rb-preset-desc">Quick setup with recommended presets</div>
              </div>
              <span class="rb-preset-arrow">${ARROW_RIGHT_SVG}</span>
            </div>
          </div>

          <form class="rb-settings-form" id="rb-settingsForm" style="padding-top:14px">
            <div class="rb-field-group-label">AI Description</div>
            <div class="rb-field">
              <label>Provider</label>
              <select id="rb-apiProvider">
                <option value="gemini">Google Gemini (Free)</option>
                <option value="ollama">Ollama (Local/Offline)</option>
                <option value="openai">OpenAI (GPT-4o)</option>
                <option value="anthropic">Anthropic (Claude)</option>
              </select>
            </div>
            <div class="rb-field" id="rb-legacyApiKeyField" hidden>
              <label>API Key (legacy)</label>
              <div class="rb-field-row">
                <input type="password" id="rb-apiKey" placeholder="AIza... / sk-... / sk-ant-...">
                <button type="button" class="rb-key-toggle" id="rb-toggleKey">Show</button>
              </div>
            </div>
            <fieldset class="rb-field-group" id="rb-apiKeyField" style="border:1px solid var(--rb-border, rgba(255,255,255,0.12));border-radius:10px;padding:12px;margin:8px 0;">
              <legend style="padding:0 6px;font-size:11px;opacity:0.7">API Keys (per provider)</legend>
              <div class="rb-field">
                <label>Gemini API key</label>
                <div class="rb-field-row">
                  <input type="password" id="rb-geminiKey" placeholder="AIza...">
                  <button type="button" class="rb-key-toggle" data-key-target="rb-geminiKey">Show</button>
                </div>
              </div>
              <div class="rb-field">
                <label>Anthropic API key (Claude Sonnet/Opus)</label>
                <div class="rb-field-row">
                  <input type="password" id="rb-anthropicKey" placeholder="sk-ant-...">
                  <button type="button" class="rb-key-toggle" data-key-target="rb-anthropicKey">Show</button>
                </div>
              </div>
              <div class="rb-field" style="opacity:0.55">
                <label>Cursor Composer 2 (coming soon — no public API yet)</label>
                <div class="rb-field-row">
                  <input type="password" id="rb-composerKey" placeholder="reserved for future" disabled>
                  <button type="button" class="rb-key-toggle" data-key-target="rb-composerKey" disabled>Show</button>
                </div>
              </div>
            </fieldset>
            <div class="rb-field">
              <label>Model</label>
              <select id="rb-model">
                <optgroup label="Google Gemini">
                  <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro (latest)</option>
                  <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                  <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                  <option value="gemini-2.5-flash-lite">Gemini 2.5 Flash Lite</option>
                  <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                  <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
                  <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
                </optgroup>
                <optgroup label="Anthropic">
                  <option value="claude-opus-4-7">Claude Opus 4.7</option>
                  <option value="claude-opus-4-6">Claude Opus 4.6</option>
                  <option value="claude-opus-4-5">Claude Opus 4.5</option>
                  <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
                  <option value="claude-sonnet-4-5">Claude Sonnet 4.5</option>
                  <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
                </optgroup>
              </select>
            </div>
            <div class="rb-key-hint" id="rb-keyModelHint" hidden></div>
            <div class="rb-field" id="rb-ollamaField" style="display:none">
              <label>Ollama URL</label>
              <input type="text" id="rb-ollamaUrl" placeholder="http://localhost:11434">
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

            <div class="rb-settings-divider"></div>
            <div class="rb-field-group-label">Design Tool</div>
            <div class="rb-field">
              <label>Target</label>
              <select id="rb-designTool">
                <option value="figma">Figma</option>
                <option value="sketch">Sketch</option>
                <option value="pencil">Pencil</option>
                <option value="paper">Paper</option>
              </select>
            </div>

            <div class="rb-settings-divider"></div>
            <div class="rb-field-group-label">Preferences</div>
            <div class="rb-field">
              <label>Language</label>
              <select id="rb-language">
                <option value="en">English</option>
                <option value="pt">Portugues (BR)</option>
                <option value="es">Espanol</option>
              </select>
            </div>

            <button type="submit" class="rb-gen-solid" style="width:100%;margin-top:8px">Save</button>
            <div class="rb-status" id="rb-status"></div>

            <div class="rb-settings-divider" style="margin-top:8px"></div>
            <div class="rb-field-group-label">Account</div>
            <div class="rb-field">
              <label>Plan</label>
              <div style="display:flex;align-items:center;justify-content:space-between">
                <span style="font-size:13px;color:var(--rb-fg)">Free</span>
                <button type="button" class="rb-pill" id="rb-upgradePlan" style="font-size:10px">Upgrade to Pro</button>
              </div>
            </div>
            <div class="rb-field">
              <label>Auth Token</label>
              <div class="rb-field-row">
                <input type="password" id="rb-authToken" placeholder="Paste from dashboard...">
              </div>
            </div>
          </form>
        </div>
      </div>

      <!-- Quick Setup Wizard -->
      <div class="rb-view" id="rb-viewWizard">
        <div class="rb-settings-header">
          <button type="button" class="rb-back" id="rb-wizardBack">${BACK_SVG}</button>
          <h2 class="rb-settings-title">Preset Assist</h2>
        </div>
        <div class="rb-wizard">
          <div class="rb-wizard-scroll" id="rb-wizardPresets"></div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(panel);

  // --- State ---
  let currentStep = 0;
  let currentMode = 'dark';
  const MODEL_DEFAULTS = { gemini: 'gemini-3.1-pro-preview', ollama: 'moondream', openai: 'gpt-4o', anthropic: 'claude-sonnet-4-6' };
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
  let previousView = 'main';
  function showView(name) {
    const current = panel.querySelector('.rb-view.rb-active');
    if (current) previousView = current.id.replace('rb-view', '').toLowerCase();
    $$('.rb-view').forEach(v => v.classList.remove('rb-active'));
    const target = $(`#rb-view${name.charAt(0).toUpperCase() + name.slice(1)}`);
    if (target) target.classList.add('rb-active');
    // Toggle gray background for settings/wizard
    panel.classList.toggle('rb-settings-active', name === 'settings' || name === 'wizard');
  }

  // --- Onboarding ---
  const slides = $$('.rb-slide');
  const dots = $$('.rb-dot');

  function updateSlides() {
    slides.forEach((s, i) => s.hidden = i !== currentStep);
    dots.forEach((d, i) => d.classList.toggle('active', i === currentStep));
    const nextLabel = $('#rb-next .rb-motion-label');
    if (nextLabel) nextLabel.textContent = currentStep === 2 ? 'get started' : 'next';
  }

  $('#rb-next').addEventListener('click', () => {
    if (currentStep < 2) { currentStep++; updateSlides(); }
    else { chrome.storage.sync.set({ onboardingDone: true }); showView('main'); loadContent(); analyzeSite(); }
  });
  $('#rb-skip').addEventListener('click', () => {
    chrome.storage.sync.set({ onboardingDone: true }); showView('main'); loadContent(); analyzeSite();
  });

  // --- Mode toggle ---
  function applyMode(mode) {
    currentMode = mode;
    panel.classList.toggle('rb-light', mode === 'light');
    panel.classList.remove('rb-expanded');
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
  $('#rb-settingsBack').addEventListener('click', () => {
    if (previousView === 'wizard') { showWizard(); } else { showView('main'); }
  });
  $('#rb-settingsQuickSetup').addEventListener('click', () => goToWizard());

  // --- Quick Setup Wizard ---
  $('#rb-wizardBack').addEventListener('click', () => showView('main'));

  const PRESETS = [
    { id: 'free', name: 'Zero Setup', badge: 'Free', badgePaid: false, costLevel: 0,
      desc: 'Google Gemini for everything. One key, zero cost.',
      keys: '1 key: Google API',
      describer: 'gemini', generator: 'gemini',
      speed: 4, quality: 3, intelligence: 4 },
    { id: 'openai', name: 'OpenAI All-in-One', badge: '1 key', badgePaid: true, costLevel: 2,
      desc: 'GPT-4o describes, DALL-E generates. Same API key.',
      keys: '1 key: OpenAI',
      describer: 'openai', generator: 'openai',
      speed: 3, quality: 4, intelligence: 5 },
    { id: 'pro', name: 'Pro Quality', badge: 'Best results', badgePaid: true, costLevel: 2,
      desc: 'Gemini describes (free), Stability AI generates (best quality).',
      keys: '2 keys: Google + Stability AI',
      describer: 'gemini', generator: 'stability',
      speed: 3, quality: 5, intelligence: 4 },
    { id: 'offline', name: 'Offline', badge: '100% local', badgePaid: false, costLevel: 0,
      desc: 'Ollama runs on your machine. No internet, no API keys.',
      keys: '0 keys (requires Ollama installed)',
      describer: 'ollama', generator: null,
      speed: 2, quality: 2, intelligence: 3 },
    { id: 'custom', name: 'Custom', badge: 'Advanced', badgePaid: true, costLevel: -1,
      desc: 'Mix and match providers. Full control.',
      keys: 'You choose',
      describer: null, generator: null,
      speed: 0, quality: 0, intelligence: 0 }
  ];

  function showWizard() {
    showView('wizard');
    const container = $('#rb-wizardPresets');
    if (!container) return;
    container.innerHTML = '';

    PRESETS.forEach(p => {
      const card = document.createElement('div');
      card.className = 'rb-preset';
      const hasBars = p.speed > 0;
      card.innerHTML = `
        <div class="rb-preset-row">
          <div class="rb-preset-body">
            <div class="rb-preset-top">
              <span class="rb-preset-name">${esc(p.name)}</span>
              ${hasBars ? `<span class="rb-preset-info">i
                <div class="rb-preset-tip" hidden>
                  <div class="rb-tip-cost">${renderCost(p.costLevel)}</div>
                  <div class="rb-tip-row"><span class="rb-tip-label">Speed</span><div class="rb-tip-bar">${renderBar(p.speed)}</div></div>
                  <div class="rb-tip-row"><span class="rb-tip-label">Quality</span><div class="rb-tip-bar">${renderBar(p.quality)}</div></div>
                  <div class="rb-tip-row"><span class="rb-tip-label">Intelligence</span><div class="rb-tip-bar">${renderBar(p.intelligence)}</div></div>
                </div>
              </span>` : ''}
              ${p.badge ? `<span class="rb-preset-badge ${p.badgePaid ? 'rb-badge-paid' : ''}">${esc(p.badge)}</span>` : ''}
            </div>
            <div class="rb-preset-desc">${esc(p.desc)}</div>
            ${p.keys ? `<div class="rb-preset-keys">${esc(p.keys)}</div>` : ''}
          </div>
          <span class="rb-preset-arrow">${ARROW_RIGHT_SVG}</span>
        </div>
      `;

      // Select preset
      card.addEventListener('click', (e) => {
        if (e.target.closest('.rb-preset-info')) return;
        if (p.id === 'custom') {
          showView('settings'); loadSettings();
          return;
        }
        const settings = { apiProvider: p.describer };
        if (p.describer === 'ollama') {
          settings.ollamaUrl = 'http://localhost:11434';
        }
        chrome.storage.sync.set(settings, () => {
          if (p.describer !== 'ollama') {
            showView('settings'); loadSettings();
          } else {
            showView('main'); loadContent();
          }
        });
      });

      container.appendChild(card);
    });
  }

  function renderBar(level) {
    let html = '';
    for (let i = 0; i < 5; i++) {
      html += `<span class="rb-tip-dot ${i < level ? 'rb-tip-filled' : ''}"></span>`;
    }
    return html;
  }

  function renderCost(level) {
    if (level <= 0) return `<span class="rb-cost-active">FREE</span>`;
    let html = '';
    for (let i = 0; i < 3; i++) {
      html += `<span class="${i < level ? 'rb-cost-active' : 'rb-cost-dim'}">$</span>`;
    }
    return html;
  }

  // Global helper to show wizard from anywhere
  function goToWizard() { showWizard(); }

  // Legacy single-key field toggle (still here for migration display, hidden by default).
  $('#rb-toggleKey')?.addEventListener('click', () => {
    const inp = $('#rb-apiKey');
    if (!inp) return;
    inp.type = inp.type === 'password' ? 'text' : 'password';
    $('#rb-toggleKey').textContent = inp.type === 'password' ? 'Show' : 'Hide';
  });

  // Per-provider key show/hide toggles.
  panel.querySelectorAll('.rb-key-toggle[data-key-target]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const inp = panel.querySelector('#' + btn.getAttribute('data-key-target'));
      if (!inp) return;
      if (inp.type === 'password') { inp.type = 'text'; btn.textContent = 'Hide'; }
      else { inp.type = 'password'; btn.textContent = 'Show'; }
    });
  });

  // ─── Panel toast (replaces 2s text flash) ─────────────────────────────────
  // Floats at the top of the widget itself (not the page) so it can't escape
  // into the host site. Auto-dismisses for success, persists for error so the
  // user can copy the failure message before clearing.
  function getPanelToastHost() {
    let host = panel.querySelector('#rb-panel-toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'rb-panel-toast-host';
      host.className = 'rb-panel-toast-host';
      panel.appendChild(host);
    }
    return host;
  }
  function showPanelToast(message, kind) {
    const host = getPanelToastHost();
    const toast = document.createElement('div');
    toast.className = 'rb-panel-toast rb-panel-toast-' + (kind === 'error' ? 'error' : 'success');
    const iconWrap = document.createElement('span');
    iconWrap.className = 'rb-panel-toast-icon';
    iconWrap.innerHTML = kind === 'error'
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>';
    const text = document.createElement('span');
    text.className = 'rb-panel-toast-text';
    text.textContent = message;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'rb-panel-toast-close';
    close.setAttribute('aria-label', 'Dismiss');
    close.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    close.addEventListener('click', () => { if (toast.parentNode) toast.remove(); });
    toast.appendChild(iconWrap);
    toast.appendChild(text);
    toast.appendChild(close);
    host.appendChild(toast);
    if (kind !== 'error') {
      setTimeout(() => { if (toast.parentNode) toast.remove(); }, 5000);
    }
    return toast;
  }

  // Cross-check between selected model and configured per-provider keys.
  // background.js modeERebuild routes by model NAME, not by the apiProvider
  // select — so a saved Anthropic key is silently ignored if the model is
  // Gemini. This hint surfaces that mismatch BEFORE the user runs Mode E.
  function updateKeyModelHint() {
    const hint = $('#rb-keyModelHint');
    if (!hint) return;
    const modelEl = $('#rb-model');
    const model = modelEl ? (modelEl.value || '').trim() : '';
    const hasGemini = !!($('#rb-geminiKey') && $('#rb-geminiKey').value.trim());
    const hasAnthropic = !!($('#rb-anthropicKey') && $('#rb-anthropicKey').value.trim());
    const isClaude = /^(claude|opus)/i.test(model);
    const isGemini = /^gemini/i.test(model);
    let message = '';
    let kind = 'amber';
    if (isClaude && !hasAnthropic) {
      message = 'Model "' + model + '" needs an Anthropic key — paste your sk-ant-... above before saving.';
      kind = 'error';
    } else if (isGemini && !hasGemini) {
      message = 'Model "' + model + '" needs a Gemini key — paste your AIza... above before saving.';
      kind = 'error';
    } else if (isGemini && hasAnthropic && hasGemini) {
      message = 'Anthropic key is saved but the active model is Gemini — the Anthropic key won\'t be used. Switch model to claude-* / opus-* to actually call Anthropic.';
    } else if (isClaude && hasGemini && hasAnthropic) {
      message = 'Gemini key is saved but the active model is Claude/Opus — the Gemini key won\'t be used until you switch the model.';
    }
    if (message) {
      hint.textContent = message;
      hint.classList.toggle('rb-key-hint-error', kind === 'error');
      hint.hidden = false;
    } else {
      hint.hidden = true;
    }
  }

  $('#rb-apiProvider').addEventListener('change', () => {
    const p = $('#rb-apiProvider').value;
    const isOllama = p === 'ollama';
    $('#rb-ollamaField').style.display = isOllama ? '' : 'none';
    $('#rb-apiKeyField').style.display = isOllama ? 'none' : '';
    const cur = $('#rb-model').value;
    if (!cur || Object.values(MODEL_DEFAULTS).includes(cur)) $('#rb-model').value = MODEL_DEFAULTS[p];
    updateKeyModelHint();
  });

  // Re-evaluate the hint on model change OR either key change so it tracks
  // the user's actual edits (not just on save).
  $('#rb-model').addEventListener('change', updateKeyModelHint);
  $('#rb-geminiKey').addEventListener('input', updateKeyModelHint);
  $('#rb-anthropicKey').addEventListener('input', updateKeyModelHint);

  $('#rb-settingsForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const provider = $('#rb-apiProvider').value;
    const geminiKey = $('#rb-geminiKey').value.trim();
    const anthropicKey = $('#rb-anthropicKey').value.trim();
    const composerKey = $('#rb-composerKey').value.trim();
    const legacyKey = ($('#rb-apiKey')?.value || '').trim();

    // Mirror the popup's behavior: keep legacy `apiKey` in sync with the
    // active provider's key so any older code path that still reads `apiKey`
    // keeps working without per-call rewrites. Backend handlers prefer the
    // per-provider key when present, but fall back to apiKey otherwise.
    let activeKey = '';
    if (provider === 'anthropic') activeKey = anthropicKey;
    else if (provider === 'gemini') activeKey = geminiKey;
    else activeKey = legacyKey;

    chrome.storage.sync.set({
      apiProvider: provider,
      apiKey: activeKey,
      geminiKey: geminiKey,
      anthropicKey: anthropicKey,
      composerKey: composerKey,
      model: $('#rb-model').value.trim() || MODEL_DEFAULTS[provider],
      designTool: $('#rb-designTool').value,
      ollamaUrl: $('#rb-ollamaUrl').value.trim() || 'http://localhost:11434',
      language: $('#rb-language').value,
      stabilityApiKey: $('#rb-stabilityKey').value.trim(),
      replicateApiKey: $('#rb-replicateKey').value.trim(),
      authToken: ($('#rb-authToken')?.value || '').trim()
    }, () => {
      if (chrome.runtime.lastError) {
        showPanelToast('Save failed — ' + chrome.runtime.lastError.message, 'error');
        return;
      }
      const savedBits = [];
      if (anthropicKey) savedBits.push('Anthropic key');
      if (geminiKey) savedBits.push('Gemini key');
      savedBits.push('provider: ' + provider);
      if ($('#rb-model').value) savedBits.push('model: ' + $('#rb-model').value);
      showPanelToast('Settings saved — ' + savedBits.join(', '), 'success');
    });
  });

  function loadSettings() {
    chrome.storage.sync.get({
      apiProvider: 'gemini', apiKey: '', geminiKey: '', anthropicKey: '', composerKey: '',
      model: 'gemini-3.1-pro-preview',
      designTool: 'figma', ollamaUrl: 'http://localhost:11434', language: 'en',
      stabilityApiKey: '', replicateApiKey: '', authToken: ''
    }, (s) => {
      $('#rb-apiProvider').value = s.apiProvider;
      $('#rb-apiKey').value = s.apiKey;

      // Migrate legacy `apiKey` into per-provider slots by prefix on first
      // load. After that, per-provider keys are the source of truth.
      let geminiKey = s.geminiKey || '';
      let anthropicKey = s.anthropicKey || '';
      const composerKey = s.composerKey || '';
      if (s.apiKey) {
        if (!geminiKey && s.apiKey.startsWith('AIza')) geminiKey = s.apiKey;
        if (!anthropicKey && s.apiKey.startsWith('sk-ant-')) anthropicKey = s.apiKey;
      }
      $('#rb-geminiKey').value = geminiKey;
      $('#rb-anthropicKey').value = anthropicKey;
      $('#rb-composerKey').value = composerKey;

      // The model field is now a <select>; setting .value picks the matching
      // option if present, or falls back silently to no selection if the
      // saved model isn't in the option list (rare, but possible after model
      // pruning). Default to the active provider's MODEL_DEFAULTS in that
      // case so the dropdown isn't blank.
      const modelSel = $('#rb-model');
      modelSel.value = s.model;
      if (!modelSel.value) modelSel.value = MODEL_DEFAULTS[s.apiProvider] || MODEL_DEFAULTS.gemini;

      $('#rb-designTool').value = s.designTool;
      $('#rb-ollamaUrl').value = s.ollamaUrl;
      $('#rb-language').value = s.language;
      $('#rb-stabilityKey').value = s.stabilityApiKey;
      $('#rb-replicateKey').value = s.replicateApiKey;
      const authField = $('#rb-authToken');
      if (authField) authField.value = s.authToken;
      $('#rb-ollamaField').style.display = s.apiProvider === 'ollama' ? '' : 'none';
      $('#rb-apiKeyField').style.display = s.apiProvider === 'ollama' ? 'none' : '';
      updateKeyModelHint();
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
    if (currentMode === 'light') { refreshApiPill(); loadPageImages(); loadPrompts(); }
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
        if (!items.length) { c.innerHTML = ''; c.style.display = 'none'; return; }
        c.style.display = '';
        const siteAnalysis = $('#rb-siteAnalysis');
        if (siteAnalysis) siteAnalysis.style.display = 'none';
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

    // Bouncing dots loader — fade out after analysis
    const analysisDuration = 800 + Math.random() * 600;
    setTimeout(() => {
      loader.classList.add('rb-fade-out');
      setTimeout(() => showResult(), 600);
    }, analysisDuration);

    // Store image count for later use in Image Remix tab
    panel._pageImageCount = images;

    function showResult() {
      loader.style.display = 'none';

      let message = '';
      if (known) {
        message = `This page looks cool.<br><em>${esc(known.label)}.</em> Start from here?`;
      } else if (siteType === 'portfolio') {
        message = `This page looks cool.<br><em>Start</em> from here?`;
      } else if (siteType === 'e-commerce') {
        message = `This page looks cool.<br><em>Start</em> from here?`;
      } else if (siteType === 'visual-heavy') {
        message = `This page looks cool.<br><em>Start</em> from here?`;
      } else {
        message = `This page looks cool.<br><em>Start</em> from here?`;
      }

      msg.innerHTML = `<span class="rb-site-domain">${esc(domain)}</span><span class="rb-site-tagline">${message}</span>`;
      remixBtn.style.display = '';
    }

    remixBtn.addEventListener('click', () => {
      window.__rbEditorActive = false;
      chrome.runtime.sendMessage({ action: 'toggleEditor' }, () => {
        if (chrome.runtime.lastError) { /* ignore */ }
        panel.remove();
      });
    });

    function showConnectState() {
      const center = panel.querySelector('.rb-site-analysis-center');
      if (!center) return;

      center.innerHTML = `
        <div class="rb-connect">
          <h3 class="rb-connect-title">Almost there.</h3>
          <p class="rb-connect-sub">Connect an API to send layouts to your design tool.</p>

          <div class="rb-connect-tools">
            <button type="button" class="rb-connect-tool" data-tool="figma">
              <span class="rb-connect-tool-icon">${LOGO_FIGMA}</span>
              <span class="rb-connect-tool-name">Figma</span>
              <span class="rb-connect-tool-status"><span class="rb-status-dot rb-dot-red"></span> connect</span>
            </button>
            <button type="button" class="rb-connect-tool" data-tool="sketch">
              <span class="rb-connect-tool-icon">${LOGO_SKETCH}</span>
              <span class="rb-connect-tool-name">Sketch</span>
              <span class="rb-connect-tool-status"><span class="rb-status-dot rb-dot-red"></span> connect</span>
            </button>
            <button type="button" class="rb-connect-tool" data-tool="pencil">
              <span class="rb-connect-tool-icon">${LOGO_PENCIL}</span>
              <span class="rb-connect-tool-name">Pencil</span>
              <span class="rb-connect-tool-status"><span class="rb-status-dot rb-dot-red"></span> connect</span>
            </button>
            <button type="button" class="rb-connect-tool" data-tool="paper">
              <span class="rb-connect-tool-icon">${LOGO_PAPER}</span>
              <span class="rb-connect-tool-name">Paper</span>
              <span class="rb-connect-tool-status"><span class="rb-status-dot rb-dot-red"></span> connect</span>
            </button>
          </div>

          <button type="button" class="rb-gen-solid" style="width:100%;margin-top:8px" id="rb-connectQuickSetup">Quick Setup</button>
        </div>
      `;

      // Connect tool buttons → go to settings
      center.querySelectorAll('.rb-connect-tool').forEach(btn => {
        btn.addEventListener('click', () => {
          showView('settings');
          loadSettings();
        });
      });
      const qsBtn = center.querySelector('#rb-connectQuickSetup');
      if (qsBtn) qsBtn.addEventListener('click', () => goToWizard());

      // Local export buttons
      const exportSvg = center.querySelector('#rb-exportSvg');
      const exportPng = center.querySelector('#rb-exportPng');
      if (exportSvg) exportSvg.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'exportCurrentPage', format: 'svg' });
        exportSvg.textContent = 'Exporting...';
      });
      if (exportPng) exportPng.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'exportCurrentPage', format: 'png' });
        exportPng.textContent = 'Exporting...';
      });
    }
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
      grid.innerHTML = '<div class="rb-empty-bounce-wrap"><div class="rb-empty-bounce"></div><p class="rb-empty-bounce-label">Nenhuma imagem aqui :(</p></div>';
      return;
    }

    const totalImgs = panel._pageImageCount || allImgs.length;
    const countEl = $('#rb-imgCount');
    if (countEl) countEl.innerHTML = `<span class="rb-img-count">${totalImgs}</span> image${totalImgs !== 1 ? 's' : ''} found`;
    grid.innerHTML = '';
    top.forEach(img => {
      const item = document.createElement('div');
      item.className = 'rb-img-item';
      item.innerHTML = `
        <img src="${esc(img.src)}" alt="${esc(img.alt)}" loading="lazy"/>
        <div class="rb-img-overlay">
          <button class="rb-img-remix" data-src="${esc(img.src)}">Repix</button>
        </div>
      `;
      // Click to remix this specific image
      item.querySelector('.rb-img-remix').addEventListener('click', (e) => {
        e.stopPropagation();
        const btn = e.target;
        btn.textContent = 'Repixing...';
        btn.disabled = true;
        chrome.runtime.sendMessage({ action: 'describeImage', imageUrl: img.src });
      });
      grid.appendChild(item);
    });
  }

  // ─── API Pill (Image Remix header) ────────────────────────────────────

  const AI_PROVIDERS = [
    { id: 'gemini', name: 'Google Gemini', keyField: 'apiKey', requireProvider: 'gemini' },
    { id: 'openai', name: 'OpenAI', keyField: 'apiKey', requireProvider: 'openai' },
    { id: 'anthropic', name: 'Anthropic', keyField: 'apiKey', requireProvider: 'anthropic' },
    { id: 'ollama', name: 'Ollama (Local)', keyField: null, noKey: true }
  ];

  function refreshApiPill() {
    chrome.storage.sync.get({ apiKey: '', apiProvider: 'gemini', stabilityApiKey: '', replicateApiKey: '' }, (s) => {
      const pill = $('#rb-apiPill');
      const dot = $('#rb-apiPillDot');
      const label = $('#rb-apiPillLabel');
      if (!pill) return;

      const hasKey = !!(s.apiKey) || s.apiProvider === 'ollama';
      if (hasKey) {
        const prov = AI_PROVIDERS.find(p => p.id === s.apiProvider);
        if (dot) { dot.className = 'rb-status-dot rb-dot-green'; }
        if (label) { label.textContent = prov ? prov.name : s.apiProvider; }
        // Also update the image gen provider to match
        activeGenProvider = s.apiProvider === 'openai' ? 'openai' : (s.apiProvider === 'gemini' ? 'gemini' : 'stability');
      } else {
        if (dot) { dot.className = 'rb-status-dot rb-dot-red'; }
        if (label) { label.textContent = 'connect API'; }
      }
    });
  }

  (function initApiPill() {
    const pill = $('#rb-apiPill');
    const dropdown = $('#rb-apiDropdown');
    if (!pill || !dropdown) return;

    pill.addEventListener('click', () => {
      if (dropdown.hidden) {
        chrome.storage.sync.get({ apiKey: '', apiProvider: 'gemini' }, (s) => {
          const hasKey = !!(s.apiKey) || s.apiProvider === 'ollama';
          dropdown.innerHTML = '';

          AI_PROVIDERS.forEach(p => {
            const isActive = s.apiProvider === p.id && hasKey;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'rb-gen-provider-option' + (isActive ? ' rb-provider-active' : '');
            btn.innerHTML = `
              <span class="rb-status-dot ${isActive ? 'rb-dot-green' : 'rb-dot-red'}"></span>
              <span class="rb-gen-provider-option-name">${esc(p.name)}</span>
              <span class="rb-provider-status">${isActive ? 'active' : 'connect'}</span>
            `;
            btn.addEventListener('click', () => {
              if (!isActive) { showView('settings'); loadSettings(); }
              dropdown.hidden = true;
            });
            dropdown.appendChild(btn);
          });

          // Check if all are exhausted (unlikely but handle)
          const allConnected = AI_PROVIDERS.every(p => {
            if (p.noKey) return s.apiProvider === 'ollama';
            return !!(s.apiKey) && s.apiProvider === p.id;
          });
          if (!allConnected) {
            const addMore = document.createElement('button');
            addMore.type = 'button';
            addMore.className = 'rb-gen-provider-option';
            addMore.innerHTML = '<span class="rb-gen-provider-option-name" style="color:var(--rb-fg-muted)">+ Add more</span>';
            addMore.addEventListener('click', () => { showView('settings'); loadSettings(); dropdown.hidden = true; });
            dropdown.appendChild(addMore);
          }

          dropdown.hidden = false;
        });
      } else {
        dropdown.hidden = true;
      }
    });

    document.addEventListener('click', (e) => {
      if (!pill.contains(e.target) && !dropdown.contains(e.target)) dropdown.hidden = true;
    });
  })();

  // ─── Image Generation Card ─────────────────────────────────────────────

  const IMG_PROVIDERS = [
    { id: 'stability', name: 'Stability AI', keyField: 'stabilityApiKey', keyType: 'own' },
    { id: 'openai', name: 'OpenAI DALL-E', keyField: 'apiKey', keyType: 'shared', requireProvider: 'openai' },
    { id: 'gemini', name: 'Gemini Imagen', keyField: 'apiKey', keyType: 'shared', requireProvider: 'gemini' },
    { id: 'replicate', name: 'Replicate', keyField: 'replicateApiKey', keyType: 'own' },
    { id: 'ollama', name: 'Ollama (Local)', keyField: null, keyType: 'none', comingSoon: true }
  ];

  let activeGenProvider = 'stability';

  // Pretty-print a JSON key for display
  function humanizeKey(key) {
    return key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
  }

  function buildGenCard(promptText, messageData) {
    const container = $('#rb-genCardContainer');
    if (!container) return;

    const jsonData = messageData?.structuredJson || messageData?.metadata || { style: 'photorealistic', aspectRatio: '1:1' };
    const sourceImg = messageData?.imageUrl || '';
    const providerName = messageData?.provider || 'gemini';
    const providerLabel = { gemini: 'Gemini', openai: 'ChatGPT', anthropic: 'Claude', ollama: 'Ollama' }[providerName] || providerName;

    // Mutable copy of JSON for editing
    const editableJson = JSON.parse(JSON.stringify(jsonData));

    container.innerHTML = '';
    panel.classList.add('rb-expanded');

    const card = document.createElement('div');
    card.className = 'rb-gen-card rb-repix-output';

    // Category display names
    const CATEGORY_LABELS = {
      subject: 'Subject', environment: 'Environment', style: 'Style',
      color: 'Color', mood: 'Mood', camera: 'Camera',
      lighting: 'Lighting', technical: 'Technical'
    };

    // Build categorized editor HTML
    function buildEditorHTML(obj) {
      let html = '';
      for (const [catKey, catVal] of Object.entries(obj)) {
        if (typeof catVal === 'object' && catVal !== null && !Array.isArray(catVal)) {
          // This is a category with sub-fields
          const label = CATEGORY_LABELS[catKey] || humanizeKey(catKey);
          html += `<div class="rb-json-category" data-cat="${esc(catKey)}">`;
          html += `<div class="rb-json-cat-title">${esc(label)}</div>`;
          html += `<div class="rb-json-cat-fields">`;
          for (const [fieldKey, fieldVal] of Object.entries(catVal)) {
            html += `<div class="rb-json-field">`;
            html += `<div class="rb-json-key">${esc(humanizeKey(fieldKey))}</div>`;
            html += `<div class="rb-json-values">`;
            if (Array.isArray(fieldVal)) {
              fieldVal.forEach((item, i) => {
                const isColor = /^#[0-9a-fA-F]{3,8}$/.test(String(item));
                const cls = isColor ? 'rb-json-pill rb-color-pill' : 'rb-json-pill';
                const style = isColor ? ` style="--rb-swatch-color:${esc(String(item))}"` : '';
                html += `<span class="${cls}" contenteditable="true" data-cat="${esc(catKey)}" data-key="${esc(fieldKey)}" data-index="${i}"${style}>${esc(String(item))}</span>`;
              });
            } else {
              const sv = String(fieldVal);
              const isColor = /^#[0-9a-fA-F]{3,8}$/.test(sv);
              const cls = isColor ? 'rb-json-pill rb-color-pill' : 'rb-json-pill';
              const style = isColor ? ` style="--rb-swatch-color:${esc(sv)}"` : '';
              html += `<span class="${cls}" contenteditable="true" data-cat="${esc(catKey)}" data-key="${esc(fieldKey)}"${style}>${esc(sv)}</span>`;
            }
            html += `</div></div>`;
          }
          html += `</div></div>`;
        } else {
          // Flat field (fallback for non-categorized JSON)
          html += `<div class="rb-json-field">`;
          html += `<div class="rb-json-key">${esc(humanizeKey(catKey))}</div>`;
          html += `<div class="rb-json-values">`;
          if (Array.isArray(catVal)) {
            catVal.forEach((item, i) => {
              html += `<span class="rb-json-pill" contenteditable="true" data-key="${esc(catKey)}" data-index="${i}">${esc(String(item))}</span>`;
            });
          } else {
            html += `<span class="rb-json-pill" contenteditable="true" data-key="${esc(catKey)}">${esc(String(catVal))}</span>`;
          }
          html += `</div></div>`;
        }
      }
      return html;
    }

    // Hide image grid and old prompt cards when showing Smart Remix result
    const imgGrid = $('#rb-imgGrid');
    if (imgGrid) imgGrid.style.display = 'none';
    const imgRowHeader = panel.querySelector('.rb-img-row-header');
    if (imgRowHeader) imgRowHeader.style.display = 'none';
    const promptsList = $('#rb-promptsList');
    if (promptsList) promptsList.style.display = 'none';

    card.innerHTML = `
      ${sourceImg ? `
      <div class="rb-smart-img-wrap">
        <img class="rb-smart-img" src="${esc(sourceImg)}" alt="Source"/>
        <a class="rb-smart-provider-pill" id="rb-editInProvider" href="#" title="Continue editing">edit in ${esc(providerLabel)}</a>
      </div>
      ` : ''}

      <div class="rb-json-editor-title">Edit Live</div>
      <div class="rb-json-tooltip" id="rb-jsonTooltip">write over each value</div>
      <div class="rb-json-editor" id="rb-jsonEditor">
        ${buildEditorHTML(editableJson)}
      </div>

      <div class="rb-smart-actions">
        <button type="button" class="rb-copy-mini" id="rb-copyPromptJson">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          copy prompt + json
        </button>
        <button type="button" class="rb-gen-solid" id="rb-genBtn" style="margin-left:auto">
          <span class="rb-motion-arrow">${ARROW_RIGHT_SVG}</span>
          <span class="rb-motion-label">Generate</span>
        </button>
      </div>

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

    // --- Pill editing: sync back to editableJson (supports nested categories) ---
    const tooltip = card.querySelector('#rb-jsonTooltip');
    card.querySelectorAll('.rb-json-pill').forEach(pill => {
      pill.addEventListener('focus', () => {
        if (tooltip) tooltip.classList.add('rb-hidden');
      });
      pill.addEventListener('blur', () => {
        const cat = pill.dataset.cat;
        const key = pill.dataset.key;
        const idx = pill.dataset.index;
        const val = pill.textContent.trim();
        // Determine target object (nested or flat)
        const target = cat && editableJson[cat] ? editableJson[cat] : editableJson;
        if (idx !== undefined && idx !== '') {
          if (Array.isArray(target[key])) target[key][parseInt(idx)] = val;
        } else {
          target[key] = val;
        }
        // Update color swatch if it's a color pill
        if (pill.classList.contains('rb-color-pill') && /^#[0-9a-fA-F]{3,8}$/.test(val)) {
          pill.style.setProperty('--rb-swatch-color', val);
        }
      });
      pill.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); pill.blur(); }
      });
    });

    // --- Copy prompt + json ---
    card.querySelector('#rb-copyPromptJson').addEventListener('click', () => {
      const combined = promptText + '\n\n' + JSON.stringify(editableJson, null, 2);
      navigator.clipboard.writeText(combined).then(() => {
        const btn = card.querySelector('#rb-copyPromptJson');
        const orig = btn.innerHTML;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.innerHTML = orig; }, 1500);
      }).catch(() => {});
    });

    // --- Edit in provider ---
    const editLink = card.querySelector('#rb-editInProvider');
    if (editLink) {
      const providerUrls = {
        gemini: 'https://gemini.google.com/app',
        openai: 'https://chatgpt.com/',
        anthropic: 'https://claude.ai/',
        ollama: '#'
      };
      editLink.addEventListener('click', (e) => {
        e.preventDefault();
        const combined = promptText + '\n\n' + JSON.stringify(editableJson, null, 2);
        navigator.clipboard.writeText(combined).catch(() => {});
        const url = providerUrls[providerName] || providerUrls.gemini;
        if (url !== '#') window.open(url, '_blank');
      });
    }

    // --- Generate (with progressive gate) ---
    const genBtn = card.querySelector('#rb-genBtn');
    genBtn.addEventListener('click', () => {
      // Check if any image generation provider is configured
      chrome.storage.sync.get({ apiKey: '', apiProvider: 'gemini', stabilityApiKey: '', replicateApiKey: '' }, (s) => {
        const hasGen = !!(s.stabilityApiKey) || !!(s.replicateApiKey) ||
          (!!(s.apiKey) && (s.apiProvider === 'openai' || s.apiProvider === 'gemini'));
        if (!hasGen) {
          // Show gate inline below button
          let gate = card.querySelector('.rb-gate');
          if (!gate) {
            gate = document.createElement('div');
            gate.className = 'rb-gate';
            gate.innerHTML = `
              <span class="rb-gate-text">Connect an image provider to generate.</span>
              <button type="button" class="rb-gate-btn" id="rb-gateSetup">Quick Setup</button>
            `;
            genBtn.parentElement.insertAdjacentElement('afterend', gate);
            gate.querySelector('#rb-gateSetup').addEventListener('click', () => goToWizard());
          }
          return;
        }
        const editedPrompt = promptText + '\n\n' + JSON.stringify(editableJson, null, 2);
        startGeneration(editedPrompt);
      });
    });

    // Generate again
    const againBtn = card.querySelector('#rb-genAgain');
    if (againBtn) againBtn.addEventListener('click', () => {
      const editedPrompt = promptText + '\n\n' + JSON.stringify(editableJson, null, 2);
      card.querySelector('#rb-genResult').hidden = true;
      startGeneration(editedPrompt);
    });

    // Download
    const dlBtn = card.querySelector('#rb-genDownload');
    if (dlBtn) dlBtn.addEventListener('click', () => {
      const img = card.querySelector('#rb-genImage');
      if (img?.src) {
        const a = document.createElement('a');
        a.href = img.src; a.download = 'repix-generated.png'; a.click();
      }
    });

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
      $$('.rb-img-remix').forEach(btn => { btn.textContent = 'Repix'; btn.disabled = false; });
      // Show generation card with the prompt + scroll into view
      buildGenCard(message.prompt || '', message);
      loadPrompts();
      // Scroll to the output
      const genContainer = $('#rb-genCardContainer');
      if (genContainer) genContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (message.action === 'promptError') {
      $$('.rb-img-remix').forEach(btn => { btn.textContent = 'Repix'; btn.disabled = false; });
      // Show error inline
      const container = $('#rb-genCardContainer');
      if (container) {
        const errMsg = message.error || 'Something went wrong.';
        const isApiError = errMsg.toLowerCase().includes('api key');
        container.innerHTML = `
          <div class="rb-gen-card">
            ${isApiError ? `
              <h3 class="rb-connect-title" style="font-size:18px;margin-bottom:6px">Connect an AI provider</h3>
              <p class="rb-connect-sub" style="margin-bottom:14px">To reverse-engineer image prompts, connect at least one AI provider.</p>
              <div style="display:flex;gap:8px">
                <button type="button" class="rb-gen-solid" id="rb-errGoSettings">Quick Setup</button>
              </div>
            ` : `
              <div class="rb-gen-error">${esc(errMsg)}</div>
            `}
          </div>
        `;
        const settingsBtn = container.querySelector('#rb-errGoSettings');
        if (settingsBtn) settingsBtn.addEventListener('click', () => goToWizard());
      }
    }
    if (message.action === 'imageGenerated') {
      handleImageGenerated(message.dataUrl);
    }
    if (message.action === 'imageGenError') {
      handleImageGenError(message.error);
    }
    if (message.action === 'captureError') {
      const loader = $('#rb-loader');
      const msg = $('#rb-siteMsg');
      const remixBtn = $('#rb-remixSite');
      if (loader) loader.style.display = 'none';
      if (msg) msg.innerHTML = `<span class="rb-site-domain" style="color:#ef4444">${esc(message.error)}</span>`;
      if (remixBtn) { remixBtn.style.display = ''; remixBtn.textContent = 'Try again'; }
    }
    if (message.action === 'captureSuccess') {
      const loader = $('#rb-loader');
      const msg = $('#rb-siteMsg');
      const remixBtn = $('#rb-remixSite');
      if (loader) loader.style.display = 'none';
      if (msg) msg.innerHTML = '<span class="rb-site-domain" style="color:#22c55e">Captured!</span><span class="rb-site-tagline">Open your design tool plugin to import.</span>';
      if (remixBtn) remixBtn.style.display = 'none';
      loadCaptures();
    }
  });

  // --- Rotating pill animation ---
  (function initPillRotate() {
    const container = $('#rb-pillRotate');
    if (!container) return;
    const words = container.querySelectorAll('.rb-pill-word');
    if (words.length < 2) return;
    let idx = 0;
    setInterval(() => {
      const current = words[idx];
      const next = words[(idx + 1) % words.length];
      current.classList.remove('rb-pill-active');
      current.classList.add('rb-pill-exit');
      next.classList.remove('rb-pill-exit');
      next.classList.add('rb-pill-active');
      setTimeout(() => { current.classList.remove('rb-pill-exit'); }, 400);
      idx = (idx + 1) % words.length;
    }, 2200);
  })();

  // --- Wire footer Quick Setup link ---
  const siteFooter = $('#rb-siteFooter');
  if (siteFooter) siteFooter.addEventListener('click', () => goToWizard());

  // --- Send to canvas (manual capture into a board) ---
  // Discovers the Uncraft web-shell origin (prod → localhost fallback),
  // lists the user's boards via /api/boards, lets the user pick one or
  // create a new one, then POSTs the captured DOM to /api/snapshot/manual.
  // Mirrors the legacy popup.js flow but lives inside the widget so the
  // user never leaves their familiar surface.
  const STC_ORIGIN_STORAGE = 'uncraft.webShellOrigin';
  const STC_CANDIDATES = [
    'https://uncraft.app',
    'http://localhost:3030',
    'http://127.0.0.1:3030'
  ];
  const stcState = {
    origin: null,         // resolved web-shell origin
    boards: [],
    selectedBoardId: null
  };

  function stcSetStatus(text, isError) {
    const el = $('#rb-stcStatus');
    if (!el) return;
    if (!text) { el.hidden = true; el.textContent = ''; el.classList.remove('rb-stc-status-error'); return; }
    el.hidden = false; el.textContent = text;
    el.classList.toggle('rb-stc-status-error', !!isError);
  }
  function stcSetBoardListText(text) {
    const list = $('#rb-stcBoardList');
    if (!list) return;
    list.innerHTML = `<div class="rb-stc-status">${text}</div>`;
  }
  function isCapturableUrl(u) {
    return typeof u === 'string' && /^https?:\/\//i.test(u);
  }

  async function stcDiscoverOrigin() {
    // Try cached origin first, then candidates. We hit /api/boards as
    // the probe — 200 means authed, 401 means reachable-but-not-authed,
    // anything else means try next candidate.
    return new Promise((resolve) => {
      chrome.storage.local.get([STC_ORIGIN_STORAGE], async (cache) => {
        const seed = cache?.[STC_ORIGIN_STORAGE];
        const tryOrder = seed
          ? [seed, ...STC_CANDIDATES.filter((o) => o !== seed)]
          : STC_CANDIDATES;
        for (const origin of tryOrder) {
          try {
            const res = await fetch(`${origin}/api/boards`, { credentials: 'include' });
            if (res.ok) {
              const json = await res.json().catch(() => ({}));
              chrome.storage.local.set({ [STC_ORIGIN_STORAGE]: origin });
              resolve({ origin, boards: json.boards || [] });
              return;
            }
            if (res.status === 401) {
              // Reachable but not signed in — prefer this origin so the
              // sign-in link points at the right host.
              resolve({ origin, boards: [], unauthorized: true });
              return;
            }
          } catch (e) {
            // Unreachable — fall through to the next candidate.
          }
        }
        resolve({ origin: null, boards: [] });
      });
    });
  }

  function stcRenderBoards() {
    const list = $('#rb-stcBoardList');
    if (!list) return;
    if (!stcState.boards.length) {
      list.innerHTML = `<div class="rb-stc-status">No boards yet. Create one below.</div>`;
      return;
    }
    list.innerHTML = '';
    for (const b of stcState.boards) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'rb-stc-board-row';
      row.dataset.boardId = b.id;
      row.innerHTML = `
        <span class="rb-stc-board-name">${(b.name || 'Untitled').replace(/[<>&"]/g, (c) => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]))}</span>
        <span class="rb-stc-board-tick" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </span>`;
      row.addEventListener('click', () => stcSelectBoard(b.id));
      list.appendChild(row);
    }
  }
  function stcSelectBoard(id) {
    stcState.selectedBoardId = id;
    $$('#rb-stcBoardList .rb-stc-board-row').forEach((el) => {
      el.classList.toggle('selected', el.dataset.boardId === id);
    });
    const send = $('#rb-stcSend');
    if (send) send.disabled = !id;
  }

  async function stcLoadTab() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'uncraft.activeTab' }, (resp) => {
        if (chrome.runtime.lastError || !resp?.ok) {
          // Fallback — use document context. activeTab background helper
          // is added below as well; this path covers the case where the
          // widget is opened before the listener is wired during
          // development.
          resolve({ url: location.href, title: document.title, favIconUrl: null });
          return;
        }
        resolve(resp.tab);
      });
    });
  }

  async function stcEnterView() {
    showView('sendToCanvas');
    stcState.selectedBoardId = null;
    $('#rb-stcSend').disabled = true;
    stcSetStatus('');
    $('#rb-stcOpenCanvas').hidden = true;
    $('#rb-stcSignin').hidden = true;
    $('#rb-stcNewBoardRow').hidden = true;

    // Tab meta — title, URL, favicon.
    const tab = await stcLoadTab();
    $('#rb-stcTitle').textContent = tab.title || 'Untitled';
    try {
      const u = new URL(tab.url);
      $('#rb-stcUrl').textContent = u.host + u.pathname.replace(/\/+$/, '');
    } catch { $('#rb-stcUrl').textContent = tab.url || ''; }
    if (tab.favIconUrl) {
      $('#rb-stcFavicon').style.backgroundImage = `url("${tab.favIconUrl.replace(/"/g, '%22')}")`;
    } else {
      $('#rb-stcFavicon').style.backgroundImage = '';
    }

    if (!isCapturableUrl(tab.url)) {
      stcSetStatus("This page can't be captured (browser-internal URL).", true);
      stcSetBoardListText('Open a regular web page to send it to canvas.');
      return;
    }

    stcSetBoardListText('Looking for Uncraft…');
    const disc = await stcDiscoverOrigin();
    stcState.origin = disc.origin;

    if (!disc.origin) {
      stcSetBoardListText('Could not reach Uncraft.');
      stcSetStatus('Open the Uncraft app once (so we can find it), then come back.', true);
      return;
    }
    if (disc.unauthorized) {
      stcSetBoardListText('Sign in to Uncraft to load your boards.');
      $('#rb-stcSignin').href = `${disc.origin}/login`;
      $('#rb-stcSignin').hidden = false;
      return;
    }

    stcState.boards = disc.boards;
    stcRenderBoards();
    $('#rb-stcNewBoardRow').hidden = false;
    // Auto-select the first board so a single click on Send works as
    // expected. The user can still click another to switch.
    if (stcState.boards.length) stcSelectBoard(stcState.boards[0].id);
  }

  async function stcCreateBoard() {
    if (!stcState.origin) return;
    const input = $('#rb-stcNewBoardName');
    const name = (input.value || '').trim();
    if (!name) { input.focus(); return; }
    const createBtn = $('#rb-stcCreateBoard');
    createBtn.disabled = true;
    createBtn.querySelector('.rb-btn-label').textContent = 'Creating…';
    try {
      const res = await fetch(`${stcState.origin}/api/boards`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.board) throw new Error(json?.error || `${res.status}`);
      // Prepend so the new board lands at the top of the list, where
      // the auto-select is already aimed.
      stcState.boards = [json.board, ...stcState.boards];
      input.value = '';
      stcRenderBoards();
      stcSelectBoard(json.board.id);
    } catch (e) {
      stcSetStatus(`Could not create board: ${e?.message || e}`, true);
    } finally {
      createBtn.disabled = false;
      createBtn.querySelector('.rb-btn-label').textContent = 'Create';
    }
  }

  async function stcSend() {
    if (!stcState.selectedBoardId || !stcState.origin) return;
    const send = $('#rb-stcSend');
    send.disabled = true;
    send.querySelector('.rb-btn-label').textContent = 'Capturing…';
    stcSetStatus('');
    try {
      if (typeof window.__uncraftCapturePage !== 'function') {
        throw new Error('Capture helper not present — reload this page first.');
      }
      const cap = await window.__uncraftCapturePage();
      send.querySelector('.rb-btn-label').textContent = 'Sending…';
      const resp = await chrome.runtime.sendMessage({
        action: 'uncraft.manual.send',
        webShellOrigin: stcState.origin,
        boardId: stcState.selectedBoardId,
        url: location.href,
        payload: { html: cap.html, title: cap.title, viewport: cap.viewport }
      });
      if (!resp?.ok) throw new Error(resp?.error || 'send failed');
      send.querySelector('.rb-btn-label').textContent = 'Sent ✓';
      stcSetStatus('Added to your canvas.');
      const openLink = $('#rb-stcOpenCanvas');
      openLink.href = `${stcState.origin}/canvas`;
      openLink.hidden = false;
      // Auto-return to main after a moment so the widget doesn't get
      // stuck on a "done" view.
      setTimeout(() => showView('main'), 2200);
    } catch (e) {
      send.disabled = false;
      send.querySelector('.rb-btn-label').textContent = 'Retry';
      stcSetStatus(String(e?.message || e), true);
    }
  }

  $('#rb-sendCanvas')?.addEventListener('click', () => stcEnterView());
  $('#rb-stcBack')?.addEventListener('click', () => showView('main'));
  $('#rb-stcCreateBoard')?.addEventListener('click', () => stcCreateBoard());
  $('#rb-stcSend')?.addEventListener('click', () => stcSend());
  $('#rb-stcNewBoardName')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); stcCreateBoard(); }
  });

  // --- Handoff callout (Uncraft canvas → page handoff) ---
  // When the user typed a URL into the canvas's PromptDock and the
  // capture got challenged by Cloudflare/captcha, the canvas
  // (a) pre-created a placeholder node on the server, (b) minted an
  // HMAC handoff token, and (c) registered the token in
  // chrome.storage.local keyed by URL. The widget reads that registry
  // here — if the current tab matches an active handoff, we surface
  // the callout above the mode toggle so the user can ship the
  // verified DOM back without leaving the widget.
  const HANDOFF_STORAGE_KEY = 'uncraft.handoffs';
  function canonicalize(u) {
    try {
      const url = new URL(u);
      const host = url.host.replace(/^www\./i, '');
      const path = url.pathname.replace(/\/+$/, '') || '/';
      return {
        origin: `${url.protocol}//${host}`,
        path,
        full: `${url.protocol}//${host}${path}`
      };
    } catch { return null; }
  }
  function findMatchingHandoff(all, currentUrl) {
    const now = Date.now();
    const cur = canonicalize(currentUrl);
    if (!cur) return null;
    let exact = null, loose = null, looseTime = 0;
    for (const entry of Object.values(all || {})) {
      if (entry?.expiresAt && entry.expiresAt < now) continue;
      const t = canonicalize(entry.url);
      if (!t) continue;
      if (t.full === cur.full) { exact = entry; break; }
      if (t.origin === cur.origin) {
        const reg = entry.registeredAt || 0;
        if (reg > looseTime) { loose = entry; looseTime = reg; }
      }
    }
    return exact || loose;
  }
  function setHandoffStatus(text, isError) {
    const s = $('#rb-handoffStatus');
    if (!s) return;
    if (!text) { s.hidden = true; s.textContent = ''; s.classList.remove('rb-callout-status-error'); return; }
    s.hidden = false; s.textContent = text;
    s.classList.toggle('rb-callout-status-error', !!isError);
  }
  let activeHandoff = null;
  async function checkHandoff() {
    return new Promise((resolve) => {
      chrome.storage.local.get([HANDOFF_STORAGE_KEY], (res) => {
        const found = findMatchingHandoff(res?.[HANDOFF_STORAGE_KEY], location.href);
        activeHandoff = found || null;
        const cal = $('#rb-handoffCallout');
        if (cal) cal.hidden = !found;
        resolve(found);
      });
    });
  }
  async function deleteHandoffEntry(url) {
    return new Promise((resolve) => {
      chrome.storage.local.get([HANDOFF_STORAGE_KEY], (res) => {
        const all = res?.[HANDOFF_STORAGE_KEY] || {};
        delete all[url];
        chrome.storage.local.set({ [HANDOFF_STORAGE_KEY]: all }, resolve);
      });
    });
  }
  const handoffSendBtn = $('#rb-handoffSend');
  if (handoffSendBtn) handoffSendBtn.addEventListener('click', async () => {
    if (!activeHandoff) return;
    handoffSendBtn.disabled = true;
    handoffSendBtn.querySelector('.rb-btn-label').textContent = 'Capturing…';
    setHandoffStatus('');
    try {
      if (typeof window.__uncraftCapturePage !== 'function') {
        throw new Error('Capture helper not present — reload the page.');
      }
      const cap = await window.__uncraftCapturePage();
      handoffSendBtn.querySelector('.rb-btn-label').textContent = 'Sending…';
      const resp = await chrome.runtime.sendMessage({
        action: 'uncraft.handoff.send',
        handoff: activeHandoff,
        payload: { html: cap.html, title: cap.title, viewport: cap.viewport }
      });
      if (!resp || !resp.ok) throw new Error(resp?.error || 'send failed');
      handoffSendBtn.querySelector('.rb-btn-label').textContent = 'Sent ✓';
      setHandoffStatus('Placeholder filled. Your canvas updates within seconds.');
      await deleteHandoffEntry(activeHandoff.url);
      setTimeout(() => {
        const cal = $('#rb-handoffCallout');
        if (cal) cal.hidden = true;
      }, 1800);
    } catch (e) {
      handoffSendBtn.disabled = false;
      handoffSendBtn.querySelector('.rb-btn-label').textContent = 'Retry';
      setHandoffStatus(String(e?.message || e), true);
    }
  });
  const handoffDismissBtn = $('#rb-handoffDismiss');
  if (handoffDismissBtn) handoffDismissBtn.addEventListener('click', () => {
    const cal = $('#rb-handoffCallout');
    if (cal) cal.hidden = true;
    // Dismiss is local — we DON'T delete the handoff from storage, so the
    // user can re-open the widget later and complete it. Token TTL (5 min)
    // is the natural lifetime.
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
    // Handoff check runs regardless of onboarding state — the callout
    // is hidden in the onboarding view anyway (it lives inside viewMain).
    checkHandoff();
  });
})();
