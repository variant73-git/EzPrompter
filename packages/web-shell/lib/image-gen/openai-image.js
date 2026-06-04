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

// gpt-image-1 accepts ONLY 1024x1024, 1024x1536, 1536x1024, or 'auto'.
// Anything else (e.g. DALL-E 3's 1792x1024) returns a 400. Previous map
// had DALL-E 3 sizes for the non-square aspects, which silently broke
// every 16:9 / 9:16 / 3:4 / 4:3 generation. 3:4 + 4:3 are mapped to the
// nearest supported portrait/landscape.
const SIZE_MAP = {
  '1:1': '1024x1024',
  '16:9': '1536x1024',
  '9:16': '1024x1536',
  '3:4': '1024x1536',
  '4:3': '1536x1024',
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
  // Phase 1 of image quality fix: when caller has additional style reference
  // images (typical of style-transfer flows), pass them DIRECTLY to gpt-image-1
  // as additional inputs. The model sees both the composition base (first
  // image) and the style references (subsequent images) natively, removing
  // the Flash-described-the-style-in-text bottleneck that was producing
  // hallucinated styles disconnected from either input.
  styleReferenceDataUrls = null,
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

  // Convert a data URL → File compatible with the multipart upload.
  async function dataUrlToFile(dataUrl, name) {
    const { mimeType, base64 } = parseDataUrl(dataUrl);
    const ext = mimeType === 'image/jpeg' ? 'jpg'
              : mimeType === 'image/webp' ? 'webp'
              : 'png';
    const buffer = Buffer.from(base64, 'base64');
    return toFile(buffer, `${name}.${ext}`, { type: mimeType });
  }

  let resp;
  if (baseImageDataUrl) {
    const baseFile = await dataUrlToFile(baseImageDataUrl, 'base');
    // gpt-image-1's images.edit accepts an ARRAY of images. Passing the base
    // first (composition source) followed by style references lets the model
    // attend to both directly — far better signal than a text description of
    // a style the orchestrator (Gemini Flash) had to invent.
    let imageArg = baseFile;
    if (Array.isArray(styleReferenceDataUrls) && styleReferenceDataUrls.length > 0) {
      const refFiles = await Promise.all(
        styleReferenceDataUrls
          .filter((u) => typeof u === 'string' && u)
          .map((u, i) => dataUrlToFile(u, `ref-${i + 1}`)),
      );
      imageArg = [baseFile, ...refFiles];
    }
    resp = await client.images.edit({
      model,
      image: imageArg,
      prompt,
      size,
      quality: 'high',
      n: 1,
    });
  } else {
    resp = await client.images.generate({
      model,
      prompt,
      size,
      quality: 'high',
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
