import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { chromium } from 'playwright-core';
import { observeHtml } from './slop-observe.js';
import { runDesignEval } from './run.js';
import { checkArtifactIntegrity } from './artifact-integrity.js';

// ONE browser for the whole file. Four describes launching their own Chromium made
// the file fail intermittently under parallel load — every test passed, but the
// FILE went red on a hook timeout. A flaky suite teaches people to ignore red.
// Every case here drives a real Chromium page. Under the full suite these run
// alongside ~200 other files, and the default 5s budget is not enough — the file
// went red while each test passed in isolation. Budget scoped to this file rather
// than raised globally, so a genuinely hung unit test elsewhere still fails fast.
vi.setConfig({ testTimeout: 30000, hookTimeout: 60000 });

let browser;
beforeAll(async () => { browser = await chromium.launch({ headless: true }); }, 60000);
afterAll(async () => { if (browser) await browser.close(); });

const judge = async (html, ground) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    return judgeObservations(await observeHtml(page, html), ground);
  } finally {
    await page.close();
  }
};
const verdict = (out, id) => out.results.find((r) => r.id === id)?.status;
import { judgeObservations } from './slop-verdicts.js';

// The regression net for the architecture change. Every case below is a finding
// from the three audit rounds against the STRING reader. They are collected here
// so the cure is proven on the real thing, not argued.
describe('CSSOM observation — the cases the string reader got wrong (integration)', () => {


  it('does not read a CSS content string as a declaration', async () => {
    const out = await judge('<style>.a::before{content:"font-style:italic; border-left: 4px solid red"}</style><p>hi</p>', { italicCount: 0 });
    expect(verdict(out, 'no-hallucinated-italic')).toBe('notDetected');
    expect(verdict(out, 'no-side-stripe')).toBe('notDetected');
  });

  it('resolves var() instead of reading the variable NAME as a colour', async () => {
    const out = await judge('<style>:root{--white:#fafafa}.a{color:var(--white)}</style><p class="a">hi</p>');
    expect(verdict(out, 'no-pure-bw')).toBe('notDetected');
  });

  it('does not read a custom property as the property it is named after', async () => {
    const out = await judge('<style>:root{--full-height:100vh}</style><p>hi</p>');
    expect(verdict(out, 'hero-dvh')).toBe('notDetected');
  });

  it('ignores copy that is never rendered', async () => {
    const out = await judge('<template><p>ship 🚀</p></template><p hidden>also 🚀</p><p>Real copy</p>');
    expect(verdict(out, 'no-emoji')).toBe('notDetected');
  });

  it('treats one comma-bearing family name as ONE family', async () => {
    const out = await judge('<style>.a{font-family:"Inter, Display",serif}</style><p class="a">hi</p>');
    expect(verdict(out, 'banned-fonts')).toBe('notDetected');
  });

  it('still catches the real thing through any colour notation', async () => {
    for (const css of ['color:hsl(0 0% 0%)', 'color:rgb(0 0 0 / 100%)', 'color:black', 'color:#000']) {
      const out = await judge(`<style>.a{${css}}</style><p class="a">hi</p>`);
      expect(verdict(out, 'no-pure-bw'), css).toBe('violation');
    }
  });

  it('sees gradient text even when the cascade splits it across rules', async () => {
    const html = '<style>h1{background:linear-gradient(90deg,#f00,#00f)}h1{-webkit-background-clip:text}</style><h1>Title</h1>';
    expect(verdict(await judge(html), 'no-gradient-text')).toBe('violation');
  });

  it('sees rules nested inside @media', async () => {
    const html = '<style>@media (min-width:100px){.a{border-left:4px solid #f43}}</style><p class="a">hi</p>';
    expect(verdict(await judge(html), 'no-side-stripe')).toBe('violation');
  });

  it('does not report pure black on a page that never authored a colour', async () => {
    // The trap that computed style would have walked into: the UA default is
    // rgb(0,0,0), so a computed read would fail EVERY page.
    expect(verdict(await judge('<p>Just copy, no colours.</p>'), 'no-pure-bw')).toBe('notDetected');
  });

  it('reports violations without ever publishing a score', async () => {
    const out = await judge('<style>.a{color:#000}</style><p class="a">Ship 🚀</p>');
    expect(out.violations).toEqual(expect.arrayContaining(['no-pure-bw', 'no-emoji']));
    expect(out.score).toBeUndefined();
  });
});

// Field report from a real page (2026-08-12). Three false positives, each verified
// on the page before being believed. The reporter did NOT disable checks or bend
// the design to please the meter — they patched around the bug and told us. These
// are the regression tests for the fixes.
describe('false positives found in the field', () => {


  it('does not read `initial` as authored black (a button reset is not a colour choice)', async () => {
    // border:0 expands to border-color:initial, and initial normalises to rgb(0,0,0).
    const out = await judge('<style>button{border:0}</style><button>Go</button>');
    expect(verdict(out, 'no-pure-bw')).toBe('notDetected');
  });

  it('treats the other CSS-wide keywords the same way', async () => {
    for (const kw of ['unset', 'revert']) {
      const out = await judge(`<style>.a{color:${kw}}</style><p class="a">hi</p>`);
      expect(verdict(out, 'no-pure-bw'), kw).toBe('notDetected');
    }
  });

  it('finds the palette in design TOKENS, not only in direct colour declarations', async () => {
    // A token-driven system declares the palette once on :root and uses var()
    // everywhere. Reading only colour properties reported the whole palette absent.
    const html = '<style>:root{--brand:#c8ff3d;--ink:#1a1a18;--gap:12px}.a{color:var(--brand)}</style><p class="a">hi</p>';
    const out = await judge(html, { palette: ['#c8ff3d', '#1a1a18'] });
    expect(verdict(out, 'palette-match')).toBe('notDetected');
  });

  it('does not mistake a uniform ring for a side stripe', async () => {
    const html = '<style>.avatar{border:3px solid #c8ff3d;border-radius:50%}</style><div class="avatar">A</div>';
    expect(verdict(await judge(html), 'no-side-stripe')).toBe('notDetected');
  });

  it('still catches a genuine one-sided accent stripe', async () => {
    const html = '<style>.callout{border-left:4px solid #f43}</style><div class="callout">note</div>';
    expect(verdict(await judge(html), 'no-side-stripe')).toBe('violation');
  });
});

// The one-call path, on a real browser. run.test.js proves the wiring with a fake
// page; this proves it against Chromium, so a consumer copying the README snippet
// is running something that was actually executed.
describe('runDesignEval end to end (integration)', () => {

  it('renders, observes, judges and checks integrity in one call', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    try {
      const html = '<style>.a{color:#000;font-family:Inter,sans-serif}</style>'
        + '<p class="a">Ship faster \u2014 today</p><img src="path/to/x.png">';
      const out = await runDesignEval(page, html, { italicCount: 0, monoInSource: false });

      expect(out.violations).toEqual(expect.arrayContaining(['no-pure-bw', 'banned-fonts', 'no-emdash']));
      expect(out.results.find((r) => r.id === 'banned-fonts').remedy).toBe('substitute');
      expect(out.violations).toContain('img-src-not-placeholder');
      expect(out.observations.text).toContain('Ship faster');
      expect(out.score).toBeUndefined();
    } finally {
      await page.close();
    }
  });

  it('finds nothing to report on a page that follows the instructions', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    try {
      const html = '<style>:root{--ink:#1a1a18}.a{color:var(--ink);font-family:Aeonik,sans-serif}</style>'
        + '<p class="a">Ship faster, today.</p>';
      const out = await runDesignEval(page, html, { italicCount: 0, monoInSource: false });
      expect(out.violations).toEqual([]);
      // ...and it still refuses to call that a pass.
      expect(out.notDetected.length).toBeGreaterThan(0);
      expect(out.score).toBeUndefined();
    } finally {
      await page.close();
    }
  });
});

// Styling that document.styleSheets alone does not reach. Anything we cannot read
// must NOT come back as "notDetected" — silence would read as compliance.
describe('styling outside the plain document sheets (integration)', () => {

  const judgeLive = async (setup) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    try {
      await page.setContent('<p>base copy</p>', { waitUntil: 'domcontentloaded' });
      await page.evaluate(setup);
      const obs = await page.evaluate((await import('./slop-observe.js')).observeInPage);
      return judgeObservations(obs, { italicCount: 0, monoInSource: false });
    } finally {
      await page.close();
    }
  };
  const verdict = (out, id) => out.results.find((r) => r.id === id)?.status;

  it('reads constructed stylesheets adopted by the document', async () => {
    const out = await judgeLive(() => {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync('.a{color:#000}');
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      document.body.innerHTML = '<p class="a">hi</p>';
    });
    expect(verdict(out, 'no-pure-bw')).toBe('violation');
  });

  it('descends into an open shadow root', async () => {
    const out = await judgeLive(() => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const root = host.attachShadow({ mode: 'open' });
      root.innerHTML = '<style>.b{border-left:4px solid #f43}</style><div class="b">note</div>';
    });
    expect(verdict(out, 'no-side-stripe')).toBe('violation');
  });
});

// Audit r4 — the observer claimed motion that no page performs.
describe('audit r4 — declaration is not animation (integration)', () => {

  const verdict = (out, id) => out.results.find((r) => r.id === id)?.status;

  it('does not call a zero-duration transition an animation', async () => {
    expect(verdict(await judge('<style>.a{transition:width 0s}</style><p class="a">x</p>'), 'motion-transform-opacity')).toBe('notDetected');
  });

  it('does not match a custom property whose NAME contains a layout word', async () => {
    expect(verdict(await judge('<style>.a{transition-property:--width;transition-duration:.3s}</style><p class="a">x</p>'), 'motion-transform-opacity')).toBe('notDetected');
  });

  it('still catches a real layout transition', async () => {
    expect(verdict(await judge('<style>.a{transition:width .3s}</style><p class="a">x</p>'), 'motion-transform-opacity')).toBe('violation');
  });

  it('does not count a border on an element that renders nothing', async () => {
    expect(verdict(await judge('<style>.a{border-left:4px solid #f43;display:block}</style><span class="a"></span>'), 'no-side-stripe')).toBe('notDetected');
  });

  it('does not call an empty element gradient TEXT', async () => {
    const html = '<style>h1{background:linear-gradient(90deg,#f00,#00f);-webkit-background-clip:text}</style><h1></h1>';
    expect(verdict(await judge(html), 'no-gradient-text')).toBe('notDetected');
  });
});

// Reported by the Amigo Secreto session, verified here. The conclusion is theirs
// and it is right: the `initial` guard is load-bearing. The MECHANISM measured in
// this Chromium is a third one neither of us had named — in their own reset rule
// it is `background: none` that serialises `background-color` as `initial`, while
// `border: 0` serialises `border-color` as `currentcolor`.
//
// The test uses their REAL rule rather than the mechanism, so it keeps holding
// whichever property a given Chromium version serialises as `initial`.
describe('CSS-wide keywords in a real reset rule (integration)', () => {
  it('does not read a button reset as authored black', async () => {
    const html = '<style>button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}</style><button>Go</button>';
    expect(verdict(await judge(html), 'no-pure-bw')).toBe('notDetected');
  });

  it('does not read a colourless border shorthand as authored black', async () => {
    const html = '<style>.faces img{border:3px solid}</style><div class="faces"><img src="/a.png" alt=""></div>';
    expect(verdict(await judge(html), 'no-pure-bw')).toBe('notDetected');
  });

  it('still catches black authored on purpose next to a reset', async () => {
    const html = '<style>button{background:none;border:0}.ink{color:#000}</style><button>Go</button><p class="ink">hi</p>';
    expect(verdict(await judge(html), 'no-pure-bw')).toBe('violation');
  });
});

// This test exists to stop a future "simplification".
//
// `runDesignEvalOnPage` takes the artifact bytes via opts.source instead of
// calling page.content(). That looks like an unnecessary parameter — the page is
// RIGHT THERE — and the Amigo Secreto session flagged that whoever optimises this
// later will reach for page.content(). The reason is not obvious, so it is
// measured here rather than asserted in a comment: the HTML parser REPAIRS a
// truncated document, so the serialised DOM no longer carries the evidence the
// integrity check exists to find.
describe('why integrity reads the source bytes, not the page (integration)', () => {
  it('the browser repairs truncation, so page.content() cannot see it', async () => {
    const truncado = '<!doctype html><html><body><div><p>conteudo<img sr';

    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    let servido;
    try {
      await page.setContent(truncado, { waitUntil: 'domcontentloaded' });
      servido = await page.content();
    } finally {
      await page.close();
    }

    // The source ends inside an unclosed tag; the reserialised DOM never does.
    expect(truncado.lastIndexOf('<') > truncado.lastIndexOf('>')).toBe(true);
    expect(servido.lastIndexOf('<') > servido.lastIndexOf('>')).toBe(false);
    expect(servido).toContain('</html>'); // the parser closed everything the model left open

    // And the verdicts follow: the source is judged, the page is not.
    expect(checkArtifactIntegrity(truncado).failed).toContain('no-truncation');
    expect(checkArtifactIntegrity(servido).failed).not.toContain('no-truncation');
  });
});

// Audit round 5 — verified in a real browser.
describe('audit r5 (integration)', () => {
  it('pairs each transition property with ITS OWN duration', async () => {
    const html = '<style>.a{transition-property:opacity,width;transition-duration:1s,0s}</style><p class="a">x</p>';
    expect(verdict(await judge(html), 'motion-transform-opacity')).toBe('notDetected');
  });

  it('still catches the layout property when IT is the one with time', async () => {
    const html = '<style>.a{transition-property:opacity,width;transition-duration:0s,1s}</style><p class="a">x</p>';
    expect(verdict(await judge(html), 'motion-transform-opacity')).toBe('violation');
  });

  it('treats an absent duration as 0s, which is what CSS does', async () => {
    expect(verdict(await judge('<style>.a{transition-property:width}</style><p class="a">x</p>'), 'motion-transform-opacity')).toBe('notDetected');
  });

  it('survives a page rule that tries to override every colour', async () => {
    // The probe lives in the document, so `span{color:blue!important}` used to win
    // over it and every "observed" colour came back blue.
    const html = '<style>span{color:blue!important}:root{--brand:#ff0000}</style><p><span>x</span></p>';
    const out = await judge(html, { palette: ['#ff0000'] });
    expect(verdict(out, 'palette-match')).toBe('notDetected');
  });

  it('does not call invisible text gradient text', async () => {
    const html = '<style>h1{background:linear-gradient(90deg,#f00,#00f);-webkit-background-clip:text;opacity:0}</style><h1>Title</h1>';
    expect(verdict(await judge(html), 'no-gradient-text')).toBe('notDetected');
  });

  it('does not count italic on an element whose only text is hidden', async () => {
    const html = '<style>.a{font-style:italic}.h{display:none}</style><div class="a"><span class="h">oculto</span></div>';
    const out = await judge(html, { italicCount: 0 });
    expect(verdict(out, 'no-hallucinated-italic')).toBe('notDetected');
  });

  it('reads image sources from the parsed DOM, so markup tricks do not matter', async () => {
    const html = '<img alt="2 > 1" src="/real.png"><script>const s = \'<img src="placeholder.png">\';</script>';
    expect(verdict(await judge(html), 'img-src-not-placeholder')).toBe('notDetected');
  });
});

// Audit round 6.
describe('audit r6 — the observer must not change what it measures', () => {
  it('does not let its own colour probe be styled by the page', async () => {
    // The probe used to be a bare <span> appended to <html>. A page rule for
    // `span` styled it, and the probe itself was counted as an element — the
    // observer fabricating a violation out of its own instrument.
    const html = '<style>span{display:block!important;width:20px;height:20px;border-left:2px solid red}</style><p>copy</p>';
    expect(verdict(await judge(html), 'no-side-stripe')).toBe('notDetected');
  });

  it('does not flag a responsive image that uses srcset instead of src', async () => {
    const html = '<img srcset="hero-640.jpg 640w, hero-1280.jpg 1280w" sizes="100vw" alt="Hero">';
    expect(verdict(await judge(html), 'img-src-not-placeholder')).toBe('notDetected');
  });

  it('still flags an image with no source at all', async () => {
    expect(verdict(await judge('<img alt="nada">'), 'img-src-not-placeholder')).toBe('violation');
  });

  it('respects an ANCESTOR that hides the element', async () => {
    const html = '<style>h1{background:linear-gradient(red,blue);-webkit-background-clip:text}'
      + '.c{border-left:4px solid #f43}</style>'
      + '<div style="opacity:0"><h1>Invisivel</h1><div class="c">nota</div></div>';
    const out = await judge(html);
    expect(verdict(out, 'no-gradient-text')).toBe('notDetected');
    expect(verdict(out, 'no-side-stripe')).toBe('notDetected');
  });

  it('resolves a transition duration written as a variable', async () => {
    const html = '<style>.a{--d:1s;transition-property:width;transition-duration:var(--d)}</style><p class="a">x</p>';
    expect(verdict(await judge(html), 'motion-transform-opacity')).toBe('violation');
  });

  it('does not count a keyframes block that nothing uses', async () => {
    const html = '<style>@keyframes dead{to{width:10px}}</style><p>copy</p>';
    expect(verdict(await judge(html), 'motion-transform-opacity')).toBe('notDetected');
  });

  it('counts a keyframes block that an element actually runs', async () => {
    const html = '<style>@keyframes grow{to{width:10px}}.a{animation:grow 1s}</style><p class="a">x</p>';
    expect(verdict(await judge(html), 'motion-transform-opacity')).toBe('violation');
  });
});
