# Uncraft: handoff do roadmap após a Prioridade 0

**Data:** 2026-07-14  
**Branch:** `unspirit`  
**Workspace:** `/Users/adilsonporto/Desktop/IA/Uncraft`  
**Estado do plano:** a Prioridade 0 já foi atacada. Este documento cobre a continuação a partir da P1.

## 1. Objetivo do produto

Uncraft é uma ferramenta de design para a web com três superfícies integradas:

1. Um canvas infinito, com interação previsível para quem usa Figma.
2. Múltiplos sites, imagens, vídeos, prompts, arquivos HTML e `design.md` representados como nós conectáveis.
3. Um editor visual e um agente que capturam, geram, editam, combinam e exportam artefatos reais.

O resultado final não pode ser apenas uma interface demonstrativa. Toda ação visível precisa ter persistência, estados de carregamento e erro, desfazer quando aplicável, autorização no servidor e um resultado que sobreviva ao reload.

O escopo funcional completo continua sendo o prompt de recriação anexado à task original. Decisões aprovadas pelo usuário durante a implementação têm precedência sobre esse prompt.

## 2. Decisões locais que substituem o prompt original

- O produto e a interface estão em dark mode, mas o conteúdo renderizado dentro de cada site mantém suas próprias cores. O tema do shell nunca deve tingir, inverter ou escurecer o HTML do nó.
- A cor de `design.md` é `#EEA665` em frame, porta, tag, corda e demais indicadores de origem.
- As cordas usam a espessura aprovada na implementação atual, 1 px abaixo da versão anterior.
- O inspector recolhido é um controle destacado, a 15 px das bordas superior e direita do viewport, com cantos arredondados.
- O minimap responde dinamicamente à topbar e ao inspector, nunca se sobrepõe a outro controle fixo.
- O minimap atual usa a estrutura funcional anterior, incluindo a faixa de categorias/conexões e o framing sobreposto, mas preserva o fundo `#252522`, borda `#44433E` e `var(--shadow-frost)` da nova linguagem visual.
- O chat usa novamente a versão funcional anterior do PromptDock, com drag, expand/collapse, anexos, URL, brainstorming, modelo, microfone, envio e chat expandido.
- Toda cópia visível ao usuário deve permanecer em inglês e sem jargão de desenvolvimento.
- Não desenvolver nem ampliar os pipelines legados `Mode E`. A reconstrução nova é Iter9.

## 3. Estado atual e ponto de partida

### 3.1 Prioridade 0 atacada

A P0 estabeleceu uma base funcional e visual para o canvas:

- shell em dark mode e port visual da referência para a branch `unspirit`;
- sidebar de projetos, topbar, barra de ferramentas, inspector, zoom, minimap e PromptDock;
- ferramentas Select e Hand com atalhos e estado visual;
- pan, zoom, grid, framing e persistência da visão local;
- seleção simples, marquee, seleção múltipla, group drag e Space para pan temporário;
- criação e movimentação de nós persistidos;
- clipboard do sistema para nós e conteúdo externo compatível;
- duplicação, paste progressivo e placement ghosts;
- undo estrutural para operações já cobertas;
- persistência de boards, nodes, edges e snapshots já suportada pelas APIs existentes;
- correções de cor, ícones, dimensões, connectors, inspector recolhido e posicionamento responsivo do minimap.

“Atacada” não significa automaticamente “encerrada”. A P1 começa fechando os critérios de confiabilidade que ainda não estiverem comprovados por teste E2E.

### 3.2 Funcionalidades que já têm base no repositório

Não reconstruir estes sistemas do zero. Primeiro auditar e estender:

- `packages/web-shell/components/CanvasClient.jsx`: estado e interações principais do canvas.
- `packages/web-shell/components/CanvasNode.jsx`: chrome, edição, snapshots, versões, resize, viewport e estados de geração.
- `packages/web-shell/components/EdgeLayer.jsx`: renderização e interação das cordas.
- `packages/web-shell/components/PromptDock.jsx`: chat, anexos, modelos, microfone e execução do agente.
- `packages/web-shell/app/api/boards`, `nodes` e `edges`: persistência e ownership.
- `packages/web-shell/lib/run-flow.js`: composição de fontes conectadas em um alvo.
- `packages/web-shell/lib/extract.js` e APIs `demarcelize`: extração, reskin e transplant.
- `packages/web-shell/lib/reconstruct.js`: base da reconstrução Iter9.
- `packages/web-shell/app/api/snapshot`: captura estática, manual e handoff.
- `packages/web-shell/app/api/images/generate`: geração de imagens.
- `packages/web-shell/lib/agent` e `app/api/chat`: operador, ferramentas, streaming, confirmação e cancelamento.
- `packages/web-shell/lib/billing`: preços, hold, settlement e ledger.
- `packages/editor-core`: núcleo compartilhado do editor.
- `packages/extension-shell`: extensão, editor injetado e handoff.

### 3.3 Estado operacional

- O script `dev` de `packages/web-shell/package.json` aponta para a porta 3030.
- Nesta sequência de trabalho, o app foi executado manualmente na porta 3031.
- Board usado para smoke test: `/canvas/6038e9c7-fe35-4147-9928-8993a2100311`.
- A rota de canvas exige sessão autenticada. Testes visuais devem usar o navegador com a sessão do usuário.
- O worktree contém alterações não commitadas da P0. Não fazer reset, checkout destrutivo ou limpeza ampla.
- `.firecrawl/variant/` é conteúdo não rastreado preexistente do usuário e não deve ser alterado.

## 4. Ordem recomendada de execução

O encadeamento abaixo é intencional. P1 e P2 formam a base mecânica. P3 a P7 entregam valor de produto. P8 a P10 tornam o sistema vendável e confiável.

| Prioridade | Resultado principal | Dependência |
|---|---|---|
| P1 | Canvas e projetos confiáveis após reload | P0 |
| P2 | Gramática completa de nós, cordas e chains | P1 |
| P3 | Geração de sites em HTML e React | P2 |
| P4 | Editor visual compartilhado nos dois shells | P1, P3 |
| P5 | Captura e clone de URL/imagem com alta fidelidade | P1, P4 |
| P6 | Geração e edição de imagens e vídeos | P2, P8 parcial |
| P7 | Agente conversacional operando o canvas | P2, P3, P6 |
| P8 | Créditos, planos, segurança e abuso | atravessa P3–P7 |
| P9 | Exportação, publicação e continuidade entre dispositivos | P3–P8 |
| P10 | Performance, acessibilidade, observabilidade e release | todas |

## 5. P1: fechar canvas funcional e projetos salvos

### Resultado

Um usuário cria ou abre um projeto, trabalha no canvas e retorna depois sem perder estrutura, posição, viewport, seleção relevante ou histórico suportado.

### Entregáveis

- Auditar CRUD de boards: criar, renomear, abrir, listar e excluir com confirmação.
- Tornar explícito o estado de save: `Saving`, `Saved` e erro recuperável.
- Garantir que move, resize, rename, create, delete, duplicate, paste e connections persistam e reconciliem falhas do servidor.
- Persistir viewport por board. A visão de um projeto não pode vazar para outro.
- Fechar undo e redo para move, resize, create, delete, duplicate, paste, connect, sever e group drag.
- Garantir que undo de delete restaure conteúdo, snapshots e cordas internas.
- Fechar seleção Figma-like: click, shift-click, marquee, Escape, group drag e shortcuts sem interferir em inputs.
- Validar clipboard entre boards e paste de imagem, `.md`, `.html` e URL.
- Cobrir estados vazio, loading, offline, erro, sessão expirada e board inexistente.
- Fazer smoke E2E com reload após cada mutação crítica.

### Critério de saída

Um roteiro automatizado cria dois boards, povoa ambos, move e conecta nós, recarrega a página, troca de board, desfaz/refaz operações e confirma que dados e viewport continuam corretos. Nenhuma ação principal pode existir apenas em estado React local.

## 6. P2: gramática completa de nós, cordas e chains

### Resultado

O grafo deixa de ser decoração. Cada ligação expressa uma operação legível e executável.

### Entregáveis

- Fechar todos os tipos de origem: site, HTML, `design.md`, image/asset, prompt, skill e fallback.
- Usar a cor da origem de forma consistente. `design.md` permanece `#EEA665`.
- Validar portas com hit area generosa, múltiplas entradas e emitter seguindo o cursor em nós altos.
- Manter geometria das cordas e portas em lockstep durante pan e zoom.
- Completar gradiente source→target, marching dots, seleção, reroute, midpoint cut e sever animation.
- Persistir criação e remoção de edge de forma otimista com rollback honesto.
- Inferir a operação pelo par de origens, incluindo restyle, transplant, compose, mutate e extract.
- Implementar `Extract to` quando uma corda termina no canvas vazio.
- Layout de chains por dependency depth, sem sobreposição e ancorado à seleção.
- Duplicar e copiar uma seleção mantendo somente as cordas internas apropriadas.
- Executar um alvo agrupando fontes por tipo em uma chamada de conteúdo.
- STOP precisa abortar, restaurar o estado anterior e não criar uma versão parcial.

### Critério de saída

Uma matriz de testes cobre todos os pares de origem suportados. Um designer consegue entender o que acontecerá apenas pela direção, cor, labels e preview da operação. Reload preserva o grafo e o histórico de execução.

## 7. P3: geração de websites em HTML e React

### Resultado

Um pedido no dock ou em um prompt node produz um site real, editável, versionado e exportável, nunca um card vazio ou uma promessa textual.

### Entregáveis

- Criar blank website como alvo azul funcional.
- Transformar pedidos em briefs melhorados e editáveis dentro de prompt nodes.
- Gerar chains em tempo real, ancoradas ao nó selecionado quando houver contexto.
- Suportar HTML como formato de execução e snapshot primário.
- Adicionar um caminho React explícito: projeto, componentes, estilos, assets e dependências permitidas.
- Manter o preview isolado em iframe e o shell dark mode fora do conteúdo.
- Integrar mobile, tablet e desktop ao mesmo artefato e persistir o viewport escolhido.
- Salvar toda geração ou edição como nova versão do nó.
- Cancelar, tentar novamente e restaurar a versão anterior sem perda.
- Aplicar house style, style absorption e deterministic ground truth em toda geração.
- Oferecer export HTML e React sem artefatos do editor.

### Critério de saída

Os fluxos “create a fintech landing page”, “apply this design.md”, “use this screenshot as style” e “turn this site into a React project” produzem artefatos executáveis, recarregáveis e exportáveis. O agente entrega o artefato, não apenas a estrutura do grafo.

## 8. P4: editor visual compartilhado

### Resultado

O mesmo editor funciona dentro de um nó capturado e diretamente em um site pela extensão.

### Entregáveis

- Consolidar `packages/editor-core` como fonte única. Evitar forks de comportamento entre shells.
- Seleção por profundidade, hover/click idênticos, Escape por ancestral e breadcrumb.
- Layers panel lazy com hover bidirecional, visibility, rename, sections e assets.
- Inspector completo para container, typography, appearance, fill, stroke, effects e links.
- Campos numéricos com drag e input, nunca permanecendo vazios ou inválidos.
- Fill sólido, gradiente, image fill, effects gallery, biblioteca de cores e eyedropper.
- Spacing guides, resize handles, inline text editing e smart text cascade.
- Minidocks de imagem e texto, incluindo replace e smart edit.
- Undo/redo de todas as operações de editor.
- Done cria snapshot limpo. Cancel oferece discard/save. Reset original continua disponível.
- Coordenadas e eventos funcionam entre documento host e iframe, considerando escala.
- Editor CSS isolado nos dois sentidos e resistente a handlers capture-phase do site.

### Critério de saída

O mesmo conjunto de fixtures é editado no canvas e na extensão. Os documentos finais são equivalentes, sem CSS/DOM do editor, e o histórico restaura cada operação.

## 9. P5: captura, clone e reconstrução

### Resultado

Qualquer URL ou screenshot suportado vira material editável com um estado honesto para cada rota de ingestão.

### Entregáveis

- Estabilizar captura estática gratuita com UA realista, lazy hydration, inline CSS, URL absolutization, viewport pinning e scripts removidos.
- Garantir que challenge pages nunca sejam persistidas como conteúdo.
- Finalizar detecção de sites animados e escolha explícita antes de Iter9.
- Iter9 com scroll stops, asset manifest, rasterização, probes determinísticos, thumbnails, uma chamada vision e progress stages reais.
- Handoff da extensão com token HMAC de 5 minutos, vinculado a user, node e URL.
- Manual capture pela extensão com escolha ou criação de board.
- Clone de imagem para site com isolamento da UI real, pixel color sampling e crop-and-embed conservador.
- Snapshot estático como padrão no canvas. Iframe ao vivo somente em edit ou version preview.

### Critério de saída

Testar uma página estática, uma Webflow/Framer animada, uma URL com challenge, uma página autenticada via extensão e um screenshot de UI. Cada uma entra pela rota correta, com stages e cobrança corretos.

## 10. P6: geração e edição de imagens e vídeos

### Resultado

Imagem e vídeo são nós de primeira classe, com variantes, progresso, persistência, custos e uso como fonte em chains.

### Entregáveis de imagem

- Consolidar adapters de provedores atrás de uma interface uniforme.
- Prompt-to-image, edição, variações, upscale quando suportado e background removal quando suportado.
- Preservar aspect ratio natural e dimensões do asset node.
- Salvar original, versões, prompt, provider, model, seed e custos relevantes.
- Permitir usar imagem como asset, inspiração, layout ou clone de site.

### Entregáveis de vídeo

- Definir o contrato de vídeo antes da UI: text-to-video, image-to-video e duração/aspect ratio suportados.
- Implementar jobs assíncronos com polling ou streaming, cancelamento e retry.
- Mostrar thumbnail, duração, status real e preview seguro no nó.
- Persistir arquivo, poster, prompt, provider, model, custo e lineage.
- Permitir vídeo como asset em websites sem montar players pesados durante gestos do canvas.
- Criar fallback explícito para provider indisponível ou job expirado.

### Critério de saída

Imagem e vídeo sobrevivem ao reload, podem ser duplicados, conectados, versionados, baixados e usados em um site. Cancelamento não cobra e não deixa nós presos em loading.

## 11. P7: agente conversacional operando o canvas

### Resultado

O PromptDock funciona como ponto de entrada para trabalho real no grafo, com contexto visual e ferramentas observáveis.

### Entregáveis

- Separar operador barato e conteúdo escolhido pelo usuário.
- Manter picker pequeno, honesto e aplicado a todas as chamadas de conteúdo.
- Passar imagens multimodalmente e anexar screenshot atual de site selecionado.
- Tratar upload sem texto como placement, sem inferência desnecessária.
- Completar safe tools e destructive tools com ownership.
- `create workflow` monta a chain inteira e a mostra surgindo em tempo real.
- Tool chips exibem status, confirmação, skip, erro e resultado sem truncamento horizontal.
- Caps: soft pause, hard cap, retry budget e wall timeout.
- Cancelamento se propaga imediatamente.
- Persistir threads, messages, runs, tool calls, tokens e custos.
- Nunca anunciar intenção sem executar. Nunca entregar nós vazios como substituto do artefato.
- Manter eval suite de first move e traps antes de trocar o operator model.

### Critério de saída

Uma suíte canônica cobre geração, restyle, extract, clone from image, edição, ambiguidade real, ação com seleção e read-before-carve. Cada run pode ser reaberto depois do reload com seu histórico correto.

## 12. P8: créditos, planos, segurança e abuso

### Resultado

Todas as operações pagas têm estimativa, hold atômico, settlement pelo custo real e refund integral em falha.

### Entregáveis

- Consolidar pricing por operação e multiplicadores aprovados.
- Exibir estimate antes de clone, vídeo, geração e reconstrução cara.
- Saldo ao vivo, ledger legível e animação transitória de débito no nó.
- Typed insufficient-credits error com estimate e balance.
- Plans/upgrade modal e checkout/webhook idempotentes.
- Welcome grant com defesas anti-farm e orçamento mensal global.
- Ownership em todo endpoint mutante e toda ferramenta do agente.
- Rate limits por operação real, não por iteração interna do agente.
- Handoff tokens curtos e origin-scoped messaging.
- Sandbox de HTML, scripts removidos, secrets somente no servidor e secret scanning.
- Observabilidade suficiente para diferenciar falha de ambiente, provider, modelo e produto.

### Critério de saída

Testes concorrentes provam que não há saldo negativo nem cobrança dupla. Toda falha após hold devolve o valor. Capture simples continua gratuita e Iter9 nunca inicia sem confirmação.

## 13. P9: exportação, publicação e continuidade

### Resultado

O trabalho sai do Uncraft e a mesma conta continua acessível em outro dispositivo.

### Entregáveis

- Export HTML com assets e caminhos válidos.
- Export React com projeto reproduzível e instrução curta de execução.
- Download individual de imagens, vídeos, `design.md` e snapshots.
- Share link somente leitura com autorização explícita.
- Publicação opcional de site somente depois de export local confiável.
- Lista de projetos e chat acessíveis em layout mobile.
- No mobile, priorizar abrir projeto, conversar com o agente, revisar resultados e aprovar operações. Edição espacial completa pode continuar desktop-first.
- Sincronizar estado de threads e runs entre dispositivos.

### Critério de saída

HTML abre localmente sem o Uncraft. React instala e executa em ambiente limpo. Uma run iniciada no desktop pode ser revisada e confirmada no mobile com a mesma conta.

## 14. P10: qualidade de release

### Resultado

O produto permanece fluido, acessível e diagnosticável com projetos reais.

### Entregáveis

- Aplicar a fluidity doctrine: zero re-render/layout read no hot path de gestos.
- Snapshot de site por padrão e parking de conteúdo pesado fora da tela.
- Testes com 50 sites e graphs grandes em diferentes níveis de zoom.
- Dot grid em canvas, dots em device pixels inteiros e chrome counter-scaled quantizado.
- Pausar motion não essencial durante gestos e respeitar reduced motion.
- Navegação por teclado, foco visível, labels e contraste dos controles do shell.
- Browser matrix para Chrome atual e extensão MV3.
- Logs estruturados, métricas de latência/custo/falha e alertas para filas e providers.
- Backups, migrations reproduzíveis e rollback documentado.
- Smoke suite de produção para auth, boards, capture, generation, billing e export.

### Critério de saída

Os budgets de gesto, geração e erro são medidos e monitorados. Nenhum release avança apenas porque o build passou; os smoke tests funcionais e visuais também precisam passar.

## 15. Gates obrigatórios em cada prioridade

Cada prioridade só deve ser considerada pronta quando passar estes cinco gates:

1. **Persistência:** o resultado sobrevive ao reload e à troca de board.
2. **Falha honesta:** erro, retry, cancel e rollback estão visíveis e testados.
3. **Ownership e custo:** mutações pertencem ao usuário correto e cobranças são seguras.
4. **Performance:** a mudança não entra no hot path de pan, zoom, drag ou resize sem medição.
5. **Prova E2E:** existe um roteiro reproduzível no browser, além de testes unitários.

## 16. Estratégia de implementação

- Começar cada prioridade com um audit curto de código, schema, rotas e testes existentes.
- Fatiar por fluxo vertical, não por camada. Exemplo: “criar blank website e vê-lo após reload” inclui UI, API, banco, erro e teste na mesma fatia.
- Manter mudanças pequenas e verificáveis. Não misturar refactor amplo com feature de produto.
- Reusar `editor-core`, provider adapters, billing context e APIs de ownership existentes.
- Não reescrever prompts de transplant ou generation sem eval comparativo.
- Preferir deterministic ground truth a mais instruções de prompt.
- Quando uma base existente estiver parcial, escrever primeiro um teste que demonstra a lacuna.

## 17. Próximo pickup recomendado

Começar por **P1, confiabilidade após reload**:

1. Executar a suíte atual e registrar o baseline.
2. Criar um smoke E2E para dois boards com viewport diferente.
3. Validar create, move, resize, connect e reload.
4. Fechar a primeira inconsistência encontrada com rollback e teste.
5. Adicionar redo à mesma arquitetura de undo antes de expandir o conjunto de operações.

Somente depois desse roteiro ficar verde, avançar para a matriz de operações da P2.

## 18. Checklist de handoff para a próxima sessão

- Ler este documento e o prompt completo de recriação.
- Ler `DESIGN.md` e respeitar as decisões locais que substituem o prompt.
- Confirmar branch e `git status`; preservar mudanças do usuário.
- Não tocar em `.firecrawl/variant/`.
- Confirmar qual porta está ativa. O script padrão usa 3030; a sessão visual usou 3031.
- Rodar testes antes de editar.
- Usar browser autenticado para validar o board real.
- Não declarar uma prioridade pronta sem cumprir os cinco gates.

