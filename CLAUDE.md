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
- **Total: ~$9-14M ARR** dentro de um mercado de design tools de $14.9B

### Pricing recomendado
- **Free**: Mode A (CSS Live editing), 3 rebuilds/mês cortesia
- **Pro ($12/mês)**: Mode E (IA rebuild ilimitado), web builder detection, export .fig

## Branches
- `feat/normalize-engine` — branch principal (editor + layers + Mode E + detect/freeze)
- `claude/ai-image-description-extension-Tp3jY` — main branch

## Versão atual
`2.1.0`

## Estrutura do projeto
```
manifest.json           # Manifest V3 (Chrome/Opera)
background.js           # Service worker: injeção, APIs IA, captureVisibleTab
editor/editor.js        # EDITOR PRINCIPAL: ~3800 linhas
editor/editor.css       # Estilos (seleção, layers, inspector, guides)
editor/mode-e.js        # Mode E: screenshot → Gemini Vision → HTML rebuild
editor/detect.js        # Detecção de web builder (8 builders)
editor/freeze.js        # Congela animações (GSAP, Lenis, Webflow IX)
editor/rebuild.js       # Rebuild engine v4 (tag elements + disable interactivity)
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

### Mode E: Papel Vegetal (Vision-to-Code)
**O que aprendemos:** Vision-to-Code (screenshot → LLM → HTML) é a abordagem recomendada para longevidade. O same.new usa component chunking: segmenta a página em componentes antes de enviar ao LLM. A técnica DOM + Screenshot hybrid melhora a qualidade: enviar screenshot + cleanHTML juntos. O extractor.js já produz tokens e cleanHTML — falta integrar no prompt.

**Implementado:**
- ✅ Builder detection (8 builders)
- ✅ Animation freeze (GSAP, Lenis, Webflow IX2/IX3)
- ✅ Scroll-capture (max 8 viewports)
- ✅ Design token extraction (cores, fonts via extractor.js)
- ✅ Screenshot → Gemini 2.5 Flash Vision → HTML/CSS rebuild
- ✅ Model fallback chain (2.5-flash → 2.0-flash → 1.5-flash-latest)
- ✅ Preserva editor UI durante rebuild
- ✅ DOM + Screenshot hybrid — cleanHTML do extractor.js no prompt
- ✅ **DESIGN.md generator Aura-parity** (extractor.js `generateDesignMD()`, 1543 linhas):
  - Overview com tone sentence auto-detectado
  - Layout & Grid (sticky/sidebars/backdrop-blur/graph-paper/section paddings)
  - Color Palette com semantic roles (surface-base, primary-text, accent-N) + descritores ("off-white beige")
  - Typography com Tailwind class annotations em pesos/sizes/line-heights/tracking
  - Components com TW class strings por variante + hover state correlation + inner icon container detection
  - Graphic Elements & Shapes (tall pills, extreme radii, rotated blocks)
  - Animations & Interactions (::selection, :hover, @keyframes, transitions)
  - CSS Custom Properties com cross-ref Tailwind
  - Assets com background-image inventory categorizado
  - Source Implementation Cues (10+ prompt-ready MUST-preserve directives)

**Fidelidade observada/projetada:**
- Baseline (só screenshot): ~65-75%
- Com DESIGN.md rico (estado atual): ~85-93%
- Com chunking (próximo passo): ~95-97% (meta same.new)

**Roadmap para melhorar fidelidade:**
1. ✅ DOM + Screenshot hybrid
2. ⬜ **Component chunking** — segmentar página antes de enviar (navbar, hero, sections, footer separados) como same.new faz. Próximo passo imediato.
3. ⬜ **Asset localization** — baixar imagens/fonts para data URLs
4. ⬜ **Multi-breakpoint capture** — desktop + tablet + mobile
5. ⬜ **Refinement loop** — comparar output com original, iterar

### Mode B: Rebuild (DOM Mirroring) — baseado no Reforge
**O que aprendemos:** O Reforge usa DOM Mirroring com stylesheets originais — extrai CSS rules via `document.styleSheets` (não `getComputedStyle`). Isso preserva media queries, hover states, keyframes, cascade. Resultado: 95% de fidelidade visual.

**Implementado:**
- ✅ rebuild.js v4 funcional (tag elements + disable interactivity)
- ❌ rebuild.js v5 (stylesheet extraction) **causava crash silencioso** — revertido

**Caminho:** Re-implementar v5 como arquivo separado (não dentro do rebuild.js) para evitar conflitos de escopo com o editor. Causa provável do crash: conflito de escopo com `"use strict"` ou shadowing de variáveis.

## Bugs conhecidos e padrões descobertos

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
A ordem de injeção no background.js é: detect.js → freeze.js → extractor.js → mode-e.js → rebuild.js → editor.js. O rebuild.js v5 era o último antes do editor.js e quebrava a inicialização.

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

### Aura.build — engenharia reversa feita (abril 2026)
- Usa 3 fontes com hierarquia: **screenshot** (visual primário) > **captured page structure** (estrutura DOM) > **DESIGN.md** (tipografia + assets, secundário)
- DESIGN.md é **Markdown semântico** (~15KB): Overview, Colors (brand/semantic/neutrals), Typography (families + weights + usage + hierarchy), Elevation (borders vs shadows), Components (inventário), Do's/Don'ts, Assets (URLs categorizados)
- O "Overview" do DESIGN.md dá ao LLM o **tom** do site antes dos detalhes — crucial para qualidade
- Assets categorizados: Image, Font, Background, Other — com URLs reais para `@font-face`
- Usa **Gemini 3.1** para geração
- Resultado: alta fidelidade em sites complexos (testado em sanity.io)
- Referência salva: `.firecrawl/aura-sanity-design.md`
- **Implicação para RepixBridge:** nosso extractor.js deve gerar output no formato DESIGN.md (markdown semântico, não JSON)

### Técnica recomendada: DOM + Screenshot Hybrid
Enviar AMBOS para o LLM: screenshot (fidelidade visual) + cleanHTML (textos, hierarquia, semântica). O extractor.js já produz cleanHTML e design tokens — falta integrar no prompt do Mode E. Essa é a próxima melhoria de maior impacto.

## Integração OpenPencil (futuro)
OpenPencil — editor Figma-like MIT, lê/escreve .fig, 100% browser (WASM/Canvas), zero servidor.
Visão: embed no Repix como iframe inline. Designer edita → Quick Edit no OpenPencil → exporta .fig.
MCP só suporta HTTP (incompatível com Claude Code stdio). Skill instalada.

## Modelo de Negócio

### Pricing
| Tier | Preço | Features |
|---|---|---|
| Free | $0 | Mode A (CSS Live), 3 rebuilds/mês |
| Pro | $12/mês | Mode E ilimitado, web builder detection, export .fig |

### Decisão: cobrar pela IA, não BYOK
Experiência seamless, margem ~80%, zero config para o usuário.

## Legal & Ética
Ferramenta de **inspiração e aprendizado** — designer edita para criar algo novo ("papel vegetal").

## Branding
- **Nome:** RepixBridge
- **Logo:** "*Repix*" em Instrument Serif Italic + "Bridge" em Instrument Sans 500
- **Slogan:** "Design without borders"
- **Tipografia:** Instrument Serif (display) + Instrument Sans (body/UI)

## Regras de desenvolvimento
- Incrementar versão a cada release significativo
- Injeção: detect.js → freeze.js → extractor.js → mode-e.js → rebuild.js → editor.js
- CSS scoped via IDs `rb-editor-*` e classes `rb-*`
- `isEditorEl(el)` reconhece `rb-editor*` E `rb-ed-*`
- **TODOS os botões do editor: `mousedown` + `capture:true` + `stopImmediatePropagation`**
- Editor.js self-injeta CSS via `<link>` tag (não depender de `insertCSS` do background)
- Funções compartilhadas entre escopos: escopo externo da IIFE (NÃO dentro de `listen()`)
- Variáveis compartilhadas (ex: `layerHoverLock`, `isUselessWrapper`): escopo externo
- Checkpoint stash: `git stash push -m "checkpoint-NNN"`
- Gemini model fallback: 2.5-flash → 2.0-flash → 1.5-flash-latest
- rebuild.js v5 crasha o editor — usar v4 até re-implementar com cuidado
