/**
 * Sliding-window rate limiter backed by Upstash Redis.
 *
 * Two layers:
 *   1. Per-user: caps chat turns (e.g. 30/min) to stop accidental hammering
 *      AND deliberate cost attacks (an attacker can't burn $$$ in tokens
 *      faster than 30 LLM calls per minute).
 *   2. Per-IP: secondary protection for unauthenticated routes and
 *      defence-in-depth against credential-stuffing on /api/auth/login.
 *
 * Falls back to "allow + warn" if UPSTASH_REDIS env vars are unset — keeps
 * dev frictionless and never blocks legit traffic on a misconfig.
 */
import { Redis } from '@upstash/redis';

let redis = null;
function getRedis() {
  if (redis !== null) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    redis = false;  // sentinel: not configured
    return null;
  }
  redis = new Redis({ url, token });
  return redis;
}

/**
 * @param {Object} opts
 * @param {string} opts.key  Identity key (e.g. `chat:user:42`, `login:ip:1.2.3.4`).
 * @param {number} opts.limit  Max requests within the window.
 * @param {number} opts.windowSec  Window length in seconds.
 * @returns {Promise<{ok:boolean, remaining:number, reset:number}>}
 */
export async function checkRateLimit({ key, limit, windowSec }) {
  const r = getRedis();
  if (!r) {
    // Redis not configured — fail-open so dev / first-time deploys work.
    // Log once so a forgotten env var in production surfaces quickly.
    if (!checkRateLimit._warned) {
      // eslint-disable-next-line no-console
      console.warn('[rate-limit] UPSTASH_REDIS_REST_URL not set — rate limiting disabled');
      checkRateLimit._warned = true;
    }
    return { ok: true, remaining: limit, reset: 0 };
  }
  // Sliding-window via sorted set: each request stored with a millis score,
  // we remove anything outside the window, then count. Cheap (3 commands).
  const now = Date.now();
  const windowMs = windowSec * 1000;
  const minScore = now - windowMs;
  const pipeline = r.pipeline();
  pipeline.zremrangebyscore(key, 0, minScore);
  pipeline.zadd(key, { score: now, member: `${now}-${Math.random()}` });
  pipeline.zcard(key);
  pipeline.expire(key, windowSec + 1);
  const results = await pipeline.exec();
  const count = typeof results?.[2] === 'number' ? results[2] : 0;
  return {
    ok: count <= limit,
    remaining: Math.max(0, limit - count),
    reset: now + windowMs,
  };
}

/** Default policy for /api/chat — 30 turns/minute per user. */
export const CHAT_POLICY = { limit: 30, windowSec: 60 };
/** Stricter policy for unauthenticated login attempts — 10/min per IP. */
export const LOGIN_POLICY = { limit: 10, windowSec: 60 };
