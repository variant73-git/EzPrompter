// O que vai para a máquina: o script de montagem (com o fecho dos seus imports), o tocador, um package.json
// com versões FIXAS e a captura nativa com o tipo de cada arquivo ao lado (o script lê `<arq>.uncraft-meta.json`).
import { readFile as fsReadFile } from 'node:fs/promises';
import path from 'node:path';
import { indexedAssetKey } from '../native-clone/bundle-store.js';
import { descriptorFromRow } from '../motion-editor/runtime-gateway-core.js';
import { VM, buildRunScript } from './sandbox-runner.js';

export const PAYLOAD_FILES = Object.freeze([
  'lib/motion-program/uncraft-motion.js',
  'scripts/compilar-movimento.mjs',
  'scripts/gravar-trajetoria.mjs',
  'scripts/inventario-conteudo.mjs',
  'scripts/lenis-instantanea.mjs',
  'scripts/ler-gsap.mjs',
  'scripts/ler-ix3.mjs',
  'scripts/mapa-da-captura.mjs',
  'scripts/normalizar-clone.mjs',
  'scripts/rastro-gravacao.mjs',
]);

export const VM_PACKAGE_JSON = Object.freeze({
  name: 'canonica-carga',
  private: true,
  dependencies: { 'playwright-core': '1.60.0', playwright: '1.60.0', gsap: '3.15.0', lenis: '1.3.26', 'lottie-web': '5.13.0' },
});

const CAPTURE_READ_CONCURRENCY = 8;

export async function loadCodePayload({ root = process.cwd(), readFile = fsReadFile } = {}) {
  const files = await Promise.all(PAYLOAD_FILES.map(async (rel) => ({
    path: `${VM.code}/${rel}`,
    content: await readFile(path.join(root, rel)),
  })));
  files.push({ path: `${VM.code}/package.json`, content: Buffer.from(JSON.stringify(VM_PACKAGE_JSON)) });
  files.push({ path: VM.script, content: Buffer.from(buildRunScript()), mode: 0o755 });
  return files;
}

export async function loadCapturePayload({ store, descriptor }) {
  if (descriptor?.entryPath !== 'index.html') {
    throw Object.assign(new Error('entry_path_unsupported'), { code: 'capture_failed', detail: `entryPath=${descriptor?.entryPath}` });
  }
  const assets = descriptor.assetIndex;
  const files = new Array(assets.length * 2);
  let next = 0;
  async function worker() {
    while (next < assets.length) {
      const i = next; next += 1;
      const asset = assets[i];
      const body = await store.read(indexedAssetKey(descriptor.storageKey, asset.path));
      files[2 * i] = { path: `${VM.capture}/${asset.path}`, content: body };
      files[2 * i + 1] = {
        path: `${VM.capture}/${asset.path}.uncraft-meta.json`,
        content: Buffer.from(JSON.stringify({ contentType: asset.contentType })),
      };
    }
  }
  await Promise.all(Array.from({ length: Math.min(CAPTURE_READ_CONCURRENCY, assets.length) }, worker));
  return files;
}

export async function loadNativeDescriptor({ sql, bundleId }) {
  const rows = await sql`
    SELECT bundle_id, schema_version, storage_key, content_hash, entry_path, asset_index,
           runtime_fingerprint, reconstruction_capabilities
      FROM native_bundles WHERE bundle_id = ${bundleId}`;
  if (!rows[0]) throw Object.assign(new Error('native_bundle_missing'), { code: 'capture_failed', detail: `bundle ${bundleId}` });
  return descriptorFromRow(rows[0]);
}

// A escrita na máquina vai em lotes (a captura passa de 30 MB): nenhum lote passa do teto, salvo um arquivo
// que já é maior que ele sozinho.
export function chunkBySize(files, maxBytes = 16 * 1024 * 1024) {
  const lotes = [];
  let atual = [];
  let soma = 0;
  for (const file of files) {
    const n = file.content?.byteLength ?? file.content?.length ?? 0;
    if (atual.length && soma + n > maxBytes) { lotes.push(atual); atual = []; soma = 0; }
    atual.push(file); soma += n;
  }
  if (atual.length) lotes.push(atual);
  return lotes;
}
