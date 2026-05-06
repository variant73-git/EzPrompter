'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { api } from '../lib/canvas-api.js';
import UserPill from './UserPill.jsx';

const PlusIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 5v14"/><path d="M5 12h14"/>
  </svg>
);

const ProjectsIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="16" rx="2"/>
    <path d="M3 9h18"/>
    <path d="M9 4v16"/>
  </svg>
);

function formatRelative(iso) {
  const d = new Date(iso);
  const now = Date.now();
  const diff = Math.max(0, now - d.getTime());
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function BoardsList({ boards: initial, userName, userEmail }) {
  const [boards, setBoards] = useState(initial);
  const [creating, setCreating] = useState(false);
  const router = useRouter();

  async function createBoard() {
    setCreating(true);
    try {
      const { board } = await api.createBoard('Untitled');
      router.push(`/canvas/${board.id}`);
    } catch (e) {
      alert(`Could not create board: ${e.message}`);
      setCreating(false);
    }
  }

  async function logout() {
    await api.logout().catch(() => {});
    localStorage.removeItem('token');
    window.location.href = '/';
  }

  return (
    <div className="boards-shell">
      <aside className="boards-sidebar">
        <div className="boards-sidebar-top">
          <span className="uncraft-mark">
            <span className="un">Un</span><span className="craft">craft</span>
          </span>
        </div>

        <nav className="boards-sidebar-nav">
          <button type="button" className="boards-nav-item active">
            <ProjectsIcon />
            <span>Projects</span>
          </button>
        </nav>

        <div className="boards-sidebar-bottom">
          <UserPill name={userName} email={userEmail} onSignOut={logout} />
        </div>
      </aside>

      <main className="boards-main">
        <header className="boards-main-header">
          <div>
            <h1 className="boards-title">Projects</h1>
            <p className="boards-subtitle">
              {boards.length === 0
                ? 'No boards yet. Start a fresh canvas.'
                : `${boards.length} ${boards.length === 1 ? 'board' : 'boards'}`}
            </p>
          </div>
        </header>

        <motion.div
          className="boards-grid"
          initial="hidden"
          animate="show"
          variants={{
            hidden: {},
            show: { transition: { staggerChildren: 0.05, delayChildren: 0.05 } }
          }}
        >
          <motion.button
            type="button"
            className="board-card board-card-new"
            onClick={createBoard}
            disabled={creating}
            variants={{
              hidden: { opacity: 0, y: 12 },
              show: { opacity: 1, y: 0 }
            }}
            transition={{ type: 'spring', stiffness: 240, damping: 24 }}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.98 }}
            aria-label="New board"
          >
            <span className="board-card-new-icon"><PlusIcon /></span>
            <span className="board-card-new-label">
              {creating ? 'Creating…' : 'New board'}
            </span>
            <span className="board-card-new-hint">Blank canvas</span>
          </motion.button>

          {boards.map((b) => (
            <motion.a
              key={b.id}
              href={`/canvas/${b.id}`}
              className="board-card"
              variants={{
                hidden: { opacity: 0, y: 12 },
                show: { opacity: 1, y: 0 }
              }}
              transition={{ type: 'spring', stiffness: 240, damping: 24 }}
              whileHover={{ y: -2 }}
            >
              <div className="board-card-preview" aria-hidden="true">
                <span className="board-card-preview-mark">
                  {(b.name || 'U').trim().charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="board-card-meta">
                <h3 className="board-card-title">{b.name || 'Untitled'}</h3>
                <p className="board-card-sub">Updated {formatRelative(b.updated_at)}</p>
              </div>
            </motion.a>
          ))}
        </motion.div>
      </main>
    </div>
  );
}
