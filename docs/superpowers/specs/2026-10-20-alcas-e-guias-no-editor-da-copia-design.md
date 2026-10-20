# Alças de redimensionar e guias de espaçamento no editor da cópia — design

**Data:** 2026-10-20 · **Ramo sugerido:** `feat/alcas-e-guias` · **Estado:** spec para revisão do Adilson

## 0. Resumo (o que o usuário vai ver)

Ao editar um site no canvas (a cópia editável ou o clone animado), o elemento selecionado volta a ter a **caixa de seleção
com oito quadradinhos** para redimensionar e as **guias rosas de espaçamento** (margem, espaçamento interno, distância
entre itens) do editor antigo — **tudo igual ao antigo**, visual e atalhos incluídos. Cada arraste vira **uma edição só**:
um Ctrl+Z desfaz, e o que foi arrastado continua lá ao reabrir.

## 1. Decisões do Adilson (2026-10-20)

- Prioridade: as alças vêm ANTES da liberação de tablet/celular ("mais importante que a própria timeline").
- **Tudo igual ao antigo na primeira entrega** (todos os quadradinhos, todas as guias, todos os atalhos), visual incluído.
- Caminho técnico aprovado: a camada mora DENTRO da página editada (caminho 1 de 3 — §3).
- Partes 1, 2 e 3 do desenho aprovadas como apresentadas (peças, comportamento, caminho/casos/testes).

## 2. O que existe hoje (medido no código, 2026-10-20)

- **Editor nativo:** a seleção é só um contorno CSS que a ponte põe no elemento (`runtime-bridge-source.js` `installStyles`
  8767-8807; `select` 7256-7272; `hover` 7274-7281, que não avisa o editor de fora). Não há caixa, alças nem guias, e o
  painel não tem campos de largura/altura/margem/espaçamento.
- **Arraste em etapas já existe na ponte e ninguém usa:** `begin/preview/commit/cancel-gesture` (8461-8591).
- **O único arraste vivo é a ferramenta Move** (só no editor de laboratório `/motion-editor`): os eventos do mouse são
  tratados DENTRO da ponte (8841-8940), o valor de prévia vai direto no elemento, e ao soltar sai UMA edição
  (`transaction-committed`, `originatedByRuntime`) que o editor de fora registra com `recordRuntimeTransaction`
  (`useNativeMotionController.js` 965-971: desfazer + salvar).
- **Porta de edição para editores dentro da página:** `window.__uncraftEditorCommit` e `__uncraftEditorCommitBatch`
  (9343+, 9471+): validam e REGISTRAM, mas **não aplicam** os valores (copiam `before`/`value` das entradas) e emitem
  `describe` do 1º elemento do lote — **não servem** para confirmar o gesto (Astra r1 #1, #4). A sonda de prioridade
  (9225) testa cada propriedade sozinha e daria falso conflito no destravar (r1 #2).
- **Caminho de edição do painel:** `applyStyle` → `applyResponsiveEdit` (`useNativeMotionController.js` 1322-1422):
  atualiza a tabela por tela (manifesto responsivo, `beforeEntry/afterEntry`), marca os patches e aplica pela ponte
  (`apply-transaction` → `applyAtomicTransaction`, que aplica tudo e devolve se falhar; `describedTransactionElement`
  preserva a seleção). Ao reabrir, a tabela por tela é reconciliada DEPOIS dos patches salvos (828) — edição que não
  atualizar a tabela some ao reabrir (r1 #3).
- **Trava da cena 3D:** `escritaTravada(el, prop)` (80): na região travada, largura/altura/margem/espaçamento/posição
  são recusados.
- **Editor antigo** (`packages/editor-core/src/editor.js`, 10.918 linhas; `editor.css`): caixa e alças 142-188,
  `getOverlayBox` 297-318, `updateSelBox/HoverBox/ParentBox` 8744-8787, `unlockResize` 10671-10736, arraste das alças
  10738-10830 (compensação W/N 10796-10809), guias 8789-9317 (nove guias, mapas de propriedade/eixo/sentido/espelho/
  grupo, prévia do valor, pílula, campo de digitar 8963-9033, arraste 9035-9157, guias de canto 9160-9220), teclado
  10493-10529 (G, setas), CSS 1747-1994. Ele grava direto no `el.style` com desfazer próprio — por isso NÃO é religado (§3).

## 3. Caminho escolhido

1. **(escolhido) Camada dentro da página editada**, como a ferramenta Move: mesmo espaço do elemento — acompanha
   rolagem, animação e zoom do canvas sem conversão de coordenadas; reaproveita o caminho que já valida, desfaz e salva.
2. Camada por cima, no editor de fora (como o antigo): posição chega com atraso (a caixa escorrega na rolagem) e exige
   converter coordenadas a cada zoom/deslocamento do canvas.
3. Religar o editor antigo inteiro escondendo os painéis: duas seleções, dois desfazer, o arrastado some ao reabrir
   (advise do Sol, 2026-10-19). Rejeitado.

## 4. As peças

### 4.1 Módulo da camada (`lib/motion-editor/runtime-overlay-source.js`)
Módulo próprio (a ponte já tem 9.565 linhas), injetado na página pelo MESMO caminho e na mesma origem da ponte, depois
dela. Fala com a ponte por uma interface interna pequena (§5.1) — nunca pelo `postMessage` do editor de fora.

### 4.2 Isolamento
- Um único elemento raiz `<uncraft-overlay>` no fim do `<body>`, com raiz de sombra **fechada**, `position:fixed`,
  `inset:0`, `z-index` máximo, `pointer-events:none`; só quadradinhos, guias, rótulo e campo de digitar têm
  `pointer-events:auto`. O CSS da camada vive DENTRO da raiz de sombra (estilo do site não alcança; o da camada não vaza).
- Marcado com `data-uncraft-overlay` e **ignorado por todo leitor da página**: escolha de elemento pelo clique e pelo
  mouse, `describe`, lista de camadas, inventário, medições de movimento, leitura de estilos, e qualquer serialização
  (salvar, materializar a cópia). Regra única: um auxiliar `ehNosso(no)` na ponte, usado por todos esses pontos, e um
  teste que FALHA se algum leitor novo enxergar a camada.
- Clique que atravessa uma guia escolhe o elemento por `elementsFromPoint` pulando a camada.

### 4.3 Dona da seleção
A ponte continua dona única da seleção e do modo (edição/visualização/edição de texto). A camada segue a seleção da
ponte; ela não seleciona sozinha (o clique que atravessa a guia pede a seleção à ponte).

### 4.4 Tamanho constante
O editor de fora manda `set-overlay-scale {scale}` (zoom do canvas × escala do aparelho) quando muda; a camada aplica
`--u-escala` e desenha quadradinhos, traços e rótulos divididos por ela (o antigo usava `--rb-guide-scale`).

## 5. Comportamento (paridade com o editor antigo)

### 5.1 Interface camada ↔ ponte
- `selecionado()` → elemento ou `null`; aviso de mudança (seleção, modo, edição de texto).
- `podeMexer(el, gesto)` → `{ ok }` ou `{ ok:false, motivo }` POR GESTO (o conjunto de propriedades que aquele
  quadradinho/guia escreve: destravar + tamanho + compensação, ou os lados do grupo), nunca por propriedade solta. Reúne
  `escritaTravada`, dono da animação sobre os **canais expandidos** (`margin` → 4 lados, `padding` → 4 lados, `gap` →
  `row-gap`+`column-gap`, `inset` → 4 lados; r1 #5) e prioridade avaliada sobre o **estado candidato completo** — todas
  as mudanças do gesto aplicadas juntas, com volta garantida (r1 #2).
- `iniciarGesto(el, gesto)` → guarda os valores INLINE de antes de cada propriedade (o que `readPatchValue` lê) e devolve
  um `gestureId`; a prévia escreve direto no elemento, um quadro por vez.
- `terminarGesto(gestureId, mudancas)` / `cancelarGesto(gestureId)` → §6.2.
- `selecionarEm(x, y)` → pede à ponte a seleção do que está sob o ponto, pulando a camada.

### 5.2 Caixa e quadradinhos
- Oito quadradinhos (`nw n ne e se s sw w`), 12 px, cursores e posições do antigo; rótulo "L × A" acompanhando.
- Caixa leve do mouse, caixa do pai, cores e traços do antigo (`#0095FF` seleção; CSS 1747-1834 portado).
- Arraste começa depois de 2 px; mínimo 20 px; o deslocamento do mouse já está em px da página (sem conversão).
- **Destravar no 1º movimento real** (`unlockResize`): `max-width/max-height:none`, `min-width/min-height:0` no eixo,
  automático/% → px, `flex-grow:0` se o pai é flexível, `box-sizing:border-box`, `overflow:visible` no pai se cortava —
  cada um vira uma mudança DO LOTE (o antigo devolvia a lista para o desfazer; aqui ela entra na transação).
- **Compensação W/N:** puxar pela esquerda/topo mantém o lado oposto: em elemento posicionado (absolute/fixed/sticky/
  relative) soma em `left`/`top`; senão em `margin-left`/`margin-top`.
- Sem `!important`: a cópia não tem regra prioritária (o estilo dela é gerado sem `!important`); onde houver (clone
  animado com CSS do site), a verificação de prioridade de `podeMexer` desliga o quadradinho com o motivo.

### 5.3 Guias de espaçamento
- Nove guias: `mt mr mb ml` (margem, por fora), `pt pr pb pl` (espaçamento interno, por dentro), `gap` (entre o elemento
  e o próximo irmão; muda o PAI; eixo pelo `flex-direction` do pai). Faixas rosas `#FF00DD` hachuradas do antigo.
  Escreve sempre os **longhands**: os lados de margem/espaçamento e, no `gap`, só o do eixo do arraste (`column-gap` em
  linha, `row-gap` em coluna) — o antigo escrevia `gap` (os dois); o efeito visível do arraste é o mesmo.
- A guia de `gap` muda o PAI, mas a seleção continua no filho: a transação não muda a seleção (§6.2.4).
- Arraste depois de 3 px, nunca abaixo de 0; prévia "valor +d" e pílula de aviso.
- **Cmd/Ctrl** encaixa de 8 em 8 · **Shift** os quatro lados do grupo · **Alt** espelha no lado oposto.
- **Guias de canto** quando alguma margem ≥ 2 px: mudam duas margens juntas, com o encaixe de 8.
- **Duplo clique** na guia abre o campo: `20`, `20px`, `rem`, `em`, `%`, `+5`, `-3`; Enter confirma, Esc cancela.
- **Setas** ajustam a guia sob o mouse: 1 px, Shift 10, Cmd 8. **G** mostra/esconde as guias (escutado na página E no
  editor de fora, como a tecla L de seguir links já é).
- **Clique sem arrastar** atravessa e seleciona o que está embaixo.

### 5.4 Desfazer
Cada arraste, valor digitado, toque de seta ou guia de canto = **uma edição**; um Ctrl+Z desfaz cada uma (como o antigo).
Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z e Ctrl+Y com o foco DENTRO da página são repassados pela ponte ao editor de fora
(`commands.undo/redo`), salvo durante a edição de texto ou com o campo de digitar aberto, que mantêm o desfazer do
próprio texto (r1 #6).

### 5.5 Quando não pode mexer
- Região travada pela cena 3D: quadradinhos e guias somem; fica só a caixa (como `rb-sel-locked` do antigo).
- Propriedade dirigida por animação ou prioritária no site: só aquele quadradinho/guia apagado, com o motivo ao passar
  o mouse (mesma regra dos campos travados do painel).

## 6. Caminho das informações

### 6.1 Acompanhar o elemento
Com seleção: um laço por quadro (`requestAnimationFrame`) mede o selecionado, o do mouse e o pai (`getBoundingClientRect`
+ estilo calculado para margem/espaçamento/gap) e reposiciona. Sem seleção, ou página escondida, o laço para.

### 6.2 Ao soltar — o editor de fora confirma, pelo caminho do painel (r1 #1, #3, #4)
1. No início: `iniciarGesto` guarda os valores de antes; a prévia escreve direto no elemento.
2. Ao soltar: a prévia FICA na tela, e a ponte avisa o editor de fora com `overlay-gesture-ended {gestureId,
   mudancas:[{elementId, property, value}]}` — **cada mudança leva o SEU elemento** (o redimensionar pode tocar o filho E
   o pai, ao liberar o corte; o `gap` toca só o pai; Astra r2 #1).
3. O editor de fora monta a edição com um **montador de lote** novo, ao lado de `applyResponsiveEdit`: para CADA par
   elemento × propriedade resolve sozinho a chave da tabela por tela, o `beforeEntry/afterEntry` real, o dono da
   animação e a regra de tela — o `applyResponsiveEdit` de hoje usa `selected.id` e a marca de UMA propriedade para todos
   os patches, e ao reabrir a altura voltaria ao valor antigo (r2 #1). O lote inteiro entra num ÚNICO `applyPatches` →
   um `apply-transaction` com várias propriedades e elementos, levando o `gestureId`. **Escopo de tela:** o mesmo que o painel
   decide para aquela edição na tela atual (hoje `shared`; com a cópia só de desktop da T1, Tablet/Mobile nem abrem) —
   a camada nunca escolhe escopo.
4. A ponte, ao receber o `apply-transaction` com `gestureId`, NO MESMO TURNO: devolve os valores de antes guardados e
   aplica a transação (`applyAtomicTransaction`) — sem pintura entre os dois (sem piscar) e com `before` = o de antes do
   gesto. A emissão usa `describedTransactionElement`: a seleção não muda (no `gap` continua o filho).
5. Recusa (do editor de fora ou da ponte), cancelamento, troca de seleção/modo ou gesto órfão por mais de 10 s: a ponte
   devolve os valores de antes, e a camada mostra a pílula com o motivo.
6. **Estados do gesto (r2 #2):** `ativo` → `aguardando` (depois de `overlay-gesture-ended`) → `confirmado` ou
   `cancelado`, sem volta. A ponte só devolve-e-aplica um `apply-transaction` com `gestureId` se o gesto está em
   `aguardando`; gesto `cancelado`, `expirado`, `confirmado` ou desconhecido → **recusa com o id da transação**
   (`transaction-rejected`, código `gesture_inactive`), para o livro de transações do editor de fora fechar a entrada e
   não travar as próximas. Confirmar desarma o relógio de 10 s. Um `apply-transaction` sem `gestureId` segue o caminho
   de sempre (painel).

### 6.3 Desfazer, refazer, reabrir
Pelo caminho existente: `rollback-transaction` devolve todas as propriedades do lote; ao reabrir, as edições salvas são
reaplicadas pelo replay de sempre. A camada só redesenha.

## 7. Casos difíceis

- Esc, perda de foco da janela, elemento removido/trocado no meio, troca de modo ou de seleção → cancela e devolve.
- Edição de texto ativa e modo Preview → camada escondida.
- Clone animado (site com código vivo): o código do site pode reescrever o que foi arrastado; esta entrega NÃO traz as
  defesas de "reescrita pelo framework" do editor antigo (resíduo, §9). Na cópia editável não há código do site.
- Zoom do canvas muda durante o arraste: não afeta a conta (px da página); só o desenho reescala.
- **Borda da página (diferença assumida em relação ao antigo, r1 #7):** a camada mora dentro da página, então não
  desenha fora dela (o antigo desenhava no editor de fora e podia passar da borda). Perto da borda: o rótulo "L × A" e a
  pílula passam para DENTRO/abaixo da caixa; os quadradinhos são empurrados para ficarem inteiros e clicáveis; as faixas
  de margem que caem fora mostram só a parte visível (rolar a página traz o resto). Elemento maior que a tela mantém os
  quadradinhos nas bordas visíveis.
- Seleção múltipla: fora (não existe hoje).

## 8. Testes

- **Contas (unitários):** novo tamanho + compensação por quadradinho; lista de destravar; guias com Alt/Shift/Cmd e
  cantos; o campo de digitar (todas as formas aceitas e recusadas); setas; mínimo e zero.
- **Navegador real (Playwright, ponte real numa página de teste):** cada gesto produz UMA transação; Ctrl+Z volta tudo;
  reabrir reaplica; Esc devolve; a camada nunca aparece no que é salvo, na lista de camadas, em `describe` nem no
  clique; quadradinho apagado em propriedade animada e sumido na região travada; tamanho constante com escala 0,5 e 2.
  Um teste por achado do Astra r1: (#1) soltar deixa o valor NOVO na tela e o desfazer volta ao de ANTES do gesto;
  (#2) `width:100px; max-width:100px` → arrastar para 150 é aceito (sem falso conflito de prioridade); (#3) com a
  largura já na tabela por tela, arrastar, salvar e reabrir mantém o valor novo; (#4) arrastar a guia de `gap` mantém a
  seleção no filho na ponte E no painel; (#5) animação de `row-gap` no pai apaga a guia de `gap` daquele eixo;
  (#6) Ctrl+Z com o foco dentro da página desfaz o gesto; (#7) elemento colado no topo mostra rótulo e quadradinhos
  inteiros. Astra r2: (#1) redimensionar largura E altura já presentes na tabela por tela, com o pai cortando — salvar e
  reabrir mantém as duas medidas e o pai sem corte; (#2) confirmação que chega DEPOIS do cancelamento (por tempo e por
  troca de seleção) é recusada, nada reaparece, e a edição seguinte do painel passa normalmente.
- **Ao vivo:** a cópia do farmminerals no canvas — fotos lado a lado com o editor antigo no mesmo elemento, item por item
  de §5.2-§5.5; reabrir depois de salvar.
- **Auditoria do Astra** na spec e no código antes de cada commit.

## 9. Riscos e resíduos

- Defesas contra o site reescrever (clone animado com código vivo) ficam fora; se aparecer em uso, viram entrega própria.
- `px` gravado por alça/guia é medida do desktop: quando tablet/celular forem liberados, a regra de tela (§6.2.3) decide
  onde vale — o desenho de telas (spec 2026-10-19) precisa considerar estas edições.
- O laço por quadro custa medir 3 elementos por quadro; medir só com seleção e parar com a página escondida.

## 10. Fora desta entrega

Seleção múltipla, arrastar para reordenar, posição livre (ferramenta Move no canvas), campos de largura/altura/
espaçamento no painel, defesas contra reescrita do site, tablet/celular.
