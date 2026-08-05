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
- **Forma testada:** (pendente)
- **Resultado bruto:** (pendente)
- **Veredito:** (pendente)
- **Consequência pro degrau:** (pendente)

## P3 — Caminho de escrita REAL do bridge (harness)

- **Pergunta:** o helper de probe dirige patches pelo MESMO seam da UI, e detecta quando não?
- **Forma testada:** (pendente)
- **Resultado bruto:** (pendente)
- **Veredito:** (pendente)
- **Consequência pro degrau:** (pendente)

## P4 — Função-por-alvo no fluxo de edição real (multi-target simples)

- **Pergunta:** conversão escalar→função num tween VIVO, pelo caminho real, isola o alvo com
  rollback exato?
- **Forma testada:** (pendente)
- **Resultado bruto:** (pendente)
- **Veredito:** (pendente)
- **Consequência pro degrau:** (pendente)

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
