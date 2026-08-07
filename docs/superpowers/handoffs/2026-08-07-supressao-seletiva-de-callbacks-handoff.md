# Handoff — supressão SELETIVA de callbacks no seek do editor

> **Decisão do Adilson (2026-08-07):** a regra do editor silencioso passa a
> significar **silenciar só o ciclo de vida** (começo, fim, repetição),
> **deixando o `onUpdate` rodar** para que o site continue desenhando.
>
> **Estado:** nada implementado. O caminho ingênuo (`suppressEvents: true`) foi
> aplicado, auditado, refutado por medição e revertido — ver
> `2026-08-07-seek-silencioso-fork-de-produto.md`. Árvore limpa, suíte no
> baseline (1623). Este documento é o plano do caminho escolhido.

## 1. O que se quer, em uma frase

Quando o editor move o ponteiro da animação (arrastar a barra, ou o replay do
recovery), o site clonado deve **continuar desenhando** normalmente, mas **não**
deve executar os efeitos que ele só executaria numa reprodução de verdade
(começar, terminar, repetir).

## 2. Tabela A — FATOS (medidos, não reabrir)

| # | Fato | Onde foi medido |
|---|---|---|
| A1 | `seekTimeline` (`runtime-bridge-source.js:7475`) é a única das 23 escritas de relógio do bridge que não suprime eventos; as outras 22 passam `true`. | grep corrigido (a forma `?.()` escapava do padrão ingênuo) |
| A2 | Chega ali por `seek-motion`, de dois lugares, ambos instrumentais: arrastar o playhead (`useNativeMotionController.js:1744`) e o replay do recovery (`:736`). | leitura do código |
| A3 | Com eventos ligados, um scrub de 10 posições dispara `onUpdate` 10× **e o `onComplete`** do site. `pause()` sozinho não dispara nada. | `_probe-seek-callbacks.mjs` (GSAP 3.15 real) |
| A4 | Com `suppressEvents: true`, zero disparos, e o valor renderizado do alvo é idêntico (x=37 nos dois caminhos). | idem, com controle de sensibilidade |
| A5 | **Mas** com supressão, animação cujo desenho vive dentro do `onUpdate` **nunca desenha**: propriedade avança para 60, canvas fica sem nada. Padrão real no repo: `Clone/index.html:1159` (sequência de quadros). | `_probe-seek-derived-render.mjs` |

## 3. Tabela B — HIPÓTESES (o desenho depende delas; PROVAR antes de codar)

Nenhuma destas está medida. Cada uma precisa de probe no GSAP 3.15 real, com
controle de sensibilidade, no padrão da frente.

| # | Hipótese | Por que é carregadora |
|---|---|---|
| B1 | Anular `vars.onStart` / `vars.onComplete` / `vars.onRepeat` **impede** esses callbacks, e o `onUpdate` continua rodando e desenhando. | É o mecanismo inteiro. Se o GSAP resolver o callback de um cache interno em vez de reler `vars` na hora, o método cai. (Sabe-se que o `onUpdate` **tem** cache interno — por isso ele é o que fica.) |
| B2 | A restauração devolve `vars` **byte-idêntico**: mesma identidade de função (`===`), mesmas chaves, mesma ordem, mesmos descritores. | A malha de proveniência/token desta frente existe para detectar mudança de forma em `vars`. Restauração imprecisa estala binding e derruba edições legítimas. |
| B3 | Seekar uma **timeline/fachada de stagger** não dispara o ciclo de vida dos FILHOS — ou, se dispara, a supressão precisa cobrir a descendência. | O clone real é cheio de stagger. Se os filhos escaparem, a regra não vale onde mais importa. |
| B4 | O que o ramo **CSS/WAAPI** realmente dispara ao escrever `currentTime` (a spec permite `animationstart`/`animationiteration`/`animationend`). | Achado aberto do Sol. **WAAPI não tem `suppressEvents`** — pode não haver mecanismo, e aí a regra vira "não alcançável ali", explicitamente. |
| B5 | Nenhum consumidor NOSSO dependia dos callbacks de ciclo de vida durante o seek. | O inverso de A5: já queimei uma vez supondo em vez de medir. |

## 4. Desenho proposto (a implementar SÓ depois da Tabela B)

Em volta do seek, e **apenas** durante ele:

1. guardar as referências atuais dos três callbacks de ciclo de vida;
2. removê-las de `vars`;
3. seekar **com eventos ligados** (`suppressEvents` falso) — é isso que deixa o
   `onUpdate` desenhar;
4. restaurar as referências **verbatim**, em `finally`.

Obrigações que o desenho tem que carregar:

- **À prova de exceção**: se o seek ou o `onUpdate` do site lançar, os callbacks
  voltam. Sem isso, um erro do site desliga permanentemente o ciclo de vida dele.
- **Reentrante**: o `onUpdate` do site roda DENTRO da janela e pode disparar
  outro seek. Precisa de contador de profundidade — restaurar só ao sair do
  nível mais externo, e nunca restaurar valor capturado por um nível interno.
- **Escopo explícito**: decidir, com o probe B3 na mão, se a janela cobre só a
  animação seekada ou a descendência. Fachada de stagger é o caso comum.
- **Fail-closed**: se a forma de `vars` não for a esperada (getter hostil,
  protótipo envenenado, callback não-função), **não** mexer — seekar como hoje e
  registrar. Melhor um disparo espúrio do que `vars` corrompido.
- **Nunca sintetizar callback**: não chamar o callback do site por conta
  própria, nem "simular" o que ele faria. Só ligar e desligar o que é dele.

## 5. Critérios de aceitação

1. Arrastar a barra numa animação de sequência de quadros **desenha** cada
   posição (o caso A5 volta a funcionar).
2. Arrastar a barra até o fim **não** dispara o `onComplete` do site (o caso A3
   deixa de acontecer).
3. Depois de um scrub, `vars` está byte-idêntico ao de antes — incluindo
   identidade das funções.
4. Uma exceção lançada de dentro do `onUpdate` do site não deixa callback
   desligado.
5. A inspeção posterior não acusa hazard nem binding estalado (a malha de
   proveniência não pode ser acionada pela janela).
6. Witness próprio no GSAP 3.15 real, no padrão da frente: referência intocada,
   controle de sensibilidade em cada instrumento, dano medido no tick seguinte.
7. Suíte verde e os quatro witnesses (B4/B5/B6/editwrite) batendo.

## 6. Fora de escopo (explícito)

- O ramo **CSS/WAAPI** (B4): investigar e **decidir separadamente**. Se não
  houver mecanismo, a saída honesta é documentar como limitação, não fingir que
  a regra vale.
- Qualquer mudança no comportamento de **Play/Preview** — lá o site dispara
  tudo, é reprodução de verdade.

## 7. Armadilhas desta investigação (para não repetir)

- **Grep cego**: o padrão ingênuo não enxergava a forma `?.()` e não achava a
  própria linha do defeito. Absoluto ("é a única", "não existe") exige
  instrumento verificado.
- **Verde vácuo**: o primeiro check de render comparou 100 com 100 porque os
  tweens anteriores já tinham levado o elemento ao fim — nada se movia.
  Elemento próprio por caso, e assertar que o alvo estava em voo.
- **Teste que não testa**: o primeiro teste apenas verificava que um mock
  recebeu `true`; não observava evento nem desenho reais. Um teste de
  comportamento tem que observar o comportamento.
- **Diff não inclui arquivo novo**: afirmei ao Sol que o probe estava "incluso
  no diff" — não estava. Conferir o que o bundle realmente carrega.
