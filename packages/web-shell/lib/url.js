// Light URL normalization for the "Add URL" flow.
// - Trims surrounding whitespace.
// - Strips an optional `www.` only AFTER scheme normalization, so the
//   normalized output keeps `https://www.example.com`-style if the user
//   pasted that directly. We just don't REQUIRE the user to type it.
// - Prepends `https://` when the user typed a bare host (`example.com`,
//   `news.ycombinator.com/item?id=…`, etc).
// Returns null when the input can't plausibly be a URL.

export function normalizeUrl(raw) {
  if (typeof raw !== 'string') return null;
  let v = raw.trim();
  if (!v) return null;

  // Already has a scheme → keep as is, but only http/https are accepted
  // by the capture pipeline.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) {
    if (!/^https?:\/\//i.test(v)) return null;
    return v;
  }

  // Bare host or host+path. Reject anything that doesn't look like a
  // domain (no dot, no localhost) before we tack on https://.
  const hostFragment = v.split(/[/?#]/, 1)[0];
  if (!/[.]/.test(hostFragment) && hostFragment.toLowerCase() !== 'localhost') {
    return null;
  }
  return 'https://' + v;
}

// Inexpensive URL-shape check used to enable submit buttons. Doesn't hit
// the network. Pair it with the server-side reachability gate.
export function looksLikeUrl(raw) {
  return normalizeUrl(raw) != null;
}
