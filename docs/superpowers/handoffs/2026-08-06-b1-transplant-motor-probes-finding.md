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

## 4. O que estes probes NÃO estabelecem (fronteira honesta)

- **Nada do caminho do bridge**: patch v2/v3 real, publicação, proveniência/
  token, hazard tri-state, teardown/replay, 4 lanes do classificador,
  convivência com OverrideChannel — probes 8–12 do advise, pendentes; são
  pré-design segundo o Sol e ficam ANTES de qualquer implementação.
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
