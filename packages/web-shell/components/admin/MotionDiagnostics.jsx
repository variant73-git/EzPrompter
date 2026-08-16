'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Download, SlidersHorizontal } from 'lucide-react';
import styles from './motion-diagnostics.module.css';

const VIEWS = [
  { id: 'coverage', label: 'Coverage' },
  { id: 'failures', label: 'Failures' },
  { id: 'smoke', label: 'Smoke tests' },
];

const EMPTY_FILTERS = {
  control: '',
  runtime: '',
  device: '',
  siteClass: '',
  appVersion: '',
  adapterVersion: '',
  validationStage: '',
  finalOutcome: '',
  origin: '',
};

function timeWindow(period) {
  const to = new Date();
  const hours = period === '24h' ? 24 : period === '30d' ? 30 * 24 : 7 * 24;
  return {
    from: new Date(to.getTime() - hours * 60 * 60 * 1000).toISOString(),
    to: to.toISOString(),
  };
}

function queryString(view, period, filters, extras = {}) {
  const params = new URLSearchParams({ view, ...timeWindow(period) });
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  Object.entries(extras).forEach(([key, value]) => params.set(key, value));
  return params.toString();
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function titleCase(value) {
  return String(value || 'unknown').replaceAll('_', ' ').replaceAll('-', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function rate(value, group) {
  const resolved = Number(group.supported || 0)
    + Number(group.recovered || 0)
    + Number(group.disabled || 0)
    + Number(group.failed || 0);
  return resolved > 0 ? `${Math.round((Number(value || 0) / resolved) * 100)}%` : '—';
}

function SkeletonRows() {
  return (
    <div className={styles.skeleton} aria-label="Loading diagnostics" aria-busy="true">
      {Array.from({ length: 5 }, (_, index) => <span key={index} />)}
    </div>
  );
}

export default function MotionDiagnostics() {
  const [view, setView] = useState('coverage');
  const [period, setPeriod] = useState('7d');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [data, setData] = useState(null);
  const [state, setState] = useState('loading');
  const [expandedEventId, setExpandedEventId] = useState(null);

  const query = useMemo(() => queryString(view, period, filters), [filters, period, view]);
  const exportBase = `/api/admin/motion-diagnostics?${query}`;

  useEffect(() => {
    const abort = new AbortController();
    setState('loading');
    fetch(`/api/admin/motion-diagnostics?${query}`, {
      credentials: 'include',
      cache: 'no-store',
      signal: abort.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error('request_failed');
      return response.json();
    }).then((body) => {
      setData(body);
      setState('ready');
    }).catch((error) => {
      if (error?.name !== 'AbortError') setState('error');
    });
    return () => abort.abort();
  }, [query]);

  function updateFilter(name, value) {
    setFilters((current) => ({ ...current, [name]: value }));
  }

  function moveTab(event, index) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? VIEWS.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + VIEWS.length) % VIEWS.length;
    const next = VIEWS[nextIndex];
    setView(next.id);
    globalThis.requestAnimationFrame?.(() => document.getElementById(`diagnostic-tab-${next.id}`)?.focus());
  }

  const summary = data?.summary || { total: 0, recovered: 0, disabled: 0, failed: 0 };
  const hasData = Number(summary.total) > 0;

  return (
    <section className={styles.workspace} aria-label="Motion diagnostic evidence">
      <div className={styles.controls}>
        <div className={styles.tabs} role="tablist" aria-label="Diagnostic view">
          {VIEWS.map((item, index) => (
            <button
              key={item.id}
              id={`diagnostic-tab-${item.id}`}
              type="button"
              role="tab"
              aria-selected={view === item.id}
              aria-controls="diagnostic-panel"
              tabIndex={view === item.id ? 0 : -1}
              className={view === item.id ? styles.activeTab : undefined}
              onClick={() => setView(item.id)}
              onKeyDown={(event) => moveTab(event, index)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className={styles.primaryFilters}>
          <label>
            <span>Time period</span>
            <select value={period} onChange={(event) => setPeriod(event.target.value)}>
              <option value="24h">Last 24 hours</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
            </select>
          </label>
          <label>
            <span>Device</span>
            <select value={filters.device} onChange={(event) => updateFilter('device', event.target.value)}>
              <option value="">All devices</option>
              <option value="desktop">Desktop</option>
              <option value="tablet">Tablet</option>
              <option value="mobile">Mobile</option>
            </select>
          </label>
          <label>
            <span>Outcome</span>
            <select value={filters.finalOutcome} onChange={(event) => updateFilter('finalOutcome', event.target.value)}>
              <option value="">All outcomes</option>
              <option value="supported">Supported</option>
              <option value="recovered">Recovered</option>
              <option value="disabled">Disabled</option>
              <option value="failed">Failed</option>
              <option value="restored">Snapshot restored</option>
            </select>
          </label>
          <div className={styles.exports}>
            <a href={`${exportBase}&format=csv`}><Download aria-hidden="true" />CSV</a>
            <a href={`${exportBase}&download=1`}><Download aria-hidden="true" />JSON</a>
          </div>
        </div>
        <details className={styles.moreFilters}>
          <summary><SlidersHorizontal aria-hidden="true" />More filters</summary>
          <div>
            <label><span>Control</span><input value={filters.control} onChange={(event) => updateFilter('control', event.target.value)} placeholder="Control ID" /></label>
            <label><span>Runtime</span><input value={filters.runtime} onChange={(event) => updateFilter('runtime', event.target.value)} placeholder="Runtime or engine" /></label>
            <label><span>Site or test class</span><input value={filters.siteClass} onChange={(event) => updateFilter('siteClass', event.target.value)} placeholder="Class" /></label>
            <label><span>Application version</span><input value={filters.appVersion} onChange={(event) => updateFilter('appVersion', event.target.value)} placeholder="Version" /></label>
            <label><span>Adapter version</span><input value={filters.adapterVersion} onChange={(event) => updateFilter('adapterVersion', event.target.value)} placeholder="Version" /></label>
            <label>
              <span>Validation stage</span>
              <select value={filters.validationStage} onChange={(event) => updateFilter('validationStage', event.target.value)}>
                <option value="">All stages</option>
                {['read', 'write', 'effect', 'safety', 'restore', 'repair', 'schema', 'runtime'].map((stage) => <option key={stage} value={stage}>{titleCase(stage)}</option>)}
              </select>
            </label>
            <label>
              <span>Origin</span>
              <select value={filters.origin} onChange={(event) => updateFilter('origin', event.target.value)}>
                <option value="">Smoke and production</option>
                <option value="production">Production</option>
                <option value="smoke">Smoke tests</option>
              </select>
            </label>
          </div>
        </details>
      </div>

      <div
        id="diagnostic-panel"
        role="tabpanel"
        aria-labelledby={`diagnostic-tab-${view}`}
        tabIndex={0}
      >
      <dl className={styles.summary}>
        <div><dt>Events</dt><dd>{summary.total}</dd></div>
        <div><dt>Recovered</dt><dd>{summary.recovered}</dd></div>
        <div><dt>Disabled</dt><dd>{summary.disabled}</dd></div>
        <div><dt>Unresolved</dt><dd>{summary.failed}</dd></div>
      </dl>

      {view === 'smoke' && <SmokeDecisionStatus summary={summary} />}

      {state === 'loading' && <SkeletonRows />}
      {state === 'error' && (
        <div className={styles.message} role="alert">
          <h2>Diagnostics are temporarily unavailable</h2>
          <p>Editing remains unaffected. Refresh this page to try the private report again.</p>
        </div>
      )}
      {state === 'ready' && !hasData && (
        <div className={styles.message}>
          <h2>No diagnostics in this period</h2>
          <p>Events will appear automatically when validation or recovery activity occurs.</p>
        </div>
      )}
      {state === 'ready' && hasData && (
        <>
          <section className={styles.groupSection} aria-labelledby="group-heading">
            <header><h2 id="group-heading">{VIEWS.find((item) => item.id === view)?.label}</h2><span>{data.groups.length} groups</span></header>
            <div className={styles.tableWrap}>
              <table>
                <thead><tr><th>{view === 'failures' ? 'Normalized cause' : 'Control'}</th><th>Events</th><th>Supported</th><th>Auto-repaired</th><th>Disabled</th></tr></thead>
                <tbody>
                  {data.groups.map((group) => (
                    <tr key={`${group.key}:${group.label}`}>
                      <th scope="row">{group.label}</th>
                      <td>{group.count}</td>
                      <td><MetricRate value={group.supported} group={group} /></td>
                      <td><MetricRate value={group.recovered} group={group} /></td>
                      <td><MetricRate value={group.disabled} group={group} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className={styles.eventSection} aria-labelledby="events-heading">
            <header><h2 id="events-heading">Recent evidence</h2><span>Sanitized event detail</span></header>
            <div className={styles.tableWrap}>
              <table>
                <thead><tr><th>Time</th><th>Event</th><th>Control</th><th>Context</th><th>Outcome</th><th><span className={styles.srOnly}>Navigation</span></th></tr></thead>
                <tbody>
                  {data.events.map((event) => (
                    <EventRows
                      key={event.id}
                      event={event}
                      expanded={expandedEventId === event.id}
                      onToggle={() => setExpandedEventId((current) => current === event.id ? null : event.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      </div>
    </section>
  );
}

function SmokeDecisionStatus({ summary }) {
  const total = Number(summary.total || 0);
  const disabled = Number(summary.disabled || 0);
  const disabledIncidence = total > 0 ? `${Math.round((disabled / total) * 100)}%` : 'Awaiting evidence';
  return (
    <section className={styles.smokeDecision} aria-labelledby="smoke-decision-heading">
      <div>
        <p>Evidence checkpoint</p>
        <h2 id="smoke-decision-heading">Presentation decision approved</h2>
        <span>Controls remain custom. Exhausted candidates remain visible but disabled, and no candidate has a common or global presentation.</span>
      </div>
      <dl>
        <div><dt>Observed disabled incidence</dt><dd>{disabledIncidence}</dd></div>
        <div><dt>Manual review</dt><dd>Approved</dd></div>
      </dl>
    </section>
  );
}

function MetricRate({ value, group }) {
  return <span className={styles.metricRate}>{rate(value, group)}<small>{Number(value || 0)} events</small></span>;
}

function EvidenceItem({ label, value }) {
  if (value == null || value === '' || (Array.isArray(value) && !value.length)) return null;
  return <div><dt>{label}</dt><dd>{Array.isArray(value) ? value.join(', ') : String(value)}</dd></div>;
}

function EventRows({ event, expanded, onToggle }) {
  return (
    <>
      <tr>
        <td><time dateTime={event.occurredAt}>{formatTime(event.occurredAt)}</time></td>
        <th scope="row"><code>{event.failureCode}</code><small>{titleCase(event.source)}</small></th>
        <td>{event.controlId || titleCase(event.controlKind)}</td>
        <td>{titleCase(event.device)}{event.validationStage && event.validationStage !== 'unknown' ? ` · ${titleCase(event.validationStage)}` : ''}</td>
        <td><span className={styles.outcome} data-outcome={event.finalOutcome}>{titleCase(event.finalOutcome)}</span></td>
        <td className={styles.eventActions}>
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Hide' : 'View'} details for ${event.failureCode}`}
            onClick={onToggle}
          >
            {expanded ? 'Hide details' : 'View details'}
          </button>
          {event.canOpenAffectedNode ? <a className={styles.openNode} href={event.affectedNodeHref}>Open affected node<ArrowUpRight aria-hidden="true" /></a> : <span className={styles.restricted}>Metadata only</span>}
        </td>
      </tr>
      {expanded && (
        <tr className={styles.evidenceRow}>
          <td colSpan={6}>
            <dl>
              <EvidenceItem label="Transition" value={event.transition} />
              <EvidenceItem label="Failure class" value={event.failureClass} />
              <EvidenceItem label="Operation" value={event.operation} />
              <EvidenceItem label="Attempt" value={event.attempt} />
              <EvidenceItem label="Control" value={event.controlId || event.controlKind} />
              <EvidenceItem label="Automatic steps" value={event.automaticSteps} />
              <EvidenceItem label="Runtime" value={event.runtimeFingerprint} />
              <EvidenceItem label="Bundle" value={event.bundleHashPrefix} />
              <EvidenceItem label="Stack group" value={event.stackFingerprint} />
              <EvidenceItem label="Aggregation group" value={event.aggregationFingerprint} />
              <EvidenceItem label="Engine" value={[event.engine, event.engineVersion].filter(Boolean).join(' ')} />
              <EvidenceItem label="Adapter" value={event.adapterVersion} />
              <EvidenceItem label="Application" value={event.appVersion || event.buildVersion} />
              <EvidenceItem label="Viewport" value={event.viewportWidth && event.viewportHeight ? `${event.viewportWidth} × ${event.viewportHeight}` : null} />
              <EvidenceItem label="Duration" value={event.durationMs == null ? null : `${event.durationMs} ms`} />
            </dl>
          </td>
        </tr>
      )}
    </>
  );
}
