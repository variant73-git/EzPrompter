import path from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
import { injectRuntimeBridge, rewriteRuntimePaths } from '../../../../lib/motion-editor/native-clone-gateway.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MIME_TYPES = {
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.m4v': 'video/x-m4v',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ttf': 'font/ttf',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const TEXT_EXTENSIONS = new Set(['.css', '.html', '.js', '.json', '.svg']);

function notAvailable(message, status = 404) {
  return Response.json({ error: message }, { status });
}

export async function GET(_request, { params }) {
  const configuredRoot = process.env.UNCRAFT_NATIVE_CLONE_ROOT;
  if (!configuredRoot) {
    return notAvailable('UNCRAFT_NATIVE_CLONE_ROOT is not configured.', 503);
  }

  const root = await realpath(configuredRoot).catch(() => null);
  if (!root) return notAvailable('The configured native clone bundle does not exist.', 503);

  const resolvedParams = await params;
  const segments = Array.isArray(resolvedParams?.path) ? resolvedParams.path : [];
  const relativePath = segments.length ? segments.join('/') : 'index.html';
  const candidate = path.resolve(root, relativePath);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    return notAvailable('Invalid bundle path.', 400);
  }

  const filePath = await realpath(candidate).catch(() => null);
  if (!filePath || (filePath !== root && !filePath.startsWith(`${root}${path.sep}`))) {
    return notAvailable('Bundle asset not found.');
  }

  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile()) return notAvailable('Bundle asset not found.');

  const extension = path.extname(filePath).toLowerCase();
  const headers = new Headers({
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': extension === '.html' ? 'no-store' : 'public, max-age=3600',
    'Content-Type': MIME_TYPES[extension] || 'application/octet-stream',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'X-Content-Type-Options': 'nosniff',
  });

  const bytes = await readFile(filePath);
  if (!TEXT_EXTENSIONS.has(extension)) return new Response(bytes, { headers });

  let body = rewriteRuntimePaths(bytes.toString('utf8'));
  if (extension === '.html') {
    body = injectRuntimeBridge(body);
    headers.set('Content-Security-Policy', [
      "default-src 'self' data: blob:",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "media-src 'self' data: blob:",
      "connect-src 'none'",
      "frame-ancestors 'self'",
      "form-action 'none'",
      "object-src 'none'",
      "base-uri 'none'",
    ].join('; '));
  }

  return new Response(body, { headers });
}
