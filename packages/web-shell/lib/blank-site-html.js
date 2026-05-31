/**
 * Seed HTML for a fresh blank-website node — rendered inside the cnode
 * iframe as the empty-state visual. Both creation paths use this:
 *   - "+" button → CanvasClient.handleAddBlankSite
 *   - agent's createNode tool (type='blank-website')
 *
 * Keep the markup identical between callers so users can't tell which
 * path produced the node.
 */
export const BLANK_SITE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Blank website</title>
<style>
  :root { color-scheme: light; }
  html, body { margin: 0; padding: 0; min-height: 100vh; background: #fafafa; }
  body {
    display: flex; align-items: center; justify-content: center;
    color: #64748b;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
                 "Helvetica Neue", Arial, "Noto Sans", sans-serif;
    font-size: 14px; letter-spacing: -0.005em;
  }
  .hint {
    text-align: center; padding: 28px;
    max-width: 320px;
  }
  .hint-icon {
    width: 56px; height: 56px; margin: 0 auto 18px;
    border: 1.5px dashed rgba(45, 212, 191, 0.55);
    border-radius: 14px;
    display: inline-flex; align-items: center; justify-content: center;
    color: rgba(45, 212, 191, 0.85);
    background: rgba(45, 212, 191, 0.06);
  }
  .hint-title {
    font-size: 14px; color: #334155; font-weight: 500;
    margin: 0 0 6px;
  }
  .hint-sub {
    font-size: 12.5px; color: #94a3b8; line-height: 1.5; margin: 0;
  }
</style>
</head>
<body>
<div class="hint" role="status">
  <div class="hint-icon" aria-hidden="true">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <path d="M9 9h6M9 13h6M9 17h4"/>
    </svg>
  </div>
  <p class="hint-title">Blank website</p>
  <p class="hint-sub">Connect inputs from other nodes or build from the asset library.</p>
</div>
</body>
</html>`;

export const BLANK_SITE_DEFAULTS = {
  width: 1280,
  height: 720,    // Math.round(1280 * 9 / 16)
  name: 'Blank website',
};
