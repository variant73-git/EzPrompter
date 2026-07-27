import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { getAuthUser } from '../../../lib/auth.js';
import { isAdmin } from '../../../lib/admin-auth.js';
import MotionDiagnostics from '../../../components/admin/MotionDiagnostics.jsx';
import styles from '../../../components/admin/motion-diagnostics.module.css';

export const dynamic = 'force-dynamic';

export default async function MotionDiagnosticsPage() {
  const incoming = await headers();
  const request = { headers: { get: (key) => incoming.get(key) } };
  const user = await getAuthUser(request);
  if (!user) redirect('/');
  if (!isAdmin(user)) notFound();

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <a className={styles.brand} href="/canvas" aria-label="Back to Uncraft projects">
          <span>U</span>
          <b>Uncraft</b>
        </a>
        <nav aria-label="Breadcrumb">
          <a href="/canvas">Projects</a>
          <span aria-hidden="true">/</span>
          <span>Admin</span>
          <span aria-hidden="true">/</span>
          <strong>Motion diagnostics</strong>
        </nav>
        <span className={styles.privateLabel}>Private</span>
      </header>
      <section className={styles.intro}>
        <div>
          <p className={styles.eyebrow}>Admin</p>
          <h1>Motion diagnostics</h1>
          <p>Sanitized runtime evidence for native animated clones.</p>
        </div>
        <p className={styles.retentionNote}>
          Linked events expire after 30 days. Anonymous aggregates remain for 12 months.
        </p>
      </section>
      <MotionDiagnostics />
    </main>
  );
}
