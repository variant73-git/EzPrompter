# Relatório final de independência

## Resultado

A versão de produção em `dist/` foi aprovada para uso local sem internet.

- 0 solicitações externas.
- 0 recursos locais ausentes.
- 0 erros de console.
- 0 avisos críticos de animação.
- 0 URLs remotas, domínios da fonte, metadados sociais, JSON-LD, endpoints externos, caches de pesquisa ou caminhos absolutos da máquina no pacote de produção.
- Altura desktop idêntica à referência: 20.942 px em viewport de 1440 × 1200 px.
- Rodapé alcançado no scroll final de 19.742 px.
- Desktop, tablet e mobile aprovados.

## Recursos locais

O pacote contém 369 recursos locais, totalizando aproximadamente 34 MB:

- 296 imagens AVIF.
- 38 SVGs.
- 9 scripts JavaScript.
- 8 imagens PNG.
- 7 arquivos JSON de animação/dados.
- 6 arquivos de fonte WOFF.
- 3 vídeos MP4.
- 1 imagem JPG.
- 1 folha de estilos CSS.

Todos os nomes publicados são neutros e derivados por hash. O pacote não conserva nomes de hosts, CDNs ou caminhos de origem.

## Interações neutralizadas

- Links externos, sociais, `mailto:` e `tel:` mantêm o texto visível, mas usam ação local neutra.
- Formulários não transmitem dados; o envio exibe localmente o estado visual de sucesso.
- A cópia visível `hello@farmminerals.com` foi preservada por fidelidade textual, com o link neutralizado.

## Identificadores técnicos preservados

Classes `w-mod-*` e atributos internos `data-wf-page` e `data-wf-site` permanecem apenas porque participam da inicialização local das animações. Eles não fazem requisições e foram classificados como identificadores essenciais de runtime. Namespaces `http://www.w3.org/` foram mantidos apenas dentro de SVGs válidos.

## Validação visual

Foram comparados cinco pontos equivalentes de scroll. A altura total coincide exatamente. Três pontos apresentaram SSIM entre 0,99919 e 1,0; os pontos com vídeo/Lottie em execução apresentaram SSIM de 0,956194 e 0,842376 devido à diferença temporal do quadro de mídia, sem desvio estrutural, tipográfico ou espacial observado nos overlays.

## Aviso não crítico herdado da referência

O Chrome registra `Invalid property force3D set to true Missing plugin? gsap.registerPlugin()` tanto no site de referência quanto no clone. O comportamento e as animações permanecem funcionais; o aviso foi classificado como paridade da fonte, não como falha do clone.
