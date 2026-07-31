'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, BookOpenCheck, LayoutGrid, Lock, Search, SlidersHorizontal, WandSparkles, X } from 'lucide-react';
import ReferencePlanner from './ReferencePlanner.jsx';
import ReferenceReviewPanel from './ReferenceReviewPanel.jsx';

const SOURCE_LABELS = {
  all: 'All sources',
  codrops: 'Codrops',
  pafolios: 'Pafolios',
  siteinspire: 'SiteInspire',
};

function ReferenceImage({ reference }) {
  const [failed, setFailed] = useState(false);
  if (!reference.thumbnailUrl || failed) {
    return <span className="ref-image-fallback" aria-hidden="true">{reference.host?.charAt(0)?.toUpperCase() || 'R'}</span>;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={reference.thumbnailUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

export function ReferenceGridCard({ reference, reviewMode = false, onReview }) {
  const primaryCategory = reference.categories?.[0] || 'Website';
  return (
    <article className="ref-card" id={reference.id}>
      <a className="ref-card-preview" href={reference.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${reference.title}`}>
        <ReferenceImage reference={reference} />
        <span className="ref-card-source">{reference.sourceNames?.[0] || 'Curated'}</span>
        <span className="ref-card-open" aria-hidden="true"><ArrowUpRight /></span>
      </a>
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
      {(reviewMode || reference.preference) && (
        <button type="button" className="ref-card-review" aria-label={`${reference.preference ? 'Edit review for' : 'Review'} ${reference.title}`} onClick={() => onReview?.(reference)}>
          <span data-decision={reference.preference?.decision || 'unreviewed'}>{reference.preference?.decision || 'unreviewed'}</span>
          {reference.preference?.rating && <b>{reference.preference.rating}/5</b>}
          {reference.preference ? 'Edit review' : 'Review'}
        </button>
      )}
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

export default function ReferenceLibrary({ initialPage = { items: [], total: 0, hasMore: false, facets: { sources: [], categories: [] } } }) {
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
  const firstRun = useRef(true);

  const sourceOptions = useMemo(() => [
    { value: 'all', count: initialPage.total || 0 },
    ...(initialPage.facets?.sources || []),
  ], [initialPage]);
  const categoryOptions = useMemo(() => (initialPage.facets?.categories || []).slice(0, 36), [initialPage]);
  const filtersActive = Boolean(query || source !== 'all' || category !== 'all' || sort !== 'curated');

  async function loadPage({ append = false, signal } = {}) {
    append ? setLoadingMore(true) : setLoading(true);
    setError('');
    const params = new URLSearchParams({
      q: query,
      source,
      category,
      sort,
      view: view === 'review' ? 'review' : 'browse',
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
      if (view === 'review' && !append) {
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
    const previous = items.find((item) => item.id === referenceId)?.preference;
    setItems((current) => current.map((item) => item.id === referenceId ? { ...item, preference } : item));
    setSelectedReference((current) => current?.id === referenceId ? { ...current, preference } : current);
    setReviewStats((current) => {
      const next = { ...current };
      if (!previous) next.reviewed += 1;
      if (previous?.decision) next[previous.decision] = Math.max(0, Number(next[previous.decision] || 0) - 1);
      next[preference.decision] = Number(next[preference.decision] || 0) + 1;
      if (Number(previous?.rating || 0) < 4 && Number(preference.rating || 0) >= 4) next.highQuality = Number(next.highQuality || 0) + 1;
      if (Number(previous?.rating || 0) >= 4 && Number(preference.rating || 0) < 4) next.highQuality = Math.max(0, Number(next.highQuality || 0) - 1);
      return next;
    });
  }

  return (
    <section className="ref-library" aria-label="Reference catalog">
      <div className="ref-view-tabs" aria-label="Reference workspace">
        <button type="button" aria-pressed={view === 'browse'} onClick={() => setView('browse')}><LayoutGrid aria-hidden="true" />Browse</button>
        <button type="button" aria-pressed={view === 'review'} onClick={() => setView('review')}><BookOpenCheck aria-hidden="true" />Review queue<span>{reviewStats.reviewed}/{reviewStats.total}</span></button>
        <button type="button" aria-pressed={view === 'plan'} onClick={() => setView('plan')}><WandSparkles aria-hidden="true" />Plan<span>shadow</span></button>
      </div>

      {view === 'plan' ? <ReferencePlanner reviewStats={reviewStats} /> : <>
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
            {SOURCE_LABELS[item.value] || item.value}<span>{item.count}</span>
          </button>
        ))}
      </div>

      <div className="ref-results-heading" aria-live="polite">
        <p>{loading ? 'Updating references…' : view === 'review' ? `${reviewStats.reviewed} of ${reviewStats.total} candidates reviewed${reviewStats.highQuality ? ` · ${reviewStats.highQuality} rated 4+` : ''}` : `${total.toLocaleString()} ${total === 1 ? 'reference' : 'references'}`}</p>
        {view === 'review' && reviewCohort && <span className="ref-cohort-status"><Lock aria-hidden="true" />{reviewCohort.name} · {reviewCohort.status}</span>}
        {filtersActive && <button type="button" onClick={clearFilters}>Clear filters</button>}
      </div>

      {loading ? <ReferenceSkeletons /> : items.length ? (
        <div className={view === 'review' ? 'ref-review-layout' : undefined}>
          <div className="ref-grid">
            {items.map((reference) => <ReferenceGridCard reference={reference} reviewMode={view === 'review'} onReview={setSelectedReference} key={reference.id} />)}
          </div>
          {view === 'review' && <ReferenceReviewPanel reference={selectedReference || items[0]} onSaved={savePreference} />}
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
