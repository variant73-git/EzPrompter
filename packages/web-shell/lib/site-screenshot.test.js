import { describe, it, expect, vi, beforeEach } from 'vitest';

const screenshotBuf = Buffer.from('PNGDATA');
const page = {
  setContent: vi.fn().mockResolvedValue(),
  evaluate: vi.fn().mockResolvedValue(1234),
  setViewportSize: vi.fn().mockResolvedValue(),
  screenshot: vi.fn().mockResolvedValue(screenshotBuf),
};
const context = { newPage: vi.fn(async () => page) };
const browser = {
  newContext: vi.fn(async () => context),
  close: vi.fn().mockResolvedValue(),
};

vi.mock('./browser.js', () => ({ launchBrowser: vi.fn(async () => browser) }));

const { renderHtmlScreenshot } = await import('./site-screenshot.js');

beforeEach(() => {
  vi.clearAllMocks();
  page.evaluate.mockResolvedValue(1234);
  page.screenshot.mockResolvedValue(screenshotBuf);
});

describe('renderHtmlScreenshot', () => {
  it('renders html to a png data url and closes the browser', async () => {
    const url = await renderHtmlScreenshot('<html><body>hi</body></html>');
    expect(url).toBe(`data:image/png;base64,${screenshotBuf.toString('base64')}`);
    expect(page.setContent).toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalled();
  });

  it('captures fullPage with a clip capped at maxHeight — never resizes the viewport', async () => {
    // Growing the viewport to the content height re-lays-out vh-based
    // designs (100vh chapters inflate to the page height → stretched
    // thumbnails). The render must keep the 800px viewport and cap via clip.
    page.evaluate.mockResolvedValue(99999);
    await renderHtmlScreenshot('<html></html>', { maxHeight: 2400 });
    expect(page.setViewportSize).not.toHaveBeenCalled();
    expect(page.screenshot).toHaveBeenCalledWith(expect.objectContaining({
      fullPage: true,
      clip: { x: 0, y: 0, width: 1280, height: 2400 },
    }));
  });

  it('clips to the measured content height when below maxHeight', async () => {
    page.evaluate.mockResolvedValue(1234);
    await renderHtmlScreenshot('<html></html>', { maxHeight: 12000 });
    expect(page.screenshot).toHaveBeenCalledWith(expect.objectContaining({
      clip: { x: 0, y: 0, width: 1280, height: 1234 },
    }));
  });

  it('closes the browser even when the screenshot fails', async () => {
    page.screenshot.mockRejectedValueOnce(new Error('boom'));
    await expect(renderHtmlScreenshot('<html></html>')).rejects.toThrow('boom');
    expect(browser.close).toHaveBeenCalled();
  });

  it('injects <base href> into <head> when baseUrl is given', async () => {
    await renderHtmlScreenshot('<html><head><title>x</title></head><body><img src="/rasters/a/r-1.png"></body></html>', {
      baseUrl: 'http://localhost:3030',
    });
    const doc = page.setContent.mock.calls[0][0];
    expect(doc).toContain('<head><base href="http://localhost:3030/">');
  });

  it('does not inject a second <base> when one exists', async () => {
    await renderHtmlScreenshot('<html><head><base href="https://x.dev/"></head></html>', {
      baseUrl: 'http://localhost:3030',
    });
    const doc = page.setContent.mock.calls[0][0];
    expect(doc.match(/<base\s/gi)).toHaveLength(1);
  });

  it('leaves the document untouched without baseUrl', async () => {
    await renderHtmlScreenshot('<html><head></head></html>');
    expect(page.setContent.mock.calls[0][0]).toBe('<html><head></head></html>');
  });
});
