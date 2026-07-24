import { launchBrowser } from './browser.js';
import { waitForImagesSettled } from './snapshot.js';

// Render a snapshot's HTML to a PNG screenshot data URL. This is how the
// chat agent "sees" a site node: image nodes arrive as their dataUrl, site
// nodes arrive as this render. Capture-sourced snapshots already carry a
// live-site screenshot in snapshots.screenshot_url; this covers the rest
// (compose/runFlow/clone/edited snapshots) whose screenshot_url is null.
//
// The result is cached by the caller on the snapshot row, so each snapshot
// pays the headless render exactly once.

const SETCONTENT_TIMEOUT_MS = 20_000;
const TOTAL_TIMEOUT_MS = 35_000;

export async function renderHtmlScreenshot(html, { width = 1280, maxHeight = 2400, baseUrl = null, type = 'png', quality } = {}) {
  // setContent loads the document at about:blank — RELATIVE asset URLs
  // (e.g. the reconstruct pipeline's /rasters/<hash>/raster-N.png) resolve
  // against nothing and every one of them 404s, rendering broken-image
  // icons into the screenshot. Injecting <base href> re-anchors them to
  // the app origin. Skipped when the document already declares a <base>.
  let doc = html;
  if (baseUrl && typeof doc === 'string' && !/<base\s/i.test(doc)) {
    const tag = `<base href="${baseUrl.replace(/"/g, '')}/">`;
    if (/<head[^>]*>/i.test(doc)) doc = doc.replace(/<head[^>]*>/i, (m) => `${m}${tag}`);
    else doc = tag + doc;
  }
  const work = (async () => {
    let browser;
    try {
      browser = await launchBrowser();
      const context = await browser.newContext({ viewport: { width, height: 800 } });
      const page = await context.newPage();
      // networkidle can hang on pages with long-polling/analytics; fall
      // through and screenshot whatever has rendered by then.
      await page
        .setContent(doc, { waitUntil: 'networkidle', timeout: SETCONTENT_TIMEOUT_MS })
        .catch(() => {});
      // Walk the page once before shooting so scroll-reveal animations
      // (IntersectionObserver fade/slide entries) fire for below-fold
      // sections — otherwise they'd be captured at opacity 0. Step count
      // capped so a pathological infinite-scroll page can't stall.
      await page
        .evaluate(async () => {
          const total = Math.max(
            document.documentElement.scrollHeight,
            document.body ? document.body.scrollHeight : 0,
          );
          const step = window.innerHeight || 800;
          const maxSteps = 40;
          for (let i = 0, y = 0; i < maxSteps && y <= total; i++, y += step) {
            window.scrollTo(0, y);
            await new Promise((r) => setTimeout(r, 60));
          }
          window.scrollTo(0, 0);
          await new Promise((r) => setTimeout(r, 250));
        })
        .catch(() => {});
      // The scroll-through triggers lazy/LQIP images; a fixed 250ms then races
      // their swap and the shot can capture a blurred low-res placeholder —
      // which, when this render feeds a clone's crop, becomes a pixelated hero.
      // Wait until every visible <img> is complete AND decoded (capped).
      await waitForImagesSettled(page, 4000);
      const contentHeight = await page
        .evaluate(() => Math.max(
          document.documentElement.scrollHeight,
          document.body ? document.body.scrollHeight : 0,
        ))
        .catch(() => 800);
      const height = Math.max(400, Math.min(contentHeight || 800, maxHeight));
      // fullPage capture with a page-coordinate clip capping the height —
      // instead of growing the viewport to the content height. Growing the
      // viewport re-laid-out vh-based designs against the giant viewport:
      // every 100vh "full-screen chapter" inflated to the whole page height
      // and the thumbnail came out as stretched bars. fullPage keeps layout
      // exactly as a visitor sees it at 1280×800 (a bare clip without
      // fullPage gets intersected with the viewport and comes back 800 tall).
      const fmt = type === 'jpeg' ? 'jpeg' : 'png';
      const buf = await page.screenshot({
        type: fmt,
        fullPage: true,
        clip: { x: 0, y: 0, width, height },
        ...(fmt === 'jpeg' ? { quality: quality || 82 } : {}),
      });
      return `data:image/${fmt};base64,${buf.toString('base64')}`;
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  })();

  return Promise.race([
    work,
    new Promise((_, reject) => setTimeout(
      () => reject(new Error(`site render exceeded ${TOTAL_TIMEOUT_MS / 1000}s`)),
      TOTAL_TIMEOUT_MS,
    )),
  ]);
}
