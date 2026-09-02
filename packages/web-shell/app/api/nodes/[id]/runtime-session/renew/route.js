import { NextResponse } from 'next/server';
import { requireUser } from '../../../../../../lib/auth.js';
import { db } from '../../../../../../lib/db.js';
import { LEASE_TTL_SECONDS, renewLease } from '../../../../../../lib/motion-editor/runtime-lease.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const noStore = { 'Cache-Control': 'no-store' };

// Renovação sliding (plano lease B, Task 8): estende expires_at da SESSÃO e da
// LEASE sem trocar URL nem recarregar o iframe — é isto que mata a imagem
// quebrada às 4h. NÃO emite cookie novo (só GET/HEAD). O UPDATE da sessão
// carrega o gate de ownership (join a boards.user_id); a lease renova pelo
// sessionId já validado.
export async function POST(request, { params }) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const { id } = await params;

  let sql;
  try { sql = await db(); } catch { return NextResponse.json({ error: 'unavailable' }, { status: 503, headers: noStore }); }

  let session;
  try {
    // Cercado: só sessão ATIVA e não vencida do DONO do node estende. Uma
    // sessão fechada/expirada não ressuscita (mesma disciplina do settle).
    [session] = await sql`
      UPDATE native_motion_edit_sessions e
         SET expires_at = NOW() + make_interval(secs => ${LEASE_TTL_SECONDS}),
             updated_at = NOW()
        FROM nodes n, boards b
       WHERE e.node_id = ${id}
         AND n.id = e.node_id
         AND b.id = n.board_id
         AND b.user_id = ${user.id}
         AND e.status = 'active'
         AND e.expires_at > NOW()
      RETURNING e.id, e.expires_at
    `;
  } catch {
    return NextResponse.json({ error: 'unavailable' }, { status: 503, headers: noStore });
  }
  if (!session) {
    // Terminal e autenticado: o cliente mascara (não é rede/5xx).
    return NextResponse.json({ error: 'not_renewable' }, { status: 409, headers: noStore });
  }

  // A lease pode ainda não existir (bootstrap não completou) — a sessão já
  // está estendida e serve; renewLease é idempotente e informa se tocou linha.
  let lease = { renewed: false };
  try { lease = await renewLease({ sql, sessionId: session.id }); } catch { /* sessão estendida basta */ }

  return NextResponse.json(
    { renewed: true, expiresAt: session.expires_at, leaseRenewed: lease.renewed === true },
    { headers: noStore },
  );
}
