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
  // Fail fast: the SDK default is 10min timeout × 2 retries (~30min). When
  // the API hangs or returns 4xx in a way the SDK keeps retrying, the agent
  // loop has no way to escape — the chip spins forever and the user has to
  // refresh. 120s per attempt + 0 retries surfaces failures to the agent
  // turn so it can react (skip / try a different provider / tell the user).
  const client = new OpenAI({ apiKey, timeout: 120_000, maxRetries: 0 });

  let resp;
  if (baseImageDataUrl) {
    const { mimeType, base64 } = parseDataUrl(baseImageDataUrl);
    // gpt-image-1 accepts PNG, WebP, and JPG up to 25MB. dall-e-2 (PNG-only)
    // is not in scope here. Match the ext to the mime so the multipart body
    // looks well-formed.
    const ext = mimeType === 'image/jpeg' ? 'jpg'
              : mimeType === 'image/webp' ? 'webp'
              : 'png';
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
