# RepixBridge — Contexto do Projeto

## O que é
**RepixBridge** (antes "EzPrompter") é uma extensão para Chrome/Opera que funciona como um "superwidget" ponte entre referências visuais na web e ferramentas de design + modelos de IA. Slogan: "Design without borders".

Duas frentes principais:
1. **HTML → Design** — captura layout completo de qualquer site e envia para Figma/Sketch/Pencil/Paper
2. **Image Remix** — reverse-engineer do prompt de qualquer imagem + geração inline de novas imagens via IA

## Branch ativa
`claude/ai-image-description-extension-Tp3jY`

## Versão atual
`2.1.0`

## Estrutura do projeto
```
manifest.json           # Manifest V3 (Chrome/Opera), sem default_popup
background.js           # Service worker: context menus, injeção do panel, APIs de IA, captura de layout
content.js              # Overlay de resultado (legacy, usado para feedback de sucesso/erro)
styles/content.css      # CSS do overlay de resultado
panel/panel.js          # PRINCIPAL: widget flutuante injetado na página ativa
panel/panel.css         # Estilos do widget (scoped via #repixbridge-panel)
popup/popup.html        # Popup legado (não mais usado como default_popup)
popup/popup.css         # CSS do popup legado
popup/popup.js          # JS do popup legado
icons/                  # Ícones 16/48/128px
figma-plugin/           # Plugin Figma companion (importa capturas de layout)
  manifest.json         # Manifest do plugin Figma
  code.js               # Tradução DOM → Figma nodes
  ui.html               # UI do plugin (input de capture ID)
web/                    # Portal Next.js (auth + pagamentos + relay API)
  app/api/auth/         # Signup, login, validate (JWT)
  app/api/captures/     # Relay: armazena capturas em Redis (30min TTL)
  app/api/checkout/     # Stripe checkout session
  app/api/webhook/      # Stripe webhook (upgrade/downgrade)
  app/dashboard/        # Dashboard do usuário
  app/page.jsx          # Landing page (login/signup)
  lib/db.js             # Neon Postgres
  lib/auth.js           # JWT + bcrypt
  lib/stripe.js         # Stripe integration ($7/mês Pro)
  lib/redis.js          # Upstash Redis
  schema.sql            # SQL da tabela users
DESIGN-SYSTEM.md        # Design tokens, tipografia, cores, espaçamentos
```

## Como funciona a extensão (painel flutuante)
1. Usuário clica no ícone da extensão → `background.js` injeta `panel/panel.css` + `panel/panel.js` na aba ativa
2. O panel é um `div#repixbridge-panel` com `position: fixed`, `border-radius: 40px`, arrastável pelo header
3. Não usa popup nativo do Chrome (removido do manifest) — é um overlay in-page
4. Clique no ícone de novo → toggle (remove o panel)
5. Clique fora do panel → fecha

## Fluxo do panel
- **Onboarding (3 steps):** aparece na primeira vez. Títulos em Instrument Serif 32px, corpo em Instrument Sans 14px, highlights em Serif Italic 10% maior. Alinhado bottom-left.
- **Main view:** toggle entre "HTML → Design" (dark mode) e "Image Remix" (light mode)
- **Settings:** acessível via ícone de engrenagem no header, back arrow para voltar

## Dual-mode color system
- **HTML → Design (dark):** bg #000000, fg #EFEEEB
- **Image Remix (light):** bg #EFEEEB, fg #000000
- Transição de 300ms via CSS custom properties (--rb-bg, --rb-fg, etc.)

## Branding
- **Nome:** RepixBridge (Remix + Pic + Bridge)
- **Logo:** "*Repix*" em Instrument Serif Italic 18px + "Bridge" em Instrument Sans 500 16.2px, sem espaço entre eles
- **Slogan:** "Design without borders" — 7.2px, opacity 0.5

## Tipografia
- **Display:** Instrument Serif (Italic para logo e títulos de onboarding)
- **Body/UI:** Instrument Sans 400/500/600/700
- Google Fonts: `Instrument+Sans:wght@400;500;600;700` + `Instrument+Serif:ital@0;1`

## Provedores de IA (descrição de prompt)
- **Google Gemini** (padrão, tier gratuito) — `gemini-2.0-flash`
- **Ollama** (local/offline) — `moondream` ou `llava`
- **OpenAI** — `gpt-4o`
- **Anthropic** — `claude-sonnet-4-6`

## Provedores de geração de imagem (inline)
- **Stability AI** (padrão) — SD3, requer `stabilityApiKey`
- **OpenAI DALL-E 3** — usa `apiKey` existente quando provider é openai
- **Google Gemini Imagen** — usa `apiKey` existente quando provider é gemini
- **Replicate** — SDXL com polling, requer `replicateApiKey`
- Dropdown com status em tempo real: green dot + "pronto" / red dot + "conectar API"

## Features implementadas
1. ✅ Context menu "Image Remix — Describe Prompt" (clique direito em imagem)
2. ✅ Context menu "Capture Layout → Design Tool" (clique direito na página)
3. ✅ Panel flutuante com onboarding, dual-mode, settings
4. ✅ Análise contextual do site (loader circular, detecta tipo de site, sites conhecidos)
5. ✅ Grid de imagens estilo Pinterest na aba Image Remix (filtra >100x100px, top 12)
6. ✅ Botão "Remix" em cada imagem → descreve prompt via IA
7. ✅ Geração inline de imagens com dropdown de provedores + status de API
8. ✅ Botão "Remix this site" na aba HTML→Design
9. ✅ Export options (SVG, PNG, JPG, Figma) nos cards de captura
10. ✅ "Open in..." AI models (ChatGPT, Gemini, Leonardo, Ideogram, Midjourney, DreamStudio)
11. ✅ Portal web (Next.js) com auth, Stripe, relay API
12. ✅ Figma plugin companion
13. ✅ Prompts e capturas salvos em chrome.storage.local (repositório editável)
14. ✅ Tags editáveis inline nos prompt cards (style, aspectRatio)

## Bugs conhecidos / em investigação
- Analyzer do site: roda mas loader SVG pode não ser visível em alguns sites (CSS conflicts)
- Flood de `runtime.lastError` foi corrigido mas pode reaparecer se outras extensões interferirem

## Particularidade do Ollama (IMPORTANTE)
O Ollama bloqueia requisições de `chrome-extension://` por CORS.
**Solução implementada:** abre uma aba em background em `http://localhost:11434/`, injeta o fetch via `chrome.scripting.executeScript`.

## Portal Web (web/)
- **Stack:** Next.js 15, Neon Postgres, Upstash Redis, Stripe
- **Auth:** JWT + bcrypt, 30 dias de validade
- **Planos:** Free (5 capturas/mês) | Pro ($7/mês, ilimitado)
- **Relay:** POST /api/captures (auth) → Redis 30min TTL → GET /api/captures/:id (público, Figma plugin busca)
- **Deploy:** Vercel (ainda não deployado)
- **Manual steps pendentes:** criar contas Stripe/Neon/Upstash, rodar schema.sql, deploy

## Como instalar para testar
1. `git clone` + `git checkout claude/ai-image-description-extension-Tp3jY`
2. `chrome://extensions/` ou `opera://extensions/` → Developer mode → Load unpacked → selecionar a pasta raiz
3. Navegar para qualquer site (não funciona em chrome:// pages)
4. Clicar no ícone da extensão → panel aparece
5. Configurar API keys via Settings (ícone de engrenagem)

## Próximos passos discutidos
- Background animado com dotted surface (canvas 2D ou CSS radial-gradient)
- Melhoria visual do analyzer (pode ter problemas de visibilidade em alguns sites)
- Deploy do portal web no Vercel
- Publicação na Chrome Web Store / Opera Add-ons

## Regras de desenvolvimento
- Incrementar versão a cada release significativo
- Panel é injetado via `chrome.scripting` (não usa popup nativo)
- CSS do panel é scoped via `#repixbridge-panel` para não conflitar com CSS da página host
- Todas as cores usam CSS custom properties (--rb-*)
- Instrument Serif + Instrument Sans são carregados via Google Fonts (link element injetado pelo JS)
