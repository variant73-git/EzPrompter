# Handoff — feature caminho-seguro SHIPPED (`18b656b7`); MERGE OK do Sol PENDENTE (quota Codex até 5/ago)

**Date:** 2026-07-30 · **Branch:** `codex/live-animated-clone-editing` · **HEAD:** `18b656b7` · Suíte **1371/1371** · Witness feature **74/74** · Witness furo #2 **37/37** · `next build` OK.

## 1. COMEÇAR AQUI — re-rodar o Sol até MERGE OK
A rodada 41 do Sol **não rodou**: o Codex atingiu o limite de uso (`try again at Aug 5th`). Pela standing [[feedback_sol_audit_everything]] ("indisponível = dizer, nunca bloquear"), o trabalho foi commitado com a pendência ANOTADA no commit e a review final foi feita por **agente Claude independente** (que achou e corrigiu 1 regressão real: stagger+keyframes façade → zero tracks).

**Quando a quota voltar:**
1. Gerar bundle novo: contexto (usar o histórico das 40 rodadas — os bundles `bundle-entryedit-r*.md` estavam no scratchpad da sessão morta; regenerar o cabeçalho a partir deste handoff + do finding doc) + `git show 18b656b7` como diff.
2. `cat <bundle> | ~/.claude/bin/codex-adversary.sh --mode prose --timeout 1500 --focus "verificar o commit 18b656b7 inteiro (feature caminho-seguro, 41 fixes + regressão stagger+keyframes do review Claude); dar MERGE OK explicito se nada substantivo"` — rodadas até MERGE OK, cada achado verificado por probe (veto assimétrico nas DUAS direções: nas 40 rodadas, 41 achados aceitos e 2 prescrições dele refutadas por probe).
3. **Não integrar ao main antes do MERGE OK.**

## 2. O que shipou (resumo técnico)
Ver mensagem do commit `18b656b7` e memo [[checkpoint_2026-07-30_safe-path-entry-edit]]. Em uma linha: tracks da forma ARRAY de `vars.keyframes` destravadas (retarget = entry-edit do trailing run; step end via entradas, start via startAt; undo/rollback exatos), com uma malha de segurança por-animação construída em 40 rodadas: proveniência congelada (shape+source+props), children da timeline interna como verdade de ordem/membership, hazard de ressuscitação (baseline observada monotônica + validação declarada + aliases sinônimo/composto + atribuição positiva `pt.d.name` + runBackwards de entrada), equivalência semântica do run (clamp opacity, cross-unit/parse-fail ambíguo), pré-simulação de writes.

## 3. Placar da review (pra retomada rápida)
r1 reader transacional · r2 desired relativo · r3 divergência de valor · r4 mudanças estruturais · r5 replay (refinado: append inerte, filtro `parent`) · r6 REFUTADO por probe (aceito) · r7 reorder→children · r8 união array∪children · r9 delete de vars.keyframes · r10 proveniência positiva (fn-duration façade) · r11 stagger:0 em entrada (ownership por prop) · r12 props não entradas · r13 rides-along step · r14 slot inerte não é owner · r15 fonte congelada por identidade · r16 conteúdo congelado (props) · r17 reserved keys (verbatim) · r18 startAt rollback render-equivalente + onOverwrite não-reservado · r19 multi-target lock + façades aninhadas + on*Params · r20 run numérico · r21 pré-simulação · r22 cross-unit ambíguo · r23 parse-fail ambíguo · r24 clamp opacity · r25 percent/autoAlpha-discreto/restore autoral · r26 conjunto portador inteiro · r27 portador oculto (_ptLookup) · r28 writer morto (kill) · r29 hazard por-animação · r30–r33 aliases/transform · r34 baseline observada · r35 monotônica · r36 declarada sempre · r37 órfãos por-animação · r38 atribuição por chave · r39 atribuição POSITIVA (pt.d.name) · r40 runBackwards em entrada · **final Claude**: stagger+keyframes façade.

## 4. Roadmap depois do MERGE OK
1. **Fase-2 timeline** — etapas individuais (diamantes por entrada; offsets das durations), edição via entry-edit; afrouxar `applyGsapKeyframe` pra offsets intermediários SÓ na forma array. Infra per-track pronta.
2. **Furo #4** — multi-target/split-text ownership (coordenar com Task 12 do gate).
3. **Fila da Task 16** — Tasks 12–20 (env isolado Neon `ep-orange-frost-acaedcil` pronto; NUNCA produção).

## 5. Como rodar
- Suíte: `cd packages/web-shell && npx vitest run` (**1371 passed / 10 skipped**).
- Witness feature: `node _probe-entryedit-witness.mjs` (**74 checks TUDO VERDE**; re-rodar após QUALQUER mudança no bridge).
- Witness furo #2: `node _probe-furo2-witness.mjs` (**37/37**).
- Probes reproduzíveis (untracked, raiz do web-shell): `_probe-kf-entryedit`, `_probe-kf-append`, `_probe-kf-reorder`, `_probe-kf-delete`, `_probe-plain-fnduration`, `_probe-r19/r27/r28/r30/r31/r39`, `_probe-rides-along`, `_probe-startat-rollback`, `_probe-r6-replay` + os do furo #2.
- ⚠️ Rodar tudo de DENTRO de `packages/web-shell`.

## 6. Residuais documentados (não-bloqueio; comentados no código)
- Kill parcial de componente de `transform` ANTES da 1ª inspeção (baseline não existe ainda; some-check não distingue).
- Delete da forma objeto/percent pós-proveniência expõe entradas geradas do GSAP como detecção (write segue negado).
- Page splice de entrada viva (segmento órfão segue renderizando — fora da verdade recuperável).
- Undo cross-mutação-externa = last-write-wins em TODOS os canais (modelo do editor; endereçável um dia via generation/OCC no protocolo).
- Lookup de plugins segue unmodelable além do `d.name` (v10 do furo #2).
