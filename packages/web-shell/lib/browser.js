import { chromium } from 'playwright-core';

// Shared headless-Chromium launcher. Production (Browserbase) connects to a
// remote browser over CDP; local dev launches the installed Chromium.
// Mirrors lib/snapshot.js's launchBrowser so screenshot paths behave the
// same in prod and dev.
export async function launchBrowser() {
  if (process.env.BROWSERBASE_API_KEY) {
    // Browserbase: connect to remote chromium via CDP.
    const wsUrl = `wss://connect.browserbase.com?apiKey=${encodeURIComponent(process.env.BROWSERBASE_API_KEY)}`;
    return chromium.connectOverCDP(wsUrl);
  }
  // Local fallback. Requires `bunx playwright install chromium` once.
  return chromium.launch({ headless: true });
}
