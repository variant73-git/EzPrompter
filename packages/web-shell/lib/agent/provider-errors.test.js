import { describe, it, expect } from 'vitest';
import { APIError } from '@anthropic-ai/sdk';
import {
  classifyProviderError, annotateProviderError, isFailoverEligible, countsForBreaker,
} from './provider-errors.js';

function err(fields, msg = 'boom') {
  return Object.assign(new Error(msg), fields);
}

describe('classifyProviderError — real SDK shapes', () => {
  it('Anthropic balance-400 (the motivating case) → provider_balance, NOT invalid_request', () => {
    const e = APIError.generate(400, {
      type: 'error',
      error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' },
    }, undefined, new Headers());
    expect(classifyProviderError(e)).toBe('provider_balance');
  });

  it('Anthropic malformed 400 → invalid_request', () => {
    const e = APIError.generate(400, {
      type: 'error',
      error: { type: 'invalid_request_error', message: 'max_tokens: must be greater than 0' },
    }, undefined, new Headers());
    expect(classifyProviderError(e)).toBe('invalid_request');
  });

  it('Anthropic 401 authentication_error → auth', () => {
    const e = APIError.generate(401, {
      type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' },
    }, undefined, new Headers());
    expect(classifyProviderError(e)).toBe('auth');
  });

  it('Anthropic 429 rate_limit_error → rate_limit / 529 overloaded → outage', () => {
    const rl = APIError.generate(429, {
      type: 'error', error: { type: 'rate_limit_error', message: 'Number of requests has exceeded your rate limit' },
    }, undefined, new Headers());
    expect(classifyProviderError(rl)).toBe('rate_limit');
    const ov = APIError.generate(529, {
      type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' },
    }, undefined, new Headers());
    expect(classifyProviderError(ov)).toBe('outage');
  });

  it('OpenAI insufficient_quota 429 → provider_balance (not rate_limit)', () => {
    // Shape of openai v6 APIError for a depleted account.
    const e = err({ status: 429, code: 'insufficient_quota', type: 'insufficient_quota' },
      '429 You exceeded your current quota, please check your plan and billing details.');
    expect(classifyProviderError(e)).toBe('provider_balance');
  });

  it('OpenAI plain 429 → rate_limit; 401 invalid_api_key → auth; 400 → invalid_request', () => {
    expect(classifyProviderError(err({ status: 429, code: 'rate_limit_exceeded' }, 'Rate limit reached'))).toBe('rate_limit');
    expect(classifyProviderError(err({ status: 401, code: 'invalid_api_key' }, 'Incorrect API key provided'))).toBe('auth');
    expect(classifyProviderError(err({ status: 400 }, "Unknown parameter: 'foo'"))).toBe('invalid_request');
  });

  it('Gemini prepaid depletion → provider_balance; generic RESOURCE_EXHAUSTED → rate_limit', () => {
    expect(classifyProviderError(err({ status: 429 },
      'got status: 429 . {"error":{"code":429,"message":"You have exhausted your prepayment credits","status":"RESOURCE_EXHAUSTED"}}'))).toBe('provider_balance');
    expect(classifyProviderError(err({},
      '{"error":{"code":429,"message":"Quota exceeded for requests per minute","status":"RESOURCE_EXHAUSTED"}}'))).toBe('rate_limit');
  });

  it('5xx / network-level failures → outage', () => {
    expect(classifyProviderError(err({ status: 503 }, 'Service Unavailable'))).toBe('outage');
    expect(classifyProviderError(err({ status: 500 }, 'Internal error'))).toBe('outage');
    expect(classifyProviderError(err({}, 'fetch failed'))).toBe('outage');
    expect(classifyProviderError(err({}, 'Connection error.'))).toBe('outage');
    expect(classifyProviderError(err({ code: 'ECONNREFUSED' }, 'connect ECONNREFUSED 127.0.0.1:443'))).toBe('outage');
  });

  it('timeouts: driver race, opossum ETIMEDOUT → timeout', () => {
    expect(classifyProviderError(err({ code: 'llm_timeout' }, 'llm call exceeded 240s'))).toBe('timeout');
    expect(classifyProviderError(err({ code: 'ETIMEDOUT' }, 'Timed out after 300000ms'))).toBe('timeout');
  });

  it('SDK connection timeouts (no status/code, class name only) → timeout, not unknown', () => {
    // Anthropic/OpenAI APIConnectionTimeoutError: message "Request timed out."
    const e = err({}, 'Request timed out.');
    e.name = 'APIConnectionTimeoutError';
    expect(classifyProviderError(e)).toBe('timeout');
    expect(classifyProviderError(err({}, 'Request timed out.'))).toBe('timeout'); // message alone
    expect(classifyProviderError(err({ status: 408 }, 'timeout'))).toBe('timeout');
  });

  it('Anthropic billing_error wire type → provider_balance regardless of wording', () => {
    const e = err({ status: 400 }, '400 {"type":"error","error":{"type":"billing_error","message":"There is a billing issue with your account."}}');
    e.error = { type: 'error', error: { type: 'billing_error', message: 'There is a billing issue with your account.' } };
    expect(classifyProviderError(e)).toBe('provider_balance');
  });

  it('Gemini depleted prepaid with the REAL generic wording → provider_balance', () => {
    expect(classifyProviderError(err({ status: 429 },
      'got status: 429 . {"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details.","status":"RESOURCE_EXHAUSTED"}}'))).toBe('provider_balance');
  });

  it('circuit markers: our synthesized code and opossum EOPENBREAKER → circuit_open', () => {
    expect(classifyProviderError(err({ code: 'circuit_open' }))).toBe('circuit_open');
    expect(classifyProviderError(err({ code: 'EOPENBREAKER' }, 'Breaker is open'))).toBe('circuit_open');
  });

  it('unrecognized shapes → unknown; null-safe', () => {
    expect(classifyProviderError(err({}, 'something odd'))).toBe('unknown');
    expect(classifyProviderError(null)).toBe('unknown');
    expect(classifyProviderError(undefined)).toBe('unknown');
  });

  it('respects a pre-stamped category (idempotent with annotate)', () => {
    const e = annotateProviderError(err({ status: 503 }, 'Service Unavailable'));
    expect(e.providerErrorCategory).toBe('outage');
    e.status = 400; // even if fields mutate later, the verdict is stable
    expect(classifyProviderError(e)).toBe('outage');
  });
});

describe('policy predicates', () => {
  it('failover-eligible: provider_balance, rate_limit, outage, timeout, circuit_open', () => {
    for (const c of ['provider_balance', 'rate_limit', 'outage', 'timeout', 'circuit_open']) {
      expect(isFailoverEligible(c)).toBe(true);
    }
    for (const c of ['invalid_request', 'auth', 'unknown']) {
      expect(isFailoverEligible(c)).toBe(false);
    }
  });

  it('breaker counts ONLY provider-health signals: outage, timeout, rate_limit', () => {
    for (const c of ['outage', 'timeout', 'rate_limit']) expect(countsForBreaker(c)).toBe(true);
    for (const c of ['invalid_request', 'auth', 'provider_balance', 'circuit_open', 'unknown']) {
      expect(countsForBreaker(c)).toBe(false);
    }
  });
});
