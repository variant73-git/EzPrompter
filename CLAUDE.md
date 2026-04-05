# RepixBridge — Contexto do Projeto

## O que é
**RepixBridge** (antes "EzPrompter") é uma extensão para Chrome/Opera que funciona como um "superwidget" ponte entre referências visuais na web e ferramentas de design + modelos de IA. Slogan: "Design without borders".

Três frentes:
1. **Page Editor** — editor visual Figma-like que permite selecionar, editar e manipular elementos HTML diretamente em qualquer site
2. **HTML → Design** — captura layout completo de qualquer site e envia para Figma/Sketch/Pencil/Paper
3. **Image Remix** — reverse-engineer do prompt de qualquer imagem + geração inline de novas imagens via IA

## Branches
- `feat/normalize-engine` — branch principal de desenvolvimento (editor + layers panel)
- `feat/webflow-rebuild` — experimento de detect/freeze para sites Webflow (1 commit à frente da normalize-engine)
- `claude/ai-image-description-extension-Tp3jY` — main branch

## Versão atual
`2.1.0`

## Estrutura do projeto
```
manifest.json           # Manifest V3 (Chrome/Opera), sem default_popup
background.js           # Service worker: context menus, injeção do panel/editor, APIs de IA
content.js              # Overlay de resultado (legacy)
styles/content.css      # CSS do overlay
editor/editor.js        # EDITOR PRINCIPAL: ~3500 linhas, editor visual injetado na página
editor/editor.css       # Estilos do editor (seleção, layers, inspector, guides)
editor/rebuild.js       # Rebuild engine (getComputedStyle → baked inline styles)
editor/normalize.js     # Curate engine (marks editable elements)
editor/detect.js        # [feat/webflow-rebuild] Detecção de web builder (Webflow/Framer/etc)
editor/freeze.js        # [feat/webflow-rebuild] Congela animações para snapshot
overlay/semantic.js     # AI semantic mapping via Gemini API
overlay/extractor.js    # DOM structure extraction para análise IA
panel/panel.js          # Widget flutuante (onboarding, HTML→Design, Smart Remix)
panel/panel.css         # Estilos do widget
icons/                  # Ícones 16/48/128px
figma-plugin/           # Plugin Figma companion
web/                    # Portal Next.js (auth + pagamentos + relay API)
docs/superpowers/plans/ # Planos de implementação
```

## Editor Visual (editor/editor.js) — Estado Atual

### Funcionalidades implementadas
1. ✅ **Click-depth selection** — primeiro click seleciona container, clicks subsequentes aprofundam
2. ✅ **Layers panel** (esquerda) — árvore DOM lazy com hover highlight, seleção sync bidirecional
3. ✅ **Sections tab** — thumbnails clonadas das seções com drag-to-reorder
4. ✅ **Inspector panel** (direita) — Position, Layout, Typography, Fill, Stroke, Effects
5. ✅ **Spacing guides** — guias rosa com drag handles para margin/padding/gap
6. ✅ **Breadcrumb** — caminho de ancestrais no topo do inspector
7. ✅ **Escape key** — sobe um nível na seleção por vez
8. ✅ **Hover sync** — hover na página destaca layer no painel e vice-versa
9. ✅ **Eye toggle** — esconder/mostrar elementos via layers panel
10. ✅ **Rename** — double-click na layer renomeia
11. ✅ **Color picker** — botão direito na layer abre paleta de 9 cores
12. ✅ **Contextual naming** — layers nomeadas por semântica, ARIA, classes, heurísticas
13. ✅ **Visual weight system** — filtra divs inert (sem contribuição visual)
14. ✅ **Site wrapper detection** — detecta o container principal automaticamente ("Page")
15. ✅ **Drag-to-adjust** — arrastar valores numéricos no inspector
16. ✅ **Font size presets** — dropdown com tamanhos 10-128
17. ✅ **Text alignment** — horizontal (3) + vertical (3) icons
18. ✅ **Case + Decoration** — text-transform e text-decoration controls
19. ✅ **Auto-save** — localStorage com hash-based cache

### Sistemas do editor
- **isVisuallyInert(el)** — detecta divs sem contribuição visual (bg, border, shadow, outline, text). Apenas DIV/SPAN podem ser inert. Usado para filtrar wrappers do layers panel.
- **visualWeight(el)** — pontua conteúdo recursivamente (buttons=2, images=2, headings=2, text=1, etc.) com 50% decay por nível. Cache via WeakMap.
- **elLabel(el)** — naming contextual: semantic tags → ARIA roles → class patterns → heurísticas de posição → fallback tag.class
- **findSiteWrapper()** — detecta o wrapper que contém todas as seções (drill through single-child wrappers)
- **drillIntoChild(parentEl, x, y)** — encontra filho direto nas coordenadas via elementsFromPoint
- **resolveContainer(rawEl)** — resolve click para container meaningful (SVG → parent, inline → block, skip useless wrappers)

### Cores do editor
- `#0095FF` — seleção azul (bounding box)
- `#FF00DD` — spacing rosa (guias de margin/padding)
- `#1A1A1A` — background dos painéis
- `#EFEEEB` — texto dos painéis

## Pivot Estratégico: Web Builder Detection

### Decisão (2026-04-05)
Em vez de tentar editar "qualquer site" via CSS puro (que funciona bem para sites simples mas falha com web builders animados), o Repix **adiciona uma camada de detecção automática**:

- **Web builder detectado** (Webflow, Framer, etc.) → Freeze + Capture + Rebuild em CSS puro editável (experiência premium)
- **Site genérico** → Mode A CSS Live como funciona hoje

### Primeiro alvo: Webflow
Caso de teste: farmminerals.com/promo (Webflow + GSAP + Lenis + IX2/IX3)

### Pipeline planejada
```
Site Webflow → Detect → Freeze animações → Scroll-capture → Extract DOM → Rebuild CSS puro → Edit
```

### Estado da implementação (branch feat/webflow-rebuild)
- ✅ detect.js — fingerprints para Webflow, Framer, Squarespace, Wix, Readymag, Cargo, WordPress, Shopify
- ✅ freeze.js — mata GSAP, Lenis, Webflow IX. Força reveal de elementos animados.
- ⬜ capture.js — scroll programático + screenshots por viewport
- ⬜ extract.js — DOM → JSON com seções e elementos
- ⬜ rebuild — JSON → CSS puro editável

### Insight do designer
Sites animados sempre têm "fotografias" — estados finais de cada viewport onde o designer idealizou o layout. Capturar esses estados finais é suficiente.

## Integração OpenPencil (futuro)
OpenPencil é um editor Figma-like MIT que lê/escreve .fig. A visão é embarcá-lo no Repix como canvas inline (iframe, sem servidor, 100% browser) para edição avançada. O designer captura o site → edita no Repix → abre Quick Edit no OpenPencil → exporta .fig.

Status: MCP do OpenPencil só suporta HTTP (incompatível com Claude Code), skill instalada. App roda em localhost:7600.

## Features do panel flutuante (inalteradas)
- Onboarding (3 steps)
- Dual-mode: HTML→Design (dark) / Image Remix (light)
- Análise contextual do site
- Grid de imagens estilo Pinterest
- Geração inline de imagens
- Export options (SVG, PNG, JPG, Figma)
- "Open in..." AI models
- Prompts e capturas salvos em chrome.storage.local

## Portal Web (web/)
- Stack: Next.js 15, Neon Postgres, Upstash Redis, Stripe
- Planos: Free (5 capturas/mês) | Pro ($7/mês, ilimitado)
- Deploy: Vercel (ainda não deployado)

## Branding
- **Nome:** RepixBridge
- **Logo:** "*Repix*" em Instrument Serif Italic 18px + "Bridge" em Instrument Sans 500 16.2px
- **Slogan:** "Design without borders"
- **Tipografia:** Instrument Serif (display) + Instrument Sans (body)

## Regras de desenvolvimento
- Incrementar versão a cada release significativo
- Editor é injetado via `chrome.scripting` (detect.js → freeze.js → rebuild.js → editor.js)
- CSS do editor é scoped via IDs `rb-editor-*` e classes `rb-*`
- Todas as cores usam CSS custom properties (--rb-*)
- `isEditorEl(el)` verifica se elemento pertence ao editor (id começa com `rb-editor` ou `repixbridge-panel`)
- Funções compartilhadas entre escopos devem estar no escopo externo da IIFE (não dentro de `listen()`)
- Checkpoint stash: `git stash push -m "checkpoint-NNN"`
