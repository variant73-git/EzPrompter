'use client';

import { useEffect, useState } from 'react';
import { ArrowUpRight, Check } from 'lucide-react';
import { REFERENCE_TAGS } from '../lib/reference-preferences.js';

const EMPTY = {
  decision: 'maybe',
  rating: null,
  preferredRole: 'either',
  businessTags: [],
  visualTags: [],
  motionTags: [],
  notes: '',
};

function TagGroup({ label, values, selected, onChange }) {
  function toggle(value) {
    onChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  }
  return (
    <fieldset className="ref-review-fieldset">
      <legend>{label}</legend>
      <div className="ref-review-tags">
        {values.map((value) => (
          <button type="button" key={value} aria-pressed={selected.includes(value)} onClick={() => toggle(value)}>{value}</button>
        ))}
      </div>
    </fieldset>
  );
}

export default function ReferenceReviewPanel({ reference, onSaved }) {
  const [draft, setDraft] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setDraft(reference?.preference ? { ...EMPTY, ...reference.preference } : EMPTY);
    setMessage('');
  }, [reference]);

  if (!reference) {
    return (
      <aside className="ref-review-panel ref-review-panel-empty">
        <span>Review queue</span>
        <h2>Select a reference</h2>
        <p>Compare the live site, then record what it should contribute to a future composition.</p>
      </aside>
    );
  }

  async function save() {
    setSaving(true);
    setMessage('');
    try {
      const response = await fetch(`/api/references/${reference.id}/preference`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not save this review.');
      setDraft({ ...EMPTY, ...payload.preference });
      setMessage('Review saved');
      onSaved?.(reference.id, payload.preference);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <aside className="ref-review-panel" aria-label={`Review ${reference.title}`}>
      <div className="ref-review-head">
        <div><span>Candidate {reference.curationRank || ''}</span><h2>{reference.title}</h2><p>{reference.host}</p></div>
        <a href={reference.url} target="_blank" rel="noopener noreferrer">Visit<ArrowUpRight aria-hidden="true" /></a>
      </div>

      <fieldset className="ref-review-fieldset">
        <legend>Verdict</legend>
        <div className="ref-segmented">
          {['keep', 'maybe', 'pass'].map((value) => (
            <button type="button" key={value} aria-pressed={draft.decision === value} onClick={() => setDraft((current) => ({ ...current, decision: value }))}>{value}</button>
          ))}
        </div>
      </fieldset>

      <fieldset className="ref-review-fieldset">
        <legend>Taste score</legend>
        <div className="ref-rating" aria-label="Taste score from 1 to 5">
          {[1, 2, 3, 4, 5].map((value) => (
            <button type="button" key={value} aria-pressed={draft.rating === value} onClick={() => setDraft((current) => ({ ...current, rating: value }))}>{value}</button>
          ))}
        </div>
      </fieldset>

      <fieldset className="ref-review-fieldset">
        <legend>Best role</legend>
        <div className="ref-segmented">
          {['chassis', 'donor', 'either'].map((value) => (
            <button type="button" key={value} aria-pressed={draft.preferredRole === value} onClick={() => setDraft((current) => ({ ...current, preferredRole: value }))}>{value}</button>
          ))}
        </div>
      </fieldset>

      <TagGroup label="Business fit" values={REFERENCE_TAGS.business} selected={draft.businessTags} onChange={(businessTags) => setDraft((current) => ({ ...current, businessTags }))} />
      <TagGroup label="Visual traits" values={REFERENCE_TAGS.visual} selected={draft.visualTags} onChange={(visualTags) => setDraft((current) => ({ ...current, visualTags }))} />
      <TagGroup label="Motion" values={REFERENCE_TAGS.motion} selected={draft.motionTags} onChange={(motionTags) => setDraft((current) => ({ ...current, motionTags }))} />

      <label className="ref-review-notes">
        <span>What is worth borrowing?</span>
        <textarea value={draft.notes} maxLength={4000} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Pinning, hero geometry, media treatment, typography…" />
      </label>

      <div className="ref-review-actions">
        <button type="button" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save review'}</button>
        <span role="status">{message && <><Check aria-hidden="true" />{message}</>}</span>
      </div>
    </aside>
  );
}
