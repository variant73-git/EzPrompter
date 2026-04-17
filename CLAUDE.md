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
editor/s2h.js           # S2H: Screenshot-to-HTML (2-pass vision pipeline, independente do Mode E)
editor/fill-popup.js    # Fill popup: Color (canvas picker) / Gradient / Image / Effects + Image-only popup + Color-only popup
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
4. ⬜ **Refinement loop** — comparar output com original, re-gerar chunks divergentes
5. ⬜ **Asset localization** — baixar imagens/fonts para data URLs
6. ⬜ **History UI** + **Projects UI** (persist.js já tem a API, falta UI)
7. ⬜ **Smart stitcher** — eliminar declarações CSS duplicadas entre chunks

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
- Injeção: detect.js → freeze.js → extractor.js → persist.js → mode-e.js → s2h.js → rebuild.js → fill-popup.js → editor.js
- CSS scoped via IDs `rb-editor-*` e classes `rb-*`
- `isEditorEl(el)` reconhece `rb-editor*` E `rb-ed-*`
- **TODOS os botões do editor: `mousedown` + `capture:true` + `stopImmediatePropagation`**
- Editor.js self-injeta CSS via `<link>` tag (não depender de `insertCSS` do background)
- Funções compartilhadas entre escopos: escopo externo da IIFE (NÃO dentro de `listen()`)
- Variáveis compartilhadas (ex: `layerHoverLock`, `isUselessWrapper`): escopo externo
- Checkpoint stash: `git stash push -m "checkpoint-NNN"`
- Modelo Gemini atual: `gemini-3.1-pro-preview` (definido em popup/popup.js e background.js). Modelos 2.x são marcados como outdated no background.js
- rebuild.js v5 crasha o editor — usar v4 até re-implementar com cuidado
- **Todos os campos do inspector devem ter 25px de altura** — sem exceção
- Fill popup: iro.js não funciona em sites com CSP restritivo — usar canvas picker nativo
- Fill popup: `background` shorthand sobrepõe `background-color` — limpar shorthand ao re-aplicar cor sólida
