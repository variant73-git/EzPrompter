import { createHash } from 'node:crypto';
import { uploadStorageKey } from '../motion-editor/runtime-gateway-core.js';

// Pipeline de upload de imagem NOVA por nó, extraído do gateway (Task 12).
// Guardado POR NÓ (sobrevive à rotação de sessão e ao re-clone), nome por HASH
// do conteúdo, e SÓ raster farejado pelos bytes mágicos — o content-type do
// cliente é desejo, não fato; SVG fica de fora (carrega script). A quota
// agregada por nó é reservada ATOMICAMENTE por UPDATE condicional ANTES do
// putImmutable (Sol r4 #3: contar-depois-gravar é TOCTOU).

export const UPLOAD_MAX_BYTES = 8 * 1024 * 1024;
export const NODE_UPLOAD_QUOTA_BYTES = 64 * 1024 * 1024;

const UPLOAD_TIPOS = [
  { ext: 'png', mime: 'image/png', magica: (b) => b.length > 7 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { ext: 'jpg', mime: 'image/jpeg', magica: (b) => b.length > 2 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'gif', mime: 'image/gif', magica: (b) => b.length > 5 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 },
  { ext: 'webp', mime: 'image/webp', magica: (b) => b.length > 11 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 },
  { ext: 'avif', mime: 'image/avif', magica: (b) => b.length > 11 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 && b[8] === 0x61 && b[9] === 0x76 && b[10] === 0x69 && b[11] === 0x66 },
];

export function sniffImageType(bytes) {
  return UPLOAD_TIPOS.find((t) => t.magica(bytes)) || null;
}

/**
 * @returns {{ path:string } | { error:'unsupported_image'|'too_large'|'quota_exceeded'|'store_failed' }}
 */
export async function storeNodeUpload({ store, sql, nodeId, bytes }) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Upload bytes must be a Uint8Array');
  if (bytes.length > UPLOAD_MAX_BYTES) return { error: 'too_large' };
  const tipo = sniffImageType(bytes);
  if (!tipo) return { error: 'unsupported_image' };

  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 32);
  const nome = `${hash}.${tipo.ext}`;
  const storageKey = uploadStorageKey(nodeId, nome);

  // Re-upload IDÊNTICO (nome = hash do conteúdo): já está lá, não conta quota
  // nem regrava. O nome é o hash, então "existe sob este nome" = "mesmo byte".
  const existing = await store.head(storageKey);
  if (existing) return { path: `./_uploads/${nome}` };

  // Reserva ATÔMICA antes de gravar: upsert da linha e UPDATE condicional gated
  // em bytes_used + n <= teto. rowCount 0 = estouraria a quota → recusa.
  await sql`
    INSERT INTO native_node_upload_quota (node_id, bytes_used)
    VALUES (${nodeId}, 0) ON CONFLICT (node_id) DO NOTHING
  `;
  const [reserved] = await sql`
    UPDATE native_node_upload_quota
       SET bytes_used = bytes_used + ${bytes.length}
     WHERE node_id = ${nodeId}
       AND bytes_used + ${bytes.length} <= ${NODE_UPLOAD_QUOTA_BYTES}
    RETURNING bytes_used
  `;
  if (!reserved) return { error: 'quota_exceeded' };

  try {
    await store.putImmutable({
      storageKey,
      body: bytes,
      contentType: tipo.mime,
      contentHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    });
  } catch {
    // Devolve a reserva — o put falhou, os bytes não entraram (mesma disciplina
    // de settle do 161/162). GREATEST guarda contra corrida abaixo de zero.
    await sql`
      UPDATE native_node_upload_quota
         SET bytes_used = GREATEST(0, bytes_used - ${bytes.length})
       WHERE node_id = ${nodeId}
    `;
    return { error: 'store_failed' };
  }
  return { path: `./_uploads/${nome}` };
}
