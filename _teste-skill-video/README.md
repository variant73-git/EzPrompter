# Experimento: video-to-superprompt vs clone Uncraft

Teste da skill [`MengTo/Skills → video-to-superprompt`](https://github.com/MengTo/Skills/blob/main/agent-skills/codex/video-to-superprompt/SKILL.md)
no farmminerals.com/promo, replicando o teste original do Adilson (vídeo gravado
do site + prompt → clone), agora automatizado.

**Objetivo permanente (regra do produto):** baratear o clone e aumentar a
velocidade ao máximo **sem perder qualidade**. Referência a bater: clone native
= 24s, SSIM 0,987–1,000, animações vivas (item 183).

## Protocolo (desenho anti-contaminação)

1. `node record.mjs <url> out/` — grava vídeo de scroll humano (Playwright,
   1280×720) e extrai frames a 1 fps. **Só o vídeo sai daqui** — nenhum DOM,
   asset ou CSS é lido (senão o teste vira o iter9 de novo).
2. Agente A (com acesso SÓ aos frames) segue a skill à risca: análise em
   camadas → superprompt no template deles (`superprompt.md`).
3. Agente B (builder, **cego**: recebe SÓ o superprompt — sem frames, sem URL,
   sem memória do site) constrói `rebuild/index.html` single-file.
4. Medição: screenshots do rebuild vs frames do original lado a lado
   (`comparison/`), tempos por etapa, estimativa de custo em tokens.
   Julgamento final é VISUAL (lição 179: medir versus mostrar).

## Estado

- [x] Harness validado neste container (gravação + frames OK na test-page local)
- [ ] **BLOQUEADO: política de rede da sessão é allow-list** — farmminerals.com
      e CDNs retornam 403 no CONNECT do proxy. Precisa liberar no environment:
      `www.farmminerals.com`, `farmminerals.com`, `cdn.prod.website-files.com`,
      `farm-minerals.b-cdn.net`, `fonts.googleapis.com`, `fonts.gstatic.com`
      — OU o Adilson anexa um vídeo gravado do site (30–60s, scroll lento).
- [ ] Rodar experimento + relatório

## Notas do ambiente

- Chromium: `/opt/pw-browsers/chromium` (via `executablePath`).
- ffmpeg do Playwright (`/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux`) é build
  enxuto: **sem mjpeg, sem filtro `fps`** — usar PNG + `-r 1`.
- O snapshot `.firecrawl/farmminerals-promo.html` NÃO serve de stand-in:
  zero `<script>` (sem GSAP) e assets todos em CDN bloqueada.
