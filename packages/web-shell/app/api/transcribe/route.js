import { NextResponse } from 'next/server';
import { getAuthUser } from '../../../lib/auth.js';
import { transcribeAudio } from '../../../lib/transcription.js';

export const runtime = 'nodejs';
// Whisper round-trip on a 1-2 minute clip comfortably fits, but cold start
// + upload can push past the default on slow connections.
export const maxDuration = 60;

// CORS — same posture as /api/assets: chrome-extension origins are allowed
// (the extension's mic button proxies here through background.js with the
// browser cookie jar, so auth rides along).
function corsHeaders(origin) {
  const isExt = origin && /^chrome-extension:\/\//.test(origin);
  const isWebShell = origin && /^https?:\/\/(?:localhost(?::\d+)?|.*\.uncraft\.app|uncraft\.app|.*\.vercel\.app)/.test(origin);
  const allowOrigin = (isExt || isWebShell) ? origin : '';
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600'
  };
  if (allowOrigin) {
    headers['Access-Control-Allow-Origin'] = allowOrigin;
    headers['Access-Control-Allow-Credentials'] = 'true';
    headers['Vary'] = 'Origin';
  }
  return headers;
}

export async function OPTIONS(request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request.headers.get('origin'))
  });
}

/**
 * POST /api/transcribe
 *
 * Speech-to-text for the chat docks (PromptDock + editor asset chat).
 *
 * Request body:
 *   { audioDataUrl: 'data:audio/webm;codecs=opus;base64,…', language?: 'pt' }
 *
 * Response:
 *   { text: '…', model: 'whisper-1' }
 */
export async function POST(request) {
  const origin = request.headers.get('origin');
  const cors = corsHeaders(origin);

  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: cors });

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'OPENAI_API_KEY not configured' }, { status: 500, headers: cors });
  }

  const body = await request.json().catch(() => ({}));
  const { audioDataUrl, language } = body || {};
  if (!audioDataUrl) {
    return NextResponse.json({ error: 'audioDataUrl required' }, { status: 400, headers: cors });
  }

  try {
    const result = await transcribeAudio({
      audioDataUrl,
      language: typeof language === 'string' ? language : null,
      apiKey: process.env.OPENAI_API_KEY,
    });
    return NextResponse.json(result, { headers: cors });
  } catch (e) {
    const msg = e?.message || 'transcription failed';
    const isBadInput = /expected a base64|empty audio|audio too large/.test(msg);
    if (!isBadInput) console.error('[POST /api/transcribe] error', e);
    return NextResponse.json({ error: msg }, { status: isBadInput ? 400 : 500, headers: cors });
  }
}
