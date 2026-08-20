# Relatório — video-to-superprompt (MengTo/Skills) vs clone Uncraft

**Data:** 2026-08-20 · **Alvo:** farmminerals.com/promo · **Protocolo:** vídeo-only,
builder cego (recebeu SÓ o superprompt; sem frames, sem URL, sem repo).

## Pipeline executado

| Etapa | Ferramenta | Tempo | Saída |
|---|---|---|---|
| Gravação (scroll humano) | `record.mjs` (Playwright, sessão com rede aberta) | ~2 min (vídeo de 72s) | `out-farm/site.webm` + 74 frames 1fps |
| Análise em camadas + superprompt | Claude vendo 26 frames | 5,6 min | `superprompt.md` (13 seções, mecanismos nomeados) |
| Build cego | subagente (GSAP local, zero rede) | 24 min · 142k tokens | `rebuild/index.html` (991 linhas) |
| Captura + comparação | `shots.mjs` + `montage.mjs` | ~3 min | `shots/` + `comparison/pair-*.png` |
| **Total (vídeo → página comparada)** | | **~35 min** | |

Custo estimado em API (fora de assinatura): análise ~40k tokens de visão +
build 142k ≈ **US$ 0,7–1,2 em modelo classe-Sonnet** (3–6× isso em classe-Opus).

## Referência a bater (nosso native clone, item 183)

22–24 s (captura medida em dev, farmminerals — handoff 2026-08-10: iter9 177s ×
native 22s) · custo de LLM **zero neste caminho** (capture-bundle.js não tem
nenhuma chamada de modelo — interceptação Playwright pura) · SSIM 0,987–1,000 ·
156 tweens + 51 ScrollTriggers **vivos e editáveis** · assets reais.

⚠️ Retificações pós-review do Adilson (2026-08-20): (a) os **35 min** do
experimento incluem 24 min de builder-agente isolado — custo do PROTOCOLO
(anti-contaminação), não da skill; executada como fluxo manual (vídeo + prompt
em 1 geração) a skill leva **~3–8 min**, competitiva com o iter9 (177s).
(b) "custo zero de IA" vale SÓ para o produtor native; os demais caminhos de
clone do produto pagam IA e levam minutos (iter9 ~US$0,10–0,25; estático =
Gemini 18–110s; imagem = GPT-5.5). (c) 22–24s é o MOTOR isolado, não o fluxo
completo do produto — native é recente e roteado por razão; quem cai no iter9
não vê os 24s. Pendência aberta: medir o fluxo real de ponta a ponta e conferir
o roteamento (mesma classe do achado 179: "o nó era roteamento").

## Resultado qualitativo (pares em `comparison/`)

**O que a skill acertou (surpreendente para vídeo-only):**
- Estrutura completa: 13/13 seções na ordem certa, copy praticamente verbatim
  (extraída dos frames), paleta beige/oliva/sage fiel, grid de hairlines,
  tipografia na escala certa.
- Mecanismos de motion identificados E implementados: preloader concêntrico,
  wipe de colunas, line-rise, scramble-in, cena d'água pinada com scrub,
  marquee que sobrevive à virada beige→verde, máscara-logo escalando, ledger
  com count-up, carrossel, demo interativa.

**Onde ela para (teto estrutural, não de execução):**
- **Identidade visual inventada**: a marca (folha de 5 pétalas) virou uma flor
  genérica; fotos (batatas, repolho, vacas) viraram gradientes/blobs; o 3D
  fotoreal virou CSS. É uma re-encenação com figurino próprio, não um clone.
- Bugs de render no rebuild: nav roxa por blend-mode em seções, tablet
  rotacionado 45° na água, label duplicada no pacote.
- Zero verificação: a skill termina no prompt; ninguém compara com o original.
- SSIM aqui seria ruído — a comparação honesta é visual, par a par.

## Veredito

- **Mais simples?** Sim — um markdown + ffmpeg.
- **Mais barato/rápido que nosso clone?** **Não.** Native: 24s e ~zero custo de
  IA. Skill: ~35 min e ~US$1 por tentativa, sem assets reais e sem runtime.
- **Melhor?** Não para clone. **Boa para o caso que não cobrimos**: referência
  em vídeo sem URL acessível (site atrás de login, app, motion reel). Como
  fonte de *inspiração* no canvas, o motor já existe (análise de frames do
  iter9); faltaria só aceitar vídeo externo como entrada.
- Confirma a tese dos teardowns: pipelines descrição→regeneração batem no teto
  de fidelidade sem DOM/runtime/verificação — exatamente o quadrante onde o
  Uncraft é o único.

**Objetivo permanente registrado:** baratear o clone e aumentar velocidade ao
máximo **sem perder qualidade** — esta skill não move essa fronteira para o
clone; pode mover para *referência externa por vídeo* (frente opcional).
