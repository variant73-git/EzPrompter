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
- **Veredito:** **provado (comportamento da malha estabelecido)** — a conversão SEM protocolo
  é tratada como tampering da página e **fail-closa a edição inteira da animação** (função em
  var = hazard animation-level, item 170e; canal keyframe some da exposição). Nunca cega:
  falha na direção segura.
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
- **Veredito:** **provado** — a conversão escalar→função por alvo num tween vivo isola o alvo,
  preserva o início, não toca o irmão, e o rollback restaura byte-igual.
- **Consequência pro degrau:** o degrau 3 (override) tem mecanismo provado pra multi-target
  plano SEM filho interno. Delta pra Fase 1: funnelar essa escrita por `applyGsapRetarget`
  (novo write model per-target; hoje `scope_mismatch` — ver P3) e regravar `sourceValue`/
  proveniência (P2).

## P5 — Transplante da instância viva

- **Pergunta:** reparentear o filho interno vivo de um stagger preserva continuidade, isola o
  alvo, dá playhead independente — e o que o wrapper precisa projetar do pai?
- **Forma testada:** (pendente)
- **Resultado bruto:** (pendente)
- **Veredito:** (pendente — por linha da matriz)
- **Consequência pro degrau:** (pendente)

## P6 — Caminho de escrita: dano temporal em repeat/yoyo (witness + fix)

- **Pergunta:** edição via caminho real danifica o estado temporal de tweens repeat/yoyo
  (restauração por `progress`)? Fix por `totalTime` fecha?
- **Forma testada:** (pendente)
- **Resultado bruto:** (pendente)
- **Veredito:** (pendente)
- **Consequência pro degrau:** (pendente)

## Tabela final — forma → degrau (entrada da Fase 1)

| Forma autoral | Degrau | Prova que sustenta | Fica pra Fase 1 |
|---|---|---|---|
| (preencher na Task 8) | | | |
