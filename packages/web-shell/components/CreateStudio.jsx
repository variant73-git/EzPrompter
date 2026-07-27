'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Code2,
  FileImage,
  Globe2,
  Image as ImageIcon,
  Layers3,
  LoaderCircle,
  MousePointer2,
  Palette,
  Paperclip,
  RotateCcw,
  Sparkles,
  WandSparkles,
} from 'lucide-react';
import { api } from '../lib/canvas-api.js';
import CreditsPill from './CreditsPill.jsx';
import UserPill from './UserPill.jsx';
import {
  BUILDER_STARTERS,
  STUDIO_MODES,
  createMockSiteHtml,
  createSourcePreviewHtml,
  defaultStudioDrafts,
  isStudioMode,
  suggestStudioProjectName,
  validateStudioInput,
} from '../lib/studio-mock.js';

const MODE_ICONS = { builder: WandSparkles, clone: Layers3, style: Palette };

function UploadControl({ label, value, onChange }) {
  const inputRef = useRef(null);
  return (
    <div className={`studio-upload${value ? ' has-file' : ''}`}>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={(event) => onChange(event.target.files?.[0]?.name || '')}
        tabIndex={-1}
      />
      <button type="button" onClick={() => inputRef.current?.click()}>
        {value ? <Check aria-hidden="true" /> : <FileImage aria-hidden="true" />}
        <span><b>{value || label}</b><small>{value ? 'Ready as visual context' : 'PNG, JPG or WebP'}</small></span>
        <span className="studio-upload-action">{value ? 'Replace' : 'Choose'}</span>
      </button>
    </div>
  );
}

function SourceField({ label, helper, value, onChange, uploadName, onUpload, placeholder = 'https://example.com' }) {
  return (
    <div className="studio-source-card">
      <div className="studio-source-card-head">
        <span><Globe2 aria-hidden="true" /></span>
        <div><b>{label}</b><small>{helper}</small></div>
      </div>
      <label className="studio-input-row">
        <span>URL</span>
        <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} spellCheck={false} />
      </label>
      <div className="studio-source-or"><span>or use a screenshot</span></div>
      <UploadControl label="Choose screenshot" value={uploadName} onChange={onUpload} />
    </div>
  );
}

function ChoiceRow({ label, value, options, onChange }) {
  return (
    <fieldset className="studio-choice-field">
      <legend>{label}</legend>
      <div className="studio-choice-row">
        {options.map((option) => (
          <button key={option} type="button" className={value === option ? 'active' : ''} onClick={() => onChange(option)} aria-pressed={value === option}>{option}</button>
        ))}
      </div>
    </fieldset>
  );
}

function ModeTabs({ mode, onChange }) {
  return (
    <div className="studio-mode-tabs" role="tablist" aria-label="Creation mode">
      {Object.entries(STUDIO_MODES).map(([id, item]) => {
        const Icon = MODE_ICONS[id];
        return (
          <button
            key={id}
            type="button"
            className={mode === id ? 'active' : ''}
            onClick={() => onChange(id)}
            role="tab"
            aria-selected={mode === id}
            style={{ '--mode-accent': item.accent }}
          >
            <Icon aria-hidden="true" />
            <span><b>{item.label}</b><small>{item.eyebrow}</small></span>
          </button>
        );
      })}
    </div>
  );
}

function BuilderForm({ draft, update }) {
  return (
    <>
      <label className="studio-brief-field">
        <span>Website brief <b>Required</b></span>
        <textarea
          value={draft.brief}
          onChange={(event) => update({ brief: event.target.value })}
          placeholder="A portfolio for a type designer, focused on experimental work and licensing. It should feel editorial, precise and confident…"
          autoFocus
        />
      </label>
      <div className="studio-starters" aria-label="Prompt starters">
        <span>Start with an example</span>
        <div>{BUILDER_STARTERS.map((starter) => <button key={starter} type="button" onClick={() => update({ brief: starter })}>{starter}</button>)}</div>
      </div>
      <details className="studio-details">
        <summary><Paperclip aria-hidden="true" /><span>Add reference material</span><ChevronDown aria-hidden="true" /></summary>
        <div className="studio-details-content">
          <label className="studio-input-stack"><span>Reference website</span><input value={draft.referenceUrl} onChange={(event) => update({ referenceUrl: event.target.value })} placeholder="https://a-site-you-like.com" spellCheck={false} /></label>
          <UploadControl label="Attach an image or design reference" value={draft.referenceName} onChange={(referenceName) => update({ referenceName })} />
        </div>
      </details>
      <ChoiceRow label="Visual direction" value={draft.direction} options={['Editorial and precise', 'Expressive and bold', 'Minimal and quiet']} onChange={(direction) => update({ direction })} />
    </>
  );
}

function CloneForm({ draft, update }) {
  return (
    <>
      <div className="studio-source-switch" role="tablist" aria-label="Clone source">
        <button type="button" className={draft.sourceType === 'url' ? 'active' : ''} onClick={() => update({ sourceType: 'url' })}><Globe2 aria-hidden="true" />Live URL</button>
        <button type="button" className={draft.sourceType === 'upload' ? 'active' : ''} onClick={() => update({ sourceType: 'upload' })}><ImageIcon aria-hidden="true" />Screenshot</button>
      </div>
      {draft.sourceType === 'url' ? (
        <label className="studio-url-hero"><span>Website URL</span><div><Globe2 aria-hidden="true" /><input value={draft.url} onChange={(event) => update({ url: event.target.value })} placeholder="https://website-to-recreate.com" autoFocus spellCheck={false} /></div><small>Uncraft will recover hierarchy, layout, type, color and reusable components.</small></label>
      ) : (
        <UploadControl label="Choose the screenshot to recreate" value={draft.screenshotName} onChange={(screenshotName) => update({ screenshotName })} />
      )}
      <ChoiceRow label="Recreation fidelity" value={draft.fidelity} options={['Exact', 'Balanced', 'Inspired']} onChange={(fidelity) => update({ fidelity })} />
      <label className="studio-input-stack"><span>What should change? <small>Optional</small></span><textarea value={draft.notes} onChange={(event) => update({ notes: event.target.value })} placeholder="Keep the structure, but make the type more contemporary…" /></label>
    </>
  );
}

function StyleForm({ draft, update }) {
  return (
    <>
      <div className="studio-style-sources">
        <SourceField
          label="Target website"
          helper="Keep its content and chosen structure"
          value={draft.targetUrl}
          onChange={(targetUrl) => update({ targetUrl })}
          uploadName={draft.targetName}
          onUpload={(targetName) => update({ targetName })}
        />
        <div className="studio-transplant-arrow"><ArrowRight aria-hidden="true" /><span>Style moves here</span></div>
        <SourceField
          label="Style reference"
          helper="Borrow its visual language"
          value={draft.styleUrl}
          onChange={(styleUrl) => update({ styleUrl })}
          uploadName={draft.styleName}
          onUpload={(styleName) => update({ styleName })}
        />
      </div>
      <ChoiceRow label="Preserve from the target" value={draft.preservation} options={['Structure + content', 'Content only', 'Layout only']} onChange={(preservation) => update({ preservation })} />
      <label className="studio-input-stack"><span>Creative direction <small>Optional</small></span><textarea value={draft.notes} onChange={(event) => update({ notes: event.target.value })} placeholder="Use the reference typography and pacing, but keep the target navigation compact…" /></label>
    </>
  );
}

function HandoffEvidence({ mode, draft }) {
  const evidence = mode === 'builder'
    ? [draft.brief ? 'Brief ready' : 'Website brief missing', draft.referenceUrl || draft.referenceName ? 'Reference material attached' : 'No reference — Uncraft will compose from the brief', 'Editable website + prompt + design system']
    : mode === 'clone'
      ? [draft.url || draft.screenshotName ? 'Source reference ready' : 'Source missing', `${draft.fidelity} recreation`, 'Source + recreation + design system']
      : [draft.targetUrl || draft.targetName ? 'Target ready' : 'Target missing', draft.styleUrl || draft.styleName ? 'Style reference ready' : 'Style reference missing', `${draft.preservation} preserved`];
  return (
    <aside className="studio-evidence">
      <div className="studio-evidence-visual">
        <div className="studio-evidence-node source"><Globe2 aria-hidden="true" /><span>Material</span></div>
        <i />
        <div className="studio-evidence-node result"><Sparkles aria-hidden="true" /><span>Website</span></div>
        <i />
        <div className="studio-evidence-node canvas"><MousePointer2 aria-hidden="true" /><span>Canvas</span></div>
      </div>
      <small>Canvas handoff</small>
      <h3>Nothing disappears after the magic.</h3>
      <p>Your result opens with its source material and instructions visible as connected nodes.</p>
      <ul>{evidence.map((item, index) => <li key={item} className={index < 2 && /missing/i.test(item) ? 'missing' : ''}><Check aria-hidden="true" />{item}</li>)}</ul>
      <div className="studio-evidence-note"><Code2 aria-hidden="true" /><span>HTML is generated for this prototype. No AI request or credits are used.</span></div>
    </aside>
  );
}

function BuildProgress({ mode, progressIndex }) {
  const item = STUDIO_MODES[mode];
  return (
    <main className="studio-building" style={{ '--mode-accent': item.accent }}>
      <div className="studio-building-orbit"><span /><span /><Sparkles aria-hidden="true" /></div>
      <small>Interactive prototype</small>
      <h1>{item.progress[Math.min(progressIndex, item.progress.length - 1)]}</h1>
      <p>We are preparing a believable result and the nodes that will explain how it was made.</p>
      <ol>{item.progress.map((label, index) => <li key={label} className={index < progressIndex ? 'done' : index === progressIndex ? 'active' : ''}><span>{index < progressIndex ? <Check aria-hidden="true" /> : index + 1}</span>{label}</li>)}</ol>
    </main>
  );
}

function ResultView({ mode, draft, resultHtml, sourceHtml, compare, setCompare, onBack, onOpenCanvas, opening, openError }) {
  const item = STUDIO_MODES[mode];
  return (
    <main className="studio-result" style={{ '--mode-accent': item.accent }}>
      <header className="studio-result-head">
        <div><small>Prototype ready</small><h1>{suggestStudioProjectName(mode, draft)}</h1><p>Review the transformation here, then open the complete material map in Canvas.</p></div>
        <div className="studio-compare-tabs" role="tablist" aria-label="Preview mode">
          <button type="button" className={compare === 'result' ? 'active' : ''} onClick={() => setCompare('result')}>Result</button>
          <button type="button" className={compare === 'split' ? 'active' : ''} onClick={() => setCompare('split')}>Compare</button>
        </div>
      </header>

      <div className={`studio-result-grid${compare === 'split' ? ' split' : ''}`}>
        {compare === 'split' && <div className="studio-preview-frame"><span>Before</span><iframe title="Source website preview" srcDoc={sourceHtml} sandbox="" /></div>}
        <div className="studio-preview-frame result"><span>{compare === 'split' ? 'After' : `${item.label} result`}</span><iframe title="Generated website prototype" srcDoc={resultHtml} sandbox="" /></div>
      </div>

      <aside className="studio-result-actions">
        <div className="studio-result-map">
          <small>What opens in Canvas</small>
          <h3>A result with provenance.</h3>
          <ul>
            <li><span style={{ background: mode === 'clone' ? '#F97316' : '#2966EA' }}><Globe2 aria-hidden="true" /></span><div><b>{mode === 'builder' ? 'Prompt brief' : mode === 'clone' ? 'Original reference' : 'Target website'}</b><small>Your starting material</small></div></li>
            {mode === 'style' && <li><span style={{ background: '#7951C2' }}><ImageIcon aria-hidden="true" /></span><div><b>Style reference</b><small>Visual language source</small></div></li>}
            <li><span style={{ background: '#EEA665' }}><Palette aria-hidden="true" /></span><div><b>design.md</b><small>Color and type tokens</small></div></li>
            <li><span style={{ background: '#2966EA' }}><Sparkles aria-hidden="true" /></span><div><b>Editable website</b><small>Ready for the visual editor</small></div></li>
          </ul>
        </div>
        {openError && <p className="studio-open-error" role="alert">{openError}</p>}
        <button type="button" className="studio-open-canvas" onClick={onOpenCanvas} disabled={opening}>
          {opening ? <LoaderCircle className="spin" aria-hidden="true" /> : <MousePointer2 aria-hidden="true" />}
          {opening ? 'Preparing Canvas…' : 'Open in Canvas'}
          {!opening && <ArrowRight aria-hidden="true" />}
        </button>
        <button type="button" className="studio-back-edit" onClick={onBack}><RotateCcw aria-hidden="true" /> Adjust inputs</button>
        <p className="studio-result-disclaimer">Prototype output · no credits used</p>
      </aside>
    </main>
  );
}

export default function CreateStudio({ initialMode = 'builder', user }) {
  const router = useRouter();
  const [mode, setMode] = useState(isStudioMode(initialMode) ? initialMode : 'builder');
  const [drafts, setDrafts] = useState(defaultStudioDrafts);
  const [stage, setStage] = useState('input');
  const [progressIndex, setProgressIndex] = useState(0);
  const [error, setError] = useState('');
  const [compare, setCompare] = useState('result');
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState('');
  const item = STUDIO_MODES[mode];
  const draft = drafts[mode];
  const resultHtml = useMemo(() => createMockSiteHtml(mode, draft), [mode, draft]);
  const sourceHtml = useMemo(() => createSourcePreviewHtml(mode, draft), [mode, draft]);

  useEffect(() => {
    if (stage !== 'building') return undefined;
    const timers = item.progress.map((_, index) => setTimeout(() => setProgressIndex(index), index * 620));
    timers.push(setTimeout(() => { setStage('result'); setCompare('result'); }, item.progress.length * 620 + 220));
    return () => timers.forEach(clearTimeout);
  }, [stage, item.progress]);

  function setNextMode(next) {
    if (!isStudioMode(next) || next === mode || stage === 'building') return;
    setMode(next);
    setStage('input');
    setError('');
    setOpenError('');
    router.replace(`/create?mode=${next}`, { scroll: false });
  }

  function update(patch) {
    setDrafts((current) => ({ ...current, [mode]: { ...current[mode], ...patch } }));
    if (error) setError('');
  }

  function build() {
    const nextError = validateStudioInput(mode, draft);
    if (nextError) { setError(nextError); return; }
    setProgressIndex(0);
    setStage('building');
  }

  async function openCanvas() {
    setOpening(true);
    setOpenError('');
    try {
      const projectName = suggestStudioProjectName(mode, draft);
      const { board } = await api.createBoard(projectName);
      const supportNodes = [];

      if (mode === 'builder') {
        const { node } = await api.createNode({
          boardId: board.id,
          kind: 'prompt',
          posX: 760,
          posY: 1550,
          width: 430,
          height: 260,
          meta: { name: 'Website brief', prompt: draft.brief, text: draft.brief, source: 'create-studio', direction: draft.direction },
        });
        supportNodes.push(node);
      } else {
        const sourceUrl = mode === 'clone' ? draft.url : draft.targetUrl;
        const sourceName = mode === 'clone' ? (draft.screenshotName || 'Original reference') : (draft.targetName || 'Target website');
        const { node } = await api.createNode({
          boardId: board.id,
          kind: 'site',
          originUrl: sourceUrl || null,
          posX: 520,
          posY: 1250,
          width: 900,
          height: 650,
          html: sourceHtml,
          meta: { name: sourceName, sourceReference: true, generatedBy: 'create-studio', mock: true },
        });
        supportNodes.push(node);
      }

      if (mode === 'style') {
        const { node } = await api.createNode({
          boardId: board.id,
          kind: 'site',
          originUrl: draft.styleUrl || null,
          posX: 520,
          posY: 2150,
          width: 900,
          height: 650,
          html: createSourcePreviewHtml('clone', { url: draft.styleUrl, screenshotName: draft.styleName }),
          meta: { name: draft.styleName || 'Style reference', styleReference: true, generatedBy: 'create-studio', mock: true },
        });
        supportNodes.push(node);
      }

      const { node: designNode } = await api.createNode({
        boardId: board.id,
        kind: 'designmd',
        posX: 1660,
        posY: 2160,
        width: 470,
        height: 520,
        designMd: `# ${projectName} design system\n\n## Color\n- Canvas: #191917\n- Ink: #F1F0EB\n- Site: #2966EA\n- Accent: ${item.accent}\n- Design: #EEA665\n\n## Typography\n- Display: Editorial serif\n- UI: Inter\n- Scale: 12, 16, 24, 52, 104\n`,
        meta: { name: 'design.md', generatedBy: 'create-studio', mock: true, typeScale: '12 · 16 · 24 · 52 · 104' },
      });

      const originUrl = mode === 'clone' ? draft.url : mode === 'style' ? draft.targetUrl : null;
      const { node: resultNode } = await api.createNode({
        boardId: board.id,
        kind: 'site',
        originUrl: originUrl || null,
        posX: 2520,
        posY: 1350,
        width: 1280,
        height: 800,
        isMain: true,
        html: resultHtml,
        meta: {
          name: `${projectName} · Result`,
          source: mode === 'builder' ? 'blank' : 'create-studio',
          extractTo: mode === 'clone' ? 'clone' : undefined,
          generatedBy: `studio-${mode}`,
          prototype: true,
          status: 'Prototype result',
          preservation: draft.preservation,
        },
      });

      const edges = [
        ...supportNodes.map((node, index) => api.createEdge({ boardId: board.id, sourceNodeId: node.id, targetNodeId: resultNode.id, kind: mode === 'style' && index > 0 ? 'transplant' : 'generic', payload: { generatedBy: 'create-studio', mode } })),
        api.createEdge({ boardId: board.id, sourceNodeId: designNode.id, targetNodeId: resultNode.id, kind: 'token-swap', payload: { generatedBy: 'create-studio', mode } }),
      ];
      await Promise.allSettled(edges);
      router.push(`/canvas/${board.id}?from=create&mode=${mode}`);
    } catch (nextError) {
      setOpenError(nextError?.message || 'Could not prepare this Canvas. Try again.');
      setOpening(false);
    }
  }

  async function logout() {
    await api.logout().catch(() => {});
    localStorage.removeItem('token');
    window.location.href = '/';
  }

  return (
    <div className={`create-studio stage-${stage}`} style={{ '--mode-accent': item.accent }}>
      <header className="studio-topbar">
        <a className="studio-logo" href="/canvas" aria-label="Back to Projects">U</a>
        <a className="studio-back" href="/canvas"><ArrowLeft aria-hidden="true" />Projects</a>
        <div className="studio-draft-name">{suggestStudioProjectName(mode, draft)}<span>Prototype</span></div>
        <div className="studio-account"><CreditsPill /><UserPill name={user?.name} email={user?.email} plan={user?.plan} role={user?.role} onSignOut={logout} /></div>
      </header>

      {stage !== 'building' && <ModeTabs mode={mode} onChange={setNextMode} />}

      {stage === 'input' && (
        <main className="studio-input-layout">
          <section className="studio-input-workspace">
            <header className="studio-intro"><small>{item.eyebrow}</small><h1>{item.question}</h1><p>{item.description}</p></header>
            <div className="studio-form">
              {mode === 'builder' && <BuilderForm draft={draft} update={update} />}
              {mode === 'clone' && <CloneForm draft={draft} update={update} />}
              {mode === 'style' && <StyleForm draft={draft} update={update} />}
              {error && <p className="studio-form-error" role="alert">{error}</p>}
              <div className="studio-form-submit">
                <span><Sparkles aria-hidden="true" />Interactive prototype · 0 credits</span>
                <button type="button" onClick={build}>{item.action}<ArrowRight aria-hidden="true" /></button>
              </div>
            </div>
          </section>
          <HandoffEvidence mode={mode} draft={draft} />
        </main>
      )}

      {stage === 'building' && <BuildProgress mode={mode} progressIndex={progressIndex} />}

      {stage === 'result' && (
        <ResultView
          mode={mode}
          draft={draft}
          resultHtml={resultHtml}
          sourceHtml={sourceHtml}
          compare={compare}
          setCompare={setCompare}
          onBack={() => setStage('input')}
          onOpenCanvas={openCanvas}
          opening={opening}
          openError={openError}
        />
      )}
    </div>
  );
}
