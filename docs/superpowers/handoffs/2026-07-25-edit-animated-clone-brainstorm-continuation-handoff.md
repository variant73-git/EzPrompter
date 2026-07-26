# Handoff — continuação do brainstorm: editar o clone animado vivo

**Data:** 2026-07-25
**Tipo:** continuação de BRAINSTORM / design de produto e arquitetura, ainda **NÃO implementação**
**Checkout:** `/Users/adilsonporto/Desktop/IA/Uncraft`
**Branch observada:** `main`
**Handoff anterior:** `docs/superpowers/handoffs/2026-07-25-edit-animated-clone-brainstorm-handoff.md`

> **INSTRUÇÃO OBRIGATÓRIA PARA O PRÓXIMO AGENTE**
>
> Continue este trabalho como brainstorm. Se `superpowers:brainstorming` estiver disponível, invoque-a e siga o fluxo de uma decisão por vez. **Não implemente nada ainda.** Primeiro termine as decisões abertas, apresente o design completo ao Adilson e obtenha aprovação. Só depois escreva o spec; só depois do spec aprovado produza o plano de implementação. Não confunda decisões aprovadas com código já existente.
>
> Nenhum arquivo de produto foi alterado nesta sessão. Este documento é o único arquivo novo e serve exclusivamente como handoff.

---

## 1. Objetivo real

Adaptar o editor do Uncraft para editar o **novo clone animado**, que preserva:

- DOM real;
- runtime GSAP / ScrollTrigger / Lottie / WAAPI / vídeo e outros runtimes vivos;
- comportamento e animação originais;
- editabilidade de layout, estilo e motion sem reconstrução por visão.

O novo caminho é diferente do iter9. O iter9 usava prompt + vídeo + assets para reconstruir animações por visão e acabava produzindo uma saída plana. O novo clone mantém o runtime original vivo.

O problema de produto é: como permitir edição visual estável sem estatizar, substituir ou degradar essa animação?

---

## 2. Estado real: decisão, não implementação

O caminho escolhido e as decisões abaixo existem apenas como **design aprovado em conversa**.

Não há, até este handoff:

- implementação do freeze-frame híbrido no canvas;
- spec final dessa integração;
- commit de auto-assentamento;
- integração do motion editor com nós reais do canvas;
- manifesto de controles customizados.

O motion editor existente é real e substancial, mas ainda vive isolado. A integração descrita aqui continua pendente.

---

## 3. Decisões aprovadas e travadas

### 3.1 Modelo C: híbrido

O Adilson escolheu **C — híbrido**:

- padrão: ao selecionar um elemento animado, o editor tenta levá-lo ao seu estado de repouso;
- override: o scrub manual continua disponível para congelar qualquer instante;
- princípio: default inteligente + controle manual sempre acessível.

Não reabrir A versus B versus C sem nova evidência que invalide o desenho.

### 3.2 Edição visual altera o alvo final

Quando o usuário move ou estiliza um elemento animado:

- a edição passa a ser o novo **estado final / alvo da animação**;
- origem, duração e easing são preservados por padrão;
- no replay, a animação termina no novo estado em vez de sobrescrever a edição;
- uma edição comum em `Properties` não cria keyframes escondidos;
- keyframes explícitos continuam disponíveis dentro da superfície `Motion`.

Exemplo aprovado:

```text
Antes: x: -100 -> 0
Usuário move o estado final 40 px à direita
Depois: x: -100 -> 40
```

O scrub manual escolhe o instante visual congelado, mas não implica criação automática de keyframe.

### 3.3 Loops

Loops não têm repouso único. Regra aprovada:

- congelar o frame que estiver visível no momento da seleção;
- não saltar arbitrariamente para o começo ou inventar um estado final;
- manter o scrub disponível para escolher outro ponto do ciclo;
- exibir `Loop` ao lado do elemento na linha da timeline;
- repetir o status no cabeçalho da aba `Motion` quando o elemento estiver selecionado;
- não colocar badge sobre o elemento no canvas;
- edições em loops alteram o estado-base, preservando o movimento relativo ao redor dele.

### 3.4 Organização da superfície

Organização aprovada:

- site animado vivo no centro do canvas;
- painel direito com `Properties`, `Motion` e `Code`;
- `Properties`: texto, layout e estilo;
- `Motion`: timing, easing, playback, loop, tracks e controles específicos;
- timeline encaixada abaixo do canvas, sem comprimir ainda mais a lateral;
- selecionar um elemento sincroniza canvas, inspector e linha da timeline;
- a timeline aparece quando necessária, especialmente ao abrir `Motion`;
- a rota isolada `/motion-editor` deve continuar existindo para desenvolvimento e testes.

O editor isolado atual também possui `Assets`. A decisão de expor ou não `Assets` na integração final do canvas não foi discutida nesta sessão; não assuma remoção nem inclusão.

### 3.5 Reusar o motion editor existente

Decisão aprovada: **reutilizar o projeto existente como motor**, não criar outro editor.

Reusar:

- runtime bridge;
- protocolo;
- Motion IR;
- `MotionPanel`;
- `TimelinePanel`;
- detecção de drivers;
- playback;
- loop / ping-pong;
- grouping;
- keyframes explícitos;
- histórico de patches como conceito.

Criar apenas a integração que falta:

- servir o HTML do nó real com o bridge;
- conectar seleção do canvas ao bridge;
- montar `Motion` no inspector real;
- encaixar a timeline abaixo do canvas;
- implementar auto-assentamento/freeze escopado;
- persistir no nó/snapshot, não no `localStorage` isolado.

### 3.6 Elementos parcialmente visíveis

Regra aprovada:

- qualquer parte visível pode ser clicada diretamente;
- auto-assentamento só dispara com presença significativa: **25% da área ou pelo menos 32 px visíveis**;
- uma borda de 1–2 px não deve causar salto automático;
- elementos grandes continuam elegíveis graças ao mínimo de 32 px;
- seleção pela timeline pode levar o viewport ao elemento e enquadrá-lo;
- a caixa de seleção fica recortada ao viewport;
- painéis do app não contam como área editável.

### 3.7 Persistência

Modelo aprovado:

- cada edição gera patch no manifesto do nó;
- resultado aparece imediatamente no clone vivo;
- autosave em segundo plano com debounce;
- um gesto contínuo de drag vira uma única alteração;
- undo/redo trabalha sobre o histórico da sessão;
- preview usa o manifesto atual mesmo antes de snapshot permanente;
- novo snapshot imutável ao sair de Edit, usar `Save version` ou antes de operação estrutural importante;
- patch recusado pelo runtime não entra no histórico nem aparece como salvo.

### 3.8 Máquina de estados

Modelo aprovado:

1. **Navigate**
   - usuário rola normalmente;
   - scroll e animações respondem durante o movimento.

2. **Edit — Frozen**
   - ao parar de rolar ou selecionar, o viewport congela;
   - somente o elemento selecionado tenta auto-assentar;
   - demais elementos permanecem no frame atual para a composição não mudar sob o cursor.

3. **Preview**
   - remove seleção e overlays temporariamente;
   - reproduz o runtime real;
   - ao terminar, retorna ao mesmo viewport e recongela.

Regras complementares aprovadas:

- scrub atualiza enquanto é arrastado e recongela ao soltar;
- scroll/scrub não descarta alterações;
- loops congelam no frame atual;
- múltiplas animações finitas encadeadas usam o final da sequência como repouso.

---

## 4. Descobertas verificadas no código real do Uncraft

### 4.1 Editor existente

Arquivos principais:

- `packages/web-shell/components/motion-editor/NativeMotionEditor.jsx`
- `packages/web-shell/components/motion-editor/native-motion-editor.module.css`
- `packages/web-shell/lib/motion-editor/runtime-bridge-source.js`
- `packages/web-shell/lib/motion-editor/motion-ir.js`
- `packages/web-shell/lib/motion-editor/motion-groups.js`
- `packages/web-shell/lib/motion-editor/protocol.js`
- `packages/web-shell/lib/motion-editor/native-clone-gateway.js`
- `packages/web-shell/app/motion-editor/page.jsx`
- `packages/web-shell/app/api/native-clone/[...path]/route.js`

Fatos confirmados:

- `MotionPanel` e `TimelinePanel` já são exports reutilizáveis;
- o editor completo ainda concentra controller/state/wiring em `NativeMotionEditor`;
- timeline por chegada já existe;
- a timeline possui playhead, scrub de scroll, intro lane, rows, strip editing, expansão, grouping e keyframes;
- o bridge detecta e controla múltiplos runtimes;
- o IR normaliza drivers de time/scroll/pointer/media/event, timing, easing, tracks, editabilidade e loops;
- gateway injeta o bridge e reescreve paths do bundle;
- rota `/motion-editor` usa bundle configurado em disco, não o snapshot do nó.

### 4.2 Canvas real ainda não está integrado

- `packages/web-shell/components/CanvasInspector.jsx` ainda possui apenas `Properties` e `Code`;
- `packages/web-shell/app/preview/[nodeId]/page.jsx` serve `srcDoc={node.html}` sem o bridge do motion editor;
- o canvas continua usando seu caminho legado de edição;
- persistência do editor isolado usa `localStorage` para patches;
- isso precisa ser substituído/conectado ao manifesto e snapshots do nó.

### 4.3 Freeze antigo não deve ser usado cegamente

`packages/editor-core/src/freeze.js`:

- força estado final global;
- possui comportamento de freeze genérico e específico;
- admite que restauração perfeita pode exigir reload;
- é evidência/conceito reutilizável, mas não deve ser usado como solução inteira para o clone vivo.

Para a nova integração, preferir o controle escopado do bridge, preservando runtime e estado.

### 4.4 Auto-assentamento é tecnicamente real

No bridge, a inspeção de GSAP já consegue levar a animação a `progress(1, true)`, observar o resultado e restaurar o progresso/inline styles. O bridge também pausa animações do elemento. O IR carrega ranges de scroll e timing.

Portanto B/C não dependem de inventar um motor do zero. O trabalho é transformar capacidades existentes em um contrato de edição seguro e persistente.

### 4.5 Testes executados nesta sessão

Foram executados testes direcionados:

```text
components/motion-editor/NativeMotionEditor.test.jsx
lib/motion-editor/motion-ir.test.js
lib/motion-editor/native-clone-gateway.test.js
lib/motion-editor/protocol.test.js
lib/motion-editor/runtime-bridge-source.test.js
```

Resultado observado: **5 arquivos, 81 testes, todos aprovados**.

Isso valida o estado atual do motion editor isolado; não valida a integração nova, que ainda não existe.

---

## 5. A nova decisão aprovada: controles tailor-made para animações específicas

O brainstorm chegou à pergunta: animações classificadas como `Code only` podem receber controles customizados?

O Adilson aprovou a proposta de combinar:

- a filosofia de controles tailor-made do Claude Design / Open Design;
- o runtime bridge e o Motion IR do Uncraft;
- adapters gerados pelo agente somente quando necessário.

### 5.1 Nova escada de editabilidade aprovada

```text
1. Direct
   Controle genérico detectado diretamente pelo Motion IR.

2. Known adapter
   Adapter conhecido de GSAP, ScrollTrigger, Lottie, WAAPI etc.

3. Declarative tweak
   Binding simples por CSS custom property, atributo ou caminho declarativo.

4. Custom runtime adapter
   Adapter tailor-made gerado pelo agente para Three.js, shader,
   runtime proprietário ou lógica específica do site.

5. Code only
   Último recurso, apenas depois que as quatro camadas anteriores
   falharem ou forem consideradas inseguras.
```

`Code only` não deve mais ser interpretado imediatamente como “impossível editar”. Deve significar “ainda não existe binding seguro”.

### 5.2 Princípios de produto aprovados

- controles aparecem nativamente na aba `Motion`, não sobrepostos ao clone;
- agente escolhe somente parâmetros úteis;
- padrão: aproximadamente 3 controles;
- máximo recomendado: 5 por animação ou grupo;
- usar ranges seguros e opções curadas;
- controle deve ser testado no runtime;
- se não produzir efeito real, causar erro ou quebrar layout/animação, não deve ser oferecido;
- controles persistem no manifesto do nó e snapshots, não em `localStorage` do iframe;
- binding declarativo é preferível;
- código customizado roda somente dentro do sandbox do clone e fica vinculado à versão/hash compatível do código;
- não executar JS gerado pelo agente no host principal do Uncraft.

Exemplo de resultado desejado:

```text
Custom controls

Orbit speed       ─────●────  1.4x
Mouse influence   ──────●───  65%
Direction         [ Clockwise v ]
```

### 5.3 Relação com a edição do estado final

- `Properties` altera estado visual/final e não cria keyframes ocultos;
- `Motion` altera comportamento da animação explicitamente;
- controles tailor-made vivem em `Motion`;
- keyframes explícitos e controles específicos podem coexistir;
- uma mudança em controle customizado deve ser undoable, persistível e replayable como qualquer outro patch.

---

## 6. Estudo profundo do Open Design instalado

O Adilson atualizou o Open Design e pediu inspeção do app real em `/Applications/Open Design.app`.

### 6.1 Versão e bundle

- app observado: **Open Design 0.16.1**;
- bundle id: `io.open-design.desktop`;
- bundle assinado/notarizado;
- recursos oficiais empacotados em:
  - `/Applications/Open Design.app/Contents/Resources/open-design`
  - `/Applications/Open Design.app/Contents/Resources/open-design-web-standalone`

### 6.2 Workflow oficial Tweaks

Arquivos mais relevantes:

- `/Applications/Open Design.app/Contents/Resources/open-design/plugins/_official/examples/tweaks/SKILL.md`
- `/Applications/Open Design.app/Contents/Resources/open-design/plugins/_official/examples/tweaks/assets/wrap.html`
- `/Applications/Open Design.app/Contents/Resources/open-design/plugins/_official/examples/tweaks/example.html`
- `/Applications/Open Design.app/Contents/Resources/open-design/plugins/_official/examples/tweaks/open-design.json`

O plugin aparece no app real em `Plugins -> Available -> Tweaks` como workflow oficial bundled e pronto para uso.

### 6.3 Como o Open Design implementa Tweaks

O agente:

1. lê um artefato HTML;
2. escolhe poucos knobs relevantes;
3. transforma hard-coded values em CSS custom properties;
4. envolve o artefato com um painel próprio;
5. conecta controles via JS vanilla;
6. persiste em `localStorage` por identificador do artefato.

Cinco knobs-padrão:

- accent;
- type scale;
- density;
- light/dark mode;
- motion Off/Subtle/Lively.

Regras fortes do skill:

- não oferecer todos os knobs sem necessidade;
- três é o sweet spot;
- máximo cinco;
- presets curados são preferidos a liberdade irrestrita;
- remover controles que quebram o layout;
- respeitar `prefers-reduced-motion`;
- painel fica dentro do HTML do artefato.

### 6.4 O host do Open Design não entende os knobs

O app injeta um bridge no preview que:

- detecta a presença de `.tw-panel`;
- esconde o painel antes do primeiro paint para evitar flash;
- envia `od:tweaks-available`;
- sincroniza `od:tweaks-panel-state`;
- recebe `od:tweaks-panel-visible`;
- mostra uma opção `Tweaks` na UI do file viewer.

O host controla a visibilidade, mas não interpreta cada parâmetro. A lógica e os controles continuam dentro do artefato.

### 6.5 Limite do Open Design para motion

O knob de motion padrão é apenas um multiplicador global:

```text
Off     -> --motion-mult: 0
Subtle  -> --motion-mult: 1
Lively  -> --motion-mult: 1.6
```

Isso é bom para artefatos novos e parametrizados, mas não descobre automaticamente:

- velocidade de uma timeline GSAP específica;
- intensidade de mouse tracking;
- uniforms de shader;
- raio de órbita em Three.js;
- contagem de partículas;
- ranges específicos de ScrollTrigger;
- estado interno de runtime proprietário.

### 6.6 Conclusão comparativa aprovada pelo Adilson

Não copiar o Open Design literalmente.

Adotar dele:

- filosofia de poucos controles tailor-made;
- parâmetros selecionados pelo agente;
- ranges/presets curados;
- validação e remoção de controles frágeis.

Manter do Uncraft:

- painel nativo fora do clone;
- runtime bridge;
- Motion IR;
- known adapters;
- patches, undo e snapshots do nó;
- sandbox para adapter customizado.

Essa combinação foi aprovada pelo Adilson como direção do brainstorm.

---

## 7. Questão parcialmente discutida, ainda não fechada

Antes da discussão sobre `Code only`, foi proposta uma política de conflito:

- propriedade não animada -> patch normal;
- propriedade animada -> último estado da track;
- preservar componentes independentes de transform;
- se várias animações disputarem a mesma propriedade, identificar o owner final;
- se a autoria for ambígua, pedir seleção da track;
- não fingir sucesso em writes não suportados.

O Adilson interrompeu essa pergunta para perguntar sobre controles customizados. Portanto, **não considerar essa política aprovada por inteiro**. Ela precisa ser retomada e atualizada com a nova escada Direct / Known / Declarative / Custom / Code only.

---

## 8. Próximas decisões do brainstorm

Continue uma pergunta por vez. Ordem recomendada:

### 8.1 Contrato de `CustomControlManifest`

Definir conceitualmente, antes do schema técnico:

- escopo: elemento, animação, grupo ou site;
- tipos: slider, toggle, select, curated color, number, curve;
- label, explicação, unidade, min/max/step/default;
- read binding e write binding;
- undo `before` e `after`;
- compatibilidade por snapshot/hash;
- binding kind:
  - CSS variable;
  - DOM attribute;
  - known runtime path;
  - protocol command;
  - sandbox adapter;
- capability e warning;
- teste de efeito real;
- fallback quando binding perde validade.

Primeira pergunta sugerida ao Adilson:

> Quando uma animação não tem controles conhecidos, o Uncraft deve gerar os controles automaticamente ao selecioná-la ou mostrar `Generate controls` para o usuário pedir explicitamente? Minha recomendação: detectar e sugerir automaticamente, mas só gerar o adapter customizado após ação explícita; bindings declarativos seguros podem aparecer automaticamente.

### 8.2 Política de propriedade e conflitos

Retomar a questão da seção 7, agora considerando custom adapters.

Precisamos decidir:

- quem é o owner final quando múltiplas tracks escrevem a mesma propriedade;
- como tratar timelines aninhadas;
- como editar transform composto sem destruir os outros componentes;
- quando pedir escolha explícita da track;
- como representar conflito na UI.

### 8.3 Escopo global versus por elemento

Separar:

- controles globais de site (`density`, global motion, theme);
- controles de elemento/animação (`orbit speed`, `scrub range`, `hover force`).

Pergunta aberta: controles globais vivem em `Properties`, em uma futura aba `Tweaks`, ou dentro de `Motion` quando afetam movimento?

### 8.4 Responsividade / dispositivo

Ainda não discutido:

- patch vale para desktop/tablet/mobile juntos?
- adapter pode ter valores por breakpoint?
- estado de repouso muda por dispositivo?
- snapshot/manifesto precisa de variantes por viewport?

### 8.5 Falhas e degradação

Definir UX para:

- adapter desatualizado após mudança do código;
- binding que perdeu o target;
- controle sem efeito visual;
- erro de runtime;
- runtime que impede leitura do valor atual;
- partial support;
- opção de regenerar ou remover controles.

### 8.6 Aprovação final do design

Depois das perguntas restantes:

1. apresentar o design completo em seções;
2. pedir aprovação explícita do Adilson;
3. escrever um spec em `docs/superpowers/specs/`;
4. pedir revisão/aprovação do spec;
5. só então produzir o plano de implementação com `writing-plans` ou equivalente;
6. não implementar nesta fase sem autorização nova e explícita.

---

## 9. Limites de integração e cautelas

- preservar a rota `/motion-editor` como laboratório;
- evitar reescrever o monólito `NativeMotionEditor.jsx` sem primeiro extrair um contrato/controlador reutilizável;
- não duplicar bridge, IR ou timeline;
- não injetar painel visual dentro do site clonado;
- não usar o `freeze.js` global como solução inteira;
- não manter `localStorage` como persistência de produto;
- não criar keyframes ocultos a partir de edits em `Properties`;
- não prometer edição de `Code only` antes do adapter passar validação;
- não executar código gerado pelo agente no host principal;
- preservar runtime, scroll choreography e fidelity do clone;
- manter editor legado para snapshots estáticos/iter9 quando aplicável;
- antes de implementar, verificar branch, owners concorrentes e worktree atual.

O working tree observado continha vários arquivos/diretórios não rastreados e não relacionados, especialmente `.firecrawl/`, builds Next e materiais auxiliares. Eles pertencem ao usuário/outros trabalhos. Não limpar, mover, commitar nem incluir em mudanças futuras.

---

## 10. Resumo curto para dizer ao Adilson ao retomar

> Retomei o brainstorm do clone animado. As decisões já aprovadas são: modelo C híbrido, edição visual alterando o alvo final, loops congelados no frame atual, integração nativa de Properties/Motion/timeline, reuso do motion editor existente, seleção parcial, autosave + snapshots e estados Navigate/Frozen/Preview. Também está aprovada a direção híbrida para controles tailor-made: filosofia Tweaks do Open Design, mas renderizada no inspector do Uncraft e ligada ao runtime por Direct/Known/Declarative/Custom adapters, deixando Code only como último recurso. Ainda não há implementação nem spec. A próxima decisão é quando e como gerar o `CustomControlManifest`.
