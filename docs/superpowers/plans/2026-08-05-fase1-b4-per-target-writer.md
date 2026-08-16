# Fase 1 / Chave B4 — Writer per-target (OverrideChannel) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promover a chave **B4** (`multi-target plano · nenhum modificador · per-target · patch real`) da Tabela B pro degrau 3 — o primeiro override per-target REAL do produto — fechando o probe combinado do Gate da Fase 1.

**Architecture:** **Opção B endurecida** (decisão do Adilson + advise do Sol 2026-08-05): um `OverrideChannel` durável por animação+propriedade (slot autoral verbatim, `shared` vivo, mapa de overrides, wrapper de identidade estável, máquina de estados baseline/active/stale), projetado em `vars[prop]` como UMA função estável; proveniência CONTEXTUAL (WeakMap função→contexto, nunca WeakSet global); protocolo `retarget.final` schema v3 (`targetScope` + `intent: override|inherit`); witness do gate pelo protocolo **v2** (`apply-transaction`/`rollback-transaction`).

**Tech Stack:** bridge injetado (`runtime-bridge-source.js`, IIFE auto-contida), vitest (doubles jsdom), witness Playwright + GSAP 3.15 real da fixture, Sol via `codex-adversary.sh`.

## Global Constraints

- **Chave B4 ESTRITA** (advise do Sol): escalar absoluto top-level, multi-target plano. FORA (recusar): stagger/filho interno, keyframes, plugin var, função autoral, relativo `+=`, random, `repeat>0`, `yoyo`, wrapper `css:{}`, componente de transform. `writeModel` enviado pelo host NUNCA desbloqueia — o bridge RECOMPÕE a elegibilidade B4 por inspeção própria.
- **B5/B6/repeatRefresh NÃO são consequência de B4** — continuam recusados; promoção só por witness próprio.
- Regras herdadas: witnesses de dentro de `packages/web-shell`, caminhos absolutos, A/B por `git show`, TDD com RED observado, write model derivado da PUBLICAÇÃO nos witnesses, tudo com Sol antes de commit de produção (veto assimétrico), texto user-facing em inglês.
- Suíte baseline: 1538/1538. Witnesses verdes: editwrite (0 RED), inspeção, fase-2, entry-edit, furo2; detach 11 RED intocado.
- "O que faria o plano ser um erro" (advise, lista integral): WeakSet global de autoria; confiar em elementId/affectedTargetCount sem membership por identidade; restaurar sempre o escalar ORIGINAL quando o mapa esvazia (tem que ser o `shared` ATUAL); presença/ausência fora do readback transacional; re-inspeção reclassificando o wrapper como `function-offset`; ignorar reinjeção/replay; declarar undo fechado só com harness v1; promover por nome de write model.

## Estruturas centrais (referência para todas as tasks)

```js
// Binding no bridge (padrão gsapFunctionRetargets):
// gsapOverrideChannels: WeakMap<animation, Map<property, channel>>
// channel = {
//   state: 'active' | 'collapsed',        // stale é um VEREDITO da validação, não um estado gravado
//   authoredSlot: { value, descriptor },  // escalar original VERBATIM + property descriptor
//   shared,                               // valor atual do grupo (muda com edição de grupo)
//   overrides: Map<Element, { intent: 'override'|'inherit', value }>,
//   wrapper,                              // a função estável (identidade única do canal)
//   targetSet,                            // targets() capturados por IDENTIDADE na criação
// }
// Projeção: vars[prop] = wrapper quando active; escalar `shared` quando collapsed.
// wrapper = (index, target) => {
//   const entry = channel.overrides.get(target);
//   return entry && entry.intent === 'override' ? entry.value : channel.shared;
// }   // has() explícito via entry — NUNCA `get() ?? shared`
//
// Proveniência contextual (nunca WeakSet global):
// gsapOverrideProvenance: WeakMap<Function, {
//   kind: 'pure-target-override-v1', animation, property, container, channel
// }>
// Função é SEGURA só quando: mesma animação + mesma property + mesmo container +
// no slot esperado + canal active. vars.y = vars.x → hazard (property diverge).
//
// Descriptor v3 (retarget.final):
// { schemaVersion: 3, runtimeProperty, targetScope: { mode: 'single' },
//   intent: 'override' | 'inherit', value?  // value só em override
//   ...campos v2 preservados }
// patch.elementId é o alvo AUTORITATIVO; membership por IDENTIDADE em animation.targets().
```

---

### Task 1: Schema v3 + recomposição da chave B4 (recusas primeiro, RED)

**Files:**
- Modify: `packages/web-shell/lib/motion-editor/runtime-bridge-source.js` (entrada `retarget.final` em `applyMotionPatch` ~5045; gate de escopo em `applyGsapRetarget` ~4691)
- Test: `packages/web-shell/lib/motion-editor/runtime-bridge-source.test.js` (append; usar `bootV2Runtime` + doubles no padrão `makeRepeatTweenDouble` já existente no arquivo)

**Interfaces:**
- Produces: função interna `gsapPerTargetEligibility(record, element, descriptor)` → `{ eligible: boolean, reason }` que RECOMPÕE a chave B4 (inspeção própria de vars/targets, ignora o writeModel do host); aceitação de descriptor v3 na entrada `retarget.final` (v2 full-scope continua intacto). Roteia para `applyGsapPerTargetOverride(record, element, descriptor)` (implementada na Task 2; nesta task, stub que lança `bridgeError('unsupported_patch', ...)` — TODOS os testes desta task são de RECUSA).

- [ ] **Step 1: Testes RED de recusa** (vitest, doubles multi-target de 2 alvos): (a) v3 com alvo cujo elemento NÃO está em `targets()` por identidade → `patch-rejected` (mesmo com elementId válido de outro elemento da página); (b) v3 sobre tween com `repeat: 2` → rejected; (c) `yoyo: true` → rejected; (d) `vars.keyframes` → rejected; (e) `css:{}` wrapper → rejected; (f) função autoral em `vars.x` → rejected; (g) `x: '+=50'` relativo → rejected; (h) `writeModel: 'per-target-absolute'` enviado num tween B5 (repeat) → rejected (nome não desbloqueia); (i) v2 full-scope `affectedTargetCount: 2` num plano segue FUNCIONANDO (não-regressão).
- [ ] **Step 2: Rodar, RED observado** nos casos v3 (o handler ainda nem aceita schemaVersion 3 — registrar a forma do RED).
- [ ] **Step 3: Implementar** a aceitação do v3 na entrada (validação estrutural: `targetScope.mode === 'single'`, `intent` válido, `value` presente sse override) + `gsapPerTargetEligibility` + roteamento pro stub.
- [ ] **Step 4: Rodar** — recusas todas verdes; não-regressão (i) verde; suíte inteira verde.
- [ ] **Step 5: Commit** `feat(motion): retarget.final v3 aceito com recomposição estrita da chave B4 (recusas)`.

### Task 2: OverrideChannel — núcleo e máquina de estados

**Files:**
- Modify: `packages/web-shell/lib/motion-editor/runtime-bridge-source.js` (novo bloco junto de `gsapFunctionRetargets` ~4640)
- Test: `runtime-bridge-source.test.js` (append)

**Interfaces:**
- Consumes: roteamento da Task 1.
- Produces: `gsapOverrideChannels` (WeakMap), `applyGsapPerTargetOverride(record, element, descriptor)` real, `gsapOverrideChannelFor(animation, property)` (leitura), colapso/projeção. O wrapper e a transição escalar↔função usam `invalidatePreservingStart` (já correta por totalTime).

- [ ] **Step 1: Testes RED da máquina** (doubles; asserções sobre `vars.x` e o estado do canal): (a) 1º override (A=160): `vars.x` vira função, canal active, render... (no double: `vars.x(i, elA) === 160`, `vars.x(i, elB) === 100`); (b) 2º alvo (B=140) NÃO muda a identidade da função (`vars.x` `===` anterior); (c) edição de GRUPO com canal ativo (full-scope v2 → 120): `shared` vira 120, overrides intactos, wrapper devolve 120 pra quem herda; (d) `intent: 'inherit'` em A: entrada PRESENTE com intent inherit (devolve shared), distinta de ausência; (e) clear do último override (patch v3 que remove — undo do 1º): canal colapsa, `vars.x` volta a ESCALAR = **`shared` ATUAL** (⭐ caso do advise: grupo 100→120 durante override → colapso restaura 120, tipo `number`); binding fica tombstonado (próximo override REUSA a mesma identidade de wrapper); (f) `authoredSlot` guarda o original verbatim e o colapso com `shared === original` restaura byte-igual.
- [ ] **Step 2: RED observado** (stub da Task 1 lança).
- [ ] **Step 3: Implementar** canal + writer + colapso + tombstone.
- [ ] **Step 4: Verde + suíte inteira.**
- [ ] **Step 5: Commit** `feat(motion): OverrideChannel — máquina de estados, wrapper estável, colapso pro shared atual`.

### Task 3: Proveniência contextual + atestação de endpoints

**Files:**
- Modify: `runtime-bridge-source.js` (`gsapScanRandomizedValue`/`gsapHasRandomizedValue` ~1330–1570; ponto de atestação em `applyGsapRetarget`/`applyGsapPerTargetOverride` antes de qualquer `invalidatePreservingStart`)
- Test: `runtime-bridge-source.test.js`

**Interfaces:**
- Consumes: canal da Task 2.
- Produces: `gsapOverrideProvenance` (WeakMap contextual); scan reconhece wrapper NO SLOT ESPERADO de canal ACTIVE como não-hazard e **não o coleta** em `gsapTopFunctionProps`; `gsapAttestOverrideEndpoints(record, channel)` → confere endpoints materializados de TODOS os alvos contra `shared`/`overrides` antes de invalidar (anti-impostora do advise §3), divergência → `bridgeError`.

- [ ] **Step 1: Testes RED**: (a) com canal ativo em x, editar Y (retarget normal) NÃO é bloqueado pelo hazard de função (hoje bloquearia — RED que vira verde); (b) página faz `vars.y = vars.x` (nossa wrapper em prop errada) → editar QUALQUER coisa → hazard (recusa); (c) página troca `vars.x` por impostora → hazard + canal stale (edições recusadas; seleção segue inócua); (d) colapso do canal NÃO limpa hazard pré-existente originado pela página (função da página em z observada antes continua hazard — monotonicidade preservada); (e) atestação: página trocou impostora → invalidate() → devolveu a wrapper (identidade "legítima", PropTweens da impostora) → próxima edição compara endpoints materializados vs canal → diverge → recusa.
- [ ] **Step 2: RED observado.**
- [ ] **Step 3: Implementar** (a exceção do scan é CIRÚRGICA: só o par exato animação+prop+container+slot com canal active; resto do scan intocado).
- [ ] **Step 4: Verde + suíte + witnesses vizinhos** (fase-2/entry-edit/furo2 — o scan é compartilhado; qualquer regressão aqui aparece neles).
- [ ] **Step 5: Commit** `feat(motion): proveniência contextual do OverrideChannel + atestação de endpoints`.

### Task 4: Re-inspeção publica o modelo LÓGICO (nunca function-offset)

**Files:**
- Modify: `runtime-bridge-source.js` (`gsapWriteModel` ~264 é chamado na publicação ~2235; interceptar ANTES: wrapper de canal → modelo lógico)
- Test: `runtime-bridge-source.test.js`

**Interfaces:**
- Consumes: canal + proveniência.
- Produces: publicação de track para canal ativo com `ownership.writeModel: 'absolute'` (o modelo LÓGICO do canal), `ownership.perTarget: { available: true, states: [{ elementId, intent }] }` (consumido pela UI na Task 7 e pelo witness na Task 8); `sourceValue` = `channel.shared`.

- [ ] **Step 1: Teste RED**: com canal ativo, selecionar o alvo → track publicado com `writeModel: 'absolute'` (HOJE: `function-offset`, porque `typeof vars.x === 'function'` — RED) + `perTarget.states` correto (A=override/160, B=herda).
- [ ] **Step 2: RED observado.**
- [ ] **Step 3: Implementar** (checagem do canal ANTES de `gsapWriteModel`).
- [ ] **Step 4: Verde + suíte.**
- [ ] **Step 5: Commit** `feat(motion): re-inspeção publica modelo lógico do canal (nunca function-offset)`.

### Task 5: Read/apply ESCOPADOS + transações v2

**Files:**
- Modify: `runtime-bridge-source.js` (`readGsapRetarget` ~3525 — recebe o ELEMENTO escopado, devolve `{ intent, value }` por alvo; caminho `validate-transaction` ~6858 que RELÊ o runtime; `sampleGsapValue` ganha `targetOverride` opcional)
- Test: `runtime-bridge-source.test.js`

**Interfaces:**
- Consumes: canal.
- Produces: readback lógico por alvo — `readGsapRetarget(record, descriptor, element)` devolve pro v3 `{ intent, value }` do CANAL (não amostra do DOM de `record.target`); `before` do patch v3 é derivado desse readback (inclui `intent: 'inherit'`/ausência — presença é parte do readback transacional).

- [ ] **Step 1: Testes RED**: (a) ⭐ o bug do advise: com A sobrescrito e B herdando, `validate-transaction` de um patch em B captura o estado de B (herda/shared), NUNCA amostra A (`record.target` é A — hoje capturaria A); (b) `apply-transaction` v2 com patch v3 → aplica + committed; (c) `rollback-transaction` → canal volta EXATO (entrada removida se não existia; valor anterior se existia; colapso se era o último — com shared atual); (d) undo de "override igual ao grupo" (A=100 override explícito) restaura o INTENT (não vira herda).
- [ ] **Step 2: RED observado.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Verde + suíte.**
- [ ] **Step 5: Commit** `feat(motion): readback lógico por alvo + transações v2 do canal`.

### Task 6: Serialização fase-2 + reinjeção do bridge

**Files:**
- Modify: `runtime-bridge-source.js` (serializer/colateral `gsapVarsCollateralState` ~3905: wrapper vira MARCADOR estável `"[uncraft-override-v1:<prop>]"` em vez de encoding de função session-bound; `teardown` ~7194: colapsar canais restaurando o escalar `shared` atual em `vars` ANTES de desmontar)
- Test: `runtime-bridge-source.test.js`

**Interfaces:**
- Consumes: canal + proveniência.
- Produces: política de reinjeção EXPLÍCITA (decisão do advise §4): **teardown colapsa; bridge novo reconstrói por replay** (o host já re-aplica transactions do manifest na injeção — convenção replay-on-pass do item 155). Wrapper NUNCA fica em `vars` órfão de bridge.

- [ ] **Step 1: Testes RED**: (a) exposição fase-2/colateral com canal ativo NÃO fica session-bound por causa do wrapper (comparar com tween sem canal — o marcador é estável); (b) `teardown()` com canal ativo → `vars.x` volta a escalar (shared atual), sem wrapper órfão; (c) re-eval do bridge + replay do patch v3 → canal reconstruído com MESMO estado lógico (overrides/intents), edição segue funcionando.
- [ ] **Step 2: RED observado.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Verde + suíte + witnesses vizinhos** (fase-2 e entry-edit tocam serialização).
- [ ] **Step 5: Commit** `feat(motion): serialização por marcador estável + teardown colapsa canais (replay reconstrói)`.

### Task 7: UI — patch v3 e estado per-target (publicação POR ÚLTIMO)

**Files:**
- Modify: `packages/web-shell/lib/motion-editor/retarget-patch.js` (builder: quando `owner.perTarget?.available`, emitir descriptor v3 `targetScope+intent`, `before` vindo do `perTarget.states` do alvo)
- Modify: `packages/web-shell/components/motion-editor/useNativeMotionController.js` (campo editável quando canal per-target disponível; reset da propriedade = patch v3 `intent`-removal)
- Test: `packages/web-shell/lib/motion-editor/retarget-patch.test.js` + `components/motion-editor/useNativeMotionController.test.jsx`

**Interfaces:**
- Consumes: `ownership.perTarget` da Task 4; canal completo (Tasks 1–6) — esta task SÓ liga a UI depois do writer inteiro pronto (ordem do advise: publicação por último, sem janela em que a UI promete writer sem proveniência).
- Produces: `buildFinalTargetPatch` emite v3 para canais per-target; UI text em inglês (tooltip/labels definidos aqui ficam mínimos — o polish visual da marquinha/reset é fase própria de UI, fora deste plano).

- [ ] **Step 1: Testes RED** (unit do builder + controller): (a) owner com `perTarget.available` → patch v3 com `targetScope:{mode:'single'}`, `intent:'override'`, `before` = estado atual do alvo; (b) owner sem perTarget → v2 inalterado (não-regressão).
- [ ] **Step 2: RED observado.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Verde + suíte inteira.**
- [ ] **Step 5: Commit** `feat(motion): UI emite retarget.final v3 para canais per-target`.

### Task 8: Witness do GATE B4 (protocolo v2 real, GSAP 3.15)

**Files:**
- Create: `packages/web-shell/_probe-b4-witness.mjs` + `_probe-b4-witness.baseline.json` (tracked; padrão `--record`/assertivo dos witnesses existentes; protocolo **v2** — `commandV2` de `protocol.js`, mensagens `apply-transaction`/`rollback-transaction`, boot com config `data-uncraft-runtime-config` como em `bootV2Runtime`)

**Interfaces:**
- Consumes: tudo. Write model/perTarget derivados da PUBLICAÇÃO (nunca forçados).
- Produces: a PROVA que promove B4 na Tabela B do finding doc.

- [ ] **Step 1: Casos** (cada um página nova, referência intocada, tick seguinte, render do início — o checklist integral do advise): (a) trajetória completa do alvo desde o início + next tick; (b) irmão byte-idêntico à referência; (c) 2ª edição mantém a identidade da função (ler `vars.x` antes/depois por igualdade referencial na página); (d) edição posterior do GRUPO alcança só quem herda; (e) re-exposição correta (`perTarget.states`); (f) tampering (impostora) recusado; (g) undo/redo por `rollback-transaction`; (h) último reset restaura slot/tipo/trajetória exatos (incl. o caso grupo-mudou-durante-override); (i) sensibilidade: um "override" deliberadamente escrito por escalar cru TEM que contaminar o irmão e ser detectado; (j) `repeat:2` na MESMA página é recusado (chave B5 fechada).
- [ ] **Step 2: `--record` + assertivo** — TUDO VERDE esperado; qualquer RED = voltar às tasks.
- [ ] **Step 3: Rodar TODOS os witnesses vizinhos** + suíte. Detach: 11 RED byte-idênticos.
- [ ] **Step 4: Commit** `witness(fase1): gate B4 verde — override per-target provado pelo caminho v2 real`.

### Task 9: Sol audit + promoção B4 + [SALVAR]

**Files:**
- Modify: `docs/superpowers/handoffs/2026-08-05-fase0-provas-finding.md` (B4: degrau 3 PROMOVIDO, prova = witness B4; demais linhas intocadas)
- Modify: handoff de entrada + CLAUDE.md + memória + vault ([SALVAR])

- [ ] **Step 1: Bundle pro Sol** (diff completo da Fase 1 + witness + finding): `--mode prose --effort max --timeout 1400`, background, iterar até MERGE OK (veto assimétrico: achado dele reproduzido rodando; refutação minha só com probe).
- [ ] **Step 2: Ajustes da audit**, cada um com RED observado + witness re-rodado.
- [ ] **Step 3: Promover B4 no finding doc** (única linha; B5/B6/B2*/B3/B7 seguem hipóteses).
- [ ] **Step 4: [SALVAR]** — checkpoint, CLAUDE.md, Findings harvest, vault, handoff de entrada novo.

---

## Self-review (feito na escrita)

- **Cobertura do advise:** canal §2→Task 2; `has()` explícito e colapso-pro-shared→Task 2; proveniência contextual §3→Task 3; anti-impostora/atestação→Task 3; reclassificação function-offset §2→Task 4; readback escopado + before lógico §5→Task 5; serialização + reinjeção §4→Task 6; rota do patch v3 §5→Tasks 1/7; publicação por último→Task 7; witness v2 §6→Task 8; lista "o que faria ser erro"→Global Constraints.
- **Ordem = ordem TDD do advise** (schema→máquina→proveniência→read/apply→publicação→witness).
- **Placeholders:** nenhum; onde o desenho fino é adversarial por natureza (rodadas do Sol), a task define o CONTRATO testável e o erro esperado.
- **Consistência de nomes:** `gsapOverrideChannels`/`gsapOverrideProvenance`/`applyGsapPerTargetOverride`/`gsapPerTargetEligibility`/`gsapAttestOverrideEndpoints`/`ownership.perTarget` usados consistentemente entre tasks.
- **Fora de escopo (explícito):** B5/B6/B2a/B2b/B3/B7; wrapper de transplante; UI de polish (marquinha visual/menu de contexto — fase de UI própria); `resolution.proofKey` persistido no ack (sugestão do advise — adiado pra quando houver persistência de projeto na frente, anotado no finding doc).
