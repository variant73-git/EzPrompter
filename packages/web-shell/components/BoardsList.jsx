'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Boxes,
  ChevronRight,
  CirclePlus,
  FolderKanban,
  Image as ImageIcon,
  Plus,
  Users,
  Workflow,
} from 'lucide-react';
import { api } from '../lib/canvas-api.js';
import {
  BUILTIN_WORKFLOWS,
  NODE_KIND_META,
  layoutWorkflowNodes,
  savedWorkflowToTemplate,
} from '../lib/workflow-templates.js';
import { COMMUNITY_EXAMPLES, REFERENCE_SITES } from '../lib/workspace-library.js';
import CreditsPill from './CreditsPill.jsx';
import UserPill from './UserPill.jsx';

const NAV_ITEMS = [
  { id: 'projects', label: 'Projects', Icon: FolderKanban },
  { id: 'references', label: 'References', Icon: Bookmark },
  { id: 'workflows', label: 'Workflows', Icon: Workflow },
  { id: 'assets', label: 'Assets', Icon: ImageIcon },
  { id: 'community', label: 'Community', Icon: Users },
];

const LIBRARY_META = {
  projects: { title: 'Projects', copy: 'Every canvas, from the latest experiment to the work you keep returning to.' },
  references: { title: 'References', copy: 'Curated sites worth collecting, taking apart, and transforming into something of your own.' },
  workflows: { title: 'Workflows', copy: 'Reusable node chains that expose the path to a result without making you invent the graph first.' },
  assets: { title: 'Assets', copy: 'Images, components, code, type, and fragments collected from across the web.' },
  community: { title: 'Community', copy: 'See what others built when the web became their raw material.' },
};

function formatRelative(iso) {
  const d = new Date(iso);
  const diff = Math.max(0, Date.now() - d.getTime());
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function shortName(name, max = 28) {
  const value = String(name || 'Untitled').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function WorkspaceSidebar({ activeSection, userName, userEmail, userPlan, onSignOut }) {
  return (
    <aside className="hub-sidebar">
      <a href="/canvas" className="hub-brand" aria-label="Uncraft home">
        <span>U</span><b>Uncraft</b>
      </a>
      <nav className="hub-nav" aria-label="Workspace library">
        {NAV_ITEMS.map(({ id, label, Icon }) => (
          <a
            key={id}
            href={`/canvas/library/${id}`}
            className={`hub-nav-item${activeSection === id ? ' active' : ''}`}
            aria-current={activeSection === id ? 'page' : undefined}
          >
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </a>
        ))}
      </nav>
      <div className="hub-sidebar-bottom">
        <UserPill name={userName} email={userEmail} plan={userPlan} onSignOut={onSignOut} />
      </div>
    </aside>
  );
}

function WorkflowMap({ workflow }) {
  const columns = useMemo(() => {
    const grouped = new Map();
    for (const item of workflow.nodes || []) {
      const col = Number(item.col ?? 0);
      if (!grouped.has(col)) grouped.set(col, []);
      grouped.get(col).push(item);
    }
    if (grouped.size === 1 && (workflow.nodes || []).some((item) => item.posX != null)) {
      const sorted = [...workflow.nodes].sort((a, b) => (a.posX || 0) - (b.posX || 0));
      return sorted.map((item) => [item]);
    }
    return [...grouped.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, items]) => items.sort((a, b) => Number(a.row ?? 0) - Number(b.row ?? 0)));
  }, [workflow.nodes]);

  return (
    <div className="hub-workflow-map" aria-hidden="true">
      {columns.map((items, columnIndex) => (
        <div className="hub-workflow-column" key={`${workflow.id}-${columnIndex}`}>
          {items.slice(0, 3).map((item) => {
            const meta = NODE_KIND_META[item.kind] || NODE_KIND_META.site;
            return (
              <span key={item.key} style={{ '--node-color': meta.color }} title={item.label}>
                <i />{meta.label}
              </span>
            );
          })}
          {columnIndex < columns.length - 1 && <ChevronRight className="hub-workflow-arrow" />}
        </div>
      ))}
    </div>
  );
}

function WorkflowCard({ workflow, onLaunch, busy, compact = false }) {
  return (
    <button
      type="button"
      className={`hub-workflow-card${compact ? ' compact' : ''}${workflow.saved ? ' saved' : ''}`}
      style={{ '--workflow-accent': workflow.accent, gridColumn: compact ? undefined : `span ${workflow.featuredSpan || 2}` }}
      onClick={() => onLaunch(workflow)}
      disabled={Boolean(busy)}
      aria-busy={busy === workflow.id}
    >
      <div className="hub-workflow-card-top">
        <small>{workflow.eyebrow}</small>
        {workflow.saved && <span><Bookmark aria-hidden="true" />Saved</span>}
      </div>
      <WorkflowMap workflow={workflow} />
      <div className="hub-workflow-card-copy">
        <h3>{workflow.name}</h3>
        <p>{busy === workflow.id ? 'Building the node chain…' : workflow.description}</p>
      </div>
      <span className="hub-workflow-open"><ArrowRight aria-hidden="true" /></span>
    </button>
  );
}

function CreateWorkflowCard({ onCreate, busy, compact = false }) {
  return (
    <button type="button" className={`hub-workflow-card hub-workflow-create${compact ? ' compact' : ''}`} onClick={onCreate} disabled={busy}>
      <span className="hub-create-plus"><Plus aria-hidden="true" /></span>
      <div className="hub-workflow-card-copy">
        <h3>{busy ? 'Opening canvas…' : 'Create workflow'}</h3>
        <p>Start from an empty canvas and save the structure when it is ready.</p>
      </div>
    </button>
  );
}

function SeeAllCard({ href, label, count }) {
  return (
    <a className="hub-see-all-card" href={href}>
      <span>{count}</span>
      <strong>{label}</strong>
      <ArrowRight aria-hidden="true" />
    </a>
  );
}

function ProjectCard({ board }) {
  return (
    <a className="hub-project-card" href={`/canvas/${board.id}`}>
      <div className="hub-project-preview" aria-hidden="true">
        <span>{(board.name || 'U').trim().charAt(0).toUpperCase()}</span>
        <i /><i /><i />
      </div>
      <div className="hub-card-meta">
        <h3>{board.name || 'Untitled'}</h3>
        <p>Updated {formatRelative(board.updated_at)}</p>
      </div>
    </a>
  );
}

function ReferenceCard({ reference, href }) {
  return (
    <a className="hub-reference-card" href={href || `/canvas/library/references#${reference.id}`} id={href ? undefined : reference.id}>
      <div className={`hub-reference-preview tone-${reference.tone}`} style={{ '--reference-accent': reference.accent }} aria-hidden="true">
        <span /><span /><span />
        <b>{reference.category}</b>
      </div>
      <div className="hub-card-meta">
        <h3>{reference.name}</h3>
        <p>{reference.source}</p>
      </div>
    </a>
  );
}

function AssetCard({ asset }) {
  const image = asset.thumb_url || asset.blob_url;
  return (
    <article className="hub-asset-card">
      <div className="hub-asset-preview">
        {image
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={image} alt="" />
          : <ImageIcon aria-hidden="true" />}
      </div>
      <div className="hub-card-meta">
        <h3>{asset.name || 'Untitled asset'}</h3>
        <p>{asset.type || 'Collected asset'}</p>
      </div>
    </article>
  );
}

function CommunityCard({ item }) {
  return (
    <article className="hub-community-card">
      <div className={`hub-community-preview tone-${item.tone}`} aria-hidden="true"><span /><span /><span /></div>
      <div className="hub-card-meta">
        <h3>{item.name}</h3>
        <p>{item.author} · {item.workflow}</p>
      </div>
    </article>
  );
}

function SectionHeading({ id, title, href, action = 'See all' }) {
  return (
    <div className="hub-section-heading">
      <h2 id={id}>{title}</h2>
      <a href={href}>{action}<ArrowRight aria-hidden="true" /></a>
    </div>
  );
}

function AnimatedPrompt({ boards, firstName }) {
  const reducedMotion = useReducedMotion();
  const messages = useMemo(() => {
    const defaultTitle = `What we'll build today, ${firstName || 'maker'}?`;
    const meaningful = boards.filter((board) => board.name && board.name !== 'Untitled').slice(0, 2);
    const next = [defaultTitle];
    if (meaningful[0]) next.push(`Where should ${shortName(meaningful[0].name)} go next?`);
    if (meaningful[1]) next.push(`What could ${shortName(meaningful[1].name)} borrow from the web?`);
    if (boards.length) next.push('Turn your latest canvas into a reusable workflow?');
    next.push('Start with a reference and make it unmistakably yours?');
    return next;
  }, [boards, firstName]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (reducedMotion || messages.length < 2) return undefined;
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % messages.length), 5200);
    return () => window.clearInterval(timer);
  }, [messages, reducedMotion]);

  return (
    <div className="hub-prompt-title" aria-live="polite">
      <AnimatePresence mode="wait" initial={false}>
        <motion.h1
          key={messages[index]}
          initial={reducedMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reducedMotion ? undefined : { opacity: 0, y: -6 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          {messages[index]}
        </motion.h1>
      </AnimatePresence>
    </div>
  );
}

function HomeDashboard({ boards, workflows, references, onLaunchWorkflow, onCreateWorkflow, launching, creatingWorkflow, firstName }) {
  const featured = workflows.filter((workflow) => workflow.primary).slice(0, 5);
  return (
    <>
      <header className="hub-home-header">
        <AnimatedPrompt boards={boards} firstName={firstName} />
        <p>Resume a project, start from a proven chain, or collect something from the web.</p>
      </header>

      <section className="hub-section hub-workflows-section" aria-labelledby="hub-workflows-title">
        <SectionHeading id="hub-workflows-title" title="Workflows" href="/canvas/library/workflows" action="See all Workflows" />
        <div className="hub-workflow-track">
          {featured.map((workflow) => <WorkflowCard key={workflow.id} workflow={workflow} onLaunch={onLaunchWorkflow} busy={launching} />)}
          <CreateWorkflowCard onCreate={onCreateWorkflow} busy={creatingWorkflow} />
          <SeeAllCard href="/canvas/library/workflows" label="See all Workflows" count={`${workflows.length} templates`} />
        </div>
      </section>

      <section className="hub-section" aria-labelledby="hub-projects-title">
        <SectionHeading id="hub-projects-title" title="Recent Projects" href="/canvas/library/projects" action="See all Projects" />
        <div className="hub-five-grid">
          {boards.slice(0, 4).map((board) => <ProjectCard board={board} key={board.id} />)}
          <SeeAllCard href="/canvas/library/projects" label="See all Projects" count={`${boards.length} total`} />
        </div>
      </section>

      <section className="hub-section" aria-labelledby="hub-references-title">
        <SectionHeading id="hub-references-title" title="Start from a reference" href="/canvas/library/references" action="See all References" />
        <div className="hub-five-grid">
          {references.slice(0, 4).map((reference) => <ReferenceCard reference={reference} key={reference.id} />)}
          <SeeAllCard href="/canvas/library/references" label="See all References" count="Curated web" />
        </div>
      </section>
    </>
  );
}

function LibraryPage({ section, boards, workflows, assets, onCreateBoard, onLaunchWorkflow, onCreateWorkflow, launching, creatingBoard, creatingWorkflow }) {
  const meta = LIBRARY_META[section];
  return (
    <>
      <header className="hub-library-header">
        <a href="/canvas" className="hub-back"><ArrowLeft aria-hidden="true" />Back</a>
        <h1>{meta.title}</h1>
        <p>{meta.copy}</p>
      </header>

      {section === 'projects' && (
        <div className="hub-library-grid hub-project-library">
          <button type="button" className="hub-project-card hub-new-project" onClick={onCreateBoard} disabled={creatingBoard}>
            <span><CirclePlus aria-hidden="true" /></span>
            <strong>{creatingBoard ? 'Creating…' : 'New project'}</strong>
            <small>Open a blank canvas</small>
          </button>
          {boards.map((board) => <ProjectCard board={board} key={board.id} />)}
        </div>
      )}

      {section === 'workflows' && (
        <div className="hub-library-grid hub-workflow-library">
          <CreateWorkflowCard onCreate={onCreateWorkflow} busy={creatingWorkflow} compact />
          {workflows.map((workflow) => <WorkflowCard key={workflow.id} workflow={workflow} onLaunch={onLaunchWorkflow} busy={launching} compact />)}
        </div>
      )}

      {section === 'references' && (
        <div className="hub-library-grid">{REFERENCE_SITES.map((item) => <ReferenceCard key={item.id} reference={item} />)}</div>
      )}

      {section === 'assets' && (
        assets.length
          ? <div className="hub-library-grid">{assets.map((asset) => <AssetCard key={asset.id} asset={asset} />)}</div>
          : <div className="hub-library-empty"><Boxes aria-hidden="true" /><h2>Your collected pieces will live here.</h2><p>Use the browser collector or add an asset node to begin building a reusable library.</p></div>
      )}

      {section === 'community' && (
        <div className="hub-library-grid">{COMMUNITY_EXAMPLES.map((item) => <CommunityCard key={item.id} item={item} />)}</div>
      )}
    </>
  );
}

export default function BoardsList({
  boards: initial,
  userName,
  userEmail,
  userPlan,
  savedWorkflows = [],
  assets = [],
  view = 'home',
}) {
  const [boards] = useState(initial);
  const [creatingBoard, setCreatingBoard] = useState(false);
  const [creatingWorkflow, setCreatingWorkflow] = useState(false);
  const [launching, setLaunching] = useState(null);
  const router = useRouter();
  const workflows = useMemo(() => [
    ...BUILTIN_WORKFLOWS,
    ...savedWorkflows.map(savedWorkflowToTemplate),
  ], [savedWorkflows]);
  const firstName = (userName || userEmail || '').trim().split(/\s+/)[0] || 'maker';

  async function createBoard() {
    setCreatingBoard(true);
    try {
      const { board } = await api.createBoard('Untitled');
      router.push(`/canvas/${board.id}`);
    } catch (error) {
      alert(`Could not create project: ${error.message}`);
      setCreatingBoard(false);
    }
  }

  async function createWorkflow() {
    setCreatingWorkflow(true);
    try {
      const { board } = await api.createBoard('Untitled workflow');
      router.push(`/canvas/${board.id}?onboarding=create-workflow`);
    } catch (error) {
      alert(`Could not create workflow: ${error.message}`);
      setCreatingWorkflow(false);
    }
  }

  async function launchWorkflow(workflow) {
    if (launching) return;
    setLaunching(workflow.id);
    let board = null;
    try {
      ({ board } = await api.createBoard(workflow.name));
      const planned = layoutWorkflowNodes(workflow.nodes || []);
      const created = await Promise.all(planned.map((item, index) => api.createNode({
        boardId: board.id,
        kind: item.kind,
        posX: item.posX,
        posY: item.posY,
        width: item.width,
        height: item.height,
        isMain: item.isMain ?? (item.kind === 'site' && index === planned.length - 1),
        meta: {
          ...(item.meta || {}),
          name: item.label,
          workflowSlotLabel: item.label,
          workflowTemplateId: workflow.id,
          status: 'Ready to populate',
        },
      })));
      const idByKey = new Map(created.map((result, index) => [planned[index].key, result.node.id]));
      await Promise.all((workflow.edges || []).map((item) => api.createEdge({
        boardId: board.id,
        sourceNodeId: idByKey.get(item.from),
        targetNodeId: idByKey.get(item.to),
        kind: item.kind || 'generic',
        payload: { generatedBy: 'workflow-template', workflowTemplateId: workflow.id },
      })));
      router.push(`/canvas/${board.id}?onboarding=workflow-template`);
    } catch (error) {
      if (board?.id) await api.deleteBoard(board.id).catch(() => {});
      alert(`Could not build workflow: ${error.message}`);
      setLaunching(null);
    }
  }

  async function logout() {
    await api.logout().catch(() => {});
    localStorage.removeItem('token');
    window.location.href = '/';
  }

  const activeSection = view === 'home' ? null : view;
  return (
    <div className="hub-shell">
      <WorkspaceSidebar activeSection={activeSection} userName={userName} userEmail={userEmail} userPlan={userPlan} onSignOut={logout} />
      <main className="hub-main">
        <div className="hub-global-actions"><CreditsPill /></div>
        {view === 'home'
          ? (
            <HomeDashboard
              boards={boards}
              workflows={workflows}
              references={REFERENCE_SITES}
              onLaunchWorkflow={launchWorkflow}
              onCreateWorkflow={createWorkflow}
              launching={launching}
              creatingWorkflow={creatingWorkflow}
              firstName={firstName}
            />
          )
          : (
            <LibraryPage
              section={view}
              boards={boards}
              workflows={workflows}
              assets={assets}
              onCreateBoard={createBoard}
              onLaunchWorkflow={launchWorkflow}
              onCreateWorkflow={createWorkflow}
              launching={launching}
              creatingBoard={creatingBoard}
              creatingWorkflow={creatingWorkflow}
            />
          )}
      </main>
    </div>
  );
}
