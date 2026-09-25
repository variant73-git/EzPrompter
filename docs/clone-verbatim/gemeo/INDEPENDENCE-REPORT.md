# Relatório de Independência — Clone 1:1 CropTab™ / Farm Minerals promo

**Data:** 2026-07-17
**Fonte de pesquisa (temporária):** https://www.farmminerals.com/promo
**Pacote de produção:** `site/` — servido por `serve.mjs` (zero dependências)

> Este pacote é um **fixture de fidelidade** para o motor de captura/clone do Uncraft
> (benchmark superior ao Iter9). A fidelidade só é mensurável contra ground truth 1:1,
> por isso a marca é preservada. Vestígios técnicos que vazariam para o autor original
> (analytics, endpoints de form, canonical/OG) foram removidos — isso **protege** a fonte.

## 1. Resultado do teste offline

Executado com **todas as requisições externas bloqueadas** no navegador (Playwright
`route.abort()` para qualquer host ≠ 127.0.0.1), percorrendo a página inteira do
preloader ao rodapé:

| Métrica | Resultado |
|---|---|
| Requisições externas (bloqueadas/tentadas) | **0** |
| Erros de console | **0** |
| Erros de página (JS) | **0** |
| Assets locais 404 | **0** |
| Altura da página (clone) | 20 942 px |
| Altura da página (original) | 20 942 px |

Relatório bruto: `validation/offline-report.json`.

## 2. Comparação visual (11 scroll points, 1440×1200)

Clone vs. original lado a lado: `validation/pair-00.png` … `pair-10.png`
(contact-sheets `sheet-A.png`, `sheet-B.png`). Todas as cenas da coreografia de 12
passos batem em posição, tamanho, tipografia, cor e conteúdo. Única variância observada:
o **frame de rotação do produto 3D no hero** (Lottie `croptab 3d new.json`) amostrado em
ponto de scrub ligeiramente diferente — o asset e a animação estão presentes e rodando.

## 3. Inventário de recursos locais (369 arquivos, ~33 MB)

| Tipo | Qtd | Conteúdo |
|---|---|---|
| AVIF | 298 | fotos, renders de produto, backgrounds, variantes responsivas |
| SVG | 36 | ícones, logos, formas |
| JS | 9 | jQuery 3.5.1, GSAP 3.15.0 + ScrollTrigger + SplitText, Lenis 1.1.13, Splide 4.1.4, Webflow (3) |
| Lottie JSON | 7 | logo animado, detail, croptab 3D (3.7 MB), nutripeak, package |
| WOFF | 6 | Aeonik thin/regular/medium/semibold/bold/black |
| MP4 | 3 | corn, farm_main_video, tab (BunnyCDN, baixados) |
| PNG/JPG | 8 | gradientes, ícones, foto |
| HTML/CSS | 2 | `index.html` + `farm-minerals.webflow.shared.min.css` |

Todos servidos localmente. Bibliotecas de animação incorporadas como cópia local
(`/vendor/…`), então as animações rodam sem rede.

## 4. Vestígios removidos do pacote de produção

- **Structured data:** 2 scripts (`schemaorg_organization`, `breadcrumblist_schema`) removidos. Nenhum JSON-LD remanescente.
- **SEO/social:** `<link rel="canonical">`, todas as meta `og:*` e `twitter:*`, `<meta generator>` removidas.
- **Preconnect** para `cdn.prod.website-files.com` removido.
- **Badge Webflow** ("Powered by") removido.
- **SRI (`integrity`) + `crossorigin`** removidos de todos `<link>`/`<script>` (senão bloqueariam os arquivos locais).
- **`data-wf-domain`** (domínio de submissão do form) removido do `<html>`. Preservados `data-wf-page`/`data-wf-site` — necessários ao motor Webflow IX2.
- **HTML original cru** (com `Last Published`, `data-wf-domain` e 373 URLs de origem) **não** é incluído no pacote — só o `index.html` limpo.
- **URLs absolutas** de `farmminerals.com`, `website-files.com`, `b-cdn.net`, unpkg, jsDelivr, Cloudfront reescritas para caminhos locais neutros (`/assets`, `/media`, `/vendor`) — os nomes de domínio **não** aparecem nos caminhos.

## 5. Interações externas neutralizadas (texto/aparência preservados)

- **Formulário "Apply to Join"** — submit interceptado localmente (capture-phase `preventDefault`); mostra o estado de sucesso do Webflow (`.w-form-done`) sem transmitir dados. Endpoints `formdata.webflow.com` / Turnstile (`challenges.cloudflare.com`) nunca são acionados (confirmado: 0 requisições externas).
- **Links sociais/externos** — LinkedIn, `adelt.io`, `mailto:HELLO@FARMMINERALS.COM`: `href` neutralizado para `#` (`data-external-neutralized`), texto visível mantido.
- **Navegação interna** para páginas inexistentes (`/approach`, `/contact-us`, `/products/*`, `/science/*`, etc.) neutralizada para `#` (`data-internal-neutralized`) — single-page autossuficiente, aparência intacta.

## 6. Strings remanescentes (classificadas — nenhuma faz requisição)

- `http://www.w3.org/...` (52) — **namespaces XML/SVG**, exigidos para validade de SVG. Não são rede. **Permitido.**
- `gsap.com`, `webflow.com`, `formdata.webflow.com`, `editor-api.webflow.com`, `challenges.cloudflare.com`, cloudfront — **strings dormentes dentro das bibliotecas de terceiros minificadas** (comentários de licença GSAP; endpoints de form/editor do Webflow acionados só em submit/editor, ambos neutralizados). O teste offline (§1) prova que **nenhuma** dispara requisição durante a navegação.
- `hello@farmminerals.com` (texto visível) — parte do conteúdo de marca, exigido pela fidelidade 1:1; ação `mailto` neutralizada.

## 7. Fronteira pesquisa × produção

Fora do pacote publicável `site/`:
- `recordings/` — vídeo MP4 de referência + metadados (contêm a URL de origem).
- `_capture/` — HTML bruto + manifesto de captura (contêm URLs de origem).
- `scripts/` — pipeline reproduzível.
- `validation/` — screenshots, pares de comparação, `offline-report.json`.

A URL original permanece apenas nesses artefatos de pesquisa e neste relatório.
