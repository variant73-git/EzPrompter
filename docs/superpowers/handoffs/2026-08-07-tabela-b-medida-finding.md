# Finding — Tabela B medida (supressão seletiva de callbacks no seek)

> **Estado:** ZERO código de produção. **Auditoria fechada com MERGE OK do Sol na
> rodada 13** (12 achados dele, todos procedentes e corrigidos com medição; 1 meu).
> **As três decisões de produto foram tomadas pelo Adilson em 2026-08-07** e estão
> marcadas ✅ ao lado de cada uma. Este documento fecha a Tabela B do
> handoff `2026-08-07-supressao-seletiva-de-callbacks-handoff.md` com medição no
> GSAP 3.15 real.
>
> **Rodada 1 auditada pelo Sol: 5 achados, TODOS confirmados por medição** — quatro
> apontavam erro meu, e um deles (o achado 1) **derruba a obrigação central** que
> eu tinha escrito. O texto abaixo já é o corrigido; a §6 registra o que caiu.
>
> Instrumentos: `_probe-b1-null-lifecycle.mjs` (14 casos),
> `_probe-b3-descendencia.mjs` (9 casos), `_probe-b1b-audit.mjs` (11 casos, um por
> achado da rodada 1), `_probe-r2-repeat-timeline.mjs` (bloqueador da rodada 2) e
> `_probe-r3-stagger-em-timeline.mjs` (travessia composta), todos em
> `packages/web-shell/`. Suíte no baseline: **1623 passed | 10 skipped**.

## 1. Veredito da Tabela B

| # | Hipótese | Veredito | Evidência |
|---|---|---|---|
| B1 | Anular o ciclo de vida impede o disparo e o `onUpdate` segue desenhando | **SUSTENTADA para `onStart` e `onComplete`, com uma fronteira medida**: um callback volta a disparar se o slot DELE receber uma função **antes do ponto de despacho dele** naquele render — medido para `onComplete` reinstalado pelo `onUpdate`, e **independente da identidade da função**. Reescrever depois do despacho, ou escrever outra chave, **não** reabre (ver N5) | C2/C3 (com **pré-render suprimido** antes da janela, e `preRenderMoveu` provando que houve render): `onStart=0 onComplete=0`, `onUpdate=10`, desenho derivado chega a 100. B2 (audit): no tween **já renderizado**, levado de volta ao início, o `onStart` **volta a disparar** sem janela (controle=1) e **não dispara** com ela (0) — é isto que prova a supressão do `onStart`, não o C9 |
| B1 (`onRepeat`) | idem para `onRepeat` | **SUSTENTADA no motor; a rota do produto é OUTRA** | No MOTOR: `tl.time(1.5/2.5/0.2, false)` sobre uma timeline com filho `repeat: 2` dispara o `onRepeat` do filho **1, 2 e 3 vezes**, e com a janela na descendência, **0** (com pré-render nos dois braços e disparo de volta depois do restore). ⚠️ **Correção trazida pelo witness da implementação (2026-08-07):** pelo caminho REAL do bridge quem é seekado é sempre um **tween**, nunca a timeline — o registro de motion vem de animações que têm alvo, e a duração publicada é a da **iteração** (1000 ms medidos). Logo a justificativa "é alcançável ao seekar a timeline" vale para o motor e **não** para o produto de hoje. O callback fica na lista e **tem cobertura própria**: um filho cujo `onRepeat` é despachado pelo render do pai é silenciado pela janela da descendência (vitest com procedência medida — tirar `onRepeat` da lista deixa o teste vermelho). A perda do span repetido no scrub é problema separado, do resolver/relógio do bridge |
| B2 | A restauração devolve `vars` idêntico | **REFUTADA nas duas formas ingênuas; sustentada só na janela ciente de `hasOwn`** | ver §2 |
| B3 | Seekar a fachada não dispara o ciclo de vida dos FILHOS | **REFUTADA** | T2: timeline, janela só na fachada → filhos vazaram. E1 (audit): **`stagger` em forma de OBJETO dá callback PRÓPRIO a cada filho** (2 de 2) e a janela só na fachada **vaza os 2**. O veredito anterior ("para stagger a fachada basta") valia só para `stagger: <número>` |
| B3 (cobertura) | Cobrir a descendência silencia sem matar o desenho | **SUSTENTADA só com a travessia da §4.2** — as DUAS versões anteriores vazavam (a do texto original: 1 nó de 5, 2 disparos; a da r3: 4 nós de 5, 1 disparo pela timeline interna) | T3 (filhos diretos), T7 (timeline **aninhada**: neto silenciado e ainda desenhando), T8 (callback herdado por `defaults` é **copiado** para a `vars` do filho na criação), F1 (tween de **duração zero** de um `.set()` está no traversal e é silenciado). ⚠️ H1: uma **fachada de tween** (stagger) **não tem `getChildren`** — a travessia passa por `.timeline` |
| B4 | O que o ramo CSS/WAAPI dispara | **NÃO MEDIDA** — fora de escopo por decisão do handoff §6 | — |
| B5 | Nenhum consumidor NOSSO depende desses callbacks no seek | **PARCIAL — só a metade que foi buscada** | O que ESTÁ estabelecido: nosso código **não instala** callback de ciclo de vida em animação do site. Busca em `app/ components/ lib/ hooks/`, **todos os arquivos** (sem filtro de extensão), por `onComplete\|onStart\|onRepeat\|onReverseComplete\|onInterrupt\|eventCallback` → os únicos acertos de GSAP são 4 linhas de `runtime-bridge-source.js`: a lista `GSAP_CONFIG_VARS` (:494), os `*Params` (:505-506) e o **strip** ao clonar no unchain (:5787); o resto é `onStartEdge` do canvas, sem relação. O progresso é lido por rAF (`monitorTimeline`) e o estado emitido explicitamente após o seek. ⚠️ **O que NÃO está estabelecido**: dependência **indireta** — nosso código reagindo a um EFEITO que o callback do site produz. Isso não se resolve por busca; exige **witness comportamental** e fica como obrigação da implementação |

## 2. B2 — a forma de anular (o achado que derrubou a obrigação central)

Eu tinha escrito: *"anular por atribuição (`= undefined`), nunca por `delete`"*.
**Está errado**, e as duas formas ingênuas falham:

| forma | o que quebra | medido |
|---|---|---|
| `delete vars[k]` | a chave reinserida vai para o **fim** — a ordem muda | C2: `…onUpdate,onReverseComplete,overwrite,delay,onStart,onComplete,onRepeat` |
| `vars[k] = undefined` | quando a chave **não existia**, a atribuição **cria propriedade própria** e o `finally` a mantém com `undefined` — a forma muda **para sempre** | A1: for-in ganha `onStart` e `onRepeat` que o autor nunca escreveu |
| `vars[k] = undefined` | quando o callback é **herdado do protótipo**, cria uma **sombra própria** que também permanece | A2: callback herdado **dispara** (1) e a janela deixa `própria = [true,true,true]` |

A janela que funciona guarda, por chave: `hasOwnProperty`, o **descritor completo**,
e se o valor vinha do protótipo. Na saída, `defineProperty` de volta o que era
próprio e **apaga a sombra** do que não era. Medido (A3): forma restaurada nos
dois casos (`for-in` e `hasOwn` idênticos), e o herdado **fica silenciado dentro
da janela** — a sombra proposital é o que o silencia.

> Isto importa porque a malha desta frente compara a forma de `vars`
> (`gsapVarsCollateralState`, `runtime-bridge-source.js:4004`) para decidir se um
> binding ainda vale — e ela percorre `for..in`, então uma chave nova entra na
> conta.

## 3. Fatos NOVOS (não estavam na Tabela B)

### N1 — o ciclo de vida tem um QUARTO callback, e ele dispara no caminho do bridge
`onReverseComplete` dispara ao seekar para 0 **na forma exata do call-site**
(`pause()` + `time(0,false)`), **mesmo sem o site ter revertido nada**
(C1 do audit: `semReverse=1`, `siteRevertido=1`). A janela de três não o cobre
(C5: 1); a de quatro cobre (C11: 0, com o `onUpdate` seguindo).
→ ✅ **DECIDIDO pelo Adilson (2026-08-07): ENTRA.** A lista de silêncio passa a ter
**quatro**: `onStart`, `onComplete`, `onRepeat`, `onReverseComplete`. Razão: ele é
alcançável na forma mais simples possível do call-site (tween solto, seek para 0),
sem timeline e sem estado revertido — deixar de fora seria arbitrário.
(`onInterrupt` não foi medido e nada se afirma sobre ele.)

### N2 — `vars` PARTILHADO vaza a janela para uma animação VIZINHA (hazard CONDICIONAL)
O GSAP guarda a **referência** do objeto do autor (T6: `twB1.vars === twB2.vars`),
então um site que reusa a config faz duas animações partilharem o MESMO `vars`.

⚠️ **As duas primeiras medições NÃO estabeleciam o dano** (achado 4 do Sol, aceito):
T6 avançava a "vizinha" com uma escrita manual de relógio — isso é um seek, não
um vizinho seguindo a vida dele; e T9 manteve a janela aberta por 600 ms para o
ticker rodar, quando **na produção a janela é síncrona e o ticker não intercala**.

O dano existe pela rota que o Sol prescreveu, e foi medido (G1): a janela aberta
no alvo, e o **`onUpdate` do site avançando o vizinho de dentro dela** — controle
sem janela `1`, com janela `0`. O vizinho perde o `onComplete`, e a restauração
não o devolve.
→ **Hazard condicional**, não sistemático: exige partilha de `vars` **e** uma rota
reentrante do próprio site.
→ ✅ **DECIDIDO pelo Adilson (2026-08-07): FAIL-CLOSED.** Ao detectar que o `vars`
é alcançável por outra animação, **a janela não abre** — o seek se comporta como
hoje naquela animação. Abre-se mão da regra numa fatia dos sites em troca de nunca
estragar a vizinha. Coerente com a postura da frente: sem garantia, não mexe.

### N3 — o GSAP relê `vars` na hora do disparo, inclusive depois do primeiro render
Trocar `vars.onComplete` **depois** do primeiro render faz disparar a função NOVA
(C10: original `0`, nova `1`); idem para `vars.onUpdate`. A premissa do handoff
("o `onUpdate` tem cache interno") **não é o que este instrumento observa**. Não
prova que não exista cache em outro caminho — prova que a troca em `vars`
prevalece no caminho do seek.

### N4 — a reentrância só estraga numa das duas implementações
- **Salvo em variável LOCAL da chamada** (C12): o seek aninhado disparado de
  dentro do `onUpdate` **se cura sozinho** (`tiposDepois = function×3`).
- **Salvo num SLOT COMPARTILHADO do módulo** (C13): as duas restaurações devolvem
  `undefined` e o site fica **sem ciclo de vida para sempre**.

→ A obrigação não é "contador de profundidade": é **o salvo pertence à chamada**.

### N5 — o site pode DISPARAR dentro da janela, instalando de dentro do `onUpdate`
Este é o furo real da abordagem, e ele tem duas faces.

**(a) Escape da supressão — medido, reproduzido.** A janela anula os callbacks
**uma vez**, na entrada. O `onUpdate` do site fica vivo lá dentro (é o objetivo),
e pode instalar um `onComplete` novo com `tween.eventCallback('onComplete', …)`,
que escreve em `vars`. Como o GSAP **relê `vars` na hora do disparo** (N3), a
função nova roda **no mesmo seek**, antes do `finally`: controle sem janela
`novaDisparou=1`; **com a janela, também 1**. A original fica em 0 nos dois casos.
→ E o limite **não é a identidade do callback**: medido também o braço em que o
site reinstala **exatamente a mesma função** que estava lá na entrada — ela
dispara igual (`originalDisparouNaJanela=1`).

**E a fronteira também foi medida, com controle de sensibilidade em cada braço**
(a 1ª versão desta medição deu zero VÁCUO — o seek nem dava oportunidade de
despacho; e a 2ª chamava `invalidate()`, que reinicializa e mediria outro
caminho): `onStart` num tween **já inicializado e devolvido ao início sem
invalidate** — controle **1**, reinstalação comprovada (**2×**) e, com a janela,
**0**; `onComplete` controle **1**, braço POSITIVO que reescreve
o próprio slot **1**, braço NEGATIVO que escreve só uma chave sem relação **0**. O
enunciado que a medição sustenta é: **um callback dispara se o slot DELE receber
uma função antes do ponto de despacho dele naquele render** — medido para
`onComplete` reinstalado pelo `onUpdate`, independente da identidade da função.
Outros callbacks e outros momentos exigiriam braços próprios. Anular uma vez
não fecha esta classe: fechá-la exigiria interceptar a **instalação** (ex.: um
accessor em `vars` durante a janela) — o que muda o descritor e colide de frente
com a obrigação §4.1. É um fork de desenho, não um detalhe.

**(b) A restauração sobrescreve a troca legítima do site.** No mesmo cenário, o
`finally` devolve a função ANTIGA por cima da que o site acabou de instalar
(medido: "quem ficou em `vars` depois da janela = a original"). Restaurar
comparando o valor corrente resolve **(b)**, mas **não** resolve **(a)** — o
disparo já aconteceu.

## 4. O que isso obriga no desenho (§4 do handoff)

1. **Anular ciente de `hasOwn`**: guardar descritor + procedência (própria vs
   herdada), `defineProperty` de volta o que era próprio, **apagar a sombra** do
   que não era. Nem `delete` cru, nem `= undefined` cru.
2. **A janela cobre a DESCENDÊNCIA com travessia RECURSIVA que trata `.timeline`
   como NÓ, não como atalho para os filhos dele.** Três medições encadeadas:
   - `getChildren(true,true,true)` **não basta** — numa timeline que contém uma
     fachada de stagger ela alcança **1 nó**, e os filhos internos **vazam 2
     disparos** (r3).
   - descer nos **filhos** do `.timeline` alcança 4 nós e ainda **vaza 1
     disparo**, porque a **própria timeline interna** nunca entra na lista e um
     callback instalado nela escapa (r5, bloqueador do Sol reproduzido).
   - visitar `an.timeline` **como nó** alcança 5, silencia tudo (0), preserva o
     desenho (medido como **deslocamento renderizado**, 20 → 100, não como
     contagem de `onUpdate`), e depois do restore voltam exatamente as contagens
     do controle.
   
   ⚠️ **A cobertura vale para a descendência EXISTENTE na entrada da janela.** A
   travessia é um snapshot, e o `onUpdate` do site fica vivo lá dentro — ele pode
   criar um descendente novo (achado r7 do Sol). Medido: um filho criado dentro do
   render **não é renderizado na mesma escrita de relógio** (0 disparos) — ele
   dispara na **seguinte** (1), que é outro seek, com travessia própria; nos dois
   arranjos testados o escape **não se reproduziu** (0). Isto vale para a
   construção medida (inserção em posição já ultrapassada); **não** é uma garantia
   geral do GSAP sobre inserções em qualquer posição. **Residual anotado, com esse
   alcance.**

   ⚠️ A travessia precisa de **`Set` de visitados**: o `.timeline` de um filho
   aponta de volta para o pai, e sem ele a descida entra em laço. Regra final:
   para cada nó, `getChildren(true,true,true)` quando existir; senão, descer em
   `.timeline`; sempre marcando visitados.

3. **A janela tem que ser tão estreita quanto a escrita de relógio.** Enquanto
   aberta, a forma de `vars` diverge; se `emitTimelineState` — ou qualquer
   inspeção — rodar lá dentro, publica-se forma divergente e estala binding.
   **Leitura de código, não medição** (as funções da malha vivem dentro da IIFE do
   bridge): vira witness na implementação.
4. ✅ **Partilha de `vars` (N2): FAIL-CLOSED** — detectar e não abrir a janela.
5. ✅ **A lista de silêncio tem QUATRO**: `onStart`, `onComplete`, `onRepeat`,
   `onReverseComplete`. O `onRepeat` fica com cobertura própria: o render do pai
   despacha o `onRepeat` de um filho, e a janela da descendência o silencia.
   ⚠️ A rota "seekar a timeline" **não existe no bridge de hoje** — ele sempre
   seeka um tween, clampado à iteração (ver §1).
6. **O estado salvo pertence à chamada** (N4).
7. ✅ **N5 — DECIDIDO pelo Adilson (2026-08-07): ACEITAR como residual
   documentado.** Interceptar as reposições fecharia o escape (a), mas exigiria
   alterar a FORMA do `vars`, que é exatamente o que a malha de proveniência desta
   frente vigia — o remédio derrubaria edições legítimas. A promessa do produto
   passa a ser: **silencioso, salvo se o próprio site repuser a reação no meio do
   arrasto**. A face (b) (restauração por cima da troca do site) **é** para ser
   resolvida: restaurar comparando o valor corrente, sem sobrescrever o que o site
   escreveu.
8. **Witness comportamental para o B5** — a busca exclui instalação, não
   dependência indireta; sem o witness, "nenhum consumidor nosso depende" segue
   sendo meia prova.

## 4b. Residuais da implementação (SHIPPED em 2026-08-07)

A janela está implementada (`withSeekLifecycleSilenced`, acima de `seekTimeline`),
com auditoria do Sol. Três coisas ficam explicitamente ABERTAS:

1. **Animações destacadas são invisíveis ao inventário.** A detecção de partilha
   usa `gsap.globalTimeline.getChildren(...)`. Uma animação que o site removeu do
   relógio global mas continua dirigindo por conta própria (a rota reentrante do
   N2) **não aparece** ali — se ela partilhar `vars` com um nó do escopo, a janela
   abre e o dano do N2 acontece. Não há registro autoritativo de animações no
   GSAP; fechar isso exigiria o bridge manter o próprio. **Residual aceito.**
2. **O fail-closed é POR NÓ**, não pelo seek inteiro — decisão do Adilson de
   2026-08-07, com a consequência conhecida: dentro do mesmo arrasto, uma parte
   pode reagir enquanto as irmãs ficam quietas.
3. **Nenhum seek roda enquanto a janela MEXE em `vars`** (`seekMutating`) — nas
   DUAS fases, instalar os temporários e restaurar. `defineProperty` e `delete`
   acionam traps de `Proxy` do site; um seek disparado de dentro de um trap
   instalaria um callback ENTRE a nossa decisão e a nossa escrita, e a escrita
   seguinte o apagaria (TOCTOU simétrico). A guarda cai apenas em volta da
   escrita de relógio, que é onde o site precisa rodar. Recusar é fail-closed —
   perde-se um seek patológico, não uma reação do site. Procedência medida nas
   duas fases: sem a guarda, os testes de `Proxy` ficam vermelhos.
4. **Remoção indistinguível ressuscita a reação.** Se o site fizer
   `vars.onComplete = undefined` dentro da janela — removendo a própria reação —
   isso produz EXATAMENTE o estado do nosso temporário, e a restauração devolve o
   callback antigo, que pode disparar depois. Medido e fixado por teste.
   **Residual aceito** (fechar exigiria a interceptação recusada).
5. ⚠️ **B5 (§4.8) SEGUE ABERTO.** O witness prova que o `onUpdate` continua
   desenhando, **não** que nenhum consumidor NOSSO dependia indiretamente de um
   efeito do ciclo de vida. Enquanto esse witness não existir, B5 é PARCIAL e a
   feature não pode ser declarada fechada.

## 5. Adjacência aberta (não medida, não afirmada)

**Colateral do clamp (fato, fora deste fork):** o bridge sempre seeka um **tween**
e clampa à duração da **iteração**, então a régua de uma animação com `repeat`
percorre só uma iteração — o resto do ciclo não é alcançável pelo scrubber, nem
quando o tween está dentro de uma timeline (medido no witness da implementação:
duração publicada 1000 ms para um filho `repeat: 2` de span 3 s). Não é o assunto
deste fork; é do resolver/relógio do bridge.

A régua do editor **rola a página**. Rolar é outro caminho, e ScrollTrigger tem
callbacks próprios (`onEnter`/`onToggle`/…) que este fork não toca. Se a regra de
produto é "o editor é silencioso", esse caminho é uma segunda frente — **não** foi
medido aqui.

## 6. O que caiu nesta rodada (armadilhas, minhas e do instrumento)

**Pego pelo Sol — rodada 12 (1 bloqueador, procede):**
- **O controle do `onStart` passava por `invalidate()`**, que reinicializa — logo
  media um caminho de lazy-init e não o que o texto afirmava ("já inicializada,
  devolvida ao início"). É a MESMA distinção que já tinha mudado resultados duas
  vezes nesta sessão. Removido: controle segue 1, a reinstalação é comprovada
  (2×), o teste segue 0.

**Pego pelo Sol — rodada 11 (1 bloqueador, procede — zero vácuo de novo):**
- **A "fronteira" que eu tinha acabado de medir era zero vácuo**: o tween ia de
  0.05 a 0.5, então o `onStart` não tinha ponto de despacho e o `onComplete` nunca
  cruzava o fim. Os dois zeros eram compatíveis com "não havia callback devido".
  Refeita com oportunidade de despacho real e **controle por braço** (onStart 1/0;
  onComplete 1 / positivo 1 / negativo 0). Terceira vez nesta sessão que produzi
  um zero sem controle — é o meu modo de falha dominante.

**Pego pelo Sol — rodada 10 (1 achado, e desta vez a favor da cautela):**
- **Eu tinha generalizado o hazard**: escrevi "toda escrita em `vars` reabre o
  disparo", quando o medido era escrita no slot do `onComplete` **antes do ponto
  de despacho dele**. Em vez de só reescrever a frase, medi a fronteira: reinstalar
  o `onStart` depois do despacho dele, ou mexer numa chave que não é de ciclo de
  vida, **não** reabre (0). A fronteira virou fato, não redação.

**Pego pelo Sol — rodada 9 (1 achado, confirmado por braço novo):**
- **O escopo que eu tinha acabado de escrever ("callbacks presentes na entrada")
  ainda excedia a medição.** O site pode reinstalar a **mesma função** da entrada
  e ela dispara. O limite é o **slot ter permanecido anulado**, não a identidade
  do callback. Duas rodadas seguidas estreitando o mesmo veredito — e a segunda
  só apareceu porque o Sol atacou a minha própria correção.

**Pego pelo Sol — rodada 8 (1 bloqueador, REPRODUZIDO — e é substantivo):**
- **A supressão tem furo, e o meu D1 não o teria achado nunca**: ele media QUEM
  sobrava em `vars` depois da janela, não se a função instalada lá dentro havia
  DISPARADO. Contando instalação e disparo separadamente, a nova dispara dentro
  da janela (1), igual ao controle sem janela (1). O veredito de B1 passou a ser
  escopado à entrada da janela, e N5 virou fork de desenho.
- Forma do erro: **medir o estado final quando a pergunta é sobre o que aconteceu
  no meio**. O estado final estava certo (a original voltou) e escondia o evento.

**Pego pelo Sol — rodada 7 (1 achado, procede em princípio; alcance medido é
menor que o alegado):**
- **A travessia é um snapshot** e o `onUpdate` vivo pode criar descendente novo
  dentro da janela. Verdade estrutural. Mas o escape **não se reproduziu**: o
  filho criado durante o render só é renderizado na escrita de relógio SEGUINTE,
  que carrega travessia nova. O veredito foi qualificado ("descendência existente
  na entrada") e o residual anotado com o alcance exato do que foi medido.
- Colateral útil: o **pré-render suprimido inicializa sem rodar o `onUpdate` do
  site** (`criouNoPreRender=0`) — é por isso que ele serve de pré-render sem sujar
  as contagens.

**Pego pelo Sol — rodada 6 (1 bloqueador, procede — e é a armadilha que este
próprio documento lista):**
- **Controles vácuos no probe da travessia**: os três braços de teste reusavam os
  mesmos dois elementos, e o primeiro já os deixava em `x=100` — então
  `preRenderMoveu` (`x > 0`) passava sem nada ter se movido, e um braço poderia
  inicializar `100 → 100`. Além disso, "preserva o desenho" contava chamadas de
  `onUpdate`, que é o instrumento errado. Corrigido: **elemento próprio por
  braço**, pré-render que exige `moveu E não chegou ao fim`, e desenho medido por
  **deslocamento renderizado** (20 → 100). Cometi de novo, no mesmo documento em
  que a armadilha está escrita.

**Pego pelo Sol — rodada 5 (1 bloqueador, reproduzido número a número):**
- **A travessia corrigida na r3 ainda vazava**: ela descia nos FILHOS do
  `.timeline` mas nunca incluía a **própria timeline interna** como nó, e um
  callback instalado nela dispara dentro da janela (controle 1, com a travessia
  antiga 1, com a corrigida 0, e 1 de novo depois do restore). Duas correções
  seguidas da mesma obrigação — o sinal de que eu estava consertando instância em
  vez de enunciar a regra.

**Pego pelo Sol — rodada 4 (2 achados, procedem):**
- **O probe da travessia composta tinha o MESMO lazy-init** — eu fechei a classe
  nos outros probes e não neste, que foi escrito antes da lição. Corrigido:
  pré-render suprimido nos dois braços + verificação de que, depois do restore,
  voltam exatamente as contagens do controle (2 filhos + 1 fachada).
- **B5 estava marcado SUSTENTADA contradizendo o próprio texto**, que já admitia
  não excluir dependência indireta; e os padrões buscados eram estreitos.
  Rebaixado para **PARCIAL**, com a busca refeita sem filtro de extensão sobre
  `app/ components/ lib/ hooks/`.

**Pego pelo Sol — rodada 3 (1 bloqueador, procede):**
- **O braço de teste do `onRepeat` abria a janela ANTES do primeiro render** do
  filho — então o zero provaria "inicializou sem callback", não supressão. É a
  MESMA assimetria de lazy-init que eu tinha corrigido para o `onComplete` (C9) e
  não apliquei aqui. Corrigido: os dois braços pré-renderizam, e o disparo volta
  depois do restore. O veredito não mudou, mas antes ele não estava sustentado.
  **Fechado como CLASSE, não instância**: todo braço que afirma zero (C2, C3, T3,
  T5) passou a pré-renderizar de forma SUPRIMIDA — que inicializa sem sujar as
  contagens — com uma asserção `preRenderMoveu` provando que o render aconteceu.

**Pego pelo Sol — rodada 2 (1 bloqueador, reproduzido):**
- **`onRepeat` É alcançável, e eu tinha concluído o contrário.** Provei a
  inalcançabilidade num tween repetido seekado DIRETAMENTE e generalizei para "o
  caminho do bridge". Mas o bridge também seeka **timeline**, e aí o filho
  repetido é renderizado além da 1ª iteração: 1, 2 e 3 disparos. O erro de forma é
  o de sempre — **prova sobre um objeto não promove o claim para outro**
  (lição do item 176, cometida de novo).

**Pego pelo Sol — rodada 1 (5 de 5 confirmados por medição):**
- **A obrigação central estava errada** — `= undefined` só restaura idêntico
  porque o probe construiu o caso favorável (todos os callbacks presentes como
  propriedade própria). Chave ausente ou herdada quebra.
- **"idem" escondia o que não foi medido** — o C9 não provava supressão de
  `onStart` (ele já tinha disparado antes da janela) nem de `onRepeat`.
- **`onRepeat` foi medido por `totalTime()`**, que o bridge não chama; por
  `time()` ele nem é alcançado.
- **"caminho EXATO do call-site" (C8) é falso** — é um microprobe que repete a
  FORMA das duas chamadas num tween solto; não passa por `seek-motion`,
  `seekTimeline`, resolução de animação nem pela posição da janela em relação ao
  `emitTimelineState`. Fica como microprobe; o de verdade é witness da
  implementação.
- **N2 não estava montado** — o "vizinho" era seekado por mim, e a janela de 600 ms
  do T9 não existe na produção síncrona. A rota reentrante (G1) é que estabelece.

**Pego por mim (o único achado de CLAIM que o self-review pegou):**
- **A obrigação de travessia que eu mesmo escrevi vazava.** Antecipando a rodada 3,
  medi o caso composto do clone real — fachada de stagger DENTRO de timeline — e
  `getChildren(true,true,true)` do pai não enxerga os filhos internos do stagger.
  A travessia tem que ser recursiva e descer no `.timeline`.

**Pego por mim, no instrumento:**
- **O caso medido não era o caso do usuário**: a 1ª versão abria a janela num
  tween que nunca tinha renderizado (o GSAP inicializa lazy). Corrigido em C9/C10.
- **Controle de desenho mal escrito**: usar o ÚLTIMO valor desenhado acusa
  "instrumento cego" num seek pra trás legítimo. Passou a usar o MAIOR.
- **Controle e teste no MESMO tween** (C4/onRepeat) — verde path-dependent, a
  armadilha do item 175. Passou a ter um tween por braço.
- **Hazard herdado sem medir** (N4): eu ia herdar do handoff a obrigação
  "contador de profundidade"; medindo, quem quebra é só o slot único.

**Lição de método desta sessão:** o self-review pegou 3 falhas de INSTRUMENTO e,
das falhas de CLAIM, só uma — e essa veio de **procurar o caso composto que a
minha própria regra não cobria**, não de reler o texto. As outras 6 vieram do
segundo fornecedor (5 na r1, 1 bloqueador na r2). É o resultado do item 176 de
novo: reler o próprio texto não pega overclaim; medir um caso que a regra não
prevê, sim.
