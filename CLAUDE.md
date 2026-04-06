# RepixBridge — Contexto do Projeto

## O que é
**RepixBridge** é uma extensão Chrome que funciona como um **design tool para a web** — o designer edita qualquer site visualmente, sem sair do browser. Slogan: "Design without borders".

Três frentes:
1. **Page Editor** — editor Figma-like: layers panel, inspector, spacing guides, edição visual in-place
2. **Mode E (Papel Vegetal)** — IA captura screenshots do site e reconstrói em HTML/CSS limpo editável
3. **Image Remix** — reverse-engineer do prompt de qualquer imagem + geração inline via IA

## Posicionamento Estratégico
O Repix é o único tool que **edita sites visualmente no browser** com controles de design tool (layers, inspector, spacing). Nenhum competidor faz isso:
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
- Site-to-Design: ~$5-8M ARR (líder: html.to.design)
- Site Cloning: ~$3.5-4M ARR (líder: same.new)
- CSS Inspection: ~$500K-1M ARR (líder: CSS Peeper)
- CSS Editing: ~$50-100K ARR (líder: CSS Pro)
- **Total: ~$9-14M ARR** dentro de um mercado de design tools de $14.9B

### Pricing recomendado
- **Free**: Mode A (CSS Live editing), 3 rebuilds/mês cortesia
- **Pro ($12/mês)**: Mode E (IA rebuild ilimitado), web builder detection, export .fig
- Alinhado com html.to.design e Wireframeit ($12/mês)

## Branches
- `feat/normalize-engine` — branch principal (editor + layers + Mode E + detect/freeze)
- `feat/webflow-rebuild` — branch legada (detect/freeze, já merged na normalize-engine)
- `claude/ai-image-description-extension-Tp3jY` — main branch

## Versão atual
`2.1.0`

## Estrutura do projeto
```
manifest.json           # Manifest V3 (Chrome/Opera)
background.js           # Service worker: injeção, APIs IA, captureVisibleTab
editor/editor.js        # EDITOR PRINCIPAL: ~3500 linhas
editor/editor.css       # Estilos (seleção, layers, inspector, guides)
editor/mode-e.js        # Mode E: screenshot → Gemini Vision → HTML rebuild
editor/detect.js        # Detecção de web builder (8 builders)
editor/freeze.js        # Congela animações (GSAP, Lenis, Webflow IX)
editor/rebuild.js       # Rebuild engine (getComputedStyle → baked styles)
editor/normalize.js     # Curate engine
overlay/semantic.js     # AI semantic mapping (legado, substituído por Mode E)
overlay/extractor.js    # Extração de tokens: cores, fonts, radii, shadows, HTML limpo
panel/panel.js          # Widget flutuante (onboarding, HTML→Design, Smart Remix)
panel/panel.css         # Estilos do widget
figma-plugin/           # Plugin Figma companion
web/                    # Portal Next.js (auth + Stripe + relay API)
```

## Editor Visual — Estado Atual

### Funcionalidades (Mode A: CSS Live)
1. ✅ Click-depth selection (drill into nested elements)
2. ✅ Layers panel (esquerda) — árvore DOM lazy, hover sync bidirecional
3. ✅ Sections tab — thumbnails com drag-to-reorder
4. ✅ Inspector panel (direita) — Position, Layout, Typography, Fill, Stroke, Effects
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

### Mode E: Papel Vegetal (IA Rebuild)
- ✅ Builder detection (8 builders: Webflow, Framer, Squarespace, Wix, Readymag, Cargo, WordPress, Shopify)
- ✅ Animation freeze (GSAP, Lenis, Webflow IX2/IX3)
- ✅ Scroll-capture (max 8 viewports)
- ✅ Design token extraction (cores, fonts via extractor.js)
- ✅ Screenshot → Gemini 2.5 Flash Vision → HTML/CSS rebuild
- ✅ Model fallback chain (2.5-flash → 2.0-flash → 1.5-flash-latest)
- ✅ Preserva editor UI durante rebuild
- ⬜ Component chunking (segmentar em componentes antes de enviar ao LLM)
- ⬜ DOM + Screenshot hybrid (enviar cleanHTML junto com screenshot)
- ⬜ Multi-breakpoint capture (desktop + tablet + mobile)
- ⬜ Asset localization (baixar imagens/fonts para data URLs)
- ⬜ Refinement loop (comparar output com original, iterar)

### Sistemas internos
- **isVisuallyInert(el)** — apenas DIV/SPAN. Checa bg, border, shadow, outline, text. Sem layout props (padding/gap/position não contam).
- **visualWeight(el)** — pontua conteúdo (buttons=2, images=2, headings=2, text=1). 50% decay/nível. WeakMap cache.
- **elLabel(el)** — naming: semantic → ARIA → class patterns → decorative check → fallback tag.class
- **findSiteWrapper()** — drill through single-child wrappers até 3+ filhos full-width
- **isEditorEl(el)** — reconhece `rb-editor*` E `rb-ed-*` (banner, layers, inspector)
- **layerHoverLock** — previne tMove de limpar hoverBox quando mouse está sobre layer row

### Cores do editor
- `#0095FF` — seleção azul
- `#FF00DD` — spacing rosa
- `#1A1A1A` — background painéis
- `#EFEEEB` — texto painéis

## Abordagens Técnicas de Clonagem (pesquisa consolidada)

### Três estratégias identificadas
1. **DOM Mirroring** — headless browser → getComputedStyle → Tailwind. 95% fidelidade. É o que rebuild.js faz.
2. **Vision-to-Code** ⭐ — screenshot → Vision LLM → HTML/CSS novo. 80-90% fidelidade. É o que Mode E faz. Same.new, Orchids, Open Lovable usam isso.
3. **Runtime Interception** — reverse-engineer do runtime do builder (webflow.js, framer-motion). 100% fidelidade mas frágil. NÃO implementar.

### Técnica recomendada: DOM + Screenshot Hybrid
Enviar AMBOS para o LLM: screenshot (fidelidade visual) + cleanHTML (textos exatos, hierarquia, classes). Nosso extractor.js já produz cleanHTML — falta integrar no prompt do Mode E.

### Pipeline ideal (baseada em same.new + pesquisa)
```
1. Detect builder
2. Freeze animações
3. Extract design tokens (cores, fonts, @font-face, @keyframes, media queries)
4. Scroll-capture (multi-breakpoint: desktop + tablet + mobile)
5. Component chunking (segmentar em nav, hero, sections, footer)
6. Para cada componente: screenshot + DOM structure → LLM
7. Rebuild → HTML/CSS limpo
8. Asset localization (imagens → data URLs)
9. Refinement loop (comparar screenshot output vs original)
```

### Tools/técnicas a investigar
- **NoCodeExport** — re-inicializa webflow.js em vez de substituir. Preserva animações.
- **CSS Coverage API** — extrai só as regras CSS realmente usadas (incluindo CSS-in-JS runtime)
- **Replay (video-to-code)** — grava animação em vídeo, extrai timing/easing para Framer Motion
- **ClonewebX** — estudar como extrai componentes preservando estilos
- **HTML to Framer extension** — modelo para Repix → OpenPencil (copiar seção → colar no editor)

## Integração OpenPencil (futuro)
**OpenPencil** — editor Figma-like MIT, lê/escreve .fig, 100% browser (WASM/Canvas), zero servidor.

Visão: embed no Repix como iframe inline para edição avançada (pen tool, vetores, components). Designer captura site → edita no Repix → Quick Edit no OpenPencil → exporta .fig. Nunca sai do browser.

Status técnico:
- MCP só suporta HTTP (incompatível com Claude Code stdio)
- Skill `open-pencil` instalada em `.agents/skills/open-pencil`
- App roda em localhost:7600 (HTTP) / 7601 (WS)
- Pacote: `@open-pencil/mcp` v0.11.2 (bun global)

vs Penpot: Penpot precisa de servidor (PostgreSQL+Redis+Clojure), não lê .fig, pesado demais para embed. OpenPencil é a escolha certa.

## Modelo de Negócio

### Pricing planejado
| Tier | Preço | Features |
|---|---|---|
| Free | $0 | Mode A (CSS Live), 3 rebuilds/mês |
| Pro | $12/mês | Mode E ilimitado, web builder detection, export .fig, naming IA |

### Custo por usuário Pro
- Gemini 2.5 Flash: ~$0.01-0.05 por rebuild
- ~$1-2/mês por usuário ativo
- Margem: ~80%

### Decisão: cobrar pela IA, não deixar BYOK
- Experiência seamless (zero config)
- Margem saudável
- Barreira de entrada zero
- A API key própria que já existe no Settings continua para Image Remix (feature gratuita)

### TAM realista
- CSS Peeper tem 500K users de designers que inspecionam sites
- Repix é "CSS Peeper que edita" — se capturar 5-10% = 25-50K users
- $12/mês × 5% Pro = $180-360K ARR primeiro ano
- Potencial $1-3M ARR em 2-3 anos

## Legal & Ética
- Posicionar como ferramenta de **inspiração e aprendizado**, não cópia
- Designer edita para criar algo novo ("papel vegetal")
- Substituir assets com copyright antes de publicar
- Não copiar API keys, analytics, scripts de terceiros

## Portal Web (web/)
- Stack: Next.js 15, Neon Postgres, Upstash Redis, Stripe
- Planos: Free (5 capturas/mês) | Pro ($12/mês, ilimitado)
- Deploy: Vercel (ainda não deployado)

## Branding
- **Nome:** RepixBridge
- **Logo:** "*Repix*" em Instrument Serif Italic 18px + "Bridge" em Instrument Sans 500 16.2px
- **Slogan:** "Design without borders"
- **Tipografia:** Instrument Serif (display) + Instrument Sans (body/UI)

## Regras de desenvolvimento
- Incrementar versão a cada release significativo
- Injeção: detect.js → freeze.js → extractor.js → mode-e.js → rebuild.js → editor.js
- CSS scoped via IDs `rb-editor-*` e classes `rb-*`
- `isEditorEl(el)` reconhece `rb-editor*` E `rb-ed-*`
- Funções compartilhadas entre escopos: escopo externo da IIFE (NÃO dentro de `listen()`)
- Banner buttons: usar `mousedown` com `capture:true` + `stopImmediatePropagation`
- Checkpoint stash: `git stash push -m "checkpoint-NNN"`
- Gemini model fallback: 2.5-flash → 2.0-flash → 1.5-flash-latest
