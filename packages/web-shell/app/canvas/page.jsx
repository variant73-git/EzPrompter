import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { db } from '../../lib/db.js';
import { getAuthUser } from '../../lib/auth.js';
import BoardsList from '../../components/BoardsList.jsx';

export const dynamic = 'force-dynamic';

export default async function CanvasIndex() {
  const h = await headers();
  const fakeReq = { headers: { get: (k) => h.get(k) } };
  const user = await getAuthUser(fakeReq);
  if (!user) redirect('/');

  const sql = await db();
  const boards = await sql`
    SELECT id, name, updated_at, created_at
      FROM boards
     WHERE user_id = ${user.id}
     ORDER BY updated_at DESC
  `;
  return <BoardsList boards={boards} userName={user.name || user.email} />;
}
