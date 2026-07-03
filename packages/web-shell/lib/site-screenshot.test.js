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

  it('clamps viewport height to maxHeight for very tall pages', async () => {
    page.evaluate.mockResolvedValue(99999);
    await renderHtmlScreenshot('<html></html>', { maxHeight: 2400 });
    expect(page.setViewportSize).toHaveBeenCalledWith({ width: 1280, height: 2400 });
  });

  it('closes the browser even when the screenshot fails', async () => {
    page.screenshot.mockRejectedValueOnce(new Error('boom'));
    await expect(renderHtmlScreenshot('<html></html>')).rejects.toThrow('boom');
    expect(browser.close).toHaveBeenCalled();
  });
});
