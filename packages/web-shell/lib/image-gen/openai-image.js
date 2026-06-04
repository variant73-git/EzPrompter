/**
 * OpenAI gpt-image-1 adapter. Returns same shape as Gemini adapter so the
 * route + tool can stay provider-agnostic.
 *
 * Two modes:
 *  - generate (default) — text-to-image via client.images.generate
 *  - edit                — image-to-image via client.images.edit when a
 *                          baseImageDataUrl is supplied. Useful for style
 *                          transfer / inpainting flows orchestrated by the
 *                          agent (user's image as the edit base, references
 *                          described in the prompt).
 */
import OpenAI from 'openai';
import { toFile } from 'openai/uploads';

const DEFAULT_MODEL = 'gpt-image-1';

const SIZE_MAP = {
  '1:1': '1024x1024',
  '16:9': '1792x1024',
  '9:16': '1024x1792',
  '3:4': '1024x1280',
  '4:3': '1280x1024',
};

function parseDataUrl(dataUrl) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error('expected a base64 data URL');
  return { mimeType: m[1], base64: m[2] };
}

export async function generateOpenAIImage({
  prompt,
  aspectRatio = '1:1',
  apiKey,
  model = DEFAULT_MODEL,
  baseImageDataUrl = null,
}) {
  if (!prompt) throw new Error('prompt required');
  if (!apiKey) throw new Error('apiKey required');

  const size = SIZE_MAP[aspectRatio] || SIZE_MAP['1:1'];
  const client = new OpenAI({ apiKey });

  let resp;
  if (baseImageDataUrl) {
    const { mimeType, base64 } = parseDataUrl(baseImageDataUrl);
    const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/jpeg' ? 'jpg' : 'png';
    const buffer = Buffer.from(base64, 'base64');
    const file = await toFile(buffer, `base.${ext}`, { type: mimeType });
    resp = await client.images.edit({
      model,
      image: file,
      prompt,
      size,
      n: 1,
    });
  } else {
    resp = await client.images.generate({
      model,
      prompt,
      size,
      n: 1,
      response_format: 'b64_json',
    });
  }

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
    mode: baseImageDataUrl ? 'edit' : 'generate',
  };
}
