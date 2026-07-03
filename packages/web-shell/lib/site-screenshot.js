import { launchBrowser } from './browser.js';

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

export async function renderHtmlScreenshot(html, { width = 1280, maxHeight = 2400 } = {}) {
  const work = (async () => {
    let browser;
    try {
      browser = await launchBrowser();
      const context = await browser.newContext({ viewport: { width, height: 800 } });
      const page = await context.newPage();
      // networkidle can hang on pages with long-polling/analytics; fall
      // through and screenshot whatever has rendered by then.
      await page
        .setContent(html, { waitUntil: 'networkidle', timeout: SETCONTENT_TIMEOUT_MS })
        .catch(() => {});
      const contentHeight = await page
        .evaluate(() => Math.max(
          document.documentElement.scrollHeight,
          document.body ? document.body.scrollHeight : 0,
        ))
        .catch(() => 800);
      const height = Math.max(400, Math.min(contentHeight || 800, maxHeight));
      await page.setViewportSize({ width, height });
      const buf = await page.screenshot({ type: 'png', fullPage: false });
      return `data:image/png;base64,${buf.toString('base64')}`;
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
