'use client';

import { useMemo, useState } from 'react';
import { ArrowUpRight, Check, ChevronLeft, ChevronRight, X } from 'lucide-react';
import ChassisTargetReview from './ChassisTargetReview.jsx';

const SCORE_LABELS = {
  typeFit: 'Type fit',
};

function errorCopy(error) {
  if (error === 'review_required') return 'Keep at least one reference before asking for a chassis.';
  if (error === 'brief_too_short') return 'Add a little more business and audience context.';
  if (error === 'invalid_reference_url') return 'Add a complete public website URL.';
  if (error === 'preview_stale') return 'The available options changed. Build a fresh preview before approving.';
  if (error === 'invalid_preview_selection') return 'Choose one of the displayed chassis options.';
  return 'The chassis preview could not be created.';
}

function ManifestSummary({ manifest }) {
  const sections = manifest.structure?.sections || [];
  const mediaCount = manifest.media?.slots?.length || 0;
  const motionCount = manifest.motion?.tracks?.length || 0;
  return (
    <section className="ref-manifest" aria-label="Chassis manifest">
      <div className="ref-manifest-head">
        <div><span>Chassis Manifest</span><strong>{manifest.evidence?.confidence || 'unknown'} confidence</strong></div>
        <code title={manifest.hash}>{String(manifest.hash || '').slice(0, 10)}</code>
      </div>
      <dl className="ref-manifest-metrics">
        <div><dt>Sections</dt><dd>{sections.length}</dd></div>
        <div><dt>Media slots</dt><dd>{mediaCount}</dd></div>
        <div><dt>Motion tracks</dt><dd>{motionCount}</dd></div>
        <div><dt>Responsive</dt><dd>{manifest.responsive?.compared ? `${manifest.responsive.score}/100` : 'Pending'}</dd></div>
      </dl>
      <div className="ref-manifest-order" aria-label="Section order">
        {sections.map((section, index) => <span key={section.id}>{index + 1}<b>{section.role}</b></span>)}
      </div>
      {manifest.evidence?.gaps?.length > 0 && <p className="ref-manifest-gaps">Evidence gaps: {manifest.evidence.gaps.join(' · ')}</p>}
      <p className="ref-manifest-lock">Structure is measured. Generation remains locked until the transplant contract is reviewed.</p>
    </section>
  );
}

function PlanContract({ composition }) {
  return (
    <div className="ref-plan-contract">
      <div><span>Preserve</span>{composition.preserve.map((item) => <p key={item}>{item}</p>)}</div>
      <div><span>Adapt</span>{composition.adapt.map((item) => <p key={item}>{item}</p>)}</div>
      <div><span>Replace</span>{composition.replace.map((item) => <p key={item}>{item}</p>)}</div>
    </div>
  );
}

function ApprovedReference({ reference }) {
  return (
    <ol className="ref-plan-refs">
      <li>
        <div><span>{reference.influence} · {reference.score}/100</span><strong>{reference.title}</strong></div>
        <p>{reference.owns}</p>
        <small>{reference.reasons.join(' · ')}</small>
        {reference.scoreBreakdown && (
          <div className="ref-plan-score" aria-label={`Score breakdown for ${reference.title}`}>
            {Object.entries(SCORE_LABELS).map(([key, label]) => <span key={key}><b>{reference.scoreBreakdown[key]}</b>{label}</span>)}
          </div>
        )}
        <a href={reference.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${reference.title}`}><ArrowUpRight aria-hidden="true" /></a>
      </li>
    </ol>
  );
}

function PreviewOptions({ preview, selectedReferenceId, onSelect, onPage, paging }) {
  const first = preview.optionOffset + 1;
  const last = preview.optionOffset + preview.options.length;
  return (
    <section className="ref-preview-options" aria-labelledby="ref-preview-title">
      <div className="ref-preview-options-head">
        <div>
          <strong id="ref-preview-title">Choose one chassis</strong>
          <span>{preview.totalOptions === 1 ? 'One type-fit option' : `${first}–${last} of ${preview.totalOptions} equally fitting options`}</span>
        </div>
        {(preview.hasPrevious || preview.hasMore) && (
          <div className="ref-preview-pager" aria-label="Chassis option pages">
            <button type="button" onClick={() => onPage(preview.optionOffset - preview.pageSize)} disabled={!preview.hasPrevious || paging} aria-label="Previous chassis options"><ChevronLeft aria-hidden="true" /></button>
            <button type="button" onClick={() => onPage(preview.optionOffset + preview.pageSize)} disabled={!preview.hasMore || paging} aria-label="More chassis options"><ChevronRight aria-hidden="true" /></button>
          </div>
        )}
      </div>
      <div className="ref-chassis-options" role="radiogroup" aria-label="Equal-fit chassis options" aria-busy={paging}>
        {preview.options.map((option) => {
          const selected = selectedReferenceId === option.id;
          const inputId = `chassis-option-${option.id}`;
          return (
            <article key={option.id} className="ref-chassis-option" data-selected={selected || undefined}>
              <div className="ref-chassis-thumb" aria-hidden="true">
                {option.thumbnailUrl ? <img src={option.thumbnailUrl} alt="" loading="lazy" /> : <span>{option.title.slice(0, 2).toUpperCase()}</span>}
              </div>
              <input id={inputId} type="radio" name="chassis-option" value={option.id} checked={selected} onChange={() => onSelect(option.id)} />
              <label htmlFor={inputId}>
                <span>{option.score}/100 type fit</span>
                <strong>{option.title}</strong>
                <small>{option.reasons.join(' · ')}</small>
                {option.sourceNames.length > 0 && <em>{option.sourceNames.join(' · ')}</em>}
              </label>
              {selected && <Check className="ref-chassis-selected" aria-hidden="true" />}
              <a href={option.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${option.title}`}><ArrowUpRight aria-hidden="true" /></a>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export default function ReferencePlanner({ reviewStats, initialRecord = null, projects = [] }) {
  const [brief, setBrief] = useState(initialRecord?.brief || '');
  const [sourceMode, setSourceMode] = useState('keeps');
  const [referenceUrl, setReferenceUrl] = useState('');
  const [preview, setPreview] = useState(null);
  const [selectedReferenceId, setSelectedReferenceId] = useState('');
  const [record, setRecord] = useState(initialRecord);
  const [busy, setBusy] = useState(false);
  const [paging, setPaging] = useState(false);
  const [approving, setApproving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState('');
  const [error, setError] = useState('');

  const selectedOption = useMemo(
    () => preview?.options.find((option) => option.id === selectedReferenceId) || null,
    [preview, selectedReferenceId],
  );

  function invalidateOutput() {
    setPreview(null);
    setSelectedReferenceId('');
    setRecord(null);
    setError('');
    setAnalysisError('');
  }

  function changeSourceMode(nextMode) {
    setSourceMode(nextMode);
    invalidateOutput();
  }

  async function requestPreview(optionOffset = 0, isPaging = false) {
    if (isPaging) setPaging(true);
    else setBusy(true);
    setError('');
    if (!isPaging) {
      setPreview(null);
      setSelectedReferenceId('');
      setRecord(null);
    }
    try {
      const response = await fetch('/api/references/plan/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ brief, optionOffset, ...(sourceMode === 'url' ? { referenceUrl } : {}) }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'preview_failed');
      setPreview(payload.preview);
      setSelectedReferenceId(payload.preview.totalOptions === 1 ? payload.preview.options[0].id : '');
    } catch (nextError) {
      setError(errorCopy(nextError.message));
    } finally {
      setBusy(false);
      setPaging(false);
    }
  }

  async function createPreview(event) {
    event.preventDefault();
    await requestPreview(0);
  }

  async function approvePreview() {
    if (!preview || !selectedReferenceId) return;
    setApproving(true);
    setError('');
    try {
      const response = await fetch('/api/references/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          brief,
          selectedReferenceId,
          previewHash: preview.previewHash,
          optionOffset: preview.optionOffset,
          ...(sourceMode === 'url' ? { referenceUrl } : {}),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'approval_failed');
      setRecord(payload);
      setPreview(null);
      setSelectedReferenceId('');
    } catch (nextError) {
      setError(errorCopy(nextError.message));
    } finally {
      setApproving(false);
    }
  }

  function discardPreview() {
    setPreview(null);
    setSelectedReferenceId('');
    setError('');
  }

  async function analyzePlan() {
    setAnalyzing(true);
    setAnalysisError('');
    try {
      const response = await fetch(`/api/references/plan/${record.id}/analyze`, { method: 'POST' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'analysis_failed');
      setRecord((current) => ({ ...current, plan: { ...current.plan, chassisManifest: payload.manifest } }));
    } catch (nextError) {
      setAnalysisError(nextError.message === 'plan_approval_required' ? 'Approve the recipe before measuring its structure.' : 'The structural capture failed. The plan was not changed.');
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className="ref-planner">
      <form className="ref-planner-brief" onSubmit={createPreview}>
        <span>Chassis planner</span>
        <h2>Find one chassis for the brief.</h2>
        <p>Preview your strongest type matches, choose one, then save the recipe. Previewing does not generate a site or consume credits.</p>
        <div className="ref-planner-source" aria-label="Chassis source">
          <button type="button" aria-pressed={sourceMode === 'keeps'} onClick={() => changeSourceMode('keeps')}>Curated keeps</button>
          <button type="button" aria-pressed={sourceMode === 'url'} onClick={() => changeSourceMode('url')}>Direct URL</button>
        </div>
        {sourceMode === 'url' && <label>
          <span>Reference URL</span>
          <input type="url" value={referenceUrl} onChange={(event) => { setReferenceUrl(event.target.value); invalidateOutput(); }} placeholder="https://reference.example" required />
        </label>}
        <label>
          <span>Website brief</span>
          <textarea value={brief} onChange={(event) => { setBrief(event.target.value); invalidateOutput(); }} placeholder="A cinematic landing page for an industrial robotics company selling to operations leaders…" minLength={12} maxLength={6000} required />
        </label>
        <div className="ref-planner-submit">
          <button type="submit" disabled={busy || brief.trim().length < 12 || (sourceMode === 'url' && !referenceUrl.trim())}>{busy ? 'Building preview…' : 'Build chassis preview'}</button>
          <small>{sourceMode === 'url' ? 'No curation required' : `${reviewStats?.keep || 0} kept chassis available`}</small>
        </div>
        {error && <p className="ref-planner-error" role="alert">{error}</p>}
      </form>

      <section className={`ref-plan-output${preview || record ? ' ready' : ''}`} aria-live="polite">
        {!preview && !record ? (
          <div className="ref-plan-empty"><span>Chassis preview</span><h2>One structural spine.</h2><p>Compare equal-fit options before anything is saved.</p></div>
        ) : preview ? (
          <>
            <div className="ref-plan-head">
              <div>
                <span>Chassis preview</span>
                <h2>{preview.rule}</h2>
                <p>single chassis · {preview.scoringBasis === 'direct-reference' ? 'direct reference' : 'site type only'}</p>
              </div>
              <b data-status="preview">Not saved</b>
            </div>
            {preview.warnings.length > 0 && <div className="ref-preview-warning" role="status">{preview.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}
            <PreviewOptions preview={preview} selectedReferenceId={selectedReferenceId} onSelect={setSelectedReferenceId} onPage={(offset) => requestPreview(offset, true)} paging={paging} />
            {selectedOption && <PlanContract composition={selectedOption.composition} />}
            <div className="ref-plan-actions ref-preview-actions">
              <button type="button" onClick={approvePreview} disabled={!selectedOption || approving}>{approving ? 'Approving…' : <><Check aria-hidden="true" />Approve recipe</>}</button>
              <button type="button" onClick={discardPreview}><X aria-hidden="true" />Discard preview</button>
              <small>Nothing is saved until approval.</small>
            </div>
          </>
        ) : (
          <>
            <div className="ref-plan-head">
              <div>
                <span>Chassis recipe</span>
                <h2>{record.plan.rule}</h2>
                <p>single chassis · {record.plan.scoringBasis === 'direct-reference' ? 'direct reference' : 'site type only'}</p>
              </div>
              <b data-status={record.status}>{record.status}</b>
            </div>
            <ApprovedReference reference={record.plan.selectedReferences[0]} />
            <PlanContract composition={record.plan.composition} />
            {record.plan.chassisManifest && <ManifestSummary manifest={record.plan.chassisManifest} />}
            {record.status === 'approved' && !record.plan.chassisManifest && (
              <div className="ref-analysis-action">
                <div><strong>Measure the chassis</strong><span>Free runtime capture at desktop and mobile. No generation or credits.</span></div>
                <button type="button" onClick={analyzePlan} disabled={analyzing}>{analyzing ? 'Measuring…' : 'Analyze structure'}</button>
              </div>
            )}
            {analysisError && <p className="ref-planner-error ref-analysis-error" role="alert">{analysisError}</p>}
          </>
        )}
      </section>
      {record?.status === 'approved' && record.plan?.chassisManifest && (
        <ChassisTargetReview
          key={record.id}
          planId={record.id}
          manifestHash={record.plan.chassisManifest.hash}
          initialContract={record.plan.chassisTargetContract || null}
          projects={projects}
          onApproved={(contract) => setRecord((current) => ({ ...current, plan: { ...current.plan, chassisTargetContract: contract } }))}
        />
      )}
    </div>
  );
}
