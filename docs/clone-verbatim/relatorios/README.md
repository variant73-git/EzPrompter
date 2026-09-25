# Farm Minerals Promo — clone local independente

Clone 1:1 da página promocional, com estilos, scripts, fontes, imagens, vídeos, SVGs, animações e bibliotecas armazenados dentro deste projeto.

## Abrir localmente com duplo clique

No Finder, dê duplo clique em `open-site.command`. O inicializador gera o site, escolhe uma porta livre e abre o endereço correto no navegador.

Mantenha a janela do Terminal aberta enquanto estiver usando o site. Para encerrar, pressione `Control+C` ou feche a janela.

Não abra `dist/index.html` diretamente: navegadores bloqueiam recursos e animações carregados por `file://`, resultando em uma página branca.

## Abrir pelo Terminal

```sh
npm install
npm run open
```

A página não precisa de internet para carregar ou funcionar.

## Gerar a versão de produção

```sh
npm run build
npm run preview
```

## Verificar a independência

Com a versão de produção aberta na porta 4173:

```sh
npm run test:offline
```

O teste bloqueia qualquer solicitação fora do servidor local, percorre a página inteira e gera `OFFLINE_QA_REPORT.json`.

## Comparar visualmente com a referência

Com a versão de produção aberta na porta 4173:

```sh
npm run compare:visual
```

O comando captura cinco pontos equivalentes de scroll em 1440 × 1200 px, gera screenshots, overlays e imagens de diferença em `qa/visual-comparison/`, e registra as métricas em `VISUAL_COMPARISON_REPORT.json`.

## Comparar combinações de modelos e custos

```sh
npm run benchmark:pipeline
```

O benchmark avalia as combinações de captura/inventário, implementação e QA/polimento, usando os preços registrados em `benchmark/models.json`. O resultado padrão usa piso de qualidade 0,90 e grava `benchmark/PIPELINE_BENCHMARK.md` e `benchmark/PIPELINE_BENCHMARK.json`.

Para testar outro piso:

```sh
npm run benchmark:pipeline -- --quality-floor=0.92
```

Os valores são estimativas de planejamento. Atualize as tarifas e as taxas de aprovação observadas em `benchmark/models.json` antes de usar o benchmark para orçamento real.

## Arquivos de referência e auditoria

- `reference/farmminerals-promo-live-scroll.mp4`: gravação atual do site original.
- `reference/farmminerals-promo-live-scroll.json`: metadados da gravação.
- `LOCALIZATION_REPORT.json`: relatório dos recursos incorporados.
- `OFFLINE_QA_REPORT.json`: relatório do teste sem dependências externas.
- `VISUAL_COMPARISON_REPORT.json`: comparação de altura e similaridade visual.
- `INDEPENDENCE_REPORT.md`: inventário e aprovação final da entrega autossuficiente.
- `CLONE_PROMPT.md`: prompt revisado para reprodução 1:1 autossuficiente.

O comando `npm run localize` refaz a versão local a partir da captura bruta existente em `.firecrawl/raw-promo.html`. Ele só requer internet caso seja necessário baixar novamente os arquivos da fonte; a versão já gerada e o uso normal do clone não requerem acesso externo.
