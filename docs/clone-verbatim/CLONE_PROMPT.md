# Animated Clone — reprodução exata 1:1 e 100% independente

Analise as duas referências abaixo e reconstrua a landing page com fidelidade visual, estrutural, textual e comportamental 1:1, pixel por pixel.

Referências obrigatórias:

- Site original, disponível apenas como fonte temporária de investigação e extração: https://www.farmminerals.com/promo
- Vídeo fornecido: `/Users/adilsonporto/Desktop/IA/Unspirit/recordings/farmminerals-promo-scroll.mp4`

O site original pode ser acessado durante o desenvolvimento somente para inspecionar HTML, CSS, JavaScript, fontes, imagens, vídeos, SVGs, ícones, Lottie/JSON, estrutura, medidas, estados responsivos, interações e animações, e para baixar os arquivos necessários. A versão final não pode depender do domínio original, de CDNs, APIs, fontes remotas ou de qualquer outro serviço externo para carregar, renderizar, animar ou permitir a navegação da página.

## Etapa obrigatória 1 — gravar uma nova referência antes de implementar

Antes de analisar o código, baixar recursos ou escrever a implementação, abra https://www.farmminerals.com/promo em um navegador desktop e grave um novo vídeo completo da navegação.

Procedimento:

- Use viewport de 1440 × 1200 px, DPR 1, zoom de 100% e navegador Chromium/Chrome, salvo se o vídeo fornecido comprovar outra configuração.
- Comece a gravação antes do carregamento ou refresh para capturar o preloader e toda a animação inicial.
- Aguarde a animação de entrada terminar.
- Faça um único scroll vertical, simples, contínuo, uniforme e sem interrupções, do topo absoluto até o final absoluto da página.
- Não reverta o scroll, não arraste a barra, não use links de navegação e não acione hovers intencionais.
- Permaneça no final tempo suficiente para registrar a animação completa do rodapé e seu estado final.
- Não permita overlays, DevTools, extensões, cursor sobre elementos interativos ou qualquer item que altere ou cubra a viewport.
- Salve o vídeo em MP4 dentro do projeto.
- Salve ao lado um arquivo de metadados com URL, data, navegador, viewport, DPR, zoom, resolução, FPS, duração, altura total da página e distância final de scroll.
- Verifique que o vídeo contém a página inteira, sem quadros ou seções perdidos.

Use conjuntamente:

1. a nova gravação como referência primária do estado atual, da duração, dos pontos de scroll e da coreografia;
2. o vídeo fornecido como referência complementar e para detectar diferenças entre capturas;
3. o site original como fonte temporária de medidas, código e arquivos.

Não comece a reconstrução antes de concluir e validar a nova gravação.

## Etapa obrigatória 2 — investigação e inventário

Antes de implementar, documente:

- estrutura do hero e todas as suas camadas;
- sequência completa do preloader, da entrada e do hero;
- ordem, altura e composição de todas as seções;
- comportamento de scroll e distâncias percorridas;
- estados inicial, intermediário e final de cada animação;
- valores observáveis de duração, delay, easing, scrub, pin e stagger;
- transições entre seções;
- sistema de posicionamento, sobreposição e z-index;
- regras de sticky, pinned, reveal, parallax, scale, fade, clip, mask, wipe e transform;
- lógica de hover, clique, menu, slider, vídeo, formulário e demais interações;
- comportamento desktop, tablet e mobile;
- inventário completo de fontes, imagens, vídeos, SVGs, ícones, Lottie/JSON, scripts e estilos necessários.

Baixe e armazene localmente todos os recursos utilizados pela página. Preserve os arquivos originais sempre que possível; quando um comportamento depender de uma biblioteca, incorpore uma cópia local compatível dessa biblioteca.

## Etapa obrigatória 3 — reprodução exata

Não crie um conceito novo. Não interprete, redesenhe, simplifique, modernize, substitua ou “melhore” nenhuma parte.

Preserve exatamente:

- marca Farm Minerals e CropTab™;
- todos os textos, headlines, subheadings, CTAs, rótulos e mensagens;
- cores, gradientes, opacidades, blend modes, bordas e sombras;
- famílias tipográficas, arquivos de fonte, pesos, tamanhos, tracking e line-height;
- quebras de linha e wrapping;
- imagens, vídeos, SVGs, ícones, recortes, aspect ratios e object-position;
- estrutura, ordem das seções, layout, espaçamento, alinhamento e ritmo visual;
- dimensões, alturas de seção e distâncias de scroll;
- preloader, animação inicial, animações de scroll e estados intermediários;
- timing, easing, scrub, pin, stagger e coreografia;
- smooth scroll, sliders, menus, formulários e demais padrões de interação;
- comportamento responsivo em desktop, tablet e mobile.

Cada elemento visível deve ocupar a mesma posição, no mesmo tamanho de viewport e no mesmo ponto de scroll. Não use placeholders quando o recurso original puder ser extraído. Não aproxime um efeito que possa ser reproduzido a partir do código ou dos arquivos originais.

## Requisito absoluto de independência

A entrega final deve ser autossuficiente e funcionar integralmente em ambiente local sem internet.

É proibido na versão final:

- carregar scripts, CSS, fontes, imagens, vídeos, SVGs, ícones, Lottie/JSON ou qualquer mídia por URL externa;
- usar arquivos diretamente de `farmminerals.com`, Webflow CDN, jsDelivr, unpkg, Google Fonts ou qualquer outro CDN/domínio;
- usar `iframe`, `<base>` remoto, hotlink, proxy em tempo de execução ou fallback remoto;
- depender de APIs externas, analytics, trackers, pixels ou formulários hospedados;
- exigir acesso ao site original depois que a extração terminar.

Todos os recursos e bibliotecas necessários devem existir fisicamente no projeto e ser servidos pelo próprio servidor local. Formulários e interações que originalmente chamavam serviços externos devem reproduzir localmente seus estados visuais e comportamentais, sem transmissão de dados. Links externos devem ser neutralizados ou substituídos por equivalentes locais sem alterar a aparência.

A URL original é uma ferramenta temporária de pesquisa e download, não uma dependência da entrega.

## Limpeza obrigatória de 100% dos vestígios técnicos do site-fonte

Depois de concluir e validar a reprodução 1:1, remova da versão final publicada todos os vestígios técnicos, editoriais e de proveniência que tenham sido herdados do site-fonte e que não sejam indispensáveis para a reprodução visual ou comportamental.

Remova obrigatoriamente:

- JSON-LD, Schema.org, breadcrumbs estruturados e qualquer outro bloco de dados estruturados herdado;
- tags canonical, Open Graph, Twitter Cards e metadados de SEO que apontem para o domínio, páginas ou arquivos originais;
- URLs absolutas do site original, Webflow, CDNs e serviços de terceiros, inclusive quando existirem apenas como strings dentro de HTML, CSS, JavaScript, JSON ou source maps;
- nomes de domínio, caminhos de origem, parâmetros de rastreamento, IDs de analytics, pixels, trackers e endpoints de formulário;
- comentários, cabeçalhos, atributos `generator`, assinaturas de plataforma e metadados de publicação que revelem ou referenciem a origem;
- caches de scraping, HTML bruto baixado, manifests de download, arquivos temporários e relatórios que contenham URLs da fonte da pasta destinada à publicação;
- links `mailto:`, links sociais ou navegação externa como dependência ou ação ativa; preserve o texto visível exigido pela cópia 1:1, mas neutralize a ação externamente conectada;
- referências remotas ocultas em `src`, `srcset`, `href`, `data-src`, `data-icon`, CSS `url()`, `@import`, JavaScript, Lottie/JSON, SVG, vídeos, fontes e fallbacks;
- source maps ou artefatos de build que exponham caminhos, domínios ou código de origem desnecessário.

Não faça uma substituição textual cega. Preserve identificadores internos, classes, atributos e IDs quando forem necessários para CSS, JavaScript, Webflow interactions, GSAP, Lottie ou qualquer animação. Preserve também namespaces técnicos padronizados, como `http://www.w3.org/2000/svg`, quando necessários para a validade ou o funcionamento de SVGs; esses namespaces não são considerados vestígios do site-fonte e não realizam requisições de rede.

Os textos, a marca e os elementos visuais exibidos na interface devem continuar idênticos porque fazem parte da exigência de fidelidade 1:1. A limpeza refere-se aos vestígios técnicos e metadados invisíveis, não ao conteúdo visual que precisa ser reproduzido.

Mantenha a URL original somente no prompt, na gravação de referência e na documentação privada de pesquisa. Esses arquivos devem ficar fora do diretório de produção e do pacote publicável.

Antes da entrega, faça uma varredura recursiva no pacote de produção por `http://`, `https://`, `farmminerals.com`, domínios de CDN, nomes de plataformas e caminhos absolutos da máquina. Classifique cada ocorrência encontrada, remova toda referência de origem dispensável e permita apenas namespaces técnicos comprovadamente necessários. Repita o teste offline após a limpeza.

## Validação obrigatória

- Gere a versão de produção local.
- Execute a página com todas as solicitações externas bloqueadas no navegador.
- Percorra a página inteira, do preloader ao rodapé.
- Confirme zero requisições externas, zero recursos ausentes, zero erros de console e zero avisos críticos de animação.
- Confirme que o pacote de produção não contém JSON-LD, canonical, metadados sociais, URLs do site-fonte, endpoints, trackers, caches de captura ou comentários de proveniência.
- Confirme que imagens, fontes, vídeos, sliders, Lottie, smooth scroll, pins e reveals continuam funcionando sem rede.
- Compare clone e original lado a lado na mesma viewport e nos mesmos pontos de scroll.
- Faça screenshots correspondentes e overlays/diferenças de imagem para localizar desvios.
- Compare a coreografia com as duas gravações quadro a quadro nos momentos relevantes.
- Repita os ajustes até não haver diferenças visuais, tipográficas, espaciais ou de movimento significativas.
- Valide também tablet e mobile.
- Gere um relatório final de independência contendo a lista de recursos locais, o resultado do teste offline e qualquer interação externa que tenha sido neutralizada.

## Entrega

- Landing page completa e production-ready.
- Código limpo, organizado e reproduzível.
- Todos os recursos necessários armazenados localmente.
- Vídeo MP4 da nova gravação e seu arquivo de metadados.
- Relatório de localização dos recursos.
- Relatório do teste offline com aprovação e zero requisições externas.
- Instruções simples para instalar, gerar e iniciar o clone local.

## Resultado esperado

Crie um clone perfeito 1:1 de https://www.farmminerals.com/promo, visual e comportamentalmente indistinguível do original na mesma viewport e posição de scroll, mas tecnicamente autônomo. Depois da captura e do download inicial, desconectar a internet não pode alterar nenhum pixel, impedir nenhuma animação nem quebrar qualquer parte da experiência.
