'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ChevronUp,
  Code2,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Monitor,
  Palette,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Sparkles,
  Zap,
} from 'lucide-react';
import { originColor } from '../lib/node-origin.js';
import { canUseCloneEdit } from '../lib/clone-edit-access.js';
import { CLONE_EDIT_CREDIT_ESTIMATE } from '../lib/billing/pricing.js';
import { isLiveUrlReference } from '../lib/url-reference.js';

// The canvas inspector is intentionally contextual. With no selection it
// disappears and returns the space to the canvas. With a selection it offers
// a useful overview first; the mature editor-core remains the place for deep
// website editing.
const COLLAPSE_KEY = 'uncraft-inspector-collapsed';

function FrameField({ label, value, onCommit }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);

  function commit() {
    const next = Math.round(parseFloat(draft));
    if (Number.isNaN(next)) { setDraft(String(value)); return; }
    if (next !== value) onCommit(next);
  }

  return (
    <label className="cinsp-field">
      <span>{label}</span>
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
          if (event.key === 'Escape') { setDraft(String(value)); event.currentTarget.blur(); }
        }}
        inputMode="numeric"
        spellCheck={false}
      />
    </label>
  );
}

function Panel({ title, icon: Icon, children, defaultCollapsed = false }) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  return (
    <section className={`cinsp-panel${collapsed ? ' collapsed' : ''}`}>
      <header>
        <button
          type="button"
          className="cinsp-panel-toggle"
          onClick={() => setCollapsed((value) => !value)}
          aria-expanded={!collapsed}
        >
          <span className="cinsp-panel-title">{Icon && <Icon aria-hidden="true" />}<b>{title}</b></span>
          <ChevronUp aria-hidden="true" />
        </button>
      </header>
      {!collapsed && <div className="cinsp-panel-body">{children}</div>}
    </section>
  );
}

function Detail({ label, value, mono = false }) {
  if (value == null || value === '') return null;
  return (
    <div className="cinsp-detail">
      <span>{label}</span>
      <b className={mono ? 'mono' : undefined}>{value}</b>
    </div>
  );
}

function sourceLabel(node) {
  if (!node?.origin_url) return node?.meta?.source || 'Created in Uncraft';
  try { return new URL(node.origin_url).hostname.replace(/^www\./, ''); }
  catch { return node.origin_url; }
}

function nodeLabel(node) {
  return node?.meta?.name || node?.name || node?.origin_url || `${node?.kind || 'unknown'} node`;
}

function readableKind(node) {
  const kind = node?.kind;
  if (kind === 'designmd') return 'Design system';
  if (kind === 'chunk') return 'HTML snippet';
  if (kind === 'skill' && node?.meta?.subtype === 'shader') return 'React shader';
  if (kind === 'skill') return 'Code / skill';
  if (kind === 'asset') return node?.meta?.mediaType === 'video' ? 'Video' : 'Image';
  if (kind === 'site') return 'Website';
  if (kind === 'prompt') return 'Prompt';
  return kind ? `${kind.charAt(0).toUpperCase()}${kind.slice(1)}` : 'Node';
}

function paletteFrom(node) {
  const sources = [
    node?.current_design_md,
    node?.design_md,
    node?.meta?.designMd,
    JSON.stringify(node?.meta?.palette || []),
  ].filter(Boolean).join(' ');
  const colors = sources.match(/#[0-9a-fA-F]{6}\b/g) || [];
  return [...new Set(colors.map((color) => color.toUpperCase()))].slice(0, 8);
}

function codeFrom(node) {
  return node?.meta?.code || node?.current_html || node?.html || node?.meta?.snippet || '';
}

function Overview({ node }) {
  const kind = node.kind;
  const palette = useMemo(() => paletteFrom(node), [node]);
  const prompt = node?.meta?.prompt || node?.meta?.text || node?.prompt || node?.current_prompt || '';
  const isSite = kind === 'site';
  const isAsset = kind === 'asset';
  const isDesign = kind === 'designmd';
  const isCode = kind === 'skill' || kind === 'chunk';

  return (
    <>
      <Panel title="Overview" icon={isAsset ? ImageIcon : isDesign ? Palette : isCode ? Code2 : FileText}>
        <div className="cinsp-details">
          <Detail label="Type" value={readableKind(node)} />
          <Detail label="Source" value={sourceLabel(node)} />
          {node?.meta?.status && <Detail label="Status" value={node.meta.status} />}
          {isSite && <Detail label="Viewport" value={`${Math.round(node.width)} × ${Math.round(node.height)}`} mono />}
          {isAsset && <Detail label="Dimensions" value={node?.meta?.dimensions || `${Math.round(node.width)} × ${Math.round(node.height)}`} mono />}
          {isCode && <Detail label="Runtime" value={node?.meta?.runtime || node?.meta?.language || 'React / JavaScript'} />}
        </div>
      </Panel>

      {kind === 'prompt' && (
        <Panel title="Prompt" icon={Sparkles}>
          <p className="cinsp-copy-preview">{prompt || 'This prompt has no text yet.'}</p>
          <p className="cinsp-help">Edit the prompt directly in its node. Connected nodes use it as transformation context.</p>
        </Panel>
      )}

      {isAsset && (
        <Panel title="Image tools" icon={Sparkles}>
          {(node?.current_screenshot || node?.meta?.dataUrl || node?.meta?.url) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="cinsp-asset-preview" src={node.current_screenshot || node.meta.dataUrl || node.meta.url} alt="Selected asset preview" />
          )}
          <p className="cinsp-help">Smart Edit remains available on the selected image node, preserving the original as context.</p>
        </Panel>
      )}

      {isDesign && (
        <Panel title="Design language" icon={Palette}>
          {palette.length ? (
            <div className="cinsp-palette" aria-label="Extracted color palette">
              {palette.map((color) => <span key={color} title={color} style={{ background: color }} />)}
            </div>
          ) : <p className="cinsp-help">Run or connect this node to extract its color and type scales.</p>}
          <Detail label="Type scale" value={node?.meta?.typeScale || 'Modular scale'} />
          <Detail label="Format" value="design.md" mono />
        </Panel>
      )}

      {isCode && (
        <Panel title={node?.meta?.subtype === 'shader' ? 'Shader controls' : 'Code behavior'} icon={Code2}>
          {node?.meta?.subtype === 'shader' ? (
            <>
              <Detail label="Uniforms" value={node?.meta?.uniforms?.length || 'Detected from code'} />
              <Detail label="Render" value={node?.meta?.renderer || 'React / WebGL'} />
              <p className="cinsp-help">Shaders stay inside the Code category, with subtype-specific controls surfaced here.</p>
            </>
          ) : (
            <p className="cinsp-help">Code snippets, skills, and shaders share one reusable category. Runtime-specific controls appear when detected.</p>
          )}
        </Panel>
      )}

      <Panel title="Frame" icon={Monitor}>
        <div className="cinsp-field-grid">
          <FrameField label="X" value={Math.round(node.pos_x)} onCommit={(value) => node.onFrameChange({ posX: value })} />
          <FrameField label="Y" value={Math.round(node.pos_y)} onCommit={(value) => node.onFrameChange({ posY: value })} />
          <FrameField label="W" value={Math.round(node.width)} onCommit={(value) => node.onFrameChange({ width: Math.max(80, value) })} />
          <FrameField label="H" value={Math.round(node.height)} onCommit={(value) => node.onFrameChange({ height: Math.max(60, value) })} />
        </div>
      </Panel>
    </>
  );
}

function CodePreview({ node }) {
  const value = codeFrom(node);
  return (
    <div className="cinsp-code-view">
      <div className="cinsp-code-meta">
        <span>{node?.meta?.language || (node.kind === 'site' ? 'HTML' : 'JavaScript')}</span>
        <span>Read-only preview</span>
      </div>
      <pre>{value ? value.slice(0, 1800) : 'No code snapshot is available for this node yet.'}</pre>
    </div>
  );
}

function WebsiteActions({ node, onEditSite, onUpgradeRequired, plan, busy = false }) {
  // Open in Browser needs a viewable preview: a snapshot to render, or an
  // origin URL the preview route can redirect to. Disabled while busy
  // (capturing/cloning) OR when neither exists — a blank "Connect to…" node
  // would otherwise open a guaranteed 404 (adversarial review Codex #3).
  const openDisabled = busy || (!node.current_snapshot_id && !node.origin_url);
  const cloneRequired = isLiveUrlReference(node);
  const cloneAllowed = canUseCloneEdit(plan);
  const cloneLocked = cloneRequired && !cloneAllowed;
  const cloneLabel = cloneLocked
    ? `Clone & Edit, paid plans only, ${CLONE_EDIT_CREDIT_ESTIMATE} credits`
    : `Clone & Edit, ${CLONE_EDIT_CREDIT_ESTIMATE} credits`;
  return (
    <div className="cinsp-primary-action">
      <div>
        <span>Website</span>
        <p>Open the visual editor or inspect the current result in a clean browser tab.</p>
      </div>
      <button
        type="button"
        className={cloneRequired ? 'cinsp-clone-edit' : undefined}
        data-subscriber-feature={cloneRequired ? (cloneLocked ? 'locked' : 'available') : undefined}
        aria-label={cloneRequired ? cloneLabel : 'Edit'}
        title={cloneLocked ? 'Available on paid plans' : undefined}
        disabled={busy}
        onClick={cloneLocked ? onUpgradeRequired : onEditSite}
      >
        {cloneRequired ? <Zap aria-hidden="true" /> : <Pencil aria-hidden="true" />}
        <span>{cloneRequired ? 'Clone & Edit' : 'Edit'}</span>
        {cloneRequired && <span className="cinsp-clone-cost">{CLONE_EDIT_CREDIT_ESTIMATE} credits</span>}
      </button>
      {openDisabled ? (
        <span className="cinsp-open-browser cinsp-open-browser-disabled" aria-disabled="true" title={busy ? 'Available once capture finishes' : 'No preview yet'}>
          <ExternalLink aria-hidden="true" />
          Open in Browser
        </span>
      ) : (
        <a className="cinsp-open-browser" href={`/preview/${node.id}`} target="_blank" rel="noopener noreferrer">
          <ExternalLink aria-hidden="true" />
          Open in Browser
        </a>
      )}
    </div>
  );
}

export default function CanvasInspector({
  node,
  onEditSite,
  onUpgradeRequired,
  onFrameChange,
  plan = 'free',
  busy = false,
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [tab, setTab] = useState('properties');

  useEffect(() => {
    try { setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1'); } catch { /* SSR */ }
  }, []);

  useEffect(() => { setTab('properties'); }, [node?.id]);

  // The minimap follows the actual visible panel, not a remembered preference.
  useEffect(() => {
    const inspectorVisible = Boolean(node) && !collapsed;
    document.documentElement.style.setProperty('--inspector-w', inspectorVisible ? '248px' : '0px');
    document.documentElement.style.setProperty('--minimap-top', collapsed && node ? '72px' : '62px');
    document.documentElement.style.setProperty('--minimap-right', inspectorVisible ? '264px' : '15px');
    return () => {
      document.documentElement.style.removeProperty('--inspector-w');
      document.documentElement.style.removeProperty('--minimap-top');
      document.documentElement.style.removeProperty('--minimap-right');
    };
  }, [collapsed, node]);

  function toggle() {
    setCollapsed((value) => {
      try { localStorage.setItem(COLLAPSE_KEY, value ? '0' : '1'); } catch { /* ignore */ }
      return !value;
    });
  }

  if (!node) return null;

  if (collapsed) {
    return (
      <button type="button" className="canvas-inspector collapsed" onClick={toggle} title="Expand inspector" aria-label="Expand inspector">
        <PanelRightOpen aria-hidden="true" />
      </button>
    );
  }

  const color = originColor(node);
  const framedNode = { ...node, onFrameChange: (patch) => onFrameChange(node.id, patch) };

  return (
    <aside className="canvas-inspector" aria-label="Selected node inspector">
      <div className="cinsp-head">
        <div className="cinsp-tabs" role="tablist" aria-label="Inspector views">
          <button type="button" className={tab === 'properties' ? 'active' : ''} onClick={() => setTab('properties')} role="tab" aria-selected={tab === 'properties'}>Properties</button>
          <button type="button" className={tab === 'code' ? 'active' : ''} onClick={() => setTab('code')} role="tab" aria-selected={tab === 'code'}>Code</button>
        </div>
        <button type="button" className="cinsp-collapse" onClick={toggle} title="Collapse inspector" aria-label="Collapse inspector">
          <PanelRightClose aria-hidden="true" />
        </button>
      </div>

      <div className="cinsp-selection">
        <span className="cinsp-type-chip" style={{ color, borderColor: `${color}66`, background: `${color}18` }}>{readableKind(node)}</span>
        <span className="cinsp-selection-name" title={nodeLabel(node)}>{nodeLabel(node)}</span>
      </div>

      {node.kind === 'site' && (
        <WebsiteActions
          node={node}
          onEditSite={onEditSite}
          onUpgradeRequired={onUpgradeRequired}
          plan={plan}
          busy={busy}
        />
      )}

      {tab === 'properties'
        ? <Overview node={framedNode} />
        : <CodePreview node={node} />}
    </aside>
  );
}
