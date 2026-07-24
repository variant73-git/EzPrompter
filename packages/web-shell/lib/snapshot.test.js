import { describe, expect, it } from 'vitest';
import { pinViewportUnits, pinCssLengths } from './snapshot.js';

// Regression suite for the 2026-07-24 "pixelated hero" root cause: the old
// pinViewportUnits did a naive global `\d+vh|vw` → px replace over the WHOLE
// captured HTML, corrupting base64 payloads inside inline data-URIs (a 7.5 MB
// inline Lottie on farmminerals took 382 substitutions inside its base64 frames
// → decoded as garbage → a pixelated sky/grass block instead of the CropTab pill).
//
// The fix scopes conversion to real CSS contexts only:
//   - pinViewportUnits(html): pins ONLY inside <style> blocks and style="" attrs.
//   - pinCssLengths(css): pins CSS lengths, skipping comments, strings and url(...).
// Cases marked (Sol) come from the GPT-5.6 adversarial audits of the attempts.

describe('pinCssLengths — pins CSS lengths, never inside strings / comments / url()', () => {
  it('pins vh/vw and the d/s/l variants', () => {
    expect(pinCssLengths('.a{height:100dvh;min-height:50svh;width:100dvw;left:50vw}', 1000, 500))
      .toBe('.a{height:500.00px;min-height:250.00px;width:1000.00px;left:500.00px}');
  });

  it('preserves a url(data:...) base64 payload while pinning surrounding units', () => {
    const css = '.a{background:url(data:image/png;base64,AAA6vh7BBB8vw9==);height:50vh;width:50vw}';
    const out = pinCssLengths(css, 1280, 800);
    expect(out).toContain('data:image/png;base64,AAA6vh7BBB8vw9==');
    expect(out).toContain('height:400.00px');
    expect(out).toContain('width:640.00px');
  });

  it('(Sol F2b) preserves a quoted url() whose payload contains parentheses', () => {
    const css = `a{background:url("data:image/svg+xml,<svg transform='rotate(1)'><style>rect{height:6vh}</style></svg>");height:100vh}`;
    const out = pinCssLengths(css, 1280, 800);
    expect(out).toContain("rotate(1)'><style>rect{height:6vh}");
    expect(out).toContain('height:800.00px');
  });

  it('(Sol F3) pins a real length even when a comment contains an unbalanced url(', () => {
    expect(pinCssLengths('/* url( */ .hero { height: 100vh } /* ) */', 1280, 800))
      .toBe('/* url( */ .hero { height: 800.00px } /* ) */');
  });

  it('does not pin a viewport unit inside a string literal', () => {
    expect(pinCssLengths('.a{content:"100vh";height:100vh}', 1280, 800))
      .toBe('.a{content:"100vh";height:800.00px}');
  });

  it('(Sol F4a) does not corrupt a utility class name like .h-100vh in the selector', () => {
    expect(pinCssLengths('.h-100vh{height:100vh}', 1280, 800))
      .toBe('.h-100vh{height:800.00px}');
  });

  it('(Sol F4b) handles a leading-dot number without producing invalid px', () => {
    expect(pinCssLengths('a{top:.5vh}', 1280, 800)).toBe('a{top:4.00px}');
  });

  it('still pins a legitimate negative value', () => {
    expect(pinCssLengths('a{margin-top:-10vh}', 1280, 800)).toBe('a{margin-top:-80.00px}');
  });
});

describe('pinViewportUnits(html) — pins only inside <style> and style="", never in data payloads', () => {
  it('pins vh inside a <style> block', () => {
    expect(pinViewportUnits('<style>.hero{height:100vh}</style>', 1280, 800))
      .toBe('<style>.hero{height:800.00px}</style>');
  });

  it('pins vw inside an inline style attribute', () => {
    expect(pinViewportUnits('<div style="width:100vw"></div>', 1280, 800))
      .toBe('<div style="width:1280.00px"></div>');
  });

  it('leaves a base64 data-URI in an attribute byte-identical', () => {
    const html = '<img src="data:image/png;base64,iVBOR6vh9wKGgo8vw2QQ6vH+7Lvh/8Vw==">';
    expect(pinViewportUnits(html, 1280, 800)).toBe(html);
  });

  it('does not pin vw inside a sizes attribute (media-condition, not a length)', () => {
    const html = '<img sizes="(max-width: 1920px) 100vw, 1920px" srcset="a.jpg 1x">';
    expect(pinViewportUnits(html, 1280, 800)).toBe(html);
  });

  it('(Sol F1a) leaves an SVG data-URI containing url(#..) untouched', () => {
    const html = `<img src="data:image/svg+xml,<svg><rect fill='url(#g)'/><style>rect{height:6vh}</style></svg>">`;
    expect(pinViewportUnits(html, 1280, 800)).toBe(html);
  });

  it('(Sol F2a) leaves a non-first srcset data-URI candidate untouched', () => {
    const html = '<img srcset="/f.png 1x, data:image/svg+xml,<svg><style>rect{height:6vh}</style></svg> 2x">';
    expect(pinViewportUnits(html, 1280, 800)).toBe(html);
  });

  it('(Sol F1b) does not corrupt literal text that looks like an internal sentinel', () => {
    const html = '<p>[[RBPIN:0]]</p>';
    expect(pinViewportUnits(html, 1280, 800)).toBe(html);
  });

  it('pins a length in style="" while preserving a url(data:...) in the same value', () => {
    const html = '<div style="background:url(data:image/png;base64,AAA6vh7==);height:100vh"></div>';
    const out = pinViewportUnits(html, 1280, 800);
    expect(out).toContain('url(data:image/png;base64,AAA6vh7==)');
    expect(out).toContain('height:800.00px');
  });

  it('does not treat a data-style attribute as a CSS style attribute', () => {
    const html = '<div data-style="100vh"></div>';
    expect(pinViewportUnits(html, 1280, 800)).toBe(html);
  });
});
