# Handoff — 2026-06-08 — Tools-first agent + production-grade infra

Branch: `feat/canvas` (161 commits ahead of `origin/feat/canvas`, **unpushed**)
Latest commit: `396b182` — feat: tools-first agent + Phase A/B + production-grade infra rollout
Tests: 223/223 passing on `bun run test`

## TL;DR for the next session

The agent now operates **tools-first** (like Claude on a codebase) instead of being spoon-fed pre-loaded context. Site capture + design extract/apply are wired into the agent (Demarcelizer + iter9). A production-grade infra layer is in place: rate limiting, moderation, circuit breaker, audit log, observability (Langfuse), prompt-injection guard (LLM Guard sidecar), eval suite (Promptfoo), CSP, monthly cost cap, gitleaks, Tailwind v4. All OSS or free where possible. All fail-open when env vars are absent so dev stays frictionless.

If you sit down to work on Uncraft today, the most useful next moves are (in order): (1) run the schema migration in prod, (2) set up Langfuse self-host + activate observability, (3) ship Privacy Policy + ToS so we can flip on PII redaction, (4) deploy LLM Guard sidecar. Concrete commands and steps below.

## What shipped in this commit

### Agent architecture — tools-first

The agent's system prompt + per-turn hint were drastically slimmed. It now exposes 11 new tools so the model can discover canvas state on demand instead of receiving a pre-loaded board summary every turn.

Read tools (like `Read` / `ls` / `grep`):
- `viewNode(id)` — full node + linked asset meta + decoded image dims (no dataUrl bytes — that would blow LLM history)
- `listBoard({kind?, nearNodeId?, limit?})` — topology snapshot with optional proximity sort
- `findNearest(fromNodeId, {kind?, limit?})` — K nearest nodes by Euclidean distance in canvas space
- `getWorkflow(nodeId)` — BFS connected component + terminal identification

Write tools (Demarcelizer / iter9 integration):
- `captureUrl(url)` — runs `lib/snapshot.js` pipeline; throws `challenge_required` on Cloudflare/captcha so the agent can ask user to use the URL bar handoff
- `extractDesign(siteNodeId)` — saves current snapshot as a designmd "template" node + wires source-edge
- `applyDesign(designNodeId, siteNodeId)` — calls Demarcelizer's `reskin`, creates restyled site node with edges from both sources

Existing tools tightened:
- `createImage`: `replaceAssetId` for in-place workflow re-runs; aspect inferred from base via `lib/image-dims.js` (decodes PNG/JPEG headers server-side, mapped to gpt-image-1's valid sizes 1024² / 1024x1536 / 1536x1024)
- `createNode`: prompt-as-variable selection logic moved into BOARD_AGENT (6 criteria, with "pointed at 1+ nodes + non-skeleton instruction" as the primary signal)

BOARD_AGENT slim version is in `lib/agent/prompts.js`. Anything you don't see in the hint, the agent must discover via tools.

Multimodal injection in `/api/chat`: when the user has 1-4 asset nodes in active context, those images are auto-injected as image blocks in the same turn (cap = `min(N, 4)` = gpt-image-1's own multi-image edit limit). The agent literally sees the pixels, not just an assetId.

### Phase A — deterministic re-run

`/api/sections/rerun` route — when the user clicks Play on a section, the route reads the terminal asset's stored meta (prompt, mode, base, refs, aspect, provider) and re-runs the same image-gen with the same args, replacing the terminal in place. **No agent involved.** Avoids the "agent asks the user 3 questions before re-running" failure mode.

### Image-gen fixes

`size: 'auto'` on gpt-image-1 returns 1024² when the input isn't one of the canonical 3 sizes — silently kills portrait/landscape source images by squishing them to square. Server-side header decoder (`lib/image-dims.js`) maps the actual file dims to the closest valid aspect ratio before the call. PNG + JPEG covered (everything our pipeline produces).

### UI polish

Several sessions of polish landed in this commit. The visible changes:
- Section bg `rgba(24,24,24,0.5)` + blur(24px) — translucent #181818
- Connections widget (above minimap) distributes evenly via `flex; width:100%; justify-content:space-between`
- Side-docked dock layout: chat-panel grows to fill, chips/context-pill/textarea/actions ordered + textarea 3x default height + send button tucked into bottom-right corner inset (right:6, bottom:6)
- Smart Edit dock removed from CanvasNode (redundant with main chat); related `regen-aspect` route deleted
- Active selection pill animation switched to opacity-only (avoids framer-motion `height:auto` quirk in fixed-height flex columns)
- `normalizeUrl` rejects host with whitespace (so a sentence containing `.png` filename no longer triggers URL auto-capture)
- Aspect-ratio pill removed from node bottom (was encouraging re-rolls instead of fixing the real aspect bug)
- Dims label shows actual decoded pixel size + simplified aspect (e.g. `1024 × 1536 / 2:3`)

### Production infrastructure layer

Ten layers wired into `/api/chat` + `lib/agent/driver.js`. All OSS, all fail-open when not configured.

| Layer | File | Activate via |
|---|---|---|
| OpenAI Moderation API pre-filter | `lib/moderation.js` | `OPENAI_API_KEY` already set → automatic |
| Rate limiting | `lib/rate-limit.js` | `UPSTASH_REDIS_REST_URL` + `_TOKEN` |
| Circuit breaker (opossum) | `lib/agent/circuit.js` | Auto-active; tunable via env if needed |
| CSP / HSTS / Permissions-Policy | `next.config.js` | Auto-active |
| Secure cookie | `lib/auth.js` | Auto-active when `NODE_ENV=production` |
| Monthly cost cap | `lib/credits.js` | Schema migration + `MONTHLY_COST_CAP_CENTS` (default 5000) |
| gitleaks pre-commit | `.githooks/pre-commit` + `.gitleaks.toml` | `brew install gitleaks` |
| Tailwind v4 | `postcss.config.mjs` + `app/globals.css` | Auto-active |
| Audit log | schema.sql `agent_run_events` + `lib/agent-events.js` | Schema migration |
| Langfuse traces | `lib/agent/trace.js` | `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY` + (optional) `LANGFUSE_HOST` |
| LLM Guard sidecar | `lib/llm-guard.js` | `LLM_GUARD_URL` (deploy sidecar separately) |
| Promptfoo eval suite | `evals/promptfooconfig.yaml` | `bun run evals` (manual + CI) |

The full body of the commit message has the rationale for each.

## What's NOT done yet

### Pending operational

1. **Schema migration in prod.** Required before cost cap + audit log work.
   ```sql
   ALTER TABLE users
     ADD COLUMN credits_cents BIGINT DEFAULT 0,
     ADD COLUMN monthly_cost_cents BIGINT DEFAULT 0,
     ADD COLUMN cost_window_start TIMESTAMP DEFAULT NOW();

   CREATE TABLE IF NOT EXISTS agent_run_events (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
     user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     type VARCHAR(40) NOT NULL CHECK (type IN (
       'iter_start','llm_call','llm_response',
       'tool_call','tool_result','tool_error',
       'needs_confirm','needs_choice','needs_softlimit_continue',
       'safety_net_fired','run_status','error'
     )),
     payload JSONB NOT NULL DEFAULT '{}'::jsonb,
     duration_ms INT,
     cost_cents INT
   );
   CREATE INDEX IF NOT EXISTS agent_run_events_run_ts ON agent_run_events(run_id, ts);
   CREATE INDEX IF NOT EXISTS agent_run_events_user_ts ON agent_run_events(user_id, ts DESC);
   CREATE INDEX IF NOT EXISTS agent_run_events_type_ts ON agent_run_events(type, ts DESC);
   ```
   `schema.sql` has the canonical version.

2. **Deploy Langfuse self-host.** Options:
   - Easiest: `git clone https://github.com/langfuse/langfuse-docker && docker-compose up -d` on a small VM
   - Better for solo: Railway template — search "Langfuse" in their templates, one-click
   - Best long term: Helm chart on whatever K8s you wire up
   Set the resulting env vars in Vercel and Langfuse starts receiving traces.

3. **Deploy LLM Guard sidecar.** Build a small Python container from `https://github.com/protectai/llm-guard/tree/main/examples/api`. Set `LLM_GUARD_URL` to point at it. Without this env var, the scanner is bypassed (logged once).

4. **`brew install gitleaks`** locally when you actually want to start blocking secret commits. The hook is already in place — it just no-ops without the binary.

5. **Push the branch.** 161 commits ahead of `origin/feat/canvas`. Decide if you want an unmerged PR for review or just keep pushing the feature branch.

### Pending policy / legal (before charging users)

1. **Privacy Policy + ToS** — `R$3-5k` for a one-time legal review by an LGPD-specialized lawyer (or `~$30/mo` Iubenda managed). Must publish before flipping moderation/PII redaction copy from "fail-open" to "fail-closed."

2. **DPA (Data Processing Agreement)** with Anthropic + OpenAI + Google. They all have templates — solo dev just downloads, signs, files.

3. **Cookie consent banner** — DIY in 30 minutes or CookieYes free tier.

4. **User-facing data export endpoint** (`GET /api/account/export`) returning the user's full data as JSON for LGPD "right to access." Combine with the audit log query: `getRunEvents({ runId, userId })` is the building block. Same for `DELETE /api/account/delete` (cascade + hard delete).

### Pending technical (next tasks the user wanted)

1. **Microsoft Presidio integration** — sidecar Python container with NER + regex + Brazilian locale (CPF, CNPJ). Pre-filter user text the same way LLM Guard is plugged in. Wait until the legal package above is ready (Presidio without policy is theater).

2. **Tailwind migration pass** — start using Tailwind utilities in new components; gradually replace plain-CSS rules in existing components when refactoring. No big-bang migration. First easy wins: dock buttons, frosted cards, microanimations on hover/focus.

3. **Eval suite CI integration** — `bun run evals` works locally but isn't wired into GitHub Actions yet. Add a workflow step that runs on PRs against any change to `lib/agent/prompts.js` or BOARD_AGENT-relevant files.

4. **Circuit breaker telemetry hook** — the `open` / `halfOpen` / `close` events log to console today. Forward them to Langfuse as custom spans when traces are active so we can see provider outages on the dashboard.

5. **Section auto-resize when new nodes join** — implicitly works (the bbox computation already expands `Math.max(stored.right, maxX+40)`), but worth a smoke test once the agent starts building chains autonomously via the new tools.

## Files touched in this commit

22 modified + 21 new + 1 deleted. See `git show 396b182 --stat` for the full list. The most important new files for the next dev to read:

```
lib/agent/tools/{view-node,list-board,find-nearest,get-workflow}.js   ← exploration
lib/agent/tools/{capture-url,extract-design,apply-design}.js          ← site/design pipeline
lib/agent/prompts.js                                                  ← slim BOARD_AGENT
lib/agent/circuit.js                                                  ← opossum wrapper
lib/agent/trace.js                                                    ← Langfuse SDK
lib/agent-events.js                                                   ← audit log helper
lib/{rate-limit,moderation,llm-guard,image-dims}.js                   ← infra primitives
app/api/sections/rerun/route.js                                       ← Phase A re-run
schema.sql (agent_run_events table)                                   ← audit log
next.config.js (SECURITY_HEADERS)                                     ← CSP + HSTS
evals/promptfooconfig.yaml                                            ← eval smoke suite
```

## Architectural decisions to preserve

These are user-stated principles (saved to mem0 with the relevant memory IDs). Don't break them without explicit user confirmation.

1. **Tools-first over pre-loaded hints.** The agent operates the canvas like Claude operates a codebase: minimal context + exploration tools. Every "let me just add this small hint" should be challenged.

2. **OSS-first over paid SaaS.** Always research OSS alternatives with deep web search before recommending paid tools. The protocol is documented in mem0 — Langfuse beat LangSmith, LLM Guard beat Lakera, DeepEval/Promptfoo beat Braintrust, Infisical beat Doppler, etc.

3. **Fail-open on infra gates.** Rate limit, moderation, LLM Guard, Langfuse — all degrade gracefully when env vars are missing. Dev sessions never block on infra config.

4. **Memory hygiene.** When mem0 is set up, search relevant memories before suggesting an approach. Save user preferences, architectural decisions, and the protocols above. Don't save ephemeral run state.

5. **JS, not TypeScript** for now. Re-evaluate when codebase passes 20k lines or first human dev is hired. Aggressive JSDoc on critical functions is the compromise.

6. **`predev` script is load-bearing.** Always uses `rm -rf .next && lsof :3030 | kill` before `next dev` — fixes HMR corruption from large prompt files.

7. **`run-map` lives on `globalThis`.** Survives HMR re-evaluation. Don't change to a regular module Map.

## How to start the next session

```bash
cd /Users/adilsonporto/Desktop/IA/Uncraft
git status                              # confirm clean working tree
git log -1 --stat                       # see what was last committed
bun run test --filter web-shell -- --run  # confirm 223/223 still green
cd packages/web-shell && bun run dev    # boot on :3030
```

Read this handoff, then either:
- pick a pending item from this doc and ship it
- or wait for the user's next direction — they tend to come in with a specific UI/UX papercut, a question about architecture, or a request to add a new capability

## Greeting from outgoing session

Long arc this round — started polishing the dock, ended deploying a production-grade infra layer with the user pushing me to challenge SaaS-by-default recommendations. The principle "research OSS deeply before recommending paid" came out of that and is now memory-pinned. The user is solo, building a real product (sites + image cherry, not the other way around), and treats me as their senior + consultant. Keep that frame; it works.
