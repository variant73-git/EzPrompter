# Uncraft — Contexto do Projeto

> **Renomeado em 2026-04-27** — antes era "RepixBridge". Pasta em `~/Desktop/IA/Uncraft/`. Namespace de código (`__rb*`, `rb-*`) preservado intencionalmente.

> **📦 Versão compacta (2026-07-20).** Este arquivo foi editorialmente compactado pra cortar o custo fixo por sessão. O texto integral anterior está VERBATIM em **`docs/CLAUDE-ARCHIVE-2026-07-20.md`**. Detalhe gordo de cada sessão vive nos checkpoints da memória (`~/.claude/projects/-Users-adilsonporto-Desktop-IA-Uncraft/memory/`) e no vault Brain. Regra: ao precisar do detalhe de um item numerado do histórico, ler o memo `[[...]]` citado ou o archive — nunca adivinhar.

## 🧠 Cérebro do projeto (vault Obsidian)
O cérebro do projeto vive em **`~/Desktop/IA/Brain`** — um vault Obsidian versionado com git próprio (separado deste repo). Porta de entrada: `Uncraft/🏠 Uncraft Home.md`. Estrutura: `Estratégia/`, `Produto/`, `Pesquisa/`, `Sessões/` (histórico de checkpoints), `Ideias/`.
- **Consultar** o vault ao precisar de contexto de estratégia, pricing, competidores ou histórico de decisões.
- **Atualizar** no ritual **[SALVAR]**: escrever/atualizar a nota da sessão em `Sessões/`, atualizar notas afetadas + a Home, e commitar o vault (`git -C ~/Desktop/IA/Brain add -A && git commit`).
- **Findings (parte do [SALVAR], adicionado 2026-07-19)**: revisar a sessão procurando TODO momento em que o user sugeriu uma ideia CONTRARIANDO a proposta inicial do agente e a dele venceu → registrar em `Findings/🔍 Findings — quando a ideia do Adilson venceu.md` (formato: contexto → proposta do agente → contra-ideia → por que venceu → princípio). Sem momento qualificado = dizer explicitamente, nunca inventar.
- Notas em Markdown com links `[[wiki]]` — criar links liberalmente entre notas relacionadas.

## O que é
**Uncraft** é uma extensão Chrome que funciona como um **design tool para a web** — o designer edita qualquer site visualmente, sem sair do browser. Slogan: "Design without borders".

Três frentes:
1. **Page Editor** — editor Figma-like: layers panel, inspector, spacing guides, edição visual in-place
2. **Canvas (web-shell)** — board Next.js estilo node-graph: clones de sites, assets, prompts, agente de chat orquestrando o grafo
3. **Image Remix** — reverse-engineer do prompt de qualquer imagem + geração inline via IA

## Posicionamento Estratégico
Uncraft é o único tool que **edita sites visualmente no browser** com controles de design tool (layers, inspector, spacing). Nenhum competidor faz isso: html.to.design leva pro Figma; same.new gera código React; ClonewebX exporta pra builders; CSS Pro edita CSS sem layers/inspector; CSS Peeper é read-only.

## Mercado & Pricing
- Pesquisa abril 2026: mercado dos competidores diretos ~$9-14M ARR dentro de design tools de $14.9B. Tabela completa de competidores: archive + [[research_market_financials]].
- **Pricing em lock** (benchmark 2026-04-27): motor Mode E = **Gemini 3.1 Pro** ($0.525/clone medido). Cheap-tier reprovado em qualidade. Free = **Mode A only** (sem rebuilds cortesia). Modelo concreto (flat vs cap vs ladder) pendente — [[project_llm_lock_2026-04-27]] e vault.
- Decisão: **cobrar pela IA, não BYOK** (margem alvo 60-70%, zero config pro usuário).
- Legal & ética: ferramenta de **inspiração e aprendizado** ("papel vegetal").

## Branches
- `feat/native-motion-editor` — **frente atual** (motion editor nativo, ver seção abaixo)
- `feat/canvas` — canvas web-shell (checkpoints 108–152: agent chat, créditos, perf, clone/transplante)
- `feat/normalize-engine` — branch principal da extensão (editor + layers + Mode E + detect/freeze)
- `feat/sidebar-panel` (028) · `feat/guides-ux-experiment` (029) · `feat/smart-text-cascade` (032, melhor Mode E) · `feat/mode-e-refinement` (033/034/035)
- `claude/ai-image-description-extension-Tp3jY` — main branch

## Versão atual
`2.6.0` (extension), web-shell unversioned.

## Estrutura do projeto
```
manifest.json                # Manifest V3 (Chrome/Opera)
background.js                # Service worker: injeção, APIs IA (Gemini + Anthropic via model-name regex), captureVisibleTab
editor/editor.js             # EDITOR PRINCIPAL
editor/editor.css            # Estilos (seleção, layers, inspector, guides)
editor/mode-e.js             # Mode E (parallel viewport) + Lean + cancel/watchdog + asset restore
editor/mode-e-classic.js     # Mode E0: pipeline 033 frozen, A/B reference
editor/mode-e-diff.js        # Mode E refine: visual diff + JSON salvage scanner
editor/mode-e-refine.js      # Mode E refine: per-section regen + structural validator
editor/detect.js             # Detecção de web builder (8 builders)
editor/freeze.js             # Congela animações (GSAP, Lenis, Webflow IX)
editor/rebuild.js            # Rebuild engine v4 (v5 crashava — não reativar sem cuidado)
editor/mode-b.js             # Mode B: DOM Mirror (stylesheet extraction + body clone)
editor/mode-e2.js            # Mode E2: Fast HTML-to-Code (multi-call Flash)
editor/s2h.js                # S2H: Screenshot-to-HTML (2-pass vision)
editor/fill-popup.js         # Fill popup: Color / Gradient / Image / Effects
editor/normalize.js          # Curate engine
overlay/extractor.js         # Tokens, cleanHTML, generateDesignMD + buildAssetManifest
panel/panel.js               # Widget flutuante (settings, onboarding)
handoff/ · popup/            # Challenge handoff + toolbar widget (Collect Assets)
figma-plugin/                # Plugin Figma companion
web/                         # Portal Next.js legado (auth + Stripe + relay)
packages/editor-core/        # Editor compartilhado extension+canvas — editar AQUI e rodar scripts/build-editor.sh
packages/web-shell/          # App Next.js do canvas (porta 3030; bun, não npm — bun.lock é source of truth)
```

## Frente atual: Motion editor nativo (`feat/native-motion-editor`)
Editor de animações (GSAP/ScrollTrigger/Lottie/WAAPI) dentro do canvas. **Fonte canônica: `docs/superpowers/plans/2026-07-18-motion-editor-redesign-and-handoff.md` §6b–6e.** 721/721 testes. Memo: [[checkpoint_2026-07-19_motion-editor-phases]].
- Código: `packages/web-shell/components/motion-editor/NativeMotionEditor.jsx` (UI monolítica: MotionPanel, TimelinePanel, PropertiesPanel…) + `lib/motion-editor/` (`motion-groups.js`, `framer-export.js`, `runtime-bridge-source.js` — bridge injetado no site, fala por postMessage).
- Entregue: agrupamento semântico (text-reveal/timeline/stagger), régua única = scroll da página (scrubber rola o site), strips arrastáveis (`st.vars.start/end` + `refresh()`), keyframes por adapter, `gsap.from()` read-only, driver `media`, exportador Framer Motion com TRANSLATION REPORT.
- Motor (154): GSAP mid-tween tracks, snapshot/restore de cssText (amostrar disparava `clearProps` e corrompia a página), `gsap.parseEase()` (vars.ease sozinho não troca curva), `invalidatePreservingStart`, playback escopado à seleção, guarda de instância (AbortController, re-injeção desmonta a anterior), viewport-scoping (`viewport-motion-changed`/`inspect-viewport`, debounce 120ms).
- **Fixture ao vivo**: clone 1:1 do farmminerals em `~/Desktop/IA/Unspirit-Clone-1to1/site` (GSAP 3.15 real, offline). Rodar: `UNCRAFT_NATIVE_CLONE_ROOT=<site> npm run dev:motion` (porta **3032**, `NEXT_DIST_DIR=.next-motion` — ⚠️ build separado fica velho e serve código desatualizado sem avisar; limpar `.next-motion` ao duvidar). Probes: `scripts/validate-gsap-editor.mjs`, `probe-gsap-ease.mjs`, `probe-text-reveal.mjs`.
- **Método**: desacordos entre modelos (Claude × Codex) decidem-se por PROBES no GSAP real, não por argumento. Codex via bundle escopado (`--mode prose --file <diff>`), nunca `--mode diff` aqui.
- **2026-07-20 (item 155)**: timeline redesenhada no modelo Figma Motion + 3 rounds de smoke + review adversarial. Estado canônico: `docs/superpowers/handoffs/2026-07-20-motion-timeline-figma-handoff.md` (arquitetura, convenção replay-on-pass, tradeoffs aceitos, pendências).
- Pendente: smoke manual (rounds em curso), spike de import no Framer (USER, plano §3.5), achatar layer-mãe se o user preferir, CSS morto do painel antigo.

## Histórico de checkpoints (95–154)
> Uma linha por item. Detalhe completo: memo `[[...]]` citado e/ou `docs/CLAUDE-ARCHIVE-2026-07-20.md`. Itens 1–94 (funcionalidades do editor Mode A) na seção seguinte.

95. Edit mode persistence (Done → `/api/nodes/[id]/save-edit`, snapshot novo)
96. Cancel + popup (Discard / Save and exit)
97. Topbar redesign (ações no More dropdown)
98. Topbar grip slide abaixo de 20% zoom
99. Hero proportion 16:9 + dash resize handles
100. Expand floater (hero ↔ full content)
101. Cascade overlap-shift na expansão
102. Frame controls API (`__uncraftZoom`)
103. Edit-frame width-fit
104. Fit-to-view selection-aware
105. Wheel routing em edit-mode (pan/zoom)
106. suppressHydrationWarning no layout (extensões injetam attrs)
107. Cancel popup polish + feedback pill
108. Run-flow engine — `lib/run-flow.js` `runCompose` (COMPOSE_SYSTEM por mix de sources)
109. `POST /api/nodes/[id]/run` (compose + snapshot + edges applied)
110. Run status chip por target (1/3→3/3)
111. Upload asset/screenshot (kind `asset`, dataUrl no meta)
112. Anthropic streaming p/ long calls (max_tokens 32k exige `.stream()`)
113. Capture pre-check tolerante a WAF (UA realista, pass-through 403/406/429/503)
114. `predev` script (rm -rf .next + mata porta 3030)
115. Routing OpenAI/GPT-5.5 (`temperature` omitido — GPT-5/o-series rejeitam)
116. Vision multimodal no run-flow (images[] nos 3 providers)
117. Auto-routing GPT-5.5 quando há imagem no flow
118. Model picker plumbing end-to-end (`MODEL_ALIAS`)
119. ⚠️ Anthropic billing: claude.ai (Pro/Max) ≠ API — créditos em console.anthropic.com
120. Spike scroll-record → reconstruction, 9 iterações (auto-raster é a chave) — [[spike_scroll_record_2026-05-15]]
121. Detect-and-route animated-builder → `lib/reconstruct.js` (server-side do spike) — [[checkpoint_2026-05-25_042]]
122. Bot-challenge detection (Cloudflare/hCaptcha/…) + ChallengeModal + SSE progress
123. Extension handoff bridge + manual capture (HMAC token, banner in-tab) — [[checkpoint_2026-05-27_043]]
124. Cursor-tracks-port (bolinha do emitter segue o Y do cursor)
125. Widget reorg + Collect Assets v1 (marquee, stack popup, Cmd+G, fonts) — [[checkpoint_2026-05-28_043]]
126. Editor polish 10 papercuts (sync via `scripts/build-editor.sh`) — [[checkpoint_2026-05-30_045]]
127. Overlay boxes refresh em wheel-zoom/pan (canvas)
128. Agent PromptDock Phase 1+5a (driver + 3 adapters + 6 safe tools + threads) — [[checkpoint_2026-05-31_046]]
129. Agent Phase 2 (destructive tools, confirm/skip, soft-pause, caps, cancel) — [[checkpoint_2026-05-31_047]]
130. Agent Phase 3 (createImage, Imagen/gpt-image-1, needs_choice) — [[checkpoint_2026-05-31_048]]
131. Agent Phase 4 (Smart Edit dock asset-scoped) — [[checkpoint_2026-05-31_049]]
132. Agent Phase 4c (Smart Edit no canvas, AssetSmartEditDock) — [[checkpoint_2026-06-01_050]]
133. Agent Phase 5c (cost tracking, credits stub, tier ladder) — [[checkpoint_2026-06-01_051]]
134. Chat multimodal + image-to-image (`baseImageAssetId`) + `addAssetFromUrl`
135. Style-transfer e2e + fix HMR runMap (`globalThis.__uncraft_runMap`) — [[checkpoint_2026-06-02_session]]
136. Section ▶ generalizado (terminal-kind routing; confirm só ao sobrescrever) — [[project_canvas_run_semantics]]
137. Node progress ring + 6 fixes + chat model-picker (`resolveAgentModel`) + Extract-to (7 combos) — [[checkpoint_2026-06-19_session]]
138. Agente conversational-orchestrator (createNode `content`; BOARD_AGENT big-picture) — [[principle_agent_macro_operating_model]]
139. Batch 5-fix (seleção=alvo, section-aware placement, clone via modelo forte, ring no clone, WorkingIndicator)
140. Canvas UX polish (edges otimistas, floating run, scissors-cut, multi-file queue) — [[checkpoint_2026-06-24_session]]
141. Polish follow-up (clip icon, version-menu scroll, dims label)
142. Anti-slop Layers A+B (`lib/design/house-style.js` + `style-extract.js`) — [[checkpoint_2026-06-25_anti-slop-layers]]
143. Anti-slop DETERMINÍSTICO (ground truth do DOM real; mostrar a imagem ao compose) — [[checkpoint_2026-06-26_session]]
144. Imagem sem prompt ≠ build (Rule 4b) + section de-overlap no addEdge — [[checkpoint_2026-06-26_image-build-section-overlap]]
145. Clone/transplante fidelidade (GPT-5.5 + `sample-palette.js` cor por pixels) + STOP + paste — [[checkpoint_2026-06-28_canvas-clone-transplant]]
146. Sistema de créditos v1 (metering µ¢, ledger, 402, welcome 500) — [[checkpoint_2026-07-03_credits-system]]
147. Billing UI polish + 3 artefatos de outline + DESIGN.md standards
148. Node chrome redesign (topbar HIDDEN — revert: [[project_topbar_revert_recipe]]) + createWorkflow (área pré-medida) — [[checkpoint_2026-07-03_node-chrome-chains]]
148b. Canvas performance arc completo (6 fases; site node estático por padrão; piso 40%) — [[checkpoint_2026-07-03_canvas-perf-phase1]]
149. Follow-ups perf (radius +50%, resize de eixo único, membership sobrevive tesoura)
150. Híbrido de escala do chrome (⌥W world-lock; `--chrome-scale`) — [[feature_preferences_worldlock_toggle]]
151. Seleção=origem + cascata whole-graph incremental + hand-off entre sections + Cmd+C/V de cadeias — [[checkpoint_2026-07-06_selection-origin-cascade]]
152. OS drag-drop no canvas + fix thumbnail 100vh (fullPage+clip) — [[checkpoint_2026-07-11_os-drop-thumbnail-fix]]
153. Motion editor 6b–6e (grouping, régua única, strips, keyframes, export Framer) — [[checkpoint_2026-07-19_motion-editor-phases]]
154. Motion editor: motor + clone-fixture + harness adversarial Codex — [[checkpoint_2026-07-19_motion-editor-phases]]
155. Timeline Figma Motion (scroller único/labels sticky, full-page rows por CHEGADA, ownership, replay-on-pass edit-mode, tudo clicável) + review Claude×Sol com 11 fixes — [[checkpoint_2026-07-20_motion-timeline-figma]]; handoff `docs/superpowers/handoffs/2026-07-20-motion-timeline-figma-handoff.md`
156. Branch preview/soma (soma de todas as frentes) + QA ao vivo: ghost-doc do srcDoc (painéis vazios em captura grande), scroll em edição, gate do seletor de modos legado, cores #20201E, glitch LQIP na captura, viewport-lock confirmado; política de modelos auditada vault×código com Sol (pro=Flash, picker só criação, pins extract/restyle/compose, breaker mascara 400 — pendência estrutural) — [[checkpoint_2026-07-22_preview-soma-qa-model-policy]]; handoff `docs/superpowers/handoffs/2026-07-22-model-policy-audit-handoff.md`
157. Fix estrutural failover (`fix/agent-failover-policy`): taxonomia `provider-errors.js` + breaker honesto (erro original atravessa; `circuit_open` só aberto; errorFilter) + `FAILOVER_POLICIES` por operação (clone gpt-5.5↔opus fail-closed NUNCA Flash; enterprise fail-closed) + sticky + guarda de saída parcial + época de attempt (stream pós-timeout não contamina) + rota persiste modelo USADO; TDD witness + smoke real (`provider_balance` explícito no SSE) + review 2×Claude+Sol com 7 fixes. 802/802. Pendências (UI do failover, clone-mode sticky, órfão parcial, retry enterprise) no handoff 2026-07-22 — [[checkpoint_2026-07-22_failover-policy-fix]]
158. Consolidação do tronco: `main` fast-forwardado até a ponta da linha soma→failover (motion editor + soma + failover), tornando-se o tronco real onde tudo acontece; ponteiro estava parado no item 152. house-style.js (monólito 86 linhas → SWITCHBOARD de 38 critérios com chave `on` cada, 244 linhas: env `UNCRAFT_HOUSESTYLE_OFF/_ON`, `listCriteria`/`setCriterion`/`buildHouseStyle`, decisões anti-slop 37-53 como defaults; exports `HOUSE_STYLE_GUARDRAILS`/`_ABSORB`/`HOUSE_STYLE` retrocompatíveis) trazido da `feat/native-motion-editor` por CÓPIA de arquivo (não cherry-pick — o commit `b402eeae` divergia do main e o diff conflitaria). Contexto completo do switchboard + auditoria de 11 skills + geração criativa DECOMPOSTA (Sol brief → executor barato + skills → verify) + Ditto como substrato — handoff `docs/superpowers/handoffs/2026-07-22-skills-audit-housestyle-switchboard-handoff.md` e [[checkpoint_2026-07-22_skills-audit-decomposition-housestyle]]. Fora do tronco ficou só o commit `b402eeae` (galho `feat/native-motion-editor`), preservado.
159. Clone router + Ditto + componentização: (a) FEITO hardening do extract (bug do `.md` que travava em ~90% = `callLLM` sem timeout; `lib/llm-deadline.js` deadline+abort+guard de provider nos 3 seams + timeout no cliente; Sol pegou regressão `models/gemini-*`; 822/822); (b) DESCARTADO Ditto-export (re-clona a URL → exporta o ORIGINAL ignorando edits do canvas; safety não previsível pela fonte, só verificando output); (c) NOVA FRENTE componentização do NOSSO clone — motivação forte = **seções estáveis** (hoje instáveis, pior em animado); Caminho 1 Ditto-como-biblioteca sobre nosso HTML, fallback componentizador próprio; (d) classificador free-vs-pago construído (shadow, `lib/classify-site.js` mede artefato strippado vs fonte, estado `unknown`, sem Ditto). Handoff `docs/superpowers/handoffs/2026-07-23-componentization-and-clone-router-handoff.md`, [[checkpoint_2026-07-23_clone-router-ditto-componentization]], [[project_componentization_own_vs_ditto]].
160. Audit Claude×Sol do `bbd5dea9` + 3 bugs corrigidos (TDD, 2 rodadas Sol) + **decisão da arquitetura do classificador**: (a) FIX misroute — os 3 seams despacham pelo `provider` que `assertProvider` retorna (não mais regex local que perdia fable/mythos/chatgpt → 404 no Gemini); (b) FIX cobrança-dupla/node-duplicado — deadline de ROTA absoluto desde a entrada (por-chamada 150s não limita clone/styleclone de 2 chamadas), dispara dentro do `runBilledOperation` (refund + nenhum node), env-clamp [1s,170s] < cliente 200s, `jsonOrThrow` surface `message`, signal atravessa até o crop loop (corta edição GPT paga mid-embed); (c) FIX #3 refund silent-debit — `settle(holdCredits:estimate,charge:0)` atômico (devolve o hold) + falha logada alto em vez de `refundHold().catch(()=>{})` engolido; (d) ⭐ **classificador vira detector-VERIFICADOR, não preditor** — detector só faz sentido se perfeito, mas preditor por sinais nunca é (GSAP bundled invisível) → rode o clone estático grátis, VERIFIQUE o output (visual, não texto), escale pro caro só na falha; sinais primeiro (web-builder=pesado por fiat), verify só no resíduo; shadow morto (`page.setJavaScriptEnabled` não existe no Playwright — é opção de `newContext`) = pré-requisito do gate. 836/836. Residual: settlement transacional/idempotente (pré-existente, zero risco prático hoje). Handoff `docs/superpowers/handoffs/2026-07-23-audit-fixes-and-classifier-verify-architecture-handoff.md`, [[checkpoint_2026-07-23_extract-audit-fixes-classifier-verify]].

161. Continuação (2026-07-24): (a) gate do classificador passo 1 — `visualDiff` (2º instrumento, em `classify-site.js`) wired no shadow, logando texto E visual; auditado pelo Sol (5 achados) → roda em `about:blank` confiável+deadline, probe **JS-LIGADO** (iframe real é `sandbox="allow-scripts"`, a polaridade do revive anterior estava errada), OOM guard, witness e2e via `captureSnapshot` (commits `490e71ab`, `930470aa`); (b) billing settlement **ATÔMICO** — `settleOperation`/`grantCredits` via `sql.transaction([...])` (neon HTTP, 1 tx Postgres), `balance_after` por subquery, Proxy do db.js verificado por runtime; estado-pela-metade eliminado (commit `5a276baa`); (c) ⭐ **RESIDUAL money-safety** que o Sol reframou (a investigação parou raso): **cobrança dupla no retry** — op paga commita+cobra, perde a resposta → cliente/agente re-executa com opId FRESCO → mesma ação cobrada 2× + hold encalhado; opId fresco por retry IMPEDE dedup (não é a segurança) → precisa **idempotência de OPERAÇÃO LÓGICA** (chave estável + registro durável, estilo Stripe), é FEATURE. Brainstorm handoff `docs/superpowers/handoffs/2026-07-24-logical-idempotency-brainstorm-handoff.md`. 838/838. [[checkpoint_2026-07-23_extract-audit-fixes-classifier-verify]].

162. **Idempotência de operação lógica — SHIPPED** (branch `fix/logical-idempotency-billing`, 5 commits, off `main`; spec `docs/superpowers/specs/2026-07-24-logical-idempotency-billing-design.md`): fecha o residual do 161(c). Tabela durável **`operations`** (`UNIQUE(user_id, idem_key)`, status in_flight/settled/failed/expired) que **absorve o hold** → hold órfão vira linha `in_flight` que a varredura acha determinístico. ⭐ **Regra de produto do Adilson decidiu o design**: resultado consistente (não roleta), re-run deliberado SEMPRE paga → **sem janela de tempo**; a **etiqueta do pedinte** (idempotency ticket, cliente carrega/reusa no reenvio) é o único que distingue retry-acidental de intenção-nova. Fluxo: claim (CTE atômica) → dedup (settled=replay/charge 0, in_flight=409, failed/expired=reclaim) → settle. **DUAS rodadas de review adversarial (Codex/Sol × Claude), 8 bugs de dinheiro pegos**: #1 (core, 5) — keystone **settle cercado** (transição guardada `WHERE status='in_flight'` numa CTE, saldo derivado do `hold_credits` da LINHA) vs reconcile (senão ressuscitava/refundava 2×); **`SELECT … FOR UPDATE`** contra overspend (fix do Claude venceu o do Codex); reconcile sem ledger row (drift); `runIdempotentOperation` exige chave; cron `/api/cron/reconcile-holds`. #2 (migração, 3) — create-image keava no **placeholder nodeId instável** (nunca dedupava); a **rota `/reconstruct` — o 8º caller — largava a etiqueta** (bilha VIA deferred-reconstruction, não aparece em grep de `runBilledOperation`); run-flow nulificava a chave sem modelId. Raiz endurecida: `deriveIdemKey` só nulifica no 1º part (scope/runId); empties posteriores viram sentinela. 8 callers wired (extract move artefato PRA DENTRO; run compose+sub-key `${ticket}:reconstruct:${nodeId}`; agent tools derivam `hash(runId+tool+input)`). Cliente `lib/idempotency.js` (mint/reuse/clear + espelho localStorage). 876 testes (872+4 integração Neon gated). Residuais documentados (Codex, estreitos): plan-change no retry do run, cross-tab, órfão do extract (já aceito §6), rate-limit-antes-do-dedup. Pendente: merge→main, schedule do cron, [SALVAR] completo. [[checkpoint_2026-07-24_logical-idempotency]].

163. **Hero pixelado do farmminerals = vh/vw pin corrompendo data-URIs — SHIPPED** (`main`, commit `ede0d438`): o "pixelated hero" NÃO era limitação de site animado. O Adilson recusou o tradeoff ("esse clone já foi perfeito") e mandou validar a causa com o Sol de auditor. Probe A/B provou: **`pinViewportUnits` (`lib/snapshot.js`) fazia replace global `\d+vh|vw`→px no HTML INTEIRO e corrompia o base64 das data-URIs** — 382 substituições dentro de um Lottie SVG inline de 7,5MB (318 `<image>` data-URI de 720×720) → frames decodificam como bloco pixelado de céu+grama. Derrubou DUAS causas erradas (handoff "HTML gravado no fim" = falso, `content()` roda no TOPO após `scrollTo(0,0)`; minha "JS morto degrada a imagem" = o Sol pegou, `<svg><image>` 720×720 renderiza nítido sem JS). **Fix whitelist:** `pinCssLengths` (pina CSS pulando comentários/strings/`url()`; guarda `(?<![\w-])` salva seletores utility tipo `.h-100vh`) + `pinViewportUnits` reescrito (só `<style>`/`style=""`, mascara valores de atributo); data-URIs/`sizes`/texto byte-idênticos. Paridade portada pra `packages/extension-shell/handoff/capture.js` (tinha o mesmo bug ingênuo). **2 rodadas de audit do Sol, cada achado VERIFICADO rodando** (veto assimétrico) — round 1 (blacklist) descartado por furos F1a/F2a/F2b; round 2 (whitelist) achou furos de contexto-HTML + `.h-100vh` seletor. Reframe decisivo: whitelist é **subconjunto estrito** do que a produção já substituía → estritamente mais seguro, não introduz nada novo. **Escopo revisado pelo Sol (via Adilson):** NÃO abrir a re-arquitetura CSSOM maior agora — a captura de referência vai ser redesenhada pra iframe/preview rolável e o clone completo só começa no Edit; implementei e REVERTÍ o `pinDomViewportUnits` (CSSOM no browser, fecharia a classe inteira), o que também consertou o import quebrado do `reconstruct.js`. Residuais de contexto-HTML (data-URI SVG com `style` próprio; `url(&quot;data:…&quot;)` em style attr) aceitos. 17 testes (`lib/snapshot.test.js`), suíte **896**, `next build` OK — [[checkpoint_2026-07-24_pixelated-hero-vh-pin]].

164. **CSSOM in-browser pin — SHIPPED** (`main`, commit `2083471d`, base `9685c4d9` com a correção do posicionamento URL-iframe preservada; REVERTE o adiamento do 163 — Adilson via Sol: "faça a versão robusta CSSOM agora"). O pin ativo de captura agora roda no **DOM vivo via CSSOM ANTES de serializar** (`pinDomViewportUnits`): `querySelectorAll('[style]')` + `querySelectorAll('style')` com `getAttribute`/`textContent` (aspas reais, sem `&quot;`, sem `<style>` embutido em data-URI) → data-URIs/SVGs/Lotties/strings/comentários/`url()` byte-a-byte **por construção**; mata F-new-1/2/2b/3. O `pinViewportUnits` (string) vira **fallback inerte** (segue no `reconstruct.js`); CSS externo continua via `pinCssLengths` no `inlineStylesheets`. Constraints do Sol: só a captura existente, sem iframe/UI/URL-insert, fallback não auto-ativado. **Audit do Sol (5 achados, cada um verificado rodando):** (1) buracos do regex — 3 consertados (continuação de string via `\\[\s\S]`, comentário sem `*/` via `(?:\*\/|$)`, `1vh2` via `(?![\w-])`), 2 exóticos (escaped-`u\72l(`, data-URI raw em custom-prop) documentados como residual (precisam de tokenizer, inalcançáveis em CSS real); (2) ⭐ `eval(toString)` vira **no-op silencioso sob CSP** → trocado por `new RegExp(CSS_VH_VW_SRC)` CSP-safe + retorna **contagem de mutações** logada; (3) cobertura = a do pass antigo (adoptedStyleSheets/shadow/iframe não serializam no `content()`, logo nem precisam pin); (4) Lottie nunca é tocada (sem vh/vw → sem setter); (5) svh/lvh/dvh==vh em viewport headless. 27 testes (incl. integração Playwright real), suíte **912**, `next build` OK, **Farm Minerals real: CropTab pill nítido** após pin. Extensão fica no whitelist (já protege a corrupção) — CSSOM lá é follow-up opcional (o clone inerte dela seria o "inert clone" do finding 4) — [[checkpoint_2026-07-25_cssom-pin-shipped]].

165. **Nova frente `live-animated-clone-editing` + Task 16 VERIFICADA/BLOQUEADA** (branch `codex/live-animated-clone-editing`). (a) **Contexto:** frente pra editar o CLONE ANIMADO (DOM real + runtime GSAP/Lottie vivo); modelo travado = **freeze-frame** escopado ao viewport; **decisão de produto C (híbrido)** = auto-assentar no look final + scrub manual, escolhida pelo Adilson **na sessão do Sol** (GPT 5.6). Plano `docs/superpowers/plans/2026-07-26-live-animated-clone-editing-implementation.md` (Tasks 1–17). **Modelo de coordenação:** o **Sol dirige** o brainstorm/implementação dessa frente; o **Claude revisa (lead) + faz o [SALVAR]** (memória/CLAUDE.md/vault são infra do Claude). (b) **Task 16 (E2E/security/a11y/perf/visual QA):** continuei EXCLUSIVAMENTE a Task 16 a partir de `624329c8` sob 9 regras estritas → **BLOQUEADA no gate persistido `/canvas`**, parei no bloqueio (regra 7). Verifiquei de 1ª mão (não confiei só no handoff de 27/07): HEAD limpo (nada mudou), preflight `--canvas-only` read-only fail-closed → **`blocked`** (run `task16-20260728115329127-59f32fb3`; `migrated:false`, só `native_bundles`; faltam 4 env `E2E_NATIVE_MOTION_*` + `ALLOW_MUTATIONS`), suíte 1294 pass/4 skip (1 flaky não-Task-16: `lib/snapshot.test.js` hook-timeout sob build concorrente → 27/27 isolado), build exit 0. Handoff `docs/superpowers/handoffs/2026-07-28-task-16-persisted-canvas-still-blocked-handoff.md`, commit **só do handoff** por caminho explícito → `874967aa`. Zero código, Task 17 intocada. **Audit Codex/Sol(max)+agente Claude concordam** (bloqueado→parar é correto); adotei 2 correções de honestidade — (i) "fixtures/sessões ausentes" era overclaim → "não fornecido/verificado" (não checei existência externa, só que não estão wired); (ii) causa do flaky → "não reproduzida/confirmada", sem cravar causalidade; + o agente Claude fortaleceu: veredito **sobre-determinado** (env `E2E_*` faltando já força `blocked`; runner lança incondicional em `spec:509`) e **migrações já existem no repo** (`migrations/2026-07-26-*.sql`), só não aplicadas. (c) ⭐ **NÃO existe DB isolado descartável** — único banco é o Neon de produto (`neondb`); pra desbloquear precisa provisionar DB descartável (ex.: branch Neon) + autorização explícita pra aplicar migração/seed/sessões/bundles nele (o `neondb` NÃO qualifica; migrar nele violaria regra 4 + contrato do fixture) — [[checkpoint_2026-07-28_task16-verification-blocked]].

## Lições permanentes (destiladas dos checkpoints — valem sempre)
- **Anthropic billing**: assinatura claude.ai NÃO credita a API — buckets separados (119).
- **Anthropic SDK**: chamadas com max_tokens 32k exigem `messages.stream()` (112). GPT-5 family / o-series rejeitam `temperature` custom (115).
- **Playwright screenshot**: `clip` SEM `fullPage` é intersectado com o viewport — silenciosamente devolve altura de viewport (152).
- **Playwright: `page.setJavaScriptEnabled` NÃO existe** (é API do Puppeteer) — desligar JS é opção de `browser.newContext({ javaScriptEnabled:false })`. Chamar no page lança `TypeError`; se estiver dentro de try/catch, a feature morre calada (o shadow classifier nunca rodou por isso — 160).
- **Adversarial-review paga**: rodar 2 fornecedores (Claude + Sol) pega o que N lentes de um só modelo não veem — o shadow morto passou por 3 lentes Claude ("é seguro/inerte", verdade) e só o Sol viu que era inerte porque QUEBRAVA (160).
- **Pin de unidade CSS = SÓ em contexto de CSS**: converter `vh/vw`→px por regex global no HTML inteiro corrompe o base64 das data-URIs (o alfabeto base64 tem v/h/w+dígitos; `\d+vh`/`\d+vw` aparece por acaso — 382 hits num Lottie inline de 7,5MB → hero pixelado, o bug do farmminerals). Pinar SÓ dentro de `<style>`/`style=""` e usar `pinCssLengths` (pula comentários/strings/`url()`; guarda de fronteira de identificador salva seletores `.h-100vh`), nunca no HTML cru. Regex não estabelece contexto de parsing de HTML/CSS — o fix DEFINITIVO (contexto real) roda no **DOM via CSSOM antes de serializar** (`pinDomViewportUnits`, SHIPPED em 164): `querySelectorAll` só vê elementos reais, `getAttribute`/`textContent` têm aspas reais → nada de data-URI/SVG/Lottie é tocado por construção. A regex (`pinCssLengths`) segue só pro CSS externo/`<style>`, reconstruída in-page via `new RegExp(source)` — NUNCA `eval` (CSP-safe). Corolário: **"esse clone já funcionou perfeito" = a falha é REGRESSÃO, não limitação** → recusar o tradeoff e caçar a causa (Finding do Adilson). E validar a causa raiz por PROBE antes de fixar derruba causas erradas (do handoff E do próprio autor — o Sol pegou a minha).
- **Idempotência**: um `opId`/UUID fresco por TENTATIVA *impede* a deduplicação de retry — não é segurança. Cobrança-dupla (op paga que commita+cobra e perde a resposta → retry) só se resolve por chave de **OPERAÇÃO LÓGICA** (da borda do request/tool, estilo Stripe) + registro durável que dedup/resume — NUNCA por marcador da tentativa (161). Corolário: investigar o modo de falha e ELIMINAR > escrever a regra de "o que fazer quando falha" (Finding do Adilson). SHIPPED em 162.
- **Etiqueta > relógio**: pra distinguir retry-acidental de re-run-deliberado, só o **pedinte carregando uma etiqueta** acerta — janela de tempo erra (bloqueia re-run rápido) e conteúdo erra (dois re-runs iguais colidem). Vale porque a regra de produto é "resultado consistente, re-run deliberado sempre paga" — sem essa regra, precisaria de janela (162, Finding do Adilson).
- **Cercar (fence) a transição terminal**: quando um worker e uma varredura de reconciliação podem tocar a mesma linha, o settle do worker DEVE ser condicionado a `WHERE status='in_flight'` (numa CTE, com o ajuste de saldo gated em `EXISTS`), senão o reconcile expira+refunda e o settle **ressuscita** a linha e refunda de novo → crédito grátis (162, keystone dos 2 audits).
- **Concorrência de saldo**: débito condicional precisa da checagem `>= valor` DENTRO do `UPDATE ... WHERE` (re-avaliado sob row-lock/EPQ) OU `SELECT ... FOR UPDATE` no snapshot. Um snapshot lido em CTE separada é obsoleto → duas chaves debitam sobre o mesmo saldo → negativo. **NÃO** adicionar `>= valor` a um `upd` que roda depois de um `INSERT` gated — insere a linha com hold não-debitado (bug pior). `FOR UPDATE` é o certo (162, fix do Claude venceu o do Codex).
- **Chave derivada (agente)**: `deriveIdemKey` deve nulificar só no 1º part (scope/runId ausente = sem dedup); empty num part POSTERIOR é valor estável legítimo (sem modelId, prompt vazio) → normalizar pra sentinela, NUNCA nulificar tudo (nulificar = perda silenciosa de proteção de dinheiro). E nunca keyar num valor que muda por tentativa (ex.: nodeId de placeholder recém-inserido) — nunca deduplica (162).
- **Caller que bilha VIA helper não aparece em grep direto**: a rota `/reconstruct` cobra chamando `reconstructSiteNode` (que chama `runBilledOperation` lá dentro) → não sai num `grep runBilledOperation`. Ao auditar cobertura de billing, seguir a cadeia de helpers, não só os callsites diretos (162, o 8º caller escapou).
- **Transação atômica > tratar erro parcial**: writes multi-statement (saldo + auditoria) num `sql.transaction([...])` (neon HTTP suporta) eliminam o estado-pela-metade em vez de tê-lo que "tratar"; `balance_after` vira subquery pra remover dependência JS entre queries (161).
- **Next.js HMR**: Map/estado em module-scope some entre recompiles — stash em `globalThis` (135).
- **Vitest**: mock de SDK precisa ser class-based (`default: class{...}`), `vi.fn(()=>({}))` não é construível (142).
- **Canvas: geometria de porta/slot vive em 3 LUGARES** — CSS + EdgeLayer + findSnapTarget — sempre mudar juntos (151).
- **Escala do chrome**: corpo do node = world-locked px fixo; etiquetas/ferramentas = tela-constante via `--chrome-scale` (piso 0.4); JS usa `chromeScale()` de `lib/canvas-scale.js`, nunca `Math.max(0.4, scale)` cru (148b/150). `toast` é OBJETO (`toast.info/error`), não função (150).
- **Perf**: `will-change` togglado em gesto = re-raster do subtree inteiro; sem `backdrop-filter` dentro do mundo zoomado; hot path de gesto é sagrado (148b).
- **web-shell usa bun** (bun.lock é source of truth), testes Vitest (128).
- **Codex neste repo**: sempre bundle escopado (`--mode diff` estoura com untracked) + `--timeout 1500` (153). `--mode scout` é o lever de budget (154).
- **dev:motion**: porta 3032, `NEXT_DIST_DIR=.next-motion` — build separado fica velho; limpar ao duvidar (154).
- **Tool description é prompt**: o agente LÊ a descrição e obedece (ex.: cap de 16k fazia ele "não conseguir extrair HTML") (151).
- **Operador ≠ conteúdo**: modelo do agente (barato, nosso) ≠ modelo do picker (do user) — [[agent_operator_vs_content_model]]; picker explícito vence tier.
- **Determinístico só onde há DOM**: captura = ground truth; imagem = visão/inferência com bias de prompt (143). Prompt-only bate no teto — ganhos vêm de modelo certo + verdade medida (pixels, crop real) (145).
- **Caminho estático (`lib/snapshot.js`) = fotocópia fiel do DOM** (~6s); `reconstruct.js` = visão (2-3min). Queixas de slop eram do restyle, não da captura (143).
- **sed em valores CSS**: grep pós-sed obrigatório — valores iguais em props diferentes (149).
- **promptfoo**: `not('ASK')` é case-insensitive e casa "T**ask**s" (151).

## Editor Visual — Funcionalidades (Mode A: CSS Live, itens 1–94)
1. ✅ Click-depth selection (drill into nested elements)
2. ✅ Layers panel (esquerda) — árvore DOM lazy, hover sync bidirecional
3. ✅ Sections tab — thumbnails com drag-to-reorder
4. ✅ Inspector panel (direita) — Container, Typography, Appearance, Fill, Stroke, Effects
5. ✅ Spacing guides — rosa, draggable (margin/padding/gap)
6. ✅ Breadcrumb — caminho de ancestrais
7. ✅ Escape key — sobe nível na seleção
8. ✅ Eye toggle — esconder/mostrar elementos
9. ✅ Rename layers — double-click
10. ✅ Color picker — botão direito, 9 cores
11. ✅ Contextual naming — semântica, ARIA, classes, heurísticas
12. ✅ Visual weight + inert detection — filtra wrappers sem contribuição visual
13. ✅ Site wrapper detection ("Page")
14. ✅ Text editing — double-click com suporte a inline children
15. ✅ Image replace — upload/URL
16. ✅ Font size presets (10-128)
17. ✅ Typography: alignment (H+V), case, decoration, line-height, letter-spacing
18. ✅ Drag-to-adjust em valores numéricos
19. ✅ Opacity em porcentagem
20. ✅ Auto-save (localStorage + hash cache)
21. ✅ Alt+L toggle layers panel
22. ✅ Light/dark mode — sun/moon toggle, localStorage persistence, dark default
23. ✅ Image popup panel — swatch field + popup com thumbnail/replace/download
24. ✅ Fill/Stroke/Effects auto-expand — collapsed com "+" quando vazio
25. ✅ Drag-to-adjust nos ícones de line-height/letter-spacing
26. ✅ Frosted glass mini widgets
27. ✅ CSS isolation — font-family !important contra bleed do site
28. ✅ Undo/Redo — applyUndoEntry(forward), 9 tipos, Cmd+Z/Shift+Z/Y
29. ✅ Text edit undo — contentEditable nativo, __textEdit no exit
30. ✅ Clipboard — Cut/Copy/Paste com navigator.clipboard + fallback
31. ✅ Find — overlay de busca com cycling
32. ✅ Logo dropdown menu (Saved versions/Export/Undo/Redo/Cut/Copy/Paste/Find funcionais)
33. ✅ Saved versions history — snapshots do persist.js, restore com confirm()
34. ✅ Mode E persistent toast — auto-dismiss 5s/10s
35. ✅ Mode E 90s timeout
36. ✅ Fill popup — 3 popups: Background (Color/Gradient/Image/Effects), Image-only, Color-only
37. ✅ Canvas color picker — HSB box + hue + alpha, zero dependência (iro.js removido por CSP)
38. ✅ Gradient editor — Linear/Radial, stops editáveis, reverse, add/remove
39. ✅ Effects gallery — 12 efeitos CSS animados
40. ✅ Format dropdown — HEX/RGB/HSL/HSB/CSS
41. ✅ Per-row eye + minus
42. ✅ Tab switching preserves state
43. ✅ Uniform field height — 25px
44. ✅ Text colors centralizadas em Fill
45. ✅ background-clip:text — gradientes/imagens/efeitos dentro do texto
46. ✅ Gradient handles draggáveis na preview bar
47. ✅ Effects via ::before — opacity independente
48. ✅ Frosted glass popups (undocked)
49. ✅ Image como elemento — upload cria `<img>` real
50. ✅ Color Library — Custom swatches (localStorage) + From this website
51. ✅ Add swatch button (+)
52. ✅ Link/unlink chain icon — single element vs classe CSS
53. ✅ applyStyle exclui editor UI
54. ✅ Popup viewport clamping — clampPopupToViewport()
55. ✅ Image minidock (Copy, Replace, Download, Smart Edit, Close)
56. ✅ Text minidock (Font, Size, Weight, Letter/Line spacing drag)
57. ✅ Minidock frosted glass
58. ✅ Assets tab 3 seções — Images, Icons, Backgrounds
59. ✅ Video minidock
60. ✅ S2H multi-viewport
61. ✅ Mode S: S2H dedicado
62. ✅ Framer canvas-fixed fix (`--framer-canvas-fixed-position:absolute`)
63. ✅ Guides: modifiers — Alt (mirror), Shift (uniform), Cmd (snap 8px)
64. ✅ Guides: arrow-key nudge ±1px (Shift ±10, Cmd ±8)
65. ✅ Guides: G toggle
66. ✅ Guides: inline input (dblclick no label)
67. ✅ Guides: delta preview durante drag
68. ✅ Guides: visual refresh (anel inset)
69. ✅ Guides: corner handles (drag altera 2 lados)
70. ✅ Smart text cascade — isTextWrapper, cascade pra leaves, "Mixed"
71. ✅ Font field multi-font ("Clearface, Geist" + Enter guard)
72. ✅ Range-scoped typography (span wrap, 9 props)
73. ✅ Typography Style row — Bold/Italic toggles
74. ✅ Font combobox search-as-you-type
75. ✅ Inspector value guards (empty/NaN restaura)
76. ✅ Inspector X/Y wired (left/top)
77. ✅ Inspector values left-aligned
78. ✅ Compact "Selection colors" row (+N pill)
79. ✅ Keyboard guard no inspector (inputs mantêm shortcuts nativos)
80. ✅ Resize W/N compensation (lazy unlockResize)
81. ✅ Position override via ID selector (React/Framer stripam className)
82. ✅ Hover-first click resolution (user seleciona o que viu)
83. ✅ Guides pass-through (threshold 3px)
84. ✅ Framework override — sticky MutationObserver writes (ver Padrões abaixo)
85. ✅ X/Y auto-promote static→relative + readPosXY correto
86. ✅ Link section no inspector (wrap em `<a>`, undo types próprios)
87. ✅ Link icon no minidock (text + image)
88. ✅ Font picker compartilhado (openFontPicker)
89. ✅ Click-to-type nos valores do minidock
90. ✅ Ícones permanentes no text minidock
91. ✅ Widget de modos compacto (MODE_LIST — modo novo = 1 linha)
92. ✅ Corner handles quando QUALQUER margin ≥ 2px
93. ✅ Font dropdown position:fixed no body (escapa overflow)
94. ✅ Guide editing blur em qualquer click fora

## Mode E: status estratégico (2026-05-28)
**Decisão atual:** Mode E preservado intencionalmente como **backup + história**. Não consolidar variantes nem deletar arquivos até o usuário avaliar manualmente qual variante entrega melhor resultado em campo. **NÃO deletar nada de Mode E sem confirmação explícita do usuário com base em teste.**
- **Iter 9 (reconstruct) supera Mode E na missão original** — mais barato (~$0.10-0.25 vs $0.53/clone), pixel-perfect via auto-raster, single vision call. [[architecture_iter9_vs_mode_e_2026-05-28]]
- Cloudflare/login não requerem Mode E (handoff flow resolve); live edit in-page cobre 80%+ (framework override).
- Variantes em revisão pós-teste: mode-e-classic (E0), mode-e2, mode-b, EL Lean.
- Detalhe de implementação (hardening 035, Lean, Classic, refine M1/M2, asset manifest, S2H): `docs/CLAUDE-ARCHIVE-2026-07-20.md` + [[project_mode_e_lessons]] + [[project_s2h_lessons]] + checkpoints 033–035.
- Fidelidade observada: baseline ~65-75% → com DESIGN.md rico ~85-93% → com refine ~95%.

## Bugs conhecidos e padrões descobertos

### Padrão crítico: drag handlers em canvas mode precisam dos dois docs
**Problema**: Em canvas mode (`hostDoc !== targetDoc`), eventos mousemove/mouseup que originam DENTRO do iframe (target) NÃO bubble pro host doc. Drag handlers que escutam só `hostDoc.addEventListener('mousemove'/'mouseup')` ficam presos quando o cursor entra na área do iframe — mouseup nunca chega → drag em estado ghost-pressed → onMove dispara em loop conforme o cursor se move.

**Pior ainda**: `ev.clientX/Y` em eventos do iframe é em coords do **iframe viewport** (largura natural, ex 1280), enquanto `dragStartPos` capturado no mousedown do host está em coords do **host viewport**. Comparar os dois dá deltas absurdos.

**Solução** (editor.js):
- `bindDragOnBothDocs(move, up)` / `unbindDragOnBothDocs(move, up)` — registram em host + target quando docs são distintos.
- `eventToHostXY(ev)` — detecta `ev.view === targetWin` e converte iframe-coords → host-coords via `iframe.getBoundingClientRect() + scale`. Aplicar em TODA leitura de `ev.clientX/Y` em drag.
- Scale-aware delta: em zoom < 1, host-px delta dividido pelo `_scale` antes de virar valor CSS.
- Stash de elemento alvo (`var resizeEl = selectedEl`) no mousedown — closure pode virar null mid-drag.

**Aplicado em**: spacing-guide drag, corner-guide drag, selection-resize handles. ~6 outros handlers ainda só em host — migrar quando bug surgir.

### Padrão crítico: framework override (React/Framer/Hydrogen)
Sites com framework reativo reescrevem `style=""` e `className` no próximo render. Defesas cumulativas em `applyStyle._verifyApply`:
1. **Inline !important** (primeiro write) — vence especificidade normal
2. **ID rule !important** (`applyOverrideClass`) — vence quando framework rewrite `className`
3. **Sticky MutationObserver** (`startSticky`) — vence quando framework reescreve `style`. Dedup por `getCS === rec.value`. Disable após 5 fails em 2s.

Limite: full remount perde WeakMap. Em undo do `__cascade`, chamar `stopStickyForEl` antes de restaurar cssText.

### Padrão: dropdowns dentro do inspector devem ser `position:fixed` + body
`#rb-editor-inspector` tem `overflow:hidden` — dropdown `position:absolute` interno é clipado. Apend em `document.body` com `position:fixed` + reposição via `getBoundingClientRect(anchor)`. Cleanup em `updateInspector` e `deactivate`.

### Padrão: guide inline-edit input deve blurar em qualquer click fora
No mousedown capture do editor, se `e.target !== activeGuideInput`, chamar `.blur()` explicitamente. Comparar widgets deixa brechas.

### Padrão crítico: refactor `<select>` → `<input>` tem pontos cegos
Ao trocar select por input, `grep` TODAS as referências `.options`, `.selectedIndex`, `.multiple` antes de commitar.

### Padrão: position X/Y em elementos static
`position: static` ignora `left`/`top`. Antes de escrever, `ensurePositionable(el)` promove pra `relative`. Leitura: `readPosXY(el)` — nunca `r.left` (viewport).

### Padrão crítico: botões do editor
**TODOS os botões do editor UI: `mousedown` com `capture:true` + `stopImmediatePropagation()`.**

### CSS do editor: self-injection
`chrome.scripting.insertCSS` pode falhar silenciosamente. editor.js injeta o próprio CSS via `<link>` tag; arquivo em `web_accessible_resources`.

### CSS de sites interferindo
Sites com Webflow IX3/GSAP podem aplicar `opacity:0`/`visibility:hidden` aos painéis via seletores genéricos — editor.css protege com `!important`.

### rebuild.js v5 crashava o editor
Stylesheet extraction causava crash silencioso na inicialização. Revertido pra v4; re-implementar só como arquivo separado.

### Service worker e sendMessage
`toggleEditor` no background.js: `return true` + `sendResponse()` pra manter o worker acordado na injeção async.

### captureVisibleTab captura a aba ativa, não a do sender
background.js usa `sender.tab` e foca a aba antes de capturar.

### Chunked pipeline requer Tailwind CDN
`replacePageContent()` injeta o CDN no chunked path; viewport path usa inline styles.

### Prompt hardening degrada qualidade
Temperature baixa, topP, thinkingConfig, blocos "CRITICAL" e retry agressivo pioram o output do Gemini. Defaults + retry suave.

### FAB (Live Remix) removido
Causava bugs de display restore. Não reimplementar.

## Abordagens Técnicas de Clonagem
Três estratégias: **1. DOM Mirroring** (`document.styleSheets` originais, ~95% fidelidade — Mode B); **2. Vision-to-Code** ⭐ (screenshot → LLM → HTML, recomendada — Mode E/reconstruct); **3. Runtime Interception** (100% mas frágil — NÃO implementar).

Teardowns completos no archive + memórias:
- **Aura.build** — [[research_aura_build]]: hierarquia screenshot > DOM > DESIGN.md semântico; multi-modelo (GPT-5.4 HTML, Sonnet componentes, Flash paleta); modes EXACTLY/Different; NÃO compara com original (gap explorável = nosso diff-refinement).
- **same.new** — [[research_same_new_magic]]: agente coding genérico GPT-4.1 (leak x1xhlol), chunking CONVERSACIONAL, refinement via screenshot próprio (cap 3 loops), stack Next+shadcn travado.
- **CloneWebX** — [[research_clonewebx_magic]]: sem AI na hot path — transpiler DOM → schemas de clipboard (Webflow/Elementor/Bricks, formatos públicos). Adapter path trivial quando houver demanda.
- **Reforge** — DOM Mirroring com stylesheets originais; esconde animados com `visibility:hidden`; confirma styleSheets > getComputedStyle.
- Técnica recomendada: **DOM + Screenshot hybrid** (ambos no prompt).

## Integração OpenPencil (futuro)
Editor Figma-like MIT, lê/escreve .fig, 100% browser. Visão: embed como iframe. [[reference_openpencil]].

## Branding
- **Nome:** Uncraft · **Slogan:** "Design without borders" · Wordmark "Un" Medium + "craft" Light/0.62.
- **Tipografia (extensão):** Instrument Serif (display) + Instrument Sans (body/UI).
- **Tipografia (web-shell):** **Aeonik** local (`packages/web-shell/public/fonts/aeonik/*.otf`, @font-face em globals.css).

## Web-shell — design system + arquitetura
> **Fonte canônica: [`DESIGN.md`](DESIGN.md) na raiz.** Ler ANTES de qualquer decisão visual/UI. Tokens reais em `packages/web-shell/app/globals.css` (`@theme` + `:root` + `body.rb-ed-light`). Usar tokens (`var(--accent)`, `var(--surface)`, `var(--blur-chrome)`…), não literais. Não desviar sem aprovação; em QA, sinalizar código fora do DESIGN.md.
- Tokens-chave: `--bg-base: #0a0a0a`, `--bg-frosted`, `--border-frosted(-strong)`, `--text-primary/secondary/muted/faint`, `--shadow-frost`, `--radius-pill/sm/md/lg`.
- **Família frosted-glass**: prompt-dock, canvas-header, minidock, menus, sidebar, signin, user-menu, confirm cards — `rgba(10-26,…,0.5-0.78)` + `backdrop-filter: blur(28px) saturate(140%)` + hairline 1px. (⚠️ nunca backdrop-filter DENTRO do mundo zoomado — lição 148b.)
- Componentes: BoardsList (sidebar 240px), UserPill, PromptDock (executor geral do agente), CanvasContextMenu, ResetConfirm, ChatPanel, NodeProgressRing, WorkingIndicator.
- **Color-coded edges/borders** via `lib/node-origin.js`: URL/blank=`#2966EA`, HTML=`#f97316`, MD=`#34d399`, Screenshot=`#a78bfa`.
- Node ports: emitter right (drag pra conectar), receiver left (drop via closest); `.cnode { overflow: visible }`.

## OAuth (estado)
- `.env.local`: `GOOGLE_OAUTH_CLIENT_ID` + `GITHUB_OAUTH_CLIENT_ID` provisórios; `*_CLIENT_SECRET` placeholders.
- Routes `app/api/auth/oauth/{google,github}/{start,callback}/route.js` — start funcional com secret; **callback = STUB** (token exchange + user link + JWT cookie pendente).
- Schema migration pendente: colunas `oauth_provider` + `oauth_sub` em `users`.

## Reset feature
- `POST /api/nodes/[id]/reset` — aponta `current_snapshot_id` pro primeiro snapshot. Modal de confirmação obrigatório. Durante edição: fechar editor primeiro (+120ms) antes de swap srcDoc.

## Setup de memória (atualizado 2026-07-19)
**mem0 DESINSTALADO em 2026-07-19.** Motivo: redundância com custo (~100-150 tokens/mensagem em hooks; busca semântica nunca usada). As 148 memórias seguem na nuvem do mem0 e `~/.mem0/` foi preservado — reinstalar é 1 comando. **Fonte de verdade de memória: nativo (MEMORY.md + checkpoints) + vault Brain, apenas.** Detalhes: `docs/superpowers/handoffs/2026-07-19-compaction-and-memory-handoff.md`.

## Regras de desenvolvimento
- Incrementar versão a cada release significativo
- Injeção: detect.js → freeze.js → extractor.js → persist.js → mode-e.js → s2h.js → rebuild.js → fill-popup.js → editor.js
- CSS scoped via IDs `rb-editor-*` e classes `rb-*`; `isEditorEl(el)` reconhece `rb-editor*` E `rb-ed-*`
- **TODOS os botões do editor: `mousedown` + `capture:true` + `stopImmediatePropagation`**
- Editor.js self-injeta CSS via `<link>` tag
- Funções/variáveis compartilhadas entre escopos: escopo externo da IIFE (NÃO dentro de `listen()`)
- Editor compartilhado: editar em `packages/editor-core/src/` e rodar `bash scripts/build-editor.sh`
- Checkpoint stash: `git stash push -m "checkpoint-NNN"`
- Modelo Gemini atual: `gemini-3.1-pro-preview` (panel.js MODEL_DEFAULTS + background.js)
- Settings UI vive em `panel/panel.js`; `popup/` atual é o widget Collect Assets
- rebuild.js v5 crasha o editor — usar v4
- **Todos os campos do inspector: 25px de altura** — sem exceção
- Fill popup: canvas picker nativo (iro.js quebra em CSP); `background` shorthand sobrepõe `background-color` — limpar ao re-aplicar
- `chrome.scripting.insertCSS` cria stylesheets user-origin — animações do site congelam via JS, não CSS
- Effects usam `::before` com `z-index:-1`; popup lê `cs.color` ou `cs.backgroundColor` conforme o `prop`
- `applyStyle` cascade exclui `#rb-editor-root`, `#rb-editor-inspector`, `#rb-ed-banner`
- Popups chamam `clampPopupToViewport(popup)` após appendChild
- Custom swatches em `localStorage` key `rb-custom-swatches`
- **Texto de produto user-facing em INGLÊS** (conversa em PT) — [[feedback_ui_text_english]]
- Nunca especificar fontes JetBrains (regra fixa — skill no-jetbrains-fonts)
