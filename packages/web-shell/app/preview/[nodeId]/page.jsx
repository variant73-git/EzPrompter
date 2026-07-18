import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { db } from '../../../lib/db.js';
import { getAuthUser } from '../../../lib/auth.js';

export const dynamic = 'force-dynamic';

export default async function NodeBrowserPreview({ params }) {
  const { nodeId } = await params;
  const h = await headers();
  const fakeReq = { headers: { get: (key) => h.get(key) } };
  const user = await getAuthUser(fakeReq);
  if (!user) redirect('/');

  const sql = await db();
  const [node] = await sql`
    SELECT n.kind, n.origin_url, n.meta, s.html
      FROM nodes n
      JOIN boards b ON b.id = n.board_id
      LEFT JOIN snapshots s ON s.id = n.current_snapshot_id
     WHERE n.id = ${nodeId} AND b.user_id = ${user.id}
  `;

  if (!node || node.kind !== 'site') notFound();
  if (!node.html && node.origin_url) redirect(node.origin_url);
  if (!node.html) notFound();

  const title = node.meta?.name || 'Website preview';

  return (
    <main style={{ position: 'fixed', inset: 0, background: '#191917' }}>
      <iframe
        title={title}
        srcDoc={node.html}
        sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads"
        referrerPolicy="no-referrer"
        style={{ display: 'block', width: '100%', height: '100%', border: 0, background: '#F7F7F4' }}
      />
    </main>
  );
}
