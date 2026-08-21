import { db } from '../../../../../lib/db.js';
import { requireUser } from '../../../../../lib/auth.js';
import { NextResponse } from 'next/server';
import { createConfiguredBundleStore } from '../../../../../lib/native-clone/bundle-store.js';
import { PREVIEW_VIDEO_PATH } from '../../../../../lib/preview-video.js';

/**
 * Preview ANIMADO do node — o vídeo que o produtor native grava na passada de
 * scroll (2026-08-21).
 *
 * ⚠️ POR QUE ESTA ROTA EXISTE. A primeira fiação apontava para
 * `/api/native-clone/<bundleId>/...`, que é a rota do LABORATÓRIO local: ela
 * devolve 503 sem `UNCRAFT_NATIVE_CLONE_ROOT` (ou seja, sempre em produção) e
 * resolve contra um único diretório local, ignorando o bundleId. O preview
 * nasceria morto — e ainda assim ocupando espaço no bundle store. Achado da
 * revisão adversarial, verificado lendo a rota.
 *
 * A autorização é a do THUMBNAIL, que é o precedente certo: o vídeo é mídia
 * DAQUELE node, então quem pode ver o node pode ver o vídeo — join de
 * `boards.user_id`, nunca confiança no id que veio na URL.
 */
export const runtime = 'nodejs';

export async function GET(request, { params }) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const sql = await db();
  const { id } = await params;

  // Dono do node E bundle do snapshot ATUAL, numa consulta: um id de node de
  // outro usuário não encontra linha, e um snapshot sem bundle também não.
  const [row] = await sql`
    SELECT nb.storage_key AS storage_key, nb.asset_index AS asset_index
      FROM nodes n
      JOIN boards b ON b.id = n.board_id
      JOIN snapshots s ON s.id = n.current_snapshot_id
      JOIN native_bundles nb ON nb.bundle_id = s.native_bundle_id
     WHERE n.id = ${id} AND b.user_id = ${user.id}
  `;
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // O índice declara o que o bundle tem. Pedir um arquivo que ele não declara
  // é 404 aqui, e não uma leitura especulativa no armazenamento.
  // A coluna é jsonb; conforme o driver chega como array já parseado ou como
  // texto. Aceitar só um dos dois deixaria a rota 404 em metade dos ambientes.
  let index = row.asset_index;
  if (typeof index === 'string') { try { index = JSON.parse(index); } catch { index = []; } }
  if (!Array.isArray(index)) index = [];
  const declared = index.find((asset) => asset?.path === PREVIEW_VIDEO_PATH);
  if (!declared) return NextResponse.json({ error: 'no_preview' }, { status: 404 });

  const store = createConfiguredBundleStore();
  const bytes = await store.read(`${row.storage_key}/assets/${PREVIEW_VIDEO_PATH}`).catch(() => null);
  if (!bytes) return NextResponse.json({ error: 'no_preview' }, { status: 404 });

  return new Response(bytes, {
    headers: {
      'content-type': 'video/webm',
      'content-length': String(bytes.byteLength),
      // Imutável por construção (bundle é imutável), e PRIVADO: é conteúdo de
      // um node de um usuário, não pode ficar em cache compartilhado.
      'cache-control': 'private, max-age=31536000, immutable',
    },
  });
}
