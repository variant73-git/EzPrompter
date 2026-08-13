# Anti-slop generation eval

Turns the taste spine into a scored, repeatable measurement. Follows
[`docs/superpowers/handoffs/2026-07-06-anti-slop-eval-handoff.md`](../../../../docs/superpowers/handoffs/2026-07-06-anti-slop-eval-handoff.md)
and closes pendência 5 of the 2026-07-22 switchboard handoff.

**Not the same suite as `evals/promptfooconfig.yaml`** — that one measures the board
agent's ROUTING. This one measures GENERATION quality.

## Arquitetura: os checks rodam no BROWSER, não sobre a string

Três rodadas de auditoria adversarial (~35 achados) provaram que ler HTML/CSS como texto
vaza por **classes**, não por casos: `content:"font-style:italic"` virava declaração,
`var(--white)` virava branco, copy dentro de `<template>` contava como renderizada.

É a mesma lição que o repo já tinha pago no hero pixelado (CLAUDE.md 163/164): *"Regex não
estabelece contexto de parsing de HTML/CSS — o fix DEFINITIVO roda no DOM via CSSOM"*.

| Peça | Onde | Papel |
|---|---|---|
| Porta pública | [`@uncraft/design-eval`](../../../design-eval/src/index.js) | **importe só isto.** Consumidores externos que alcançam os arquivos internos quebram quando as tripas mudam — foi o que aconteceu em 12/08 |
| Observação no browser | [`slop-observe.js`](../../../design-eval/src/slop-observe.js) | roda a página no Chromium e devolve FATOS (cores autoradas normalizadas, stacks resolvidos, copy renderizada) |
| Veredito puro | [`slop-verdicts.js`](../../../design-eval/src/slop-verdicts.js) | julga os fatos; sem HTML, sem parsing, testável sem browser |
| Integridade do artefato | [`artifact-integrity.js`](../../../design-eval/src/artifact-integrity.js) | truncamento e `<img>` placeholder — fica na STRING de propósito: o browser conserta o dano e apaga a evidência |
| Rubric derivado do switchboard | [`lib/design/rubric.js`](../../lib/design/rubric.js) | 1 check por critério, gerado do `house-style.js` |

O que o browser resolve de graça, cada item matando um achado da auditoria: normalização de
notação de cor, cascata resolvida, `var()`/shorthand/`!important` aplicados, `innerText`
excluindo `[hidden]`/`<template>`, entidades decodificadas pelo parser, e uma string de
`content` sendo sempre valor, nunca declaração.

⚠️ **Cores lidas são as AUTORADAS**, não as computadas: o padrão do Chrome é `rgb(0,0,0)`,
então ler computado acusaria preto puro em toda página que nunca escolheu cor.

```sh
node evals/anti-slop/build-rubric.mjs           # regenera + relatório de cobertura
node evals/anti-slop/build-rubric.mjs --check    # falha se estiver desatualizado (CI)
```

## A camada barata é um DETECTOR, não um certificador

**39 critérios, ZERO com cobertura completa, 10 com check barato parcial.**

Nenhum critério sai da conta do juiz. A saída não tem `score` nem `passed` — tem
`violations` (achou algo, evidência forte), `notDetected` (este leitor não achou nada, o que
**não** é atestado de saúde) e `unjudged` (faltou insumo).

Isso é consequência do 0%: uma camada sem cobertura completa não tem como publicar "85%
aprovado" sem contar silêncio como conformidade. Como ela não pode dizer "passou", ela não
pode mentir.

## O que falta, e por que está parado

O rubric sai com `thresholds: null` **de propósito**. Uma barra de aprovação não se
inventa a partir de priors de gosto — o handoff do eval é explícito que o moat são os
critérios do usuário, não um checklist genérico. Inventar um threshold faria o eval
parecer pronto medindo nada.

Bloqueado em duas entradas que só o Adilson tem:

1. **Gold references** — 3 a 5 saídas que ele considera excelentes (links, screenshots
   ou nodes passados). É contra elas que a barra se calibra.
2. **A assinatura anti-slop explícita** — confirmar e estender a lista. Conhecidos até
   aqui: keyline decorativa em cantos arredondados, itálico gratuito, mono para números
   em vez de tabular-nums, eyebrow com tracking largo, famílias Inter/Bricolage/JetBrains,
   selos de confiança falsos.

Alternativa que dispensa (1): o **banco de referências com pesos** (pendência 1 do handoff
de 07-22) — foi desenhado justamente para substituir as refs-ouro estáticas. Se ele
existir primeiro, o rubric calibra a partir dele.

### Ainda não construído (depende do desbloqueio acima)

- **Fixtures** (`cases/`): 5-10 inputs congelados — 2-3 transplantes imagem→site, 2-3
  clones, 1-2 composes puros. Congelado = arquivos no repo, para toda run ver o mesmo input.
- **Runner**: chama os seams REAIS (`runCompose`, clone, `demarcelize`) e renderiza via
  `lib/site-screenshot.js`, gravando em `out/<run-id>/`.
- **Juiz de visão**: cada check `method:"judge"` já vem com a pergunta pronta no
  `rubric.json`. Rodar 2-3× por check e votar por maioria — juiz single-shot é ruidoso.
  Onde houver `alsoDeterministic:true`, o check barato roda antes e o `deterministicBlindSpot`
  diz ao juiz o que ele precisa cobrir.
- **Controle de custo**: imprimir estimativa antes de rodar, suportar `--only <case>`,
  juiz no modelo de visão capaz mais barato. Cada run completa é gasto real de API.

## Regra de manutenção

Critério mudou em `house-style.js` → **regenerar o `rubric.json`**. O `--check` existe
para o CI pegar quem esquecer. O rubric é uma projeção dos guardrails, nunca uma segunda
fonte de verdade — foi assim que a lista original de 53 critérios se perdeu
([proveniência](../../../../docs/superpowers/specs/2026-08-12-anti-slop-lista-1-53-proveniencia.md)).
