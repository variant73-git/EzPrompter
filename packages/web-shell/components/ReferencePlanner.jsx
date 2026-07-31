'use client';

import { useState } from 'react';
import { ArrowUpRight, Check, X } from 'lucide-react';

const SCORE_LABELS = {
  briefFit: 'Fit',
  manualQuality: 'Quality',
  compositionCompatibility: 'Compose',
  motion: 'Motion',
  transferability: 'Transfer',
  sourceConfidence: 'Source',
};

function errorCopy(error) {
  if (error === 'review_required') return 'Review and keep at least two references before asking for a composition.';
  if (error === 'donor_required') return 'Keep at least one reference that can act as a donor.';
  if (error === 'brief_too_short') return 'Add a little more business and audience context.';
  return 'The shadow plan could not be created.';
}

export default function ReferencePlanner({ reviewStats }) {
  const [brief, setBrief] = useState('');
  const [maxReferences, setMaxReferences] = useState(4);
  const [record, setRecord] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function createPlan(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setRecord(null);
    try {
      const response = await fetch('/api/references/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ brief, maxReferences }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'plan_failed');
      setRecord(payload);
    } catch (nextError) {
      setError(errorCopy(nextError.message));
    } finally {
      setBusy(false);
    }
  }

  async function reviewPlan(status) {
    const response = await fetch(`/api/references/plan/${record.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setError(errorCopy(payload.error));
      return;
    }
    setRecord((current) => ({ ...current, status: payload.plan.status }));
  }

  return (
    <div className="ref-planner">
      <form className="ref-planner-brief" onSubmit={createPlan}>
        <span>Shadow planner</span>
        <h2>Turn a brief into a composition recipe.</h2>
        <p>The planner ranks only references you reviewed. It does not generate a site or consume credits.</p>
        <label>
          <span>Website brief</span>
          <textarea value={brief} onChange={(event) => setBrief(event.target.value)} placeholder="A cinematic landing page for an industrial robotics company selling to operations leaders…" minLength={12} maxLength={6000} required />
        </label>
        <label className="ref-planner-count">
          <span>References in the recipe</span>
          <select value={maxReferences} onChange={(event) => setMaxReferences(Number(event.target.value))}>
            <option value="2">2 references</option>
            <option value="3">3 references</option>
            <option value="4">4 references</option>
          </select>
        </label>
        <div className="ref-planner-submit">
          <button type="submit" disabled={busy || brief.trim().length < 12}>{busy ? 'Planning…' : 'Build shadow plan'}</button>
          <small>{reviewStats?.keep || 0} kept · {reviewStats?.maybe || 0} possible</small>
        </div>
        {error && <p className="ref-planner-error" role="alert">{error}</p>}
      </form>

      <section className={`ref-plan-output${record ? ' ready' : ''}`} aria-live="polite">
        {!record ? (
          <div className="ref-plan-empty"><span>Recipe output</span><h2>One chassis. Bounded donors.</h2><p>Your reviewed taste becomes an inspectable plan before any generation happens.</p></div>
        ) : (
          <>
            <div className="ref-plan-head">
              <div>
                <span>Shadow recipe</span>
                <h2>{record.plan.rule}</h2>
                {record.plan.briefProfile?.weighting?.name && <p>{record.plan.briefProfile.weighting.name} weighting · source confidence capped at 5%</p>}
              </div>
              <b data-status={record.status}>{record.status}</b>
            </div>
            <ol className="ref-plan-refs">
              {record.plan.selectedReferences.map((reference) => (
                <li key={reference.id}>
                  <div><span>{reference.role} · {reference.score}/100</span><strong>{reference.title}</strong></div>
                  <p>{reference.owns}</p>
                  <small>{reference.reasons.join(' · ')}</small>
                  {reference.scoreBreakdown && (
                    <div className="ref-plan-score" aria-label={`Score breakdown for ${reference.title}`}>
                      {Object.entries(SCORE_LABELS).map(([key, label]) => <span key={key}><b>{reference.scoreBreakdown[key]}</b>{label}</span>)}
                    </div>
                  )}
                  <a href={reference.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${reference.title}`}><ArrowUpRight aria-hidden="true" /></a>
                </li>
              ))}
            </ol>
            <div className="ref-plan-contract">
              <div><span>Preserve</span>{record.plan.composition.preserve.map((item) => <p key={item}>{item}</p>)}</div>
              <div><span>Adapt</span>{record.plan.composition.adapt.map((item) => <p key={item}>{item}</p>)}</div>
              <div><span>Replace</span>{record.plan.composition.replace.map((item) => <p key={item}>{item}</p>)}</div>
            </div>
            {record.status === 'shadow' && (
              <div className="ref-plan-actions">
                <button type="button" onClick={() => reviewPlan('approved')}><Check aria-hidden="true" />Approve recipe</button>
                <button type="button" onClick={() => reviewPlan('rejected')}><X aria-hidden="true" />Reject</button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
