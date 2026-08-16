# B1 (transplante) — probes de MOTOR 1–7: fatos (2026-08-06)

> Executa a lista de probes pré-design do advise do Sol (2026-08-06, consulta 2).
> GSAP 3.15 real (fixture Unspirit), referência intocada NA MESMA PÁGINA (mesmo
> ticker ⇒ igualdade byte-a-byte esperada), asserção de vida, números com
> typeof/finitude explícitos. Controle de sensibilidade nos probes 2, 3 e 7
> (posição errada, copy-once, mutante de ordem pura); probes 1 e 4–6 são
> snapshots de fato/paridade SEM controle negativo próprio — o que eles
> estabelecem está calibrado abaixo, sem "sensibilidade por probe" global
> (estreitamento do audit Sol r1). Probes 8–12 da lista (hazard/
> token, re-exposição, teardown/replay, 4 lanes, convivência B4–B6) exigem o
> caminho de escrita REAL do bridge — não cobertos aqui; ver §4.
>
> Arquivos: `_probe-b1-topology.mjs` · `_probe-b1-wrapper-nested.mjs` ·
> `_probe-b1-clock.mjs` · `_probe-b1-order-callbacks.mjs` ·
> `_probe-b1-props-writer.mjs` · `_probe-b1-roundtrip.mjs` — todos **0 RED**.
>
> Assinatura comum: `gsap.to('.sel', { x, [opacity,] duration:1, ease:'none',
> stagger:0.2, paused:true })` — stagger simples, sem modificadores, top-level,
> 3 alvos, midflight `totalTime(0.7)` salvo indicação. Fato de UMA assinatura
> não promove outra (doutrina 173).

## 1. Topologia (probe 1)

- Fachada de stagger = tween com `timeline` interna (`Timeline`), 3 filhos,
  `parent === inner` em todos os estados; startTimes 0/0.2/0.4; ordem 0/1/2;
  1 alvo por filho; duração do filho 1, da fachada 1.4.
- Flags do inner: `smoothChildTiming=false`, `sortChildren=true` (`_sort`).
- **Init é lazy**: pré-render `_initted=false` (fachada E filho); midflight true.
- Float real: `child.totalTime()` em fachada-0.7 = `0.49999999999999994` (não
  0.5) — igualdade byte-a-byte entre trajetórias vale porque AMBOS os lados
  carregam o mesmo float.

## 2. Forma física: wrapper ANINHADO confirmado no núcleo (probes 2–3)

Cirurgia provada: `remove(child)` do inner → `wrap = gsap.timeline()` →
`wrap.add(child, 0)` → `inner.add(wrap, startTime-congelado)`.

- **Instante byte-igual** (50=50); irmãos intactos.
- **Linhagem de clock por construção**: fachada arrasta o filho aninhado
  byte-igual à referência — clock manual E ticker real (playheads bit-iguais:
  `0.362`, `0.21299999999999986`), play/reverse/restart. Endurecido no audit
  r1: reverse assertado com playhead RECUANDO (não só A===R); restart SEM
  seek corretivo (o `totalTime(0)` posterior da v1 forçava o resultado).
- **Ponto de controle próprio**: `wrap.pause()` congela SÓ o alvo (irmãos
  seguem a fachada); `wrap.totalTime(x, true)` scruba SÓ o alvo sem tocar o
  playhead da fachada.
- **Resume = salto**: despausar o wrapper com a fachada adiante rende o tempo
  derivado do pai (`smoothChildTiming=false`) — sem projeção de continuidade.
  Fato pro design do freeze/settle, não defeito.
- **timeScale é linhagem, não valor**: TS autoral pré-transplante e setter
  POSTERIOR do site são herdados pelo aninhado por construção (byte-igual em
  ticker real, a1 em voo). CONTROLE: externo com TS copiado no instante
  diverge quando o setter muda depois (76.1 vs 100) — copy-once detectável,
  logo refutado como técnica.
- **Pause posterior da fachada** congela o aninhado junto (zero drift em 120ms
  de relógio de parede).
- **Contraste externo**: com transplante EXTERNO (P5), a fachada tocando NÃO
  arrasta o filho (congela em 50 enquanto a referência avança) — externo
  exigiria adaptador contínuo de clock; aninhado não.
- Sensibilidade: wrapper na posição errada (+0.1) visível já no instante
  (40 vs 50).

## 3. Duração, ordem, callbacks, writer, round-trip (probes 4–7)

- **Duração intacta** ao aninhar primeiro/meio/último: `duration/totalDuration/
  inner.duration` byte-iguais (1.4) — aninhar o ÚLTIMO não encurta o fim.
- ⚠️ **MESMO startTime não preserva ordem no remove+add**: `stagger:{each:0}`
  → [a0,a1,a2] vira [a0,a2,a1] após round-trip ingênuo (previsto pelo advise).
  Consequência de design: rollback congela posição ordinal/predecessor E o
  fingerprint compara a CADEIA (`_first→_next`), não o array ordenado; OU o
  gate B1 exige startTimes distintos. O comparador do probe 7 DETECTA o caso
  (sensibilidade provada).
- **Cirurgia não vaza callback DE FACHADA** (0 fires com renders suprimidos;
  contadores em onStart/onUpdate/onComplete — escopo estreitado no audit r1: o
  shape B1 não tem callback autoral por-filho, e onRepeat sem repeat seria
  contador vácuo; callback-bearing por-filho é obrigação da chave futura).
- **Paridade de onComplete** com wrapper dentro: mesma contagem (1), mesmo
  playhead de disparo (0.7 na assinatura dur 0.5/stagger 0.1), ticker real.
- **Writes por-filho no transplantado** (idioma `invalidatePreservingStart`
  espelhado: vars → park no 0 do PRÓPRIO filho → invalidate → restore):
  ⚠️ ESCOPO estreitado no audit r1 — o probe NÃO testa máquina de herança
  (não existe ainda; a "edição de grupo" é enumeração escrita pelo probe).
  O que fica provado no motor: enumeração recursiva ALCANÇA o filho aninhado;
  write por-filho no transplantado é possível e ISOLADO (start não rebasa —
  no início tudo em 0/1; irmãos intactos); writes em propriedades distintas
  do mesmo filho não colidem; DOIS transplantados coexistem; rollback
  byte-igual com tick seguinte limpo. A SEMÂNTICA de herança/override/reset
  (override map, reset-herda-valor-atual) é obrigação do witness do
  TransplantLink, não fato deste probe.
- ⭐ **Fato de método (v1 deste probe, 10 RED instrutivos)**: `invalidate()`
  cru rebasa o start pelo DOM midflight TAMBÉM no shape não-transplantado —
  quem protege o start é o WRITER (park-antes-de-invalidar), não a topologia.
  Corolário: qualquer caminho novo que invalide o filho transplantado tem que
  passar pelo writer; e probe de writer que não espelha o idioma real mede o
  próprio bug (lição do furo #4 reconfirmada).
- **Round-trip estrutural**: apply/rollback ×2 (validate-transaction) +
  commit/undo/redo com fingerprint RECURSIVO byte-igual (cadeia `_first→_next`
  em cada nível, identidade de parent por nível, startTime/dur como string,
  vars), **MESMA instância por igualdade referencial estrita (`===`)** no fim,
  DOM igual à referência em 2 ticks no estado committed e no final.
  Sensibilidade do instrumento: mutante de ORDEM PURA **isolado** (Sol r2/r3) —
  cadeia antes/depois com mudança assertada ([a0,a1,a2]→[a0,a2,a1]),
  fingerprint CANÔNICO byte-igual, identidades referenciais preservadas,
  starts idênticos → a detecção `fp0 !== fp1` é atribuível exclusivamente à
  ordem; fingerprint distingue o estado committed. O canônico sai do **MESMO
  registro recursivo** do fingerprint (inclui `duration`/`totalDuration`
  EXTERNOS da fachada), diferindo só por ordenar as cadeias — e tem
  **controle próprio de sensibilidade CAMPO A CAMPO** (r4): o serializador é
  exercido com cópias do registro que diferem em EXATAMENTE um campo — `dur`
  externo, `total` externo, `st` de filho, `dur` de filho, `vars`, `parentOk`,
  `pid`, `target` — todos detectados; mais cópia idêntica igual (determinismo)
  e invariância sob permuta pura na animação viva. Os dois campos que também
  são CHAVE DE ORDENAÇÃO (`pid`, `target`) usam valores que preservam a
  posição canônica, com a preservação ASSERTADA pela sequência do outro campo
  (r5) — senão a detecção viria da ordem e o campo poderia estar omitido da
  saída. (Marca `__pid` e
  fingerprint raso da v1 endurecidos na r1; isolamento do mutante na r2;
  registro único cobrindo dur/total externos na r3; controle campo a campo na
  r4 — a versão anterior do controle mudava `kids` e as durações JUNTOS, logo
  passaria mesmo com o canônico cego aos campos externos.)

## 3b. Caminho REAL do bridge — probes 9+12 (núcleo)

`_probe-b1-bridge-publication.mjs` (protocolo v2 real: negotiate +
apply-transaction; publicação como verdade; DOM verificado). **0 RED.**

- **Um stagger publica UMA animação lógica** (não N por alvo) — consistente
  com a regra "one tween staggering 40 letters is ONE animation".
- **Estado atual pinado** (regressão fica visível; nenhum é "desejado pra
  sempre" — o degrau 1 muda os últimos): `capabilities.keyframes=false`;
  `keyframeEditable=false` com `keyframeEditReason='stagger'` em cada canal.
- ⭐ **ONDE O GATE REALMENTE VIVE — correção de um erro meu**: eu havia
  escrito que "o stagger não publica ownership". **Falso** — eu estava lendo
  no lugar errado (`motion.ownership`, que não existe; a ownership vive **por
  TRACK**). O que a publicação de fato diz, medido: o track do stagger traz
  ownership completa com `retargetable: false`, `affectedTargetCount: 3` e um
  descritor `stagger: { mode: 'staggered', targetCount: 3 }` — e,
  decisivamente, **SEM o bloco `perTarget`**, enquanto o shape plano
  equivalente (mesmos 3 alvos, mesma propriedade, só sem `stagger`) publica
  `perTarget: { available: true, writable: true, states: [...] }`. Ou seja: o
  gate de hoje é a **ausência de `perTarget` na publicação** — a UI nunca
  ganha a afordância —, e a recusa na transação é defesa em profundidade.
  Isso muda o alvo do degrau 1: abrir B1 é fazer o stagger publicar
  `perTarget`, não só destravar o writer.
- **Patch per-target num stagger é RECUSADO sem escrever nada** — a tranca do
  item 172 está viva e fail-closed. Prova em duas dimensões (endurecida no
  audit): **trajetória dos 3 alvos comparada ANTES vs DEPOIS** (amostrada
  renderizando, não só o valor estacionado) + **MutationObserver de `style`
  durante a transação** = 0 escritas, o que exclui também escrita transitória
  desfeita. Ambos os instrumentos com controle de sensibilidade próprio (o
  watcher vê uma escrita real; o comparador vê uma mudança real da animação).
  **As duas provas usam o MESMO objeto descriptor** — o provado em §"descriptor
  não-fabricado" (Sol r4: demonstrar "recusa" com um descriptor e "não escreve"
  com outro não compõe o claim). O helper que fabricava descriptor v3 foi
  REMOVIDO do probe, para que esse caminho não volte por descuido.
- **Descriptor NÃO-FABRICADO** (exigência do audit): o v3 per-target usado
  contra o stagger é construído a partir da ownership PUBLICADA e **provado
  commitando** no shape plano equivalente — mesmos 3 alvos, mesma propriedade,
  mesmo `affectedTargetCount`, só sem `stagger`. Assim a única variável entre
  "commita" e "recusa" é o stagger, e a recusa é atribuível a ele. (Antes eu
  preenchia `writeModel`/`affectedTargetCount` na mão, e o Sol mostrou que a
  recusa podia ser do descriptor inventado.)
- ⚠️ **OBRIGAÇÃO DE DESIGN — MEDIDA com isolamento**: duas condições
  genuinamente diferentes colapsam no mesmo catch-all com **payload canônico
  idêntico** (idêntico após remover `transactionId` e `diagnostics.fingerprint`
  — não "byte-idêntico"): (1) per-target num stagger (com o descriptor provado
  acima) e (3) **operação de patch desconhecida** num motion plano EDITÁVEL,
  onde o mesmo descriptor com a operação conhecida acabou de COMMITAR
  (controle) — só a operação muda, então a classe está isolada. Já `motion inexistente` tem código próprio
  (`motion_missing`), o que mostra que o sistema SABE carregar código por
  classe: a lacuna é específica do `unsupported_patch`. E a `fingerprint` das
  diagnósticas **não** serve de discriminador: medida na MESMA classe em
  transações diferentes e em alvos irmãos, ela muda
  (`kruxou`/`r6looh`/`zfv2xu`) — é por-transação, não por-classe. Conclusão:
  quando B1 abrir, o gate precisa de discriminador transacional estável e
  legível por máquina (código ou subcódigo — não precisa ser texto), senão o
  witness não consegue provar que a recusa acontece pelo motivo certo e uma
  regressão que recuse por outro motivo fica invisível.
  ⭐ **Caminho errado registrado**: minha primeira classe 3 foi
  "propriedade não suportada" com `skewZ` — e o probe mediu que **`skewZ`
  COMMITA** (o bridge cria o canal; é propriedade suportada). Antes disso, a
  versão inicial mandava `skewZ` com `targetScope:'single'` no próprio
  stagger, repetindo a condição inválida da classe 1 — o Sol pegou que
  payloads iguais ali não provavam nada. Duas iterações até uma classe
  realmente independente.
- **Duas animações no mesmo elemento** (stagger em `x` + tween plano em `y`):
  ambas publicadas, com **IDs distintos e associação exata verificada**
  (o canal `x` sai da animação com razão `'stagger'`; o `y`, da plana sem
  razão) — a regra de produto do Adilson ("elemento com 2 animações → ambas
  sempre disponíveis") está satisfeita hoje, ANTES do transplante; o degrau 1
  não pode regredir isso. **Editar a plana COMMITA** (descriptor v2) e **não
  contamina** a trajetória do stagger — com controle: a edição de fato mudou
  o canal `y` (senão a não-contaminação seria vácua; foi exatamente o RED que
  o controle pegou na primeira versão, onde a edição nunca aplicava).

## 4. O que estes probes NÃO estabelecem (fronteira honesta)

- **Do caminho do bridge, só o NÚCLEO dos probes 9+12** (§3b: publicação,
  recusa fail-closed, duas animações). **Seguem pendentes**: probe 8
  (token/proveniência/hazard sob mutação posterior da página), probe 10
  (gestures/teardown/replay/preview-cancel), probe 11 (as 4 lanes do
  classificador sob clock NaN/duração zero/repeat/drift/ScrollTrigger) e o
  resto do 12 (colisão de registries com o OverrideChannel). São pré-design
  segundo o Sol e ficam ANTES de qualquer implementação.
- **Nada fora da assinatura**: sem SplitText (B3), sem repeat/yoyo/
  repeatRefresh (B2a/B2b), sem timeScale≠1 como suporte (B1t futura — aqui só
  o fato de linhagem), sem callbacks autorais no shape promovível (decisão de
  produto 2026-08-06: fail-closed até chave própria).
- **Mini-writer é espelho, não o writer**: os probes 5–7 usam o idioma
  park/invalidate/restore reimplementado localmente; equivalência com o
  writer REAL (com journal/binding/gates) é obrigação dos probes 8–12 e do
  witness do gate.
- `unnest` do probe usa `startTime()` setter pós-add; a forma exata da
  reinserção no produto (add na posição + correção de ordinal p/ mesmo-start)
  é decisão de design informada pelo fato ⚠️ acima.

## 4b. Audit adversarial (registro)

- **Sol r1 (prose, effort max): 3 achados, TODOS aceitos e corrigidos** —
  (1) "herança de grupo/reset" era circular (o esperado codificado no próprio
  teste) → claims estreitados pra alcance/isolamento de write por-filho;
  (2) identidade por `__pid` + fingerprint raso + mutante que também mudava
  startTime → `===` estrito, fingerprint recursivo com parent por nível,
  mutante de ordem pura com starts assertados; (3) sensibilidade global
  superdeclarada + restart com seek corretivo (vácuo) + reverse sem delta +
  contadores mortos (childStart/childComplete/onRepeat) → tudo corrigido/
  estreitado. Re-run pós-fix: todos os probes 0 RED.
- **Sol r2: 1 bloqueador remanescente, aceito e corrigido** — o mutante de
  ordem não era ISOLADO (`fp0 !== fp1` podia vir de qualquer campo do
  fingerprint; o probe 4 mediu nest, não o round-trip). Fix: cadeia
  antes/depois assertada + fingerprint canônico independente de ordem
  byte-igual + identidades referenciais preservadas + starts idênticos.
  Re-run 0 RED; achados 1 e 3 da r1 confirmados fechados pela r2.
- **Sol r3: bloqueador do isolamento ainda aberto, aceito e corrigido** — o
  canônico da r2 era um serializador PARALELO que omitia `duration`/
  `totalDuration` externos, então `canonEq=true` não cobria todos os campos
  não-ordinais. Fix: canônico derivado do MESMO registro recursivo (um
  `fpRecord` único; canônico = ordenar as cadeias), + **controle de
  sensibilidade do próprio canônico** — este controle é adição minha, não
  pedido dele: sem ele, `canonEq=true` seria verde vácuo pela doutrina da
  frente.
- **Sol r4: o controle que EU adicionei estava confundido, aceito e
  corrigido** — ele mudava `kids` e as durações externas juntos (adicionar um
  filho muda os dois), então passaria com o canônico cego aos campos externos.
  Fix: serializador exposto sobre o REGISTRO (`canonSerialize`) e exercido com
  cópias que diferem em EXATAMENTE um campo (8 campos + determinismo +
  invariância sob permuta). ⭐ Lição: **controle de sensibilidade também pode
  ser confundido** — mutar o objeto vivo move vários campos de uma vez; a
  prova campo a campo exige mutar a REPRESENTAÇÃO, não o mundo.
- **Sol r5: confusão residual no controle, aceita e corrigida** — `target` é
  CHAVE DE ORDENAÇÃO; mudar `a0`→`zz` reposicionava o nó, então `targetMuda`
  passaria mesmo com o campo omitido da saída. Fix: valores que preservam a
  posição (`a0`→`a0x`, `pid` 0→0.5) + preservação ASSERTADA pela sequência do
  outro campo. ⭐ Corolário da lição acima: num serializador canônico, **todo
  campo que participa da chave de ordenação precisa de controle
  posição-preservante** — do contrário o teste do campo vira teste da ordem.
- **Sol no probe do BRIDGE (§3b): 5 rodadas, 5 bloqueadores, MERGE OK na r5**
  — (r1) preservação não testada, obrigação não decorria do probe, verdes
  falsos na publicação; (r2) classe 3 não isolada (repetia a condição inválida
  da classe 1); (r3) descriptor v3 FABRICADO — a recusa podia ser dele, não do
  stagger; (r4) composição inválida (recusa provada com um descriptor,
  ausência-de-escrita com outro); (r5) limpo. ⭐ O achado da r3 expôs um **erro
  factual meu já escrito no doc** ("stagger não publica ownership") causado por
  ler no lugar errado — e a correção mudou o alvo do degrau 1 (o gate vive na
  publicação). ⭐ Colateral: `skewZ` COMMITA (não é propriedade não suportada),
  derrubando a premissa da minha primeira classe 3.
- **Lado Claude do review: DEGRADADO** — o agente revisor independente caiu no
  limite mensal de spend da API; o único olhar Claude foi o do AUTOR dos
  probes (self-review, mais fraco). Registrado com honestidade; os rounds
  extras do Sol (r2/r3) cobriram a lacuna antes do MERGE OK.

## 5. Decisões de produto registradas nesta data

- **Callback de conclusão do grupo (martelo do Adilson, advise consulta 1
  adotado integral)**: semântica alvo = grupo inteiro (fachada autoridade
  pública; wrapper apenas coordena a conclusão; 1× por travessia natural,
  época consumida antes do call); operações do editor SEMPRE silenciosas
  (scrub/freeze/settle/undo/redo/rollback/replay), só Play/Preview explícito
  dispara em avanço natural; **nesta entrega, shape com callback autoral segue
  recusado** até chave atômica própria com witness (fachada observável,
  reentrância, `eventCallback()`).
- Colateral do advise (confirmado no código): o seek genérico do bridge chama
  `animation.time(..., false)` (`runtime-bridge-source.js:7475`) — callbacks
  DISPARAM em scrub genérico hoje, contra a regra acima; settlement já é
  silencioso (`:3059`). Fix independente do transplante, na fila.
