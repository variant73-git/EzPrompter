'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, BookOpenCheck, LayoutGrid, ListChecks, Lock, Search, SlidersHorizontal, WandSparkles, X } from 'lucide-react';
import ReferencePlanner from './ReferencePlanner.jsx';
import ReferenceReviewPanel from './ReferenceReviewPanel.jsx';

const SOURCE_LABELS = {
  all: 'All sources',
  codrops: 'Codrops',
  landbook: 'Landbook',
  minimalgallery: 'Minimal Gallery',
  pafolios: 'Pafolios',
  siteofsites: 'Site of Sites',
  siteinspire: 'SiteInspire',
  'user-calibration': 'Taste calibration',
};

function ReferenceImage({ reference }) {
  const [failed, setFailed] = useState(false);
  if (!reference.thumbnailUrl || failed) {
    return <span className="ref-image-fallback" aria-hidden="true">{reference.host?.charAt(0)?.toUpperCase() || 'R'}</span>;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={reference.thumbnailUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

function isDecisivePreference(preference) {
  return ['keep', 'pass'].includes(preference?.decision);
}

export function ReferenceGridCard({ reference, reviewMode = false, selected = false, savingDecision = '', onReview, onQuickDecision }) {
  const primaryCategory = reference.categories?.[0] || 'Website';
  const preview = (
    <>
      <ReferenceImage reference={reference} />
      <span className="ref-card-source">{reference.sourceNames?.[0] || 'Curated'}</span>
      {reference.isPrivate && <span className="ref-card-private"><Lock aria-hidden="true" />Private</span>}
    </>
  );
  return (
    <article className={`ref-card${reviewMode ? ' ref-card-reviewable' : ''}${selected ? ' is-selected' : ''}`} id={reference.id}>
      {reviewMode && (
        <button
          type="button"
          className="ref-card-select"
          aria-label={`Review ${reference.title}`}
          aria-pressed={selected}
          onClick={() => onReview?.(reference)}
        />
      )}
      {reviewMode
        ? <div className="ref-card-preview">{preview}</div>
        : <a className="ref-card-preview" href={reference.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${reference.title}`}>{preview}</a>}
      <div className="ref-card-meta">
        <div>
          <h2>{reference.title}</h2>
          <p>{reference.host}</p>
        </div>
        <span>{primaryCategory}</span>
      </div>
      {reference.editorialConsensus > 1 && (
        <p className="ref-card-consensus">Found in {reference.editorialConsensus} curated sources</p>
      )}
      <div className="ref-card-actions">
        <a className="ref-card-visit" href={reference.url} target="_blank" rel="noopener noreferrer" aria-label={`Visit ${reference.title}`}>Visit<ArrowUpRight aria-hidden="true" /></a>
        {reviewMode && (
          <label className="ref-card-use">
            <span>Use</span>
            <span className="ref-switch">
              <input
                type="checkbox"
                role="switch"
                aria-label={`Use ${reference.title}`}
                checked={reference.preference?.decision === 'keep'}
                disabled={Boolean(savingDecision)}
                onChange={(event) => onQuickDecision?.(reference, event.target.checked ? 'keep' : 'pass')}
              />
              <i aria-hidden="true" />
            </span>
          </label>
        )}
      </div>
    </article>
  );
}

function ReferenceSkeletons() {
  return (
    <div className="ref-grid" aria-hidden="true">
      {Array.from({ length: 12 }, (_, index) => (
        <div className="ref-skeleton" key={index}><span /><i /><i /></div>
      ))}
    </div>
  );
}

export default function ReferenceLibrary({
  initialPage = { items: [], total: 0, hasMore: false, facets: { sources: [], categories: [] } },
  initialPlan = null,
  projects = [],
}) {
  const [items, setItems] = useState(initialPage.items || []);
  const [total, setTotal] = useState(initialPage.total || 0);
  const [hasMore, setHasMore] = useState(Boolean(initialPage.hasMore));
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('all');
  const [category, setCategory] = useState('all');
  const [sort, setSort] = useState('curated');
  const [view, setView] = useState('browse');
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [reviewStats, setReviewStats] = useState(initialPage.reviewStats || { total: 24, reviewed: 0, keep: 0, maybe: 0, pass: 0 });
  const [reviewCohort, setReviewCohort] = useState(initialPage.reviewCohort || { id: 'cohort_v1', name: 'Cohort v1', status: 'frozen', rubricVersion: 2 });
  const [selectedReference, setSelectedReference] = useState(null);
  const [canManagePrivateReferences, setCanManagePrivateReferences] = useState(Boolean(initialPage.canManagePrivateReferences));
  const [facets, setFacets] = useState(initialPage.facets || { sources: [], categories: [] });
  const [quickSaving, setQuickSaving] = useState('');
  const firstRun = useRef(true);

  const sourceOptions = useMemo(() => [
    { value: 'all', count: facets.all?.count ?? initialPage.total ?? 0, decided: facets.all?.decided || 0 },
    ...(facets.sources || []),
  ], [facets, initialPage.total]);
  const categoryOptions = useMemo(() => (facets.categories || []).slice(0, 36), [facets]);
  const filtersActive = Boolean(query || source !== 'all' || category !== 'all' || sort !== 'curated');

  async function loadPage({ append = false, signal } = {}) {
    append ? setLoadingMore(true) : setLoading(true);
    setError('');
    const params = new URLSearchParams({
      q: query,
      source,
      category,
      sort,
      view: ['review', 'curate'].includes(view) ? view : 'browse',
      offset: append ? String(items.length) : '0',
      limit: '48',
    });
    try {
      const response = await fetch(`/api/references?${params}`, { signal });
      if (!response.ok) throw new Error('Could not load the reference catalog.');
      const page = await response.json();
      setItems((current) => append ? [...current, ...page.items] : page.items);
      setTotal(page.total);
      setHasMore(page.hasMore);
      setReviewStats(page.reviewStats || reviewStats);
      setReviewCohort(page.reviewCohort || reviewCohort);
      setCanManagePrivateReferences(Boolean(page.canManagePrivateReferences));
      if (page.facets) setFacets(page.facets);
      if (['review', 'curate'].includes(view) && !append) {
        setSelectedReference((current) => page.items.find((item) => item.id === current?.id) || page.items[0] || null);
      }
    } catch (nextError) {
      if (nextError.name !== 'AbortError') setError(nextError.message);
    } finally {
      append ? setLoadingMore(false) : setLoading(false);
    }
  }

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return undefined;
    }
    if (view === 'plan') return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(() => loadPage({ signal: controller.signal }), 220);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
    // items is deliberately omitted: it is only an offset for explicit Load more.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, source, category, sort, view]);

  function clearFilters() {
    setQuery('');
    setSource('all');
    setCategory('all');
    setSort('curated');
  }

  function savePreference(referenceId, preference) {
    const reference = items.find((item) => item.id === referenceId) || selectedReference;
    const previous = reference?.preference;
    const decisiveDelta = Number(isDecisivePreference(preference)) - Number(isDecisivePreference(previous));
    const highQualityDelta = Number(isDecisivePreference(preference) && Number(preference.rating || 0) >= 4)
      - Number(isDecisivePreference(previous) && Number(previous?.rating || 0) >= 4);
    setItems((current) => current.map((item) => item.id === referenceId ? { ...item, preference } : item));
    setSelectedReference((current) => current?.id === referenceId ? { ...current, preference } : current);
    setReviewStats((current) => {
      const next = { ...current };
      next.reviewed = Math.max(0, Number(next.reviewed || 0) + decisiveDelta);
      if (previous?.decision) next[previous.decision] = Math.max(0, Number(next[previous.decision] || 0) - 1);
      next[preference.decision] = Number(next[preference.decision] || 0) + 1;
      next.highQuality = Math.max(0, Number(next.highQuality || 0) + highQualityDelta);
      return next;
    });
    if (decisiveDelta) {
      const sourceIds = new Set(reference?.sourceIds || []);
      setFacets((current) => ({
        ...current,
        all: { ...current.all, decided: Math.max(0, Number(current.all?.decided || 0) + decisiveDelta) },
        sources: (current.sources || []).map((item) => sourceIds.has(item.value)
          ? { ...item, decided: Math.max(0, Number(item.decided || 0) + decisiveDelta) }
          : item),
      }));
    }
  }

  async function quickSavePreference(reference, decision) {
    setQuickSaving(`${reference.id}:${decision}`);
    setError('');
    const current = reference.preference || {};
    try {
      const response = await fetch(`/api/references/${reference.id}/preference`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          decision,
          rating: current.rating ?? null,
          preferredRole: 'either',
          businessTags: current.businessTags || [],
          visualTags: current.visualTags || [],
          motionTags: current.motionTags || [],
          dimensionRatings: current.dimensionRatings || {},
          notes: current.notes || '',
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not save this review.');
      savePreference(reference.id, payload.preference);
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setQuickSaving('');
    }
  }

  function savePrivacy(referenceId, privacy) {
    setItems((current) => current.map((item) => item.id === referenceId ? { ...item, ...privacy } : item));
    setSelectedReference((current) => current?.id === referenceId ? { ...current, ...privacy } : current);
  }

  return (
    <section className="ref-library" aria-label="Reference catalog">
      <div className="ref-view-tabs" aria-label="Reference workspace">
        <button type="button" aria-pressed={view === 'browse'} onClick={() => setView('browse')}><LayoutGrid aria-hidden="true" />Browse</button>
        <button type="button" aria-pressed={view === 'review'} onClick={() => setView('review')}><BookOpenCheck aria-hidden="true" />Review queue<span>{reviewStats.reviewed}/{reviewStats.total}</span></button>
        {canManagePrivateReferences && <button type="button" aria-pressed={view === 'curate'} onClick={() => setView('curate')}><ListChecks aria-hidden="true" />Curate</button>}
        <button type="button" aria-pressed={view === 'plan'} onClick={() => setView('plan')}><WandSparkles aria-hidden="true" />Plan<span>chassis</span></button>
      </div>

      {view === 'plan' ? <ReferencePlanner reviewStats={reviewStats} initialRecord={initialPlan} projects={projects} /> : <>
      <div className="ref-toolbar">
        <label className="ref-search">
          <Search aria-hidden="true" />
          <span className="sr-only">Search references</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search sites, studios, categories…" />
          {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search"><X /></button>}
        </label>
        <label className="ref-select">
          <SlidersHorizontal aria-hidden="true" />
          <span className="sr-only">Category</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="all">All categories</option>
            {categoryOptions.map((item) => <option value={item.value} key={item.value}>{item.value} ({item.count})</option>)}
          </select>
        </label>
        <label className="ref-select ref-sort">
          <span className="sr-only">Sort references</span>
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="curated">Curated first</option>
            <option value="newest">Newest first</option>
            <option value="name">A to Z</option>
          </select>
        </label>
      </div>

      <div className="ref-source-row" aria-label="Filter by source">
        {sourceOptions.map((item) => (
          <button type="button" key={item.value} aria-pressed={source === item.value} onClick={() => setSource(item.value)}>
            {SOURCE_LABELS[item.value] || item.value}<span aria-label={`${item.count} total, ${item.decided || 0} decided`}>{item.count}/{item.decided || 0}</span>
          </button>
        ))}
      </div>

      <div className="ref-results-heading" aria-live="polite">
        <p>{loading ? 'Updating references…' : view === 'review' ? `${reviewStats.reviewed} of ${reviewStats.total} candidates decided` : view === 'curate' ? `${total.toLocaleString()} references available for internal curation` : `${total.toLocaleString()} ${total === 1 ? 'reference' : 'references'}`}</p>
        {view === 'review' && reviewCohort && <span className="ref-cohort-status"><Lock aria-hidden="true" />{reviewCohort.name} · {reviewCohort.status}</span>}
        {filtersActive && <button type="button" onClick={clearFilters}>Clear filters</button>}
      </div>

      {loading ? <ReferenceSkeletons /> : items.length ? (
        <div className={['review', 'curate'].includes(view) ? 'ref-review-layout' : undefined}>
          <div className="ref-grid">
            {items.map((reference) => <ReferenceGridCard
              reference={reference}
              reviewMode={['review', 'curate'].includes(view)}
              selected={(selectedReference || items[0])?.id === reference.id}
              savingDecision={quickSaving.startsWith(`${reference.id}:`) ? quickSaving.split(':')[1] : ''}
              onReview={setSelectedReference}
              onQuickDecision={quickSavePreference}
              key={reference.id}
            />)}
          </div>
          {['review', 'curate'].includes(view) && <ReferenceReviewPanel
            reference={selectedReference || items[0]}
            canManagePrivateReferences={canManagePrivateReferences}
            onSaved={savePreference}
            onPrivacyChanged={savePrivacy}
          />}
        </div>
      ) : (
        <div className="ref-empty">
          <Search aria-hidden="true" />
          <h2>No references match this view.</h2>
          <p>Try a broader term or clear one of the filters.</p>
          <button type="button" onClick={clearFilters}>Clear filters</button>
        </div>
      )}

      {error && <div className="ref-error" role="alert"><p>{error}</p><button type="button" onClick={() => loadPage()}>Try again</button></div>}
      {!loading && hasMore && !error && (
        <div className="ref-load-more">
          <button type="button" onClick={() => loadPage({ append: true })} disabled={loadingMore}>
            {loadingMore ? 'Loading more…' : `Show more (${Math.max(0, total - items.length).toLocaleString()} remaining)`}
          </button>
        </div>
      )}
      </>}
    </section>
  );
}
