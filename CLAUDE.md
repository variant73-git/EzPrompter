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
`2.6.0` (extension), web-shell unversioned

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
122. ✅ **Bot-challenge detection + Phase 1 UX feedback** — `lib/snapshot.js` ganha `detectChallengePage(page)` + `ChallengeRequiredError`. Detecta Cloudflare ("Just a moment…", `#challenge-form`, `iframe[src*=challenges.cloudflare.com]`), hCaptcha standalone, reCAPTCHA "unusual traffic", Akamai bot manager, PerimeterX. Throws ANTES de qualquer extração de HTML — fim do node poluído com challenge HTML + crash `null.getComputedStyle` (que era da própria script da Cloudflare crashando dentro do nosso srcDoc, mascarado pelo dev-overlay do Next). Route mapeia pra 409 (não-streaming) ou SSE `event: challenge` (streaming) com `{kind, url, signals}`. `<ChallengeModal />` (viewport-fixed, frosted family) explica o fluxo em 3 passos. Placeholder no canvas vira amber `cnode-loading-challenge` com shield icon (em vez do spinner blue). **Bônus**: re-habilitado `stripScripts()` no static path (decisão de "keep scripts" do 042 ficou obsoleta porque Webflow/Framer/Lenis hoje vão pra `reconstructPage` longe daqui — quem chega no static é HTML server-rendered onde scripts só atrapalham; matava o bug do header stacked 3x no curriculum.com.br/AspClientAdapter/header.js). DNS pre-check ganha retry-1x em ENOTFOUND/EAI_AGAIN + mensagem mais branda ("Could not resolve this domain. Double-check the URL or try again in a moment.") em vez de acusar typo. `PromptDock`: input de texto livre que parece URL (looksLikeUrl) auto-roteia pra `onAddUrl` — sem precisar clicar no chip de website.
123. ✅ **Phase 2: extension handoff bridge + manual capture** — Quando challenge dispara, route pre-cria placeholder no DB (`meta:{awaiting_handoff:true}`) + minta HMAC token 5min (`lib/handoff-token.js`) bound a `{userId, nodeId, url}`. Devolve `{nodeId, node, handoffToken}` no payload da challenge. ChallengeModal dispara `postMessage` que a extensão captura pra armazenar em `chrome.storage.local` antes de abrir o tab. Na aba real, content script `handoff/handoff.js` checa storage match (canonicalização: strip `www.`, trailing slash, query, hash + fallback origin-only pra cobrir redirect `curriculum.com.br → www.curriculum.com.br/pro/`), monta banner frosted "Send to Uncraft" no canto superior direito. Click → `handoff/capture.js` (`window.__uncraftCapturePage()`) serializa DOM, inline stylesheets via credentialed fetch (CSS protegida por Cloudflare finalmente carrega!), absolutize URLs, strip scripts, pin vh/vw → background `captureVisibleTab` → POST `/api/snapshot/handoff` com `X-Uncraft-Handoff-Token`. CanvasClient polla `GET /api/nodes/<id>` a cada 3s (10min cap) e troca placeholder pelo node real. **Manual capture**: popup toolbar (`popup/`) faz discovery auto da web-shell origin (prod → localhost, cached), lista boards via `/api/boards`, "Send to Uncraft" → `/api/snapshot/manual` (cookie-authed) cria node novo. Detecta pending handoffs e oferece "Complete pending capture" como primary action (fix pro caso de banner falhar no redirect e usuário cair no popup). Manifest ganhou content_scripts: `<all_urls>` (handoff/capture+handoff isolated) + web-shell origins MAIN-world (present-flag pra `window.__uncraftExtensionPresent`). Commits: 7ee9e44, c201eb6. Detalhes: memory `checkpoint_2026-05-27_043.md`.
124. ✅ **Cursor-tracks-port** — bolinha do emitter (right port) desliza pela aresta direita do node seguindo o Y do cursor enquanto o mouse paira sobre o node. Corta o "reach" pra agarrar um cord em nodes altos. Direct DOM writes via ref (mousemove 60+Hz, sem React re-render). Scale-aware via `--canvas-scale`. Hands-off quando cursor entra na hit area do port (CSS hover scale 1.15 + cor de origem assume normalmente; click target estável). Clamped a 14px das bordas. Freeze em edit mode (port disabled) e durante draft cord ativo (mover origin mid-drag faria a linha chicotear). Commit: ce4e28b.
125. ✅ **Widget reorg + Collect Assets v1** (sessão 2026-05-29): A. Widget restaurado como toolbar default (remove `default_popup`). B. Handoff callout dentro de viewMain (banner in-tab deletado). C. Send-to-canvas view com board picker + create-new. D. Port total Instrument Sans/Serif + `.popup-*` family pros canvas popups (ChallengeModal, ResetConfirm/CancelEdit, EmptyDropMenu, CanvasContextMenu, Toast helper substituiu 17 alert calls). **Collect Assets v1** end-to-end no widget: hover overlay neutro grey + type pill + tag "Click to collect/deselect", **Cmd-held marquee** (DOM bbox intersection, não bitmap, leaf-ish picks), **right-click stack popup** Photoshop-style (com "Background" + "Whole section" synthetic options), **Cmd+G grouping** (clone do common ancestor stripped de filhos não-selecionados → preserva spacing CSS do parent), **font capture** (text → @font-face match → WOFF download credenciado → inline base64 ≤1MB, dedup por family, oversized fica pendente p/ v2 blob hosting), **persistent blue outline** (#0095FF) nos items coletados na página + **mirror bidirecional** de hover (page ↔ widget row, mesmo neutral grey wash, scrollIntoView), **click-to-toggle** (re-click deseleciona), **destination dropdown** com Global library + projetos + New project (signup redirect quando deslogado), **unsaved-items modal** (Live Remix + close X + beforeunload triggers), **cursor NUNCA muda**. Save POSTa pra `/api/assets` (batch) + `/api/asset-groups` (single) com CORS chrome-extension + cookie auth. Schema novo: `assets` + `asset_groups` tables com `project_id NULL = library`, `group_id` FK, indexes incluindo `(user_id, source_url, type)` pra dedup. Memo da sessão: [[checkpoint_2026-05-28_043]]. Commits: 8ab58c8, 1d98205, 1208006, 31bf934, acf2581, 2eb295c. Canvas-side **Assets tab no layers panel** (drag-from-library pra criar node) é a próxima sessão dedicada.
126. ✅ **Editor polish session — 10 papercut fixes** (sessão 2026-05-30, branch `feat/canvas`): **Ambos shells via editor-core**: (1) `.rb-spacing-fb-tab` pink "Add feedback" pill removida dos spacing guides (loop em `editor.js` + CSS wrapper). Selection-anchored `.rb-sel-fb-tab` (não-pink) permanece. (2) `__coordswap` undo agora restaura inline `position` (não só `top/left`) — bug do gistr.so com `header.relative` + `img.h-full`: `isAbsoluteLayout` true → `commitDrop` forçava `position:absolute`, undo deixava preso → "desalinhada". Fix captura `elPos`/`tPos` no `pushUndo`. (3) `updateDragGhost` centraliza em ambos eixos (`y - h/2` em vez de `y - 20` fixo). (4) Drag ghost honra canvas scale + iframe offset via novo `rectToHost(r)` (matemática paralela ao `eventToHostXY(ev)`) usado em `createDragGhost` + `handleMove` passa `eventToHostXY(e)` pro update. Extension mode é pass-through. (5) Link popup cleanup hook — `_openLinkPopup` ref + `removeLinkEditor()` helper chamado em `removeTextDock()` + `removeImgMenu()`, mais mirror outside listener no `targetDoc` em canvas mode (cross-doc mousedown não bubble). **Canvas-only**: (6) Text minidock auto-dismiss em pan/scroll cumulative > 100px — wheel listener em hostDoc + targetDoc (gated por `hostDoc !== targetDoc`), cleanup via AbortController. (7) Cursor specificity 3× bump no inline style injetado no targetDoc (`body.rb-ed-active.rb-ed-active.rb-ed-active`) — fix farmminerals.com/promo onde Webflow `.section .paragraph p { cursor:text }` ganhava por class count. Specificity novo: arrow (0,3,4), text-hint (0,4,1) — beats site CSS normal. (8) Text minidock skipped pra wrapper containers — removido branch `isTextWrapper(el)` do click handler. Direct text (`isDirectText`) ainda mostra. Sumiu o "Mixed" font readout incômodo. **Web-shell-only**: (9) Project name → "Untitled" on empty input em `persistBoardName` (CanvasClient.jsx) E blur handler de `rb-ed-project-name` (editor.js, sincroniza pra extension via build). Web-shell ressincroniza state local pra renderizar fallback imediato. (10) `.cancel-edit-card` 220→340px scaled, padding 18/22→24/26, `.popup-title` em `var(--popup-font-serif)` 26px scaled wt 400 lh 1.15 (era 14px sans cramped), inner `.popup-serif` herda parent (matei 19px hardcoded que quebrava scale), `white-space: nowrap` nos botões, X close 14/14 24×24. Extension-shell usa `beforeunload` nativo, sem toast pra restylear. Sync routine: editar em `packages/editor-core/src/`, rodar `bash scripts/build-editor.sh`. Memo: [[checkpoint_2026-05-30_045]].
127. ✅ **Canvas overlay boxes refresh on wheel-zoom/pan** (sessão 2026-05-30 follow-up). Hover/seleção/spacing-guides são posicionados via `getOverlayBox(el)` que lê `getBoundingClientRect()` + iframe rect — corretos NO INSTANTE da chamada, mas só eram chamados em mousemove. Wheel-zoom sem mover o mouse deixava o box congelado no tamanho pré-zoom. Fix em `listen()`: canvas-only wheel listener em hostDoc + targetDoc (`passive: true, capture: true` pra não brigar com pan/zoom da `CanvasClient`), rAF-coalesce → redraw de `updateHoverBox(lastHoverEl)` + `updateSelBox(selectedEl)` + `updateSpacingGuides(selectedEl)`. Cobre wheel-zoom + wheel-pan + pinch (ctrlKey-wheel). Não cobre zoom programático via dropdown da inspector (`__uncraftZoom.setScale()` sem wheel) — se virar dor, piggyback no poll de 250ms que já roda pro % indicator. Cleanup via `signal: sig`.
128. ✅ **Agent PromptDock chat — Phase 1 + Phase 5a** (sessão 2026-05-31, branch `feat/canvas`, 26 commits `4b235ce`→`2a1788d`). User digita no input do bottom-dock e o agente Claude/GPT/Gemini orquestra o canvas via tool-use. **Stack**: `POST /api/chat` SSE streaming → `lib/agent/driver.js` agent loop genérico → 3 adapters (`llm-anthropic.js`, `llm-openai.js`, `llm-gemini.js`) → 6 safe tools em `lib/agent/tools/` (createNode com `type` semântico [blank-website/prompt/design-system/asset/skill], addEdge, updateNode, queryNodes, getNodeOutput, listAssets). **Persistence**: 3 tabelas (chat_threads, chat_messages, agent_runs) por board, conversa persiste. **Model decoupling**: `AGENT_MODEL` env (default `gemini-2.5-flash` por economia de escala — $1.8M/yr vs $84M/yr Sonnet @ 1M users) NÃO é o picker do PromptDock (picker é pra runFlow/imageGen futuro). Tier ladder documentado em route.js header: free=Flash, pro=DeepSeek (wiring 15min deferred), enterprise=Sonnet. **UI**: ChatPanel com auto-scroll, auto-collapse após RUN_FINISHED, chevron manual collapse top-right, frosted backdrop sem border (era confundido com "field outline"), tool-chip-done neutral grey (era verde, lido como "feedback pill"). **CanvasClient.onAgentMutatedGraph** faz refetch único no fim do run + auto-frame (single = zoomToNode, multi = bbox). **Critical fixes durante real use**: refetch-per-tool quebrava canvas via setNodes storm (TransformWrapper perdia state); chat-panel 60vh+border ocupava 60% da tela dentro do `.prompt-dock` que está em `NATIVE_WHEEL_SELECTOR` (matava wheel global); driver hardcodava toAnthropicSpec deixando OpenAI/Gemini com 400 "Missing parameter 'tools[0].type'"; agent criava nodes laranja "html-origin" quando user pedia blank teal (fix: tool expõe `type` enum semântico mapeando pra kind+meta+seedHtml internamente). **Blank-website parity**: `lib/blank-site-html.js` extraído e usado por `handleAddBlankSite` (botão "+") + agent's createNode — ambos seedam BLANK_SITE_HTML + width 1280×720. **Test infra**: Vitest 4.1.7 + React Testing Library + jsdom instalados (bun, não npm — bun.lock é source-of-truth). 62/62 testes passando, 20 arquivos. **Próximas fases (não implementadas)**: Phase 2 destructive tools + confirm chip + SSE pause/resume + caps (soft 10/hard 50/3 retries/5min); Phase 3 createImage Imagen/gpt-image-1 + needs_choice; Phase 4 Smart Edit dock wire-up (asset-scoped threads); Phase 5b/c history reconstruction + cost tracking + credits. Handoff completo: `docs/superpowers/handoffs/2026-05-31-agent-promptdock-handoff.md`. Spec: `docs/superpowers/specs/2026-05-31-agent-promptdock-design.md`. Phase 1 plan: `docs/superpowers/plans/2026-05-31-agent-promptdock-phase1.md`. Memo: [[checkpoint_2026-05-31_046]].
129. ✅ **Agent PromptDock chat — Phase 2** (sessão 2026-05-31 continuação, branch `feat/canvas`, 17 commits `8891f33`→`d34f7f9`, 113/113 tests). Destructive tools + pause/resume + caps + persistence. **Foundation**: `lib/agent/run-map.js` singleton Map<runId, {confirms, choices, continues, cancelled}> com `awaitConfirm`/`resolveConfirm`/`cancelRun`/`isCancelled`; `unregisterRun` flush-then-delete pra não orfanar Promises. `lib/agent/caps.js` env-driven (`UNCRAFT_AGENT_SOFT_ITER=10`, `HARD_ITER=50`, `RETRY_BUDGET=3`, `WALL_TIMEOUT_MS=300000`). **Driver** (`lib/agent/driver.js`) hard-limit / soft-pause / wall-clock timeout / per-tool retry budget / cancellation propagation. Destructive classification → emit `needs_confirm` + await Promise → executor or skip. Phase 1 callers sem `runId` viram auto-confirm + `console.warn` (legacy compat). **3 control routes** `POST /api/chat/{confirm,continue,cancel}` — confirma/skip/choice resolve Promises do runMap; cancel marca + flush. **3 destructive tools** `deleteNode`, `runFlow`, `editSite` — todos com ownership-check via `boards.user_id` join, structured errors `{error: 'forbidden'|'invalid_args'|'no_sources'|'no_snapshot'|'node_open_in_edit'|...}`. `runFlow` reusa `runCompose` do Phase 1; `editSite` passa `systemPromptOverride: EDIT_SITE_SYSTEM` (novo param suportado em `lib/run-flow.js`). Follow-up #3 resolvido: `/api/edges` allow-list ganhou `'generic'` (estava em `VALID_KINDS = {transplant, token-swap, reskin}`). **agent_runs populado**: `startAgentRun({threadId})` insert running+0+{}, `finishAgentRun({runId, status, iterations, toolCallCounts, err})` finaliza com completed_at NOW(). `mapLoopResultToRunStatus` mapeia `end_turn→completed`, `hard_limited→hard_limited`, `wall_timeout→failed`, `cancelled|cancelled_softpause→cancelled`. **POST /api/chat** ganhou: `startAgentRun`→`registerRun`→emit `run_id`→pass `runId`+`caps` to `runAgentLoop`→`finishAgentRun`→`appendMessage` com `agentRunId` (não-null finalmente)→`finally { unregisterRun; close }`. Asset-scoped chats continuam com `buildSafeRegistry` (sem destructive); board-scope vira `buildFullRegistry`. **UI**: ToolChip 3 estados novos (`awaiting_confirm` amber + Confirm/Skip, `awaiting_choice` amber + buttons da choice + Skip, `skipped` cinza italic). Novo `SoftPauseChip` amber-toned, mostra "Did N actions so far. Continue?" + breakdown sorted desc + Continue/Stop. ChatPanel aceita `softPause`/`onSoftContinue`/`onSoftStop`/`onConfirmTool`/`onSkipTool`/`onChooseTool`. PromptDock 6 reducer actions novas (RUN_ID_RECEIVED, TOOL_NEEDS_CONFIRM, TOOL_NEEDS_CHOICE, TOOL_RESUMED, RUN_SOFT_PAUSED, RUN_CONTINUED), 4 SSE event maps (run_id, needs_confirm, needs_choice, needs_softlimit_continue), 3 control-call helpers (postConfirm/postContinue/postCancel) com credentials:'include'. **createImage diferido pra Phase 3** (precisa de provider routing + image-gen route — cabe melhor separado). Follow-up #1 (debug log) limpo no commit 8891f33. **Smoke tests pendentes** — user roda no browser (delete confirm/skip, soft-pause cap=2, hard-kill cap=3, cancel mid-run, DB verificação). Memo: [[checkpoint_2026-05-31_047]]. Handoff: `docs/superpowers/handoffs/2026-05-31-agent-phase3-handoff.md`.
143. ✅ **Anti-slop DETERMINISTIC turn + canvas/chat UX marathon** (sessão 2026-06-25→26, branch `feat/canvas`, ~18 commits `10a2f97`→`86e9764`, 390/390, web-shell only). Continuação do 142. **Lição-mestra anti-slop**: pra cada vício, **verificar no site real e tornar DETERMINÍSTICO** (passar o valor real do DOM como ground truth) em vez de confiar no prompt. **ESCOPO (o user sinalizou)**: determinístico SÓ vale quando a fonte tem DOM = caminho de **captura**. A feature desta versão = **estilo de uma IMAGEM aplicado a um site** = pixels, sem DOM = **visão/inferência, enviesada por prompt, NÃO determinística**. font-style/elevation ground truth = só captura. Residual conhecido: o modelo às vezes **deduz um outline** que a imagem não tem (mitigado com bias forte anti-borda em style-extract + guardrails, não resolvido). **(A) Anti-slop/restyle**: +2 regras source-conditional (outline de container + itálico default; `10a2f97`/`42f6caa`); sombra source-conditional + proporções/padding como alvo de extração (`ba92386`); **font-style ground truth** (`fe17b89` — o itálico teimoso era **alucinação** de visão; site real é 100% reto `font-style:normal×111,italic×0`; a sonda de tipografia agora captura `font-style` e manda como verdade absoluta); **elevation ground truth** (`dd9ce63` — `ELEVATION DETECTED` reporta se containers têm sombra/borda; "0/N usam sombra→não adicione"); **STYLE ABSORPTION** (`5869c46` — `HOUSE_STYLE_ABSORB`: output absorve TODA característica da fonte de estilo, IA preenche nada; em run-flow+demarcelize); **mostrar a imagem ao compose** (`015ce57` — o lever real: imagem→site convertia a imagem num brief de texto lossy e **descartava a imagem**; agora MANTÉM a imagem (visão) + o brief, então compose LÊ os tokens E VÊ o estilo). **Insight arquitetural (não esquecer)**: golden-match vai pelo **caminho estático** (`/api/snapshot/capture`→`snapshot.js`, ~6s, cópia fiel do DOM), NÃO pelo `reconstruct.js` (visão). **Captura = fotocópia fiel** (verificado limpo no DB: 0 itálico; as 38 box-shadows são REAIS). As queixas de "slop" eram do **restyle** (imagem→site), não da captura. Diagnóstico que destravou: query direta no snapshot do DB + curl no CSS do site real. **(B) Canvas/chat UX**: pills do dock lateral viram círculos só-ícone 34px (Add URL + cérebro; label gateado em `isLateral`, sem flash; hover==selected; **model picker exempt** via `:not(.prompt-dock-model-btn)`) (`6340b7b`/`b78af5e`/`e83942c`); botão run-flow com play à ESQUERDA do texto (`268ed0c`); section fica `selected` quando o run flutua no canto (`bb24bd7`); **SE-handle** ancorado com `max(12px, calc(7px/scale))` — termo world acompanha o canto arredondado no zoom-in, piso screen mantém margem interna no zoom-out (`a1b16be` errado→`bb24bd7`); **run-in-progress** desabilita o botão da section (pill+flutuante, dimmed) + nodes-alvo no filling ring, nos DOIS caminhos — botão (`runStatus`) e agente (PromptDock mapeia tool-call `runFlow`/`editSite`→nodeId → `onAgentNodeRunStart/End` → mesmo `runStatus`) (`d9d42eb`); **ponta do filling ring** = gradiente branco CONTIDO no stroke (cabeça curta sobreposta, mesma largura 4px/round, sem glow, stroke = gradiente userSpaceOnUse orientado pela tangente, fade→branco 0.4; id único por instância) (`4fbf934`→`cbbdb8d`); **texto de loading do chat** = gradiente ANIMADO nas cores da cadeia (cor única→sólido; o bug era `activeContexts` de section sem cores por node → `workingColors` vazio → agora section carrega `memberColors`; animação alinhada ao ciclo de 1500ms) (`4fbf934`→`86e9764`); **URL ghost-place** (adicionar URL pelo "+" agora dropa ghost que segue o cursor, captura adiada pro drop) + cursor do botão run (`c60bb7c`); **gen-overlay sliver** no zoom-out (floor 0.30 vs topbar `--tbh` 0.50) (`a1b16be`). **PENDENTE/notas**: eval real (opcional, já há prova visual 3-vias); variante "core" só-guardrails p/ modelos baratos; bundle do navegador fica velho em aba aberta há muito → mudanças de cliente pedem hard-refresh, prompts server-side recarregam sozinhos. Memo: [[checkpoint_2026-06-26_session]].
144. ✅ **Upload de imagem ≠ comando de build + section never-overlap + Regra 4 com oferta** (sessão 2026-06-26 continuação, branch `feat/canvas`, 395/395 tests, web-shell only). Validei o fix do agente da sessão paralela (commits `3ab0ad2`+`d5a8b28`: **Regra 4b** "imagem sem instrução NÃO é build" + remoção dos exemplos de fintech que enviesavam toda geração + **bare-image→ghost placement** via `onQueueFiles` em vez de ir pro chat + `stripCardBorders` revertido pra source-conditional só-prompt) — bate com meu diagnóstico: 4 bugs (node sem ghost, fluxo fintech fabricado, section overlap, "roda sozinho") com **raiz comum** = o anexo de chat ia pro `BOARD_AGENT` over-eager ("recusar é último recurso" + imagem de banking + exemplo fintech repetido → ele montava brief+site e chamava `runFlow` sozinho). Depois, 4 refinamentos pedidos: **(1) ack no chat** — bare image dropa ghost E emite uma linha canned (nova action `ASSISTANT_NOTE` no reducer do PromptDock, id `note-*` p/ não virar bubble transiente, **sem chamar LLM**): "Added \"X\". If you'd like me to do something with it … just tell me" + abre o painel. **(2) Regra 4 reescrita** (`lib/agent/prompts.js`) — distinção do user "**zero prompt ≠ prompt pobre**": sem texto = não é pedido, só asset p/ posicionar (Rule 4b, não raciocina); texto magro = pedido pobre = perguntar. Exemplo presumido ("trust signals + CTA") → **perguntas abertas sem resposta pré-suposta** + SEMPRE oferecer a escolha ("…ou sigo com uma proposta — quer?"); se aceitarem/"você decide", construir COMPLETO e **impressionante**, nunca genérico. **(3+4) #3 section overlap RESOLVIDO** — raiz: a section só nasce no `addEdge` (o cordão), e o FRAME (pad 165 lados/260 topo p/ a faixa de título) é maior que os nodes, então invade a vizinha mesmo sem node encostar; é o único instante checável. Fix: `planSectionDeoverlap` (puro, testável) + `deoverlapSectionForEdge` (DB) em `canvas-layout.js`, chamado no `addEdge` tool; empurra a section inteira pra baixo como UNIDADE até limpar **outras sections E nodes soltos** (user: "section nova num espaço só dela, sem encostar/overlap em nada"). Refatorei `componentMembers`/`frameRect` compartilhados. 5 testes novos (`delta=349` section-section, `delta=84` loose-node + null cases). **Pendente**: cordão MANUAL (`/api/edges`) não tem de-overlap (risco de desync do cliente até refetch; raro pq user arrasta vendo onde está). Memo: [[checkpoint_2026-06-26_image-build-section-overlap]].
130. ✅ **Agent PromptDock chat — Phase 3** (sessão 2026-05-31 continuação, branch `feat/canvas`, 6 commits `88fda72`→`5947b82`, 144/144 tests). createImage tool — 10th tool, classified `needs_choice`. **Pipeline**: PromptDock → POST /api/chat → agent emits `needs_choice` com `choices` array → ToolChip awaiting_choice (auto-confirma se length≤1) → user clica → POST /api/chat/confirm com choice → driver resume → tool chama POST /api/images/generate com effective provider → adapter gera → asset row inserido + (opcional) asset node no canvas. **Provider adapters**: `lib/image-gen/gemini-imagen.js` (Imagen 3.0 fast via @google/genai, retorna base64+mimeType+dataUrl) + `lib/image-gen/openai-image.js` (gpt-image-1 via openai SDK, aspect ratio → size string via SIZE_MAP pros 1024/1280/1792 do OpenAI). Mesma shape pra route + tool ficarem provider-agnostic. **Route** `POST /api/images/generate` thin dispatch — auth → validate prompt/provider → roteia. auto → gemini default. claude → 400. **Tool** `createImage`: `choices(args, ctx)` retorna `AUTO_CHOICES_CLAUDE` (2 opções) só quando conversationModel match `^(claude|opus|sonnet|haiku)/i` AND provider='auto'; senão `AUTO_SINGLE` (1 opção). PromptDock `handleSseEvent` auto-confirma single-choice sem renderizar chip (length≤1 short-circuit antes do dispatch TOOL_NEEDS_CHOICE) — user nunca vê menu de 1 botão inútil. `ctx.conversationModel` threaded de route pra agent ctx no commit 094d7a4. `ctx.choice` de resolveChoice precede args.provider. Image bytes armazenados como base64 data URL em `assets.meta.dataUrl` (sem CDN pra MVP). `attachToBoard:true` insert `nodes` row com `kind='asset'`, `meta.assetId/dataUrl/name`, 512×512. **Diferido Phase 3b**: image-to-image refinement (pegar imagem existente como input pra próxima geração). Memo: [[checkpoint_2026-05-31_048]]. Plan: `docs/superpowers/plans/2026-06-01-agent-promptdock-phase3.md`.
131. ✅ **Agent PromptDock chat — Phase 4** (sessão 2026-05-31 continuação, branch `feat/canvas`, 4 commits `aa583b4`→`d220cb4`, 146/146 tests). Smart Edit dock no canvas wired pra agent backend. **`buildAssetRegistry()`** em tools/index.js: 6 safe + createImage (NÃO inclui delete/runFlow/editSite — image-focused chat não deve mexer no grafo). Route usa `buildAssetRegistry` quando `threadScope === 'asset'` (substitui buildSafeRegistry). **editor.js**: `isCanvasMode()` helper checa `typeof chrome === 'undefined' || !chrome.runtime`, `triggerAnalyze` em canvas pula análise (sem extension's describeImage handler) e vai direto pra `phase='ready'` com chat textarea, `submit()` separa `submitExtension` (chrome.runtime path — unchanged) de `submitCanvas` (POST /api/chat com asset scope, SSE consumer inline). **SSE handler**: `run_id` armazena runId em `assetEditRunIdRef` module-scope (mesmo padrão da Phase 3 PromptDock latestRunIdRef pra evitar stale closure), `needs_choice` auto-confirma single-choice OU pega primeira choice como Phase 4b fallback pra Claude+auto (proper inline picker fica pra Phase 4b), `tool_status done` extrai `result.dataUrl` → render img inline com botão "Generate another", `run_status completed` sem createImage done = "agent didn't generate" soft error. **Constraint Phase 4 MVP**: só funciona em asset nodes com `meta.assetId` populado (gerados pelo Phase 3 createImage com attachToBoard ou já existentes em assets table). Orphan asset nodes (uploads/createNode type='asset') mostram "Smart Edit needs an asset record" — Phase 4b backfill auto. Memo: [[checkpoint_2026-05-31_049]]. Plan: `docs/superpowers/plans/2026-06-01-agent-promptdock-phase4.md`.

### Mode E: status estratégico (2026-05-28)
**Decisão atual:** Mode E preservado intencionalmente como **backup + história**. Não consolidar variantes nem deletar arquivos até o usuário avaliar manualmente qual variante entrega melhor resultado em campo. Discussão arquitetural (sessão 2026-05-28) concluiu:

- **Iter 9 supera Mode E na missão original** (clonagem de sites animados): mais barato (~$0.10–0.25/clone estimado vs ~$0.53/clone medido em Mode E), pixel-perfect via auto-rasterização, single vision call em vez de N viewport-calls
- **Cloudflare / captcha / login NÃO requerem Mode E** — a handoff flow (Phase 2 do canvas, commits 7ee9e44/c201eb6) já resolve via DOM capture no contexto autenticado do browser do usuário, sem rebuild
- **Live edit in-page direto no DOM** já cobre 80%+ dos casos graças ao framework override + sticky-MutationObserver writes do checkpoint 031. Mode E como pré-requisito de edit deixou de fazer sentido
- **Futuro provável**: portar Iter 9 client-side (rodar a pipeline no contexto do user via extensão) substitui Mode E em todos os cenários. Aposentação será orgânica conforme client-port amadureça
- **Variantes em revisão**: mode-e-classic (E0), mode-e2 (E2), mode-b (DOM Mirror), EL Lean — candidatas a aposentação após avaliação. Core mode-e.js + refinement loop (mode-e-diff + mode-e-refine) ficam até o teste manual concluir

NÃO deletar nada de Mode E sem confirmação explícita do usuário com base em teste.

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
> **Fonte canônica: [`DESIGN.md`](DESIGN.md) na raiz.** Ler ANTES de qualquer decisão visual/UI (cores, fonts, spacing, raios, blur, motion). Tokens reais vivem em `packages/web-shell/app/globals.css` (`@theme` + `:root` + `body.rb-ed-light`). Usar os tokens (`var(--accent)`, `var(--surface)`, `var(--blur-chrome)`, etc.), não literais. Não desviar do sistema sem aprovação explícita do user; em QA, sinalizar código que não bate com o DESIGN.md.
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

## Setup de memória (sessão 2026-05-28)
Sistemas nativo e mem0 rodam em paralelo. O hook `block_memory_write.sh` do plugin mem0 (PreToolUse Write|Edit) foi neutralizado em `~/.claude/plugins/cache/mem0-plugins/mem0/0.2.4/scripts/` — substituído por `exit 0`, original preservado em `.bak`. **Quando o plugin mem0 atualizar de versão, o cache vai ser recriado e o bloqueio volta**. Pra re-aplicar a neutralização: `cp block_memory_write.sh.bak block_memory_write.sh` no path novo (ajustar versão). Native auto-memory escreve MEMORY.md + arquivos `.md` em `~/.claude/projects/.../memory/`; mem0 mantém busca semântica + skills + API HTTP fallback (key em `~/.mem0/config.json`).

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

## Phase 4c: Canvas Smart Edit Entry Point (2026-06-01)
132. ✅ **Agent PromptDock chat — Phase 4c** (sessão 2026-06-01, branch `feat/canvas`, 2 commits `551694a`→`7f18112`, 149/149 tests). Canvas Smart Edit entry point — fecha o E2E que Phase 4 deixou inerte. **AssetSmartEditDock.jsx** (~200 linhas): React component próprio com useReducer state machine (idle/generating/done/error), SSE consumer inline (mesmo padrão que editor.js Phase 4 mas em React), auto-confirm needs_choice via fetch /api/chat/confirm com runIdRef, render inline da generated image + "Generate another" CTA. Estados: ERROR também aceita "Try again" pra reset. **CanvasNode.jsx**: Smart Edit button overlay (sparkle icon) aparece em hover OU selected nos asset nodes COM `meta.assetId` populado. Click toggle smartEditOpen state. Dock renderiza positioned-absolute à direita do node quando open (12px gap, zIndex 50, stopPropagation pra dragging dentro do dock não trigar node drag). **CSS** em globals.css: `.cnode-body-asset { position: relative }` + `.cnode-smart-edit-btn` frosted-glass com fade in via opacity transition 120ms, revelado em `.cnode-body-asset:hover` OU `.cnode.selected`. Dock 320px wide com mesmo design language do PromptDock (rgba(10,10,10,0.72) + backdrop-blur 28px + frosted hairline). **Skip editor-core**: asset nodes não têm iframe, então CanvasEditorCore mount não se aplica — React-native component é o canvas path. Editor.js Phase 4 canvas-mode code fica como fallback futuro pra unificação se quisermos. **Constraint Phase 4c MVP**: ainda exige `meta.assetId` (Phase 4b backfills orphans). needs_choice Claude+auto auto-picks first choice (Phase 4d adds inline picker). Botão só aparece em asset nodes com meta.assetId — uploads/orphans ficam sem affordance até Phase 4b. Memo: [[checkpoint_2026-06-01_050]]. Plan: `docs/superpowers/plans/2026-06-01-agent-promptdock-phase4c.md`.
133. ✅ **Agent PromptDock chat — Phase 5c** (sessão 2026-06-01, branch `feat/canvas`). Cost tracking + credits stub + tier routing. **`lib/agent/cost.js`**: MODEL_PRICES table (Claude Opus/Sonnet/Haiku, GPT-5.5, Gemini 3.1 Pro/2.5 Flash, DeepSeek), per-1M-tokens in/out rates; `computeCost({model, tokensIn, tokensOut})` returns integer cents; `getCostPerImage(provider)` for Imagen/gpt-image-1. Conservative: unknown model = 0 cents (never negative). **`lib/credits.js`**: MVP stub — `getUserCredits/deductCredits/hasEnoughCredits` return unlimited / no-op / true. Real Stripe + `users.credits_cents` column ship later, swap-in is 5 lines. **`finishAgentRun`**: agora aceita `tokensIn/tokensOut/costCents` (eram null antes). **POST /api/chat**: `getAgentModel(user)` ganha tier ladder — free=Gemini Flash, pro=DeepSeek, enterprise=Claude Sonnet (UNCRAFT_AGENT_MODEL env override sempre vence pra dev). Credits gate via `hasEnoughCredits` antes do run (sempre OK pra MVP). Loop end pega `loopResult.usage` → computeCost → persist. Spec §12 cost tracking ✅. Plan/handoff: Phase 5 handoff atualizado pra DONE. Memo: [[checkpoint_2026-06-01_051]].
135. ✅ **Style-transfer e2e + canvas polish marathon** (sessão 2026-06-02, branch `feat/canvas`, 130 commits ahead, 189/189 tests). Sessão começou em polish do canvas/chat (space-to-pan, marquee multi-select, undo de delete, shift-click toggle, espacejamento de workflow, tool chips escondidos, bubbles por iter, thinking dots entre iters, attachment auto-cria nó + dropa auto-prefill, edges aplicadas pelo agent via `inputAssetIds`, BOARD_AGENT prompt expandindo "BUILD THE WORKFLOW AS A VISIBLE GRAPH" e "NEVER ANNOUNCE INTENT WITHOUT ACTING") e descambou pra caça de 6 horas do bug "agent for de novo após addAssetFromUrl com 'agora vou criar'". **Causa raiz finalmente**: `POST /api/chat/confirm 404` por Next.js HMR re-evaluando `lib/agent/run-map.js` entre o `registerRun` em `/api/chat` e o `hasRun` em `/api/chat/confirm`. Sequência: agent loop registra runId → createImage (`classification: needs_choice`) emite needs_choice → awaitChoice(runId) pausa → client auto-confirma POST /api/chat/confirm → confirm route foi recompilado por HMR antes → run-map.js re-evaluou → `const runs = new Map()` rodou de novo → Map vazio → 404 → client não retenta → server espera eternamente → outer 6min route hard-cap fecha SSE com `agent run exceeded 360s`. **Fix root cause** (commit `d60b8fa`, 1 linha): `const runs = globalThis.__uncraft_runMap || (globalThis.__uncraft_runMap = new Map())`. HMR re-evaluations reusam mesma instância. Validado e2e: addAssetFromUrl 213ms → createImage exec 22s (gen 21s + DB 521ms) → end_turn → POST fecha em 33.6s. **Diagnostic logs em pé** (próxima sessão remove): `[agent] iter=N stop=...`, `[agent] EXEC tool=...`, `[agent] DONE tool=... duration=Xms`, `[createImage] starting gen / gen ok/FAILED / DB persistence ok/FAILED`. **Outros fixes durante a caça**: per-iter LLM timeout 4min via Promise.race, per-tool timeout 3min via Promise.race, Gemini Imagen 120s timeout, outer route 6min hard cap (Promise.race com runAgentLoop), bubble seal on tool_call (TOOL_CALL_STARTED renomeia tmp-asst- pra closed-asst- pra próxima iter abrir bubble fresca), thinking dots checa OPEN transient (não conteúdo per current turn). **NÃO shipped (deferido)**: placeholder skeleton durante createImage gen (1ª tentativa em `1a58f8e` introduziu hang, revertida em `a53e112` — pode ser que o hang fosse mascarado pelo confirm 404 issue; vale re-tentar com runMap fix em pé). **Image quality "mal feito"**: user mencionou que o resultado visual saiu OK mas quality não é ótima — separar prompt template engineering pra próxima. **Anthropic Sonnet bump**: tentado mid-session, Anthropic console balance vazio (claude.ai Pro/Max ≠ API billing), revertido. Handoff: `docs/superpowers/handoffs/2026-06-02-style-transfer-debug-handoff.md`. Memo: [[checkpoint_2026-06-02_session]].
134. ✅ **Agent PromptDock — multimodal chat + image-to-image + orchestration push** (sessão 2026-06-01 continuação, branch `feat/canvas`, commits `0c1e8f2`→`6fccdc0`, 184/184 tests). User reportou 3 bugs colados durante smoke A1: (a) `crie 3 nodes prompt` empilhou em (0,0) (b) imagem anexa silenciosamente dropada antes do agent ver (c) agent recusou "transferir o estilo dessa imagem referencia <Pinterest URL> pra essa imagem anexa". Pacote inteiro fechado nessa sessão: **PromptDock fixes** — `RUN_FINISHED` reducer agora migra `activeToolCalls` pro `tool_calls` do último assistant message (chips persistem visualmente em vez de evaporar); `setChatCollapsed(true)` removido do fim do turn (panel só fecha manualmente via chevron). **createNode auto-stagger** — quando agent não passa posX/posY (sempre, pois desconhece layout), executa `SELECT MAX(pos_x + width)` + 240px gap antes do INSERT. Mesma estratégia replicada no `createImage` quando attachToBoard. **`addAssetFromUrl` tool novo** (`lib/agent/tools/add-asset-from-url.js`, ~120 linhas) — fetch URL externa (Pinterest/Unsplash/qualquer .jpg/.png), valida MIME image/*, cap 10MB, base64-encode → INSERT em `assets` + (opcional) INSERT em `nodes` no canvas com dataUrl no meta. Registrado em `buildSafeRegistry` (7 ferramentas safe agora). **`createImage` image-to-image** — novo arg `baseImageAssetId` (UUID de asset existente). Quando presente: SELECT `meta->>'dataUrl'` da row, valida ownership, força provider=openai (Gemini Imagen não tem `images.edit`), passa pro adapter. **`generateOpenAIImage` extension** — novo arg `baseImageDataUrl`; quando presente parseia data URL → `Buffer.from(b64, 'base64')` → `toFile()` → `client.images.edit({image, prompt, size})` em vez de `.generate`. Result inclui `mode: 'edit'|'generate'` pra traceability. **Chat multimodal end-to-end** — PromptDock `submit()` reescrito: `value || imageFile` ambos disparam chat (antes imageFile era dropado); novo helper `fileToAttachment(file)` faz FileReader→dataUrl; `sendChatMessage(content, attachments)` inclui `attachments` no POST body. `/api/chat` aceita `attachments?: [{kind:'image', dataUrl, name, mimeType}]`, monta `initialMessages = [{role:'user', content: [{type:'text'}, {type:'image', dataUrl}, ...]}]` quando presente; persistência continua só com texto pra não inflar `chat_messages.content`. **3 adapters multimodal** — `llm-anthropic.js` ganha `normalizeContentForAnthropic` que vira `{type:'image', dataUrl}` em `{type:'image', source:{type:'base64', media_type, data}}` (nativo); `llm-openai.js` array path adiciona branch `imageBlocks` que vira `{type:'image_url', image_url:{url:dataUrl}}` (dataUrl funciona direto); `llm-gemini.js` adiciona handling pra `{type:'image', dataUrl}` → `{inlineData:{mimeType, data}}`. **BOARD_AGENT prompt** reescrito pra empurrar orquestração: nova seção "VISION — what you can see" (multimodal user input + addAssetFromUrl); nova seção "IMAGE-TO-IMAGE / STYLE TRANSFER — the canonical flow" com receita 5-step (ingest refs → describe style → identify base → createImage com baseImageAssetId + style description embebida no prompt → attachToBoard); slogan "Refusing is the last resort, not the first" + "If a request seems outside your direct tools, look for a SEQUENCE of tools that gets you there before declining." Cobertura de tests: +17 novos (adapter multimodal translations, addAssetFromUrl 7 cenários, createImage baseImage paths, openai-image edit mode). Editor-core não tocou (extension Smart Edit fica asset-scoped e safe). Próximo smoke: Bloco D+ adicionado em `docs/superpowers/smoke-tests/2026-06-01-agent-feature-full.md` (D5–D10 cobrem multimodal+style transfer).
136. ✅ **Section ▶ generalizado — terminal-kind routing + semântica canônica de execução** (sessões 2026-06-11, branch `feat/canvas`, commits `49f4615` + `c22fd52`, 247/247 tests). **Semântica definida pelo user**: seta do chat (PromptDock) = executor geral do assistente (executa a ORDEM — rodar flow, arquitetar workflow, criar nodes; NÃO é "botão de rodar flow"); ▶ da section = executa QUALQUER cadeia da section. **Confirm fix (`49f4615`)**: popup de re-run só quando existe RESULTADO a sobrescrever; primeira execução roda direto; checkbox "Don't ask again" persiste em localStorage `rb-rerun-confirm-skip`; `ConfirmModal` ganhou `checkboxLabel` opcional. **Generalização (`c22fd52`)**: `lib/section-run.js` (puro, testável) — `findSectionTerminal(section, nodes, edges)` acha o member que recebe edges de members sem fan-out pra outro member, de QUALQUER kind re-executável (`asset`, `site`; ignora `temp-`); terminais .md/prompt retornam `unsupportedKind` → toast honesto "not supported yet" em vez de "terminal not found". `runSectionRerun` roteia: asset→`POST /api/sections/rerun` (image regen, inalterado); site→`runOneTarget`/`POST /api/nodes/[id]/run` (motor de composição, mesmo da seta do dock, com status chip de 3 passos + patch current_html/snapshot/_resetTick) — funciona em site vazio (seed BLANK_SITE_HTML). `sectionRerunWouldOverwrite` estendido: terminal site só confirma quando current_html tem conteúdo real (BLANK_SITE_HTML/vazio = primeira execução). 11 testes novos em `lib/section-run.test.js`. **Pendente**: smoke no board real (prompt→site, ▶ compõe; 2º ▶ mostra confirm) — consome créditos. Memo: [[project_canvas_run_semantics]].
137. ✅ **Node progress ring + 6 canvas fixes + chat model-picker + Extract-to feature** (sessão 2026-06-17→19, branch `feat/canvas`, ~50 commits unpushed, 298/298 tests). Sessão grande, três blocos. **(A) Node progress ring**: substituiu o spin Uiverse multicolor + chip de texto "1/3" por UMA afordância — arco SVG da cor da categoria preenchendo a borda arredondada do node no sentido horário a partir das 12h + `NN%` grande cinza no centro. Curva estimativa-only (`lib/generation-progress.js` `progressAt`, assíntota 95, nunca 100; trocado pelo conteúdo no `done` real). `components/NodeProgressRing.jsx` (+ hook `useGenerationProgress` por tempo, determinístico via fake timers). CSS `.cnode-progress*`; spin/face/run-status + filtros `uncraft-unopaq` removidos. Contraste calibrado na tela (headless render): número `#6b7280`, trilho `#3f444d` (o shipado `#2a2d33` era invisível sobre o corpo `#14142a` em loading). Plan: `docs/superpowers/plans/2026-06-17-node-progress-ring.md`. **(B) 6 bugfixes**: **D** loop infinito `Maximum update depth exceeded` — `onTransformed` chamava `setCanvasScale` a cada disparo (e `setTransform` anim=0 dispara inline) re-entrando o transform; fix = guard por epsilon (`lastAppliedScaleRef`) em CanvasClient. Esse loop corrompia `--canvas-scale` e congelava o render num frame velho (por isso o ring "antigo" persistia). **F** chip de delete `deleteNode — Delete node caff53ca` (cheirava código, quebrava em 2 linhas) → frase humana sem prefixo, sem wrap: `Delete node "<nome>"?` (categoria quando vazio); `ToolChip` esconde o nome da tool em confirm/choice; `deleteNode` ganhou `async summarize(args,ctx)`. **B** sobreposição de nodes — `lib/canvas-layout.js` `clearGapFor(nodeCount)` (100px base, encolhe a 40px em board cheio) + `resolvePlacement` exportado; `createNode` roda colisão MESMO com coords explícitas (o buraco). **C** auto-focus — `onAgentMutatedGraph` enquadra o bbox acumulado de nodes novos assim que aparecem (loading incluso), não só no fim do run. **E** popup "Save before exiting?" escalava com zoom (estava dentro do transform com inverse-scale bugado) → `createPortal` pro `<body>` com px fixo, zoom-imune. **Hydration** (só Chrome) — Norton/LifeLock injeta `data-nlok-*` nos inputs de auth pré-hidratação → `suppressHydrationWarning` em name/email/password (`app/page.jsx`). **Chat model-picker** — `/api/chat` ignorava o `modelId` do dropdown (sempre `getAgentModel` tier ladder), então escolher GPT-5.5 não fazia nada e o default free-tier gemini (prepaid-depleted) caía no failover → claude-haiku → "low Anthropic credit". Fix: `resolveAgentModel(modelId, user)` (exportado + testado) — pick explícito conhecido vence o tier. `OPENAI_API_KEY` configurado, GPT-5.5 funciona. Failover ainda termina em claude-haiku se o pick falhar. Gemini key ainda 429. **caps** wall-timeout 5→10min (mudança documentada do user) + teste. **(C) Extract to ▸** — feature COMPLETA (audit D3 → `docs/superpowers/plans/2026-06-19-extract-to.md`, 11 commits `0ab102a`→`83e4b93`, subagent-driven). Soltar cord no canvas vazio a partir de um node fonte → submenu "Extract to ▸" CRIA um node derivado (vs compose que sobrescreve). `POST /api/nodes/[id]/extract {to}` → `lib/extract.js` `runExtract()` dispatcher DB-puro → persiste node+snapshot+edge `generic` (espelha extractDesign). 7 combos: site→{designmd, content, screenshot, style, prompt}, asset→{tokens, prompt}. Novo: `lib/extract-llm.js` (seam text+vision, shapes verificados vs llm-anthropic/llm-gemini), `lib/browser.js` (`launchBrowser` compartilhado com branch Browserbase CDP). UI: submenu em `EmptyDropMenu` por kind, `handleExtractTo` placeholder + refetch full-board (node derivado renderiza populado). **3 bugs reais pegos por review** que mocks/happy-path escondiam: (1) screenshot `chromium.launch()` cru → crash em prod sem branch Browserbase; (2) node derivado vazio (INSERT-RETURNING sem conteúdo do snapshot) → refetch; (3) **`extractContent` retorna OBJETO JSON, não markdown** → `site→content` gravava `"[object Object]"`; mock retornava string e escondeu — pego SÓ pela review holística final → `contentToMarkdown`. **Pendente**: smoke no browser (combos LLM/screenshot custam crédito; Gemini depleted → usar OpenAI). **PARKED** (spec escrito, NÃO implementado): agente conversational-orchestrator (`docs/superpowers/specs/2026-06-19-agent-conversational-orchestrator-design.md`) — modelo opera "hardwired" (scaffolding vazio, "md"→prompt node errado) em vez de agir como o modelo real cujo meio de output são nodes; gap-chave: `createNode` só guarda `name`, sem corpo, então prompt node fica vazio e `runFlow` (lê `meta.prompt`) não tem o que compor → "create a fintech site" não gera hoje. Aguarda review do user. Memo: [[checkpoint_2026-06-19_session]].
139. ✅ **Batch 5-fix: seleção=alvo + section-aware placement + clones via Opus + ring no clone + working feedback animado** (sessão 2026-06-19, branch `feat/canvas`, commits `c75f90c`→`06a4650`, 311/311). **(#1 seleção=alvo)** o hint de active-node em `/api/chat` `buildWorkflowHint` agora AFIRMA que o node selecionado (o chip do chat) é o alvo do request ("apply to it; do NOT ask which one") — modelos não-Opus perguntavam "qual site?" com um site já selecionado. **(#3 section-aware placement)** `lib/canvas-layout.js` calcula componentes conexos (≥2 nodes) como obstáculos de frame com padding (`SECTION_FRAME_PAD=80`) via novo `loadBoardObstacles` (query nodes+edges); novo node standalone limpa o FRAME inteiro da section, não só os members (antes escorregava no gap entre members). Adicionou uma query de edges → corrigiu sequências de mock dos testes create-node/add-asset (`50257b8`). **(#5 clones via Opus + aviso — user escolheu agent-Opus, NÃO pipeline-Opus)** `/api/chat` `isCloneRequest(message)` (exportado+testado) força `CLONE_AGENT_MODEL` (env `UNCRAFT_CLONE_MODEL`, default `claude-opus-4-7` — VERIFICAR o id de Opus da conta) sobre picker/tier; BOARD_AGENT OBRIGADO a narrar "capturando agora, usando Opus porque entrega o melhor clone, nunca silencioso". `reconstruct.js` continua gpt-5.5 internamente. **(#4 ring no clone)** `captureUrl` insere um node placeholder com `meta.status='generating'` (→ NodeProgressRing) + emite graph_mutated ANTES da captura de 2-3min, depois popula + limpa o status; placeholder removido em falha/challenge. Antes: só o chip "..." por minutos, depois o node aparecia direto. **(#2 working feedback animado)** novo `components/chat/WorkingIndicator.jsx` (+`colorStyle`, 6 testes) — "working on it" ciclando 10 línguas a cada 1.5s, cor da categoria do node envolvido (gradiente entre categorias, accent fallback); colapsado = overlay sobre o campo de input vazio (wrapper `.prompt-dock-field` + `.prompt-dock-working-overlay`), expandido = ao lado dos thinking dots no ChatPanel. Cores vêm dos chips de active-context (cada um carrega `.color` de CanvasClient:3229). **Pendente**: smoke no browser (#2 overlay/gradiente, #4/#5 clone com ring+Opus+mensagem, #1 select+"paleta diferente" → sem "qual?"). Memo: [[checkpoint_2026-06-19_session]].
138. ✅ **Agente conversational-orchestrator — IMPLEMENTADO** (sessão 2026-06-19 continuação, branch `feat/canvas`, 3 commits `9f76e6d`→`2ac5f71`, subagent-driven, 301/301 tests). Era o item PARKED do 137 — spec aprovado pelo user + plano + build. **Big-picture (o user pediu pra destacar, está pinada na memória [[principle_agent_macro_operating_model]])**: o agente do chat NÃO é limitado às funções hardwired — ele É a IA selecionada (Opus/Gemini/GPT/Kimi) operando normalmente como no site de cada uma, usando NODES como meio de entrega, com as capacidades Uncraft (node-chain, runFlow, extractDesign, createImage, captureUrl) hardwired ON TOP como power-ups, NÃO como jaula. Nodes são o output medium, não o objetivo; recusar/scaffolding-vazio é o failure mode. **(1) Fix técnico que destravou geração** (`9f76e6d`): `createNode` ganhou param opcional `content` — prompt node → grava `meta.prompt`; design-system node → seed de snapshot `design_md`; sem content = slot vazio. Esse era O gap: `run-flow` compõe lendo `meta.prompt` (prompt source) + `source_design_md` (md source), mas `createNode` só gravava `name` → prompt node nascia vazio → "create a fintech site" entregava scaffolding vazio. Agora compõe de verdade. **(2) `BOARD_AGENT` reescrito** (`0cbdb08`, `lib/agent/prompts.js`): abre com a big-picture + two-hats (raciocinador independente + orquestrador de node-chain, cooperando) + **vocabulário BINDING de tipos** (md/.md/design system/style guide → design-system node kind `designmd`, **NUNCA prompt node** — era o bug do 137) + **Rule 1** (construir o grafo que o pedido implica com tipos certos; pedido cru → prompt→site mini-chain) + **Rule 2** (gera onde especificou, slot vazio onde não) + receita "How you actually generate" (createNode com content → addEdge → runFlow) + **Rule 3** (new-vs-continue: continua se seleção+referencial, novo se nada+fresco, **SEMPRE pergunta no ambíguo** — "Add to the fintech site, or start a new one?") + **Rule 4** (conversa o mínimo em prompt fraco antes de construir, depois executa completo). EDIT_IMAGE_SYSTEM/EDIT_SITE_SYSTEM intactos. **(3) Smoke checklist** `docs/superpowers/smoke-tests/2026-06-19-agent-orchestrator-smoke.md` (6 casos A-F). Final review confirmou o loop fechado (createNode escreve `meta.prompt`/`design_md` = run-flow lê; 13 tools referenciadas no prompt todas em buildFullRegistry). **Pendente**: smoke no browser — caso B ("create a fintech site" → site GERADO, não node vazio) é o teste que prova o fix; custa crédito, Claude+Gemini funded agora. Plan: `docs/superpowers/plans/2026-06-19-agent-conversational-orchestrator.md`. Memo: [[checkpoint_2026-06-19_session]].
140. ✅ **Canvas UX polish marathon** (sessão 2026-06-24, branch `feat/canvas`, 380/380 tests, web-shell only — não toca editor-core). **Bugs**: (a) **edge-create 500** — colunas `*_node_id` são UUID e id `temp-` quebra o cast → `app/api/edges/route.js` valida UUID (409) + existência dos nodes (404) + INSERT em try/catch; client guarda src/target `temp-`. (b) **lag das conexões** — aresta só renderizava após o round-trip; agora **otimista**: cord instantâneo com id `temp-edge-<Date.now()>`, reconcilia no sucesso, rollback no erro. (c) **resize "proporcional" do prompt** — causa `.cnode-body-prompt { aspect-ratio:3/1; height:auto !important }` travava Y na width → `height: var(--cnode-h)` (X/Y independentes). **Botão run flutuante** (iterado 4+ rodadas): a pill in-section vive no container transformado (z-index baixo, reposicionada por frame) → ia atrás do toolbar e sem transição. Trocado por **botão no nível do canvas** dentro de `.canvas-toolbars-right` ANTES do ZoomControls (à esquerda do zoom, z-index 100), crossfade com a pill in-place (`.floated-away`) quando a run-pill é clipada por QUALQUER borda do viewport (`pill.getBoundingClientRect()`: `top<70 || right>vw || left<0` — topo E laterais), escolhe a section de maior área visível. **Hard rule**: visual idêntico à pill da section (`.canvas-section-name-tag` + `.canvas-section-play-btn` replicados em px fixo: pill branca + play circle preto 40px). `runSectionFlow(s)` extraído (compartilhado pill + float). **Pill de categoria**: bg = cor da categoria (`--cnode-port-fill`), tinta = `--cnode-port-ink` (preto/branco por luminância, add em cada `.origin-*`); **nunca cortada** — mede `pill.offsetWidth` vs teto do topbar num `useLayoutEffect`, quando não cabe inteira vira `.kind-pill-clipped` (out-of-flow, sem gap, ainda mensurável → reaparece). `scale={canvasScale}` passado ao CanvasNode. **Outros**: edge **scissors-cut** (hit path largo `22/scale` + hotspot `48/scale` no meio do bézier, cursor tesoura data-URI, sever no click); selected-stroke floor 0.30→0.50; topbar-height floor 0.50 (`--tbh`); node-radius −20% além de 30% zoom (`html.canvas-zoom-below-30`); restore-version chip centralizado na base; **blank+URL fundidos no azul** `#2966EA` (CSS + `ORIGIN_COLORS.blank`); prompt node ganhou corner-resize handle (`startDashResize('xy')`) + margens internas maiores + altura populada = `textH*1.2 + 76` (20% respiro); **multi-file queue** no "+" (drop um a um, pill "x/N files", ghost prefetch one-ahead, loader circular); skill upload escondido do "+" (backend mantido); **replace-content hover overlay** (image/.md/.html origin) — gradiente escuro na base + pill "Replace content" centralizada no width do node (`left:50%`+`translateX`), bottom+size floor 0.5 uniforme, bg −20% opacidade. **BOARD_AGENT** (`lib/agent/prompts.js`): Rule 1 agora EXIGE que toda chain gerada pelo chat LIDERE com um prompt node cujo conteúdo é a **interpretação enhanced** (prompt-enhancer, não verbatim) do request — variável editável que alimenta a cadeia. **Pendente**: feel no browser (thresholds `ANCHOR_TOP=70`, clip `0.5`/`-8`, replace floor 0.5 calibráveis). Memo: [[checkpoint_2026-06-24_session]].
141. ✅ **Canvas polish follow-up** (sessão 2026-06-25, branch `feat/canvas`, 380/380, web-shell only). **(a)** ícone "+" do chat → **clip de papel** (attach): `ICON_PLUS`→`ICON_CLIP` em `PromptDock.jsx`. **(b)** menu do **histórico de versões não scrollava** — `.cnode-version-menu` (e `.cnode-version-ctx-menu`) faltavam no `NATIVE_WHEEL_SELECTOR` do `CanvasClient.jsx`, então o wheel sobre ele virava zoom/pan do canvas (o CSS já tinha `max-height`+`overflow-y:auto`). Adicionados. **(c)** **replace-content pill** re-centralizada na width do node (`left:50%`+`translateX(-50%)`, bottom+size floor 0.5 uniforme) — o left-anchor fazia ela "desalinhar pro top-right" conforme o tamanho mudava com o zoom. **(d)** **gap do label de dimensões** (`.cnode-asset-dims`): era constante-na-tela (perto demais no zoom-in / longe demais no zoom-out) → tornei proporcional ao node, depois com **piso mínimo de gap na tela** (corrige overlap no zoom-out), depois +30% +30% a pedido → `max(10.14px, 18.6576px*max(0.15,scale))/scale`. **Setup**: plugin `product-designer` (Waqar Ahmed) instalado user-level e o **agente removido** (auto-escrevia no CLAUDE.md) — skills+comando mantidos; lembrete na memória pra re-deletar após updates de plugin ([[reminder_replug_product_designer_agent]]). Memo: [[checkpoint_2026-06-24_session]] (follow-up 06-25).
142. ✅ **Anti-AI-slop design layers — Layer A (house style) + Layer B (image style-extraction), wired** (sessão 2026-06-25, branch `feat/canvas`, 390/390 tests, web-shell only). Origem: pedido do user de uma "skill default" no processo da ferramenta. Definimos **duas camadas**: **A = bom gosto geral sempre-ligado** (destilado de 3 skills UI/UX: emil-design-eng=motion craft, taste-skill=correção de viés, impeccable=princípios+bans), **B = extração de estilo só pra imagens** (transplantar design de screenshot/imagem preservando conteúdo). **Princípio-chave da B**: *recortar/isolar antes de extrair* — uma chamada de visão dedicada limpa o fundo de apresentação (o degradê verde do mockup Dribbble vazava como "cor de marca") e devolve um brief de tokens **por papel** (surface/neutros/accent), depois o compose recebe só o texto → o fundo **não tem como vazar**. Modo `layout` (UI real) vs `inspiration` (não-UI: skeuomórfico/industrial/etc → abstrai e inventa UI). **Specs**: `docs/superpowers/specs/2026-06-25-layer-A-design-quality-house-style.md` + `...layer-B-style-extraction-from-images.md`. **Teste 3-vias** (`docs/superpowers/specs/2026-06-25-anti-slop-test/`, screenshots headless-chrome): bare-roxo-slop → paleta-certa-mas-ainda-slop → paleta+craft-limpo. Provou que A e B fazem trabalhos **separáveis e somáveis**: B acerta a marca, A remove o slop (carrega a maior parte do anti-slop). **Wiring**: novo módulo canônico `lib/design/house-style.js` (`HOUSE_STYLE` = guardrails+invent, `HOUSE_STYLE_GUARDRAILS` = só guardrails sempre-on) consolidou 3 blocos anti-slop divergentes; consumido por `run-flow.js` (COMPOSE_SYSTEM), `demarcelize.js` (reskin/inject — substituiu o `TASTE_PRINCIPLES` local), e `prompts.js` `EDIT_SITE_SYSTEM` (só guardrails, aplicados ao que muda). Regras novas do user vs as skills: **evitar monoespaçadas** (override da taste-skill que recomendava mono p/ números → usar tabular-nums), eyebrows com parcimônia + nunca tracking>padrão, evitar Inter/Bricolage/AI-tell faces, ban da **keyline decorativa** (linha fina metálica traçando cantos arredondados — detalhe que o user anexou), sem JetBrains (regra fixa). **Layer B no código**: `lib/design/style-extract.js` `extractStyleFromImage({imageDataUrl})` (vision, roteia Anthropic/OpenAI/Gemini, default gpt-5.5) → `run-flow.js` converte cada asset em brief design.md ANTES do compose (asset que falha extração = fallback gracioso pra vision-compose cru). Conecta direto ao **Demarcelizer** (já integrado: `lib/demarcelize.js` + rotas `demarcelize/{extract,reskin,inject}`). Testes novos: `style-extract.test.js` (7) + `run-flow.test.js` (3) — mocks de SDK precisam ser **class-based** (`default: class{...}`), não `vi.fn(()=>({}))` (não-construível). **PENDENTE**: eval real no pipeline (custa crédito, precisa dev-server+keys); variante "core" (só guardrails) p/ modelos baratos no compose (HOUSE_STYLE_GUARDRAILS exportado, não auto-selecionado); persistir o brief da Camada B como **nó visível** no canvas (hoje é efêmero no run-flow); "perguntar antes de entregar" em prompt-pobre/imagem-não-UI (comportamento do agente, não do run-flow). Memo: [[checkpoint_2026-06-25_anti-slop-layers]].
