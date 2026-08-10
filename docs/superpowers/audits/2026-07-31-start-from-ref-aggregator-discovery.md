# Start from a Ref: nine-source read-only discovery

**Date:** 2026-07-31

**Branch:** `codex/start-from-ref`

**Status:** bounded two-source proof completed; shared import is not authorized

## Outcome

The bounded importer proof was executed with **Minimal Gallery** and **Site of Sites**.

- Minimal Gallery provides explicit WordPress pagination, stable detail pages, direct destination URLs, exact published dates, tags, and separate desktop/mobile source screenshots.
- Site of Sites provides a structurally different Wix collection that is best enumerated from its sitemap, with direct destinations, exact dates, and multiple screenshots on detail pages.
- The current listings already contain the same destination, `celticseasalt.com`, in both sources. The existing canonicalizer maps Minimal Gallery's referral URL and Site of Sites' clean URL to the same canonical key. The proof can therefore demonstrate a real cross-aggregator merge while retaining two appearances.

The proof passed its dry-run, determinism, isolated idempotency, test-suite, and production-build gates. Do not begin mass collection or shared import until the evidence below is reviewed.

## Existing duplicate behavior

The catalog already consolidated duplicate appearances before this proof. The versioned baseline contains 1,720 source appearances and 1,636 canonical references, a difference of 84. Fourteen canonical references are currently backed by more than one distinct aggregator and already retain those source badges/provenance records.

The new duplicate cases below are regression evidence for the two new adapters, not a new deduplication feature.

## Bounded proof result

### Collection and normalization

- Expected listing records: 46 Minimal Gallery and 36 Site of Sites, 82 total.
- Detail snapshots: 10 existing captures reused and 72 new captures fetched at a rate below the observed source limit.
- Accepted appearances: 46 Minimal Gallery and 35 Site of Sites, 81 total.
- Rejected records: one. `Verenika Perla` has no destination URL in either its listing card or public detail page, so the adapter refused to invent an identity.
- Canonical proof result: 81 appearances became 79 references.
- Cross-source duplicate groups: two — `celticseasalt.com` and `kommakomma.is`.
- Relative to the current catalog: 68 new canonical sites and 11 matches to canonical sites that already exist.
- `serotoninn.com` and `serotoninn.com/terms` remain separate and are emitted as a manual-review case because meaningful paths are intentionally preserved.

### Determinism

The normalized proof was built twice from the same ignored snapshots. Both runs produced identical hashes:

```text
seed SHA-256:   c30074562c6226ef251052f8a8d42ded52b78c7c1d1577322c4225b508b93778
report SHA-256: b367adb074b83d022eb315a9e7db8947f7917b107cddfaa6a185e58468761f75
```

The raw snapshots, normalized proof seed, and JSON proof report remain under ignored `.firecrawl/` paths. Only adapter code, tests, commands, and this evidence record are versioned.

### Isolated database evidence

Before the proof import, the isolated database contained 1,636 sites and 1,704 persisted appearances. The bounded combined seed was then imported twice with a command that refuses to run without `--isolated`.

Both imports returned the same counts:

```text
reference_sites: 1,704
reference_appearances: 1,785
proof source appearances: 81
proof canonical sites: 79
proof aggregators: 2
```

The proof importer does not read or write `reference_preferences`, `generation_reference_uses`, review cohorts, nodes, credits, or generation state. No shared database command was run.

### Verification

- Targeted reference suite: 5 files, 22 tests passed.
- Full web-shell suite: 134 files passed, 1 skipped; 947 tests passed, 4 skipped.
- Production build: Next.js 15.5.15 compiled successfully with 43 pages.
- The isolated importer rejected matching isolated/shared URLs before reading the seed or opening a database connection.
- Dry-run safety flags: no inferred ratings, no deep capture, and no generation.

## Method and boundaries

The discovery pass inspected, for each submitted source:

- the public listing page;
- one representative detail page;
- link, image, and metadata structure;
- URL-map or sitemap signals;
- visible pagination/resume signals;
- `robots.txt` where available;
- one additional pagination page for Awwwards, Landbook, and Minimal Gallery.

Fetched material is isolated under the ignored `.firecrawl/` directory and is not part of the versioned catalog. No authentication was used, no challenge was bypassed, no destination site was deeply captured, and neither `DATABASE_URL` nor `E2E_ISOLATED_DATABASE_URL` was used.

Counts below are observations from this pass, not durable source totals. Aggregators change independently of Uncraft.

## Inventory

| Source | Observed public structure | Destination and metadata depth | Enumeration and resume contract | Access or quality boundary | Recommendation |
| --- | --- | --- | --- | --- | --- |
| Awwwards Directory | The supplied URL is a directory of 1,966 professionals, not a website-award feed. The rendered page exposed roughly 27 non-social external profile/homepage destinations plus internal profiles and portfolio thumbnails. | Destination homepages are direct from the listing/profile. Profiles also mix agency identity with many client projects. Project years exist, but there is no clean per-profile reference freshness field. | Explicit `?page=N` links were observed and page 2 returned successfully. Filters are path based. | `robots.txt` disallows directory search-query routes. More importantly, the record semantics do not match a canonical website-reference appearance. | Defer. Decide separately whether agencies/professionals are a new entity lane. Do not import them as ordinary site references. |
| Landbook | The initial rendered listing exposed 100 unique `/websites/{id}-{slug}` details and signed CDN screenshots. Page 6 exposed 20 more detail records and a further load-more control. | Destinations are direct on the listing and detail page. Details add landing/type, style, industry, typography, and platform tags. No reliable per-item published date was visible. Templates, affiliate entries, and ordinary sites are mixed. | Public `?page=N`/load-more progression supports page checkpoints. Root rendering had already accumulated several page batches before pointing to page 6. | `robots.txt` disallows the API and filtered/sorted query variants, although plain page progression is not listed as disallowed. Signed thumbnail URLs and template/ad noise need explicit handling. | Next after the two-source proof. Crawl only the unfiltered page sequence and parse template/ad records separately. |
| Minimal Gallery | The archive exposes explicit `/websites/page/N/` links through page 129. The current page and page 2 each exposed 23 destination-like referral links in this snapshot. | Listing and detail both expose the final destination. Details add tags, credits, exact publication date, and separate desktop/mobile screenshots hosted by the source. | Deterministic numbered pages make checkpointing and bounded reruns straightforward. The sitemap also provides stable detail URLs, although the first 1,000 sitemap results were a capped observation rather than a total. | `robots.txt` only blocks WordPress administration. Source thumbnails must remain remote source URLs; no third-party asset redistribution. | **Proof source A.** Use two archive pages for the bounded proof. |
| Craftwork Curated Websites | The rendered listing exposed 60 internal detail records, 60 direct destination links, category routes, and 81 images. Detail pages expose the destination and a broad category. | Direct destination and source thumbnail are easy to extract, but published dates and richer per-record taxonomy were not visible. | No public next-page or load-more contract was found in the rendered page. The URL map mostly exposed category routes, so collection completeness is not yet auditable. | Public pages and general crawling are allowed by the observed robots rules; `/api/` is disallowed. Current collection boundary remains unknown. | Defer until a browser/network discovery identifies a permitted, resumable public enumeration path. |
| MaxiBestOf | The current feed exposed 32 numeric website details, rich category counts, font/section metadata, and a Nuxt application. It claims weekday updates. | Detail pages are rich, but the final destination is routed through `/go/{id}`. Full desktop capture is gated and some content is promotional. | No stable public page/cursor contract was visible in the rendered feed. | `robots.txt` explicitly disallows `/go/*` and `/api/`; following the redirect to manufacture canonical destination identity would violate the discovery contract. | Defer. Prefer an approved export/MCP or another documented destination field before adapting. |
| Recent | The listing exposed 40 `/i/{id}-{slug}` details and reported a four-week freshness marker in this snapshot. | Detail pages expose the direct destination plus exact relative freshness, category, style, interaction, framework, hosting, styling, and component metadata. | No pagination or complete sitemap enumeration was discovered from the public listing; the URL map returned only the listing. | General crawling is allowed, but several named AI/browser-rendering user agents are disallowed. Mass collection needs an explicit user-agent/terms decision and a resumable public listing contract. | High metadata value, but defer until collection completeness and crawler identity are resolved. |
| Site of Sites | The current listing exposed 36 detail records. A sitemap-only map contained 922 URLs, including 569 `/websites/` details at discovery time. | Listing and detail expose direct destinations. Details add exact dates and multiple desktop/mobile screenshots. Source category labels were not reliably exposed in semantic output. | Enumerate stable detail URLs from the sitemap; use the current listing only as the latest-sample lane. Store a manifest cursor/hash rather than inventing numbered pages. | General crawling is allowed by the observed robots rules; the source is Wix-based and its sitemap is the reliable public inventory boundary. | **Proof source B.** Use the current 36-item listing as the bounded sample and verify those identities against the sitemap. |
| Killer Portfolio | Static Astro listing with 23 `/by/{slug}` records on page 1, explicit `/showcase/page/2`, and at least 78 `/by/` details observed by URL mapping. | Detail pages provide direct destination, exact featured date, tags, and unusually useful editorial motion/interaction descriptions. Thumbnail extraction may need Astro `srcset` parsing. | Numbered pages and detail prev/next links are resumable. | `/robots.txt` returned the site's 404 page, so no robots policy was published at that path. Terms/rate policy still needs manual confirmation before bulk collection. | Strong third adapter after the proof, especially for the portfolio vertical and motion hints. |
| NicelyDone Apps | The listing exposed 36 app details and many categories; a capped map found 298 unique app URLs. A representative detail advertises 227 product screens, 61 marketing screens, and 911 components. | Detail metadata is rich, but later screenshots are blurred/subscription-gated and the final product destination uses `/apps/{slug}/visit`. No freshness field was visible. | No public pagination contract was visible. A sitemap exists, but destination resolution remains gated. | `robots.txt` disallows `/apps/*/visit` and several named bot user agents. Do not follow that route or treat paid screenshots as public catalog material. | Keep as a separate product-UI lane. Do not use in the landing-reference importer until identity, licensing, and access are separately approved. |

## Implemented bounded importer proof

### Source A: Minimal Gallery

1. Fetch only archive pages 1 and 2 and their listed detail pages.
2. Use the normalized detail path as `sourceRecordId`.
3. Extract title, final destination, detail URL, tags, exact published date, desktop thumbnail, and mobile thumbnail.
4. Strip referral parameters only through `canonicalizeReferenceUrl`; never rewrite the source appearance URL.
5. Persist the raw page snapshots/manifests separately from normalized output.

### Source B: Site of Sites

1. Fetch only the 36 records present in the current listing sample.
2. Verify every detail URL is present in the public sitemap inventory.
3. Use the normalized Wix detail path as `sourceRecordId`.
4. Extract title, final destination, listing/detail URL, exact date, and the primary remote source thumbnail. Keep additional screenshots in the raw manifest, not the v1 appearance row.
5. Leave source categories empty when they are not explicitly present; do not infer them from visuals or ordering.

### Required proof output

The implementation slice produced:

- raw and normalized counts per source;
- rejected-record counts with reasons;
- five canonicalization samples per source;
- a duplicate report within each source and across the two sources;
- explicit evidence that `https://celticseasalt.com/?ref=minimal.gallery` and `https://celticseasalt.com/` become one canonical site with two appearances;
- an explicit non-merge review item for `serotoninn.com` versus `serotoninn.com/terms`, because the current canonicalizer deliberately preserves meaningful paths;
- byte-identical normalized output on a second dry run;
- idempotent import evidence against the isolated database only;
- confirmation that no rating was inferred from source order, popularity, or awards;
- confirmation that no deep capture, generation, Demarcelizer call, or credit spend occurred.

## Exit gate

The bounded proof stops here. Mass collection, shared-database import, Cohort v2 creation, deep capture, and generation remain unapproved and were not run.
