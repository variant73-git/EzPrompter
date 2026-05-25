# Uncraft — Contexto do Projeto

> **Renomeado em 2026-04-27** — antes era "RepixBridge". A pasta foi movida pra `~/Desktop/IA/Uncraft/`. Namespace de código (`__rb*`, `rb-*` classes) preservado intencionalmente — rename interno seria muito invasivo sem benefício funcional.

## O que é
**Uncraft** é uma extensão Chrome que funciona como um **design tool para a web** — o designer edita qualquer site visualmente, sem sair do browser. Slogan: "Design without borders".

Três frentes:
1. **Page Editor** — editor Figma-like: layers panel, inspector, spacing guides, edição visual in-place
2. **Mode E (Papel Vegetal)** — IA captura screenshots do site e reconstrói em HTML/CSS limpo editável
3. **Image Remix** — reverse-engineer do prompt de qualquer imagem + geração inline via IA

## Posicionamento Estratégico
Uncraft é o único tool que **edita sites visualmente no browser** com controles de design tool (layers, inspector, spacing). Nenhum competidor faz isso:
- html.to.design leva pro Figma (sai do browser)
- same.new gera código React (output é código, não design)
- ClonewebX exporta para builders (sai do browser)
- CSS Pro edita CSS mas sem layers/inspector (ferramenta de dev, não de designer)
- CSS Peeper só inspeciona (read-only)

## Mercado (pesquisa abril 2026)

### Competidores mapeados
| Tool | Users | Revenue Est. | Preço | O que faz |
|---|---|---|---|---|
| html.to.design | 1.4M | $2-5M ARR | $12/mês | Site → Figma layers |
| CSS Peeper | 500K | $500K-1M ARR | $5-8/mês | Inspeção visual CSS (read-only) |
| same.new | 500K | $3M ARR | Freemium | Site → React clone (YC W24) |
| Codia | 500K+ | $1-3M ARR | $12-59/mês | Screenshot → Figma/HTML |
| ClonewebX | 50K | $200-400K ARR | $10/mês | Site → WordPress/Webflow/Elementor |
| Orchids | N/A | Pre-revenue | $25/mês | AI app builder + cloner (YC W25, $2.5-12M seed) |
| CSS Pro | 124 | $100K+ total | $30/mês | CSS editor visual (bootstrapped) |
| CloneFlow | 377 | <$5K ARR | $8.99/mês | Site → Webflow |
| Wireframeit | ~few hundred | <$10K ARR | $12/mês | Site → wireframes |

### Tamanho do mercado
- **Total: ~$9-14M ARR** dentro de um mercado de design tools de $14.9B

### Pricing — em lock (após benchmark 2026-04-27)
Motor Mode E travado em **Gemini 3.1 Pro** ($0.525/clone medido em 2.4.6 com tokens reais). Cheap-tier (Flash/Haiku) saiu do quadro — qualidade visual inadequada. Free tier não pode ter rebuilds cortesia em Pro 3.1 (matemática negativa) → free vira **Mode A only**.

Pricing model concreto pendente — opções na seção "Pricing model em discussão" abaixo. Decisão entre flat $X/mês unlimited vs flat com cap vs tier ladder.

## Branches
- `feat/normalize-engine` — branch principal (editor + layers + Mode E + detect/freeze)
- `feat/sidebar-panel` — checkpoint 028 (minidocks, Mode S, Assets 3 seções)
- `feat/guides-ux-experiment` — checkpoint 029 (Framer fix + Guides UX: keyboard modifiers, arrow nudge, G toggle, inline input, delta preview, corner handles)
- `feat/smart-text-cascade` — checkpoint 032 (cumulativo com 030+031): smart text cascade, framework override sticky writes, X/Y static→relative, **Link inspector section**, **minidock link icon + font picker + click-to-type**, **compact mode widget (bottom-left dropdown)**, **guide editing blur fix**, font dropdown fixed-positioned, 8 light-mode fixes
- `feat/mode-e-refinement` — checkpoints 033/034/035: Mode B+E2 (033), refinement loop M1 visível como E+ (034), Mode E hardening + Lean + Classic 033 + per-section refine + asset manifest + Anthropic routing + per-provider keys (035)
- `claude/ai-image-description-extension-Tp3jY` — main branch

## Versão atual
`2.4.3`

## Estrutura do projeto
```
manifest.json                # Manifest V3 (Chrome/Opera)
background.js                # Service worker: injeção, APIs IA (Gemini + Anthropic via model-name regex), captureVisibleTab
editor/editor.js             # EDITOR PRINCIPAL
editor/editor.css            # Estilos (seleção, layers, inspector, guides)
editor/mode-e.js             # Mode E (parallel viewport) + Lean (Flash + floaters) + cancel/watchdog + asset restore + section bounds
editor/mode-e-classic.js     # Mode E0: pipeline 033 frozen, A/B reference
editor/mode-e-diff.js        # Mode E refine: visual diff vision call + JSON salvage scanner pra outputs truncados
editor/mode-e-refine.js      # Mode E refine: per-section regen (paralelo) + structural validator
editor/detect.js             # Detecção de web builder (8 builders)
editor/freeze.js             # Congela animações (GSAP, Lenis, Webflow IX)
editor/rebuild.js            # Rebuild engine v4 (tag elements + disable interactivity)
editor/mode-b.js             # Mode B: DOM Mirror (standalone, stylesheet extraction + body clone)
editor/mode-e2.js            # Mode E2: Fast HTML-to-Code (same.new-inspired multi-call Flash pipeline)
editor/s2h.js                # S2H: Screenshot-to-HTML (2-pass vision pipeline, independente do Mode E)
editor/fill-popup.js         # Fill popup: Color (canvas picker) / Gradient / Image / Effects
editor/normalize.js          # Curate engine
overlay/semantic.js          # AI semantic mapping (legado, substituído por Mode E)
overlay/extractor.js         # Tokens, cleanHTML, generateDesignMD + buildAssetManifest (placeholders pra img/svg/bg-image)
panel/panel.js               # Widget flutuante (onboarding, HTML→Design, Smart Remix)
panel/panel.css              # Estilos do widget
figma-plugin/                # Plugin Figma companion
web/                         # Portal Next.js (auth + Stripe + relay API)
```

## Editor Visual — Estado Atual

### Funcionalidades (Mode A: CSS Live)
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
23. ✅ Image popup panel — swatch field + popup with thumbnail/replace/download
24. ✅ Fill/Stroke/Effects auto-expand — collapsed with "+" when empty, expanded when has content
25. ✅ Drag-to-adjust on line-height/letter-spacing icons
26. ✅ Frosted glass mini widgets
27. ✅ CSS isolation — font-family !important to prevent site CSS bleed
28. ✅ Undo/Redo — unified applyUndoEntry(forward) com 9 tipos de operação, Cmd+Z/Cmd+Shift+Z/Cmd+Y
29. ✅ Text edit undo — contentEditable nativo durante edição, __textEdit entry no exit
30. ✅ Clipboard — Cut/Copy/Paste com navigator.clipboard + fallback interno
31. ✅ Find — overlay de busca com cycling por selectEl
32. ✅ Logo dropdown menu — Preferences/Save/Edit/View/Text/Help/Account (placeholders) + Saved versions history/Export/Undo/Redo/Cut/Copy/Paste/Find (funcionais)
33. ✅ Saved versions history — painel com snapshots do persist.js, restore com confirm()
34. ✅ Mode E persistent toast — showToast/updateToast, auto-dismiss 5s (sucesso) / 10s (erro), cleanup ao trocar de modo
35. ✅ Mode E 90s timeout — chunkToHTMLRaw com setTimeout wrapper
36. ✅ Fill popup (fill-popup.js) — 3 popups: Background (Color/Gradient/Image/Effects), Image-only, Color-only
37. ✅ Canvas color picker — HSB box + hue slider + alpha slider, zero dependência externa (iro.js removido por CSP)
38. ✅ Gradient editor — Linear/Radial, stops editáveis (pos/cor/alpha), reverse, add/remove
39. ✅ Effects gallery — 12 efeitos CSS animados em grid 2x2 scrollável (Aurora, Sunset, Pulse, Ocean, etc.)
40. ✅ Format dropdown — HEX/RGB/HSL/HSB/CSS com divider + chevron
41. ✅ Per-row eye + minus — cada campo (Background, Image, Colors) tem toggle visibility + remove
42. ✅ Tab switching preserves state — Color re-aplica cor ao voltar, Gradient só aplica quando ativado
43. ✅ Uniform field height — todos os campos do inspector têm 25px
44. ✅ Text colors centralizadas em Fill — movidas de Typography, widget completo com 4 abas
45. ✅ background-clip:text — gradientes, imagens e efeitos animados dentro do texto
46. ✅ Gradient handles draggáveis — arrastar stops na preview bar, click para adicionar
47. ✅ Effects via ::before — pseudo-element com opacity independente, não afeta conteúdo nested
48. ✅ Frosted glass popups — backdrop-filter:blur(40px) no modo undocked
49. ✅ Image como elemento — upload cria `<img>` real, não background-image
50. ✅ Color Library — "Custom swatches" (localStorage) + "From this website" (stylesheet extraction), cursor conta-gotas
51. ✅ Add swatch button (+) — salva cor atual na Library, ao lado do campo de opacity
52. ✅ Link/unlink chain icon — default desconectado (single element), click para conectar à classe CSS
53. ✅ applyStyle exclui editor UI — cascade de color/font não vaza para #rb-editor-root
54. ✅ Popup viewport clamping — clampPopupToViewport() garante 8px gap do bottom do browser
55. ✅ Image minidock — action bar horizontal (Copy, Replace, Download, Smart Edit, Close) com flash highlight e scroll-to-image
56. ✅ Text minidock — Font, Size (drag), Weight (drag), Letter spacing (drag), Line height (drag), Restore, Close
57. ✅ Minidock frosted glass — mesmo visual dos widgets minimizados com drag handle
58. ✅ Assets tab 3 seções — Images, Icons (SVG inline serializado), Backgrounds com dividers
59. ✅ Video minidock — `<video>` usa o mesmo minidock de imagem
60. ✅ S2H multi-viewport — scroll-capture full page + per-viewport analysis + HTML stitching
61. ✅ Mode S: S2H — novo modo dedicado ao pipeline screenshot-to-HTML com 2-pass vision
62. ✅ Framer canvas-fixed fix — `html.rb-ed-docked { --framer-canvas-fixed-position:absolute }` contém navs fixas de sites Framer (ex: toolfolio.io)
63. ✅ Guides: modifiers — Alt (mirror lado oposto), Shift (uniform 4 lados), Cmd/Ctrl (snap 8px)
64. ✅ Guides: arrow-key nudge — mouse-hover marca guide como active, setas ajustam ±1px (Shift ±10, Cmd ±8)
65. ✅ Guides: G toggle — liga/desliga todas as guides com tecla G
66. ✅ Guides: inline input — dblclick no label abre input (aceita 20, 20px, 1rem, 2em, 50%, +5, -3)
67. ✅ Guides: delta preview — durante drag o label mostra `24 +12` com delta em rosa claro
68. ✅ Guides: visual refresh — box-shadow no widget, anel inset na guide ativa/hover, ring mais forte no dragging
69. ✅ Guides: corner handles — 4 quadradinhos 10x10 nos cantos da margin (NW/NE/SE/SW), drag altera 2 lados ao mesmo tempo, visíveis quando ambas margens ≥ 2px
70. ✅ Smart text cascade — `isTextWrapper` detecta split-text/nested text; applyStyle cascateia pra leaves; Typography/minidock consolidam reads (mostra "Mixed" se divergem); cores per-leaf quando wrapper tem cores distintas
71. ✅ Font field multi-font — wrapper com várias famílias exibe "Clearface, Geist" no campo; Enter guard evita aplicar o comma-display como font stack
72. ✅ Range-scoped typography — `__pendingTextRange` via selectionchange; applyPropToRange wrapa a seleção em span; reusa span existente em edições consecutivas; cobre 9 props (color, font*, line/letter-spacing, text-decoration/transform)
73. ✅ Typography advanced popup: Style row — toggles Bold (font-weight 400↔700) e Italic (font-style normal↔italic)
74. ✅ Font combobox search-as-you-type — input com filtro live, dropdown filtrado; chevron toggle full list; Esc reverte, Enter commit só se mudou
75. ✅ Inspector value guards — todos inputs numéricos têm defaultValue; empty/NaN restaura (impossível limpar valores); letras X/Y/W/H/T/R/B/L non-selectable (pointer-events:none)
76. ✅ Inspector X/Y wired — campos aplicam `left`/`top` corretamente; letras em span separado (antes estavam inline no value)
77. ✅ Inspector values left-aligned — X/Y/W/H alinhados à esquerda como os demais inputs
78. ✅ Compact "Selection colors" row — quando >4 cores distintas, label + 4 swatches + "+N" pill; altura 25px; expand toca linha extra abaixo
79. ✅ Keyboard guard no inspector — INPUT/TEXTAREA/SELECT filtra os atalhos globais (Backspace/Delete/Cmd+X/C/V/Z) deixando behavior nativo nos campos
80. ✅ Resize W/N compensation — handle esquerdo/topo move a borda no sentido do mouse (compensa via margin-left/top ou left/top baseado em position); lazy unlockResize (threshold 2px); click puro é no-op
81. ✅ Position override via ID selector — auto-class fallback usa `#el.id` em vez de class (React/Framer stripam className); verificação em 2×rAF + 150ms + 600ms; dedup via WeakMap
82. ✅ Hover-first click resolution — click usa `lastHoverEl` quando está dentro do rect hoverado; hover e click resolvem sempre o mesmo elemento; user seleciona o que viu
83. ✅ Guides pass-through — pink guides não comem clicks; mousedown com drag threshold 3px; click sem drag esconde guides/corners e seleciona o elemento visualmente abaixo
84. ✅ Framework override (sticky inline writes) — MutationObserver observa `style`+`class` do elemento; quando React/Framer/Hydrogen sobrescreve inline, reescrevemos com !important. Cumulativo ao ID rule (ID vence className rewrite; sticky vence inline rewrite). Disable-on-fail após 5 rewrites em 2s. Anti-loop via `_rbStickyWriting` flag + dedup por computed === sticky value. Undo do `__cascade` chama `stopStickyForEl` antes de restaurar cssText
85. ✅ X/Y auto-promote position — se elemento é `static`, primeiro write em X/Y promove pra `relative`. `readPosXY` lê do contexto correto: `cs.left/top` (relative), `offsetLeft/Top` (abs/fix/sticky), 0 (static). Substitui leitura errada de `r.left/top` (viewport coords)
86. ✅ Link section no inspector — aparece acima de Container, padrão empty/populated do Stroke. `+` expande section in-place com input focado (sem popup); Enter wrappa em `<a>`. Detecção estrita: só reconhece link quando elemento É `<a>` ou único filho de `<a>`. Novos undo types `__linkWrap`/`__linkUnwrap`/`__hrefChange`
87. ✅ Link icon no minidock (text + image) — helper `makeDockLinkBtn`. Ícone azul quando tem link, outline quando não. Click abre `openLinkEditor` popup compartilhado
88. ✅ Font picker compartilhado (`openFontPicker`) — usado por inspector e minidock. Popup reusa `rb-ed-img-menu` (frosted glass + light mode automático). Constante `FONT_ICON_SVG` idêntica em ambos os lugares
89. ✅ Click-to-type nos valores do minidock — drag mantido com threshold 3px; click sem drag converte span em `<input>` focado. Enter commita, Escape reverte, blur commita
90. ✅ Ícones permanentes no text minidock — font/size/weight sempre mostram ícone SVG prefixado (antes só quando Mixed). Consistência com ls/lh que já tinham ícones
91. ✅ Widget de modos compacto — trigger pequeno (chip + label + chevron) no bottom-left, dropdown pra cima. Centralizado em `MODE_LIST` (adicionar modo novo = 1 linha). Substitui banner horizontal do bottom-center
92. ✅ Corner handles — 4 handles quando QUALQUER margin ≥ 2px (antes só com both-adjacent ≥ 2px). Cobre h1 com margin-block default browser
93. ✅ Font dropdown do inspector escapa do overflow — agora `position:fixed` anexado a `<body>` + reposicionado via `getBoundingClientRect`. Antes era clipped pelo `overflow:hidden` do inspector. Cleanup de orphan em updateInspector + deactivate
94. ✅ Guide editing não trava mais clicks — global mousedown capture força blur do input do guide se target não for o próprio input. Antes comparava widgets, deixava brechas (corners, inspector, site)
95. ✅ **Edit mode persistence** — Done captura iframe HTML via `captureCleanHtml` (strip data-rb-*/rb-ed-*) e POST em `/api/nodes/[id]/save-edit`. Cria novo snapshot, atualiza `current_snapshot_id`. Reset button finalmente acende quando há edits.
96. ✅ **Cancel + popup** — Cancel button ao lado do Done (só em edit). Popup com X close + Discard + Save and exit; click-outside ou Esc = continue. Discard bumpa `_resetTick` pra remontar iframe do server html.
97. ✅ **Topbar redesign** — Duplicate/Download/Reset/Delete só no More dropdown; topbar inline = `[Cancel?] [Edit/Done] | [More]` com vertical separator. `topbar-right margin-left:auto` ancora à direita. Edit visível em todo zoom (icon-only abaixo de zoom-low).
98. ✅ **Topbar grip slide below 20% zoom** — `left: calc(50% * min(1, var(--canvas-scale, 1) / 0.2))`. Centrado acima de 20%, desliza progressivamente pra esquerda abaixo, evitando sobreposição com botões inflados (size = native / scale). Title trunca via `max-width: calc(50% - 20px scaled)`.
99. ✅ **Hero proportion + dash handles** — site/html nodes default 16:9 (`width × 9/16`). `.cnode-body` tem altura fixa = node.height; iframe = 100% body com `overflow:hidden`. Bottom + right dash resize handles (40×3px / 3×40px) draggáveis pra ajustar height/width.
100. ✅ **Expand floater** — `.cnode-expand-float` no canto inferior direito do body. Toggle entre hero e full content (lê scrollWidth/Height capturado em onIframeLoad). Ao expandir passa `cascade: true` ao onResize.
101. ✅ **Cascade overlap-shift** — quando node se expande sobre vizinhos: edge incoming-to-expanding → empurra esquerda; outgoing-from-expanding → empurra direita; sem edge → empurra pro lado em que já está. Persiste paralelamente.
102. ✅ **Frame controls API** — `__uncraftZoom.getNodeFrame(nodeId)` + `frameNode(nodeId, animMs)` + `panBy(dx, dy)` + `getState()` + `setState(state, animMs)`. Frame-back button no zoom widget do editor lookup nodeId via `__uncraftMountOptions.nodeId`, sem stamping racy de `_editFrame`.
103. ✅ **Edit-frame width-fit** — `computeEditFrame(node)` ignora altura: `Math.min(vw / nodeW, 1.0)`. Edit mode entra com zoom máximo width-fit; user pana vertical com wheel pra ver mais.
104. ✅ **Fit-to-view selection-aware** — durante edit, fit reframe o editing node; sem edit + selection, fit no selected; sem nada, fit all-nodes bbox.
105. ✅ **Wheel routing edit-mode** — sem modifier: `panBy(-dx * 0.3, -dy)` (canvas pan; horizontal damped 30% pra Magic Mouse / trackpad). Cmd/Ctrl: zoom canvas. Resting: zoom canvas. Iframe internal scroll desabilitado em edit.
106. ✅ **Hydration warning suppress** — `suppressHydrationWarning` em `<html>` + `<body>` no app/layout.jsx pra extensões (Demoway / Grammarly / dark-reader) que injetam attrs antes da hidratação.
107. ✅ **Cancel popup polish** — width 220px (vs 280 do reset), título com padding-right pra X (não desloca card), Discard hover sólido `#ef4444 + #fff`, botões centrados. Add feedback pill movido pra bottom-right da seleção, full pill (`border-radius: 999px`), tab inteiro clicável.
108. ✅ **Node-tool run-flow engine** — `lib/run-flow.js` `runCompose({target, sources})` agrupa sources por kind (html/md/prompt/asset/skill) e chama LLM com `COMPOSE_SYSTEM` prompt que adapta operação ao mix. Anthropic OR Gemini via regex no modelo. Asset/screenshot inputs ainda rejeitam (placeholder pra GPT 5.5 vision).
109. ✅ **`POST /api/nodes/[id]/run`** — carrega target + edges incoming + source snapshots, chama runCompose, salva snapshot novo, marca edges como `applied`. PromptDock arrow é o trigger (click sem text/image = run flow).
110. ✅ **Per-target run status chip** — `runStatus: Map<nodeId,{step,label}>` em CanvasClient. `runOneTarget(id)` mostra `1/3 Reading inputs…` → `2/3 Generating…` (após 1500ms) → `3/3 Saving…` (após API). Chip frosted-glass com spinner acento `--cnode-port-fill`, ancorado abaixo do node body.
111. ✅ **Asset / screenshot upload** — kind `asset` adicionado a VALID_KINDS. `handleUploadScreenshot` lê file via FileReader → data URL → meta.dataUrl. Body renderiza `<img>` com `object-fit: contain` em `.cnode-body-asset`. KindLabel: "screenshot / asset". `nodeOrigin('asset')='screenshot'` reusa cor violeta + ícone.
112. ✅ **Anthropic streaming p/ long calls** — `messages.stream({...}).finalMessage()` em vez de `messages.create()`. SDK recusa non-streaming com max_tokens 32k (10-min cap). Aplicado em run-flow + demarcelize.
113. ✅ **Capture pre-check WAF tolerance** — UA Chrome 124 realista em vez de "UncraftBot/1.0", + pass-through em 403/406/429/503 (HEAD bot-policy não prediz failure com browser real do Playwright).
114. ✅ **`predev` script** — `rm -rf .next && lsof -ti:3030 | xargs kill -9` antes de `npm run dev`. Fim do `Cannot read properties of undefined (reading 'call')` recorrente em HMR de arquivos grandes.
115. ✅ **OpenAI / GPT 5.5 routing** — `openai@6.37.0` instalado. `lib/run-flow.js` callLLM ganha branch `isOpenAI = /^(gpt|openai|o[1-9])/i` que usa `chat.completions.create({stream:true})` e acumula deltas. `temperature` omitido na branch OpenAI (GPT-5 family + o-series rejeitam custom temp).
116. ✅ **Vision multimodal** — `assemblePrompt` retorna `{text, images}` extraindo `dataUrl` de `buckets.asset[].meta`. `callLLM` aceita `images:[]`. OpenAI vira content array multimodal `[{type:text}, {type:image_url, image_url:{url}}]`. Data URLs aceitas direto sem CDN.
117. ✅ **Auto-routing por presença de imagem** — runCompose força `effectiveModel = 'gpt-5.5'` quando `buckets.asset.length > 0` e o picker não é OpenAI. Picker preservado pra flows text-only.
118. ✅ **Model picker plumbing end-to-end** — `MODEL_ALIAS` mapeia picker IDs (`gpt-5.5`, `claude-4.6-opus`, `gemini-3.1-pro`, `kimi-k2.6`) pra strings SDK-friendly. Fluxo: PromptDock.submit() → onRunFlow({modelId}) → CanvasClient.handleRunFlow(opts) → runOneTarget → api.runNode(id,opts) → POST body → /api/nodes/[id]/run → runCompose({modelId}) → resolveModel → callLLM.
119. ⚠️ **Anthropic billing** — claude.ai (Pro/Max) e Anthropic API são buckets separados. A subscription do chat NÃO credita a API. User precisa adicionar créditos em console.anthropic.com/settings/billing. Sonnet ~$3 in/$15 out por 1M tokens; run típico = $0.15-0.30.
120. ✅ **Spike scroll-record → site reconstruction** — `packages/web-shell/scripts/video-scroll-spike.mjs` (~600 linhas, standalone). Pipeline em 9 iterações: scroll-stop capture (snap-scroll por viewport, stride dinâmico, settle pós-animação) → asset manifest (URLs + bbox + visibility por stop) → thumbnails via canvas in-page → animation diff (vision call por par consecutivo) → color/typography probes via `getComputedStyle` → **auto-rasterização** (`page.screenshot({clip})` para `<canvas>`, `<video>`, `<iframe>`, SVG > 50KB) → single vision call GPT-5.5 com `data-asset-id` placeholders → post-process inject. Validado em Webflow (farmminerals) + Framer (toolfolio + residence). Rasterização é a chave: custom typography e ilustrações irreproduzíveis viram PNGs pixel-perfect. Outputs em `scripts/spike-out/` (gitignored). **PROMOVIDO PARA FEATURE em item 121.**
121. ✅ **Canvas snapshot: detect-and-route pra animated-builder sites** — `lib/snapshot.js` `detectAnimatedBuilder(page)` probe após networkidle pontua: Webflow IX3 (+2), Framer Motion ≥3 (+2), IX3 scroll wrapper (+2), Lenis (+1), sticky-heavy (+1). Score ≥2 fecha browser e delega pra `lib/reconstruct.js` `reconstructPage()` — port server-side do spike iter-9. Reuse de stops + manifest + thumbnails + auto-raster + color/font probes + single GPT-5.5 vision call + post-process. **Static path** (sites simples) ganhou: UA Chrome 124 realista, scroll-to-bottom-no-reset, force-show CSS (`[data-w-id], [data-aos], ...`), inline external stylesheets com vh-pin, body bg sampling via PNG pixel decode (`zlib.inflateSync`+`inflateRawSync` fallback) com mediana per-channel. Storage: rasters em `public/rasters/<sha1-of-url>/raster-N.png`, HTML referencia via `/rasters/<hash>/...`. **UX**: route stream SSE com `Accept: text/event-stream`, eventos `progress` por stage (launching/navigating/capturing/thumbnailing/thinking/finalizing) + `done` final; placeholder do node mostra stage label durante 2-3 min. **Wheel routing** em CanvasNode: mouse sobre node + sem modifier → iframe scrolla nativo (handler `onWheel` no `.cnode-body` faz forward com `scrollBy` quando iframe é pointer-events:none); Cmd/Ctrl → canvas zoom; canvas vazio → zoom (untouched). Validado e2e em farmminerals: detection score=5, 2:30, 70KB HTML, 13 rasters, 21/21 bindings. Commits: 0f9fb1a, 1f2bce4, 0a05ca7. Detalhes: memory `checkpoint_2026-05-25_042.md`.

### Mode E: Papel Vegetal (Vision-to-Code)
**O que aprendemos:** Vision-to-Code (screenshot → LLM → HTML) é a abordagem recomendada para longevidade. O same.new usa component chunking: segmenta a página em componentes antes de enviar ao LLM. A técnica DOM + Screenshot hybrid melhora a qualidade: enviar screenshot + cleanHTML juntos. O extractor.js já produz tokens e cleanHTML — falta integrar no prompt.

**Implementado:**
- ✅ Builder detection (8 builders)
- ✅ Animation freeze (GSAP, Lenis, Webflow IX2/IX3)
- ✅ Scroll-capture (max 8 viewports)
- ✅ Design token extraction (cores, fonts via extractor.js)
- ✅ Screenshot → Gemini 3.1 Pro Preview (vision) → HTML/CSS rebuild
- ✅ Preserva editor UI durante rebuild
- ✅ DOM + Screenshot hybrid — cleanHTML do extractor.js no prompt
- ✅ **DESIGN.md generator Aura-parity** (extractor.js `generateDesignMD()`, 1974 linhas):
  - Overview com tone sentence auto-detectado
  - Layout & Grid (sticky/sidebars/backdrop-blur/graph-paper/section paddings)
  - Color Palette com semantic roles (surface-base, primary-text, accent-N) + descritores ("off-white beige")
  - Typography com Tailwind class annotations em pesos/sizes/line-heights/tracking
  - Components com TW class strings por variante + hover state correlation + inner icon container detection
  - Graphic Elements & Shapes (tall pills, extreme radii, rotated blocks)
  - Animations & Interactions (::selection, :hover, @keyframes, transitions)
  - **Responsive Behavior** — parsing de @media queries, agrupado por breakpoint, com guidance Tailwind (md:, lg:, xl:). Substitui multi-breakpoint capture.
  - CSS Custom Properties com cross-ref Tailwind
  - Assets com background-image inventory categorizado
  - Source Implementation Cues (10+ prompt-ready MUST-preserve directives)
- ✅ **Component chunking** (mode-e.js `runModeEChunked`) — **NÃO é o default, disponível via runChunked()**:
  - `extractSections()` no extractor.js — detecção semântica + dedup nested + sticky/footer identification + per-section cleanHTML
  - Pipeline chunked com captura por section, sticky-header dedup, queue paralelo (concurrency=2, 500ms stagger)
  - Stitcher monta HTML responsivo por ordem visual
  - ⚠️ **Não está pronto:** extractSections() detecta poucos sections, requer Tailwind CDN, 10x mais lento que viewport
  - Default revertido para viewport pipeline (inline styles) em e1c6968
- ✅ **Image upload path** (mode-e.js `runModeEFromImage`):
  - `generateDesignMDFromImage()` — produz DESIGN.md a partir de screenshot via vision call
  - Few-shot com exemplo sintético de ~3KB embedded no prompt
  - Pipeline standalone que NÃO precisa de site ao vivo — funciona em qualquer screenshot (Dribbble, Twitter, mockup, PDF)
- ✅ **Persistência IndexedDB** (editor/persist.js, 308 linhas):
  - Stores: projects + snapshots
  - createProject ao final do chunking, snapshots automáticos a cada 30s
  - prune automático (50/projeto, 7 dias retenção)
- ✅ **Aura prompt style** em buildChunkPrompt + buildPrompt:
  - "EXACTLY mode" declarado upfront
  - SOURCE HIERARCHY com role labels + CONFLICT RESOLUTION block
  - PRESERVATION RULES (6 "do nots" do Aura)
  - Detected Source Implementation Cues extraídas do DESIGN.md via regex e injetadas no prompt
  - Conflict rule repetida no fim (Aura technique para fight LLM drift)

**Fidelidade observada/projetada:**
- Baseline (só screenshot): ~65-75%
- Com DESIGN.md rico (estado atual): ~85-93%
- Com chunking (implementado): ~92-95%
- Com refinement loop (próximo): ~95-97% (meta same.new)

**Roadmap para melhorar fidelidade:**
1. ✅ DOM + Screenshot hybrid
2. ✅ Component chunking
3. ✅ Image upload path (vision-based DESIGN.md)
4. ✅ **Refinement loop M1** — full-page diff-vs-original + 1-pass regen (E+ visível)
5. ✅ **Refinement loop M2** — per-section regen paralelo + structural validator (035)
6. ✅ **Asset manifest** — placeholders no prompt + restore pós-gen (035, evita LLM regenerar logos/imagens)
7. ⬜ **Asset localization** — baixar imagens/fonts para data URLs (offline-friendly)
8. ⬜ **History UI** + **Projects UI** (persist.js já tem a API, falta UI)
9. ⬜ **UI do diff report** — issues retornadas mas não visualizadas (overlay com bbox)
10. ⬜ **Smart stitcher** — eliminar declarações CSS duplicadas entre chunks

### Mode E hardening (035)
Trabalho de estabilidade sobre o pipeline existente — não muda a fidelidade, mas tira o pipeline da categoria "às vezes trava silenciosamente" e o coloca em "robusto":

**Cancel + wallclock watchdog:**
- `_abortCtrl` + `cancelRun()` + `withAbortAndTimeout(p, ms, label)` em mode-e.js
- Watchdog usa `setInterval(..., 1000)` + `Date.now()` em vez de setTimeout — sobrevive ao Chrome intensive-throttling de tabs em background (que mascarou um diff call stuck por 80 minutos)
- `wrapTopLevel(fn)` envolve run/runWithRefine/runLean/runViewport: owns o controller, captura erros não-handleados e converte em `step:'error'` (antes virava unhandled rejection silenciosa, loader girava pra sempre)
- Cancel button visível em todos os Mode E activators
- Exposto pra satellites: `__rbModeE._guardCall`, `_runWithQueue`, `_captureGuard`

**Capture guard (cross-tab contamination fix):**
- `installCaptureGuard()` injeta banner amarelo durante captura + listener `visibilitychange` que aborta hard se tab perde visibility (corrige incidente em que conteúdo de outra aba Shopify vazou pro rebuild de gistr.so)
- background.js: `chrome.windows.update({focused:true})` ANTES de `tabs.update`, espera 500ms (era 150ms), sanity check de tamanho dataUrl (<5KB → retry 1x)

**Asset manifest (extractor.js + restoreAssets):**
- `RB.buildAssetManifest()` clona DOM e substitui:
  - `<img>` → `<img data-rb-asset="N" alt="...">` (mantém class/style/width/height pra contexto)
  - `<svg>` grandes (>200B) → `<svg data-rb-asset="N"></svg>` (innerHTML zerado)
  - CSS `background-image: url(...)` → atributo `data-rb-asset-bg="N"` no nó (scan limitado a 3000 nós pra não freezar main thread)
- Cap em 80 assets, dedup por URL/outerHTML, URLs absolutizadas
- Manifest text injetado no prompt + regra "emita placeholder verbatim"
- `restoreAssets(html, assets)` em mode-e.js faz swap pós-geração preservando class/style do LLM
- Reduz drasticamente "logo regenerado como SVG hand-crafted"

**Per-section refine (mode-e-refine.js + mode-e.js):**
- `runModeEWithRefine` coleta `sectionList` com bbox + html pós-rebuild
- `runRefine({...sections})` mapeia issues por bbox.y → section index, regen paralelo concurrency=3 com prompt menor (`buildSectionRegenPrompt`, cap 20KB, sem DESIGN.MD)
- `validateSectionStructure(orig, new)` rejeita updates que perderam tags críticas (header/nav/footer/main/h1) ou colapsaram element count <30%
- Fallback pra full-page legacy quando caller não passa sections (image-upload entry)

**Diff parser tolerante (mode-e-diff.js):**
- `salvageJsonArray(raw)` — scanner string-aware que extrai cada `{...}` top-level e tenta parsear individual. LLM truncar mid-item antes perdia tudo; agora salva os itens válidos.
- Distingue legit clean `[]` de "salvage achou 0 itens em raw não-vazio"
- Prompt mais terso: max 6 itens (era 8), `issue` cap 80 chars, `maxOutputTokens` 8000 (era 4000)

**Rate-limit retry (background.js):**
- `modeERebuild` e `modeERefineCall` ganharam loop 3-attempts com exp backoff 2s/4s/8s
- 429/503/529 considerados retriable
- Mensagem de erro final inclui hint `(rate limited after retries)` / `(service overloaded after retries)`

**Anthropic provider routing (background.js):**
- `modeERebuild` roteia por regex `^(claude|opus)/i` no nome do modelo
- Anthropic Messages API com `anthropic-dangerous-direct-browser-access: true`
- Per-provider keys no popup: `geminiKey`, `anthropicKey`, `composerKey` (reservado, disabled — sem API pública pro Cursor Composer 2)
- Migração legada: `apiKey` distribuído por prefix na primeira load (`AIza` → gemini, `sk-ant-` → anthropic). Legacy field hidden.

### Mode E Lean (EL, 035)
Variante de velocidade. Target: ~20-40s no site de 5 viewports vs ~50-70s do plain Mode E. Visível como **"EL: AI Lean"** no dropdown.
- Modelo: `gemini-2.5-flash` (em vez de Pro)
- DESIGN.MD intencionalmente OMITIDO (info já em inline styles do cleanHTML)
- Concurrency=5, stagger=100ms
- **Floater-as-static-clone:** captura `position: fixed|sticky` ≥20×20px do DOM com URLs absolutizadas + scripts strippados + style inline com pos/top/left/right/bottom/z-index. Captura roda com floaters HIDDEN em toda viewport — LLM nunca os vê. Pós-stitch, floaters são injetados como PRIMEIRA section.
- `findFloatingElements()` cap em 3000 nós (sites enterprise tinham 20k+ → getComputedStyle freezing)

### Mode E0 Classic (033 baseline, 035)
A/B reference. Pipeline 033 frozen em `editor/mode-e-classic.js` (16KB, namespace isolado), exposto via `window.__rbModeEClassic.run/.restore()`. Visível como **"E0: Vision (033 baseline)"**. Sem manifest, sem floaters, sem watchdog, sem viewport parallelism — pra comparar head-to-head com hoje. Reusa background.js hardenizado.

### Mode B: DOM Mirror (reimplementado como editor/mode-b.js standalone, 2.3.0)

### Mode B: DOM Mirror (reimplementado como editor/mode-b.js standalone, 2.3.0)

**Estratégia:** clone do body + extract de `document.styleSheets.cssRules` → snapshot com cascade/media/@keyframes/@font-face preservados. Mesma abordagem do Reforge + ClonewebX.

**Implementado:**
- `extractAllCSS()` itera stylesheets, try/catch em cross-origin (skip silencioso), absolutiza `url(...)` relativas.
- `cloneBody()` clona children non-editor, absolutiza src/href/srcset/poster + `url()` em inline styles.
- `disableInteractivity()` anulou navigation + submits.
- `__modeBRun` undo entry no stack.
- Isolation: IIFE sem `"use strict"`, try/catch defensivo. Arquivo separado pra que bug aqui não crash editor.js (lição do v5 anterior que vivia em rebuild.js).

**Target:** ~1s wall time, ~99% fidelidade visual, estático (congela state). Bom pra editar o que existe.

### Mode E2: Fast HTML-to-Code (editor/mode-e2.js, 2.3.0)

**Estratégia:** inspirada no transcript do same.new. HTML-to-code multi-call pequena sobre cleanHTML.

**Pipeline (3 etapas):**
1. **Analyze** — 1 call Flash com cleanHTML (extractor) + DESIGN.md tokens → JSON estrito `{overall_tone, colors, fonts, sections[]}`.
2. **Generate** — per-section call Flash em paralelo (concurrency 3). Prompt minimal focado. Textos/imagens extraídos verbatim.
3. **Stitch** — concat + Tailwind CDN + replace page. Reusa `__modeERun` undo shape.

**Endpoint:** `modeE2Call` em background.js, text-only, `gemini-2.5-flash` default, maxOutputTokens 8000, temperature 0.4.

**Target:** 20-40s wall time, $0.05-0.10/clone, ~85-90% fidelidade. 10-20× mais barato que Mode E.

### S2H: Screenshot-to-HTML (novo pipeline, independente do Mode E)
**O que aprendemos:** O Aura.build produz reconstruções de alta fidelidade a partir de screenshots SOZINHOS (sem DOM). Testamos com o site heartwork — Aura produziu resultado quase pixel-perfect; nosso Mode E errou cores, layout, e conteúdo completamente. O problema NÃO é falta de DOM — é qualidade do prompt e arquitetura do pipeline.

**Implementado (editor/s2h.js, ~280 linhas):**
- ✅ Pipeline 2-pass: Visual Analysis → Reconstruction
- ✅ Pass 1 (Visual Brief): layout obrigatório, OCR de texto, cores hex de pixels, fonts como características
- ✅ Pass 2 (HTML): screenshot + brief → HTML com `<style>` block + classes semânticas
- ✅ Screenshot enviado em AMBOS os passes (referência visual primária)
- ✅ Anti-patterns explícitos no prompt (não defaultar dark, não centrar tudo, não simplificar layout)
- ✅ Validadores para brief e HTML com retry
- ✅ `window.__rbS2H.run(imageDataUrl, onProgress)` + `replacePage(html)`
- ✅ Registrado no manifest.json e background.js (injeção entre mode-e.js e rebuild.js)

**Diferenças-chave vs Mode E:**
| Aspecto | Mode E | S2H |
|---|---|---|
| Passes | 1 (DESIGN.md → HTML) ou 2 (DESIGN.md + reconstruct) | 2 (Visual Brief + reconstruct) |
| Layout | Implícito (modelo decide) | Explícito (grid proportions obrigatórias) |
| Texto | Inferido pelo modelo | OCR transcription com hierarchy markers |
| Cores | Tailwind annotations | Hex de pixels, sem arredondamento |
| Fonts | Nomes adivinhados | Características ("geometric sans-serif") |
| Output CSS | Inline styles | `<style>` block com classes |
| Screenshot | Só no pass 2 | Ambos passes |

**Pendente:**
1. ⬜ Testar com screenshot heartwork
2. ⬜ Wiring no editor UI
3. ⬜ Image region cropping (extrair fotos do screenshot como placeholders)
4. ⬜ Comparar qualidade S2H vs Mode E viewport
5. ⬜ Considerar merge do Visual Brief prompt de volta no Mode E

### Mode B: Rebuild (DOM Mirroring) — baseado no Reforge
**O que aprendemos:** O Reforge usa DOM Mirroring com stylesheets originais — extrai CSS rules via `document.styleSheets` (não `getComputedStyle`). Isso preserva media queries, hover states, keyframes, cascade. Resultado: 95% de fidelidade visual.

**Implementado:**
- ✅ rebuild.js v4 funcional (tag elements + disable interactivity)
- ❌ rebuild.js v5 (stylesheet extraction) **causava crash silencioso** — revertido

**Caminho:** Re-implementar v5 como arquivo separado (não dentro do rebuild.js) para evitar conflitos de escopo com o editor. Causa provável do crash: conflito de escopo com `"use strict"` ou shadowing de variáveis.

## Bugs conhecidos e padrões descobertos

### Padrão crítico: drag handlers em canvas mode precisam dos dois docs
**Problema**: Em canvas mode (`hostDoc !== targetDoc`), eventos mousemove/mouseup que originam DENTRO do iframe (target) NÃO bubble pro host doc. Drag handlers que escutam só `hostDoc.addEventListener('mousemove'/'mouseup')` ficam presos quando o cursor entra na área do iframe — mouseup nunca chega → drag em estado ghost-pressed → onMove dispara em loop conforme o cursor se move.

**Pior ainda**: `ev.clientX/Y` em eventos do iframe é em coords do **iframe viewport** (largura natural, ex 1280), enquanto `dragStartPos` capturado no mousedown do host está em coords do **host viewport**. Comparar os dois dá deltas absurdos.

**Solução** (editor.js):
- `bindDragOnBothDocs(move, up)` / `unbindDragOnBothDocs(move, up)` helpers no escopo da IIFE. Registram em host + target quando docs são distintos. Em modo extensão (host === target) só registra uma vez.
- `eventToHostXY(ev)` — detecta `ev.view === targetWin` e converte iframe-coords → host-coords usando `iframe.getBoundingClientRect() + scale`. Aplicado em TODA leitura de `ev.clientX/Y` em handlers de drag.
- Scale-aware delta: em zoom < 1 do canvas, host-px delta deve ser dividido pelo `_scale` antes de virar valor CSS (margins/sizes vivem em coords target).
- Stash de elemento alvo (`var resizeEl = selectedEl`) no mousedown — closure-captured `selectedEl` pode virar null mid-drag (deselect lateral) → null deref storm em CADA mousemove (87× por gesture observado, polui mousemove pipeline e mata outros handlers downstream).

**Aplicado em**: spacing-guide drag, corner-guide drag, selection-resize handles. ~6 outros handlers ainda só em host — migrar quando bug surgir.

### Padrão crítico: framework override (React/Framer/Hydrogen)
Sites com framework reativo reescrevem `style=""` e `className` no próximo render, sobrescrevendo nossos writes. Defesas cumulativas em `applyStyle._verifyApply`:
1. **Inline !important** (primeiro write) — vence especificidade normal
2. **ID rule !important** (`applyOverrideClass`) — vence quando framework rewrite `className` (o `id` raramente muda)
3. **Sticky MutationObserver** (`startSticky`) — vence quando framework reescreve `style` attr. Observa `style`+`class`, reescreve inline se computed diverge do valor registrado. Dedup por `getCS === rec.value` (nossos próprios writes são no-op). Disable após 5 fails em 2s pra não entrar em guerra infinita.

Limite: full remount (nó novo) perde WeakMap — precisa rastreamento por seletor, não implementado.

Em undo do `__cascade`, chamar `stopStickyForEl` antes de restaurar cssText pra evitar que o sticky stompe o undo.

### Padrão: dropdowns dentro do inspector devem ser `position:fixed` + body
O `#rb-editor-inspector` tem `overflow:hidden` e o `#rb-ed-insp-body` tem `overflow-y:auto`. Qualquer dropdown `position:absolute` dentro é clipado. Apend direto em `document.body` com `position:fixed` e recalcular `left/top` via `getBoundingClientRect(anchor)` em cada show. Cleanup obrigatório em `updateInspector` (rebuild orpha) e `deactivate`.

### Padrão: guide inline-edit input deve blurar em qualquer click fora
O `.rb-spacing-inline-input` criado por dblclick no label de guide é focusable. Enquanto focado, o guard global de shortcuts (`_inInspectorForm` em editor.js) bloqueia Cmd+Z etc. E o `e.preventDefault()` global de mousedown impede focus transfer natural. Solução: no mousedown capture do editor, se `e.target !== activeGuideInput`, chamar `.blur()` explicitamente. Comparar widgets deixa brechas (corners, site, inspector).

### Padrão crítico: refactor `<select>` → `<input>` tem pontos cegos
O commit f6d7f42 trocou o font combobox do inspector de `<select>` pra `<input>`. Mas `showGlobalCSS` (chamada ao desselecionar) ainda lia `fontSel.options[0]`. Em `<input>` isso é `undefined.length` → TypeError que abortava `switchMode` inteiro. Ao fazer refactors desse tipo, `grep` TODAS as referências `.options`, `.selectedIndex`, `.multiple` antes de commitar.

### Padrão: position X/Y em elementos static
Elementos com `position: static` ignoram `left`/`top`. Antes de escrever, chamar `ensurePositionable(el)` que promove pra `relative`. Para leitura no inspector, usar `readPosXY(el)`: `cs.left/top` (relative) ou `offsetLeft/Top` (abs/fix/sticky) — nunca `r.left` (viewport).

### Padrão crítico: botões do editor
**TODOS os botões do editor UI devem usar `mousedown` com `capture:true` + `stopImmediatePropagation()`.**
O click handler do document com `capture:true` intercepta clicks normais antes dos listeners dos botões. Usar `mousedown` com `capture` garante que o botão roda primeiro.
Afeta: banner mode buttons, close button, export button, minimize buttons (inspector + layers).

### CSS do editor: self-injection
O `chrome.scripting.insertCSS` no background **pode falhar silenciosamente**. O editor.js agora injeta o próprio CSS via `<link>` tag usando `chrome.runtime.getURL('editor/editor.css')`. O arquivo deve estar em `web_accessible_resources` no manifest.

### CSS de sites interferindo
Sites com Webflow IX3/GSAP podem aplicar `opacity:0` ou `visibility:hidden` aos painéis do editor via seletores genéricos. O editor.css tem proteção: `opacity:1 !important; visibility:visible !important` nos painéis principais.

### rebuild.js v5 crashava o editor
O rebuild.js v5 (DOM mirroring com stylesheet extraction) causava crash silencioso que impedia o editor de inicializar. Causa não investigada a fundo — provavelmente conflito de escopo com `"use strict"` ou shadowing de variáveis. Revertido para v4. Re-implementar com mais cuidado.

### Service worker e sendMessage
O `toggleEditor` handler no background.js deve usar `return true` + `sendResponse()` para manter o service worker acordado durante a injeção async. O panel.js faz `window.__rbEditorActive = false` antes de enviar para limpar flags stuck.

### Injeção de scripts — ordem importa
A ordem de injeção no background.js é: detect.js → freeze.js → extractor.js → persist.js → mode-e.js → s2h.js → rebuild.js → editor.js. O rebuild.js v5 era o último antes do editor.js e quebrava a inicialização.

### captureVisibleTab captura a aba ativa, não a aba do sender
O `chrome.tabs.captureVisibleTab` fotografa a aba que está na tela. Se o usuário troca de aba durante a captura do Mode E, captura o site errado. Fix (3cd987b): background.js agora usa `sender.tab` e foca a aba antes de capturar.

### Chunked pipeline requer Tailwind CDN
O prompt chunked pede classes Tailwind (text-5xl, py-24 etc) mas sem o runtime carregado, todas as classes são ignoradas. `replacePageContent()` agora injeta `cdn.tailwindcss.com/3.4.17` quando usado pelo chunked path. O viewport path usa inline styles e não precisa disso.

### Prompt hardening degrada qualidade
Temperature baixa (0.2), topP, thinkingConfig, blocos "CRITICAL OUTPUT CONSTRAINT" e retry agressivo ("REJECTED because X") fazem o Gemini produzir output pior. Usar defaults (só maxOutputTokens: 16000) e retry suave ("Note: please..."). Revertido em 1c27f12.

### FAB (Live Remix) removido
O botão flutuante "Live Remix" (buildFab/pauseEditor/resumeEditor) causava bugs: display restore deixava ele visível após Mode E. Removido completamente em 38b4bca. Não reimplementar.

## Abordagens Técnicas de Clonagem

### Três estratégias identificadas
1. **DOM Mirroring** — `document.styleSheets` (stylesheets originais) → CSS preservado com cascade, media queries, hover states. Fidelidade 95%. Mode B usa isso.
2. **Vision-to-Code** ⭐ — screenshot → Vision LLM → HTML novo. Fidelidade 70-90% dependendo do prompt. Mode E usa isso. Recomendada para longevidade.
3. **Runtime Interception** — reverse-engineer do builder runtime. 100% fidelidade mas frágil. NÃO implementar.

### Reforge (build.reforge.com) — engenharia reversa feita
- Usa Strategy 1 (DOM Mirroring) com **stylesheets originais** (não computed)
- 13 arquivos CSS preservados, 35 componentes React auto-gerados
- SafeImage com proxy CORS para imagens
- Esconde elementos animados com `visibility:hidden !important` em vez de reproduzir
- Confirma que `document.styleSheets` é superior a `getComputedStyle`

### Fontes de pesquisa (abril 2026)
Múltiplas fontes validaram a abordagem Vision-to-Code + component chunking: Khoj, Tavily, Scira, Kragent, Morphic. O same.new (YC W24, $3M ARR) é a referência principal para component chunking.

### Aura.build — engenharia reversa feita (abril 2026 + teardown profundo 2026-04-22)
- Usa 3 fontes com hierarquia: **screenshot** (visual primário) > **captured page structure** (estrutura DOM) > **DESIGN.md** (tipografia + assets, secundário)
- DESIGN.md é **Markdown semântico** (~15KB): Overview, Colors (brand/semantic/neutrals), Typography (families + weights + usage + hierarchy), Elevation (borders vs shadows), Components (inventário), Do's/Don'ts, Assets (URLs categorizados)
- O "Overview" do DESIGN.md dá ao LLM o **tom** do site antes dos detalhes — crucial para qualidade
- Assets categorizados: Image, Font, Background, Other — com URLs reais para `@font-face`
- **NÃO é single-model Gemini.** Orquestração multi-modelo (confirmado no bundle Vite 13.6MB):
  - HTML principal: **GPT-5.4** (`gpt-5.4-2026-03-05`, não Gemini)
  - HTML → componentes React: **Claude Sonnet 4.5**
  - Extração de paleta: **Gemini 3 Flash** com 3-tier fallback (ss+css+html → ss+css → ss-only → CSS regex)
  - Image description / DESIGN.md synth: GPT-5.4 via `describe-image`
  - Picker default no UI: Gemini 3.1 Pro (mas backend default é GPT-5.4)
  - 15+ modelos expostos (Opus 4.7, Sonnet 4.5, GPT-5.4, Gemini 3.1 Pro/Flash/Flash-Lite)
- **Two-mode import:** EXACTLY (preserva texto/marcas) vs Different (reescreve texto/marcas mantendo estrutura). Prompt runtime-composto.
- **Screenshot pipeline em serviço dedicado Fly.io** (`aura-screenshot-service.fly.dev`). Retry ladder 4-tier: `[1360×1024 q70, 1280×960 q64, 1120×900 q58, 920×760 q52]`, budget 2min total.
- **Screenshot validity gate** (`validate-url-import-screenshot`): classifica captura como `acceptable|blank|blocked|verification|error_page|uncertain` ANTES de mandar pro gerador — bloqueia Cloudflare/login/region-block.
- **Phase-6 quality-fix loop** em `html-to-component`: envia files gerados de volta pro modelo quando `errorsFound:true`. Lint/fix server-side. **NÃO compara com original** (gap explorável pra nós).
- **Chunking é POST-generation**, não pre: `generate-html` produz HTML monolítico → `generate-components` (Sonnet 4.5) decompõe em componentes React depois.
- 19 edge functions Supabase mapeadas (import-react-url, generate-html, generate-components, html-to-component, iterate-react-component, convert-to-figma, etc.)
- Pricing: 5 tiers (`free|pro|max|ultra|elite`), métrica é "premium prompts" não tokens
- Resultado: alta fidelidade em sites complexos (testado em sanity.io)
- Referências salvas: `research/2026-04-22-aura-build-magic.md`, `.firecrawl/aura-sanity-design.md` (legado)
- **Implicação para RepixBridge:** nosso extractor.js deve gerar output no formato DESIGN.md (markdown semântico, não JSON). Oportunidade maior = **diff-refinement loop vs original** (nenhum competidor faz) — plano detalhado em `research/2026-04-22-diff-refinement-plan.md`.

### same.new — engenharia reversa feita (abril 2026, via leak x1xhlol)
- **NÃO é CV segmentation + component chunking.** É agente coding genérico.
- **Stack leak** (35KB Prompt + 22KB Tools): https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools/tree/main/Same.dev
- **Modelo:** GPT-4.1 (verbatim linha 1: "You are AI coding assistant and agent manager, powered by gpt-4.1")
- Roda em Docker Ubuntu 22.04 sandbox em `/home/project`
- Tool surface (15): `startup | task_agent | bash | ls | glob | grep | read_file | delete_file | edit_file (smart_apply) | string_replace | run_linter | versioning | suggestions | deploy | web_search | web_scrape`
- **`web_scrape` signature:** `{url, theme:light|dark, viewport:mobile|tablet|desktop, include_screenshot:bool}` — toda a superfície de clonagem
- **Chunking é CONVERSACIONAL**, não algorítmico: prompt diz "You can break down the UI into 'sections' and 'pages' in your explanation" + "If the page is long, ask and confirm with user which pages and sections to clone"
- **Refinement loop** via `versioning` tool: screenshot do próprio dev-server + lint errors → itera. **Não compara com original** (hard-cap: "DO NOT loop more than 3 times")
- **Animations explicitamente puntadas:** "web_scrape doesn't capture animations, do your best to recreate"
- **Stack default travado:** Next.js + shadcn/ui + Tailwind + Biome + Bun → Netlify. `startup` enum: `html-ts-css|react-vite|react-vite-tailwind|react-vite-shadcn|nextjs-shadcn|vue-vite|vue-vite-tailwind|shipany`
- Default shadcn theme: `zinc`. Prompt instrui verbatim: "NEVER stay with default shadcn/ui components. Always customize BEFORE building" + lista 40+ component files pra editar
- Asset CDN: `same-assets.com` rehospeda screenshots scrapados
- **`smart_apply:true`** no `edit_file` sugere apply-model secundário (padrão Cursor/v0)
- Pricing: Free 500K tokens → Ultra $100/20M tokens. 600K+ builders (YC W24, Aiden Bai + Nisarg Patel)
- **O "tech talk transcript" que inspirou Mode E2 provavelmente não existe como artefato público** — inferência agregada do leak + folklore
- Referência salva: `research/2026-04-22-same-new-magic.md` + leak em `/tmp/same-prompt.txt` + `/tmp/same-tools.json`
- **Implicação para RepixBridge:** kill chunking-as-moat. Build diff-vs-original refinement loop. Adopt same-assets.com pattern. Copy customize-shadcn-first instruction.

### CloneWebX — engenharia reversa feita (abril 2026)
- **Sem AI na hot path.** É transpiler DOM → 3 schemas de clipboard proprietários:
  - Webflow: `{"type":"@webflow/XscpData","payload":{"nodes":[...]}}`
  - Elementor: `{"type":"elementor","siteurl":"…","elements":[{elType,settings,elements:[]}]}`
  - Bricks: Structure JSON via `navigator.clipboard` (HTTPS required)
  - Também Gutenberg (block serialization), Breakdance, Divi 5
- Formatos são **públicos e estáveis** (Sygnal docs, Elementor GitHub discussions)
- Único AI: "AI Reduction DOM Size" (v1.0.13) — provavelmente equivale ao nosso `isUselessWrapper` + visual weight
- Arquitetura: Chrome ext fina (auth + scan) → backend `clonewebx.softlite.io` → retorna payload de clipboard → user cola no builder
- Server-side asset upload (v1.0.15, Apr 2024) mirroriza imagens no CDN do Softlite
- Animations **não exportadas** (Litemove vende separado, bundled em tiers altos)
- Sem JS/SPA dynamic — snapshot puro do DOM no momento do scan
- 50K users, 4.1★, time Hà Tĩnh Vietnam (publisher address)
- Pricing: Free (Gutenberg+Webflow, 10/mo) / $10/mo (30 sites) / $120/yr / $300 lifetime
- Referência salva: `research/2026-04-22-clonewebx-magic.md`
- **Implicação para RepixBridge:** adapter path é trivial (~1 arquivo de schema mapping + `clipboard.write()` por builder). Documentar agora, implementar quando houver demanda validada como Pro feature.

### Técnica recomendada: DOM + Screenshot Hybrid
Enviar AMBOS para o LLM: screenshot (fidelidade visual) + cleanHTML (textos, hierarquia, semântica). O extractor.js já produz cleanHTML e design tokens — falta integrar no prompt do Mode E. Essa é a próxima melhoria de maior impacto.

## Integração OpenPencil (futuro)
OpenPencil — editor Figma-like MIT, lê/escreve .fig, 100% browser (WASM/Canvas), zero servidor.
Visão: embed no Repix como iframe inline. Designer edita → Quick Edit no OpenPencil → exporta .fig.
MCP só suporta HTTP (incompatível com Claude Code stdio). Skill instalada.

## Modelo de Negócio

### Pricing
Em lock após benchmark 2026-04-27. Motor Mode E = Gemini 3.1 Pro ($0.525/clone medido). Free não tem rebuilds cortesia — `Free` = Mode A only. Tier estrutura pendente — ver memória `project_llm_lock_2026-04-27.md`.

### Decisão: cobrar pela IA, não BYOK
Experiência seamless, margem alvo 60-70% sobre custo do Pro 3.1, zero config para o usuário.

## Legal & Ética
Ferramenta de **inspiração e aprendizado** — designer edita para criar algo novo ("papel vegetal").

## Branding
- **Nome:** Uncraft (renomeado de RepixBridge em 2026-04-27; logo wordmark "Un" Medium + "craft" Light/0.62 opacity)
- **Slogan:** "Design without borders"
- **Tipografia (extensão):** Instrument Serif (display) + Instrument Sans (body/UI) — preservada por inertia visual
- **Tipografia (web-shell):** **Aeonik** local (Light/Regular/Medium/Bold em `packages/web-shell/public/fonts/aeonik/*.otf`). `@font-face` em `globals.css`. Body usa `'Aeonik', system fallback`.

## Web-shell — design system + arquitetura
- **CSS design tokens** em `packages/web-shell/app/globals.css` (`:root`):
  - `--bg-base: #0a0a0a`, `--bg-frosted: rgba(10,10,10,0.72)`
  - `--border-frosted: rgba(255,255,255,0.08)`, `--border-frosted-strong: rgba(255,255,255,0.12)`
  - `--text-primary: #f5f5f5`, `--text-secondary/muted/faint` em alphas
  - `--shadow-frost: 0 16px 60px rgba(0,0,0,0.55)`
  - `--radius-pill: 999px`, `--radius-sm: 12px`, `--radius-md: 18px`, `--radius-lg: 22px`
- **Família frosted-glass**: prompt-dock, canvas-header, node topbar, minidock, menus (empty-drop / canvas-context), boards-sidebar, signin-card, user-menu, reset-confirm-card. TODOS usam `rgba(10-26,10-26,10-26,0.5-0.78)` + `backdrop-filter: blur(28px) saturate(140%)` + 1px frosted hairline border.
- **Components**:
  - `BoardsList` — sidebar 240px (Uncraft mark, "Projects" nav, UserPill bottom) + main grid
  - `UserPill` — circular initial avatar + dropdown frosted (Account/Billing/Preferences/Sign out). Compartilhado: vai pro inspector header do editor depois.
  - `PromptDock` — substituiu Superwidget. 4 toggle pills: Add URL (sky), Brainstorming (purple, brain icon), Pin/Feedback (amber). "+" file button aceita image/.md/.html.
  - `CanvasContextMenu` — right-click no canvas: Add URL/HTML/.md/Screenshot. Screenshot é stub.
  - `ResetConfirm` — modal com Esc/Enter, fecha edit mode primeiro com 120ms de grace antes de swap srcDoc.
- **Color-coded edges/borders** via `lib/node-origin.js`: URL=`#38bdf8`, HTML=`#f97316`, MD=`#34d399`, Screenshot=`#a78bfa`. Aplicado em `.cnode.origin-*` border + `<path stroke={originColor(src)} />` em EdgeLayer.
- **Node ports**: `cnode-port-right` (button, drag para conectar via onStartEdge) + `cnode-port-left` (span, pointer-events:none, recebe drop via `closest('.cnode')`). `.cnode { overflow: visible }` pra ports protruir; topbar/body fazem rounding individual.

## OAuth (estado)
- **`.env.local`** tem `GOOGLE_OAUTH_CLIENT_ID` + `GITHUB_OAUTH_CLIENT_ID` provisórios (substituir com URL real depois). `*_CLIENT_SECRET` são placeholders (`PASTE_*_HERE`).
- **Routes** em `app/api/auth/oauth/{google,github}/{start,callback}/route.js`:
  - `start/` — checa secret. Se ausente/placeholder, redirect home com `?oauth_error=...`. Senão, monta provider URL + state cookie + redirect.
  - `callback/` — STUBS. Validam code/state, redirect home com "callback not wired yet". Token exchange + user create/link + JWT cookie é a próxima implementação.
- Login UI lê `?oauth_error=...` e mostra inline (URL é cleaned via replaceState).
- **Schema migration pendente**: provavelmente colunas `oauth_provider` + `oauth_sub` em `users` pra link OAuth identity.

## Reset feature
- `POST /api/nodes/[id]/reset` — busca primeiro snapshot do node, aponta `current_snapshot_id` pra ele. Retorna `{html, design_md, screenshot_url}`.
- Botão de reset visível no `cnode-topbar` durante e fora da edição. Modal de confirmação obrigatório.
- Durante edição: fecha editor primeiro (`onEditingChange(false)` + 120ms wait) antes de swap srcDoc — evita o `targetDoc` cached do editor virar stale ao replace do iframe content.

## Regras de desenvolvimento
- Incrementar versão a cada release significativo
- Injeção: detect.js → freeze.js → extractor.js → persist.js → mode-e.js → s2h.js → rebuild.js → fill-popup.js → editor.js
- CSS scoped via IDs `rb-editor-*` e classes `rb-*`
- `isEditorEl(el)` reconhece `rb-editor*` E `rb-ed-*`
- **TODOS os botões do editor: `mousedown` + `capture:true` + `stopImmediatePropagation`**
- Editor.js self-injeta CSS via `<link>` tag (não depender de `insertCSS` do background)
- Funções compartilhadas entre escopos: escopo externo da IIFE (NÃO dentro de `listen()`)
- Variáveis compartilhadas (ex: `layerHoverLock`, `isUselessWrapper`): escopo externo
- Checkpoint stash: `git stash push -m "checkpoint-NNN"`
- Modelo Gemini atual: `gemini-3.1-pro-preview` (definido em panel/panel.js MODEL_DEFAULTS e background.js). Modelos 2.x são marcados como outdated no background.js
- Settings UI vive em `panel/panel.js` — clicar no ícone da extension dispara `chrome.action.onClicked` que injeta o widget na página. NÃO há `default_popup` no manifest. `popup/` foi órfão por meses até ser removido em 2.4.5
- rebuild.js v5 crasha o editor — usar v4 até re-implementar com cuidado
- **Todos os campos do inspector devem ter 25px de altura** — sem exceção
- Fill popup: iro.js não funciona em sites com CSP restritivo — usar canvas picker nativo
- Fill popup: `background` shorthand sobrepõe `background-color` — limpar shorthand ao re-aplicar cor sólida
- `chrome.scripting.insertCSS` cria stylesheets na user-origin — `!important` delas bate inline `!important`. Animações do site devem ser congeladas via JS, não CSS
- Effects usam `::before` com `z-index:-1` para não cobrir conteúdo. Opacity do efeito é controlada no pseudo-element via `<style>` tag per-element
- Popup deve ler `cs.color` ou `cs.backgroundColor` conforme o `prop` — ler sempre `backgroundColor` causa alpha=0 quando o popup é aberto para texto
- `applyStyle` cascade DEVE excluir `#rb-editor-root`, `#rb-editor-inspector`, `#rb-ed-banner` — sem isso, mudar cor de texto afeta a UI do editor
- Popups devem chamar `clampPopupToViewport(popup)` após `appendChild` — garante 8px gap do bottom do viewport
- Custom swatches persistidos em `localStorage` key `rb-custom-swatches` (array de hex)
