# Handoff — frente live-animated-clone-editing: FEATURE caminho-seguro (entry-edit da forma array) + roadmap restante

**Date:** 2026-07-29 · **Branch:** `codex/live-animated-clone-editing` · **HEAD:** `14eec627` (docs) sobre `b0d667aa` (furo #2 SHIPPED) · **Working tree LIMPO** (só untracked deliberados: witness + probes, ver §Como rodar).

**Regras da frente:** Sol dirige; Claude executa + [SALVAR]. **STANDING: TODO trabalho substantivo com auditoria do Sol antes do commit** (bundle escopado `--mode prose`, effort max, **veto assimétrico = verificar rodando — nas DUAS direções**: no furo #2, 9 achados dele foram aceitos após probe e 2 prescrições dele foram REFUTADAS por probe). Método: **probe no GSAP 3.15 real decide** (`~/Desktop/IA/Unspirit-Clone-1to1/site/assets/gsap/3.15.0/gsap.min.js`), TDD estrito (RED observado), 1 commit/item.

**Decisões de produto do Adilson (STANDING):** 2 animações num elemento → AMBAS nos controles, cada uma editável; NUNCA dialog bloqueante sem escolha; NUNCA lock generalizado (o v11 do Sol pediu lockdown de todos os canais na presença de plugin desconhecido — REJEITADO por esta regra). Scale uniforme proporcional = desejado. UI text em INGLÊS.

---

## 1. COMEÇAR AQUI — FEATURE caminho-seguro: retarget real da forma array de keyframes

**O que é:** tweens `keyframes: [{x:0},{x:60}]` (forma array) hoje são detectados (furo #1) mas 100% read-only (`retargetable:false`, `keyframeEditable:false` reason `keyframes`). O probe de 2026-07-29 (semântica EXATA `invalidatePreservingStart`) provou writeback SEGURO: **editar as ENTRADAS de `vars.keyframes`** + preserved-start → path `[0,0,100,200,200]` limpo (início intacto, forma preservada, fim retargetado). O writeback atual (`vars[prop]`) corrompe mesmo com preserved-start — NUNCA usar pra keyframes (guarda existente fica).

**Trabalho (do finding doc + handoff anterior):**
- Semântica multi-entrada: quais entradas carregam o valor final → **trailing run** (todas as entradas finais consecutivas com o mesmo valor do fim recebem o novo valor; entradas intermediárias intactas).
- Undo: restaurar as ENTRADAS exatas editadas (não vars top-level) — cuidado com o stale-descriptor (lição do rollback do furo #2: o writer acha o bucket pelo estado ATUAL, não pelo descriptor).
- Loops/unidades; formas: SÓ a forma **array** destrava (`[{x, duration}...]`); property-array `{x:[...]}` e stops `"50%"`/numéricos seguem sem caminho (no-op probado) → classificação POR-FORMA.
- Flip de `retargetable` pra array-form nas tracks keyframe-driven; `keyframeEditReason` deixa de ser `keyframes` pra essas.
- ⚠️ GSAP **MUTA** as entradas de `vars.keyframes` em runtime (injeta parent/ease/overwrite/delay/duration — lição do furo #1): o writer precisa distinguir chaves autorais de injetadas (o `gsapKeyframeProps` já filtra por `GSAP_CONFIG_VARS`).

**Infra pronta do furo #2 pra usar:** `keyframeEditable`/`keyframeEditReason` por track (o canal que esta feature flipa); capability derivada (`tracks.some`) — habilitar a track array-form ativa o clip automaticamente; predicado único classificador↔writer (seguir o padrão).

**Sequência:** probes de borda (trailing run com 3+ entradas; entradas com valores mistos; unidades; loop repeat -1; css DENTRO de entry — recursão já existe) → RED (bridge: classificação por-forma + writer entry-edit + rollback; controller/UI já consomem a flag) → GREEN → suíte + witness estendido → rodadas Sol até MERGE OK → commit único.

## 2. FASE 2 — editar ETAPAS INDIVIDUAIS na timeline
Diamantes por etapa (offsets derivados das durations das entradas), edição de cada etapa via entry-edit do item 1, afrouxar a guarda do `applyGsapKeyframe` SÓ pra forma array. Produto: a coreografia inteira editável passo a passo. A infra per-track do furo #2 é o pré-requisito (pronto).

## 3. Furo #4 — multi-target/split-text ownership
Ownership atribuída ao 1º target; selecionar o 2º membro filtra o candidato (`motion-ownership.js:102-103`) → `unowned` → style-stomp. Fix: membership vs target efetivo; classificar `unsupported/shared`, nunca `unowned`. **Esbarra no unchain da Task 12 do gate** — coordenar com o Sol. Roadmap adjacente (residual v11): mapa validado de outputs de plugins conhecidos (scrollTo→scroll, text→textContent...).

## 4. Fila da Task 16 (gate persistido /canvas) — pausada
- Task 12 (ambiguous/unlink/reconnect): handoff `2026-07-28-task16-task12-ready-handoff.md` COM ADDENDUM — fixture do chooser = **Entrance+Hover**; regra do Adilson (ambas nos controles) orienta o redesign COM o Sol.
- Tasks 13–18 + 19–20: plano `2026-07-28-task16-persisted-e2e-gate-implementation.md`. Env isolado Neon `ep-orange-frost-acaedcil` PRONTO (NUNCA produção).

## 5. Residuais conhecidos (documentados, não-bloqueio)
- **v10**: plugin registrado que RECUSA `undefined` → linha read-only espúria na timeline (fail-closed; witness `#declined`).
- **v11**: plugin imperativo hipotético escrevendo CSS sem PropTween → fora do modelo de canais declarados (mesmo limite do HEAD/WAAPI/`onUpdate`; mitigação = framework-override; hardening = mapa de outputs, item 3).
- Foco de teclado do LAB (3032) não move ao ativar o cadeado (tabs sem id; superfície dev).
- endOnly fallback: valores de função viram `''` (convenção). `keyframeEditReason:'sampling'` tem texto genérico.
- validate-transaction sem caller de produção no host (agora testada no caminho motion/retarget).

## Como rodar
- Suíte: `cd packages/web-shell && npx vitest run` (esperado: **1325 passed / 10 skipped**).
- Witness furo #2 (PRESERVADO, re-rodar após qualquer mudança no bridge): `node _probe-furo2-witness.mjs` na raiz do web-shell (esperado **37/37 TUDO VERDE**; 9 seções incl. plugins e residual declined).
- Probes reproduzíveis (untracked, raiz do web-shell): `_probe-mix-debug` (fantasma), `_probe-validate-retarget`, `_probe-attr-stagger`, `_probe-scalar-plugin`, `_probe-plugin-case`, `_probe-plugin-undef`, `_probe-ptlookup` (refutação v10). ⚠️ Rodar de DENTRO de `packages/web-shell` (node_modules).
- Sol: `cat <bundle.md> | ~/.claude/bin/codex-adversary.sh --mode prose --timeout 1500 --focus "..."` (bundle = contexto autocontido + `git diff` dos arquivos; nunca `--mode diff` neste repo).

## Docs canônicos
- Finding do arco (inventário, probes, placar das 12 rodadas, residuais): `docs/superpowers/handoffs/2026-07-29-gsap-ownership-audit-finding.md` (addendum sessão 2 no fim).
- CLAUDE.md itens 168/168b. Memória: [[checkpoint_2026-07-29_gsap-ownership-audit-furos]]. Vault: `Sessões/checkpoint_2026-07-29_gsap-ownership-furos` (parte 3).
