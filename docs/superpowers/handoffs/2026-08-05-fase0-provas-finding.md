# Fase 0 — Provas P1–P6 do override per-target — FINDING DOC

> Spec: `docs/superpowers/specs/2026-08-05-chain-override-per-target-design.md` §3.
> Plano: `docs/superpowers/plans/2026-08-05-fase0-provas-override-per-target.md`.
> Regra: veredito SEMPRE junto com a FORMA testada. "Não reproduzido" ≠ refutado.
> Vereditos possíveis: `provado` / `refutado` / `não estabelecido — <o que falta>`.

## P1 — SplitText REAL com re-split

- **Pergunta:** que DOM o SplitText produz; fragmentos contíguos em `targets()`; re-split
  substitui elementos?; existe identidade estável através do re-split?; `revert()` restaura?
- **Forma testada:** `_probe-furo4-splittext-real.mjs` (2026-08-05) — SplitText 3.15 REAL da
  fixture, `<h1>` de 25 chars em wrap de 300px, `type:'lines,words,chars'`; re-split REAL
  (largura 300→150px ANTES do `split()`, linhas 2→4); controles de sensibilidade nos dois
  sentidos (tween pré-re-split reporta 25/25 vivo; tween novo pós-re-split reporta 25/25 vivo
  pelo MESMO instrumento que carimbou o antigo de órfão).
- **Resultado bruto:** q1 chars=25/words=4/lines=2, fragmento=`<div>` sem classe, linha 0 =
  índices 0–12 CONTÍGUOS em `targets()`. q2 `mesmaReferenciaNoIndice3:false`,
  `antigosAindaNoDoc: 0/25`. q3 `tweenFicouOrfao:true` (25/25 fora do documento). q4 sem id,
  sem data-attr própria (só `aria-hidden`+`style`), `textoNaMesmaOrdem:true`. q5
  `originalIgualAoRevertido:true`.
- **Veredito:** **provado** — (a) re-split SUBSTITUI todos os fragmentos; referências de
  elemento capturadas antes morrem TODAS; (b) não existe identidade intrínseca por elemento;
  a única identidade estável através do re-split é **posição na sequência + texto** (ordem de
  chars preservada); (c) contiguidade em `targets()` é propriedade real da biblioteca na
  criação; (d) `revert()` restaura exato.
- **Consequência pro degrau:** endereçamento por-alvo em formas SplitText NÃO pode segurar
  referência de elemento através de resize — precisa re-resolver por ÍNDICE na sequência de
  fragmentos após cada re-split. Vale pros degraus 1 (transplante) e 3 (override): qualquer
  estado per-target sobrevive ao re-split só se for keado por índice, nunca por elemento. O
  tween do próprio site também fica órfão no re-split (o site re-cria via onSplit/autoSplit) —
  a Fase 1 precisa decidir onde o override re-engancha nesse ciclo de recriação.

## P2 — Conversão escalar→função vs malha de proveniência da fase-2

- **Pergunta:** o caminho de escrita real refresca a proveniência após conversão própria, sem
  cegar o detector de mutação latente da página?
- **Forma testada:** `_probe-fase0-p2-provenance.mjs` (2026-08-05) — bridge real (harness P3),
  tween `keyframes` de x + `y` top-level; conversão crua de y escalar→função (mecânica do
  writer candidato, SEM protocolo de proveniência) + step edits `keyframeStep.x` por token da
  exposição corrente + `retarget.final` de x pelo caminho real. 5 casos: controle-vivo,
  conversão-própria (token pré), retarget-irmão, ⭐ controle de sobre-determinação
  (pós-conversão, exposição fresca, SEM mutação) e adversarial-pós-conversão.
- **Resultado bruto:** controle: edit aplica ([100,500,300]) e mutação da página é recusada
  (`patch-rejected`) — detector vivo. Conversão crua → step edit com token pré recusado;
  retarget.final do IRMÃO x recusado; ⭐ pós-conversão SEM mutação: exposição fresca **nem
  publica token** (`tokenExposto:false`) e edit recusa. Adversarial: recusado — mas
  SOBRE-DETERMINADO (o 3b mostra que pós-conversão tudo recusa, com ou sem mutação; o caso
  não isola o detector).
- **Veredito (reclassificado no audit consolidado do Sol, aceito):** quanto ao COMPORTAMENTO
  DA MALHA hoje — **provado**: a conversão SEM protocolo é tratada como tampering e
  **fail-closa a edição inteira** (função em var = hazard animation-level, item 170e; canal
  keyframe some da exposição); nunca cega, falha na direção segura. Quanto à PERGUNTA
  ORIGINAL (o caminho real refresca a proveniência após conversão própria) — **não
  estabelecido**: o protocolo positivo não existe pra ser testado; a Fase 1 o constrói e a
  prova é o probe combinado (ver Gate da Fase 1 abaixo da tabela).
- **Consequência pro degrau:** o writer da conversão (degrau 3, Fase 1) NÃO pode só escrever a
  função — precisa do protocolo de edição própria: registrar proveniência POSITIVA da função
  introduzida (o registro por-animação+por-propriedade do item 170e), refrescar
  bindings/colateral (padrão `captureValidStartAtBindings`/`refreshCollateralBindings` do
  `retarget.final`) e re-expor. Sem isso o override tranca a animação inteira — pior que não
  existir.

## P3 — Caminho de escrita REAL do bridge (harness)

- **Pergunta:** o helper de probe dirige patches pelo MESMO seam da UI, e detecta quando não?
- **Forma testada:** `_probe-fase0-harness.mjs` (self-test, 2026-08-05) — mecânica extraída do
  witness do detach (intocado): captura de `postMessage`, `eval` do bridge real, seleção por
  CLIQUE, patch por `MessageEvent` protocolo `uncraft-motion-editor/v1`. Caso 1 (sensibilidade):
  `retarget.final` com value `{}` → erro `invalid_value` DO BRIDGE (o harness não valida nada
  por conta própria — atalho passaria silencioso). Caso 2: retarget absoluto de `x`→160 num
  single-target → render 0→1 dá 160.
- **Resultado bruto:** `HARNESS OK (2/2)`.
- **Veredito:** **provado** — caminho real estabelecido e sensível nos dois lados.
- **Consequência pro degrau:** todos os probes de edição da Fase 0 usam este harness. ⚠️
  Descoberta de escopo no caminho: `applyGsapRetarget` hoje RECUSA por `scope_mismatch`
  qualquer retarget que não declare TODOS os alvos (`affectedTargetCount !== targetCount`) —
  o canal per-target NÃO existe no bridge; é exatamente o writer que a Fase 1 construiria.
  Logo P4/P2 provam a MECÂNICA do writer candidato replicando as primitivas reais
  (`invalidatePreservingStart` com semântica EXATA — precedente do item 168), e registram o
  delta pro caminho completo.

## P4 — Função-por-alvo no fluxo de edição real (multi-target simples)

- **Pergunta:** conversão escalar→função num tween VIVO, pelo caminho real, isola o alvo com
  rollback exato?
- **Forma testada:** `_probe-fase0-p4-multitarget.mjs` (2026-08-05) — página com bridge REAL
  vivo (harness P3); `gsap.to(['#a','#b'], { x:100, duration:1 })` parado em 0.5; conversão
  `vars.x` escalar→`(i, target) => target === a ? 160 : 100` + semântica EXATA de
  `invalidatePreservingStart` (park→0 com render, invalidate, volta). Referência intocada em
  página própria; trajetória completa em 5 amostras renderizando DO INÍCIO; asserção de vida
  antes (x=75 em 0.5 — ease default power1.out); sensibilidade = escalar cru TEM que
  contaminar o irmão e o instrumento TEM que ver.
- **Resultado bruto:** `P4 OK (3/3)`. caso-basico: a=[0,70,120,150,160] (início preservado,
  chega em 160 pelo ease), b byte-igual à referência. caso-rollback: `vars.x` volta ao escalar
  100, trajetória inteira byte-igual à referência. caso-sensibilidade: b contaminado (end=160)
  detectado.
- **Veredito (escopo apertado no audit consolidado do Sol, aceito):** **provado como
  VIABILIDADE NO MOTOR** — a conversão escalar→função num tween vivo isola o alvo, preserva o
  início, não toca o irmão, e o rollback restaura byte-igual, usando a primitiva replicada.
  NÃO é prova do "fluxo de edição real": o canal per-target não existe no bridge (P3,
  `scope_mismatch`) — a interação writer+proveniência+temporal nunca foi exercitada junta.
- **Consequência pro degrau:** o mecanismo candidato do degrau 3 é viável no motor. A prova
  de degrau é o probe combinado do Gate da Fase 1 (abaixo da tabela).

## P5 — Transplante da instância viva

- **Pergunta:** reparentear o filho interno vivo de um stagger preserva continuidade, isola o
  alvo, dá playhead independente — e o que o wrapper precisa projetar do pai?
- **Forma testada:** `_probe-fase0-p5-transplant.mjs` (2026-08-05) — GSAP 3.15 puro (sem
  bridge; mecânica do motor). Transplante = capturar tempo LOCAL do filho →
  `tween.timeline.remove(child)` → `gsap.timeline({paused:true}).add(child, 0)` →
  `tl.totalTime(local, true)`. Stagger 0.2/duration 1/ease none, parado em 0.7 (i1 local 0.5,
  x=50 — vida provada). Referência intocada em página própria; avanço IGUAL nos dois relógios;
  sensibilidade = transplante sem restaurar o tempo.
- **Resultado bruto (por linha):**
  - `plain-midflight` ✅ ASSERTADO: no instante byte-igual à referência (alvo E irmãos);
    após avanço igual (Δ0.2) byte-igual (i0=90/i1=70/i2=50); independência real — avançar SÓ o
    relógio novo move só i1, irmãos congelados.
  - `sensibilidade` ✅: transplante errado é INVISÍVEL no instante (`totalTime(0)` em relógio
    já em 0 = no-op de render, x fica 50) e salta no TICK SEGUINTE (x=1) — o instrumento
    detecta; ⭐ lição de método reconfirmada: dano temporal se mede no tick seguinte.
  - `pai-repeat-yoyo` 📋: repeat/yoyo vivem na FACHADA (child repeat=0/yoyo=false, pai
    repeat=2, totalDur pai 4.2 vs child 1) → o filho transplantado PERDE o ciclo — o wrapper
    precisa projetar repeat/yoyo.
  - `pai-timescale` 📋: timeScale vive na fachada (child/tl = 1) → wrapper precisa copiar;
    sem salto no instante (15=15).
  - `callbacks` 📋: `onComplete` fica na fachada; completar o pai ainda dispara o dele (1×,
    caminho sem suppress); o transplantado não dispara nada — "quem herda o callback" segue
    decisão de produto da Fase 1 (a pergunta do Sol), agora com baseline medido.
  - `repeatRefresh-child` 📋 (CORRIGIDO na rodada 7 do audit consolidado + probe de dono
    2026-08-05): o valor random JÁ RESOLVIDO sobrevive ao transplante byte-igual
    (74.3269 = 74.3269) — esse fato FICA e é o que a amostragem nunca conseguiu. MAS o
    claim original "cruzar fronteira re-rolla finito" era **VÁCUO**: o dono do
    `repeat`/`repeatRefresh` é a FACHADA (medido: `childRepeat=0`,
    `childRepeatRefresh=false`, `childTotalDur=1`) — o filho transplantado não tem
    fronteira nenhuma; `totalTime(0.9×1)` não cruzou nada. Re-roll pós-transplante: ZERO
    evidência; o ciclo é semântica de fachada que o wrapper teria que reproduzir.
  - `splittext-stagger` 📋: existe filho interno POR CHAR de SplitText real e o transplante
    funciona; o re-split orfana o filho transplantado (consistente com P1 — substituição
    total) → transplante em SplitText exige re-resolução por índice no ciclo de re-split.
- **Veredito (escopo apertado no audit consolidado do Sol, aceito):** **provado no núcleo
  ESTREITO** — continuidade + isolamento + independência de playhead, com sensibilidade, no
  stagger SIMPLES com relógios avançados manualmente. O MESMO probe mediu que repeat/yoyo,
  timeScale e callbacks ficam na fachada e SE PERDEM no transplante cru — "projetável" é
  hipótese de wrapper, não prova (violaria a indistinguibilidade se promovido já). SplitText:
  provada a ORFANDADE pós-re-split, não o re-engate.
- **Consequência pro degrau:** o transplante é o mecanismo CANDIDATO mais forte pro degrau 1
  em stagger; a promoção exige o wrapper real preservando fachada/lifecycle/ticks (Gate da
  Fase 1). `repeatRefresh`: estado resolvido preservado = a candidatura de promoção existe.

## P6 — Caminho de escrita: dano temporal em repeat/yoyo (witness + fix)

- **Pergunta:** edição via caminho real danifica o estado temporal de tweens repeat/yoyo
  (restauração por `progress`)? Fix por `totalTime` fecha?
- **Forma testada:** `_probe-editwrite-witness.mjs` + baseline tracked (2026-08-05) — template
  do witness da inspeção: edição REAL (`retarget.final` absoluto via clique+apply-patch),
  referência = página SELECIONADA-não-editada (isola o dano da edição; seleção inócua pelo
  `1ada4a7b`), comparação SÓ de estado temporal (totalTime/progress/reversed) no instante +
  2 ticks; "edição aplicou" provado por render do início (end=160).
- **Resultado bruto (witness parte a):** **6 RED congelados** —
  - `repeat2-na-2a-iteracao`: totalTime **teleporta 1.5→0.5** (iteração inteira perdida) no
    instante e nos 2 ticks;
  - `repeat-infinito-3a-volta`: **2.5→1.5** (a batida perdida, a classe da inspeção);
  - `controle-tween-simples`: verde (progress descreve o estado inteiro — restauração exata);
  - `yoyo-na-perna-de-volta`: **NÃO reproduzido nesta forma** (verde; registrado, não
    refutado — forma anotada no caso);
  - `adaptativa-yoyoEase`: ⭐ contra minha previsão, o retarget absoluto **APLICA** (não
    amostra nada; o lock unsampleable é end-only NA UI, não no bridge) e o temporal fica
    intacto — registrado como fato.
- **Veredito (parte a):** **provado** — o defeito existe no caminho de escrita, classe
  restauração-por-progress, formas repeat≥1 em iteração posterior. Contrato congelado no
  baseline.
- **Parte b (fix) — SHIPPED com MERGE OK do Sol em 2 rodadas:** park/restore por `totalTime`
  nos dois seams, com o padrão de guarda do rebobinador auditado (inspeção intocada — delta
  deliberado aceito). ⭐ **Rodada 1 = VETO com bloqueador real, reproduzido número a número:**
  a amostra de INÍCIO (`sampleGsapValue(..., 0)`) via `progress(0)` numa iteração posterior
  renderiza o FIM da iteração anterior (probe GSAP 3.15: totalTime 2.5 → progress(0) dá
  totalTime=2/progress=1/x=100) — e o writeModel PUBLICADO pra loop é `additive-base`, cujo
  writer lê o início assim: editar frame visível 50→160 num loop 0→100 gravava
  `startAt=210/vars.x=210` e renderizava 210. Meus DOIS instrumentos (witness + vitest)
  tinham o mesmo ponto cego: forçavam `absolute`. Fix: amostra 0 = início semântico →
  `totalTime(0,true)`; endpoint segue `progress(1)`; caso novo no witness DERIVA o writeModel
  da publicação (`ownership.writeModel`) e checa frame/endpoints/rollback. A/B: corrupção
  exata sem o fix, verde com. Rodada 2: MERGE OK explícito.
- **Estado final:** witness 0 RED (baseline agora congela o comportamento CORRETO — RED daqui
  pra frente é regressão); suíte 1538/1538; vizinhos verdes; detach 11 FAIL byte-idênticos ao
  HEAD (A/B).
- **Consequência pro degrau (escopo apertado no audit consolidado):** o WRITER ATUAL
  (full-scope) é temporalmente seguro em `repeat`/loop, incluindo `additive-base` — é
  pré-requisito NECESSÁRIO do degrau 3, não a prova dele (o writer per-target da Fase 1 herda
  o padrão e re-prova no probe combinado). Lição de instrumento: **witness que força um write
  model não cobre o classificador** — derivar sempre da publicação.

## Roteador forma → degrau (entrada da Fase 1 — REFORMULADO no audit consolidado do Sol)

> Escada (spec §2): 1=transplante da instância viva · 2=divisão real (universo controlado) ·
> 3=override per-target · 4=congelar-e-assumir. Obrigação de indistinguibilidade vale em todos.
>
> ⭐ **Formato exigido pelo audit (aceito): PREDICADOS ORDENADOS, primeira regra que casa
> decide.** Regra mestra: **qualquer eixo NÃO PROVADO da animação força o degrau 4** — uma
> forma composta (`stagger + SplitText + repeatRefresh + callback`) desce pro degrau mais
> conservador entre os eixos presentes, nunca herda o mais otimista. E como NENHUM degrau
> 1–3 foi provado end-to-end na Fase 0, **o estado honesto de hoje é: toda edição per-target
> em camada acorrentada roteia pro degrau 4** até o Gate da Fase 1 promover cada predicado.

**Avaliação (corrigida na rodada 2 do audit — o Sol pegou que "primeira que casa" deixava um
plano+`repeatRefresh` herdar a candidatura de transplante, cuja evidência é de FILHO DE
STAGGER, estrutura que o plano não tem):**

1. O roteador coleta **TODOS os eixos aplicáveis** da animação (estrutural + modificadores),
   não para na primeira regra.
2. Exceção única: canal single-owner sem grupo = edição direta (shipada, 167/168).
3. Se o conjunto de eixos contém plugin/callback arbitrário → **4**, sem candidatura
   (fronteira aceita, veredito do advise).
4. Senão, o degrau HOJE é **4**, sem exceção. Promoção acima de 4 SÓ quando uma linha da
   **Tabela B (hipóteses)** for provada pelo probe único correspondente com **assinatura
   completa** — estrutura + modificadores + `targetScope` + caminho (patch real). A Tabela A
   registra fatos, não autoriza degrau; nada herda de eixo isolado nem de escopo diferente.

**Rodada 3 do audit (aceita): a assinatura exata inclui `targetScope` (full-scope vs
per-target) e `caminho` (motor-cru / primitiva-replicada / patch-real) — misturar prova
full-scope com prova per-target-no-motor era a mesma herança conjuntiva que este roteador
elimina. Consequência estrutural: separar o que FOI provado do que é hipótese.**

**Tabela A — combinações PROVADAS (assinatura completa; NADA aqui autoriza degrau — são os
fatos que as hipóteses citam):**

| # | Estrutura + modificadores | targetScope | Caminho | Fato provado |
|---|---|---|---|---|
| A1 | Stagger filho-por-alvo, sem mod. | per-target | motor cru (relógios manuais) | Transplante: continuidade/isolamento/playhead + sensibilidade (P5) |
| A2 | Stagger filho-por-alvo + `repeat: 1, repeatRefresh: true` **owner=FACHADA** (medido: `childRepeat=0`, `childTotalDur=1` — probe de dono 2026-08-05); parado mid-1ª-iteração | per-target | motor cru | Valor resolvido sobrevive ao transplante byte-igual NO INSTANTE. Fronteira/re-roll: NADA provado (o filho transplantado não tem ciclo — claim original era vácuo, corrigido r7) |
| A3 | SplitText (estrutura) | — | biblioteca real | Re-split substitui tudo; identidade = índice; `revert()` exato (P1) |
| A4 | SplitText + stagger | per-target | motor cru | Filho por char existe e transplanta; ÓRFÃO no re-split (P5) |
| A5 | Multi-target plano, sem mod. | per-target | primitiva replicada | Conversão isola alvo, início preservado, rollback byte-igual (P4) |
| A6 | Multi-target plano, `repeat`/loop | **full-scope** | patch REAL | Writer atual temporal-inócuo incl. `additive-base` (P6a+P6b, MERGE OK) |
| A7 | Multi-target plano, `yoyoEase` | **full-scope** | patch REAL | Retarget absoluto aplica com temporal intacto (P6, registro) |

**Tabela B — HIPÓTESES de promoção (nada aqui é provado; degrau HOJE = 4 pra todas).**
Rodada 4 do audit (aceita): **linhas ATÔMICAS — uma chave exata
`{estrutura, modificadores, targetScope, caminho}` por linha, um probe por linha; o roteador
promove SÓ a chave exata provada.** Nenhum "±"/curinga: provar uma linha não promove nenhuma
outra (provar stagger simples não promove `repeatRefresh`; provar `repeat` não promove
`yoyo`).

| # | Chave exata (estrutura · modificadores · targetScope · caminho=patch real) | Degrau hipotético | Fragmentos (Tabela A) |
|---|---|---|---|
| B1 | stagger filho-por-alvo · nenhum · per-target | 1 | A1 |
| B2a | stagger filho-por-alvo · `repeat: 1, repeatRefresh: true` **owner=fachada** (top-level; medido: filho perde o ciclo no transplante cru) · per-target | 1 | A1, A2 |
| B2b | stagger filho-por-alvo · `stagger: { repeat: 1, repeatRefresh: true }` **owner=child** (r8 do audit, ownership CONFIRMADO por probe ANTES do transplante: `childRepeat=1`, `childRepeatRefresh=true`, `childTotalDur=2`; a PRESERVAÇÃO disso no transplante NÃO foi estabelecida) · per-target | 1 | A1; ownership pré-transplante (probe r8). Sobrevivência do ciclo/fase/re-roll/isolamento/rollback = obrigações do probe combinado |
| B3 | stagger+SplitText · nenhum · per-target | 1 | A3, A4 |
| B4 | multi-target plano · nenhum · per-target | **3 — PROMOVIDO 2026-08-05** (prova: witness `_probe-b4-witness.mjs`, 55 checks no GSAP 3.15 real pelo protocolo v2; MERGE OK do Sol na r6 da audit da Fase 1 — plano `2026-08-05-fase1-b4-per-target-writer.md`) | A5 |
| B5 | multi-target plano · `repeat: 2, yoyo: false` (parado em iteração posterior) · per-target | 3 | A5, A6 |
| B6 | multi-target plano · `repeat: 3, yoyo: true` (parado numa perna de VOLTA) · per-target | 3 | A5, A6 |
| B7 | multi-target plano · `yoyo: true, repeat: 1, yoyoEase` · per-target end-only | 3 end-only | A5, A7 |

> Rodada 5 do audit (aceita): a linha "`yoyo` sozinho" foi REMOVIDA — yoyo sem `repeat > 0`
> não produz perna de volta e o probe seria vacuamente verde (probe sem sensibilidade). As
> chaves com repetição explicitam o `n` e a POSIÇÃO de estacionamento que torna o probe
> sensível (iteração posterior / perna de volta).

> **Addendum 2026-08-05 (promoção B4).** A chave B4 foi promovida pelo probe combinado do
> Gate via witness real (`_probe-b4-witness.mjs`): alvo parcial, proveniência positiva
> (WeakMap contextual + atestação de endpoints), mutação posterior detectável (impostora,
> wrapper roubado, carriers pós-canal), re-exposição, rollback exato (incl. colapso pro
> shared ATUAL e tombstone ressincronizado), irmão byte-intacto, controle de sensibilidade.
> Audit da Fase 1: review Claude (5 achados) + Sol r2–r6 (7 achados) = 12 corrigidos com RED
> observado; MERGE OK na r6. **Estreitamentos da chave descobertos na audit** (recusas, não
> promoções): unidade relativa (%/vw/rem) FORA (atestação mede px); carriers de modificador
> (snap/roundProps/modifiers) FORA, com verificação pós-write fail-closed pra carrier
> desconhecido; slot precisa ser próprio/data/gravável. **Adiamentos aceitos pelo Sol**: o
> marcador estável do serializer colateral NÃO conta como evidência B4/B5/B6 (wrapper e
> maquinaria de keyframes não coexistem sob a chave estrita). **Residuais documentados**:
> lock monotônico permanente quando a página desloca o wrapper (doutrina fail-closed r103 —
> recuperação verificável por atestação seria decisão de produto); clear sob hazard de
> função recusa (fail-closed; teardown colapsa o slot SEM invalidar — não executa função da
> página); registro forte de canais retém animations até teardown (bounded por edits).

Probe de cada linha: o do Gate abaixo, instanciado NAQUELA chave (B1–B3 somam o wrapper de
fachada/lifecycle/ticks; B2a soma o wrapper reproduzindo `repeat`+`repeatRefresh` DA FACHADA
no relógio novo, com re-roll na fronteira AFIRMADO — hoje zero evidência disso; B2b cruza a
fronteira do PRÓPRIO filho transplantado e afirma re-roll+continuidade+isolamento+rollback;
B3 soma re-engate no re-split; B7 mantém end-only+lock da UI).
Combinação fora de B1–B7 = degrau 4, e entra na tabela só com linha e probe próprios.
⭐ Lição r8 (probe de dono 2): o MESMO par de opções muda de dono conforme ONDE é autorado
(top-level vs dentro de `stagger{}`) — a assinatura exata inclui o LOCAL de autoria.

## Gate da Fase 1 (prescrição do audit, aceita)

A promoção de QUALQUER predicado exige o **probe combinado pelo caminho de patch REAL**, por
predicado, cobrindo junto: alvo parcial; proveniência positiva registrada; mutação POSTERIOR
da página ainda detectável (o protocolo não pode cegar o detector); re-exposição; rollback
exato; irmão intacto; repeat/yoyo com `additive-base`. Pro degrau 1, adicionalmente:
indistinguibilidade com a fachada (repeat/yoyo/timeScale/callbacks projetados) e, pra
SplitText, re-split sobrevivido. Witness por predicado, padrão desta Fase 0 (referência
intocada, sensibilidade, tick seguinte, write model DERIVADO da publicação).
