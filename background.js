// EzPrompter - Background Service Worker

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'ezprompter-describe',
    title: 'RepixBridge: Image Remix — Describe Prompt',
    contexts: ['image']
  });
  chrome.contextMenus.create({
    id: 'ezprompter-capture',
    title: 'RepixBridge: Capture Layout → Design Tool',
    contexts: ['page']
  });
});

// ─── Open floating panel inside active tab ──────────────────────────────────

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;
  const tabId = tab.id;

  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ['panel/panel.css']
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['panel/panel.js']
    });
  } catch (e) {
    console.warn('Could not inject panel:', e);
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'ezprompter-capture') {
    return handleCaptureLayout(tab);
  }
  if (info.menuItemId !== 'ezprompter-describe') return;

  const imageUrl = info.srcUrl;
  const tabId = tab.id;

  // Show loading feedback immediately
  setBadge('...', '#7c3aed', tabId);
  showNotification('EzPrompter', 'Analyzing image with AI...');
  injectOverlay(tabId, { loading: true, text: 'Analyzing image with AI...' });

  try {
    const settings = await getSettings();

    if (!settings.apiKey && settings.apiProvider !== 'ollama') {
      throw new Error('API key not configured. Click the EzPrompter icon to set it up.');
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
    showNotification('RepixBridge - Saved!', `${title} — ${domain}`);
    injectOverlay(tabId, { success: true, prompt: promptDescription, fileName: safeName, folder: subFolder, metadata });

    setTimeout(() => setBadge('', '', tabId), 5000);

  } catch (error) {
    console.error('EzPrompter error:', error);
    setBadge('ERR', '#dc2626', tabId);
    showNotification('EzPrompter - Error', error.message);
    injectOverlay(tabId, { error: true, text: error.message });

    setTimeout(() => setBadge('', '', tabId), 5000);
  }
});

// Also listen for messages from content script (fallback)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getSettings') {
    getSettings().then(settings => sendResponse(settings));
    return true;
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
  const existing = document.getElementById('ezprompter-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'ezprompter-overlay';

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
          <span class="ezp-logo">RepixBridge</span>
          <span class="ezp-tagline">Remix everything. Paste your prompt in the AI of your choice.</span>
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

const API_BASE = 'https://ezprompter.vercel.app'; // Change to your deployed URL

async function handleCaptureLayout(tab) {
  const tabId = tab.id;

  setBadge('...', '#7c3aed', tabId);
  injectOverlay(tabId, { loading: true, text: 'Checking account...' });

  try {
    // Check auth
    const { authToken } = await chrome.storage.sync.get({ authToken: '' });
    if (!authToken) {
      throw new Error('Sign in required. Click the EzPrompter icon to connect your account.');
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
      prompt: `Capture ID: ${id}\n\nOpen the RepixBridge plugin in your design tool and paste this ID to import the layout.`,
      metadata: { captureId: id, url: tab.url, title: tab.title, backendUrl },
      fileName: '',
      folder: `Layout captured → ${extractDomain(tab.url)}`
    });
    setTimeout(() => setBadge('', '', tabId), 5000);

  } catch (error) {
    console.error('EzPrompter capture error:', error);
    setBadge('ERR', '#dc2626', tabId);
    injectOverlay(tabId, { error: true, text: `Capture failed: ${error.message}` });
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
      model: 'gemini-2.0-flash',
      ollamaUrl: 'http://localhost:11434',
      language: 'en',
      downloadFolder: 'EzPrompter'
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

  const systemPrompt = `You are an expert at reverse-engineering image generation prompts. Given an image:
1. First line MUST be exactly: TITLE: [2-4 words describing the image, e.g. "TITLE: blue vintage car"]
2. Then a blank line.
3. Then the full detailed prompt that could recreate this image (style, composition, lighting, colors, subjects, mood, technical parameters).
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
      if (sender.tab?.id === tabId && message.type === 'EZPROMPTER_OLLAMA') {
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
            type: 'EZPROMPTER_OLLAMA', success: true, result: data.response  // parsed in background
          }))
          .catch(err => chrome.runtime.sendMessage({
            type: 'EZPROMPTER_OLLAMA', success: false, error: err.message
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

  const model = settings.model || 'gemini-2.0-flash';
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
  if (titleMatch) {
    const title = titleMatch[1].trim().slice(0, 60);
    const prompt = text.replace(/^TITLE:\s*.+\n*/im, '').trim();
    return { title, prompt };
  }
  // Fallback: first 4 words as title
  const title = text.trim().split(/\s+/).slice(0, 4).join(' ');
  return { title, prompt: text.trim() };
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
  return `# EzPrompter - Image Prompt Description

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
