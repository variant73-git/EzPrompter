# Motion Timeline — Figma Motion style Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesenhar a timeline do motion editor no modelo Figma Motion (dark), com inventário full-page, labels sincronizadas, seleção site↔timeline funcionando, e o painel direito reduzido a propriedades da animação do elemento selecionado.

**Architecture:** O eixo da régua CONTINUA sendo o scroll da página (decisão §3b do plano 2026-07-18 — ground truth do ScrollTrigger); o que muda é a pele e a estrutura: rows por elemento no padrão Figma (layer row + sub-rows), um único container de scroll com coluna de labels sticky (mata o bug de dessincronização por construção), e detalhe por elemento carregado sob demanda via bridge. Strips têm posição fixa no eixo; o playhead passa por cima.

**Tech Stack:** React (Next.js web-shell), CSS Modules, postMessage bridge (`runtime-bridge-source.js` injetado no iframe), Vitest + React Testing Library. Rodar testes com `bun run test` (bun, não npm).

## Global Constraints

- Texto de UI em INGLÊS (conversa em PT) — [[feedback_ui_text_english]].
- Nunca fontes JetBrains.
- Tokens de design do web-shell (`--motion-*` já existentes no module CSS; accent `#2966EA`-family via `var(--motion-accent)`).
- Nunca texto clipado/scroll horizontal em labels — truncar com ellipsis ([[feedback_wrap_truncate_pill_rules]]).
- A régua única é o scroll da página em px (decisão travada); fallback pra tempo quando não há page metrics.
- `st.vars.start/end` + `refresh()` é o writeback de strip válido (probe-verificado, não mudar).
- Playback é SEMPRE escopado à seleção (lição 154 — nunca pausar o documento inteiro).
- Referências visuais: screenshot do user (rows Flower 1/2, Leaf 1A/1B) + frames em `scratchpad/figma-motion-frames/hero-figma-motion-03.png` e `scratchpad/motion-imgs/7fbacb4b…-2016x1135.png` (dark-mode transposto).

## Modelo visual alvo (do teardown Figma Motion)

- **Layer row**: chevron expand + ícone do kind + nome (coluna esquerda); na área de tracks, strip sólida cobrindo a união das animações do elemento, com brackets "I" nas pontas (trim handles quando editável).
- **Sub-rows (expandido)**: (a) strips de animação — contorno arredondado com o NOME centralizado dentro; (b) rows de propriedade — losangos ◇ ligados por linha fina; na coluna esquerda, nome da propriedade + steppers `< ◇ >` + valor corrente (só pro elemento selecionado).
- **Cores**: layer selecionado = accent (wash suave no grupo inteiro); não selecionados = cinza neutro. Losango outline → preenchido quando selecionado.
- **Playhead**: linha vertical de altura total, maior contraste da UI, com handle na régua; strips NUNCA se movem com ele.
- **Resize**: arrastar a borda superior da timeline redimensiona a altura (até 2×); divisor entre labels e tracks redimensiona a largura das labels.

---

### Task 1: Bridge — inventário full-page, hostId na seleção, focus-element, describe-element

**Files:**
- Modify: `packages/web-shell/lib/motion-editor/runtime-bridge-source.js` (viewportMotionRows ~554-622, select ~1083, dispatcher ~1334-1371)
- Test: `packages/web-shell/lib/motion-editor/runtime-bridge-source.test.js` (seguir padrões existentes do arquivo)

**Interfaces:**
- Produces: evento `viewport-motion-changed` com `rows` = TODOS os elementos animados da página (novo campo booleano `inViewport` por row; ordenação por `top` mantida); payload de `selection-changed` ganha `element.hostRowId` (id da row da timeline correspondente); novos comandos `focus-element {elementId, playbackMode}` e `describe-element {elementId}` (este emite `element-described {element}` SEM mudar seleção).

- [ ] **Step 1: testes falhando** — (a) rows incluem elemento fora do viewport com `inViewport:false`; (b) `selection-changed` de um fragmento filho carrega `hostRowId` igual ao `elementId` da row do host; (c) `describe-element` emite `element-described` e NÃO emite `selection-changed`; (d) `focus-element` seleciona e (pra driver time) dispara playback escopado.
- [ ] **Step 2: implementação**
  - Extrair de `viewportMotionRows` a construção do map `hosts` para `motionHosts(index)`.
  - `viewportMotionRows(page)`: remover o early-return `if (!intersectsViewport(element)) return;` → `const inViewport = intersectsViewport(element)`, incluir `inViewport` na row.
  - `resolveHostRowId(element)`: `candidate = splitFragmentHost(element)`; subir por `candidate.parentElement` até `documentElement` procurando chave no map `hosts`; se nada, procurar host descendente (`element.contains(host)`, pegar o primeiro em ordem de documento); retorna `ensureElementId(host)` ou `null`. Chamar dentro de `describe()` (campo `hostRowId`) — assim TODOS os emits de seleção carregam.
  - Dispatcher: `focus-element` → `findElement` → `select(el)`; se `!intersectsViewport(el)` → `el.scrollIntoView({block:'center', behavior:'smooth'})`; após ~400ms, se o clip ativo do elemento for time-driven → playback escopado `play` (repeat conforme `playbackMode==='loop'`); scroll-driven não toca (o scroll já é o play). `describe-element` → `emit('element-described', { element: describe(el) })`.
- [ ] **Step 3: `bun run test` verde; commit** `feat(motion): bridge full-page rows + hostRowId + focus/describe-element`

### Task 2: Shell — plumbing de dados (detail cache, expand, seleção por hostRowId)

**Files:**
- Modify: `packages/web-shell/components/motion-editor/NativeMotionEditor.jsx` (shell ~1280-1415, mounting ~1839-1870)
- Test: `packages/web-shell/components/motion-editor/NativeMotionEditor.test.jsx`

**Interfaces:**
- Produces: estado `motionDetail: Map<elementId, motion[]>` (cache de describe por elemento); `expandedLayers: Set<elementId>`; `selectedRowId = selected?.hostRowId || selected?.id`; handler de `element-described` populando o cache; row click → `send('focus-element', {elementId, playbackMode})`; expandir layer sem detalhe → `send('describe-element', {elementId})`. Seleção também popula o cache (`selected.motion` entra sob `selectedRowId`).

- [ ] **Step 1: testes falhando** — (a) mensagem `element-described` popula cache e a timeline renderiza sub-rows do layer expandido; (b) `selection-changed` com `hostRowId` marca a row certa (`data-selected`); (c) click em row manda `focus-element` (não `select-element`).
- [ ] **Step 2: implementar; Step 3: verde; commit** `feat(motion): timeline data plumbing (detail cache, hostRowId selection, focus)`

### Task 3: TimelinePanel — layout de um scroller só + rows Figma + playhead + resize

**Files:**
- Modify: `packages/web-shell/components/motion-editor/NativeMotionEditor.jsx` (TimelinePanel ~708-1189)
- Modify: `packages/web-shell/components/motion-editor/native-motion-editor.module.css` (~575-700 + seções de keyframe/strip)
- Test: `packages/web-shell/components/motion-editor/NativeMotionEditor.test.jsx`

**Interfaces:**
- Consumes: `rows` (full-page, com `inViewport`), `motionDetail`, `expandedLayers`/`onToggleLayer`, `selectedRowId`, `labelsWidth`/`onLabelsWidth`, `bodyHeight`/`onBodyHeight`.
- Produces: DOM com UM `.timelineScroller` (overflow:auto nos 2 eixos) contendo grid `[labels | tracks]`; células de label `position:sticky; left:0`; régua `position:sticky; top:0`. `.timelineBody` altura = `bodyHeight` (default 166, clamp 166–332 via handle na borda superior). Divisor vertical arrastável entre labels e tracks (clamp 110–340, persistir em localStorage `uncraft-motion-labels-w`).

- [ ] **Step 1: testes falhando** — (a) labels e strips vivem no MESMO elemento scrollável (scroll vertical único); (b) handle de altura clampa 166–332; (c) divisor de labels clampa 110–340 e persiste; (d) playhead cobre a altura toda; (e) pointerdown em área vazia da track move o scroll da página (chama `onScrollTo`) e NÃO altera `scrollStart/End` de nenhuma row.
- [ ] **Step 2: implementar** — estrutura por linha: cada row do grid = `<div class=timelineRow>[<div class=rowLabel sticky>…]<div class=rowTrack>…</div></div>`; layer row + (expandido) clip strips outlined com label centralizado + property rows com ◇; steppers `< ◇ >` + valor nas property labels do elemento selecionado (prev/next = navegar keyframes movendo playhead; ◇ central = add keyframe no offset atual, só quando `canAutoKeyframe`); brackets "I" nas pontas da layer strip (trim = writeback scrollStart/End existente, `beginStripDrag` intacto); playhead absoluto full-height + drag/click-to-jump em qualquer ponto vazio do canvas (substitui o `<input type=range>` scrubber).
- [ ] **Step 3: verde; commit** `feat(motion): Figma-style timeline (single scroller, layer rows, full-height playhead, resizes)`

### Task 4: MotionPanel — só propriedades; transporte e lista removidos

**Files:**
- Modify: `packages/web-shell/components/motion-editor/NativeMotionEditor.jsx` (MotionPanel ~464-656; remover ViewportPanel ~668-706 morto)
- Test: `packages/web-shell/components/motion-editor/NativeMotionEditor.test.jsx`

**Interfaces:**
- Consumes: `activeMotion` continua vindo do shell; a ESCOLHA do clip ativo passa a ser: click numa strip de animação na timeline → `onActiveMotion(clipId)`; default = primeiro clip do selecionado (efeito já existente linha 1296-1298).
- Produces: MotionPanel sem `motionTransport` (RotateCcw/Pause/Play/speed) e sem `InspectorSection "Animations"`; mantém Trigger/Timing/Easing/Scroll/Animated properties; Stagger permanece quando o grupo do clip ativo é staggerable (mover o Field pra seção Timing). `ViewportPanel` deletado (código morto — não montado no shell).

- [ ] **Step 1: testes falhando** — (a) painel Motion NÃO renderiza botões de transporte; (b) NÃO renderiza a lista "Animations"; (c) strip de animação na timeline com aria-pressed define clip ativo.
- [ ] **Step 2: implementar; Step 3: verde; commit** `feat(motion): right panel = animation properties only; timeline owns clip selection`

### Task 5: Passe visual dark (Figma anatomy)

**Files:**
- Modify: `packages/web-shell/components/motion-editor/native-motion-editor.module.css`

- [ ] Layer strip sólida (accent selecionado / cinza neutro), radius pill-ish, brackets "I" internos nas pontas; clip strips outlined 1px com label 9-10px centralizado; ◇ 8px outline → filled selecionado; wash suave `rgba(accent, .06)` no grupo selecionado (label + tracks); playhead 1.5px accent com cap na régua; régua números cinza discretos; grid vertical mantido. Rows 28px, labels 9px, ellipsis sempre.
- [ ] Verificação visual no fixture: `rm -rf .next-motion && UNCRAFT_NATIVE_CLONE_ROOT=~/Desktop/IA/Unspirit-Clone-1to1/site npm run dev:motion` (porta 3032) + screenshot headless. Commit `style(motion): dark Figma Motion anatomy for timeline`

### Task 6: Suíte completa + smoke

- [ ] `bun run test` completo (baseline 721; ajustar testes de ViewportPanel removido).
- [ ] Smoke no fixture: scroll da lista sincronizado; selecionar no site acende row; click em row fora do viewport rola o site e toca 1×; strips imóveis durante scrub; resize de altura/labels.
- [ ] Commit final + atualizar `docs/superpowers/plans/2026-07-18-motion-editor-redesign-and-handoff.md` §6 com ponteiro pra este plano.

## Self-review
- Cobertura: R-item1 (painel direito só propriedades) → Task 4; R1 (resize altura/labels, transporte fora do painel) → Tasks 3+4; R2 (click fora do viewport rola+toca) → Tasks 1+2; R3 (selecionar toca) → Task 1 (`focus-element` também no select? NÃO — só via row click; selecionar NO SITE não deve rolar; tocar ao selecionar row já coberto); R4 (strips fixas, playhead por cima, click-to-jump) → Task 3 (+full-page rows na Task 1 elimina o re-scope que movia strips); R5 (visual Figma dark) → Task 5. Bug labels-scroll → Task 3 (um scroller). Bug seleção site→timeline → Task 1 (hostRowId).
- Tipos: `hostRowId` (string|null) usado em Tasks 1/2/3; `focus-element {elementId, playbackMode}` idem; `motionDetail Map` consumido na Task 3.
