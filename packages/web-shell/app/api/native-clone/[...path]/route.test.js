import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET } from './route.js';

let root;

describe('native clone bundle route', () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'uncraft-clone-'));
    process.env.UNCRAFT_NATIVE_CLONE_ROOT = root;
    await writeFile(join(root, 'index.html'), '<html><head></head><body>ok</body></html>');
    await mkdir(join(root, 'assets'));
    // Clone savers keep the URL-encoded name verbatim on disk — the browser
    // request arrives DECODED, so serving must fall back to the encoded name.
    await writeFile(join(root, 'assets', 'arrow%20white.svg'), '<svg></svg>');
  });

  afterEach(async () => {
    delete process.env.UNCRAFT_NATIVE_CLONE_ROOT;
    await rm(root, { recursive: true, force: true });
  });

  it('serves an asset whose on-disk name is still URL-encoded', async () => {
    const response = await GET(null, { params: { path: ['assets', 'arrow white.svg'] } });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('<svg></svg>');
  });

  it('still 404s when neither the decoded nor the encoded name exists', async () => {
    const response = await GET(null, { params: { path: ['assets', 'missing file.svg'] } });
    expect(response.status).toBe(404);
  });
});
