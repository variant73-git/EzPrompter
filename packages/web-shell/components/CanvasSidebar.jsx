'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/canvas-api.js';
import UserPill from './UserPill.jsx';

// Persistent boards sidebar inside the canvas view — "Working Table" chrome
// (unspirit import, 2026-07-12). 224px, collapsible to 52px (state in
// localStorage). Boards list is live (switching boards is a navigation);
// LIBRARY entries (Assets / Skills) are placeholders until the library
// feature lands — disabled, never fake-interactive.
//
// The sidebar OVERLAYS the full-viewport canvas world rather than insetting
// it: every world↔client coordinate conversion in CanvasClient assumes the
// transform wrapper starts at viewport (0,0), and an inset would silently
// offset all of them. Overlay keeps the math untouched.

const COLLAPSE_KEY = 'uncraft-sidebar-collapsed';

const Icon = {
  Collapse: () => (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/><path d="m14 9-2.5 3L14 15"/>
    </svg>
  ),
  Plus: () => (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5v14"/><path d="M5 12h14"/>
    </svg>
  ),
  Board: () => (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/>
      <rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>
    </svg>
  ),
  Assets: () => (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.5-3.5L7 22"/>
    </svg>
  ),
  Skills: () => (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z"/>
    </svg>
  )
};

export default function CanvasSidebar({ activeBoardId, boardName, user, onSignOut }) {
  const [boards, setBoards] = useState([]);
  const [collapsed, setCollapsed] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    try { setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1'); } catch { /* SSR/priv */ }
  }, []);

  // Topbar + zoom dock anchor off this var so they follow the collapse
  // without the sidebar having to know about them.
  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-w', collapsed ? '52px' : '224px');
    return () => { document.documentElement.style.removeProperty('--sidebar-w'); };
  }, [collapsed]);

  useEffect(() => {
    let dead = false;
    api.listBoards()
      .then((r) => { if (!dead) setBoards(r.boards || r || []); })
      .catch(() => {});
    return () => { dead = true; };
  }, [activeBoardId]);

  function toggleCollapsed() {
    setCollapsed((v) => {
      try { localStorage.setItem(COLLAPSE_KEY, v ? '0' : '1'); } catch { /* ignore */ }
      return !v;
    });
  }

  async function createBoard() {
    if (creating) return;
    setCreating(true);
    try {
      const { board } = await api.createBoard('Untitled');
      window.location.href = `/canvas/${board.id}`;
    } catch {
      setCreating(false);
    }
  }

  return (
    <aside className={`canvas-sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="canvas-sidebar-brand">
        <a href="/canvas" className="canvas-sidebar-mark" title="Projects">U</a>
        {!collapsed && <b className="canvas-sidebar-title">Uncraft</b>}
        <button
          type="button"
          className="canvas-sidebar-collapse"
          onClick={toggleCollapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <Icon.Collapse />
        </button>
      </div>

      {!collapsed && (
        <>
          <button type="button" className="canvas-sidebar-new" onClick={createBoard} disabled={creating}>
            <Icon.Plus /> {creating ? 'Creating…' : 'New board'}
          </button>

          <small className="canvas-sidebar-heading">Boards</small>
          <div className="canvas-sidebar-boards">
            {boards.map((b) => (
              <a
                key={b.id}
                href={`/canvas/${b.id}`}
                className={`canvas-sidebar-item${b.id === activeBoardId ? ' active' : ''}`}
              >
                <Icon.Board />
                <span className="canvas-sidebar-item-label">
                  {b.id === activeBoardId ? (boardName || b.name || 'Untitled') : (b.name || 'Untitled')}
                </span>
              </a>
            ))}
          </div>

          <div className="canvas-sidebar-library">
            <small className="canvas-sidebar-heading">Library</small>
            {/* Placeholders — library ships later; disabled, honest state. */}
            <button type="button" className="canvas-sidebar-item" disabled title="Assets library — coming soon">
              <Icon.Assets /><span className="canvas-sidebar-item-label">Assets</span>
            </button>
            <button type="button" className="canvas-sidebar-item" disabled title="Skills — coming soon">
              <Icon.Skills /><span className="canvas-sidebar-item-label">Skills</span>
            </button>
          </div>

          <div className="canvas-sidebar-user">
            <UserPill name={user?.name} email={user?.email} plan={user?.plan} onSignOut={onSignOut} />
          </div>
        </>
      )}
    </aside>
  );
}
