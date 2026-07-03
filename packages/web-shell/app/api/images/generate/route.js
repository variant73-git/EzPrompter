import { NextResponse } from 'next/server';
import { requireUser } from '../../../../lib/auth.js';
import { db } from '../../../../lib/db.js';
import { generateGeminiImage } from '../../../../lib/image-gen/gemini-imagen.js';
import { generateOpenAIImage } from '../../../../lib/image-gen/openai-image.js';
import { runBilledOperation, InsufficientCreditsError } from '../../../../lib/billing/context.js';
import { checkOpsRate } from '../../../../lib/billing/rate-limit.js';

export const runtime = 'nodejs';

const VALID_PROVIDERS = new Set(['auto', 'gemini', 'openai']);

export async function POST(request) {
  const { user, error } = await requireUser(request);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const { prompt, aspectRatio = '1:1', provider = 'auto' } = body || {};

  if (!prompt?.trim()) {
    return NextResponse.json({ error: 'prompt required' }, { status: 400 });
  }
  if (provider === 'claude') {
    return NextResponse.json({ error: 'Claude does not generate images' }, { status: 400 });
  }
  if (!VALID_PROVIDERS.has(provider)) {
    return NextResponse.json({ error: `invalid provider: ${provider}` }, { status: 400 });
  }

  // 'auto' falls through to Gemini (cheapest default). Claude conversation
  // model emits needs_choice via the agent tool BEFORE this route is called,
  // so 'auto' arriving here means non-Claude — Gemini is the reasonable default.
  const effective = provider === 'auto' ? 'gemini' : provider;

  const sql = await db();
  const rate = await checkOpsRate({ sql, userId: user.id });
  if (!rate.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  try {
    const { result, credits, balanceAfter } = await runBilledOperation(
      { sql, userId: user.id, op: `image.generate.${effective}` },
      async () => {
        if (effective === 'gemini') {
          const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
          if (!apiKey) {
            const err = new Error('GEMINI_API_KEY not configured');
            err.code = 'not_configured';
            throw err;
          }
          return generateGeminiImage({ prompt, aspectRatio, apiKey });
        }
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
          const err = new Error('OPENAI_API_KEY not configured');
          err.code = 'not_configured';
          throw err;
        }
        return generateOpenAIImage({ prompt, aspectRatio, apiKey });
      },
    );
    return NextResponse.json({
      provider: effective,
      base64: result.base64,
      mimeType: result.mimeType,
      dataUrl: result.dataUrl,
      prompt: result.prompt,
      model: result.model,
      credits,
      balanceAfter,
    });
  } catch (e) {
    if (e instanceof InsufficientCreditsError) {
      return NextResponse.json({ error: 'insufficient_credits', estimate: e.estimate, balance: e.balance }, { status: 402 });
    }
    console.error('[POST /api/images/generate] error', e);
    return NextResponse.json({ error: e.message || 'generation failed' }, { status: 500 });
  }
}
