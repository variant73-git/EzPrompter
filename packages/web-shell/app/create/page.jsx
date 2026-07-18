import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getAuthUser } from '../../lib/auth.js';
import CreateStudio from '../../components/CreateStudio.jsx';
import './create.css';

export const dynamic = 'force-dynamic';

export default async function CreatePage({ searchParams }) {
  const h = await headers();
  const fakeReq = { headers: { get: (key) => h.get(key) } };
  const user = await getAuthUser(fakeReq);
  if (!user) redirect('/');
  const params = await searchParams;
  return <CreateStudio initialMode={params?.mode || 'builder'} user={user} />;
}
