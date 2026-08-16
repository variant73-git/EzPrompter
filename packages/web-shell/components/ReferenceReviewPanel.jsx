'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Lock } from 'lucide-react';
import { REFERENCE_DIMENSIONS, REFERENCE_TAGS } from '../lib/reference-preferences.js';
import { getReferenceTagPreset } from '../lib/reference-design-taxonomy.js';

const EMPTY_DIMENSIONS = Object.fromEntries(Object.keys(REFERENCE_DIMENSIONS).map((key) => [key, null]));

const EMPTY = {
  decision: 'pass',
  rating: null,
  preferredRole: 'either',
  businessTags: [],
  visualTags: [],
  motionTags: [],
  dimensionRatings: EMPTY_DIMENSIONS,
  notes: '',
  worthBorrowing: '',
  avoid: '',
};

function draftForReference(reference) {
  const preset = getReferenceTagPreset(reference?.url || reference?.host);
  return reference?.preference ? {
    ...EMPTY,
    ...reference.preference,
    decision: reference.preference.decision === 'keep' ? 'keep' : 'pass',
    worthBorrowing: reference.preference.worthBorrowing || '',
    avoid: reference.preference.avoid || '',
    dimensionRatings: { ...EMPTY_DIMENSIONS, ...reference.preference.dimensionRatings },
  } : {
    ...EMPTY,
    businessTags: preset?.productTypes || [],
    dimensionRatings: { ...EMPTY_DIMENSIONS },
  };
}

function TagGroup({ label, values, selected, onChange, max = Infinity }) {
  function toggle(value) {
    if (!selected.includes(value) && selected.length >= max) return;
    onChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  }
  return (
    <fieldset className="ref-review-fieldset">
      <legend>{label}</legend>
      <div className="ref-review-tags">
        {values.map((value) => (
          <button type="button" key={value} aria-pressed={selected.includes(value)} disabled={!selected.includes(value) && selected.length >= max} onClick={() => toggle(value)}>{value}</button>
        ))}
      </div>
    </fieldset>
  );
}

export default function ReferenceReviewPanel({ reference, canManagePrivateReferences = false, onSaved, onPrivacyChanged }) {
  const [draft, setDraft] = useState(EMPTY);
  const [savedDraft, setSavedDraft] = useState(EMPTY);
  const [savedDecision, setSavedDecision] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [privacySaving, setPrivacySaving] = useState(false);
  const [privacyMessage, setPrivacyMessage] = useState('');
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(savedDraft), [draft, savedDraft]);

  useEffect(() => {
    const nextDraft = draftForReference(reference);
    setDraft(nextDraft);
    setSavedDraft(nextDraft);
    setSavedDecision(reference?.preference ? reference.preference.decision === 'keep' ? 'keep' : 'pass' : null);
    setMessage('');
    setPrivacyMessage('');
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
      const nextDraft = {
        ...EMPTY,
        ...payload.preference,
        decision: payload.preference.decision === 'keep' ? 'keep' : 'pass',
        dimensionRatings: { ...EMPTY_DIMENSIONS, ...payload.preference.dimensionRatings },
      };
      setDraft(nextDraft);
      setSavedDraft(nextDraft);
      setSavedDecision(payload.preference.decision);
      setMessage('');
      onSaved?.(reference.id, payload.preference);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function changePrivacy(isPrivate) {
    setPrivacySaving(true);
    setPrivacyMessage('');
    try {
      const response = await fetch(`/api/references/${reference.id}/privacy`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ isPrivate }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not update privacy.');
      onPrivacyChanged?.(reference.id, payload.privacy);
      setPrivacyMessage(isPrivate ? 'Hidden from customer catalog' : 'Visible in customer catalog');
    } catch (error) {
      setPrivacyMessage(error.message);
    } finally {
      setPrivacySaving(false);
    }
  }

  return (
    <aside className="ref-review-panel" aria-label={`Review ${reference.title}`}>
      <div className="ref-review-head">
        <div><span>Cohort rank {reference.cohortRank || reference.curationRank || ''}</span><h2>{reference.title}</h2><p>{reference.host}</p></div>
        <a href={reference.url} target="_blank" rel="noopener noreferrer">Visit<ArrowUpRight aria-hidden="true" /></a>
      </div>

      {canManagePrivateReferences && (
        <div className="ref-privacy-control">
          <div>
            <Lock aria-hidden="true" />
            <span>
              <strong>Private reference</strong>
              <small>{reference.templatePlatform ? `${reference.templatePlatform} template` : 'Internal curation only'}</small>
            </span>
          </div>
          <label className="ref-switch">
            <span className="sr-only">Private reference</span>
            <input
              type="checkbox"
              role="switch"
              checked={Boolean(reference.isPrivate)}
              disabled={privacySaving}
              onChange={(event) => changePrivacy(event.target.checked)}
            />
            <i aria-hidden="true" />
          </label>
          {privacyMessage && <small className="ref-privacy-message" role="status">{privacyMessage}</small>}
        </div>
      )}

      <div className="ref-review-use">
        <span>
          <strong>Use in plans</strong>
          <small>Include this reference in future chassis selection.</small>
        </span>
        <label className="ref-switch">
          <span className="sr-only">Use {reference.title}</span>
          <input
            type="checkbox"
            role="switch"
            checked={draft.decision === 'keep'}
            onChange={(event) => setDraft((current) => ({ ...current, decision: event.target.checked ? 'keep' : 'pass' }))}
          />
          <i aria-hidden="true" />
        </label>
      </div>

      <TagGroup label="Product / site type" values={REFERENCE_TAGS.product} selected={draft.businessTags} onChange={(businessTags) => setDraft((current) => ({ ...current, businessTags }))} />

      <label className="ref-review-notes">
        <span>Worth borrowing</span>
        <textarea value={draft.worthBorrowing} maxLength={1800} onChange={(event) => setDraft((current) => ({ ...current, worthBorrowing: event.target.value }))} placeholder="Text composition, section order, media placement, animation logic…" />
      </label>

      <label className="ref-review-notes">
        <span>Avoid</span>
        <textarea value={draft.avoid} maxLength={1800} onChange={(event) => setDraft((current) => ({ ...current, avoid: event.target.value }))} placeholder="A specific header, effect, section, transition…" />
      </label>
      <p className="ref-guidance-note">Used after this chassis is selected, never to rank it.</p>

      <div className="ref-review-actions">
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty}
          data-state={!dirty && ['keep', 'pass'].includes(savedDecision) ? savedDecision : dirty ? 'ready' : 'idle'}
        >
          {saving
            ? 'Saving…'
            : !dirty && savedDecision === 'keep'
              ? 'Included'
              : !dirty && savedDecision === 'pass'
                ? 'Excluded'
                : 'Save review'}
        </button>
        <span role="status">{message || null}</span>
      </div>
    </aside>
  );
}
