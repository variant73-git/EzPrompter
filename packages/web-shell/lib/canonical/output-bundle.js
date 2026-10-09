// O .tgz que a máquina deixa vira a entrada do registerNativeBundle. O tipo de cada arquivo copiado da captura
// é o que a captura registrou (arquivos sem extensão, como `_ext/...`, viravam octet-stream por inferência);
// o que é nosso (index.html, motion.json, vendor/) o registro infere pela extensão.
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import tar from 'tar-stream';

export const MAX_ARCHIVE_BYTES = 400 * 1024 * 1024;

export async function readTarGz(buffer, { maxBytes = MAX_ARCHIVE_BYTES } = {}) {
  const raw = gunzipSync(buffer, { maxOutputLength: maxBytes });
  const extract = tar.extract();
  const files = [];
  await new Promise((resolve, reject) => {
    extract.on('entry', (header, stream, next) => {
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('error', reject);
      stream.on('end', () => {
        const name = header.name.replace(/^\.\//, '');
        if (header.type === 'file' && name) files.push({ path: name, body: new Uint8Array(Buffer.concat(chunks)) });
        next();
      });
    });
    extract.on('finish', resolve);
    extract.on('error', reject);
    extract.end(raw);
  });
  return files;
}

export function canonicalProducerOutput({ files, nativeDescriptor }) {
  const paths = new Set(files.map((f) => f.path));
  for (const required of ['index.html', 'motion.json']) {
    if (!paths.has(required)) throw Object.assign(new Error(`output_incomplete: ${required}`), { code: 'recording_failed', detail: `missing ${required}` });
  }
  const known = new Map((nativeDescriptor?.assetIndex || []).map((a) => [a.path, a.contentType]));
  const assets = files.map(({ path, body }) => (known.has(path) ? { path, body, contentType: known.get(path) } : { path, body }));
  const fingerprint = createHash('sha256').update(Buffer.from(files.map((f) => f.path).sort().join('\n'))).digest('hex');
  return {
    entryPath: 'index.html',
    assets,
    runtimeFingerprint: `sha256:${fingerprint}`,
    reconstructionCapabilities: { detectedEngines: [], candidateControls: [] },
  };
}
