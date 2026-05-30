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
    <!-- Unsaved-assets confirmation modal. Shown when the user is about
         to leave / live-remix / refresh and there are uncommitted items
         in the Collect Assets stage. Three actions: discard everything
         and proceed, keep editing (cancel), save then proceed. Styled
         in the widget's own design language (solid surface, Instrument
         typography, --rb- tokens). -->
    <div class="rb-modal-overlay" id="rb-unsavedOverlay" hidden>
      <div class="rb-modal-card" role="dialog" aria-modal="true" aria-labelledby="rb-unsavedTitle">
        <h3 class="rb-modal-title" id="rb-unsavedTitle">
          <span class="rb-serif"><i>Save</i></span> your assets?
        </h3>
        <p class="rb-modal-body" id="rb-unsavedBody">You have items in the Collect stage. Save them before continuing?</p>
        <div class="rb-modal-actions">
          <button type="button" class="rb-btn rb-btn-outline rb-btn-sm" id="rb-unsavedDiscard">
            <span class="rb-btn-label">Discard</span>
          </button>
          <button type="button" class="rb-btn rb-btn-outline rb-btn-sm" id="rb-unsavedCancel">
            <span class="rb-btn-label">Cancel</span>
          </button>
          <button type="button" class="rb-btn rb-btn-primary rb-btn-sm" id="rb-unsavedSave">
            <span class="rb-btn-label">Save</span>
          </button>
        </div>
      </div>
    </div>

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
            <span class="rb-send-cta-label">Send to Node-Canvas</span>
          </button>
          <button type="button" class="rb-icon-btn" id="rb-cog" aria-label="Settings">${GEAR_SVG}</button>
          <button type="button" class="rb-icon-btn" id="rb-close" aria-label="Close">${CLOSE_SVG}</button>
        </div>
      </header>

      <!-- Onboarding -->
      <div class="rb-view rb-onboarding rb-active" id="rb-viewOnboarding">
        <button type="button" class="rb-skip" id="rb-skip">Skip</button>
        <article class="rb-slide" data-step="0">
          <h2 class="rb-slide-title">Redesign
            <span class="rb-pill-rotate" id="rb-pillRotate">
              <span class="rb-pill-word rb-pill-active">websites</span>
              <span class="rb-pill-word">assets</span>
              <span class="rb-pill-word">components</span>
              <span class="rb-pill-word">sections</span>
            </span><br>right <em>in place</em>.</h2>
          <p class="rb-slide-text">The whole web is a <em>template</em>. Redesign any website with a familiar live editor.</p>
        </article>
        <article class="rb-slide" data-step="1" hidden>
          <h2 class="rb-slide-title">Your <em>personal</em> assets collection.</h2>
          <p class="rb-slide-text">Gather components and assets from all over the web and use in <em>any project</em>.</p>
        </article>
        <article class="rb-slide" data-step="2" hidden>
          <h2 class="rb-slide-title">The first webdesign focused <em>node-based</em> tool.</h2>
          <p class="rb-slide-text">Edit, remix, create and mix &amp; match websites in a <em>canvas</em>.</p>
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
          <p class="rb-site-footer" id="rb-siteFooter">Save your designs and collection.<br><span id="rb-signupLink" style="text-decoration:underline;cursor:pointer">Create account</span></p>
        </div>

        <!-- Collect Assets view — replaces #rb-siteAnalysis + Smart Remix
             stuff when toggle is on light (data-mode="light"). Staging
             area for items collected from the host page via the
             hover/click overlay in Collect mode. -->
        <div class="rb-collect-host" id="rb-contentCollect" style="display:none">
          <div class="rb-collect-intro">
            <div class="rb-collect-intro-icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="3.2"/>
                <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12"/>
              </svg>
            </div>
            <div class="rb-collect-intro-text">
              <p class="rb-collect-intro-title">Collect from this page</p>
              <p class="rb-collect-intro-sub">Hover any element, click to collect. Cmd-drag for marquee. Right-click for stacked elements.</p>
            </div>
          </div>
          <div class="rb-collect-stage-header">
            <span class="rb-collect-stage-count" id="rb-collectCount">No items yet</span>
            <button type="button" class="rb-collect-stage-action" id="rb-collectSelectAll" hidden>Select all</button>
          </div>
          <div class="rb-collect-stage" id="rb-collectStage"></div>
          <div class="rb-collect-toast" id="rb-collectToast" hidden></div>
          <div class="rb-collect-footer" id="rb-collectFooter" hidden>
            <!-- Destination picker. Custom dropdown so we can render
                 visual separators between the three sections
                 (global library / user projects / new project). A
                 native <select> with <optgroup> would render labels,
                 not separators, and would miss the user's intent. -->
            <div class="rb-collect-dest-wrap">
              <button type="button" class="rb-collect-dest-pill" id="rb-collectDestPill" aria-haspopup="listbox" aria-expanded="false">
                <span class="rb-collect-dest-label" id="rb-collectDestLabel">Global library</span>
                ${CHEVRON_SVG}
              </button>
              <div class="rb-collect-dest-menu" id="rb-collectDestMenu" hidden role="listbox"></div>
            </div>
            <!-- Inline "new project" name input. Shown only after the
                 user picks the "New project" option AND is signed in.
                 If not signed in, picking new project opens the
                 web-shell signup page in a new tab instead. -->
            <div class="rb-collect-new-row" id="rb-collectNewRow" hidden>
              <input type="text" class="rb-collect-new-input" id="rb-collectNewName" placeholder="Project name" maxlength="120">
              <button type="button" class="rb-btn rb-btn-outline rb-btn-sm" id="rb-collectNewCreate">
                <span class="rb-btn-label">Create</span>
              </button>
            </div>
            <button type="button" class="rb-btn rb-btn-primary rb-btn-full" id="rb-collectSave">
              <span class="rb-btn-label">Collect Selected to Assets Library</span>
            </button>
          </div>
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
          <h2 class="rb-settings-title">Send to Node-Canvas</h2>
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
              <span class="rb-btn-label">Send to Node-Canvas</span>
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
  function closePanelImmediate() {
    // Tear down Collect mode first so its document-level listeners
    // and overlay don't outlive the widget. panel.remove() drops the
    // widget DOM but those handlers were attached to document, not to
    // any node inside the widget.
    deactivateCollect();
    for (const id of ['__rb-collect-overlay', '__rb-collect-stack-popup', '__rb-collect-marquee']) {
      const el = document.getElementById(id);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }
    // Persistent collected-item outlines have per-item ids
    // (__rb-collect-mark-<itemid>); brute-force querySelectorAll wipes
    // any that slipped through clearAllOutlines on deactivate.
    document.querySelectorAll('[id^="__rb-collect-mark-"]').forEach((n) => {
      if (n.parentNode) n.parentNode.removeChild(n);
    });
    panel.remove();
  }
  $('#rb-close').addEventListener('click', () => {
    // Closing the widget destroys the in-memory stage — same data-loss
    // risk as Live Remix. Gate behind the unsaved dialog when there's
    // anything pending.
    guardUnsaved(closePanelImmediate, 'Closing the widget discards your collected items. Save them first?');
  });

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

  // ─── Collect Assets mode ──────────────────────────────────────────────
  // Hover any element on the host page → highlight it. Click → capture it
  // as an asset of the inferred type (image, svg, icon, component, etc).
  // Captured items pile up in the staging area (#rb-collectStage) so the
  // user can curate before sending to a library/project.
  //
  // The hover/click handlers are wired ONLY while Collect Assets mode is
  // active (light data-mode). Deactivating tears down handlers and the
  // overlay so the user can browse the page normally again.
  //
  // Future layers: Cmd-drag marquee (DOM-based, not bitmap), right-click
  // stack popup, Cmd+G grouping, font capture with WOFF download,
  // backend persistence, canvas-side Assets tab. This module exposes
  // the hooks they'll plug into.

  const collectState = {
    active: false,
    overlay: null,
    items: [],           // each: { id, type, el, snapshot, meta }
    selected: new Set()  // ids checked in staging
  };

  // The widget itself + any of its UI must not be hoverable/highlightable.
  // Anything inside #repixbridge-panel is widget chrome.
  function isWidgetEl(el) {
    return !!(el && (el.id === 'repixbridge-panel' || el.closest('#repixbridge-panel')));
  }

  // Infer the asset type from an element. Precedence: most specific wins.
  // Returns one of: image | svg | icon | background-image | video |
  // component | section | text. (font/color/pattern/region land in v2.)
  function inferAssetType(el) {
    if (!el || el.nodeType !== 1) return 'component';
    const tag = el.tagName;
    if (tag === 'VIDEO') return 'video';
    if (tag === 'IMG') {
      const src = el.getAttribute('src') || '';
      return /\.svg($|\?)/i.test(src) ? 'svg' : 'image';
    }
    if (tag === 'SVG' || tag === 'svg') {
      const r = el.getBoundingClientRect();
      return (r.width < 80 && r.height < 80) ? 'icon' : 'svg';
    }
    let cs;
    try { cs = getComputedStyle(el); } catch { cs = null; }
    if (cs) {
      const bg = cs.backgroundImage;
      const hasOwnBg = bg && bg !== 'none' && !bg.startsWith('linear-gradient') && !bg.startsWith('radial-gradient');
      const significantKids = Array.from(el.children).filter((c) => {
        const cr = c.getBoundingClientRect();
        return cr.width > 12 && cr.height > 12;
      });
      if (hasOwnBg && significantKids.length === 0) return 'background-image';
    }
    // Section vs component: tall elements (>40% viewport) read as "section"
    // and unlock different downstream treatment (e.g. preserve full layout).
    const r = el.getBoundingClientRect();
    if (r.height > window.innerHeight * 0.4 && r.width > window.innerWidth * 0.5) return 'section';
    // Text leaf — element whose direct content is just text (no nontrivial
    // children). Hovered text triggers font/typography capture in v2; for
    // v1 it's saved as a 'text' component so we don't lose it.
    const hasNonTextKids = Array.from(el.childNodes).some((n) => n.nodeType === 1);
    if (!hasNonTextKids && (el.textContent || '').trim().length > 0) return 'text';
    return 'component';
  }

  // Build the snapshot for a captured element. Stores the outerHTML +
  // a minimal set of computed styles so the asset can be reconstructed
  // later without depending on the source page CSS. For image/svg/video
  // we also pluck the underlying URL so blob hosting (v2) can fetch it.
  function captureSnapshot(el, type) {
    const snap = {
      tag: el.tagName.toLowerCase(),
      html: el.outerHTML,
      rect: pickRect(el.getBoundingClientRect()),
      url: null
    };
    try {
      if (type === 'image' || type === 'svg') snap.url = el.currentSrc || el.src || null;
      if (type === 'video') snap.url = el.currentSrc || el.src || null;
      if (type === 'background-image') {
        const cs = getComputedStyle(el);
        const m = /url\(["']?([^"')]+)/.exec(cs.backgroundImage || '');
        snap.url = m ? m[1] : null;
      }
    } catch {}
    return snap;
  }
  function pickRect(r) {
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  }

  // A best-effort name for display in the stage. Falls back through
  // alt → aria-label → id → class → tagName. Truncated to 40 chars.
  function deriveName(el, type) {
    const tryAttrs = ['alt', 'aria-label', 'title', 'data-name'];
    for (const a of tryAttrs) {
      const v = el.getAttribute && el.getAttribute(a);
      if (v && v.trim()) return v.trim().slice(0, 40);
    }
    if (el.id) return `#${el.id}`.slice(0, 40);
    const cls = (el.className && typeof el.className === 'string') ? el.className.trim().split(/\s+/)[0] : '';
    if (cls) return `.${cls}`.slice(0, 40);
    return `<${el.tagName.toLowerCase()}>`;
  }

  // Pretty label for the type pill. Keeps the user vocabulary aligned
  // with the README/PR description rather than DOM-jargon.
  const TYPE_LABEL = {
    image: 'Image',
    svg: 'SVG',
    icon: 'Icon',
    'background-image': 'Background',
    video: 'Video',
    component: 'Component',
    section: 'Section',
    text: 'Text',
    font: 'Font',
    group: 'Group'
  };

  // Create / position / show the highlight overlay around an element.
  function ensureOverlay() {
    if (collectState.overlay) return collectState.overlay;
    const ov = document.createElement('div');
    ov.id = '__rb-collect-overlay';
    ov.setAttribute('data-uncraft-internal', '1');
    // Neutral overlay — grey/black border so it reads as "selection
     // affordance" without competing with the blue checkbox accent
     // in the widget. The only coloured affordance in Collect mode
     // lives on the per-row checkboxes.
    Object.assign(ov.style, {
      position: 'fixed',
      pointerEvents: 'none',
      zIndex: '2147483645',
      border: '2px solid rgba(20, 20, 20, 0.92)',
      background: 'rgba(255, 255, 255, 0.04)',
      borderRadius: '4px',
      transition: 'all 80ms ease-out',
      boxShadow: '0 0 0 1px rgba(255, 255, 255, 0.45)',
      display: 'none'
    });
    // Floating type tag on the top-left corner of the overlay.
    const tag = document.createElement('div');
    tag.id = '__rb-collect-overlay-tag';
    Object.assign(tag.style, {
      position: 'absolute',
      top: '-22px',
      left: '0',
      padding: '2px 8px',
      borderRadius: '999px',
      background: '#0a0a0a',
      color: '#EFEEEB',
      fontFamily: "'Instrument Sans', -apple-system, sans-serif",
      fontSize: '10.5px',
      fontWeight: '500',
      letterSpacing: '0.02em',
      whiteSpace: 'nowrap',
      border: '1px solid rgba(255, 255, 255, 0.18)'
    });
    ov.appendChild(tag);
    document.documentElement.appendChild(ov);
    collectState.overlay = ov;
    return ov;
  }
  function positionOverlay(el, type, mode) {
    const ov = ensureOverlay();
    const r = el.getBoundingClientRect();
    ov.style.display = 'block';
    ov.style.left = `${r.left}px`;
    ov.style.top = `${r.top}px`;
    ov.style.width = `${r.width}px`;
    ov.style.height = `${r.height}px`;
    const tag = ov.querySelector('#__rb-collect-overlay-tag');
    if (tag) {
      // `mode` flips the verb so the user reads what THIS click will
      // actually do — collect (new element) vs deselect (re-clicking
      // a previously collected one).
      const verb = mode === 'deselect' ? 'Click to deselect' : 'Click to collect';
      tag.textContent = `${verb} · ${TYPE_LABEL[type] || type}`;
    }
  }
  function hideOverlay() {
    if (collectState.overlay) collectState.overlay.style.display = 'none';
  }

  // ── Persistent "collected" outlines ──────────────────────────────────
  // Once an item is captured, it keeps a thin blue outline pinned to
  // its DOM element so the user can SEE what they've already collected
  // while browsing the rest of the page. One outline per item.
  // Different colour + thinner border than the hover preview overlay so
  // the two coexist cleanly: grey-dark hover (transient) vs blue (the
  // accent restricted to the checkbox affordance and now this).
  function ensureItemOutline(item) {
    if (item._outlineEl || !item._elRef) return;
    const ov = document.createElement('div');
    ov.setAttribute('data-uncraft-internal', '1');
    ov.id = `__rb-collect-mark-${item.id}`;
    Object.assign(ov.style, {
      position: 'fixed',
      pointerEvents: 'none',
      // Below the hover overlay (2147483645) so the hover preview wins
      // when the user is targeting a NEW element on top of a collected
      // one. Above page content.
      zIndex: '2147483640',
      border: '1.5px solid #0095FF',
      borderRadius: '3px',
      transition: 'left 80ms ease-out, top 80ms ease-out, width 80ms ease-out, height 80ms ease-out',
      boxShadow: '0 0 0 1px rgba(255, 255, 255, 0.20)',
      background: 'rgba(0, 149, 255, 0.05)'
    });
    document.documentElement.appendChild(ov);
    item._outlineEl = ov;
    positionItemOutline(item);
  }

  function positionItemOutline(item) {
    if (!item._outlineEl || !item._elRef) return;
    // Element disconnected from DOM (SPA navigated, lazy-load tore it
    // down): hide rather than render at 0/0/0/0.
    if (!item._elRef.isConnected) {
      item._outlineEl.style.display = 'none';
      return;
    }
    const r = item._elRef.getBoundingClientRect();
    // Off-screen: hide so we don't paint scroll-offset ghosts.
    if (r.width === 0 || r.height === 0) {
      item._outlineEl.style.display = 'none';
      return;
    }
    item._outlineEl.style.display = 'block';
    item._outlineEl.style.left = `${r.left}px`;
    item._outlineEl.style.top = `${r.top}px`;
    item._outlineEl.style.width = `${r.width}px`;
    item._outlineEl.style.height = `${r.height}px`;
  }

  function removeItemOutline(item) {
    if (item._outlineEl && item._outlineEl.parentNode) {
      item._outlineEl.parentNode.removeChild(item._outlineEl);
    }
    item._outlineEl = null;
  }

  function repositionAllOutlines() {
    for (const it of collectState.items) {
      if (it._outlineEl) positionItemOutline(it);
    }
  }

  function clearAllOutlines() {
    for (const it of collectState.items) removeItemOutline(it);
  }

  // ── Activation / deactivation ─────────────────────────────────────────
  let _hoverEl = null;
  function onCollectMove(e) {
    if (!collectState.active) return;
    // While stack popup is open the popup drives overlay positioning
    // via its own row-hover handler. Pause the freehand follow so the
    // overlay doesn't flicker between target page elements and popup
    // row hover-preview.
    if (_stackPopup && _stackPopup.style.display === 'block') return;
    if (isWidgetEl(e.target)) {
      hideOverlay();
      // Mouse left the page back onto the widget — clear any in-flight
      // emphasis on the previously-hovered collected element.
      if (_hoverEl) {
        const prev = findCollectedByElement(_hoverEl);
        if (prev) emphasiseItem(prev, false);
      }
      _hoverEl = null;
      return;
    }
    if (e.target === _hoverEl) return;
    // Clear emphasis on the element we're leaving (if it was collected).
    if (_hoverEl) {
      const prev = findCollectedByElement(_hoverEl);
      if (prev) emphasiseItem(prev, false);
    }
    _hoverEl = e.target;
    const type = inferAssetType(e.target);
    // Bidirectional emphasis: hovering an already-collected element on
    // the page brightens BOTH its on-page outline AND its row in the
    // staging list (scrollIntoView nudges hidden rows into view). The
    // hover-overlay verb also flips to "Click to deselect" so the
    // toggle behaviour reads at a glance.
    const existing = findCollectedByElement(e.target);
    if (existing) {
      positionOverlay(e.target, type, 'deselect');
      emphasiseItem(existing, true);
    } else {
      positionOverlay(e.target, type);
    }
  }
  function onCollectClick(e) {
    if (!collectState.active) return;
    // Marquee just finished — swallow the synthetic click that fires
    // after mouseup so we don't double-capture the element under cursor.
    if (_marqueeJustCaptured) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // While the stack popup is open, the popup handles its own row
    // clicks. Any click OUTSIDE the popup is a dismiss — we close it
    // without capturing whatever's underneath.
    if (_stackPopup && _stackPopup.style.display === 'block') {
      if (isInStackPopup(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      closeStackPopup();
      return;
    }
    if (isWidgetEl(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.target;
    // Toggle: clicking an already-collected element removes it from
    // the stage and clears its persistent outline. Same gesture both
    // ways — selection and deselection.
    const existing = findCollectedByElement(el);
    if (existing) {
      removeItem(existing);
      showCollectToast(`Removed ${existing.name}`);
      return;
    }
    const type = inferAssetType(el);
    collectItem(el, type);
  }
  function onCollectLeave() {
    hideOverlay();
    if (_hoverEl) {
      const prev = findCollectedByElement(_hoverEl);
      if (prev) emphasiseItem(prev, false);
    }
    _hoverEl = null;
  }

  function activateCollect() {
    if (collectState.active) return;
    collectState.active = true;
    document.addEventListener('mousemove', onCollectMove, true);
    document.addEventListener('click', onCollectClick, true);
    document.addEventListener('mouseleave', onCollectLeave);
    document.addEventListener('contextmenu', onCollectContextMenu, true);
    document.addEventListener('keydown', onCollectKeyDown, true);
    // Page scroll invalidates popup positioning — close to avoid the
    // popup floating over the wrong content.
    document.addEventListener('scroll', closeStackPopup, true);
    // Marquee — Cmd/Ctrl arms, mousedown starts drag, mouseup captures.
    document.addEventListener('keydown', onMarqueeKeyDown, true);
    document.addEventListener('keyup', onMarqueeKeyUp, true);
    document.addEventListener('mousedown', onMarqueeMouseDown, true);
    document.addEventListener('mousemove', onMarqueeMouseMove, true);
    document.addEventListener('mouseup', onMarqueeMouseUp, true);
    // Outlines pinned to collected elements need to follow scroll +
    // resize so they don't drift to wrong positions when the user
    // moves around the page.
    window.addEventListener('scroll', repositionAllOutlines, true);
    window.addEventListener('resize', repositionAllOutlines, true);
    renderCollectStage();
  }
  function deactivateCollect() {
    if (!collectState.active) return;
    collectState.active = false;
    document.removeEventListener('mousemove', onCollectMove, true);
    document.removeEventListener('click', onCollectClick, true);
    document.removeEventListener('mouseleave', onCollectLeave);
    document.removeEventListener('contextmenu', onCollectContextMenu, true);
    document.removeEventListener('keydown', onCollectKeyDown, true);
    document.removeEventListener('scroll', closeStackPopup, true);
    document.removeEventListener('keydown', onMarqueeKeyDown, true);
    document.removeEventListener('keyup', onMarqueeKeyUp, true);
    document.removeEventListener('mousedown', onMarqueeMouseDown, true);
    document.removeEventListener('mousemove', onMarqueeMouseMove, true);
    document.removeEventListener('mouseup', onMarqueeMouseUp, true);
    window.removeEventListener('scroll', repositionAllOutlines, true);
    window.removeEventListener('resize', repositionAllOutlines, true);
    closeStackPopup();
    hideOverlay();
    clearAllOutlines();
    marquee.active = false;
    marquee.armed = false;
    if (marquee.rectEl) marquee.rectEl.style.display = 'none';
    setArmedCursor(false);
    _hoverEl = null;
  }

  // ── Right-click stack popup ───────────────────────────────────────────
  // On contextmenu inside a target page (while Collect is active), open
  // a Photoshop-style popup listing the elements under the cursor
  // (deepest first) so the user can pick a specific one even when it's
  // hidden behind larger siblings. Always appends "Whole section" as a
  // synthetic option when a section-like ancestor exists; prepends
  // "Background" when the topmost element is decorative (no significant
  // children, visible own background).

  // Walks up the DOM from `el` looking for the nearest "section-like"
  // ancestor. Stops at <body> / <html>. A section qualifies when it
  // either uses one of the semantic section tags OR has a class hint OR
  // is a large self-contained chunk near the top level. Returns null
  // when no convincing ancestor exists.
  const SECTION_TAGS = new Set(['SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'ASIDE', 'MAIN', 'NAV']);
  const SECTION_CLASS_HINTS = /\b(section|hero|banner|block|row|container|wrapper)\b/i;
  function findSectionAncestor(el) {
    let node = el?.parentElement;
    let candidate = null;
    while (node && node.tagName !== 'BODY' && node.tagName !== 'HTML') {
      const r = node.getBoundingClientRect();
      const isBigEnough = r.width > window.innerWidth * 0.5 && r.height > 220;
      const isSemantic = SECTION_TAGS.has(node.tagName) ||
                         (typeof node.className === 'string' && SECTION_CLASS_HINTS.test(node.className));
      if (isBigEnough && isSemantic) return node;
      // Fallback: keep largest big-enough ancestor in case no semantic
      // hit shows up (some sites use opaque div soup but the user still
      // wants "this whole strip").
      if (isBigEnough && !candidate) candidate = node;
      node = node.parentElement;
    }
    return candidate;
  }

  // Heuristic for "this element is mostly background" — has its own
  // background-color/image, lacks meaningful children, lacks text. Used
  // to decide whether to prepend a "Background" option in the popup.
  function isBackgroundLike(el) {
    if (!el || el.nodeType !== 1) return false;
    let cs;
    try { cs = getComputedStyle(el); } catch { return false; }
    const bg = cs.backgroundImage;
    const bgColor = cs.backgroundColor;
    const hasOwnBg = (bg && bg !== 'none') ||
                     (bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent');
    if (!hasOwnBg) return false;
    const text = (el.textContent || '').trim();
    if (text.length > 12) return false;
    const sigKids = Array.from(el.children).filter((c) => {
      const r = c.getBoundingClientRect();
      return r.width > 12 && r.height > 12;
    });
    return sigKids.length === 0;
  }

  let _stackPopup = null;
  let _stackPopupAnchorEl = null; // hovered row's referenced element
  function ensureStackPopup() {
    if (_stackPopup) return _stackPopup;
    const p = document.createElement('div');
    p.id = '__rb-collect-stack-popup';
    p.setAttribute('data-uncraft-internal', '1');
    Object.assign(p.style, {
      position: 'fixed',
      zIndex: '2147483646',
      minWidth: '260px',
      maxWidth: '320px',
      maxHeight: '380px',
      overflowY: 'auto',
      background: '#0a0a0a',
      color: '#EFEEEB',
      border: '1px solid rgba(255, 255, 255, 0.12)',
      borderRadius: '14px',
      boxShadow: '0 24px 60px rgba(0, 0, 0, 0.55)',
      padding: '4px',
      fontFamily: "'Instrument Sans', -apple-system, sans-serif",
      fontSize: '12.5px',
      display: 'none'
    });
    document.documentElement.appendChild(p);
    _stackPopup = p;
    p.addEventListener('mousemove', onStackRowHover, true);
    p.addEventListener('mouseleave', () => { hideOverlay(); _stackPopupAnchorEl = null; });
    p.addEventListener('click', onStackRowClick, true);
    return p;
  }

  function closeStackPopup() {
    if (_stackPopup) _stackPopup.style.display = 'none';
    _stackPopupAnchorEl = null;
    hideOverlay();
  }

  // Map between row index and DOM element via a WeakMap so we don't have
  // to serialise refs into DOM data-attributes.
  const _stackRowRefs = [];

  function buildStackRow(el, forcedType, forcedLabel, isSynthetic) {
    const type = forcedType || inferAssetType(el);
    const tag = el.tagName.toLowerCase();
    const idHint = el.id ? `#${el.id}` : '';
    const clsHint = (typeof el.className === 'string' && el.className.trim())
      ? '.' + el.className.trim().split(/\s+/)[0] : '';
    const label = forcedLabel || `<${tag}>${idHint || clsHint}`;
    const idx = _stackRowRefs.length;
    _stackRowRefs.push(el);
    return `
      <button type="button" class="__rb-stack-row${isSynthetic ? ' __rb-stack-row-synth' : ''}" data-stack-idx="${idx}" data-type="${type}">
        <span class="__rb-stack-type">${TYPE_LABEL[type] || type}</span>
        <span class="__rb-stack-label">${escapeHtml(label)}</span>
      </button>
    `;
  }

  function openStackPopup(x, y) {
    _stackRowRefs.length = 0;
    const p = ensureStackPopup();

    // Collect DOM stack at the click point.
    const at = document.elementsFromPoint(x, y) || [];
    const stack = at.filter((el) => {
      if (isWidgetEl(el)) return false;
      if (el === document.documentElement || el === document.body) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 12 || r.height < 12) return false;
      return true;
    }).slice(0, 8);

    const rows = [];

    // "Background" synthetic option — only if the topmost real element
    // reads as background-like (no kids, visible own background, no text).
    if (stack[0] && isBackgroundLike(stack[0])) {
      rows.push(buildStackRow(stack[0], 'background-image', 'Background', true));
      rows.push('<div class="__rb-stack-sep" aria-hidden="true"></div>');
    }

    // Real DOM stack.
    if (stack.length === 0) {
      rows.push('<div class="__rb-stack-empty">No elements at this point</div>');
    } else {
      for (const el of stack) rows.push(buildStackRow(el));
    }

    // "Whole section" synthetic option — appended below the stack when
    // a section-like ancestor exists AND isn't already in the stack.
    const section = findSectionAncestor(stack[0] || null);
    if (section && !stack.includes(section)) {
      rows.push('<div class="__rb-stack-sep" aria-hidden="true"></div>');
      rows.push(buildStackRow(section, 'section', 'Whole section', true));
    }

    p.innerHTML = rows.join('');

    // Position — pin to cursor, then nudge inside viewport if it overflows.
    p.style.display = 'block';
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    const pr = p.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + pr.width + 8 > window.innerWidth) left = window.innerWidth - pr.width - 8;
    if (top + pr.height + 8 > window.innerHeight) top = window.innerHeight - pr.height - 8;
    if (left < 8) left = 8;
    if (top < 8) top = 8;
    p.style.left = `${left}px`;
    p.style.top = `${top}px`;
  }

  function onStackRowHover(e) {
    const row = e.target.closest('.__rb-stack-row');
    if (!row) return;
    const el = _stackRowRefs[parseInt(row.dataset.stackIdx, 10)];
    if (!el || el === _stackPopupAnchorEl) return;
    _stackPopupAnchorEl = el;
    positionOverlay(el, row.dataset.type || inferAssetType(el));
  }

  function onStackRowClick(e) {
    e.preventDefault();
    e.stopPropagation();
    const row = e.target.closest('.__rb-stack-row');
    if (!row) return;
    const el = _stackRowRefs[parseInt(row.dataset.stackIdx, 10)];
    if (!el) return;
    // Same toggle semantics as a regular click — picking an already-
    // collected element from the stack popup deselects it.
    const existing = findCollectedByElement(el);
    if (existing) {
      removeItem(existing);
      showCollectToast(`Removed ${existing.name}`);
      closeStackPopup();
      return;
    }
    const type = row.dataset.type || inferAssetType(el);
    collectItem(el, type);
    closeStackPopup();
  }

  function onCollectContextMenu(e) {
    if (!collectState.active) return;
    if (isWidgetEl(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    openStackPopup(e.clientX, e.clientY);
  }

  function onCollectKeyDown(e) {
    if (!collectState.active) return;
    if (e.key === 'Escape' && _stackPopup && _stackPopup.style.display === 'block') {
      e.preventDefault();
      closeStackPopup();
      return;
    }
    // Cmd+G / Ctrl+G — promote checked items into a group asset.
    if ((e.metaKey || e.ctrlKey) && (e.key === 'g' || e.key === 'G')) {
      e.preventDefault();
      e.stopPropagation();
      groupSelected();
    }
  }

  // Dismiss-on-click-outside is wrapped into onCollectClick: if the
  // stack popup is open and the click target isn't inside it, close it
  // and abort the capture for THIS click (the user is dismissing, not
  // collecting).
  function isInStackPopup(target) {
    return !!(_stackPopup && _stackPopup.contains(target));
  }

  // ── Cmd-held marquee mode ─────────────────────────────────────────────
  // Hold Cmd (Meta) / Ctrl on Windows, drag to draw a rectangle. On
  // mouseup, every page element whose bounding box is FULLY inside the
  // marquee rect is captured (NOT bitmap — the actual DOM elements,
  // each independently). The user then has a granular multi-pick that
  // can be promoted to a group via Cmd+G in a follow-up slice.
  //
  // The marquee is DOM-based on purpose: keeps the asset library full
  // of editable, semantic elements rather than flat pixel snapshots.

  const marquee = {
    active: false,            // currently dragging
    armed: false,             // Cmd is held — cursor crosshair, ready to drag
    startX: 0, startY: 0,
    rect: null,               // {x,y,w,h}
    rectEl: null              // overlay rectangle element
  };

  function ensureMarqueeEl() {
    if (marquee.rectEl) return marquee.rectEl;
    const r = document.createElement('div');
    r.id = '__rb-collect-marquee';
    r.setAttribute('data-uncraft-internal', '1');
    Object.assign(r.style, {
      position: 'fixed',
      pointerEvents: 'none',
      zIndex: '2147483645',
      border: '1.5px dashed rgba(0, 149, 255, 0.95)',
      background: 'rgba(0, 149, 255, 0.10)',
      borderRadius: '2px',
      display: 'none'
    });
    document.documentElement.appendChild(r);
    marquee.rectEl = r;
    return r;
  }

  // Cursor stays untouched in all Collect modes (per the editor's
  // Live Remix behaviour). The Cmd-armed marquee state is signalled
  // by the hover overlay disappearing and the dashed-rectangle
  // following the drag — no cursor change.
  function setArmedCursor(_on) {
    // intentional no-op
  }

  function onMarqueeKeyDown(e) {
    if (!collectState.active) return;
    if ((e.metaKey || e.ctrlKey) && !marquee.armed) {
      marquee.armed = true;
      setArmedCursor(true);
      hideOverlay();
    }
  }
  function onMarqueeKeyUp(e) {
    if (!collectState.active) return;
    if (!e.metaKey && !e.ctrlKey && marquee.armed && !marquee.active) {
      marquee.armed = false;
      setArmedCursor(false);
    }
  }

  function onMarqueeMouseDown(e) {
    if (!collectState.active) return;
    if (!marquee.armed) return;
    if (isWidgetEl(e.target)) return;
    if (isInStackPopup(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    marquee.active = true;
    marquee.startX = e.clientX;
    marquee.startY = e.clientY;
    const r = ensureMarqueeEl();
    r.style.left = `${e.clientX}px`;
    r.style.top = `${e.clientY}px`;
    r.style.width = '0px';
    r.style.height = '0px';
    r.style.display = 'block';
    // Stop the regular hover overlay from chasing the cursor mid-drag.
    hideOverlay();
  }

  function onMarqueeMouseMove(e) {
    if (!collectState.active || !marquee.active) return;
    const x1 = Math.min(marquee.startX, e.clientX);
    const y1 = Math.min(marquee.startY, e.clientY);
    const x2 = Math.max(marquee.startX, e.clientX);
    const y2 = Math.max(marquee.startY, e.clientY);
    const r = ensureMarqueeEl();
    r.style.left = `${x1}px`;
    r.style.top = `${y1}px`;
    r.style.width = `${x2 - x1}px`;
    r.style.height = `${y2 - y1}px`;
    marquee.rect = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  function onMarqueeMouseUp(e) {
    if (!collectState.active || !marquee.active) return;
    marquee.active = false;
    const r = marquee.rectEl;
    if (r) r.style.display = 'none';
    const rect = marquee.rect;
    marquee.rect = null;
    // Drop the armed state — natural break point for the user.
    marquee.armed = false;
    setArmedCursor(false);
    if (!rect || rect.w < 8 || rect.h < 8) return; // accidental click
    e.preventDefault();
    e.stopPropagation();
    // The click event fires AFTER mouseup with the same target — would
    // otherwise capture a single element on top of the marquee batch.
    // Suppress it for this gesture cycle.
    _marqueeJustCaptured = true;
    setTimeout(() => { _marqueeJustCaptured = false; }, 0);
    captureMarqueeRect(rect);
  }
  let _marqueeJustCaptured = false;

  // Walk the DOM tree finding every element whose bounding box is
  // fully INSIDE the marquee rect. Skips: our own widget, html/body,
  // text nodes (handled by their parent), tiny elements (<12×12).
  // Then trims out elements whose descendants we already collected —
  // we want leaf-ish picks, not "the wrapper that contains everything".
  function findElementsInRect(rect) {
    const found = [];
    const x2 = rect.x + rect.w;
    const y2 = rect.y + rect.h;
    function walk(node) {
      if (!node || node.nodeType !== 1) return;
      if (isWidgetEl(node)) return;
      if (node === document.documentElement || node === document.body) {
        // never collect HTML/BODY, but DO descend
      } else {
        const r = node.getBoundingClientRect();
        if (r.width >= 12 && r.height >= 12) {
          if (r.left >= rect.x && r.top >= rect.y && r.right <= x2 && r.bottom <= y2) {
            found.push(node);
            return; // don't dig into children of a fully-inside element;
                    // the user wants the broadest leaf-ish picks, not the
                    // whole subtree as N records
          }
        }
      }
      for (const child of node.children) walk(child);
    }
    walk(document.body);
    return found;
  }

  function captureMarqueeRect(rect) {
    const els = findElementsInRect(rect);
    if (els.length === 0) {
      showCollectToast('Marquee was empty — try a larger area.');
      return;
    }
    // Marquee never overwrites already-collected elements (toggle in a
    // batch context is confusing). Pre-filter so the toast count
    // reflects only new captures.
    const fresh = els.filter((el) => !findCollectedByElement(el));
    const skipped = els.length - fresh.length;
    for (const el of fresh) {
      const type = inferAssetType(el);
      collectItem(el, type);
    }
    const parts = [`${fresh.length} new`];
    if (skipped) parts.push(`${skipped} already collected`);
    showCollectToast(`Marquee → ${parts.join(', ')}.`);
  }

  // ── Cmd+G grouping ────────────────────────────────────────────────────
  // Promote the currently-checked items in the stage into a single
  // group asset. The group's snapshot is the smallest common ancestor
  // CLONED with non-selected children stripped — so the parent's CSS
  // (display: flex, gap, padding) survives and the selected items keep
  // their original spacing between each other without dragging along
  // unrelated siblings.
  //
  // Triggered by Cmd+G (Meta+G) or Ctrl+G on Windows, while Collect mode
  // is active AND the staging stage has at least 2 selected items.
  // Groups appear in the stage as an aggregated row (rendering hook in
  // renderCollectStage extended below).

  function findCommonAncestor(els) {
    if (els.length === 0) return null;
    if (els.length === 1) return els[0].parentElement || els[0];
    // Build ancestor chain for first element, then walk each subsequent
    // element looking for the deepest shared ancestor.
    function chain(el) {
      const out = [];
      let n = el;
      while (n) { out.push(n); n = n.parentElement; }
      return out;
    }
    let common = chain(els[0]);
    for (let i = 1; i < els.length; i++) {
      const c = new Set(chain(els[i]));
      common = common.filter((n) => c.has(n));
      if (!common.length) return null;
    }
    return common[0] || null;
  }

  // Clone the common ancestor, then walk the clone removing any child
  // subtree that does not contain at least one of the selected elements.
  // We tag the original DOM elements via WeakSet membership so the
  // clone walker can detect descendants by matching their original
  // position. Since cloneNode doesn't carry references, we mark BEFORE
  // cloning via a temporary data attribute, then strip it after.
  function buildGroupSnapshot(els) {
    const ancestor = findCommonAncestor(els);
    if (!ancestor) return null;
    const KEEP_ATTR = 'data-uncraft-keep';
    const TAG_ATTR = 'data-uncraft-keep-root';
    for (const el of els) el.setAttribute(KEEP_ATTR, '1');
    ancestor.setAttribute(TAG_ATTR, '1');
    let html;
    try {
      const clone = ancestor.cloneNode(true);
      pruneClone(clone);
      // Strip our tags before serialising.
      clone.querySelectorAll(`[${KEEP_ATTR}]`).forEach((n) => n.removeAttribute(KEEP_ATTR));
      clone.removeAttribute(TAG_ATTR);
      html = clone.outerHTML;
    } finally {
      for (const el of els) el.removeAttribute(KEEP_ATTR);
      ancestor.removeAttribute(TAG_ATTR);
    }
    const r = ancestor.getBoundingClientRect();
    return {
      tag: ancestor.tagName.toLowerCase(),
      html,
      rect: pickRect(r),
      childCount: els.length,
      _ancestorEl: ancestor  // kept on the snapshot so groupSelected can
                              // attach an outline to the common ancestor
                              // bbox. Stripped before serialising to API.
    };
  }

  // Walk a CLONE recursively. Keep nodes that themselves have data-
  // uncraft-keep, OR contain a descendant with it. Remove the rest.
  // Result: clone with only selected leaves + their lineage preserved.
  function pruneClone(clone) {
    const KEEP_ATTR = 'data-uncraft-keep';
    function hasKeptDescendant(n) {
      if (n.hasAttribute(KEEP_ATTR)) return true;
      for (const c of n.children) if (hasKeptDescendant(c)) return true;
      return false;
    }
    function prune(n) {
      const drop = [];
      for (const c of n.children) {
        if (!hasKeptDescendant(c)) drop.push(c);
        else prune(c);
      }
      for (const d of drop) n.removeChild(d);
    }
    prune(clone);
  }

  function groupSelected() {
    if (!collectState.active) return;
    const selectedItems = collectState.items.filter((it) => collectState.selected.has(it.id) && !it.isGroup);
    if (selectedItems.length < 2) {
      showCollectToast('Select 2+ items to group.');
      return;
    }
    // Resolve back to DOM nodes from the snapshots. Since the snapshots
    // store outerHTML but not references, we re-query elements from
    // their original rect — we tagged them at capture time? We didn't.
    // Pragmatic approach: re-find each item's element via its rect +
    // tag. This is fragile but acceptable for v1 since the page is
    // expected to be static while the user is collecting.
    //
    // Better: store a WeakRef to the original element at capture time.
    // Let me do that — see collectItem update below.
    const els = selectedItems.map((it) => it._elRef).filter(Boolean);
    if (els.length < 2) {
      showCollectToast('Some items could not be regrouped (page changed?).');
      return;
    }
    const snap = buildGroupSnapshot(els);
    if (!snap) {
      showCollectToast('Could not find a common ancestor.');
      return;
    }
    // Remove the individual selected items and add a single group item
    // that aggregates them. The group keeps references to its children's
    // ids for display ("3 items grouped") and for ungroup (v2).
    const groupId = `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const childIds = selectedItems.map((it) => it.id);
    const group = {
      id: groupId,
      type: 'group',
      isGroup: true,
      name: `Group of ${childIds.length}`,
      snapshot: snap,
      childIds,
      capturedAt: Date.now(),
      sourceUrl: location.href,
      _elRef: snap._ancestorEl  // promote the ancestor ref to top-level
                                 // so positionItemOutline can find it
                                 // without reaching into snapshot
    };
    // Tear down the children's outlines first; the group is about to
    // adopt a single outline around the common ancestor and we don't
    // want stacked rectangles.
    for (const it of collectState.items) {
      if (childIds.includes(it.id)) removeItemOutline(it);
    }
    collectState.items = collectState.items.filter((it) => !childIds.includes(it.id));
    childIds.forEach((id) => collectState.selected.delete(id));
    collectState.items.push(group);
    collectState.selected.add(groupId);
    renderCollectStage();
    ensureItemOutline(group);
    showCollectToast(`Grouped ${childIds.length} items.`);
  }

  // ── Font extraction + download ────────────────────────────────────────
  // When a text element is collected, also capture the font it uses.
  // Strategy:
  //   1. Read computed font-family + weight + style of the element.
  //   2. Walk same-origin stylesheets looking for a matching @font-face.
  //   3. If found, fetch the WOFF/WOFF2 file (credentialed — works for
  //      same-origin self-hosted fonts) and inline as base64 data URL
  //      until the backend asset blob hosting (v2) is wired.
  //   4. Add a separate `font` asset to the stage, deduped by family.
  //
  // Cross-origin stylesheets (Google Fonts, Adobe Fonts CDN) throw when
  // we try to read `cssRules`. For those we record the family name only
  // and flag the asset so the backend / v2 can resolve via the Google
  // Fonts API or similar.

  function stripFontFamily(family) {
    return (family || '').split(',')[0].replace(/['"]/g, '').trim();
  }

  function findFontFaceForFamily(family) {
    const target = stripFontFamily(family).toLowerCase();
    if (!target) return null;
    for (const sheet of Array.from(document.styleSheets)) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; } // cross-origin
      if (!rules) continue;
      for (const rule of Array.from(rules)) {
        if (!(rule instanceof CSSFontFaceRule) && rule.type !== 5 /* FONT_FACE_RULE */) continue;
        const ff = stripFontFamily(rule.style?.getPropertyValue?.('font-family')).toLowerCase();
        if (ff !== target) continue;
        const src = rule.style?.getPropertyValue?.('src') || '';
        // Prefer WOFF2 → WOFF → TTF → first url
        const candidates = [];
        const rx = /url\(["']?([^"')]+)["']?\)(?:\s*format\(["']?([^"')]+)["']?\))?/g;
        let m;
        while ((m = rx.exec(src))) candidates.push({ url: m[1], format: (m[2] || '').toLowerCase() });
        if (!candidates.length) continue;
        const pref = ['woff2', 'woff', 'truetype', ''];
        candidates.sort((a, b) => pref.indexOf(a.format) - pref.indexOf(b.format));
        return {
          family: stripFontFamily(rule.style.getPropertyValue('font-family')),
          weight: rule.style.getPropertyValue('font-weight') || '400',
          style: rule.style.getPropertyValue('font-style') || 'normal',
          src: candidates[0].url,
          format: candidates[0].format
        };
      }
    }
    return null;
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  }

  async function downloadFontFile(url) {
    try {
      const abs = new URL(url, location.href).href;
      const res = await fetch(abs, { credentials: 'include' });
      if (!res.ok) return null;
      const blob = await res.blob();
      // 1MB cap for inline data URL — anything larger waits for backend
      // blob hosting. Most WOFF2 files are well under this.
      if (blob.size > 1024 * 1024) {
        return { url: abs, size: blob.size, dataUrl: null, oversized: true };
      }
      const dataUrl = await blobToDataUrl(blob);
      return { url: abs, size: blob.size, dataUrl };
    } catch {
      return null;
    }
  }

  // Capture the font for a text element. Adds a separate font asset to
  // the stage (deduped by family name). Returns the family name so the
  // caller can include it in the user-facing toast.
  async function captureFontForElement(el) {
    let family;
    try { family = stripFontFamily(getComputedStyle(el).fontFamily); }
    catch { return null; }
    if (!family) return null;
    const existing = collectState.items.find((it) => it.type === 'font' && stripFontFamily(it.snapshot.family) === family);
    if (existing) return family; // already in stage; no dup, no re-download
    const face = findFontFaceForFamily(family);
    const id = `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const cs = getComputedStyle(el);
    const item = {
      id,
      type: 'font',
      name: family,
      snapshot: {
        family,
        weight: cs.fontWeight || '400',
        style: cs.fontStyle || 'normal',
        size: cs.fontSize || '',
        face,                  // resolved @font-face or null
        fontDataUrl: null,     // populated by async download below
        fontFile: null,        // resolved url (absolute)
        oversized: false,      // true when file > 1MB (deferred to backend)
        rect: { x: 0, y: 0, w: 0, h: 0 } // fonts have no visual rect
      },
      capturedAt: Date.now(),
      sourceUrl: location.href
    };
    collectState.items.push(item);
    collectState.selected.add(id);
    renderCollectStage();
    if (face?.src) {
      // Fire-and-forget download. UI shows a "downloading…" hint on the
      // row until it resolves.
      item.snapshot.downloading = true;
      renderCollectStage();
      downloadFontFile(face.src).then((dl) => {
        item.snapshot.downloading = false;
        if (dl) {
          item.snapshot.fontFile = dl.url;
          item.snapshot.fontDataUrl = dl.dataUrl;
          item.snapshot.oversized = !!dl.oversized;
          showCollectToast(`Downloaded ${family} from this site${dl.oversized ? ' (file too large — will host on save)' : ''}`);
        } else {
          showCollectToast(`Captured "${family}" name only — could not download the file`);
        }
        renderCollectStage();
      });
    } else {
      // No @font-face match — likely a system font or cross-origin CSS.
      // Save the name; v2 will resolve via Google Fonts / system metadata.
      showCollectToast(`Captured "${family}" — system font or external CSS, no file inlined`);
    }
    return family;
  }

  // Find a staged item whose source DOM ref is this element. Used by
  // the click handlers to implement toggle-on-reclick: clicking an
  // already-collected element removes it instead of duplicating.
  function findCollectedByElement(el) {
    return collectState.items.find((it) => it._elRef === el);
  }

  // Remove an item from the stage AND tear down its persistent outline.
  // Used both by the row × button and by the toggle-on-reclick path.
  function removeItem(item) {
    if (!item) return;
    removeItemOutline(item);
    collectState.items = collectState.items.filter((it) => it.id !== item.id);
    collectState.selected.delete(item.id);
    renderCollectStage();
  }

  // ── Capture + staging ─────────────────────────────────────────────────
  function collectItem(el, type) {
    const id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const item = {
      id,
      type,
      name: deriveName(el, type),
      snapshot: captureSnapshot(el, type),
      capturedAt: Date.now(),
      sourceUrl: location.href,
      // Live reference to the source DOM node — used by Cmd+G grouping
      // to find the common ancestor. Cleared (or stale) when the page
      // mutates, in which case grouping skips that item.
      _elRef: el
    };
    collectState.items.push(item);
    collectState.selected.add(id);
    renderCollectStage();
    ensureItemOutline(item);
    showCollectToast(`Saved as ${TYPE_LABEL[type] || type} → ${item.name}`);
    // Text + leaf-text components also capture the font used. The font
    // becomes a separate, deduped asset (one per family on this page).
    if (type === 'text' || (type === 'component' && isTextLeafLike(el))) {
      captureFontForElement(el);
    }
  }

  // Lightweight check — true when the component has at least some
  // visible text and not too many nested children. Avoids triggering a
  // font capture on every <div>.
  function isTextLeafLike(el) {
    if (!el || el.nodeType !== 1) return false;
    const txt = (el.textContent || '').trim();
    if (txt.length < 4) return false;
    const sigKids = Array.from(el.children).filter((c) => {
      const r = c.getBoundingClientRect();
      return r.width > 12 && r.height > 12;
    });
    return sigKids.length <= 2;
  }

  function showCollectToast(text) {
    const t = $('#rb-collectToast');
    if (!t) return;
    t.textContent = text;
    t.hidden = false;
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.hidden = true; }, 2400);
  }

  function renderCollectStage() {
    const stage = $('#rb-collectStage');
    const count = $('#rb-collectCount');
    const selectAll = $('#rb-collectSelectAll');
    const footer = $('#rb-collectFooter');
    if (!stage) return;
    const items = collectState.items;
    if (count) count.textContent = items.length === 0 ? 'No items yet' : `${items.length} item${items.length === 1 ? '' : 's'} staged`;
    if (selectAll) selectAll.hidden = items.length < 2;
    if (footer) footer.hidden = items.length === 0;
    stage.innerHTML = '';
    if (items.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'rb-collect-empty';
      empty.textContent = 'Hover an element on the page and click to collect it.';
      stage.appendChild(empty);
      return;
    }
    for (const it of items) {
      const row = document.createElement('div');
      row.className = 'rb-collect-row' + (it.isGroup ? ' rb-collect-row-group' : '');
      row.dataset.id = it.id;
      const checked = collectState.selected.has(it.id);
      const typeLabel = it.isGroup
        ? `Group · ${it.childIds.length} item${it.childIds.length === 1 ? '' : 's'}`
        : (TYPE_LABEL[it.type] || it.type);
      // Trailing column varies by asset type: dimensions for visual
      // assets, weight + status for fonts.
      let trailing;
      if (it.type === 'font') {
        const s = it.snapshot;
        const status = s.downloading ? ' · downloading…'
                     : s.fontDataUrl ? ' · downloaded'
                     : s.oversized ? ' · oversized'
                     : s.face ? ' · pending'
                     : ' · name only';
        trailing = `<span class="rb-collect-dim">${escapeHtml((s.weight || '') + status)}</span>`;
      } else {
        trailing = `<span class="rb-collect-dim">${it.snapshot.rect.w}×${it.snapshot.rect.h}</span>`;
      }
      row.innerHTML = `
        <button type="button" class="rb-collect-check${checked ? ' checked' : ''}" data-action="toggle" aria-label="Select item">
          ${checked ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
        </button>
        <div class="rb-collect-row-body">
          <span class="rb-collect-type">${escapeHtml(typeLabel)}</span>
          <span class="rb-collect-name">${escapeHtml(it.name)}</span>
        </div>
        ${trailing}
        <button type="button" class="rb-collect-remove" data-action="remove" aria-label="Remove from stage">×</button>
      `;
      stage.appendChild(row);
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[<>&"']/g, (c) => ({ '<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;', "'":'&#39;' }[c]));
  }

  // Stage delegated handlers — toggle checkbox + remove item.
  $('#rb-collectStage')?.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset?.action;
    const row = e.target.closest('.rb-collect-row');
    if (!row || !action) return;
    const id = row.dataset.id;
    if (action === 'toggle') {
      if (collectState.selected.has(id)) collectState.selected.delete(id);
      else collectState.selected.add(id);
      renderCollectStage();
    } else if (action === 'remove') {
      const idx = collectState.items.findIndex((it) => it.id === id);
      if (idx >= 0) removeItemOutline(collectState.items[idx]);
      collectState.items = collectState.items.filter((it) => it.id !== id);
      collectState.selected.delete(id);
      renderCollectStage();
    }
  });

  // Hovering a row in the stage emphasises the persistent outline of
  // the corresponding element on the page — thicker border, slightly
  // stronger inner glow. Helps the user pair each stage row back to
  // its source element at a glance. mouseover/mouseout delegated on
  // the stage container (mouseenter/leave don't bubble).
  function emphasiseOutline(item, on) {
    const ov = item?._outlineEl;
    if (!ov) return;
    // Persistent blue border + boxShadow are NEVER changed by hover —
    // that's the steady-state "this is collected" mark. Hover only
    // washes the inside with a soft grey overlay so both directions
    // (page hover, row hover) read as the same neutral highlight.
    if (on) {
      ov.style.background = 'rgba(239, 238, 235, 0.18)';
    } else {
      ov.style.background = 'rgba(0, 149, 255, 0.05)';
    }
  }
  // Mirror of emphasiseOutline for the staging list — hovering the
  // collected element ON the page brightens its row in the widget's
  // stage, and (when needed) scrolls the row into view. Pairs both
  // directions so the user can always see where their cursor maps
  // back to in the staging list.
  function emphasiseStageRow(itemId, on) {
    const row = panel.querySelector(`#rb-collectStage .rb-collect-row[data-id="${itemId}"]`);
    if (!row) return;
    row.classList.toggle('rb-collect-row-hovered', on);
    if (on) {
      // block:'nearest' avoids scrolling when the row is already visible.
      try { row.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch {}
    }
  }
  // Combined helper — applies / clears emphasis on BOTH the on-page
  // outline AND the corresponding stage row. Called from the page-side
  // hover handler.
  function emphasiseItem(item, on) {
    if (!item) return;
    emphasiseOutline(item, on);
    emphasiseStageRow(item.id, on);
  }
  $('#rb-collectStage')?.addEventListener('mouseover', (e) => {
    const row = e.target.closest('.rb-collect-row');
    if (!row) return;
    const item = collectState.items.find((it) => it.id === row.dataset.id);
    if (item) emphasiseOutline(item, true);
  });
  $('#rb-collectStage')?.addEventListener('mouseout', (e) => {
    const row = e.target.closest('.rb-collect-row');
    if (!row) return;
    // Only fire the leave when we're actually leaving the row (not
    // moving between its children).
    const related = e.relatedTarget;
    if (related && row.contains(related)) return;
    const item = collectState.items.find((it) => it.id === row.dataset.id);
    if (item) emphasiseOutline(item, false);
  });

  $('#rb-collectSelectAll')?.addEventListener('click', () => {
    for (const it of collectState.items) collectState.selected.add(it.id);
    renderCollectStage();
  });

  // ── Destination picker — Global library / projects / New project ─────
  // Loads the user's boards from the web-shell on first open. Caches in
  // collectState so successive opens are instant. Falls back gracefully
  // when the user isn't signed in (only "Global library" + "New project
  // (sign in)" are shown).
  //
  // Selection shape (stored in collectState.destination):
  //   { kind: 'library' }                         → global asset library
  //   { kind: 'project', id: '<uuid>', name }     → existing project
  //   { kind: 'new' }                             → user picked "New
  //                                                 project"; the inline
  //                                                 name input + Create
  //                                                 button is shown next
  collectState.destination = { kind: 'library' };
  collectState.boards = [];
  collectState.boardsLoaded = false;
  collectState.boardsUnauthorized = false;
  collectState.webShellOrigin = null;

  async function ensureBoardsLoaded() {
    if (collectState.boardsLoaded) return;
    try {
      const disc = await stcDiscoverOrigin();
      collectState.webShellOrigin = disc.origin;
      collectState.boards = disc.boards || [];
      collectState.boardsUnauthorized = !!disc.unauthorized;
    } catch (e) {
      collectState.boardsUnauthorized = true;
    } finally {
      collectState.boardsLoaded = true;
    }
  }

  function renderDestMenu() {
    const menu = $('#rb-collectDestMenu');
    if (!menu) return;
    const dest = collectState.destination || { kind: 'library' };
    const rows = [];

    // Section 1 — Global library (always first)
    rows.push(`
      <button type="button" class="rb-collect-dest-opt${dest.kind === 'library' ? ' selected' : ''}" data-kind="library">
        <span class="rb-collect-dest-opt-label">Global library</span>
        ${dest.kind === 'library' ? '<span class="rb-collect-dest-opt-tick">✓</span>' : ''}
      </button>
    `);
    rows.push('<div class="rb-collect-dest-sep" aria-hidden="true"></div>');

    // Section 2 — Existing projects (only when signed in + has projects)
    if (collectState.boards.length > 0) {
      for (const b of collectState.boards) {
        const isSel = dest.kind === 'project' && dest.id === b.id;
        rows.push(`
          <button type="button" class="rb-collect-dest-opt${isSel ? ' selected' : ''}" data-kind="project" data-id="${b.id}" data-name="${escapeHtml(b.name || 'Untitled')}">
            <span class="rb-collect-dest-opt-label">${escapeHtml(b.name || 'Untitled')}</span>
            ${isSel ? '<span class="rb-collect-dest-opt-tick">✓</span>' : ''}
          </button>
        `);
      }
      rows.push('<div class="rb-collect-dest-sep" aria-hidden="true"></div>');
    } else if (collectState.boardsLoaded && !collectState.boardsUnauthorized) {
      rows.push(`<div class="rb-collect-dest-empty">No projects yet</div>`);
      rows.push('<div class="rb-collect-dest-sep" aria-hidden="true"></div>');
    } else if (collectState.boardsUnauthorized) {
      rows.push(`<div class="rb-collect-dest-empty">Sign in to load your projects</div>`);
      rows.push('<div class="rb-collect-dest-sep" aria-hidden="true"></div>');
    }

    // Section 3 — New project (always last)
    rows.push(`
      <button type="button" class="rb-collect-dest-opt rb-collect-dest-opt-new" data-kind="new">
        <span class="rb-collect-dest-opt-plus">+</span>
        <span class="rb-collect-dest-opt-label">New project${collectState.boardsUnauthorized ? ' (sign in)' : ''}</span>
      </button>
    `);

    menu.innerHTML = rows.join('');
  }

  function syncDestLabel() {
    const label = $('#rb-collectDestLabel');
    if (!label) return;
    const dest = collectState.destination || { kind: 'library' };
    if (dest.kind === 'library') label.textContent = 'Global library';
    else if (dest.kind === 'project') label.textContent = dest.name || 'Project';
    else if (dest.kind === 'new') label.textContent = 'New project…';
  }

  function openDestMenu() {
    const menu = $('#rb-collectDestMenu');
    const pill = $('#rb-collectDestPill');
    if (!menu || !pill) return;
    renderDestMenu();
    menu.hidden = false;
    pill.setAttribute('aria-expanded', 'true');
  }
  function closeDestMenu() {
    const menu = $('#rb-collectDestMenu');
    const pill = $('#rb-collectDestPill');
    if (menu) menu.hidden = true;
    if (pill) pill.setAttribute('aria-expanded', 'false');
  }

  // Pill click — load boards lazily then open menu.
  $('#rb-collectDestPill')?.addEventListener('click', async () => {
    const menu = $('#rb-collectDestMenu');
    if (menu && !menu.hidden) { closeDestMenu(); return; }
    if (!collectState.boardsLoaded) {
      await ensureBoardsLoaded();
    }
    openDestMenu();
  });

  // Menu option click — pick destination, close, and handle the
  // "New project" branch (sign-in redirect when not authed; otherwise
  // unhide the inline create row).
  $('#rb-collectDestMenu')?.addEventListener('click', (e) => {
    const opt = e.target.closest('.rb-collect-dest-opt');
    if (!opt) return;
    const kind = opt.dataset.kind;
    if (kind === 'library') {
      collectState.destination = { kind: 'library' };
      $('#rb-collectNewRow').hidden = true;
    } else if (kind === 'project') {
      collectState.destination = { kind: 'project', id: opt.dataset.id, name: opt.dataset.name };
      $('#rb-collectNewRow').hidden = true;
    } else if (kind === 'new') {
      if (collectState.boardsUnauthorized || !collectState.webShellOrigin) {
        // Not signed in — open the web-shell signup page in a new tab
        // and back off. The user can pick a destination again once they
        // return signed in (we re-load boards on next pill open).
        const origin = collectState.webShellOrigin
          || 'https://uncraft.app';
        try { window.open(`${origin}/signup`, '_blank', 'noopener,noreferrer'); } catch {}
        closeDestMenu();
        return;
      }
      collectState.destination = { kind: 'new' };
      $('#rb-collectNewRow').hidden = false;
      setTimeout(() => $('#rb-collectNewName')?.focus(), 30);
    }
    syncDestLabel();
    closeDestMenu();
  });

  // Click-outside to close
  document.addEventListener('mousedown', (e) => {
    const menu = $('#rb-collectDestMenu');
    if (!menu || menu.hidden) return;
    if (e.target.closest('.rb-collect-dest-wrap')) return;
    closeDestMenu();
  });

  // Inline "Create" — POST /api/boards then auto-select the new board
  async function createDestProject() {
    const input = $('#rb-collectNewName');
    const name = (input.value || '').trim();
    if (!name) { input?.focus(); return; }
    const btn = $('#rb-collectNewCreate');
    btn.disabled = true;
    btn.querySelector('.rb-btn-label').textContent = 'Creating…';
    try {
      if (!collectState.webShellOrigin) await ensureBoardsLoaded();
      const res = await fetch(`${collectState.webShellOrigin}/api/boards`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.board) throw new Error(json?.error || `${res.status}`);
      collectState.boards = [json.board, ...collectState.boards];
      collectState.destination = { kind: 'project', id: json.board.id, name: json.board.name };
      input.value = '';
      $('#rb-collectNewRow').hidden = true;
      syncDestLabel();
      showCollectToast(`Created project "${json.board.name}"`);
    } catch (e) {
      showCollectToast(`Could not create project: ${e?.message || e}`);
    } finally {
      btn.disabled = false;
      btn.querySelector('.rb-btn-label').textContent = 'Create';
    }
  }
  $('#rb-collectNewCreate')?.addEventListener('click', createDestProject);
  $('#rb-collectNewName')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); createDestProject(); }
  });

  // Map a staged item into the shape POST /api/assets expects. Splits
  // out the meta JSONB so the snapshot's transient bookkeeping (DOM
  // ref, rect, source url) lands there as-is, and surfaces the inline
  // font data URL into blob_url for fonts.
  function shapeAssetForApi(it, sourceUrl) {
    const base = {
      type: it.type,
      name: it.name,
      source_url: sourceUrl,
      meta: { ...(it.snapshot.meta || {}), rect: it.snapshot.rect, capturedAt: it.capturedAt }
    };
    if (it.type === 'font') {
      const s = it.snapshot;
      base.blob_url = s.fontDataUrl || null;       // inline data URL for v1
      base.meta = {
        ...base.meta,
        family: s.family,
        weight: s.weight,
        style: s.style,
        size: s.size,
        face: s.face || null,
        fontFile: s.fontFile || null,
        oversized: !!s.oversized
      };
    } else if (it.type === 'image' || it.type === 'svg' || it.type === 'video' || it.type === 'background-image') {
      base.html = it.snapshot.html || null;
      base.blob_url = it.snapshot.url || null;
      base.meta = { ...base.meta, originalUrl: it.snapshot.url || null };
    } else {
      base.html = it.snapshot.html || null;
    }
    return base;
  }

  function shapeGroupForApi(it, sourceUrl) {
    return {
      name: it.name,
      html: it.snapshot.html,
      source_url: sourceUrl,
      meta: { childCount: it.snapshot.childCount, rect: it.snapshot.rect, capturedAt: it.capturedAt }
    };
  }

  // Save → POST /api/asset-groups for groups, then POST /api/assets for
  // standalone items. Both use the discovered web-shell origin from
  // ensureBoardsLoaded(); we treat origin/auth as a hard prerequisite.
  async function saveSelectedAssets() {
    const dest = collectState.destination || { kind: 'library' };
    if (dest.kind === 'new') {
      showCollectToast('Pick a project from the dropdown first (or create one).');
      return;
    }
    if (!collectState.boardsLoaded) await ensureBoardsLoaded();
    if (!collectState.webShellOrigin) {
      showCollectToast('Could not reach Uncraft. Open the app once, then retry.');
      return;
    }
    if (collectState.boardsUnauthorized) {
      try { window.open(`${collectState.webShellOrigin}/login`, '_blank', 'noopener,noreferrer'); } catch {}
      showCollectToast('Sign in to Uncraft, then come back and retry.');
      return;
    }

    const selected = collectState.items.filter((it) => collectState.selected.has(it.id));
    if (!selected.length) return;

    const saveBtn = $('#rb-collectSave');
    saveBtn.disabled = true;
    saveBtn.querySelector('.rb-btn-label').textContent = 'Saving…';

    try {
      const sourceUrl = location.href;
      const origin = collectState.webShellOrigin;
      const groups = selected.filter((it) => it.isGroup);
      const singles = selected.filter((it) => !it.isGroup);

      // Save groups first (so we COULD wire their child items back via
      // group_id in a follow-up; v1 just saves the group snapshot).
      for (const g of groups) {
        const res = await fetch(`${origin}/api/asset-groups`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ destination: dest, group: shapeGroupForApi(g, sourceUrl) })
        });
        if (!res.ok) throw new Error(`asset-groups ${res.status}`);
      }

      // Batch the standalone items.
      if (singles.length) {
        const items = singles.map((it) => shapeAssetForApi(it, sourceUrl));
        const res = await fetch(`${origin}/api/assets`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ destination: dest, items, dedup: dest.kind === 'library' })
        });
        if (!res.ok) throw new Error(`assets ${res.status}`);
      }

      saveBtn.querySelector('.rb-btn-label').textContent = 'Saved ✓';
      const dest_label =
        dest.kind === 'library' ? 'Global library' :
        dest.kind === 'project' ? `"${dest.name}"` :
        'project';
      showCollectToast(`Saved ${selected.length} item${selected.length === 1 ? '' : 's'} to ${dest_label} →`);
      // Remove saved items from stage. Keep destination + boards cache.
      const savedIds = new Set(selected.map((it) => it.id));
      // Tear down their persistent outlines too — once saved, the on-
      // page mark goes away (the user already committed; outline noise
      // would compete with collecting new items).
      for (const it of selected) removeItemOutline(it);
      collectState.items = collectState.items.filter((it) => !savedIds.has(it.id));
      for (const id of savedIds) collectState.selected.delete(id);
      renderCollectStage();
    } catch (e) {
      showCollectToast(`Save failed: ${e?.message || e}`);
    } finally {
      saveBtn.disabled = false;
      // Restore label after a beat so the "Saved ✓" reads.
      setTimeout(() => {
        const lbl = saveBtn.querySelector('.rb-btn-label');
        if (lbl) lbl.textContent = 'Collect Selected to Assets Library';
      }, 1400);
    }
  }
  $('#rb-collectSave')?.addEventListener('click', saveSelectedAssets);

  // ── Unsaved-items confirmation flow ───────────────────────────────────
  // Promise-style wrapper around the modal. Resolves to 'save', 'discard',
  // or 'cancel' so callers can decide whether to proceed with the
  // destructive action (close, reload, Live Remix).
  function hasUnsavedItems() {
    return collectState.items.length > 0;
  }
  function openUnsavedModal({ body } = {}) {
    return new Promise((resolve) => {
      const overlay = $('#rb-unsavedOverlay');
      if (!overlay) { resolve('cancel'); return; }
      if (body) $('#rb-unsavedBody').textContent = body;
      overlay.hidden = false;
      const cleanup = () => { overlay.hidden = true; };
      const onDiscard = () => { cleanup(); resolve('discard'); };
      const onCancel = () => { cleanup(); resolve('cancel'); };
      const onSave = async () => {
        cleanup();
        try { await saveSelectedAssets(); resolve('save'); }
        catch { resolve('save'); }
      };
      $('#rb-unsavedDiscard').onclick = onDiscard;
      $('#rb-unsavedCancel').onclick = onCancel;
      $('#rb-unsavedSave').onclick = onSave;
      // Esc → Cancel (the safest default for a "you have unsaved work"
      // dialog — Discard would lose data on a misclick).
      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); document.removeEventListener('keydown', onKey, true); onCancel(); }
      };
      document.addEventListener('keydown', onKey, true);
    });
  }
  // Convenience: runs `action` after the user resolves the unsaved
  // dialog (or immediately when there's nothing pending). `action` only
  // runs on 'save' or 'discard' — 'cancel' aborts silently.
  async function guardUnsaved(action, body) {
    if (!hasUnsavedItems()) { action(); return; }
    const decision = await openUnsavedModal({ body });
    if (decision === 'cancel') return;
    // Mark stage cleared on discard so subsequent beforeunload doesn't
    // re-warn.
    if (decision === 'discard') {
      for (const it of collectState.items) removeItemOutline(it);
      collectState.items = [];
      collectState.selected.clear();
      renderCollectStage();
    }
    action();
  }

  // Intercept Live Remix click — gates the destructive page replace
  // behind the unsaved-items dialog. Wired in capture phase so we run
  // BEFORE the existing handler (which sends toggleEditor + tears down
  // the widget).
  document.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('#rb-remixSite');
    if (!t) return;
    if (!hasUnsavedItems()) return; // nothing to warn about
    e.preventDefault();
    e.stopPropagation();
    guardUnsaved(() => {
      // Re-fire the action by synthesising a click after the dialog
      // resolves. The original capture-phase listener will allow it
      // through this time because the stage is empty (no unsaved items).
      const evt = new MouseEvent('click', { bubbles: true, cancelable: true });
      t.dispatchEvent(evt);
    }, 'Live Remix will replace this page. Save your collected items first?');
  }, true);

  // Tab close / reload — beforeunload only supports the native browser
  // prompt (browsers stripped custom messages from this lifecycle for
  // security in 2017). We just set returnValue so the prompt fires;
  // the widget's own modal isn't reachable here.
  window.addEventListener('beforeunload', (e) => {
    if (!hasUnsavedItems()) return;
    e.preventDefault();
    e.returnValue = '';
    return '';
  });

  // --- Mode toggle ---
  function applyMode(mode) {
    currentMode = mode;
    panel.classList.toggle('rb-light', mode === 'light');
    panel.classList.remove('rb-expanded');
    $$('.rb-toggle-seg').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    const siteAnalysis = $('#rb-siteAnalysis');
    // In Collect Assets mode (light) the site analysis + Smart Remix
    // content panels are hidden; the Collect host (#rb-contentCollect)
    // takes their slot. The legacy #rb-contentLight (Smart Remix UI)
    // stays in the markup but hidden — its features are slated to
    // migrate to the canvas-side layers Assets tab.
    if (siteAnalysis) siteAnalysis.style.display = mode === 'dark' ? '' : 'none';
    $('#rb-contentDark').style.display = mode === 'dark' ? '' : 'none';
    $('#rb-contentLight').style.display = 'none';
    const collectHost = $('#rb-contentCollect');
    if (collectHost) collectHost.style.display = mode === 'light' ? '' : 'none';
    chrome.storage.sync.set({ activeMode: mode });
    if (mode === 'light') activateCollect(); else deactivateCollect();
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

  // --- Wire footer "Create account" link ---
  // Opens the web-shell signup page in a new tab. Uses the cached/discovered
  // origin so localhost dev users land on localhost:3030, prod on uncraft.app.
  const signupLink = $('#rb-signupLink');
  if (signupLink) signupLink.addEventListener('click', async () => {
    let origin = null;
    try {
      const disc = await stcDiscoverOrigin();
      origin = disc && disc.origin;
    } catch (e) { /* fall through to prod */ }
    const target = (origin || 'https://uncraft.app') + '/signup';
    try { window.open(target, '_blank', 'noopener,noreferrer'); } catch (e) {}
  });

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
