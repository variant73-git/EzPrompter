'use client';

import { useMemo, useState } from 'react';
import { Check, Lock, Sparkles } from 'lucide-react';

const CONTRACT_VERSION = 2;
const AUTHORITY_OPTIONS = [
  { id: 'url', label: 'Public site' },
  { id: 'project', label: 'Existing project' },
  { id: 'provided', label: 'Provided sources' },
];

function draftFromContract(contract, projects) {
  const authority = contract?.target?.authority;
  const firstProject = projects[0];
  return {
    authorityType: authority?.type || 'url',
    brand: contract?.target?.brand || '',
    projectId: authority?.type === 'project' ? authority.id : firstProject?.id || '',
    url: authority?.type === 'url' ? authority.url : '',
    sourceLabel: authority?.type === 'provided' ? authority.label : '',
    intent: contract?.target?.intent || '',
    notes: contract?.target?.notes || '',
    strategySelections: contract?.strategy?.selected || {},
  };
}

function targetErrorCopy(code) {
  if (code === 'target_contract_stale' || code === 'target_contract_inputs_changed') return 'The source, strategy, or Manifest changed. Review the refreshed contract.';
  if (code === 'target_contract_blocked') return 'Resolve the evidence gaps before approving this contract.';
  if (code === 'target_project_not_found') return 'That project is no longer available to this account.';
  if (code === 'target_url_invalid' || code === 'invalid_reference_url') return 'Add a complete public target URL.';
  if (code === 'private_reference_url') return 'That URL is not publicly accessible.';
  if (code === 'target_brand_required') return 'The brand could not be inferred from this source. Add a brand override in Source details.';
  if (code === 'chassis_manifest_required') return 'Measure and keep the Chassis Manifest before reviewing the target.';
  return 'The target strategy could not be prepared.';
}

function approvalMatchesCurrentAuthority(contract, manifestHash, projects) {
  if (!contract || contract.schemaVersion !== CONTRACT_VERSION || contract.manifestHash !== manifestHash) return false;
  if (contract.target?.authority?.type !== 'project') return true;
  const project = projects.find((item) => String(item.id) === String(contract.target.authority.id));
  return Boolean(project) && (project.name || 'Untitled project').trim() === contract.target.authority.label;
}

function EvidenceSummary({ contract }) {
  const evidence = contract.targetEvidence;
  const readiness = contract.target.readiness;
  const checks = [
    ['Content', readiness.content, `${evidence.counts.visibleCharacters} visible characters`],
    ['Identity', readiness.designSystem, `${evidence.colors.length} colors · ${evidence.fonts.length} type families`],
    ['Media plan', readiness.media, contract.strategy.mediaPlan.label],
  ];
  return (
    <section className="ref-target-evidence" aria-labelledby="ref-target-evidence-title">
      <header>
        <div><span>Target evidence</span><strong id="ref-target-evidence-title">{evidence.title || contract.target.brand}</strong></div>
        <small>{evidence.sourceUrl}</small>
      </header>
      <div className="ref-target-evidence-status">
        {checks.map(([label, ready, detail]) => (
          <div key={label} data-ready={ready || undefined}>
            <i>{ready ? <Check aria-hidden="true" /> : '!'}</i>
            <span><strong>{label}</strong><small>{detail}</small></span>
          </div>
        ))}
      </div>
      {(evidence.colors.length > 0 || evidence.fonts.length > 0) && (
        <div className="ref-target-tokens">
          <div aria-label="Detected colors">{evidence.colors.map((color) => <i key={color} title={color} style={{ '--target-color': color }} />)}</div>
          <p>{evidence.fonts.length ? evidence.fonts.join(' · ') : 'No font family detected'}</p>
        </div>
      )}
    </section>
  );
}

function StrategyReview({ contract, busy, onChoose }) {
  const strategy = contract.strategy;
  return (
    <section className="ref-target-strategy" aria-labelledby="ref-target-strategy-title">
      <header>
        <div><span>Proposed direction</span><h3 id="ref-target-strategy-title">A strategy, not a questionnaire.</h3></div>
        <p>Recommendations are selected already. Change only the decisions that materially alter the outcome.</p>
      </header>

      <ol className="ref-target-why">
        {strategy.hypotheses.map((hypothesis, index) => (
          <li key={hypothesis.id}>
            <span>{String(index + 1).padStart(2, '0')}</span>
            <div><strong>{hypothesis.conclusion}</strong><p>{hypothesis.because.join(' ')}</p></div>
          </li>
        ))}
      </ol>

      <div className="ref-target-questions">
        {strategy.questions.map((question) => (
          <fieldset key={question.id} disabled={Boolean(busy)}>
            <legend>{question.label}</legend>
            <p>{question.why}</p>
            <div>
              {question.options.map((choice) => (
                <button
                  type="button"
                  key={choice.id}
                  aria-pressed={question.selected === choice.id}
                  onClick={() => onChoose(question.id, choice.id)}
                  title={choice.description}
                >
                  <strong>{choice.label}</strong>
                  <small>{choice.description}</small>
                </button>
              ))}
            </div>
          </fieldset>
        ))}
      </div>

      <dl className="ref-target-suggestions">
        {strategy.suggestions.map((suggestion) => (
          <div key={suggestion.id}>
            <dt>{suggestion.label}</dt>
            <dd><strong>{suggestion.proposal}</strong><small>{suggestion.because}</small></dd>
          </div>
        ))}
      </dl>
      <p className="ref-target-boundary">{strategy.referenceBoundary.rule}</p>
    </section>
  );
}

function ContractLedger({ contract }) {
  const directives = contract.blueprint?.directives || { preserve: [], adapt: [], replace: [] };
  return (
    <div className="ref-target-contract" aria-label="Target transfer contract">
      <div className="ref-target-contract-head">
        <div>
          <span>{contract.status === 'approved' ? 'Approved contract' : contract.approvable ? 'Ready for approval' : 'Approval blocked'}</span>
          <strong>{contract.target.brand}</strong>
          <small>{contract.target.authority.label}</small>
        </div>
        <code title={contract.hash}>{contract.hash.slice(0, 12)}</code>
      </div>

      {contract.gaps.length > 0 && (
        <div className="ref-target-gaps" role="status">
          <strong>{contract.gaps.length} {contract.gaps.length === 1 ? 'gap blocks' : 'gaps block'} approval</strong>
          {contract.gaps.map((gap) => <p key={gap.code}>{gap.label}</p>)}
        </div>
      )}

      <div className="ref-plan-contract ref-target-directives">
        <div><span>Preserve</span>{directives.preserve.map((item) => <p key={item}>{item}</p>)}</div>
        <div><span>Adapt</span>{directives.adapt.map((item) => <p key={item}>{item}</p>)}</div>
        <div><span>Replace</span>{directives.replace.map((item) => <p key={item}>{item}</p>)}</div>
      </div>

      <div className="ref-target-guidance">
        <div><span>Worth borrowing</span><p>{contract.guidance.worthBorrowing || 'No curator note recorded.'}</p></div>
        <div><span>Avoid</span><p>{contract.guidance.avoid || 'No exclusion note recorded.'}</p></div>
      </div>

      <div className="ref-target-ledger-head">
        <div><span>Section ledger</span><strong>{contract.summary.sections} sections</strong></div>
        <p>{contract.summary.mediaSlots} media slots · {contract.summary.motionTracks} motion tracks</p>
      </div>
      <ol className="ref-target-ledger">
        {contract.ledger.map((section) => {
          const portableMotion = section.motionPortability.filter((track) => track.portable).length;
          return (
            <li key={section.id}>
              <div className="ref-target-section-name"><span>{section.order}</span><strong>{section.role}</strong><small>{section.id}</small></div>
              <div><span>Text capacity</span><p>{section.capacity.headingCharacters} heading · {section.capacity.bodyCharacters} body</p><small>{section.capacity.visibleCharacters} visible characters</small></div>
              <div><span>Media bindings</span><p>{section.mediaBindings.length ? `${section.mediaBindings.length} planned ${section.mediaBindings.length === 1 ? 'slot' : 'slots'}` : 'No media slots'}</p>{section.mediaBindings.map((binding) => <small key={binding.id} data-ready={binding.status !== 'blocked' || undefined}>{binding.role} · {binding.status}</small>)}</div>
              <div><span>Motion portability</span><p>{section.motionPortability.length ? `${portableMotion}/${section.motionPortability.length} portable` : 'No observed tracks'}</p>{section.motionPortability.map((track) => <small key={track.id} data-ready={track.portable || undefined}>{track.driver} · {track.portable ? 'portable' : track.reason}</small>)}</div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default function ChassisTargetReview({ planId, manifestHash, initialContract = null, projects = [], onApproved }) {
  const initialApprovalCurrent = approvalMatchesCurrentAuthority(initialContract, manifestHash, projects);
  const [draft, setDraft] = useState(() => draftFromContract(initialApprovalCurrent ? initialContract : null, projects));
  const [contract, setContract] = useState(initialApprovalCurrent ? initialContract : null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(initialContract && !initialApprovalCurrent
    ? 'Saved approval uses an earlier target-contract version or no longer matches the current authority. Review a fresh strategy.'
    : '');

  const readyForPreview = useMemo(() => {
    if (!draft.intent.trim()) return false;
    if (draft.authorityType === 'project') return Boolean(draft.projectId);
    if (draft.authorityType === 'url') return Boolean(draft.url.trim());
    return Boolean(draft.sourceLabel.trim());
  }, [draft]);

  function updateDraft(patch) {
    if (contract?.status === 'approved') setNotice('Inputs changed. The previous approval no longer matches this strategy.');
    setDraft((current) => ({ ...current, ...patch }));
    setContract(null);
    setError('');
  }

  async function requestPreview(nextDraft) {
    setBusy('preview');
    setError('');
    setNotice('');
    try {
      const response = await fetch(`/api/references/plan/${planId}/contract/preview`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(nextDraft),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'target_contract_preview_failed');
      setContract(payload.contract);
      setDraft((current) => ({ ...current, brand: payload.contract.target.brand, strategySelections: payload.contract.strategy.selected }));
    } catch (nextError) {
      setError(targetErrorCopy(nextError.message));
    } finally {
      setBusy('');
    }
  }

  async function reviewContract(event) {
    event.preventDefault();
    await requestPreview(draft);
  }

  async function chooseStrategy(questionId, optionId) {
    const nextDraft = {
      ...draft,
      strategySelections: { ...draft.strategySelections, [questionId]: optionId },
    };
    setDraft(nextDraft);
    await requestPreview(nextDraft);
  }

  async function approveContract() {
    if (!contract?.approvable || contract.status === 'approved') return;
    setBusy('approve');
    setError('');
    try {
      const response = await fetch(`/api/references/plan/${planId}/contract`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target: draft, contractHash: contract.hash }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'target_contract_approval_failed');
      setContract(payload.contract);
      setNotice('The exact source, strategy, Manifest, and evidence hash are approved.');
      onApproved?.(payload.contract);
    } catch (nextError) {
      setError(targetErrorCopy(nextError.message));
    } finally {
      setBusy('');
    }
  }

  return (
    <section className="ref-target-review" aria-labelledby="ref-target-title">
      <header className="ref-target-titlebar">
        <div><span>Gate 5 · Direction</span><h2 id="ref-target-title">Start with the outcome, not a checklist.</h2></div>
        <p>A short prompt and a content source are enough. Uncraft proposes a strategy, explains why, and asks only about decisions that change the result.</p>
      </header>

      <form className="ref-target-form" onSubmit={reviewContract}>
        <label className="ref-target-intent"><span>What should improve?</span><textarea value={draft.intent} onChange={(event) => updateDraft({ intent: event.target.value })} placeholder="Make this old site feel current, social, and trustworthy." required /></label>
        <div className="ref-target-source-head">
          <span>Content authority</span>
          <small>The bank reference remains the visual chassis.</small>
        </div>
        <div className="ref-target-authority" aria-label="Content authority">
          {AUTHORITY_OPTIONS.map((authority) => <button key={authority.id} type="button" aria-pressed={draft.authorityType === authority.id} onClick={() => updateDraft({ authorityType: authority.id })}>{authority.label}</button>)}
        </div>
        <div className="ref-target-fields">
          {draft.authorityType === 'project' && <label><span>Existing project</span><select value={draft.projectId} onChange={(event) => updateDraft({ projectId: event.target.value })} required><option value="">Choose a project</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.name || 'Untitled'}</option>)}</select></label>}
          {draft.authorityType === 'url' && <label><span>Target site</span><input type="url" value={draft.url} onChange={(event) => updateDraft({ url: event.target.value })} placeholder="https://target.example" required /></label>}
          {draft.authorityType === 'provided' && <label><span>Provided source</span><input value={draft.sourceLabel} onChange={(event) => updateDraft({ sourceLabel: event.target.value })} placeholder="Approved copy and brand source" required /></label>}
        </div>
        <details className="ref-target-details">
          <summary>Source details</summary>
          <div>
            <label><span>Brand override <small>optional</small></span><input value={draft.brand} onChange={(event) => updateDraft({ brand: event.target.value })} placeholder="Detected automatically" /></label>
            <label><span>Additional constraints <small>optional</small></span><textarea value={draft.notes} onChange={(event) => updateDraft({ notes: event.target.value })} placeholder="Only add information that changes the direction." /></label>
          </div>
        </details>
        <div className="ref-target-form-action">
          <button type="submit" disabled={!readyForPreview || Boolean(busy)}>{busy === 'preview' ? 'Reading target…' : <><Sparkles aria-hidden="true" />Build proposed direction</>}</button>
          <small>Zero-write analysis. No generation or credits.</small>
        </div>
        {notice && <p className="ref-target-notice" role="status">{notice}</p>}
        {error && <p className="ref-planner-error" role="alert">{error}</p>}
      </form>

      {contract ? (
        <>
          <EvidenceSummary contract={contract} />
          <StrategyReview contract={contract} busy={busy} onChoose={chooseStrategy} />
          <ContractLedger contract={contract} />
          <footer className="ref-target-approval">
            <div><Lock aria-hidden="true" /><span><strong>Generation remains locked</strong><small>No model call, credit reservation, board, or node mutation is authorized here.</small></span></div>
            <button type="button" onClick={approveContract} disabled={!contract.approvable || contract.status === 'approved' || Boolean(busy)}>
              {contract.status === 'approved' ? <><Check aria-hidden="true" />Strategy approved</> : busy === 'approve' ? 'Approving exact hash…' : 'Approve strategy and contract'}
            </button>
          </footer>
        </>
      ) : <div className="ref-target-empty"><span>Proposed direction</span><p>Describe the outcome and point to the content authority. The visual reference remains the approved chassis from the bank.</p></div>}
    </section>
  );
}
