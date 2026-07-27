'use client';

import { useEffect, useState } from 'react';
import { ArrowUpRight, Image, PanelLeftClose, Plus, Workflow, X } from 'lucide-react';
import UserPill from './UserPill.jsx';

// Static project-library rail. Project switching lives behind the Uncraft
// logo (/canvas); this surface is reserved for reusable inputs that can be
// inserted into the current canvas. It stays structurally stable while the
// right inspector changes with selection.
//
// The sidebar OVERLAYS the full-viewport canvas world rather than insetting
// it: every world↔client coordinate conversion in CanvasClient assumes the
// transform wrapper starts at viewport (0,0), and an inset would silently
// offset all of them. Overlay keeps the math untouched.

const COLLAPSE_KEY = 'uncraft-sidebar-collapsed';

export default function CanvasSidebar({ user, onSignOut, onNewNode, newNodeOpen = false, showFirstNodeCoachmark = false }) {
  const [collapsed, setCollapsed] = useState(false);
  const [activeLibrary, setActiveLibrary] = useState(null);

  useEffect(() => {
    try { setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1'); } catch { /* SSR/priv */ }
  }, []);

  // Topbar + zoom dock anchor off this var so they follow the collapse
  // without the sidebar having to know about them.
  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-w', collapsed ? '52px' : '224px');
    return () => { document.documentElement.style.removeProperty('--sidebar-w'); };
  }, [collapsed]);

  function toggleCollapsed() {
    setCollapsed((v) => {
      try { localStorage.setItem(COLLAPSE_KEY, v ? '0' : '1'); } catch { /* ignore */ }
      if (!v) setActiveLibrary(null);
      return !v;
    });
  }

  function toggleLibrary(next) {
    if (collapsed) setCollapsed(false);
    setActiveLibrary((current) => current === next ? null : next);
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
          <PanelLeftClose aria-hidden="true" />
        </button>
      </div>

      <div className="canvas-sidebar-new-wrap">
        <button
          type="button"
          className="canvas-sidebar-new"
          onClick={onNewNode}
          aria-label="New node"
          aria-haspopup="menu"
          aria-expanded={newNodeOpen}
          title="New node"
        >
          <Plus aria-hidden="true" />
          {!collapsed && <span>New node</span>}
        </button>
        {showFirstNodeCoachmark && (
          <div className="canvas-first-node-coachmark" role="status">
            <span>Start adding the first node</span>
            <i aria-hidden="true" />
          </div>
        )}
      </div>

      <nav className="canvas-sidebar-library" aria-label="Project library">
        {!collapsed && <small className="canvas-sidebar-heading">Library</small>}
        <button
          type="button"
          className={`canvas-sidebar-item${activeLibrary === 'assets' ? ' active' : ''}`}
          onClick={() => toggleLibrary('assets')}
          aria-pressed={activeLibrary === 'assets'}
          title="Collected assets"
        >
          <Image aria-hidden="true" />
          {!collapsed && <span className="canvas-sidebar-item-label">Assets</span>}
        </button>
        <button
          type="button"
          className={`canvas-sidebar-item${activeLibrary === 'workflows' ? ' active' : ''}`}
          onClick={() => toggleLibrary('workflows')}
          aria-pressed={activeLibrary === 'workflows'}
          title="Workflow templates"
        >
          <Workflow aria-hidden="true" />
          {!collapsed && <span className="canvas-sidebar-item-label">Workflows</span>}
        </button>
      </nav>

      {!collapsed && (
        <>
          <div className="canvas-sidebar-user">
            <UserPill name={user?.name} email={user?.email} plan={user?.plan} role={user?.role} onSignOut={onSignOut} workspaceMode />
          </div>
        </>
      )}

      {activeLibrary && !collapsed && (
        <section className="canvas-library-drawer" aria-label={activeLibrary === 'assets' ? 'Assets library' : 'Workflow templates'}>
          <header>
            <div>
              <small>Library</small>
              <h2>{activeLibrary === 'assets' ? 'Assets' : 'Workflows'}</h2>
            </div>
            <button type="button" onClick={() => setActiveLibrary(null)} aria-label="Close library"><X aria-hidden="true" /></button>
          </header>

          {activeLibrary === 'assets' ? (
            <div className="canvas-library-content">
              <div className="canvas-library-empty">
                <span><Image aria-hidden="true" /></span>
                <h3>Your collected pieces</h3>
                <p>Images, videos, prompts, code and shaders saved from the web will stay reusable here.</p>
                <button type="button" onClick={onNewNode}><Plus aria-hidden="true" /> Add an asset node</button>
              </div>
            </div>
          ) : (
            <div className="canvas-library-content">
              <p className="canvas-library-intro">Start from a proven graph, then adapt every part in this canvas.</p>
              <a className="canvas-workflow-card" href="/create?mode=builder">
                <i style={{ background: '#2966EA' }} />
                <span><b>Website Builder</b><small>Brief → editable website</small></span>
                <ArrowUpRight aria-hidden="true" />
              </a>
              <a className="canvas-workflow-card" href="/create?mode=clone">
                <i style={{ background: '#F97316' }} />
                <span><b>Clone / Recreate</b><small>URL or screenshot → recreation</small></span>
                <ArrowUpRight aria-hidden="true" />
              </a>
              <a className="canvas-workflow-card" href="/create?mode=style">
                <i style={{ background: '#EEA665' }} />
                <span><b>Style Transplant</b><small>Target + reference → restyled site</small></span>
                <ArrowUpRight aria-hidden="true" />
              </a>
              <button type="button" className="canvas-library-new-node" onClick={onNewNode}><Plus aria-hidden="true" /> Build a workflow from nodes</button>
            </div>
          )}
        </section>
      )}
    </aside>
  );
}
