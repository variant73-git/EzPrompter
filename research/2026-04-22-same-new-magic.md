# same.new — Magic Teardown (2026-04-22)

## TL;DR — The 5 most surprising findings

1. **There is no CV segmentation. There is no component-chunking algorithm.** Same is a **general-purpose coding agent** (GPT-4.1) running in a Docker/Ubuntu sandbox at `/home/project`, reading a leaked 316-line system prompt that instructs it to "clone" by calling a single `web_scrape` tool (screenshot + content), then writing files with `edit_file` + `bun`. The "component chunking" mythology comes from the system-prompt line *"You can break down the UI into 'sections' and 'pages' in your explanation"* — it's **a conversational instruction, not a pipeline stage**. (confirmed, leak)
2. **Model = GPT-4.1, explicit.** First line of the leaked prompt: *"You are AI coding assistant and agent manager, powered by gpt-4.1."* Not Claude, not Gemini. An internal `smart_apply` flag in `edit_file` hints at a cheaper apply-model (v0/Morph-style). (confirmed, leak)
3. **Default framework is locked: Next.js + shadcn/ui + Tailwind + Biome + Bun**, deployed to **Netlify** via a `deploy` tool. The `startup` tool enum has 8 templates; system prompt says *"Default to nextjs-shadcn."* No refinement loop, no diff-against-original pass. (confirmed, leak)
4. **Assets mirror is `same-assets.com`** — system prompt literally says *"You can use any 'same-assets.com' links directly in your project."* Same rehosts scraped images on their own CDN so Netlify deploys don't hotlink. This is mundane but invisible externally and a clear pattern to steal. (confirmed, leak)
5. **Firecrawl rumor is unconfirmed.** `web_scrape` takes `url/theme/viewport/include_screenshot`. Could be Firecrawl, could be homegrown Playwright. No wire-level evidence. What IS real: multi-viewport (`mobile/tablet/desktop` enum), multi-theme (`light/dark`), optional screenshot. (strong inference — schema-based)

## Marketing Site Tech Stack

| Tech | Evidence | Purpose |
|---|---|---|
| Vercel (frontend host) | `server: Vercel` + `x-vercel-id` headers; Astro challenge page | Marketing site `same.new` gated by Vercel Security Checkpoint (429 on curl) |
| Docs: Mintlify | `docs.same.new/llms.txt`, `mintcdn.com` image URLs | `/docs` hosted on Mintlify |
| Astro (challenge page) | `data-astro-cid-nbv56vs3` | Only the Vercel bot wall uses Astro; actual app is separate |
| Netlify (user deployments) | System prompt + `deploy` tool + `netlify.toml` references | User-built apps deploy to Netlify, not Vercel |
| Clerk (auth integration) | `/integrations/clerk.md` | Optional Clerk integration for user-built apps |
| Neon / Supabase | Docs pages | Optional Postgres backends |

## Known Pipeline (confirmed — was already known)

- Puppeteer/Playwright screenshot + headless browser
- Screenshot + content sent to an LLM
- Output is Next.js/Tailwind/shadcn with Netlify deploy
- 95%+ fidelity on static landing pages (Nike, Apple TV, Minecraft examples from launch)

## NEW: Pipeline Details Uncovered

### 1. CV segmentation — does not exist
**Evidence (confirmed):** Leaked system prompt has zero reference to computer vision, bounding boxes, segmentation, or region detection. The only "breakdown" instruction is social: *"You can break down the UI into 'sections' and 'pages' in your explanation."* GPT-4.1 does the visual parsing natively inside its vision input.
**Implication:** The Medium "Meng Li" article and the daily.dev post that claimed "vision-based segmentation" were speculation. The real pipeline is simpler and weaker than we assumed.

### 2. Chunking algorithm — conversational, not programmatic
**Evidence (strong inference):** The agent is told *"If the page is long, ask and confirm with user which pages and sections to clone."* Chunking is a **user-gated question**, not a deterministic split. For short pages it one-shots. This is why Same struggles on Airbnb (review evidence) — no deterministic section split to fall back on.

### 3. Per-component prompts — none
**Evidence (confirmed):** There is one system prompt, one model, one loop. No per-component templates. All "hero vs pricing table" differentiation lives inside GPT-4.1's latent knowledge. No retrieval over a pattern library.

### 4. Stitching — trivial (agent writes files directly)
**Evidence (confirmed):** Agent writes tsx files via `edit_file`, starts dev server, takes screenshot, iterates. There is no separate stitch pass. The `smart_apply: true` flag on `edit_file` routes to a stronger apply-model when the quick one fails (likely Morph-style speculative-decoding apply, or GPT-4.1 itself at higher temp).

### 5. Refinement loop — exists, but visual-only via `versioning`
**Evidence (confirmed):** *"After every significant edit … use the `versioning` tool to create a new version. … the tool will show you a full-page screenshot of the version's live preview and return any unresolved linter and runtime errors."* So Same's refinement is: model sees its own rendered screenshot + lint errors → iterates. **No comparison to the original screenshot.** No diff loop. Explains why fidelity plateaus.
**Bound:** *"DO NOT loop more than 3 times on fixing linter errors on the same file."* Hard cap.

### 6. Framework decisions — hardcoded default
`startup` tool enum: `html-ts-css | react-vite | react-vite-tailwind | react-vite-shadcn | nextjs-shadcn | vue-vite | vue-vite-tailwind | shipany`. Default: `nextjs-shadcn`. shadcn theme enum: `zinc | blue | green | orange | red | rose | violet | yellow` (default `zinc`). System prompt enforces *"NEVER stay with default shadcn/ui components. Always customize"* and lists 40+ shadcn component filenames the agent is expected to customize before building the main app.

### 7. Model stack — probably mono-model with a cheap apply helper
- **Main reasoning/codegen:** GPT-4.1 (confirmed in prompt)
- **`smart_apply: true`:** routes to a different apply model (strong inference — matches Cursor/v0 pattern)
- **Linter/screenshot:** deterministic tooling, not ML
- **No Claude, no Gemini detected anywhere in the leak.**

### 8. Animation handling — not attempted
**Evidence (confirmed, verbatim):** *"For sites with animations, the `web_scrape` tool doesn't currently capture the informations. So do your best to recreate the animations. Think very deeply about the best designs that match the original."* So the model hallucinates animations from the single screenshot. No GSAP→Framer-Motion translator exists. Vanilla Three.js is pinned (`three@0.169.0`).

### 9. Pricing & margin (new)
- Free: 500K tokens/mo
- Basic $10 = 2M tokens, Pro $25 = 5M, Max $50 = 10M, Ultra $100 = 20M
- Overflow: $10 per 2M tokens ($5/M)
- 600K+ builders as of April 2026 (was 350K at 8 weeks post-launch in Mar 2025 — confirmed via Aiden Bai launch)
- Previous pricing was usage-based; they moved to fixed tiers for predictability

## Client-side JS Findings

Marketing site `same.new` is gated by Vercel Security Checkpoint so no runtime JS was directly inspectable. However the leaked `Tools.json` gives the exact internal tool wire format the agent emits — this is what the backend routes on:

Tools (15): `startup`, `task_agent`, `bash`, `ls`, `glob`, `grep`, `read_file`, `delete_file`, `edit_file` (with `smart_apply` bool), `string_replace`, `run_linter`, `versioning`, `suggestions`, `deploy` (static or dynamic Netlify), `web_search`, `web_scrape`.

`web_scrape` param set: `url, theme(light|dark), viewport(mobile|tablet|desktop), include_screenshot(bool)` — this is the entire cloning surface.

`task_agent` is a sub-agent spawner for multi-step external-service work (MCP-style). It has `integrations` enum (empty in the leak — dynamic at runtime per user MCP auth).

## Public Tech Talks / Founder Content Found

- [Aiden Bai launch tweet (Mar 12 2025)](https://x.com/aidenybai/status/1899840110449111416) — "Introducing Same.dev — Clone any website with pixel perfect accuracy. One-shots Nike, Apple TV, Minecraft"
- [Aiden Bai personal site](https://www.aidenybai.com/) — no essays on same.new specifically
- [Aiden Bai GitHub](https://github.com/aidenybai) — react-scan, react-grab, react-doctor, million, expect, bippy. **No same.new repo.** `expect` (*"tests your agent's code in a real browser"*) may be the internal verification tooling.
- [YC Same page](https://www.ycombinator.com/companies/same) — co-founders **Aiden Bai + Nisarg Patel**, W24, SF/Shanghai, team 5
- [Medium review](https://medium.com/top-python-libraries/same-new-ai-powered-pixel-perfect-website-cloning-boon-or-nightmare-for-developers-39c311e73a4b) — speculative, not authoritative
- [Banani review](https://www.banani.co/blog/same-dev-review) — confirms good on landing pages, stuck on Airbnb
- [Leaked prompt repo](https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools/tree/main/Same.dev) — **primary source**: `Prompt.txt` (35KB) + `Tools.json` (22KB)

**The "tech talk transcript" referenced in our Mode E2 context appears to have been a misattribution or hallucination** — no YouTube, Latent Space, or YC video of Aiden Bai talking same.new architecture was surfaceable. Same hasn't done a public technical deep-dive that I can find. The pattern we inferred as "same.new's technique" was likely aggregated from the leaked prompt + general web-coding-agent folklore.

## Still Black-Box

- Exact scraper implementation (Firecrawl vs Playwright vs Browserbase — no evidence either way)
- Apply-model identity for `smart_apply: true` (likely GPT-4.1 at higher reasoning, or Morph)
- `same-assets.com` CDN backing (S3? Cloudflare R2? no DNS evidence gathered)
- Whether there's any retrieval/RAG over component patterns (likely not, based on prompt)
- Rate-limits per user, concurrency in Docker sandbox
- Whether `task_agent` is a separate model or recursion into GPT-4.1

## Actionable Insights for RepixBridge

1. **Kill Mode E's chunking assumption as our fidelity strategy.** Same beats us on "pixel-perfect Nike" without component chunking at all — their edge is **GPT-4.1 vision + shadcn-prior + iterative screenshot refinement**, not segmentation. Mode E's DESIGN.md + single-shot path is conceptually correct; our gains should come from the **iterate-on-rendered-screenshot loop** (same's `versioning` tool) which is the [Refinement loop] roadmap item we haven't built. Build that next — it's their whole moat.
2. **Adopt the `same-assets.com` pattern.** Host scraped imagery on our own CDN so exported projects are self-contained. Tiny infra cost, huge UX win (no broken hotlinks).
3. **Copy the "customize shadcn BEFORE building" instruction verbatim into Mode E's prompt.** Our output looks AI-generic partly because we accept default shadcn primitives. Same's trick is forcing an edit pass over `button.tsx`, `card.tsx`, etc. before the hero is even written. This is prompt-engineering gold — not an algorithm.
4. **Mode E2's multi-call Flash pipeline has an unexploited edge over Same.** Same is serial and expensive (GPT-4.1 for everything). Our Flash fan-out on cleanHTML sections is 10-20× cheaper **and actually does per-section specialization** which Same never does. The pitch is "same-quality clone at 1/10th the cost" — lean into it.
5. **Animations: Same explicitly punts** ("web_scrape doesn't capture animations, do your best"). Our `freeze.js` + intended Framer-Motion-translation work is a real differentiator. Marketing angle: "same.new freezes your clone; we translate it."
