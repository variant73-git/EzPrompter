import { NextResponse } from 'next/server';
import { requireUser } from '../../../../../lib/auth.js';
import { db } from '../../../../../lib/db.js';
import { createConfiguredBundleStore } from '../../../../../lib/native-clone/bundle-store.js';
import { UPLOAD_MAX_BYTES, storeNodeUpload } from '../../../../../lib/native-clone/native-uploads.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const noStore = { 'Cache-Control': 'no-store' };
const json = (body, status) => NextResponse.json(body, { status, headers: noStore });

// Upload app-authed (Task 12): em modo lease o clone não tem cookie de login e
// a lease só autoriza GET/HEAD, então o upload atravessa o PARENT (que tem o
// cookie) por esta rota. Gate: dono do node + sessão de edição ATIVA no node —
// a mesma condição do caminho legado. O serviço do `_uploads/` (GET) segue no
// gateway; só o POST migra para cá.
export async function POST(request, { params }) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const { id } = await params;

  let sql;
  try { sql = await db(); } catch { return json({ error: 'unavailable' }, 503); }

  let owned;
  try {
    [owned] = await sql`
      SELECT e.id
        FROM native_motion_edit_sessions e
        JOIN nodes n ON n.id = e.node_id
        JOIN boards b ON b.id = n.board_id
       WHERE e.node_id = ${id}
         AND b.user_id = ${user.id}
         AND e.status = 'active'
         AND e.expires_at > NOW()
    `;
  } catch { return json({ error: 'unavailable' }, 503); }
  if (!owned) return json({ error: 'not_available' }, 404);

  // Teto ANTES de materializar quando o cabeçalho existe; e sempre depois.
  if (Number(request.headers.get('content-length') || 0) > UPLOAD_MAX_BYTES) {
    return json({ error: 'too_large' }, 413);
  }
  let bytes;
  try { bytes = new Uint8Array(await request.arrayBuffer()); } catch { return json({ error: 'invalid' }, 400); }
  if (!bytes.length) return json({ error: 'invalid' }, 400);

  const result = await storeNodeUpload({ store: createConfiguredBundleStore(), sql, nodeId: id, bytes });
  if (result.error === 'too_large') return json({ error: 'too_large' }, 413);
  if (result.error === 'unsupported_image') return json({ error: 'unsupported_image' }, 415);
  if (result.error === 'quota_exceeded') return json({ error: 'quota_exceeded' }, 409);
  if (result.error) return json({ error: 'store_failed' }, 503);
  return json({ path: result.path }, 200);
}
