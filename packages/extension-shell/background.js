// Repix - Background Service Worker

importScripts('editor/semantic.js');

// ─── Model pricing (USD per 1M tokens, [input, output]) ─────────────────────
// Approximations from research/2026-04-25-pricing-synthesis.md. The synthesis
// fell back to 4.5-generation floors for Sonnet 4.6 / Opus 4.7 since 4.6/4.7
// public docs weren't fully indexed at extraction time. Used here for ESTIMATED
// per-call cost — not for billing; refresh before any pricing-decision lock.
//
// Note: I corrected the agent's Opus number ($5/$25) to the standard published
// Opus tier ($15/$75) which is consistent across recent generations.
const MODEL_PRICING = {
  'gemini-3.1-pro-preview':    [2.00,  12.00],
  'gemini-2.5-pro':            [2.00,  12.00],
  'gemini-2.5-flash':          [0.30,  2.50],
  'gemini-2.5-flash-lite':     [0.10,  0.40],
  'gemini-2.0-flash':          [0.10,  0.40],
  'gemini-1.5-pro':            [1.25,  5.00],
  'gemini-1.5-flash':          [0.075, 0.30],
  'claude-sonnet-4-6':         [3.00,  15.00],
  'claude-sonnet-4-5':         [3.00,  15.00],
  'claude-opus-4-7':           [15.00, 75.00],
  'claude-opus-4-6':           [15.00, 75.00],
  'claude-opus-4-5':           [15.00, 75.00],
  'claude-haiku-4-5-20251001': [1.00,  5.00]
};
function computeCost(model, tokensIn, tokensOut) {
  const rate = MODEL_PRICING[model];
  if (!rate) return null; // unknown model — caller logs N/A
  const inUSD = (tokensIn || 0) * rate[0] / 1_000_000;
  const outUSD = (tokensOut || 0) * rate[1] / 1_000_000;
  return inUSD + outUSD;
}
function fmtCost(usd) {
  if (usd == null) return 'N/A';
  if (usd < 0.001) return '$' + usd.toFixed(5);
  if (usd < 1)     return '$' + usd.toFixed(4);
  return '$' + usd.toFixed(3);
}

// Migrate old model names on every startup (not just onInstalled)
chrome.storage.sync.get(['model'], (settings) => {
  var old = settings.model || '';
  var outdated = ['gemini-flash-latest', 'gemini-1.5-flash-latest', 'gemini-1.5-pro-latest',
                  'gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-pro'];
  if (!old || outdated.indexOf(old) !== -1) {
    chrome.storage.sync.set({ model: 'gemini-3.1-pro-preview' });
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'repix-describe',
      title: 'Repix: Image Remix — Describe Prompt',
      contexts: ['image']
    });
    chrome.contextMenus.create({
      id: 'repix-capture',
      title: 'Repix: Capture Layout → Design Tool',
      contexts: ['page']
    });
  });
});

// ─── Open floating panel inside active tab ──────────────────────────────────

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;
  const tabId = tab.id;

  // Check if editor is active by trying to send a message
  chrome.tabs.sendMessage(tabId, { action: 'editorAttention' }, (response) => {
    if (chrome.runtime.lastError) {
      // No listener = editor not active, inject panel
      chrome.scripting.insertCSS({ target: { tabId }, files: ['panel/panel.css'] }).then(() => {
        return chrome.scripting.executeScript({ target: { tabId }, files: ['panel/panel.js'] });
      }).catch(e => console.warn('Repix: injection failed:', e));
    }
    // If no error, editor handled it (attention glow)
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'repix-capture') {
    return handleCaptureLayout(tab);
  }
  if (info.menuItemId !== 'repix-describe') return;

  const imageUrl = info.srcUrl;
  const tabId = tab.id;

  // Show loading feedback immediately
  setBadge('...', '#7c3aed', tabId);
  showNotification('Repix', 'Analyzing image with AI...');
  injectOverlay(tabId, { loading: true, text: 'Analyzing image with AI...' });

  try {
    const settings = await getSettings();

    if (!settings.apiKey && settings.apiProvider !== 'ollama') {
      throw new Error('API key not configured. Click the Repix icon to set it up.');
    }

    // 1. Fetch image as base64 (smaller limit for local models)
    const maxSize = settings.apiProvider === 'ollama' ? 768 : 1536;
    const imageData = await fetchImageAsBase64(imageUrl, maxSize);

    // 2. Send to AI for prompt description
    const { title, prompt: promptDescription } = await describeImageWithAI(imageData, settings);

    // 3. Build metadata
    const timestamp = new Date().toISOString();
    const safeName = generateFileName(imageUrl, timestamp);
    const domain = extractDomain(tab.url || '');
    const subFolder = `${settings.downloadFolder}/${sanitizeFolderName(`${title} - ${domain}`)}`;

    const metadata = {
      fileName: safeName,
      title: title,
      originalUrl: imageUrl,
      pageUrl: tab.url || '',
      pageTitle: tab.title || '',
      timestamp: timestamp,
      provider: settings.apiProvider,
      model: settings.model,
      prompt: promptDescription
    };

    // 4. Save all files inside the subfolder
    await saveAllFiles(imageData, metadata, safeName, subFolder);

    // 4b. Save to recent prompts (for popup repository)
    await saveRecentPrompt({
      id: Date.now().toString(),
      title,
      prompt: promptDescription,
      style: 'photorealistic',
      aspectRatio: '1:1',
      timestamp,
      domain,
      metadata
    });

    // 5. Success feedback
    setBadge('OK', '#065f46', tabId);
    showNotification('Repix - Saved!', `${title} — ${domain}`);
    injectOverlay(tabId, { success: true, prompt: promptDescription, fileName: safeName, folder: subFolder, metadata });

    setTimeout(() => setBadge('', '', tabId), 5000);

  } catch (error) {
    console.error('Repix error:', error);
    setBadge('ERR', '#dc2626', tabId);
    showNotification('Repix - Error', error.message);
    injectOverlay(tabId, { error: true, text: error.message });

    setTimeout(() => setBadge('', '', tabId), 5000);
  }
});

// Hash utility for cache invalidation
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + ch;
    hash |= 0;
  }
  return hash.toString(36);
}

// Helper for the Phase 2 handoff flow — captures a screenshot of the
// tab the content script ran in, then POSTs {html, screenshotDataUrl,
// title} either to /api/snapshot/handoff (token-authed, completes a
// challenge-triggered placeholder) or /api/snapshot/manual (cookie-
// authed, creates a fresh node on a chosen board).
//
// Both endpoints live on the web-shell origin which the caller provides
// — production = uncraft.app, dev = localhost:3030. The extension's
// host_permissions cover <all_urls> so credentialed fetch carries the
// uncraft_sess cookie cleanly across origins.
async function captureTabScreenshotDataUrl(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab) return null;
    const png = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    return png || null;
  } catch (e) {
    // captureVisibleTab fails on chrome:// pages, file:// without flag,
    // or when the user backgrounds the window. Not fatal — server
    // accepts null screenshots.
    console.warn('[uncraft.handoff] screenshot capture failed:', e?.message || e);
    return null;
  }
}

async function sendHandoffToWebShell({ handoff, payload, tabId }) {
  const screenshotDataUrl = await captureTabScreenshotDataUrl(tabId);
  const url = `${handoff.webShellOrigin}/api/snapshot/handoff`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Uncraft-Handoff-Token': handoff.token
    },
    body: JSON.stringify({
      html: payload.html,
      title: payload.title,
      screenshotDataUrl
    })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: json?.error || `${res.status} ${res.statusText}` };
  }
  return { ok: true, ...json };
}

async function sendManualToWebShell({ webShellOrigin, boardId, url, payload, tabId }) {
  const screenshotDataUrl = await captureTabScreenshotDataUrl(tabId);
  const endpoint = `${webShellOrigin}/api/snapshot/manual`;
  const res = await fetch(endpoint, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      boardId,
      url,
      html: payload.html,
      title: payload.title,
      screenshotDataUrl,
      width: payload.viewport?.width,
      height: payload.viewport?.height
    })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: json?.error || `${res.status} ${res.statusText}` };
  }
  return { ok: true, ...json };
}

// Listen for messages from content scripts and panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // ─── Phase 2 handoff flows ─────────────────────────────────────────────
  if (message.action === 'uncraft.handoff.send') {
    const tabId = sender.tab && sender.tab.id;
    sendHandoffToWebShell({
      handoff: message.handoff,
      payload: message.payload,
      tabId
    }).then(sendResponse).catch((e) => {
      sendResponse({ ok: false, error: String(e?.message || e) });
    });
    return true;  // async sendResponse
  }
  if (message.action === 'uncraft.manual.send') {
    const tabId = sender.tab && sender.tab.id;
    sendManualToWebShell({
      webShellOrigin: message.webShellOrigin,
      boardId: message.boardId,
      url: message.url,
      payload: message.payload,
      tabId: message.tabId || tabId
    }).then(sendResponse).catch((e) => {
      sendResponse({ ok: false, error: String(e?.message || e) });
    });
    return true;
  }

  if (message.action === 'getSettings') {
    getSettings().then(settings => sendResponse(settings));
    return true;
  }

  if (message.action === 'captureCurrentPage') {
    // Get the active tab and run the capture flow
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) handleCaptureLayout(tabs[0]);
    });
    return false;
  }

  if (message.action === 'toggleEditor') {
    const tabId = sender.tab && sender.tab.id;
    if (!tabId) { sendResponse({ok: false}); return true; }
    (async () => {
      try {
        await chrome.scripting.insertCSS({ target: { tabId }, files: ['editor/editor.css'] });
        await chrome.scripting.executeScript({ target: { tabId }, files: ['editor/detect.js'] });
        await chrome.scripting.executeScript({ target: { tabId }, files: ['editor/freeze.js'] });
        await chrome.scripting.executeScript({ target: { tabId }, files: ['editor/extractor.js'] });
        await chrome.scripting.executeScript({ target: { tabId }, files: ['editor/persist.js'] });
        await chrome.scripting.executeScript({ target: { tabId }, files: ['editor/mode-e.js'] });
        await chrome.scripting.executeScript({ target: { tabId }, files: ['editor/mode-e-classic.js'] });
        await chrome.scripting.executeScript({ target: { tabId }, files: ['editor/mode-e-diff.js'] });
        await chrome.scripting.executeScript({ target: { tabId }, files: ['editor/mode-e-refine.js'] });
        await chrome.scripting.executeScript({ target: { tabId }, files: ['editor/mode-b.js'] });
        await chrome.scripting.executeScript({ target: { tabId }, files: ['editor/mode-e2.js'] });
        await chrome.scripting.executeScript({ target: { tabId }, files: ['editor/s2h.js'] });
        await chrome.scripting.executeScript({ target: { tabId }, files: ['editor/rebuild.js'] });
        await chrome.scripting.executeScript({ target: { tabId }, files: ['editor/fill-popup.js'] });
        await chrome.scripting.executeScript({ target: { tabId }, files: ['editor/editor.js'] });
        sendResponse({ok: true});
      } catch (e) {
        console.warn('Editor injection failed:', e);
        sendResponse({ok: false, error: e.message});
      }
    })();
    return true;
  }

  if (message.action === 'semanticAnalyze') {
    const forceRefresh = message.forceRefresh || false;
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs[0]) return;
      const tab = tabs[0];
      const tabId = tab.id;
      try {
        const cacheKey = 'rb-semantic-' + new URL(tab.url).hostname + new URL(tab.url).pathname;

        // Extract page structure (always — needed for hash comparison)
        await chrome.scripting.executeScript({ target: { tabId }, files: ['editor/extractor.js'] });
        const [extractResult] = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => window.__rbExtractor?.extract?.()
        });
        const extractionData = extractResult?.result;
        if (!extractionData) throw new Error('Page extraction failed');

        // Compute hash of the page structure
        const pageHash = simpleHash(extractionData.cleanHTML || '');

        // Check permanent cache — only re-analyze if site changed or forced
        if (!forceRefresh) {
          const cached = await new Promise(r => chrome.storage.local.get(cacheKey, d => r(d[cacheKey])));
          if (cached && cached.map && cached.map.sections && cached.map.sections.length > 0 && cached.hash === pageHash) {
            console.log('[Repix] Cache hit — site unchanged (hash match). Sections:', cached.map.sections.length);
            chrome.tabs.sendMessage(tabId, { action: 'semanticResult', map: cached.map, fromCache: true }, () => { if (chrome.runtime.lastError) {} });
            return;
          }
          if (cached && cached.hash !== pageHash) {
            console.log('[Repix] Cache stale — site changed (hash mismatch). Re-analyzing...');
          }
        }

        // Build semantic map via AI
        const settings = await getSettings();
        console.log('[Repix] Building semantic map via AI...');
        const semanticMap = await buildSemanticMap(extractionData, null, settings);

        // Cache permanently with hash
        const obj = {};
        obj[cacheKey] = { map: semanticMap, hash: pageHash, timestamp: Date.now() };
        chrome.storage.local.set(obj);
        console.log('[Repix] Cached semantic map for', cacheKey, '| hash:', pageHash);

        chrome.tabs.sendMessage(tabId, { action: 'semanticResult', map: semanticMap }, () => { if (chrome.runtime.lastError) {} });
      } catch (e) {
        console.error('[Repix] Semantic analysis failed:', e);
        chrome.tabs.sendMessage(tabId, { action: 'semanticError', error: e.message }, () => { if (chrome.runtime.lastError) {} });
      }
    });
    return false;
  }

  if (message.action === 'injectNormalize') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs[0]) return;
      try {
        await chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, files: ['editor/normalize.js'] });
      } catch (e) { console.warn('Normalize injection failed:', e); }
    });
    return false;
  }

  if (message.action === 'reopenPanel') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs[0]) return;
      const tabId = tabs[0].id;
      try {
        await chrome.scripting.insertCSS({ target: { tabId }, files: ['panel/panel.css'] });
        await chrome.scripting.executeScript({ target: { tabId }, files: ['panel/panel.js'] });
      } catch (e) { console.warn('Panel reopen failed:', e); }
    });
    return false;
  }

  if (message.action === 'captureScreenshot') {
    (async () => {
      // Use the sender's tab instead of the active tab so captures stay
      // correct even if the user switches tabs during a Mode E run. Hardening
      // added after a real incident where Mode E+ on gistr.so imported
      // content from a Shopify tab the user had open in another tab — the
      // previous 150ms wait wasn't enough for Chrome's compositor to finish
      // switching the visible tab back to the sender, so captureVisibleTab
      // grabbed the prior frame.
      const tab = sender.tab;
      if (!tab) return;

      async function doCapture() {
        // Force the window itself to focus first — without this, if the user
        // is on another Chrome window, captureVisibleTab can return stale or
        // wrong content even with correct windowId.
        try { await chrome.windows.update(tab.windowId, { focused: true }); } catch (_) {}
        await chrome.tabs.update(tab.id, { active: true });
        // 500ms (up from 150ms) gives Chrome time to composite the newly-
        // activated tab before we snapshot it.
        await new Promise(r => setTimeout(r, 500));
        return chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png', quality: 100 });
      }

      try {
        let dataUrl = await doCapture();

        // Sanity check: a legitimate screenshot of any web page is at least
        // tens of KB. Sub-5KB almost certainly means we captured a blank /
        // loading / wrong tab. Retry once.
        if (!dataUrl || dataUrl.length < 5000) {
          console.warn('[Repix capture] suspicious dataUrl (' + (dataUrl ? dataUrl.length : 0) + ' bytes) — retrying once');
          await new Promise(r => setTimeout(r, 500));
          dataUrl = await doCapture();
        }

        if (message.returnData) {
          sendResponse({dataUrl: dataUrl});
        } else {
          chrome.downloads.download({
            url: dataUrl,
            filename: 'repix-screenshot.png',
            saveAs: true
          });
        }
      } catch (e) {
        console.error('Screenshot failed:', e);
        sendResponse({error: e.message});
      }
    })();
    return true; // keep channel open for async sendResponse
  }

  // Mode E: Screenshot → Vision LLM → HTML rebuild.
  // Routes to Anthropic (Claude Sonnet/Opus) or Gemini based on model name.
  // - claude-* / opus-* → Anthropic Messages API (uses anthropicKey)
  // - gemini-* (default) → Gemini generativelanguage API (uses geminiKey,
  //   falling back to legacy `apiKey` for backward compat)
  if (message.action === 'modeERebuild') {
    (async () => {
      try {
        const settings = await chrome.storage.sync.get(['apiKey', 'geminiKey', 'anthropicKey', 'model']);

        const model = message.model || settings.model || 'gemini-3.1-pro-preview';
        const isAnthropic = /^(claude|opus)/i.test(model);

        const match = message.imageDataUrl.match(/^data:(.+?);base64,(.+)$/);
        if (!match) { sendResponse({error: 'Invalid image data'}); return; }
        const [, mediaType, base64Data] = match;

        // Build provider-specific request.
        let url, headers, body, parseHtml, providerLabel;
        if (isAnthropic) {
          const anthropicKey = settings.anthropicKey || settings.apiKey;
          if (!anthropicKey) {
            sendResponse({error: 'No Anthropic API key configured for ' + model + '. Open the extension popup → Settings and paste your sk-ant-... key.'});
            return;
          }
          url = 'https://api.anthropic.com/v1/messages';
          headers = {
            'Content-Type': 'application/json',
            'x-api-key': anthropicKey,
            'anthropic-version': '2023-06-01',
            // Required to call the API directly from a browser/extension context.
            'anthropic-dangerous-direct-browser-access': 'true'
          };
          body = JSON.stringify({
            model: model,
            max_tokens: 16000,
            messages: [{
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } },
                { type: 'text', text: message.prompt }
              ]
            }]
          });
          parseHtml = (data) => {
            const block = (data.content || []).find(b => b.type === 'text');
            return (block && block.text) || '';
          };
          providerLabel = 'Anthropic';
        } else {
          const geminiKey = settings.geminiKey || settings.apiKey;
          if (!geminiKey) {
            sendResponse({error: 'No Gemini API key configured. Open the extension popup → Settings and paste your AIza... key.'});
            return;
          }
          url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
          headers = { 'Content-Type': 'application/json' };
          body = JSON.stringify({
            contents: [{
              parts: [
                { text: message.prompt },
                { inline_data: { mime_type: mediaType, data: base64Data } }
              ]
            }],
            generationConfig: { maxOutputTokens: 16000 }
          });
          parseHtml = (data) => data.candidates?.[0]?.content?.parts?.[0]?.text || '';
          providerLabel = 'Gemini';
        }

        // Rate-limit-aware fetch with exponential backoff (2s → 4s → 8s).
        // Both Gemini (429/503) and Anthropic (429/529) use these codes; we
        // treat 429/503/529 as retriable.
        const wallStart = Date.now();
        let response;
        let attempt = 0;
        const maxAttempts = 3;
        let delay = 2000;
        while (attempt < maxAttempts) {
          response = await fetch(url, { method: 'POST', headers: headers, body: body });
          const s = response.status;
          const retriable = s === 429 || s === 503 || s === 529;
          if (response.ok || !retriable || attempt === maxAttempts - 1) break;
          console.warn(`[Repix modeERebuild ${providerLabel}] ${s} on attempt ${attempt + 1}/${maxAttempts} — backing off ${delay}ms`);
          await new Promise(r => setTimeout(r, delay));
          delay *= 2;
          attempt++;
        }

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          const errMsg = err.error?.message || err.message || response.status;
          const statusHint = (response.status === 429) ? ' (rate limited after retries)' :
                             (response.status === 503 || response.status === 529) ? ' (service overloaded after retries)' : '';
          sendResponse({error: `${providerLabel} API error: ${errMsg}${statusHint}`});
          return;
        }

        const data = await response.json();
        const html = parseHtml(data);
        const wallMs = Date.now() - wallStart;

        // Provider-specific token usage extraction. Capture even on partial
        // success so the pipeline can aggregate cost from each call. Note:
        // Gemini's `usageMetadata` includes image input as part of
        // `promptTokenCount`, so the figure already reflects screenshot cost.
        let tokensIn = 0, tokensOut = 0;
        if (isAnthropic) {
          const u = (data && data.usage) || {};
          tokensIn = u.input_tokens || 0;
          tokensOut = u.output_tokens || 0;
        } else {
          const u = (data && data.usageMetadata) || {};
          tokensIn = u.promptTokenCount || 0;
          tokensOut = u.candidatesTokenCount || 0;
        }
        const costUSD = computeCost(model, tokensIn, tokensOut);

        // Single structured log line per call — easy to grep, easy to total
        // when reading a benchmark transcript by hand.
        console.log(`[Repix modeERebuild] provider=${providerLabel} model=${model} tokensIn=${tokensIn} tokensOut=${tokensOut} costUSD=${fmtCost(costUSD)} wallMs=${wallMs}`);

        sendResponse({
          html: html,
          provider: providerLabel,
          model: model,
          usage: { in: tokensIn, out: tokensOut },
          costUSD: costUSD,
          wallMs: wallMs
        });
      } catch(e) {
        sendResponse({error: e.message});
      }
    })();
    return true;
  }

  // Mode E2: text-only Gemini call, defaults to Flash for speed/cost. No image.
  // Used by the multi-call pipeline (analyze + per-section generate).
  if (message.action === 'modeE2Call') {
    (async () => {
      try {
        const settings = await chrome.storage.sync.get(['apiKey', 'modelE2']);
        const apiKey = settings.apiKey;
        if (!apiKey) { sendResponse({error: 'No API key configured.'}); return; }

        // Flash by default — E2 optimizes for latency + cost. User can override
        // via settings.modelE2 if they want to test Pro on the same pipeline.
        const model = message.model || settings.modelE2 || 'gemini-2.5-flash';
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: message.prompt }] }],
            generationConfig: {
              maxOutputTokens: 8000,
              temperature: 0.4
            }
          })
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          sendResponse({error: `E2 API error: ${err.error?.message || response.status}`});
          return;
        }
        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        sendResponse({text: text});
      } catch(e) {
        sendResponse({error: e.message});
      }
    })();
    return true;
  }

  // Mode E refinement: multi-image vision diff call.
  // Accepts 1+ image dataUrls, defaults to Flash for cost.
  // Used by the diff step and any future multi-image refinement.
  if (message.action === 'modeERefineCall') {
    (async () => {
      try {
        const settings = await chrome.storage.sync.get(['apiKey', 'modelE2']);
        const apiKey = settings.apiKey;
        if (!apiKey) { sendResponse({error: 'No API key configured.'}); return; }

        const imageDataUrls = message.imageDataUrls || [];
        if (!Array.isArray(imageDataUrls) || imageDataUrls.length === 0) {
          sendResponse({error: 'modeERefineCall requires imageDataUrls array'}); return;
        }

        const parts = [{ text: message.prompt || '' }];
        for (const url of imageDataUrls) {
          const m = (url || '').match(/^data:(.+?);base64,(.+)$/);
          if (!m) { sendResponse({error: 'Invalid image data in imageDataUrls'}); return; }
          parts.push({ inline_data: { mime_type: m[1], data: m[2] } });
        }

        const model = message.model || settings.modelE2 || 'gemini-2.5-flash';
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const body = JSON.stringify({
          contents: [{ parts }],
          generationConfig: { maxOutputTokens: message.maxOutputTokens || 8000 }
        });

        // Same rate-limit-aware retry as modeERebuild. Refine and diff calls
        // share the same Gemini quota pool, so bursts from parallel section
        // regens can trip 429s just as easily as the viewport path.
        const wallStart = Date.now();
        let response;
        let attempt = 0;
        const maxAttempts = 3;
        let delay = 2000;
        while (attempt < maxAttempts) {
          response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: body
          });
          const retriable = response.status === 429 || response.status === 503;
          if (response.ok || !retriable || attempt === maxAttempts - 1) break;
          console.warn(`[Repix modeERefineCall] ${response.status} on attempt ${attempt + 1}/${maxAttempts} — backing off ${delay}ms`);
          await new Promise(r => setTimeout(r, delay));
          delay *= 2;
          attempt++;
        }

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          const statusHint = response.status === 429 ? ' (rate limited after retries)' :
                             response.status === 503 ? ' (service overloaded after retries)' : '';
          sendResponse({error: `Gemini API error: ${err.error?.message || response.status}${statusHint}`});
          return;
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const wallMs = Date.now() - wallStart;
        const u = (data && data.usageMetadata) || {};
        const tokensIn = u.promptTokenCount || 0;
        const tokensOut = u.candidatesTokenCount || 0;
        const costUSD = computeCost(model, tokensIn, tokensOut);
        console.log(`[Repix modeERefineCall] provider=Gemini model=${model} tokensIn=${tokensIn} tokensOut=${tokensOut} costUSD=${fmtCost(costUSD)} wallMs=${wallMs}`);

        sendResponse({
          text: text,
          provider: 'Gemini',
          model: model,
          usage: { in: tokensIn, out: tokensOut },
          costUSD: costUSD,
          wallMs: wallMs
        });
      } catch (e) {
        sendResponse({error: e.message});
      }
    })();
    return true;
  }

  if (message.action === 'generateImage') {
    const { prompt, imageProvider } = message;
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs[0]) return;
      const tabId = tabs[0].id;
      try {
        const dataUrl = await generateImageWithAI(prompt, imageProvider);
        chrome.tabs.sendMessage(tabId, { action: 'imageGenerated', dataUrl }, () => { if (chrome.runtime.lastError) { /* panel may not be open */ } });
      } catch (err) {
        chrome.tabs.sendMessage(tabId, { action: 'imageGenError', error: err.message }, () => { if (chrome.runtime.lastError) { /* panel may not be open */ } });
      }
    });
    return false;
  }

  if (message.action === 'describeImage') {
    // Trigger image describe from panel (same as context menu)
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs[0]) return;
      const tab = tabs[0];
      const tabId = tab.id;
      const imageUrl = message.imageUrl;
      if (!imageUrl) return;

      setBadge('...', '#7c3aed', tabId);
      try {
        const settings = await getSettings();
        if (!settings.apiKey && settings.apiProvider !== 'ollama') {
          throw new Error('API key not configured.');
        }
        const maxSize = settings.apiProvider === 'ollama' ? 768 : 1536;
        const imageData = await fetchImageAsBase64(imageUrl, maxSize);
        const { title, prompt: promptDescription, structuredJson } = await describeImageWithAI(imageData, settings);
        const timestamp = new Date().toISOString();
        const domain = extractDomain(tab.url || '');

        const jsonData = structuredJson || { style: 'photorealistic', aspectRatio: '1:1' };

        await saveRecentPrompt({
          id: Date.now().toString(),
          title,
          prompt: promptDescription,
          style: jsonData.style || 'photorealistic',
          aspectRatio: jsonData.aspectRatio || '1:1',
          timestamp,
          domain,
          imageUrl,
          structuredJson: jsonData
        });

        setBadge('OK', '#065f46', tabId);
        setTimeout(() => setBadge('', '', tabId), 3000);
        // Notify panel that prompt is ready
        chrome.tabs.sendMessage(tabId, {
          action: 'promptReady',
          title,
          prompt: promptDescription,
          imageUrl,
          structuredJson: jsonData,
          provider: settings.apiProvider,
          metadata: { style: jsonData.style, aspectRatio: jsonData.aspectRatio, domain, timestamp }
        }, () => { if (chrome.runtime.lastError) { /* panel may not be open */ } });
      } catch (error) {
        console.error('Image describe error:', error);
        setBadge('ERR', '#dc2626', tabId);
        setTimeout(() => setBadge('', '', tabId), 3000);
        chrome.tabs.sendMessage(tabId, { action: 'promptError', error: error.message }, () => {
          if (chrome.runtime.lastError) { /* panel may not be open — ignore */ }
        });
      }
    });
    return false;
  }
});

function setBadge(text, color, tabId) {
  try {
    chrome.action.setBadgeText({ text, tabId });
    if (color) chrome.action.setBadgeBackgroundColor({ color, tabId });
  } catch (e) {
    console.warn('Badge error:', e);
  }
}

function showNotification(title, message) {
  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: title,
      message: message
    });
  } catch (e) {
    console.warn('Notification error:', e);
  }
}

async function injectOverlay(tabId, state) {
  try {
    // Inject CSS first
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ['styles/content.css']
    });

    // Then inject the overlay via scripting
    await chrome.scripting.executeScript({
      target: { tabId },
      func: showOverlayInPage,
      args: [state]
    });
  } catch (e) {
    console.warn('Could not inject overlay:', e);
  }
}

// This function runs IN the page context
function showOverlayInPage(state) {
  // Remove existing overlay
  const existing = document.getElementById('repix-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'repix-overlay';

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  let bodyContent = '';

  if (state.loading) {
    bodyContent = `
      <div class="ezp-spinner"></div>
      <p class="ezp-status">${escapeHtml(state.text)}</p>
    `;
  } else if (state.error) {
    bodyContent = `
      <p class="ezp-error">${escapeHtml(state.text)}</p>
    `;
  } else if (state.success) {
    const jsonStr = state.metadata ? JSON.stringify(state.metadata, null, 2) : '{}';
    bodyContent = `
      <div class="ezp-success-badge">Saved!</div>
      <p class="ezp-filename">📁 ${escapeHtml(state.folder || '')}</p>
      <div class="ezp-tabs">
        <button class="ezp-tab ezp-tab-active" data-tab="both">Prompt + Json</button>
        <button class="ezp-tab" data-tab="prompt">Prompt</button>
        <button class="ezp-tab" data-tab="json">Json</button>
      </div>
      <div class="ezp-tab-content ezp-tab-visible" data-content="both">
        <div class="ezp-prompt-box">
          <label>Generated Prompt:</label>
          <div class="ezp-prompt-text">${escapeHtml(state.prompt)}</div>
        </div>
        <div class="ezp-prompt-box">
          <label>Metadata (JSON):</label>
          <div class="ezp-prompt-text ezp-json-text">${escapeHtml(jsonStr)}</div>
        </div>
      </div>
      <div class="ezp-tab-content" data-content="prompt">
        <div class="ezp-prompt-box">
          <label>Generated Prompt:</label>
          <div class="ezp-prompt-text">${escapeHtml(state.prompt)}</div>
        </div>
      </div>
      <div class="ezp-tab-content" data-content="json">
        <div class="ezp-prompt-box">
          <label>Metadata (JSON):</label>
          <div class="ezp-prompt-text ezp-json-text">${escapeHtml(jsonStr)}</div>
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
      </div>
    `;
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
      <div class="ezp-body">
        ${bodyContent}
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Close button
  overlay.querySelector('#ezp-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

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
      // Update copy button label
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

// ─── Layout Capture for Figma ───────────────────────────────────────────────

const API_BASE = 'https://repix.vercel.app'; // Change to your deployed URL

async function handleCaptureLayout(tab) {
  const tabId = tab.id;

  setBadge('...', '#7c3aed', tabId);
  injectOverlay(tabId, { loading: true, text: 'Checking account...' });

  try {
    // Check auth
    const { authToken } = await chrome.storage.sync.get({ authToken: '' });
    if (!authToken) {
      throw new Error('Sign in required. Click the Repix icon to connect your account.');
    }

    // Validate token and check plan/usage
    const authRes = await fetch(`${API_BASE}/api/auth/validate`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!authRes.ok) {
      chrome.storage.sync.remove('authToken');
      throw new Error('Session expired. Please sign in again.');
    }
    const { user } = await authRes.json();
    if (user.plan === 'free' && user.capturesUsed >= user.capturesLimit) {
      throw new Error(`Free plan limit reached (${user.capturesLimit}/month). Upgrade to Pro for unlimited captures.`);
    }

    injectOverlay(tabId, { loading: true, text: 'Capturing layout...' });
    const backendUrl = API_BASE;

    // 1. Take screenshot
    const screenshotDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: 'png', quality: 92
    });

    // 2. Inject DOM capture script
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: captureDOMTree
    });

    const domTree = result.result;

    // 3. Send to backend
    const payload = {
      url: tab.url,
      title: tab.title,
      screenshot: screenshotDataUrl,
      viewport: domTree.viewport,
      tree: domTree.tree,
      timestamp: new Date().toISOString()
    };

    const response = await fetch(`${backendUrl}/api/captures`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) throw new Error(`Backend error: ${response.status}`);
    const { id } = await response.json();

    // 4b. Save to recent captures
    await saveRecentCapture({
      id: Date.now().toString(),
      captureId: id,
      url: tab.url,
      domain: extractDomain(tab.url),
      title: tab.title,
      timestamp: new Date().toISOString()
    });

    // 4c. Success
    setBadge('OK', '#065f46', tabId);
    injectOverlay(tabId, {
      success: true,
      prompt: `Capture ID: ${id}\n\nOpen the Repix plugin in your design tool and paste this ID to import the layout.`,
      metadata: { captureId: id, url: tab.url, title: tab.title, backendUrl },
      fileName: '',
      folder: `Layout captured → ${extractDomain(tab.url)}`
    });
    chrome.tabs.sendMessage(tabId, { action: 'captureSuccess', captureId: id }, () => { if (chrome.runtime.lastError) { /* panel may not be open */ } });
    setTimeout(() => setBadge('', '', tabId), 5000);

  } catch (error) {
    console.error('Repix capture error:', error);
    setBadge('ERR', '#dc2626', tabId);
    injectOverlay(tabId, { error: true, text: `Capture failed: ${error.message}` });
    chrome.tabs.sendMessage(tabId, { action: 'captureError', error: error.message }, () => { if (chrome.runtime.lastError) { /* panel may not be open */ } });
    setTimeout(() => setBadge('', '', tabId), 5000);
  }
}

// This function runs IN the page context to capture the DOM tree
function captureDOMTree() {
  const MAX_DEPTH = 15;
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'LINK', 'META', 'HEAD', 'BR', 'HR']);
  const INLINE_TEXT_TAGS = new Set(['SPAN', 'A', 'STRONG', 'EM', 'B', 'I', 'U', 'SMALL', 'CODE', 'MARK', 'SUB', 'SUP']);

  function getTextContent(el) {
    let text = '';
    for (const child of el.childNodes) {
      if (child.nodeType === 3) text += child.textContent;
      else if (child.nodeType === 1 && INLINE_TEXT_TAGS.has(child.tagName)) text += child.textContent;
    }
    return text.trim();
  }

  function extractStyles(el) {
    const cs = window.getComputedStyle(el);
    return {
      display: cs.display,
      position: cs.position,
      overflow: cs.overflow,
      flexDirection: cs.flexDirection,
      justifyContent: cs.justifyContent,
      alignItems: cs.alignItems,
      gap: cs.gap,
      backgroundColor: cs.backgroundColor,
      color: cs.color,
      fontSize: cs.fontSize,
      fontFamily: cs.fontFamily,
      fontWeight: cs.fontWeight,
      lineHeight: cs.lineHeight,
      letterSpacing: cs.letterSpacing,
      textAlign: cs.textAlign,
      borderRadius: cs.borderRadius,
      border: cs.border,
      borderColor: cs.borderColor,
      borderWidth: cs.borderWidth,
      borderStyle: cs.borderStyle,
      padding: cs.padding,
      paddingTop: cs.paddingTop,
      paddingRight: cs.paddingRight,
      paddingBottom: cs.paddingBottom,
      paddingLeft: cs.paddingLeft,
      margin: cs.margin,
      opacity: cs.opacity,
      boxShadow: cs.boxShadow,
      backgroundImage: cs.backgroundImage,
      visibility: cs.visibility,
      width: cs.width,
      height: cs.height,
      maxWidth: cs.maxWidth,
      minHeight: cs.minHeight
    };
  }

  function walkDOM(el, depth) {
    if (depth > MAX_DEPTH) return null;
    if (!(el instanceof HTMLElement)) return null;
    if (SKIP_TAGS.has(el.tagName)) return null;

    const styles = extractStyles(el);
    if (styles.display === 'none' || styles.visibility === 'hidden') return null;

    const rect = el.getBoundingClientRect();
    if (rect.width < 1 && rect.height < 1) return null;

    const classes = Array.from(el.classList).slice(0, 5).join('.');
    const tag = el.tagName.toLowerCase();
    const name = classes ? `${tag}.${classes}` : tag;

    const node = {
      tag,
      name,
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.width),
        h: Math.round(rect.height)
      },
      styles
    };

    // Check if it's an image
    if (tag === 'img') {
      node.isImage = true;
      node.src = el.src;
      node.alt = el.alt || '';
    }

    // Check for background image
    if (styles.backgroundImage && styles.backgroundImage !== 'none') {
      node.hasBackgroundImage = true;
    }

    // Extract text content (only direct text, not nested)
    const text = getTextContent(el);
    if (text) {
      node.text = text.slice(0, 500);
    }

    // Recurse children
    const children = [];
    for (const child of el.children) {
      const childNode = walkDOM(child, depth + 1);
      if (childNode) children.push(childNode);
    }
    if (children.length > 0) node.children = children;

    return node;
  }

  const tree = walkDOM(document.body, 0);
  return {
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollHeight: document.documentElement.scrollHeight
    },
    tree
  };
}

// ─── Storage Helpers for Popup Repository ───────────────────────────────────

async function saveRecentPrompt(prompt) {
  const { recentPrompts = [] } = await chrome.storage.local.get({ recentPrompts: [] });
  recentPrompts.unshift(prompt);
  if (recentPrompts.length > 50) recentPrompts.length = 50;
  await chrome.storage.local.set({ recentPrompts });
}

async function saveRecentCapture(capture) {
  const { recentCaptures = [] } = await chrome.storage.local.get({ recentCaptures: [] });
  recentCaptures.unshift(capture);
  if (recentCaptures.length > 50) recentCaptures.length = 50;
  await chrome.storage.local.set({ recentCaptures });
}

function getSettings() {
  return new Promise(resolve => {
    chrome.storage.sync.get({
      apiProvider: 'gemini',
      apiKey: '',
      model: 'gemini-3.1-pro-preview',
      ollamaUrl: 'http://localhost:11434',
      language: 'en',
      downloadFolder: 'Repix',
      stabilityApiKey: '',
      replicateApiKey: '',
      imageProvider: 'stability'
    }, resolve);
  });
}

async function fetchImageAsBase64(url, maxSize = 1536) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
  const blob = await response.blob();

  // Resize large images to prevent model crashes (especially moondream)
  try {
    const bitmap = await createImageBitmap(blob);
    const { width, height } = bitmap;
    const needsResize = width > maxSize || height > maxSize;

    if (needsResize) {
      const ratio = Math.min(maxSize / width, maxSize / height);
      const canvas = new OffscreenCanvas(Math.round(width * ratio), Math.round(height * ratio));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const resized = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.88 });
      return blobToDataUrl(resized);
    }
    bitmap.close();
  } catch (e) {
    // OffscreenCanvas not available or image undecodable — use original
  }

  return blobToDataUrl(blob);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function describeImageWithAI(imageDataUrl, settings) {
  const langInstruction = settings.language === 'pt'
    ? 'Responda em português brasileiro.'
    : settings.language === 'es'
    ? 'Responda en español.'
    : 'Respond in English.';

  const systemPrompt = `You are an expert at reverse-engineering image generation prompts. Analyze the image in extreme detail. Respond with EXACTLY this format (no extra text):

TITLE: [2-4 words]

PROMPT: [full detailed prompt to recreate this image — be very specific and lengthy]

JSON:
\`\`\`json
{
  "subject": {
    "main": "[main subject described in detail]",
    "details": ["detail1", "detail2", "detail3"],
    "action": "[what the subject is doing]",
    "pose": "[body pose if applicable]",
    "expression": "[facial expression if applicable]",
    "skinTone": "[skin tone if person visible]",
    "hair": "[hair description if applicable]",
    "clothing": "[outfit/clothing description]",
    "accessories": "[accessories, jewelry, props]"
  },
  "environment": {
    "setting": "[indoor, outdoor, studio, urban, nature, etc.]",
    "foreground": "[foreground elements]",
    "background": "[background description]",
    "objects": ["object1", "object2", "object3"],
    "atmosphere": "[foggy, clear, hazy, ethereal, etc.]",
    "weather": "[sunny, rainy, cloudy, etc. if applicable]",
    "timeOfDay": "[morning, golden hour, night, etc.]"
  },
  "style": {
    "medium": "[photography, digital art, watercolor, oil painting, 3d render, anime, vector, etc.]",
    "artStyle": "[photorealistic, impressionist, minimalist, surreal, etc.]",
    "designStyle": "[flat, material, brutalist, art deco, etc. if applicable]",
    "era": "[modern, vintage, retro, futuristic, etc.]",
    "influences": ["artist or style reference 1", "reference 2"]
  },
  "color": {
    "palette": ["#hex1", "#hex2", "#hex3", "#hex4", "#hex5"],
    "temperature": "[warm, cool, neutral]",
    "contrast": "[high, low, medium]",
    "saturation": "[vivid, muted, desaturated, monochrome]",
    "dominantColor": "[the dominant color]",
    "accentColor": "[the accent/highlight color]"
  },
  "mood": {
    "emotion": "[serene, dramatic, joyful, melancholic, tense, etc.]",
    "tone": "[dark, bright, dreamy, gritty, elegant, etc.]",
    "energy": "[calm, dynamic, chaotic, peaceful, etc.]"
  },
  "camera": {
    "angle": "[eye level, high angle, low angle, bird's eye, dutch, etc.]",
    "lens": "[wide angle, telephoto, macro, fisheye, 35mm, 85mm, etc.]",
    "depthOfField": "[shallow/bokeh, deep, tilt-shift]",
    "perspective": "[first person, third person, isometric, etc.]",
    "framing": "[close-up, medium shot, wide shot, extreme close-up, etc.]"
  },
  "lighting": {
    "type": "[natural, studio, dramatic, rim light, neon, etc.]",
    "direction": "[front, back, side, top, bottom, ambient]",
    "shadows": "[soft, hard, long, minimal, etc.]",
    "highlights": "[specular, diffused, bloom, etc.]"
  },
  "technical": {
    "texture": "[smooth, grainy, rough, glossy, matte]",
    "postProcessing": "[film grain, vignette, bloom, chromatic aberration, none]",
    "aspectRatio": "[1:1, 16:9, 4:3, 9:16, 3:2]",
    "quality": "[4k, 8k, ultra detailed, masterpiece]",
    "negativePrompt": "[what to avoid]"
  }
}
\`\`\`
Fill EVERY field. Use hex for colors. Be specific. If a field doesn't apply, use "n/a".
${langInstruction}`;

  if (settings.apiProvider === 'anthropic') {
    return describeWithAnthropic(imageDataUrl, systemPrompt, settings);
  }
  if (settings.apiProvider === 'gemini') {
    return describeWithGemini(imageDataUrl, systemPrompt, settings);
  }
  if (settings.apiProvider === 'ollama') {
    return describeWithOllama(imageDataUrl, systemPrompt, settings);
  }
  return describeWithOpenAI(imageDataUrl, systemPrompt, settings);
}

async function describeWithOpenAI(imageDataUrl, systemPrompt, settings) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify({
      model: settings.model,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Analyze this image and describe the detailed prompt that could recreate it. Be specific about style, subjects, composition, colors, lighting, and mood.'
            },
            {
              type: 'image_url',
              image_url: { url: imageDataUrl, detail: 'high' }
            }
          ]
        }
      ],
      max_tokens: 2000
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`OpenAI API error: ${err.error?.message || response.status}`);
  }

  const data = await response.json();
  return parseAIResponse(data.choices[0].message.content);
}

async function describeWithOllama(imageDataUrl, systemPrompt, settings) {
  const match = imageDataUrl.match(/^data:(.+?);base64,(.+)$/);
  if (!match) throw new Error('Invalid image data');
  const [, , base64Data] = match;

  const baseUrl = (settings.ollamaUrl || 'http://localhost:11434').replace(/\/$/, '');
  const model = settings.model || 'moondream';
  const userPrompt = `${systemPrompt}\n\nAnalyze this image and describe the detailed prompt that could recreate it. Be specific about style, subjects, composition, colors, lighting, and mood.`;

  // Strategy: open a background tab at localhost:11434 so the injected
  // content script has Origin: http://localhost:11434 — same-origin for Ollama,
  // bypassing CORS entirely without any server-side configuration.
  const tab = await chrome.tabs.create({ url: baseUrl, active: false });
  const tabId = tab.id;

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      chrome.tabs.remove(tabId).catch(() => {});
      reject(new Error('Ollama request timed out. Is the model loaded?'));
    }, 180000); // 3 minutes for large models

    function cleanup() {
      clearTimeout(timeoutId);
      chrome.tabs.remove(tabId).catch(() => {});
    }

    const messageListener = (message, sender) => {
      if (sender.tab?.id === tabId && message.type === 'REPIX_OLLAMA') {
        chrome.runtime.onMessage.removeListener(messageListener);
        cleanup();
        if (message.success) resolve(parseAIResponse(message.result));
        else reject(new Error(message.error));
      }
    };
    chrome.runtime.onMessage.addListener(messageListener);

    const tabListener = (updatedTabId, changeInfo) => {
      if (updatedTabId !== tabId || changeInfo.status !== 'complete') return;
      chrome.tabs.onUpdated.removeListener(tabListener);

      chrome.scripting.executeScript({
        target: { tabId },
        func: (url, mdl, prompt, imgData) => {
          fetch(`${url}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: mdl, prompt, images: [imgData], stream: false })
          })
          .then(r => {
            if (!r.ok) return r.text().then(t => { throw new Error(`HTTP ${r.status}: ${t}`); });
            return r.json();
          })
          .then(data => chrome.runtime.sendMessage({
            type: 'REPIX_OLLAMA', success: true, result: data.response  // parsed in background
          }))
          .catch(err => chrome.runtime.sendMessage({
            type: 'REPIX_OLLAMA', success: false, error: err.message
          }));
        },
        args: [baseUrl, model, userPrompt, base64Data]
      }).catch(err => {
        chrome.runtime.onMessage.removeListener(messageListener);
        cleanup();
        reject(new Error(`Script injection failed: ${err.message}. Make sure Ollama is running.`));
      });
    };
    chrome.tabs.onUpdated.addListener(tabListener);
  });
}

async function describeWithGemini(imageDataUrl, systemPrompt, settings) {
  const match = imageDataUrl.match(/^data:(.+?);base64,(.+)$/);
  if (!match) throw new Error('Invalid image data');
  const [, mediaType, base64Data] = match;

  const model = settings.model || 'gemini-3.1-pro-preview';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${settings.apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{
        parts: [
          { text: 'Analyze this image and describe the detailed prompt that could recreate it. Be specific about style, subjects, composition, colors, lighting, and mood.' },
          { inline_data: { mime_type: mediaType, data: base64Data } }
        ]
      }],
      generationConfig: { maxOutputTokens: 2000 }
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`Gemini API error: ${err.error?.message || response.status}`);
  }

  const data = await response.json();
  return parseAIResponse(data.candidates[0].content.parts[0].text);
}

async function describeWithAnthropic(imageDataUrl, systemPrompt, settings) {
  const match = imageDataUrl.match(/^data:(.+?);base64,(.+)$/);
  if (!match) throw new Error('Invalid image data');
  const [, mediaType, base64Data] = match;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: settings.model || 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64Data
              }
            },
            {
              type: 'text',
              text: 'Analyze this image and describe the detailed prompt that could recreate it. Be specific about style, subjects, composition, colors, lighting, and mood.'
            }
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`Anthropic API error: ${err.error?.message || response.status}`);
  }

  const data = await response.json();
  return parseAIResponse(data.content[0].text);
}

function parseAIResponse(text) {
  const titleMatch = text.match(/^TITLE:\s*(.+)/im);
  const title = titleMatch ? titleMatch[1].trim().slice(0, 60) : text.trim().split(/\s+/).slice(0, 4).join(' ');

  // Extract PROMPT section
  const promptMatch = text.match(/PROMPT:\s*([\s\S]*?)(?=\nJSON:|```json|$)/im);
  const prompt = promptMatch ? promptMatch[1].trim() : text.replace(/^TITLE:\s*.+\n*/im, '').trim();

  // Extract JSON block
  let structuredJson = null;
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/);
  if (jsonMatch) {
    try { structuredJson = JSON.parse(jsonMatch[1].trim()); } catch (e) { /* ignore parse errors */ }
  }
  if (!structuredJson) {
    const rawJson = text.match(/\{[\s\S]*"style"[\s\S]*\}/);
    if (rawJson) {
      try { structuredJson = JSON.parse(rawJson[0]); } catch (e) { /* ignore */ }
    }
  }

  return { title, prompt, structuredJson };
}

function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

function sanitizeFolderName(name) {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function generateFileName(url, timestamp) {
  const date = timestamp.replace(/[:.]/g, '-').slice(0, 19);
  let name = '';
  try {
    const urlObj = new URL(url);
    const path = urlObj.pathname;
    const baseName = path.split('/').pop()?.split('.')[0] || '';
    name = baseName.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
  } catch {
    name = 'image';
  }
  return `${date}_${name || 'image'}`;
}

async function saveAllFiles(imageDataUrl, metadata, safeName, folder) {
  // URL.createObjectURL is not available in MV3 service workers.
  // Extract mime type directly from the data URL instead.
  const mimeMatch = imageDataUrl.match(/^data:(.+?);base64,/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
  const ext = getExtensionFromMime(mimeType);

  // 1. Save image - data URL works directly with chrome.downloads
  await downloadFile(imageDataUrl, `${folder}/${safeName}.${ext}`);

  // 2. Save .md with prompt
  const mdContent = buildMarkdown(metadata, ext);
  await downloadFile(textToDataUrl(mdContent, 'text/markdown'), `${folder}/${safeName}.md`);

  // 3. Save .json with metadata
  const jsonContent = JSON.stringify(metadata, null, 2);
  await downloadFile(textToDataUrl(jsonContent, 'application/json'), `${folder}/${safeName}.json`);
}

function textToDataUrl(text, mimeType) {
  // btoa only handles latin1 — encode UTF-8 safely first
  const encoded = btoa(unescape(encodeURIComponent(text)));
  return `data:${mimeType};charset=utf-8;base64,${encoded}`;
}

function buildMarkdown(metadata, ext) {
  return `# Repix - Image Prompt Description

## Image
![${metadata.fileName}](./${metadata.fileName}.${ext})

## Prompt
${metadata.prompt}

## Metadata
- **Source URL:** ${metadata.originalUrl}
- **Page:** ${metadata.pageTitle} (${metadata.pageUrl})
- **Date:** ${metadata.timestamp}
- **AI Provider:** ${metadata.provider}
- **Model:** ${metadata.model}
`;
}

function getExtensionFromMime(mimeType) {
  const map = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp',
    'image/avif': 'avif'
  };
  return map[mimeType] || 'png';
}

// ─── Image Generation ─────────────────────────────────────────────────────

async function generateImageWithAI(prompt, imageProvider) {
  const settings = await getSettings();

  if (imageProvider === 'stability') {
    return generateWithStability(prompt, settings);
  } else if (imageProvider === 'openai') {
    return generateWithDallE(prompt, settings);
  } else if (imageProvider === 'gemini') {
    return generateWithImagen(prompt, settings);
  } else if (imageProvider === 'replicate') {
    return generateWithReplicate(prompt, settings);
  } else {
    throw new Error('Unsupported image generation provider: ' + imageProvider);
  }
}

async function generateWithStability(prompt, settings) {
  const key = settings.stabilityApiKey;
  if (!key) throw new Error('Stability AI API key not configured.');

  const formData = new FormData();
  formData.append('prompt', prompt);
  formData.append('output_format', 'png');

  const response = await fetch('https://api.stability.ai/v2beta/stable-image/generate/sd3', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Accept': 'image/*'
    },
    body: formData
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Stability AI error: ${response.status} ${errText}`);
  }

  const blob = await response.blob();
  return blobToDataUrl(blob);
}

async function generateWithDallE(prompt, settings) {
  const key = settings.apiKey;
  if (!key) throw new Error('OpenAI API key not configured.');

  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`
    },
    body: JSON.stringify({
      model: 'dall-e-3',
      prompt: prompt,
      size: '1024x1024',
      response_format: 'b64_json'
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`OpenAI DALL-E error: ${err.error?.message || response.status}`);
  }

  const data = await response.json();
  const b64 = data.data[0].b64_json;
  return `data:image/png;base64,${b64}`;
}

async function generateWithImagen(prompt, settings) {
  const key = settings.apiKey;
  if (!key) throw new Error('Gemini API key not configured.');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${key}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [{ prompt: prompt }],
      parameters: { sampleCount: 1 }
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`Gemini Imagen error: ${err.error?.message || response.status}`);
  }

  const data = await response.json();
  const b64 = data.predictions[0].bytesBase64Encoded;
  return `data:image/png;base64,${b64}`;
}

async function generateWithReplicate(prompt, settings) {
  const key = settings.replicateApiKey;
  if (!key) throw new Error('Replicate API key not configured.');

  // Create prediction
  const createResponse = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`
    },
    body: JSON.stringify({
      version: '39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b',
      input: { prompt: prompt }
    })
  });

  if (!createResponse.ok) {
    const err = await createResponse.json().catch(() => ({}));
    throw new Error(`Replicate error: ${err.detail || createResponse.status}`);
  }

  const prediction = await createResponse.json();
  let pollUrl = prediction.urls?.get || `https://api.replicate.com/v1/predictions/${prediction.id}`;

  // Poll until complete (max 120 seconds)
  const maxAttempts = 60;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const pollResponse = await fetch(pollUrl, {
      headers: { 'Authorization': `Bearer ${key}` }
    });
    if (!pollResponse.ok) throw new Error(`Replicate poll error: ${pollResponse.status}`);
    const result = await pollResponse.json();

    if (result.status === 'succeeded') {
      const outputUrl = Array.isArray(result.output) ? result.output[0] : result.output;
      if (!outputUrl) throw new Error('Replicate returned no output.');
      // Fetch the image and convert to data URL
      const imgResponse = await fetch(outputUrl);
      if (!imgResponse.ok) throw new Error('Failed to fetch generated image from Replicate.');
      const blob = await imgResponse.blob();
      return blobToDataUrl(blob);
    } else if (result.status === 'failed' || result.status === 'canceled') {
      throw new Error(`Replicate generation ${result.status}: ${result.error || 'unknown error'}`);
    }
    // else still processing, keep polling
  }
  throw new Error('Replicate generation timed out after 120 seconds.');
}

function downloadFile(url, filename) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download({ url, filename, saveAs: false }, downloadId => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(downloadId);
      }
    });
  });
}
