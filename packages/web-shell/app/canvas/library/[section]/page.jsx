import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { db } from '../../../../lib/db.js';
import { getAuthUser } from '../../../../lib/auth.js';
import { getLatestApprovedReferencePlan, queryPersistentReferenceCatalog } from '../../../../lib/reference-bank-store.js';
import { canCuratePrivateReferences } from '../../../../lib/reference-privacy.js';
import BoardsList from '../../../../components/BoardsList.jsx';

export const dynamic = 'force-dynamic';

const SECTIONS = new Set(['projects', 'references', 'workflows', 'assets', 'community']);

export default async function WorkspaceLibraryPage({ params }) {
  const { section } = await params;
  if (!SECTIONS.has(section)) notFound();

  const h = await headers();
  const fakeReq = { headers: { get: (key) => h.get(key) } };
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
     LIMIT 100
  `;
  const assets = await sql`
    SELECT id, type, name, source_url, blob_url, thumb_url, created_at
      FROM assets
     WHERE user_id = ${user.id}
     ORDER BY created_at DESC
     LIMIT 100
  `;
  const referencePage = section === 'references'
    ? {
        ...await queryPersistentReferenceCatalog({ userId: user.id, limit: 48 }),
        canManagePrivateReferences: canCuratePrivateReferences(user),
      }
    : null;
  const latestReferencePlan = section === 'references'
    ? await getLatestApprovedReferencePlan(user.id)
    : null;

  return (
    <BoardsList
      boards={boards}
      savedWorkflows={savedWorkflows}
      assets={assets}
      referencePage={referencePage}
      latestReferencePlan={latestReferencePlan}
      userName={user.name}
      userEmail={user.email}
      userPlan={user.plan}
      view={section}
    />
  );
}
