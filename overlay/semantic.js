// RepixBridge — AI Semantic Analyzer
// Takes extraction data + screenshot → returns Semantic Map JSON.
// Runs in background.js (service worker context).

const SEMANTIC_SCHEMA = `
{
  "sections": [
    {
      "id": "string (unique, kebab-case)",
      "type": "nav|hero|features|testimonials|pricing|cta|footer|content",
      "selector": "string (CSS selector from the real page)",
      "bounds": { "x": number, "y": number, "w": number, "h": number },
      "background": { "type": "solid|gradient|image|transparent", "value": "string" },
      "editableProps": ["background", "height", "padding"],
      "elements": [
        {
          "id": "string (unique)",
          "role": "headline|subheadline|body|cta_primary|cta_secondary|label|image|logo|nav_link|card_title|card_body|card_cta",
          "selector": "string",
          "content": "string (text content or image src)",
          "style": {
            "fontSize": "string (e.g. 72px)",
            "fontWeight": "string (e.g. 700)",
            "color": "string (hex)",
            "fontFamily": "string",
            "lineHeight": "string",
            "letterSpacing": "string"
          },
          "bounds": { "x": number, "y": number, "w": number, "h": number },
          "editableProps": ["fontSize", "color", "fontFamily", "fontWeight", "content", "lineHeight"]
        }
      ]
    }
  ],
  "tokens": {
    "colors": ["hex array"],
    "fonts": ["font names"],
    "radiusBase": "string",
    "shadowBase": "string"
  }
}`;

const SEMANTIC_RULES = `
Rules (strict):
1. Only use selectors that exist in the provided HTML.
2. editableProps must only contain properties listed in the schema — never invent new ones.
3. Map at most 8 sections. Skip purely decorative sections.
4. For each section, map only meaningful elements (max 8 per section).
5. Skip decorative icons, dividers, spacers, and pure layout wrappers.
6. bounds must come from the provided sectionBounds data, not guessed.
7. style values must be real CSS values (e.g. "72px", "#1a1a2e", "Inter").
8. cta_primary = the most prominent action button. cta_secondary = secondary action.
9. Return ONLY the JSON — no explanation, no markdown fences.
`;

async function buildSemanticMap(extractionData, screenshotDataUrl, aiSettings) {
  const { tokens, cleanHTML, sections, pageTitle } = extractionData;

  const prompt = `
You are analyzing a website to create a Semantic Map for a design tool.
Page: "${pageTitle}"

DESIGN TOKENS (extracted from CSS — use these exact values):
${JSON.stringify(tokens, null, 2)}

REAL SECTION BOUNDS (from getBoundingClientRect):
${JSON.stringify(sections, null, 2)}

CLEAN HTML STRUCTURE:
${cleanHTML}

Return a Semantic Map matching this exact JSON schema:
${SEMANTIC_SCHEMA}

${SEMANTIC_RULES}
`;

  const response = await callAIForSemanticMap(prompt, screenshotDataUrl, aiSettings);
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
  const match = screenshotDataUrl.match(/^data:(.+?);base64,(.+)$/);
  if (!match) throw new Error('Invalid screenshot data');
  const [, mimeType, base64] = match;

  const model = settings.model || 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${settings.apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mimeType, data: base64 } }
        ]
      }],
      generationConfig: { maxOutputTokens: 4096, temperature: 0.1 }
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Gemini semantic error: ${err.error?.message || res.status}`);
  }

  const data = await res.json();
  return data.candidates[0].content.parts[0].text;
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
  // Strip markdown fences if AI wrapped it
  const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  try {
    return JSON.parse(clean);
  } catch (e) {
    // Try to extract JSON from text
    const jsonMatch = clean.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error('AI returned invalid JSON for semantic map');
  }
}
