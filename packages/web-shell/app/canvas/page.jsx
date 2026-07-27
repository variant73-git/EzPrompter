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
  const savedWorkflows = await sql`
    SELECT id, source_board_id, name, description, definition, created_at, updated_at
      FROM workflow_templates
     WHERE user_id = ${user.id}
     ORDER BY updated_at DESC
     LIMIT 24
  `;
  const assets = await sql`
    SELECT id, type, name, source_url, blob_url, thumb_url, created_at
      FROM assets
     WHERE user_id = ${user.id}
     ORDER BY created_at DESC
     LIMIT 24
  `;
  return (
    <BoardsList
      boards={boards}
      savedWorkflows={savedWorkflows}
      assets={assets}
      userName={user.name}
      userEmail={user.email}
      userPlan={user.plan}
      userRole={user.role || 'member'}
      view="home"
    />
  );
}
