# Handoff: Start from a Ref initial catalog slice

## Completed

- Created `/Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref` on `codex/start-from-ref`, based on `main` commit `ec297fff`.
- Left `/Users/adilsonporto/Desktop/IA/Uncraft` and `codex/live-animated-clone-editing` untouched.
- Added source adapters, canonical URL normalization, deduplication, source provenance, seed generation, server-side querying, authenticated API pagination, and the `Start from a Ref` UI.
- Collected a resumable initial batch from all three requested aggregators.
- Current seed: 1,720 source appearances, 1,636 canonical references, 84 merges.
- Added unit/component coverage for adapters, deduplication, querying, provenance, filters, and external links.
- Verified desktop and 390×844 layouts in the authenticated local app at port 3034. Search returned one correct `Bruno Simon` result. No browser console warnings/errors were present.
- Full web-shell suite passed: 129 files / 929 tests, with 1 file / 4 tests skipped as already configured.
- Production build passed all 42 pages and includes `/api/references`.

## Intentionally not done

- No production/shared database migration was applied.
- No scheduled/background crawling was enabled.
- Codrops pagination stopped at the source plan's request-rate ceiling; completed pages are retained and the generator resumes from additional files without duplication.
- SiteInspire deeper pagination and per-detail category enrichment remain incomplete.
- References have not yet been runtime-captured, section-segmented, visually embedded, motion-profiled, or quality-rated.
- The model does not yet select references from a prompt or generate a mixed landing page.
- The uncommitted Demarcelizer-4 changes were inspected but not copied.

## Resume here

1. Review the architecture in `docs/superpowers/specs/2026-07-31-start-from-ref-reference-bank.md`.
2. Decide and approve the persistent schema plus thumbnail/asset retention policy.
3. Finish resumable source pagination with source-specific rate limits and health checks.
4. Enrich a manually approved top subset before enriching the whole catalog.
5. Build retrieval shadow mode: brief in, chassis + donors + reasoned composition plan out, no generation yet.
6. Integrate the isolated Demarcelizer 4.0 transfer contracts only after that worktree has a clean owned commit.

## Local verification

```bash
cd /Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref/packages/web-shell
bun run test
bun run build
```

The local catalog server used port 3034 with `NEXT_DIST_DIR=.next-ref` so it could coexist with other Uncraft servers.
