# Agent PromptDock — Handoff for Next Session

> Written 2026-06-01 fechando uma maratona end-to-end do agent feature inteiro. Branch `feat/canvas`. ~95 commits ahead de origin. Próxima sessão: ler isto, rodar smoke tests, decidir entre push pra produção ou refinements.

## TL;DR pra próxima sessão

A feature do agent PromptDock está **substancialmente completa em código**. 8 fases shipped nesta sessão (continuando 4 anteriores). 167/167 unit tests verdes. Smoke tests no browser **NÃO foram rodados** — esse é o gate final.

**Primeiro passo da próxima sessão:**

```bash
# 1. Abrir docs/superpowers/smoke-tests/2026-06-01-agent-feature-full.md
# 2. Rodar os 9 blocos (A-I) em ordem
# 3. Marcar o que passar / falhar / iterar conforme necessário
```

Se tudo passar: agent feature pronto pra `git push origin feat/canvas` + abrir PR pra main. Se algo falhar: investigar bug → corrigir → re-test.

## O que foi shipped nesta sessão (8 fases)

| Phase | O que entregou | Commits | Tests |
|---|---|---|---|
| **2** | Destructive tools + caps + persistence | 22 (8891f33→21f4731) | 113 |
| **3** | createImage + Imagen + gpt-image-1 + needs_choice + auto-confirm | 9 (88fda72→31f1a9a) | 144 |
| **4** | Smart Edit dock plumbing (editor.js canvas-mode) | 7 (aa583b4→6ca31ca) | 146 |
| **4c** | Canvas Smart Edit entry point (React component + button overlay) | 3 (551694a→a2c5284) | 149 |
| **4b** | Orphan asset backfill route + CanvasNode integration | 3 (cfa9d3f→b7daf28) | 153 |
| **4d** | Multi-choice picker + viewport clamp + AbortController + escape cancel | 2+1 (9f2714a, f153a3c, a10071c) | 154 |
| **5b** | History reconstruction (route accumulator + PromptDock load) | 3 (ae6d122→7e67eda) | 155 |
| **5c** | Cost tracking + credits stub + tier routing | 5+1 (a605347→a10071c) | 167 |

**Plans em `docs/superpowers/plans/`** — Phase 2, 3, 4, 4c têm plan files. 4b, 4d, 5b, 5c foram in-line nos prompts dos subagents (descritos em detalhe no histórico de cada Agent dispatch).

**Spec status final (todos ✅ exceto §15 explicitly out of scope):**
- §1-4 Goals/UX, §5 Architecture, §6 10-tool catalog, §7 caps, §8 Chat UI + Smart Edit, §9 Persistence + history, §10 Image gen, §11 Prompts, §12 Cost tracking, §13 Errors, §14 Testing (unit ✅, smoke pending)

## Arquitetura — visão de alto nível

```
                            ┌─────────────────────────────┐
USER                        │  PromptDock (bottom canvas) │
typing ─────────────────────┤  ChatPanel + ToolChip       │
                            │  AssetSmartEditDock          │ ← Phase 4c
                            │   (canvas Smart Edit)        │
                            └────────────┬────────────────┘
                                         │ SSE
                                         ▼
                            ┌─────────────────────────────┐
                            │  POST /api/chat              │
                            │  • requireUser               │
                            │  • getAgentModel(user) ←──── │ ← Phase 5c tier ladder
                            │  • hasEnoughCredits          │ ← Phase 5c gate (stub)
                            │  • startAgentRun → runMap    │
                            │  • runAgentLoop(...)         │
                            │  • finishAgentRun(tokens,    │ ← Phase 5b/5c
                            │    cost, content, tool_calls)│
                            └─────────────┬────────────────┘
                                          │
                ┌─────────────────────────┼─────────────────────────┐
                ▼                         ▼                         ▼
        ┌──────────────┐         ┌──────────────────┐       ┌──────────────┐
        │ lib/agent/   │         │ lib/agent/tools/ │       │ /api/chat/   │
        │ • driver.js  │◄──────► │ • createNode     │       │   confirm    │
        │ • run-map    │ tools   │ • addEdge        │       │   continue   │
        │ • caps       │         │ • updateNode     │       │   cancel     │
        │ • cost       │         │ • queryNodes     │       └──────────────┘
        └──────────────┘         │ • getNodeOutput  │       (via runMap)
                                 │ • listAssets     │
                                 │ • deleteNode     │
                                 │ • runFlow        │
                                 │ • editSite       │
                                 │ • createImage    │←──── /api/images/generate
                                 └──────────────────┘       • Gemini Imagen
                                                            • OpenAI gpt-image-1
```

3 registries:
- `buildSafeRegistry()` — 6 safe (no Smart Edit chat uses isto)
- `buildAssetRegistry()` — safe + createImage (asset-scope chat)
- `buildFullRegistry()` — all 10 (board-scope chat)

## Arquivos-chave novos/modificados (visão por área)

### Backend (`packages/web-shell/`)

```
app/api/chat/
├── route.js              POST (SSE) + GET — registry per scope, agent loop, cost compute, persistence
├── confirm/route.js      Phase 2 — resolveConfirm/resolveChoice
├── continue/route.js     Phase 2 — resolveContinue (soft pause)
└── cancel/route.js       Phase 2 — cancelRun

app/api/images/generate/route.js    Phase 3 — provider dispatch (gemini/openai)
app/api/nodes/[id]/asset-backfill/route.js  Phase 4b — idempotent backfill
app/api/edges/route.js   Phase 2 (modified) — VALID_KINDS expanded to include 'generic'

lib/agent/
├── driver.js             Phase 2 refactor — caps + destructive + retry + soft-pause + wall-timeout
├── run-map.js            Phase 2 — pause/resume singleton with flush-on-unregister
├── caps.js               Phase 2 — env-driven cap config
├── cost.js               Phase 5c — MODEL_PRICES + computeCost + getCostPerImage
├── prompts.js            Phase 1 (kept) — BOARD_AGENT, EDIT_IMAGE_SYSTEM, EDIT_SITE_SYSTEM
└── tools/
    ├── index.js          Phase 4 — buildSafeRegistry + buildFullRegistry + buildAssetRegistry
    ├── create-node.js    Phase 1 (semantic type enum)
    ├── add-edge.js
    ├── update-node.js
    ├── query-nodes.js
    ├── get-node-output.js
    ├── list-assets.js
    ├── delete-node.js    Phase 2
    ├── run-flow.js       Phase 2 (+ fix do schema review)
    ├── edit-site.js      Phase 2 (+ fix do schema review)
    └── create-image.js   Phase 3 (+ Phase 3 review fix: direct adapter call, no internal fetch)

lib/image-gen/
├── gemini-imagen.js      Phase 3 — Imagen 3.0 fast
└── openai-image.js       Phase 3 — gpt-image-1 + SIZE_MAP

lib/
├── chat-persistence.js   Phase 1 + 2 + 5c — getOrCreate, append, load, archive, start/finish AgentRun(tokens/cost)
├── credits.js            Phase 5c — MVP stub (unlimited)
└── run-flow.js           Phase 2 (modified) — systemPromptOverride param
```

### Frontend (`packages/web-shell/components/`)

```
PromptDock.jsx           Phase 1+2+3+5b — reducer, SSE consumer, latestRunIdRef, THREAD_LOADED, control-call helpers
CanvasNode.jsx           Phase 4c+4b+4d — Smart Edit button + dock visibility + backfill flow + SmartEditDockWrap
canvas/
├── AssetSmartEditDock.jsx      Phase 4c+4d — React component, SSE consumer, picker UI, abort, cancel
├── asset-smart-edit-dock.css
└── (other canvas helpers)
chat/
├── ChatPanel.jsx        Phase 1+2+5b — bubbles + chips + softpause + persisted tool_calls rehydrate
├── ChatBubble.jsx
├── ToolChip.jsx         Phase 2 — awaiting_confirm/awaiting_choice/skipped states
├── SoftPauseChip.jsx    Phase 2 — whole-run pause
└── chat.css
```

### Editor (`packages/editor-core/src/editor.js` + `editor/editor.js` built)

- Phase 4 — `isCanvasMode()`, `triggerAnalyze` canvas bypass, `submit()` split (extension vs canvas), `submitCanvas` + SSE consumer + null guards + cancelled status

**Editor.js Phase 4 path is dormant on canvas** (Phase 4c React component is what users hit). Kept as fallback / future unification candidate.

### Schema (`packages/web-shell/schema.sql`)

- Phase 1 added: `chat_threads`, `chat_messages`, `agent_runs`
- Already present: `assets`, `asset_groups`, `nodes`, `boards`, `users` (with `plan` column)

## O que está realmente faltando

### Manual smoke tests no browser

Roteiro completo em `docs/superpowers/smoke-tests/2026-06-01-agent-feature-full.md`. 9 blocos (A-I), ~40 cenários. **Esse é o único bloqueador real pra carimbar "production-ready".**

### Bugs Important deferidos

1. **SmartEditDockWrap flicker** (Phase 4d review) — primeira renderização sempre lado direito, useEffect flippa depois. Fix: `useLayoutEffect` ou cálculo síncrono de `node.pos_x + node.width`. ~10 min
2. **Stale `node.meta.assetId` após backfill no CanvasClient** (Phase 5c review) — local `resolvedAssetId` correto mas Map no parent não atualiza até refetch. Sem perda de dado, UX confuso em reload. Fix: `onNodeMetaUpdated` callback ou targeted refetch após backfill. ~20 min
3. **DeepSeek pro tier** (Phase 5c review) — hoje cai em `gemini-2.5-flash`. Wiring: branch `^deepseek` em `resolveAdapter` (route.js) + thread `baseURL` através de `callOpenAI` (`lib/agent/llm-openai.js`). Add `DEEPSEEK_API_KEY` env. ~20 min

### Future phases (não-bloqueantes, post-launch)

- **Phase 3b** image-to-image — passar imagem existente como reference pra createImage (~2hr)
- **Phase 5d** DeepSeek adapter + Stripe credits enforcement (~3hr)
- **Phase 6** Redis-backed runMap (só se escalar horizontal)

### Convenções da casa pra não esquecer

- Editor source vs dist: edita `packages/editor-core/src/editor.js`, roda `bash scripts/build-editor.sh` pra sync
- `chat_threads.asset_id` constraint exige `assets` row real — Phase 4b cobre isso via backfill
- POST /api/chat retorna SSE; novas SSE events precisam case no `handleSseEvent` da PromptDock + AssetSmartEditDock
- `runMap` é in-memory singleton — se for horizontalizar, port pra Redis
- `lib/agent/cost.js` MODEL_PRICES desatualiza com tempo — manter sincronizado com pricing pages dos providers

## Decisões arquiteturais relevantes

1. **Smart Edit canvas usa React component, não editor-core** (Phase 4c) — asset nodes não têm iframe, CanvasEditorCore não se aplica. Editor.js Phase 4 fica dormante mas presente.

2. **`choices()` dispatch primitive** (Phase 3) — `length === 1` → silent auto-confirm; `length >= 2` → user picks. Funciona pra createImage E pra qualquer futuro tool com escolha provider.

3. **Cost storage: base64 dataUrl em `assets.meta.dataUrl`** (Phase 3) — sem CDN/blob storage pra MVP. Migrar pra `blob_url` quando custo de DB row size virar problema real.

4. **Credits enforcement deferred** (Phase 5c) — `lib/credits.js` stub retorna sempre OK. Surface da API tá no shape certo, swap-in real = 5 linhas + `users.credits_cents` column + Stripe webhook.

5. **Tier ladder no AGENT model, não no picker** — picker é pra `runFlow`/`createImage` (modelo que roda DENTRO de um node). AGENT é o modelo que orquestra tools. Desacoplado.

6. **`latestRunIdRef` pattern em React SSE consumers** — Phase 3 review pegou stale closure no PromptDock; Phase 4c/4d aplicaram mesmo pattern em AssetSmartEditDock. Sempre use ref se runId é set por SSE event e usado por handler subsequente.

## Como pickup rápido na próxima sessão

```bash
# 1. Estado atual:
cd /Users/adilsonporto/Desktop/IA/Uncraft
git log --oneline feat/canvas | head -20    # últimos 20 commits

# 2. Tests:
cd packages/web-shell && npm test            # 167/167 esperado

# 3. Dev server:
npm run dev                                  # http://localhost:3030

# 4. Smoke tests:
# Abrir docs/superpowers/smoke-tests/2026-06-01-agent-feature-full.md
# Seguir blocos A-I em ordem

# 5. Decidir pós-smoke:
#    • Tudo passou → push + PR pra main
#    • Algo falhou → debug + fix + re-test
#    • Quer polish → priorizar bugs Important #1/#2/#3 acima
```

## Memórias relevantes (mem0)

- `checkpoint_2026-05-31_046.md` — Phase 1 + 5a (anterior à sessão)
- `checkpoint_2026-05-31_047.md` — Phase 2
- `checkpoint_2026-05-31_048.md` — Phase 3
- `checkpoint_2026-05-31_049.md` — Phase 4
- `checkpoint_2026-06-01_050.md` — Phase 4c
- `checkpoint_2026-06-01_051.md` — Phase 5c
- `feedback_momentum_over_confirmation.md` — após execution path agreed, não quebrar fluxo com confirmation prompts

CLAUDE.md items 128 → 133 documentam toda a feature.

## Status: tudo no `feat/canvas`, 95 commits ahead de origin. Não foi pushado ainda.

Quando push acontecer, criar PR com link pra `docs/superpowers/specs/2026-05-31-agent-promptdock-design.md` + esse handoff + o smoke test report.
