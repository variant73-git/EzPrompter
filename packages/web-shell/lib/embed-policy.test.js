import { describe, expect, it } from 'vitest';
import { iframeBlockReason } from './embed-policy.js';

const context = {
  pageUrl: 'https://example.com/landing',
  appOrigin: 'https://app.uncraft.com',
};

describe('iframeBlockReason', () => {
  it('detects X-Frame-Options blockers', () => {
    expect(iframeBlockReason({ 'x-frame-options': 'DENY' }, context)).toBe('x-frame-options-deny');
    expect(iframeBlockReason({ 'X-Frame-Options': 'SAMEORIGIN' }, context)).toBe('x-frame-options-sameorigin');
  });

  it('allows SAMEORIGIN only when the app and page share an origin', () => {
    expect(iframeBlockReason({ 'x-frame-options': 'SAMEORIGIN' }, {
      pageUrl: 'https://app.uncraft.com/page',
      appOrigin: 'https://app.uncraft.com',
    })).toBe(null);
  });

  it('detects restrictive frame-ancestors policies', () => {
    expect(iframeBlockReason({
      'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
    }, context)).toBe('csp-frame-ancestors-none');
    expect(iframeBlockReason({
      'content-security-policy': "frame-ancestors 'self' https://trusted.example",
    }, context)).toBe('csp-frame-ancestors');
  });

  it('accepts policies that explicitly allow the app', () => {
    expect(iframeBlockReason({
      'content-security-policy': 'frame-ancestors https://app.uncraft.com',
    }, context)).toBe(null);
    expect(iframeBlockReason({
      'content-security-policy': 'frame-ancestors *',
    }, context)).toBe(null);
  });

  it('treats missing framing headers as embeddable', () => {
    expect(iframeBlockReason({}, context)).toBe(null);
  });
});
