import { describe, it, expect } from 'vitest';
import { stripCardBorders } from './strip-borders.js';

describe('stripCardBorders', () => {
  it('strips a reflexive card outline (border + radius + background)', () => {
    const html = '<div style="background:#fff;border-radius:12px;border:1px solid #e5e5e5;padding:16px">x</div>';
    const out = stripCardBorders(html);
    expect(out).not.toMatch(/border:\s*1px solid/i);
    expect(out).toContain('border-radius:12px'); // radius preserved
    expect(out).toContain('background:#fff');     // fill preserved
  });

  it('keeps a single-side border (divider / accent)', () => {
    const html = '<div style="background:#fff;border-radius:12px;border-top:3px solid gold">x</div>';
    expect(stripCardBorders(html)).toContain('border-top:3px solid gold');
  });

  it('keeps a border on an element with no radius (not a card)', () => {
    const html = '<input style="background:#fff;border:1px solid #ccc">';
    expect(stripCardBorders(html)).toContain('border:1px solid #ccc');
  });

  it('keeps a border with no background (not a filled surface)', () => {
    const html = '<div style="border-radius:8px;border:1px solid #ccc">x</div>';
    expect(stripCardBorders(html)).toContain('border:1px solid #ccc');
  });

  it('keeps a thick decorative border (>=3px)', () => {
    const html = '<div style="background:#fff;border-radius:8px;border:4px solid #000">x</div>';
    expect(stripCardBorders(html)).toContain('border:4px solid #000');
  });

  it('is a no-op on empty / non-string', () => {
    expect(stripCardBorders('')).toBe('');
    expect(stripCardBorders(null)).toBe(null);
  });
});
