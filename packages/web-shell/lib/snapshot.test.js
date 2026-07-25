import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium } from 'playwright-core';
import { pinViewportUnits, pinCssLengths, pinDomViewportUnits } from './snapshot.js';

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

  it('(Sol F1c) does not touch a length inside an EOF-terminated comment', () => {
    const css = '.x{}/* keep 100vh';
    expect(pinCssLengths(css, 1280, 800)).toBe(css);
  });

  it('(Sol F1b) keeps a length inside a string with a backslash-newline continuation', () => {
    const css = '.x{--p:"keep\\\n100vh"}';
    expect(pinCssLengths(css, 1280, 800)).toBe(css);
  });

  it('(Sol F4) does not partially convert an invalid unit like 1vh2', () => {
    const css = '.x{width:1vh2}';
    expect(pinCssLengths(css, 1280, 800)).toBe(css);
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

// The ACTIVE capture path pins viewport units in the live DOM via CSSOM before
// serialization (pinViewportUnits above is retained as an inert string fallback).
// Using the browser as the parser closes the whole class of regex-context
// corruptions by construction: querySelectorAll only returns real elements (never
// a <style> that is really text inside a data-URI attribute), and getAttribute /
// textContent return real quotes (not &quot;) with no surrounding markup — so
// data-URIs, SVGs/Lotties, strings, comments and url() stay byte-identical.
describe('pinDomViewportUnits — in-browser CSSOM pin (integration)', () => {
  let browser;
  // Generous launch timeout: this browser competes with ~120 other test files
  // running in parallel, so the default 5s hook window can flake under load.
  beforeAll(async () => { browser = await chromium.launch({ headless: true }); }, 30000);
  afterAll(async () => { if (browser) await browser.close(); });

  const pinHtml = async (html, w = 1280, h = 800) => {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    await pinDomViewportUnits(page, w, h);
    const out = await page.content();
    await page.close();
    return out;
  };

  it('pins vh inside a real <style> block', async () => {
    const out = await pinHtml('<style>.hero{height:100vh}</style>');
    expect(out).toContain('height:800.00px');
    expect(out).not.toContain('100vh');
  });

  it('pins a length inside an inline style attribute', async () => {
    const out = await pinHtml('<div style="width:50vw"></div>');
    expect(out).toContain('width:640.00px');
  });

  it('(Sol F1a) leaves a viewport unit inside an SVG data-URI in src untouched', async () => {
    const out = await pinHtml(`<img src="data:image/svg+xml,<svg height='30vh'></svg>"><style>.x{top:10vh}</style>`);
    expect(out).toContain("height='30vh'"); // the data-URI is not a real style → untouched
    expect(out).toContain('top:80.00px');   // the real <style> IS pinned
  });

  it('(Sol F2) preserves a data-URI inside a url() in an inline style while pinning the length', async () => {
    const out = await pinHtml(`<div style="height:100vh;background:url('data:image/svg+xml,<svg width=%2740vw%27></svg>')"></div>`);
    expect(out).toContain('40vw');           // payload inside url() preserved
    expect(out).toContain('height:800.00px'); // the real length pinned
  });

  it('(Sol F4a) does not corrupt a utility class selector in a <style> block', async () => {
    const out = await pinHtml('<style>.h-100vh{height:100vh}</style>');
    expect(out).toContain('.h-100vh{height:800.00px}');
  });

  it('does not touch a base64 data-URI in an attribute', async () => {
    const b64 = 'data:image/png;base64,iVBOR6vh9wKGgo8vw2QQ6vH0Lvh8Vw==';
    const out = await pinHtml(`<img src="${b64}">`);
    expect(out).toContain(b64);
  });

  it('returns the number of style contexts it pinned (observability)', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.setContent('<style>.a{height:100vh}</style><div style="width:50vw"></div><img src="x.png">');
    const n = await pinDomViewportUnits(page, 1280, 800);
    await page.close();
    expect(n).toBe(2); // the <style> block + the one inline style
  });
});
