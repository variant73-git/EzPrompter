/**
 * Gemini Imagen adapter. Wraps @google/genai's generateImages API.
 * Returns { base64, mimeType, dataUrl, prompt, model }.
 */
import { GoogleGenAI } from '@google/genai';

const DEFAULT_MODEL = 'imagen-3.0-fast-generate-001';

export async function generateGeminiImage({
  prompt,
  aspectRatio = '1:1',
  apiKey,
  model = DEFAULT_MODEL,
}) {
  if (!prompt) throw new Error('prompt required');
  if (!apiKey) throw new Error('apiKey required');

  const client = new GoogleGenAI({ apiKey });

  // Hard cap. @google/genai has no client-level timeout option, so race
  // the underlying request against a Promise reject. Without this the
  // call can sit there forever (observed 19+ minutes in prod), and the
  // driver's per-tool 3-min cap doesn't help when the underlying await
  // never resolves cleanly.
  const TIMEOUT_MS = 120_000;
  const resp = await Promise.race([
    client.models.generateImages({
      model,
      prompt,
      config: {
        numberOfImages: 1,
        aspectRatio,
      },
    }),
    new Promise((_, reject) => setTimeout(
      () => reject(new Error(`Imagen exceeded ${TIMEOUT_MS / 1000}s`)),
      TIMEOUT_MS,
    )),
  ]);

  const first = resp?.generatedImages?.[0];
  if (!first?.image?.imageBytes) {
    throw new Error('Imagen returned no image');
  }

  const base64 = first.image.imageBytes;
  const mimeType = first.image.mimeType || 'image/png';

  return {
    base64,
    mimeType,
    dataUrl: `data:${mimeType};base64,${base64}`,
    prompt,
    model,
  };
}
