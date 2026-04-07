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
- ✅ Builder detection (8 builders)
- ✅ Animation freeze (GSAP, Lenis, Webflow IX2/IX3)
- ✅ Scroll-capture (max 8 viewports)
- ✅ Design token extraction (cores, fonts via extractor.js)
- ✅ Screenshot → Gemini 2.5 Flash Vision → HTML/CSS rebuild
- ✅ Model fallback chain (2.5-flash → 2.0-flash → 1.5-flash-latest)
- ✅ Preserva editor UI durante rebuild
- ⬜ Component chunking (segmentar em componentes antes de enviar ao LLM)
- ⬜ DOM + Screenshot hybrid (enviar cleanHTML junto com screenshot)
- ⬜ Multi-breakpoint capture (desktop + tablet + mobile)
- ⬜ Refinement loop (comparar output com original, iterar)

### Mode B: Rebuild (DOM Mirroring)
- ✅ rebuild.js v4 funcional (tag elements + disable interactivity)
- ❌ rebuild.js v5 (stylesheet extraction) **causava crash silencioso** — revertido
- ⬜ Re-implementar v5 com cuidado (extrair stylesheets originais como Reforge faz)

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
1. **DOM Mirroring** — getComputedStyle ou stylesheets originais → CSS preservado. Fidelidade 95%.
2. **Vision-to-Code** ⭐ — screenshot → Vision LLM → HTML novo. Fidelidade 80-90%. Mode E usa isso.
3. **Runtime Interception** — reverse-engineer do builder runtime. 100% fidelidade mas frágil. NÃO implementar.

### Reforge (build.reforge.com) — engenharia reversa feita
- Usa Strategy 1 (DOM Mirroring) com **stylesheets originais** (não computed)
- 13 arquivos CSS preservados, 35 componentes React auto-gerados
- SafeImage com proxy CORS para imagens
- Esconde elementos animados com `visibility:hidden !important` em vez de reproduzir
- Confirma que extrair stylesheets originais via `document.styleSheets` é superior a `getComputedStyle`

### Técnica recomendada: DOM + Screenshot Hybrid
Enviar AMBOS para o LLM: screenshot (fidelidade visual) + cleanHTML (textos, hierarquia). Extractor.js já produz cleanHTML — falta integrar no prompt do Mode E.

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
