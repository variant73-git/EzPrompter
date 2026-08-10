const TRACKING_PARAMS = new Set([
  'ref',
  'referrer',
  'source',
  'utm_campaign',
  'utm_content',
  'utm_medium',
  'utm_source',
  'utm_term',
]);

export function canonicalizeReferenceUrl(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol)) return null;

    url.protocol = 'https:';
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    url.pathname = url.pathname
      .replace(/\/(?:index\.html?)$/i, '/')
      .replace(/\/{2,}/g, '/');
    if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/$/, '');

    const query = url.searchParams.toString();
    const path = url.pathname === '/' ? '' : url.pathname;
    const canonicalKey = `${url.hostname}${path}${query ? `?${query}` : ''}`;
    return {
      canonicalKey,
      canonicalUrl: `https://${canonicalKey}`,
      host: url.hostname,
    };
  } catch {
    return null;
  }
}

export function uniqueText(values) {
  return [...new Set(
    (values || [])
      .map((value) => String(value || '').trim())
    .filter(Boolean),
  )];
}
