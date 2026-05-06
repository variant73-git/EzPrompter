import { redirect, notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { db } from '../../../lib/db.js';
import { getAuthUser } from '../../../lib/auth.js';
import CanvasClient from '../../../components/CanvasClient.jsx';

export const dynamic = 'force-dynamic';

export default async function CanvasBoardPage({ params }) {
  const { boardId } = await params;
  const h = await headers();
  const fakeReq = { headers: { get: (k) => h.get(k) } };
  const user = await getAuthUser(fakeReq);
  if (!user) redirect('/');

  const sql = await db();
  const [board] = await sql`SELECT * FROM boards WHERE id = ${boardId} AND user_id = ${user.id}`;
  if (!board) notFound();

  const nodes = await sql`
    SELECT n.*, s.html AS current_html, s.design_md AS current_design_md, s.screenshot_url AS current_screenshot
      FROM nodes n
      LEFT JOIN snapshots s ON s.id = n.current_snapshot_id
     WHERE n.board_id = ${boardId}
     ORDER BY n.created_at ASC
  `;
  const edges = await sql`SELECT * FROM edges WHERE board_id = ${boardId} ORDER BY created_at ASC`;

  return (
    <CanvasClient
      board={board}
      initialNodes={nodes}
      initialEdges={edges}
      user={{ id: user.id, email: user.email, name: user.name || null, plan: user.plan || 'free' }}
    />
  );
}
