import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createMemoryBundleStore } from '../native-clone/bundle-store.js';
import { registerNativeBundle } from '../native-clone/register-bundle.js';
import { PAYLOAD_FILES, VM_PACKAGE_JSON, chunkBySize, loadCapturePayload, loadCodePayload } from './payload.js';
import { VM } from './sandbox-runner.js';

const raiz = path.resolve(__dirname, '../..');

// Fecho de imports ESTÁTICOS a partir do script de montagem: se alguém acrescentar um import, a lista do
// pacote tem que acompanhar (o plano-nativo é import dinâmico e só roda sem --sem-plano — fora do M1).
function fechoDeImports(inicio) {
  const visto = new Set();
  const fila = [inicio];
  while (fila.length) {
    const rel = fila.shift();
    if (visto.has(rel)) continue;
    visto.add(rel);
    const src = readFileSync(path.join(raiz, rel), 'utf8');
    const alvos = [...src.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]/gm)].map((m) => m[1]);
    for (const alvo of alvos) fila.push(path.posix.normalize(path.posix.join(path.posix.dirname(rel), alvo)));
  }
  return [...visto].sort();
}

describe('pacote de entrada da máquina', () => {
  it('a lista de arquivos é exatamente o fecho do script + o tocador', () => {
    const esperado = [...new Set([...fechoDeImports('scripts/normalizar-clone.mjs'), 'lib/motion-program/uncraft-motion.js'])].sort();
    expect([...PAYLOAD_FILES].sort()).toEqual(esperado);
  });

  it('código vai para /vercel/sandbox/c com package.json fixo e o script executável', async () => {
    const files = await loadCodePayload({ root: raiz });
    expect(files.find((f) => f.path === `${VM.code}/scripts/normalizar-clone.mjs`)).toBeTruthy();
    expect(JSON.parse(files.find((f) => f.path === `${VM.code}/package.json`).content)).toEqual(VM_PACKAGE_JSON);
    const script = files.find((f) => f.path === VM.script);
    expect(script.mode).toBe(0o755);
  });

  it('captura vai com a página e o tipo de cada arquivo ao lado', async () => {
    const store = createMemoryBundleStore();
    const descriptor = await registerNativeBundle({
      entryPath: 'index.html',
      runtimeFingerprint: `sha256:${'a'.repeat(64)}`,
      assets: [
        { path: 'index.html', body: new TextEncoder().encode('<html></html>'), contentType: 'text/html; charset=utf-8' },
        { path: '_ext/cdn/abc', body: new Uint8Array([1, 2]), contentType: 'image/png' },
      ],
    }, { store });
    const files = await loadCapturePayload({ store, descriptor });
    expect(files.map((f) => f.path).sort()).toEqual([
      `${VM.capture}/_ext/cdn/abc`, `${VM.capture}/_ext/cdn/abc.uncraft-meta.json`,
      `${VM.capture}/index.html`, `${VM.capture}/index.html.uncraft-meta.json`,
    ]);
    const meta = files.find((f) => f.path === `${VM.capture}/_ext/cdn/abc.uncraft-meta.json`);
    expect(JSON.parse(Buffer.from(meta.content).toString())).toEqual({ contentType: 'image/png' });
  });

  it('captura cuja página não é index.html falha tipada', async () => {
    await expect(loadCapturePayload({ store: createMemoryBundleStore(), descriptor: { entryPath: 'sobre/index.html', assetIndex: [] } }))
      .rejects.toMatchObject({ code: 'capture_failed' });
  });

  it('lotes por tamanho nunca passam do teto, salvo arquivo maior que ele sozinho', () => {
    const f = (n) => ({ path: String(n), content: new Uint8Array(n) });
    const lotes = chunkBySize([f(6), f(6), f(3), f(20)], 10);
    expect(lotes.map((l) => l.map((x) => x.path))).toEqual([['6'], ['6', '3'], ['20']]);
  });
});
