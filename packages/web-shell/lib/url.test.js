import { describe, it, expect } from 'vitest';
import { normalizeUrl, looksLikeUrl } from './url.js';

describe('normalizeUrl', () => {
  it('accepts bare host with TLD', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com');
  });
  it('accepts host with path', () => {
    expect(normalizeUrl('news.ycombinator.com/item?id=42')).toBe('https://news.ycombinator.com/item?id=42');
  });
  it('accepts existing https scheme', () => {
    expect(normalizeUrl('https://example.com')).toBe('https://example.com');
  });
  it('accepts existing http scheme', () => {
    expect(normalizeUrl('http://example.com')).toBe('http://example.com');
  });
  it('rejects non-http schemes', () => {
    expect(normalizeUrl('ftp://example.com')).toBeNull();
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
  });
  it('accepts bare localhost', () => {
    // Pre-existing limitation: `localhost:3000` is NOT accepted because
    // the host-fragment check is `=== 'localhost'` (no port). Captured
    // here as the current behaviour, not endorsed.
    expect(normalizeUrl('localhost')).toBe('https://localhost');
  });
  it('rejects bare word with no dot', () => {
    expect(normalizeUrl('hello')).toBeNull();
  });
  it('rejects empty / null / whitespace', () => {
    expect(normalizeUrl('')).toBeNull();
    expect(normalizeUrl('   ')).toBeNull();
    expect(normalizeUrl(null)).toBeNull();
    expect(normalizeUrl(undefined)).toBeNull();
  });

  // Regression: a sentence containing a filename like ".png" was
  // previously normalised to "https://use the aspect of file.png" and
  // PromptDock auto-routed to URL capture, creating a placeholder node
  // that vanished when the DNS lookup failed.
  it('rejects sentences that happen to contain a dotted filename', () => {
    expect(normalizeUrl('use the aspect of template_back.png')).toBeNull();
    expect(normalizeUrl('the original is at template_back.png')).toBeNull();
    expect(normalizeUrl('a7525125bca85f10b73e7b7fa4dee421.jpg please')).toBeNull();
  });
  it('rejects host containing whitespace even with scheme', () => {
    expect(normalizeUrl('https://hello world.com')).toBeNull();
  });
  it('still accepts a real filename-only host (edge case)', () => {
    // A bare "image.png" is technically a valid hostname pattern and
    // we accept it; the server-side reachability gate filters bad hosts.
    expect(normalizeUrl('image.png')).toBe('https://image.png');
  });
});

describe('looksLikeUrl', () => {
  it('matches normalizeUrl return shape', () => {
    expect(looksLikeUrl('example.com')).toBe(true);
    expect(looksLikeUrl('use the aspect of template_back.png')).toBe(false);
    expect(looksLikeUrl('hello world')).toBe(false);
  });
});
