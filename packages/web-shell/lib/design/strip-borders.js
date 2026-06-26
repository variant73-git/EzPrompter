/**
 * strip-borders.js — deterministic "no border by default" for restyle output.
 *
 * Vision models keep adding a reflexive thin full-card OUTLINE (border: 1-2px
 * solid <color>) that the source image doesn't have. Prompt bias reduces it but
 * can't guarantee it (image sources have no DOM to read as ground truth). This
 * is the hardcoded backstop: strip that outline from the generated HTML.
 *
 * Conservative on purpose — only removes a full thin solid border on an element
 * whose INLINE style also has the card signature (border-radius + a background).
 * Preserves:
 *   - single-side borders (border-top / -right / -bottom / -left) — dividers, accents
 *   - thicker / decorative borders (>= 3px)
 *   - borders on elements without radius+background (form controls, dividers, …)
 *   - everything inside <style> class rules (regex on CSS is unsafe → left to the
 *     prompt bias). Restyle output is inline-heavy, so this covers the common case.
 */

// One inline style body → drop the card outline if the card signature is present.
function stripOne(body) {
  if (!/border\s*:\s*[12](\.\d+)?px\s+solid/i.test(body)) return body;
  if (!/border-radius/i.test(body)) return body;   // not a rounded container
  if (!/background/i.test(body)) return body;       // not a filled surface
  return body
    .replace(/border\s*:\s*[12](\.\d+)?px\s+solid\s+[^;"]+;?/i, '')
    .replace(/;\s*;/g, ';')
    .replace(/^\s*;\s*/, '')
    .trim();
}

export function stripCardBorders(html) {
  if (!html || typeof html !== 'string') return html;
  return html.replace(/style\s*=\s*"([^"]*)"/gi, (full, body) => {
    const cleaned = stripOne(body);
    return cleaned === body ? full : `style="${cleaned}"`;
  });
}
