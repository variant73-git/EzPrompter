import { describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import tar from 'tar-stream';
import { createMemoryBundleStore } from '../native-clone/bundle-store.js';
import { registerNativeBundle } from '../native-clone/register-bundle.js';
import { canonicalProducerOutput, readTarGz } from './output-bundle.js';

async function tgz(entries) {
  const pack = tar.pack();
  for (const e of entries) {
    if (e.dir) pack.entry({ name: e.name, type: 'directory' }, '');
    else pack.entry({ name: e.name }, Buffer.from(e.body));
  }
  pack.finalize();
  const chunks = [];
  for await (const c of pack) chunks.push(c);
  return gzipSync(Buffer.concat(chunks));
}

describe('saída da máquina', () => {
  it('lê só arquivos, sem o ./ do começo', async () => {
    const buf = await tgz([{ name: './', dir: true }, { name: './index.html', body: '<html>' }, { name: './vendor/gsap.min.js', body: 'g' }]);
    const files = await readTarGz(buf);
    expect(files.map((f) => f.path)).toEqual(['index.html', 'vendor/gsap.min.js']);
    expect(Buffer.from(files[0].body).toString()).toBe('<html>');
  });

  it('preserva o tipo que a captura deu aos arquivos sem extensão e deixa o resto inferir', () => {
    const files = [
      { path: 'index.html', body: new Uint8Array([1]) },
      { path: 'motion.json', body: new Uint8Array([2]) },
      { path: '_ext/cdn/abc', body: new Uint8Array([3]) },
    ];
    const out = canonicalProducerOutput({ files, nativeDescriptor: { assetIndex: [{ path: '_ext/cdn/abc', contentType: 'image/png' }] } });
    expect(out.entryPath).toBe('index.html');
    expect(out.assets.find((a) => a.path === '_ext/cdn/abc').contentType).toBe('image/png');
    expect(out.assets.find((a) => a.path === 'index.html').contentType).toBeUndefined();
    expect(out.runtimeFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('sem motion.json a montagem não terminou: falha tipada', () => {
    expect(() => canonicalProducerOutput({ files: [{ path: 'index.html', body: new Uint8Array([1]) }], nativeDescriptor: { assetIndex: [] } }))
      .toThrow(expect.objectContaining({ code: 'recording_failed' }));
  });

  it('a saída registra como pacote', async () => {
    const files = [
      { path: 'index.html', body: new TextEncoder().encode('<html></html>') },
      { path: 'motion.json', body: new TextEncoder().encode('{"versao":0,"fichas":[]}') },
    ];
    const descriptor = await registerNativeBundle(canonicalProducerOutput({ files, nativeDescriptor: { assetIndex: [] } }), { store: createMemoryBundleStore() });
    expect(descriptor.entryPath).toBe('index.html');
    expect(descriptor.assetIndex.find((a) => a.path === 'motion.json').contentType).toBe('application/json; charset=utf-8');
  });
});
