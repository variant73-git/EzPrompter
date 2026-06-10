/**
 * OpenAI Whisper transcription adapter. Same posture as the image-gen
 * adapters: pure function, apiKey injected, returns a plain object so the
 * route stays a thin dispatch.
 *
 * Input is a base64 data URL (matches the repo's asset idiom and survives
 * chrome.runtime.sendMessage JSON serialization — the extension path can't
 * ship FormData/Blob through the background proxy).
 */
import OpenAI from 'openai';
import { toFile } from 'openai/uploads';

const DEFAULT_MODEL = 'whisper-1';

// Whisper infers the container format from the filename extension, so the
// mime → ext map matters more than it looks. MediaRecorder emits audio/webm
// on Chrome and audio/mp4 on Safari.
const EXT_BY_MIME = {
  'audio/webm': 'webm',
  'audio/mp4': 'mp4',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
};

// OpenAI caps uploads at 25MB; stay under it with margin. A 2-minute opus
// voice note is ~1.5MB, so real dictation never gets close.
const MAX_AUDIO_BYTES = 24 * 1024 * 1024;

export function parseAudioDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:audio/')) {
    throw new Error('expected a base64 audio data URL');
  }
  const sep = dataUrl.indexOf(';base64,');
  if (sep === -1) throw new Error('expected a base64 audio data URL');
  // Mime may carry a codecs param (data:audio/webm;codecs=opus;base64,…) —
  // keep only the bare type for the extension lookup.
  const mime = dataUrl.slice(5, sep).split(';')[0].toLowerCase();
  const buffer = Buffer.from(dataUrl.slice(sep + 8), 'base64');
  if (!buffer.length) throw new Error('empty audio payload');
  if (buffer.length > MAX_AUDIO_BYTES) throw new Error('audio too large (max 24MB)');
  return { mime, buffer, ext: EXT_BY_MIME[mime] || 'webm' };
}

export async function transcribeAudio({ audioDataUrl, apiKey, language = null, model = null }) {
  if (!apiKey) throw new Error('apiKey required');
  const { mime, buffer, ext } = parseAudioDataUrl(audioDataUrl);

  const client = new OpenAI({ apiKey });
  const file = await toFile(buffer, `dictation.${ext}`, { type: mime });
  const effectiveModel = model || process.env.UNCRAFT_TRANSCRIBE_MODEL || DEFAULT_MODEL;

  const res = await client.audio.transcriptions.create({
    file,
    model: effectiveModel,
    // Omitting language lets Whisper auto-detect — right default for a
    // user base that dictates in Portuguese and English interchangeably.
    ...(language ? { language } : {}),
  });

  return { text: (res?.text || '').trim(), model: effectiveModel };
}
