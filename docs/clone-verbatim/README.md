# O clone verbatim — a régua do projeto

Este é o processo de clone que o Adilson construiu e validou, e que o produto
nunca executou. Está aqui porque vivia em **duas pastas soltas, fora do controle
de versão**, e um `git clean -fd` apagaria a única peça do projeto com prova de
fidelidade.

## O que é

`CLONE_PROMPT.md` — 144 linhas. Não é prompt de uma chamada: é uma **ordem de
trabalho de agente**, em sete etapas.

1. **Gravar um vídeo novo antes de tocar em código** — 1440×1200, DPR 1, zoom
   100%, gravação começando antes do refresh (para pegar o preloader), um único
   scroll contínuo até o fim absoluto, MP4 + arquivo de metadados.
2. **Investigar o site vivo** — HTML, CSS, JS, fontes, Lottie, medidas, estados
   responsivos. A URL é ferramenta temporária de pesquisa, nunca dependência.
3. **Inventariar cada animação** com valores observáveis: duração, delay,
   easing, scrub, pin, stagger.
4. **Baixar tudo** e embutir cópia local de cada biblioteca.
5. **Reproduzir sem reinterpretar** — "não crie um conceito novo, não
   simplifique, não melhore".
6. **Limpar 100% dos vestígios** de proveniência, com varredura recursiva por
   `http://`, domínios de CDN e caminhos absolutos.
7. **Validar** — build local com a rede bloqueada, percorrer a página inteira,
   comparação lado a lado e **quadro a quadro** contra as duas gravações,
   relatórios de independência e de localização.

A etapa 7 é o que separa este processo de todos os motores do produto: eles
terminam quando o modelo devolve HTML; este só termina quando desligar a
internet não muda um pixel.

## O que ele provou (17/jul/2026, farmminerals.com/promo)

| | |
|---|---|
| altura da página | **20.942 px = 20.942 px** (exata) |
| SSIM por posição | 0,956 · 1,0 · 0,842 · 0,999 · 1,0 (média 0,96) |
| requisições externas | **0** |
| recursos locais ausentes | 0 |
| erros de console | 0 |
| referências externas no HTML | **3** — só `www.w3.org`, namespace de SVG, sem rede |
| imagens locais / remotas | **70 / 0** |
| assets baixados | 369 (33 MB) |
| aprovado em | desktop, tablet, mobile |

Comparação, no mesmo site, com o clone que o produto entrega hoje: **178
referências externas**, sendo 164 ao CDN do Webflow — e por isso **72 de 80
imagens quebram dentro do nosso próprio editor**, bloqueadas pela política de
segurança.

## Onde estão as peças pesadas (não versionadas)

- `Clone/` na raiz do repo (153 MB): `dist/` (o clone pronto), `reference/`
  (o vídeo gravado, .webm e .mp4), `qa/` (as comparações visuais), `benchmark/`.
- `~/Desktop/IA/Unspirit-Clone-1to1/` (179 MB): gêmeo idêntico do mesmo
  artefato, com `recordings/`, `validation/` e `_capture/`. É também a fixture
  do editor de animação.

As duas continuam fora do git de propósito — são 300 MB de assets regeráveis.
O que **não** é regenerável é o prompt e os relatórios, e é isso que está aqui.

## Como se perdeu de vista

Em **11/08** três probes confirmaram que este clone existia e mediram que o
produto entregava 8.960 px contra 20.942, perdendo textos inteiros da página.
A conclusão daquele dia foi correta: *"o que falta é o PRODUTOR"*.

Em **12/08** um produtor foi construído — **outro**: captura que preserva o site
em 22 segundos, de graça. Rápido, mas nunca comparado com esta régua, e com as
178 referências externas acima. A troca não foi anunciada ao dono, que só
descobriu em **22/08**. O `CLAUDE.md` registrou como vitória.

## Regra que fica

Nenhum motor automático do produto (native, remake, iter9) passou pela bateria
de validação da etapa 7. Enquanto não passar, não se afirma que algum "é bom" —
compara-se com os números desta página.
