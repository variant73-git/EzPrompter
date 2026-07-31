# Handoff 2026-07-31 — Caminho-seguro FECHADO (MERGE OK r126) → próximo: fase-2 timeline

> **Para a próxima sessão.** Frente `live-animated-clone-editing`, branch `codex/live-animated-clone-editing`.
> Estado ao escrever: HEAD `13d62b82` · suíte **1469/1469** · witness feature **114/114** · witness furo #2 **37/37**.

## 1. O que acabou de fechar (contexto mínimo)

A feature **caminho-seguro** (retarget/step-edit da forma ARRAY de `vars.keyframes` via edição das ENTRADAS + `invalidatePreservingStart`) está **completa e auditada**:

- `18b656b7` — feature shipped (40 rodadas Sol pré-ship).
- `d630ded9` — **85 achados pós-ship (rodadas 42–125) corrigidos** após a quota do Codex voltar; **MERGE OK explícito do Sol na rodada 126**.
- Placar total: **126 rodadas · 125 achados corrigidos · 2 prescrições do Sol refutadas por probe**. Todo fix com TDD (RED observado) + witness no GSAP 3.15 real.
- Docs: CLAUDE.md itens **169/170** · memória `[[checkpoint_2026-07-31_safe-path-merge-ok]]` · vault Brain `Sessões/checkpoint_2026-07-31_caminho-seguro-merge-ok`.

**Nada pendente desta feature.** O working tree está limpo (probes `_probe-*.mjs` seguem untracked por convenção).

## 2. FILA — o que falta (em ordem acordada)

### 2.1 Fase-2 timeline (PRÓXIMO ITEM — começar aqui)
Editar **etapas individuais** dos keyframes na timeline (hoje os steps intermediários são read-only; só o END/START do trailing run edita).

- **O que é:** diamantes por entrada na TimelinePanel — cada keyframe da forma array vira um ponto editável (valor e, na fase seguinte, offset/posição).
- **Infra pronta pra reusar:**
  - `gsapArrayKeyframePlan` (predicado único, trailing run, buckets/carriers/allEntries) — a extensão natural é planejar um **bucket intermediário específico** em vez do trailing run.
  - `applyGsapKeyframeEntryEdit` (binding congelado, restore verbatim, pré-simulação r21) — o binding por (animation, property) precisará virar por (animation, property, **entryIndex**) ou equivalente.
  - Per-track `keyframeEditable`/`keyframeEditReason` (infra do furo #2) — a UI já é flag-driven.
  - O reader transacional de `keyframe.<prop>` (offsets 0/1) precisará aceitar offsets intermediários.
- **Cuidados conhecidos (da malha construída):**
  - Editar entrada intermediária muda o RENDER do segmento vizinho — a pré-simulação de ambiguidade (r21: valor igual ao vizinho com unidade diferente) vale dobrado.
  - Duplicata não-trailing (probe J): escrever um bucket intermediário que colide com o end pode reinterpretar o trailing run do próximo plano — congelar por índice, nunca recomputar no undo (lição probe I).
  - TODA a malha r42–r125 (hazard tri-state, sharing, random/fn, for..in) já protege qualquer writer que invalide — os gates são reutilizáveis como estão; NÃO duplicar, chamar os mesmos helpers.
- **Método:** igual ao que fechou — probe no GSAP real ANTES de assumir semântica de write intermediário (`invalidatePreservingStart` preserva o START global, não os starts de cada segmento — provar o que acontece com o segmento anterior ao editado), TDD estrito, bundle enxuto pro Sol a cada rodada, até MERGE OK.

### 2.2 Furo #4 — multi-target / split-text ownership
Do audit de ownership (item 168 do CLAUDE.md). Coordenar com a **Task 12 do gate** (fixture do chooser = Entrance+Hover). O step channel multi-target hoje tranca com reason `multi-target` (startAt compartilhado não restaura per-target) — o furo #4 é a solução de ownership real.

### 2.3 Fila da Task 16 (gate persistido `/canvas`)
Pausada desde o item 168. **Tasks 12–18** (Task 14 = seam de fault em código de PROD, server-only fail-closed) **+ 19–20**.
- Env: DB isolado Neon `ep-orange-frost-acaedcil` — **NUNCA produção** (`neondb` não qualifica).
- Retomar por `docs/superpowers/plans/2026-07-28-task16-persisted-e2e-gate-implementation.md` + lições das Tasks 10/11 no CLAUDE.md (seção "Lições permanentes", bloco "Harness persistido /canvas").

## 3. Como retomar (mecânica)

```bash
cd ~/Desktop/IA/Uncraft && git checkout codex/live-animated-clone-editing
cd packages/web-shell
npx vitest run lib/motion-editor/runtime-bridge-source.test.js   # 213 testes
node _probe-entryedit-witness.mjs                                # 114 checks — GSAP real
node _probe-furo2-witness.mjs                                    # 37 checks
```
- Witnesses rodam de DENTRO de `packages/web-shell` (fixture GSAP em `~/Desktop/IA/Unspirit-Clone-1to1/site`).
- Sol: `~/.claude/bin/codex-adversary.sh --mode prose --timeout 1500` com **bundle enxuto** (ver §4) — nunca `--mode diff` neste repo.
- Modelo de coordenação da frente: **Sol dirige o brainstorm/implementação; Claude executa/revisa (lead) + faz o [SALVAR]**.

## 4. Lições operacionais desta sessão (valem pras próximas rodadas Sol)

1. **Bundle enxuto** quando o diff crescer: header (contexto/semântica/verificação) + histórico compacto de 1 linha por rodada + **diff só do source** + lista de NOMES de teste como evidência de cobertura. O bundle integral estourou o contexto do Codex em ~400KB (r93 morreu sem veredito — só o warning no output; conferir que o processo TERMINOU antes de ler o veredito).
2. **O witness real freia o próprio fix**: duas correções "certas" pro achado do Sol quebraram o GSAP real (descida em `entry.parent` = 42 self-flags; presence-check de `paused:false` = over-lock) e o witness barrou antes do commit. Rodar o witness a CADA green, não só no fim.
3. **RED pelo motivo certo**: um RED que passa pela guarda errada (r105: deletar a chave do acessor disparava o guard de ASSINATURA, mascarando o caminho de random) não prova o fix — isolar a variável do cenário.
4. **Flag acumulado exige consumo em todo call-site** (r125) — cinto no return final.
5. **Isenção por CANAL, não por propriedade** (r116): o function-model cobre `retarget.final`; `keyframe.<prop>` escreve `vars[prop]` e destruiria a função autoral.
6. **for..in é a enumeração do GSAP** (r117–r121): qualquer predicado novo sobre vars/entries deve usar `gsapForInKeys`/`gsapChainDescriptor`/`gsapHasEnumerableProp` — nunca `Object.keys`/`hasOwnProperty` crus.

## 5. Residuais documentados (aceitos, não re-litigar)

- Bucket aninhado FUNDO dentro de container backedge-nomeado cross-tween (descer = self-flag na árvore GSAP; identidade DIRETA coberta).
- Escapes exóticos de scan em CSS irreal (escaped-`u\72l(`, data-URI raw em custom-prop — pré-existentes do 164).
- Mutações pré-observação (limite de observação); object-form pós-delete com entradas geradas; page splice de entradas vivas; undo cross-mutação-externa = last-write-wins em todos os canais (modelo do editor).
- Rodadas r70/v10/v11 e r6: prescrições refutadas/qualificadas por probe — documentadas nos addenda dos bundles.

## 6. Referências

- Finding doc do audit: `docs/superpowers/handoffs/2026-07-29-gsap-ownership-audit-finding.md`
- Handoff do ship pré-MERGE-OK: `docs/superpowers/handoffs/2026-07-30-safe-path-shipped-sol-pending-handoff.md`
- Memória: `[[checkpoint_2026-07-31_safe-path-merge-ok]]` (arquitetura completa da malha r42–r125)
- Bundles/vereditos da sessão: scratchpad da sessão `184f6f19` (`bundle-entryedit-r*.md`, `sol-r*.out`) — efêmeros; o que importa está no finding doc e nos testes.
