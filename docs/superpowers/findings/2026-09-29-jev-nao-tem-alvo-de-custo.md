# Finding — o JEV não tem alvo de redução de custo no produto atual

> **Data:** 2026-09-29 · **Estado:** medido no código; zero chamadas ao JEV feitas (não era preciso).

## 1. A pergunta certa

O JEV é modelo de saída tipada, **só texto**, ~US$ 0,00001 por decisão. Ele substitui
exatamente uma coisa: **julgamento de LLM sobre texto** (sim/não, uma-de-N, nota). Então
antes de mapear "oportunidades", a pergunta é: **onde o produto gasta isso hoje?**

## 2. Levantamento de TODAS as chamadas de LLM do web-shell

| módulo | modalidade | papel | JEV substitui? |
|---|---|---|---|
| `lib/reconstruct.js` (iter9) | **visão** (screenshot) | geração de HTML | não — não vê imagem |
| `lib/extract-llm.js` | **visão** | geração de HTML | não |
| `lib/design/style-extract.js` | **visão** (`callVision`) | extração | não |
| `lib/design-md.js` | texto | **geração** de documento | não — não escreve texto |
| `lib/run-flow.js` (compose) | texto + imagem | **geração** | não |
| `lib/demarcelize.js` | texto | geração | não |
| `lib/agent/*` | texto | geração/ferramentas | não (ver abaixo) |

E no **caminho do clone nativo** (`lib/native-clone/*`, `clone-router`, `classify-site`,
`challenge/*`): **zero chamadas de LLM.** `classify-site` decide por cobertura de texto +
`visualDiff` (determinístico). A detecção de challenge é textual e determinística. O
roteamento de motor "decide by source kind" (`run-flow.js:16`). A classificação de
ferramentas do agente (`safe|destructive|needs_choice`) é **campo declarado**
(`registry.js:6`), não julgamento de modelo.

**Conclusão:** não existe, hoje, uma chamada de LLM que faça classificação de texto. O
JEV não substitui nenhum gasto existente.

## 3. E a etapa 6 do verbatim?

Já medida (`2026-09-29-segunda-cobaia-e-mapa-jev.md`, extrator `verbatim-traces.mjs`):
depois da triagem determinística + passada pelo DOM, o resíduo é **~25 ocorrências por
site**. A US$ 0,00001 cada, a "economia" é US$ 0,00025 — e 25 decisões cabem num prompt
de agente. Não paga ali tampouco.

## 4. O que o JEV É, então

Uma **capacidade nova a custo quase zero**, não um corte. As frentes que o Astra listou
(classificação de site/stack, recomendação de motor, triagem de tráfego pós-captura,
famílias de animação no inventário, papel semântico de seção/camada, conteúdo × decoração,
escolha de nome entre candidatos) são todas **julgamentos que hoje NÃO existem** —
resolvidos por regra, ou simplesmente não feitos. Adotá-lo é decisão de **produto** por
frente ("vale ter esse julgamento?"), avaliada com o protocolo corrigido do Astra
(rótulo independente, holdout por site e por hash de biblioteca, denominador real).

A única exceção futura: o **motor verbatim como agente** (item 3), quando existir, terá
julgamentos textuais (inventário da etapa 4). Aí o JEV volta a ser candidato — para
*aquele* fluxo, quando ele existir e for medido.

## 5. Consequência para a ordem do trabalho

A instrução era "construir a versão cara, depois considerar o JEV para reduzir custo
onde couber". A medição mostra que, no produto de hoje, **não cabe em lugar nenhum**.
O item 2 fecha aqui; o JEV só volta à mesa junto com o item 3.
