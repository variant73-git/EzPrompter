# Audit finding — ownership por-componente no GSAP real: o claim "já funciona" CAI como generalização

**Date:** 2026-07-29 · **Branch:** `codex/live-animated-clone-editing` · Frente: live-animated-clone-editing (Sol dirige; Claude executou o probe a pedido do Adilson, Sol + agente Claude auditaram)

**Pergunta do Adilson:** num elemento GSAP real, o editor ainda força a escolha de dono (chooser) quando duas animações mexem em componentes DIFERENTES de transform? Regra dada: elemento com 2 animações → **ambas disponíveis nos controles**; conflito real (mesma coisa) → ainda assim mostrar as duas; "se ainda força, fechamos a Task 10 [da frente]".

## Método
Probe end-to-end pelas seams REAIS: GSAP 3.15.0 real (asset farmminerals) → `getRuntimeBridgeSource()` eval'd em Chromium → click → `selection-changed` `payload.element.motion` → `analyzeMotionOwnership` real (o mesmo código do `applyStyle`). Depois **audit adversarial 2-vendor** (agente Claude com probes próprios + Sol GPT-5.6 max com bundle), síntese com verificação não-LLM dos pontos de dinheiro.

## O que SUSTENTA (probado, alta confiança — ambos os auditores)
- **Idioma moderno dominante** (`gsap.to`/`fromTo` single-target com shorthands top-level `x`/`scale`/`rotation`): tracks POR COMPONENTE → x+scale = campos independentes, **sem chooser** (`owned` cada um); x+x = chooser. Loop ∞ idem (retargetable, additive-base é ortogonal à classificação).
- Metodologia do probe válida: `describe()`/`inspectMotion()` não dependem do negotiate; targetId confere nos casos single-target; timeline children mesmo componente = `resting-writer` sem chooser.
- Fixture e2e atual (#ambiguous em CSS) testa a coarseness do CSS, não ambiguidade semântica.

## O que DERRUBA a generalização (cada item VERIFICADO rodando ou por leitura direta)
1. ⭐ **`vars.keyframes` está na ignored list** (`runtime-bridge-source.js:526`) → `gsap.to(el,{keyframes:[...]})` (array OU objeto) produz **zero tracks** → `unowned` → applyStyle grava **style patch que o tween vivo pisoteia** a cada tick (e em edit-mode o bridge parqueia autoRemoveChildren, então até entrance finita segue viva). Pior que chooser: **mente que é editável**. [Claude probou; Sol concordou; consequência confirmada no código]
2. **A dicotomia "GSAP granular / CSS grosso" é FALSA — granularidade é da FORMA AUTORAL, não do engine.** `gsap.to(el,{transform:"translateX(..) scale(..)"})` produz track grossa `transform` no caminho GSAP (probado); inversamente CSS com propriedades individuais `translate`/`scale` dá tracks separadas [Sol]. `css:{x:60}` (sintaxe GSAP-2) → track `css` inútil → unowned [Claude probou].
3. **`gsap.from()` — o idioma de entrance MAIS COMUM — abre o dialog SEM conflito nenhum**: candidato único não-retargetable (`runBackwards` mata retargetable em `:561`) → `unsupported` → applyStyle abre MotionOwnershipChoice travado (`useNativeMotionController.js:1320-1333`). Read-only de from() é intencional (`:602-605`), mas a APRESENTAÇÃO (dialog de escolha sem escolha) contradiz o spec "no modal interruption". [Claude probou]
4. **Multi-target/stagger/split-text**: ownership atribuída ao PRIMEIRO target; selecionar o 2º membro → candidato filtrado (`motion-ownership.js:102-103`) → `unowned` → style-stomp. Corroborado por comentário in-code (stagger facade probe-verified, `applyGsapKeyframe`). [ambos por leitura; não probado ao vivo]
5. **Writeback de loop NÃO é component-aware**: `applyGsapLoopBase` escreve `vars[runtimeProperty]` inteiro (`:1782-1799`) — track `scale` editada via campo Scale X **arrasta scaleY junto**; `descriptor.component` só é consumido pra transform-origin. Viola "componentes independentemente editáveis". [Sol achou; Claude-lead VERIFICOU por leitura direta]
6. **GSAP x+x também é ambiguidade "falsa"** (playback simultâneo, último renderizado domina — mesma crítica feita ao fixture CSS). O material CERTO pra testar o chooser da Task 12 do gate: **dois writers de comportamento independente e visível — Entrance + Hover (ou Scroll + Hover)** — com assert de que escolher cada canal altera o próprio comportamento observável (labels do spec: Entrance/Hover). [Sol; Claude-lead concorda]

## Veredito (Claude lead, pós-síntese)
**O claim como escrito CAI.** Sustenta apenas o caso estreito "single-target `gsap.to` com shorthands de componente". Resposta à pergunta do Adilson: **pro idioma x/scale NÃO força (nada a fazer aí); mas idiomas comuns de sites reais (from(), keyframes:, transform-string, staggers) ainda se comportam errado** — dialog travado sem conflito ou, pior, edição silenciosamente pisoteada. **Logo: a Task 10 da frente NÃO está entregue; "fechar a Task 10" = o inventário de 5 furos acima.**

### Ordem sugerida (custo × dano)
1. **#1 keyframes:** expandir `keyframes` (array/objeto) em animatedProps — dano máximo (edição mentirosa), fix contido.
2. **#3 from():** apresentação — nunca dialog de escolha sem escolha; regra do Adilson: some/desabilita o controle com explicação (spec: "unsupported/Code only" honesto).
3. **#2 transform-string + css:{}:** classificar como writer detectado sem binding seguro → `unsupported/Code only`, nunca `unowned` (nunca style-stomp).
4. **#5 loop component-aware** (decompor no writeback ou degradar honesto pra unsupported).
5. **#4 multi-target/split-text** (membership vs target efetivo; `unsupported/shared`).

### Task 12 do gate (correção do handoff)
O handoff `2026-07-28-task16-task12-ready-handoff.md` recomendava "GSAP x+x" como fixture do chooser — **corrigido pelo audit**: usar **Entrance+Hover/Scroll+Hover**. E a decisão de produto do Adilson (2026-07-29, standing): **elemento com 2 animações → ambas SEMPRE disponíveis nos controles, cada uma editável; mesmo em conflito real, mostrar as duas separadas** (não modal bloqueante). Isso deve orientar o redesign do cenário `canvas.ambiguous-owner-resolution` junto com o Sol.

Probes: `_probe-gsap-ownership.mjs` (deletado pós-audit; código reproduzível neste doc + bundle `scratchpad/bundle-gsap-ownership.md` da sessão). Probe de compositing 2026-07-28: CSS último-vence (2 ordens), GSAP compõe.
