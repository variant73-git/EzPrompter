# Handoff — Artefato pixelado no centro da captura (Lottie estático) — 2026-07-24

**Branch:** `main` · **Status:** causa raiz REPRODUZIDA e identificada; **fix ainda NÃO aplicado** (é decisão de produto com tradeoff — ver §4). Contexto limpo pra retomar.

## 1. O sintoma (relato do Adilson)

Ao **capturar** (clonar) `https://www.farmminerals.com/promo` no canvas, a imagem central do hero vem **pixelada** — um bloco de céu+grama de baixíssima resolução no lugar do **pill preto** (o produto CropTab™). O Adilson disse que "um dia funcionava perfeito" e suspeitava de mudança no PROMPT do clone. **Não é o prompt nem o clone** — é a captura.

Importante: **o artefato aparece já na CAPTURA**, não no clone/Clone&Edit.

## 2. Causa raiz (REPRODUZIDA ao vivo, com prova visual)

Rodei a `captureSnapshot` real (função de servidor, sem auth) contra o site vivo e reproduzi o artefato exatamente. Dois fatos-chave:

1. **O screenshot que a própria captura tira está PERFEITO** (pill preto nítido, fundo verde). Ver `captureSnapshot` → `screenshotDataUrl`.
2. **O HTML capturado, re-renderizado (como o nó faz via srcDoc), mostra o bloco pixelado.**

**O centro é uma animação Lottie** (`.croptab-lottie` / `.croptab-lottie-item` → `<svg>` → `<image>` SVG, ~442×442 num container 307×313). Na página viva o Lottie roda por JS e é **scroll-driven** (o frame muda conforme o scroll). O pipeline de captura (`lib/snapshot.js` `captureSnapshot`):
- **remove os scripts** (`stripScripts`) — o Lottie não roda mais no iframe;
- **grava o HTML com a página rolada até o FIM** (linhas ~429-450 de `snapshot.js`, DE PROPÓSITO: "stay at the bottom for the HTML capture" pra disparar callbacks in-view do Webflow IX3/GSAP e evitar que o reset ao topo deixe o hero em `opacity:0`);
- consequência: o Lottie do hero fica **congelado no frame do FIM** (céu+grama, baixa-res) em vez do frame do topo (o pill). Sem JS pra corrigir, esse frame ruim é esticado de ~442px pro tamanho do container → **pixelado**.

Isso explica o "às vezes funcionava": dependia do estado em que a animação era congelada.

> Nota: sites animados são flagados (`animatedDetected=true`) justamente porque a captura estática é imperfeita pra eles; o caminho pensado é **Clone & Edit → reconstrução iter9 (visão)**, que RECORTA os pixels reais do screenshot e corrige. O Adilson quer, porém, que a **captura em si** já não mostre o artefato.

## 3. Como reproduzir (rápido, sem auth, ~40s)

Rodar de `packages/web-shell/` com `bun` (o dev server na 3030 exige login, mas a função de captura não):

```js
// repro.mjs — bun repro.mjs (de packages/web-shell/)
import { captureSnapshot } from './lib/snapshot.js';
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
const cap = await captureSnapshot('https://www.farmminerals.com/promo', { viewport: { width: 1280, height: 800 } });
writeFileSync('/tmp/cap.html', cap.html);
// screenshot da captura (PERFEITO):
writeFileSync('/tmp/capture-screenshot.png', Buffer.from(cap.screenshotDataUrl.split(',')[1], 'base64'));
// re-render do HTML (ARTEFATO aparece aqui):
const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
await p.setContent(cap.html, { waitUntil: 'domcontentloaded' }).catch(()=>{});
await p.waitForTimeout(4000);
await p.screenshot({ path: '/tmp/rendered-node.png', clip: { x:0, y:0, width:1280, height:800 } });
await b.close();
// elemento no centro: document.elementFromPoint(640, 545) → <image> SVG dentro de .croptab-lottie-item
```

Comparar `/tmp/capture-screenshot.png` (bom) vs `/tmp/rendered-node.png` (artefato). O HTML tem ~18.6 MB (assets embutidos no SVG/CSS inline).

## 4. Opções de fix (é uma decisão de produto — Adilson deve escolher)

**(a) [RECOMENDADO tentar primeiro] Rolar de volta ao TOPO antes de gravar o HTML.** Ataca a causa (o Lottie ficaria no frame do hero). O risco é o motivo pelo qual hoje gravam no fim: o topo pode disparar out-animations do hero (`opacity:0`). MAS já existe injeção de **force-show CSS** (`snapshot.js` ~linha 452, `data-uncraft-force-show`) que combate `opacity:0` — então talvez topo + force-show resolva os dois. **Testar contra vários sites animados, não só o farmminerals** (regressão em massa é o risco).

**(b) Sobrepor o crop do screenshot na região animada.** O `screenshotDataUrl` está perfeito; detectar containers Lottie (`.w-lottie`, `[data-animation-type="lottie"]`, `.croptab-lottie`, ou `<svg>` com `<image>` de baixa-res) e cobrir com o recorte correspondente do screenshot. Fiel, mas mais complexo e mexe na editabilidade.

**(c) Esconder o Lottie quebrado.** Simples, mas deixa buraco (perde o produto no centro).

**(d) Não mexer na captura; educar que Clone&Edit conserta.** A reconstrução iter9 já recorta os pixels reais. Talvez só faltasse deixar claro no UX.

## 5. Bug SECUNDÁRIO achado no caminho (corrigir junto, é isolado)

`pinViewportUnits` (`lib/snapshot.js` ~251) faz replace global de `Nvh`/`Nvw` → px no HTML inteiro — e **corrompe o atributo `sizes` das `<img>`**: `sizes="(max-width:1920px) 100vw, 1920px"` vira `"(max-width:1920px) 1280.00px, 1920px"`. Isso atrapalha a seleção de resolução do srcset. Confirmado em 7 imagens do farmminerals (`potato-img-new`, `package_img-new`, `preloader-layer-1-img`). **Fix:** `pinViewportUnits` deve pular o conteúdo de atributos `sizes="..."` (contexto de media-condition, não CSS length). Não é a causa do Lottie, mas é um bug real de imagens responsivas.

## 6. O que NÃO é a causa (já descartado, não reinvestigar)

- **Não é o prompt do clone** (`extract-llm.js` / `cloneImageToHtml`): o placeholder do clone é um bloco com diagonais + label, não uma foto pixelada. E o artefato é na captura, antes de qualquer clone.
- **Não é o crop do clone** (`clone-images.js`): o crop é full-res (probe confirmou).
- **Não é LQIP simples de lazy-load**: `captureSnapshot` já tem `waitForImagesSettled` antes do screenshot (e o screenshot está perfeito).
- **`absolutizeUrls` está OK** (preserva srcset, só absolutiza URLs).

## 7. Fix parcial JÁ commitado nesta sessão (81ca7cfd) — NÃO é a solução do Lottie

Nesta sessão, ANTES de reproduzir, apliquei `waitForImagesSettled` (exportado de `snapshot.js`) no `renderHtmlScreenshot` (`lib/site-screenshot.js`) — hipótese de que o crop do clone pegava imagem lazy em baixa-res. **É um hardening válido e de baixo risco** (esperar imagens antes de fotografar nunca faz mal), mas **NÃO resolve o artefato do Lottie**. Pode manter; não confundir com o fix real.

## 8. Arquivos-chave

- `packages/web-shell/lib/snapshot.js` — `captureSnapshot` (scroll-to-bottom p/ HTML linha ~429-450; force-show CSS ~452; `pinViewportUnits` ~251; `absolutizeUrls` ~205; `stripScripts` ~235; `waitForImagesSettled` ~324, agora exportado).
- `packages/web-shell/lib/site-screenshot.js` — `renderHtmlScreenshot` (render do HTML guardado; ganhou `waitForImagesSettled`).
- Detecção de animado: `detectAnimatedBuilder` em `snapshot.js` (marcou `webflowIx3`, `lenis`, `ix3Scroll` → `animatedDetected`).
- Freeze: `editor/freeze.js` / `packages/editor-core/src/freeze.js` (congela GSAP/Lenis/Webflow IX; **NÃO trata Lottie** — potencial ponto de fix).

## 9. Resto da sessão (contexto, já FEITO e commitado)

- **Consolidação do tronco**: `main` fast-forwardado até a linha soma→failover (era item 152, agora 158); house-style switchboard trazido por cópia. Commits `e3dfa013`.
- **5 fixes do canvas** (commit `81ca7cfd`, 879 testes): botão "Clone & Edit"; reconstrução sobrescreve snapshot in-place COM guard `source='capture'` (auditoria Claude+Sol pegou data-loss — F1/Codex#1 — e o helper agora relê o snapshot autoritativamente, Codex#2; Open-in-Browser desabilita sem preview, Codex#3); item-1 waitForImagesSettled (parcial, ver §7).
- **Divider do dock** (a corrigir/commitar neste ponto): sangrava ao clicar num node — era o `prompt-dock-context-wrap` com `margin: 0 -10px` (padding real do dock = 7px) SEM overflow-clip → vazava 3px no canto arredondado. Corrigido p/ `-7px` (e `chips-wrap` idem; `chat-divider` revertido pro `-7px` original).
- **Memória**: proposta de integração do motion editor ao canvas guardada em `[[feature_motion_editor_canvas_integration]]` (adiada, motion fica isolado na 3032).
