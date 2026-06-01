/**
 * OpenAI gpt-image-1 adapter. Returns same shape as Gemini adapter so the
 * route + tool can stay provider-agnostic.
 */
import OpenAI from 'openai';

const DEFAULT_MODEL = 'gpt-image-1';

const SIZE_MAP = {
  '1:1': '1024x1024',
  '16:9': '1792x1024',
  '9:16': '1024x1792',
  '3:4': '1024x1280',
  '4:3': '1280x1024',
};

export async function generateOpenAIImage({
  prompt,
  aspectRatio = '1:1',
  apiKey,
  model = DEFAULT_MODEL,
}) {
  if (!prompt) throw new Error('prompt required');
  if (!apiKey) throw new Error('apiKey required');

  const size = SIZE_MAP[aspectRatio] || SIZE_MAP['1:1'];

  const client = new OpenAI({ apiKey });

  const resp = await client.images.generate({
    model,
    prompt,
    size,
    n: 1,
    response_format: 'b64_json',
  });

  const first = resp?.data?.[0];
  if (!first?.b64_json) {
    throw new Error('gpt-image-1 returned no image');
  }

  const base64 = first.b64_json;
  const mimeType = 'image/png';

  return {
    base64,
    mimeType,
    dataUrl: `data:${mimeType};base64,${base64}`,
    prompt,
    model,
  };
}
