// EzPrompter - Background Service Worker

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'ezprompter-describe',
    title: 'EzPrompter: Descrever prompt desta imagem',
    contexts: ['image']
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'ezprompter-describe') {
    chrome.tabs.sendMessage(tab.id, {
      action: 'describeImage',
      imageUrl: info.srcUrl
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'processImage') {
    handleImageProcessing(message.imageUrl, message.pageUrl, message.pageTitle)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // keep channel open for async
  }

  if (message.action === 'getSettings') {
    chrome.storage.sync.get({
      apiProvider: 'openai',
      apiKey: '',
      model: 'gpt-4o',
      language: 'en',
      downloadFolder: 'EzPrompter'
    }, settings => sendResponse(settings));
    return true;
  }
});

async function handleImageProcessing(imageUrl, pageUrl, pageTitle) {
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
    pageUrl: pageUrl,
    pageTitle: pageTitle,
    timestamp: timestamp,
    provider: settings.apiProvider,
    model: settings.model,
    prompt: promptDescription
  };

  // 4. Save all files
  await saveAllFiles(imageData, metadata, safeName, settings.downloadFolder);

  return { prompt: promptDescription, fileName: safeName };
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
  // Extract base64 and media type from data URL
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
  // Convert base64 data URL to blob URL for download
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
