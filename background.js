// EzPrompter - Background Service Worker

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'ezprompter-describe',
    title: 'EzPrompter: Descrever prompt desta imagem',
    contexts: ['image']
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'ezprompter-describe') return;

  const imageUrl = info.srcUrl;
  const tabId = tab.id;

  // Show loading feedback immediately
  setBadge('...', '#7c3aed', tabId);
  showNotification('EzPrompter', 'Analyzing image with AI...');
  injectOverlay(tabId, { loading: true, text: 'Analyzing image with AI...' });

  try {
    const settings = await getSettings();

    if (!settings.apiKey) {
      throw new Error('API key not configured. Click the EzPrompter icon to set it up.');
    }

    // 1. Fetch image as base64
    const imageData = await fetchImageAsBase64(imageUrl);

    // 2. Send to AI for prompt description
    const promptDescription = await describeImageWithAI(imageData, settings);

    // 3. Build metadata
    const timestamp = new Date().toISOString();
    const safeName = generateFileName(imageUrl, timestamp);

    const metadata = {
      fileName: safeName,
      originalUrl: imageUrl,
      pageUrl: tab.url || '',
      pageTitle: tab.title || '',
      timestamp: timestamp,
      provider: settings.apiProvider,
      model: settings.model,
      prompt: promptDescription
    };

    // 4. Save all files
    await saveAllFiles(imageData, metadata, safeName, settings.downloadFolder);

    // 5. Success feedback
    setBadge('OK', '#065f46', tabId);
    showNotification('EzPrompter - Saved!', `Prompt generated and saved as ${safeName}`);
    injectOverlay(tabId, { success: true, prompt: promptDescription, fileName: safeName });

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
    bodyContent = `
      <div class="ezp-success-badge">Saved!</div>
      <p class="ezp-filename">${escapeHtml(state.fileName)}</p>
      <div class="ezp-prompt-box">
        <label>Generated Prompt:</label>
        <div class="ezp-prompt-text">${escapeHtml(state.prompt)}</div>
      </div>
      <button class="ezp-copy-btn" id="ezp-copy">Copy Prompt</button>
    `;
  }

  overlay.innerHTML = `
    <div class="ezp-modal">
      <div class="ezp-header">
        <span class="ezp-logo">EzPrompter</span>
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

  // Copy button
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

function getSettings() {
  return new Promise(resolve => {
    chrome.storage.sync.get({
      apiProvider: 'openai',
      apiKey: '',
      model: 'gpt-4o',
      language: 'en',
      downloadFolder: 'EzPrompter'
    }, resolve);
  });
}

async function fetchImageAsBase64(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
  const blob = await response.blob();
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

  const systemPrompt = `You are an expert at reverse-engineering image generation prompts. Given an image, describe in detail the prompt that could have been used to generate it. Include style, composition, lighting, colors, subjects, mood, and any technical parameters (like aspect ratio, art style references). ${langInstruction}`;

  if (settings.apiProvider === 'anthropic') {
    return describeWithAnthropic(imageDataUrl, systemPrompt, settings);
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
  return data.choices[0].message.content;
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
  return data.content[0].text;
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
  const imageBlob = await (await fetch(imageDataUrl)).blob();
  const ext = getExtensionFromMime(imageBlob.type);

  // 1. Save image
  const imageBlobUrl = URL.createObjectURL(imageBlob);
  await downloadFile(imageBlobUrl, `${folder}/${safeName}.${ext}`);
  URL.revokeObjectURL(imageBlobUrl);

  // 2. Save .md with prompt
  const mdContent = buildMarkdown(metadata, ext);
  const mdBlob = new Blob([mdContent], { type: 'text/markdown' });
  const mdBlobUrl = URL.createObjectURL(mdBlob);
  await downloadFile(mdBlobUrl, `${folder}/${safeName}.md`);
  URL.revokeObjectURL(mdBlobUrl);

  // 3. Save .json with metadata
  const jsonContent = JSON.stringify(metadata, null, 2);
  const jsonBlob = new Blob([jsonContent], { type: 'application/json' });
  const jsonBlobUrl = URL.createObjectURL(jsonBlob);
  await downloadFile(jsonBlobUrl, `${folder}/${safeName}.json`);
  URL.revokeObjectURL(jsonBlobUrl);
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
