# Fase 1 / Chaves B5+B6 — Per-target override sob repeat/yoyo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans, task-a-task, TDD com RED observado.
> Advise do Sol incorporado (2026-08-05, mode advise/max — brief `b5b6-design-brief.md`).
> ⚠️ **Emenda doutrinária pendente de ciência do Adilson** (§Decisão Q1) — implementada por
> recomendação do Sol, sujeita ao MERGE OK da audit; flag no [SALVAR].

**Goal:** Promover **B5** e **B6** da Tabela B pro degrau 3 como **predicados quantificados**
(recomendação do advise): B5 = `multi-target plano · repeat INTEIRO positivo finito, yoyo:false,
sem outros modificadores temporais · per-target · patch real`; B6 = idem com `yoyo:true`. Prova
por MATRIZ (não 1 exemplar): B5 em n=1, n=2 (parado em iteração posterior) e n=5; B6 em n=1, n=2
e n=3 (paridade final par E ímpar). Witness próprio por chave, protocolo v2, GSAP 3.15 real.

## Fatos probe-grounded (2026-08-05, todos no GSAP 3.15 real)

- F1/F2 (`_probe-b5b6-facts.mjs`): wrapper per-target + `invalidatePreservingStart` limpo sob
  repeat:2 (park 1.5) e repeat:3+yoyo (perna de volta); irmão byte-igual à referência.
- F3: atestação atual (`sampleGsapValue(...,1)` + restore por totalTime) mede o endpoint autoral
  correto nas duas chaves; round-trip exato. Sem mudança na atestação (Sol concorda, Q4).
- Exóticas (`_probe-b5b6-exotic.mjs`): 8 posições (fronteiras exatas, t=0, última perna, fim
  absoluto) limpas. ⚠️ Esses probes são INSUMO, não evidência — os witnesses assertam (Sol Q7).
- F4 (controle): invalidate cru corrompe (classe P6b) — instrumento sensível.
- Claims GSAP do advise (`_probe-b5b6-gsap-claims.mjs`): `repeat:0.5` ACEITO (meia iteração,
  totalDuration 1.5); `repeat:Infinity` e `repeat:-2` → `repeat()` devolve **null**; `-1` → -1;
  marcador de infinito = `totalDuration() === 1e10` (**FINITO** — a prescrição "totalDuration não
  finito" do advise NÃO discrimina; o discriminador é `Number.isSafeInteger(repeat())`);
  `repeatDelay` via setter deixa `vars` ausente (getter vivo obrigatório); `iteration()` existe.
- Write model: repeat FINITO publica `absolute` (additive-base = só infinito, fora das chaves).
  Explícito no addendum: NADA aqui promove write model per-target `additive-base` (Sol Q1).

## Decisões (Claude lead, pesando o advise)

- **Q1**: família quantificada COM matriz (recomendação do Sol). Emenda na Tabela B explícita;
  linhas viram predicados quantificados com a matriz como prova. Flag pro Adilson.
- **Q2**: `repeatDelay` recusa, lido do GETTER vivo (`animation.repeatDelay()`).
- **Q3**: `yoyo` com `repeat:0` recusa com mensagem própria (inerte, sem linha, sem probe sensível).
- **Q4**: atestação inalterada; witnesses congelam `iteration()`, `progress()`, valor e tick ±ε.
- **Q5**: classificador temporal ÚNICO consumido pelas 5 lanes (abaixo).
- **Q6**: dois witnesses, dois baselines, B5 e B6 em rodadas/commits/audits separados.
- Recusas novas testadas por MENSAGEM: infinito/inválido (null/-1/-2/Infinity/fração/duração-zero),
  repeatDelay, repeatRefresh, yoyoEase, easeReverse (real — já em GSAP_ADAPTIVE_SAMPLING_KEYS),
  yoyo-sem-repeat, ScrollTrigger presente, tween com parent ≠ timeline raiz.

## Global Constraints

- Herdadas do plano B4 (witnesses de `packages/web-shell`, caminhos absolutos, TDD com RED,
  write model/perTarget derivados da PUBLICAÇÃO, texto user-facing inglês, tudo com Sol).
- Suíte baseline 1589/1589; witnesses B4 BATE/editwrite BATE/detach 11 RED intocado.
- Lição r3–r6: fix num gate exige re-examinar TODAS as lanes; por isso Task 2 vem ANTES dos
  witnesses.
- "O que faria o plano virar erro caro" (advise, verbatim): abrir todo repeat finito a partir de
  2 exemplares SEM a matriz; usar `vars.repeatDelay` como verdade; confiar em endpoints pra
  detectar alteração de trajetória interior; assumir tween pausado.

---

### Task 1: Classificador temporal + gate (TDD)

**Files:** `runtime-bridge-source.js` (novo `gsapTemporalShape(animation)` + integração em
`gsapPerTargetEligibility` ~4870 + mensagens novas em `B4_REFUSAL_MESSAGES`),
`runtime-bridge-source.test.js` (seções B4 ~12929; asserts 'loop' atuais mudam de fronteira).

Classificador (retorna `{ kind: 'none'|'finite-repeat'|'finite-repeat-yoyo'|'infinite'|'invalid',
reason }`), lendo GETTERS vivos com fallback vars (doubles):
- `repeat()` → não-safe-integer (null/fração/Infinity) ou negativo → `infinite`/`invalid`;
- `repeatDelay()` > 0 → recusa própria;
- adaptativos (`repeatRefresh`/`yoyoEase`/`easeReverse` — reusar predicado sobre vars com
  for..in mirror) → recusa própria por chave;
- `yoyo()` com repeat 0 → recusa própria;
- `record.scrollTrigger` presente → recusa própria; `animation.parent` ≠ timeline raiz → recusa
  própria (probe do parent primeiro: to() normal → globalTimeline).

- [ ] Step 1 — Testes RED (doubles): commits repeat:2 e repeat:3+yoyo; recusas POR MENSAGEM:
  -1, -2, Infinity, 0.5, repeatDelay-via-getter (vars ausente!), repeatRefresh, yoyoEase,
  easeReverse, yoyo+repeat:0, scrollTrigger, parent-timeline; writeModel do host não desbloqueia
  (fronteira nova: repeat:-1); publicação `perTarget` presente pra repeat finito, ausente pras
  formas recusadas.
- [ ] Step 2 — RED observado e registrado.
- [ ] Step 3 — Implementar classificador + integrar no gate (funil único).
- [ ] Step 4 — Suíte inteira verde + witnesses antigos BATEM.
- [ ] Step 5 — Commit.

### Task 2: As 5 lanes (TDD por lane)

- [ ] **Lane timing** (`timing.playbackMode/iterations/yoyo/repeatDelay` ~5716): com canal
  ACTIVE na animação, mutação de timing que tornaria a forma inelegível → recusa fail-closed
  com mensagem própria (user precisa resetar overrides primeiro). RED: playbackMode 'loop'
  (repeat(-1)!) com canal ativo.
- [ ] **Lane group-edit** (~5274): com canal ativo, recompõe elegibilidade TEMPORAL antes do
  write full-scope (drift da página pra forma proibida → recusa, não só carrier/endpoints).
- [ ] **Publicação** (~2426): split capability — `available` (canal vivo OU elegível) +
  `writable` (forma ATUAL elegível pra write novo). Drift pós-canal → `available:true,
  writable:false` (clear continua possível; write novo recusa).
- [ ] **Clear/teardown adaptativo**: clear com entrada real sob adaptativos
  (repeatRefresh/yoyoEase/easeReverse) → recusa (invalidate pode re-rollar interior sem divergir
  endpoint); teardown sob adaptativos → colapsa SEM invalidar (mesma doutrina do random).
  No-op clear SEGUE antes de todos os gates.
- [ ] **Validate/rollback**: validate-transaction (aplica+restaura 2×) sobre v3 em repeat;
  falha multipatch DEPOIS de override verificado → rollback reverso replaya o clear exato;
  gesture cancel + replay de manifest.
- [ ] Commit por lane ou agrupado com RED por lane.

### Task 3: Witness B5 (`_probe-b5-witness.mjs` + baseline)

Matriz: n=1 (t-park 0.7), n=2 (t-park 1.5, canônico), n=5 (t-park 4.2). Protocolo v2 real,
writeModel/perTarget derivados da publicação. Por instanciação: alvo parcial, trajetória clock
TOTAL com irmão byte-igual, fronteiras exatas + ticks ±ε, `iteration()`/`progress()` congelados,
contagem onRepeat/onUpdate/onComplete vs referência, rollback exato (clear replay + colapso pro
shared atual), inherit, tombstone reactivation, TWEEN RODANDO (1 caso: write mid-play, valores
pós-write consistentes), controle de sensibilidade (escalar cru contamina + invalidate cru
corrompe), boundaries por MENSAGEM (Infinity/-1/-2/0.5/repeatDelay/repeatRefresh/yoyoEase/
easeReverse/yoyo-sem-repeat/ScrollTrigger/parent-timeline), publicação `writable:false` sob
drift de timing.

- [ ] `--record` congela baseline; assertivo 0 RED.
- [ ] Commit.

### Task 4: Audit Sol do B5 → MERGE OK → só então Task 5

- [ ] Bundle escopado (diff + witness + fatos), rounds até MERGE OK, cada achado com RED antes
  do fix.

### Task 5: Witness B6 (`_probe-b6-witness.mjs` + baseline) + audit própria

Matriz: n=1 (park na volta 1.5 — descanso no início), n=2 (park 2.3 — descanso no fim), n=3
(park na volta 3.5, canônico). Específicos yoyo: pernas espelhadas, pico/vale, atestação parada
na volta mede fim da IDA, fim absoluto por paridade. Mesmas obrigações da Task 3.

- [ ] Baseline + 0 RED + audit Sol → MERGE OK.

### Task 6: Fronteira do witness B4 + promoção + [SALVAR]

- [ ] Check (j) do B4: `repeat:-1` vira a fronteira permanente (Infinity/fração/repeatRefresh
  ficam no vitest, sem inflar o baseline B4); re-congelar baseline; documentar no addendum.
- [ ] Emenda doutrinária + promoção B5/B6 na Tabela B (matriz como prova, estreitamentos,
  residuais, nota explícita: additive-base per-target NÃO promovido).
- [ ] Handoff + [SALVAR] com flag da emenda pro Adilson.
