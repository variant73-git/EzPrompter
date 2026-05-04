// RepixBridge — AI Semantic Analyzer
// Takes extraction data + screenshot → returns Semantic Map JSON.
// Runs in background.js (service worker context).

const SEMANTIC_SCHEMA = `{"sections":[{"id":"string","type":"nav|hero|features|cta|footer|content","bounds":{"x":0,"y":0,"width":0,"height":0}}]}`;

const SEMANTIC_RULES = `Return ONLY valid JSON. No markdown, no explanation. Use the bounds from the provided section data. Max 8 sections.`;

async function buildSemanticMap(extractionData, screenshotDataUrl, aiSettings) {
  const { tokens, cleanHTML, sections, pageTitle } = extractionData;

  const prompt = `Identify the main visual sections of this webpage. Return JSON only.

Page: "${pageTitle}"

Section bounds (real positions):
${JSON.stringify(sections)}

HTML:
${cleanHTML.slice(0, 6000)}

Return this exact format: ${SEMANTIC_SCHEMA}

${SEMANTIC_RULES}`;

  // Skip screenshot for faster response — the extracted data is sufficient
  const response = await callAIForSemanticMap(prompt, null, aiSettings);
  return parseSemanticResponse(response);
}

async function callAIForSemanticMap(prompt, screenshotDataUrl, settings) {
  if (settings.apiProvider === 'gemini') {
    return callGeminiSemantic(prompt, screenshotDataUrl, settings);
  }
  if (settings.apiProvider === 'openai') {
    return callOpenAISemantic(prompt, screenshotDataUrl, settings);
  }
  if (settings.apiProvider === 'anthropic') {
    return callAnthropicSemantic(prompt, screenshotDataUrl, settings);
  }
  throw new Error('Semantic map requires a cloud AI provider (Gemini, OpenAI, or Anthropic).');
}

async function callGeminiSemantic(prompt, screenshotDataUrl, settings) {
  const model = 'gemini-flash-latest';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${settings.apiKey}`;

  const parts = [{ text: prompt }];
  if (screenshotDataUrl) {
    const match = screenshotDataUrl.match(/^data:(.+?);base64,(.+)$/);
    if (match) parts.push({ inline_data: { mime_type: match[1], data: match[2] } });
  }

  console.log('[Repix Semantic] Calling', model, '| prompt:', prompt.length, 'chars');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { maxOutputTokens: 4096, temperature: 0.1 }
      })
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Gemini error: ${err.error?.message || res.status}`);
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    console.log('[Repix Semantic] OK,', text.length, 'chars');
    return text;
  } catch (e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') throw new Error('Gemini timeout (30s). Try a simpler page.');
    throw e;
  }
}

async function callOpenAISemantic(prompt, screenshotDataUrl, settings) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify({
      model: settings.model || 'gpt-4o',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: screenshotDataUrl, detail: 'high' } }
        ]
      }],
      max_tokens: 4096,
      temperature: 0.1
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`OpenAI semantic error: ${err.error?.message || res.status}`);
  }

  const data = await res.json();
  return data.choices[0].message.content;
}

async function callAnthropicSemantic(prompt, screenshotDataUrl, settings) {
  const match = screenshotDataUrl.match(/^data:(.+?);base64,(.+)$/);
  if (!match) throw new Error('Invalid screenshot data');
  const [, mediaType, base64Data] = match;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: settings.model || 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } },
          { type: 'text', text: prompt }
        ]
      }]
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Anthropic semantic error: ${err.error?.message || res.status}`);
  }

  const data = await res.json();
  return data.content[0].text;
}

function parseSemanticResponse(text) {
  console.log('[Repix Semantic] Raw AI response:', text.slice(0, 300));

  // Strip markdown fences
  let clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  // Extract JSON block if wrapped in text
  const jsonMatch = clean.match(/\{[\s\S]*\}/);
  if (jsonMatch) clean = jsonMatch[0];

  console.log('[Repix Semantic] Cleaned for parse:', clean.slice(0, 300));

  // Fix common AI JSON errors
  clean = clean
    .replace(/,\s*([}\]])/g, '$1')           // trailing commas
    .replace(/:\s*'([^']*)'/g, ': "$1"')      // single quotes → double
    .replace(/\n/g, ' ')                       // newlines in strings
    .replace(/\t/g, ' ');                      // tabs

  try {
    return JSON.parse(clean);
  } catch (e1) {
    console.error('[Repix Semantic] JSON parse attempt 1 failed:', e1.message);
    console.error('[Repix Semantic] Raw response:', clean.slice(0, 500));
    // Try without any cleanup
    try {
      var rawMatch = text.match(/\{[\s\S]*\}/);
      if (rawMatch) return JSON.parse(rawMatch[0]);
    } catch (e2) {
      console.error('[Repix Semantic] JSON parse attempt 2 failed:', e2.message);
    }
    return { sections: [] };
  }
}
