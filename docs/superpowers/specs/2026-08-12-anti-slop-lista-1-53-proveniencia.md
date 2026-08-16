# Proveniência da lista 1-53 (critérios anti-slop) — o que sobreviveu, o que derivou, o que se perdeu

> **Por que este doc existe.** Em 2026-08-12 procurei "o eval de 53 critérios" e não achei —
> porque ele nunca existiu como eval, e porque nada no repo se chama assim. O número 53
> aparece **uma vez**, no meio de uma frase de um handoff. Este doc é o índice que faltava:
> onde os critérios moram hoje, quais dos 53 originais sobreviveram, e o que é
> irrecuperável. Auditado contra o código, não contra memória.

**Onde o gosto mora hoje:** [`packages/web-shell/lib/design/house-style.js`](../../../packages/web-shell/lib/design/house-style.js)
— 39 critérios com chave `on` cada. Importado por `run-flow.js` (compose/transplante),
`demarcelize.js` (restyle) e `agent/prompts.js` (edit via agente). É código que roda, não doc.

---

## 1. Os fatos da proveniência

| Fato | Fonte verificada |
|---|---|
| A lista tinha **53 itens candidatos** | handoff 2026-07-22, linha 41 |
| Veio de um **cross-read de 6 skills**: taste-skill, interface-design, bencium, baseline-ui, make-interfaces-feel-better, shadcn | idem |
| **Itens 37-53 = conflitos** que o Adilson resolveu um a um | handoff 2026-07-22, §2 (17 rulings escritos) |
| **Itens 1-36 = consenso**, e "consenso, redundâncias e conflitos completos **ficaram na conversa da sessão**" | handoff 2026-07-22, linha 41 — declaração literal |
| O switchboard tem **39 critérios** (36 guardrails + absorb + invent + slop-test) | `listCriteria().length`, medido |
| **4 das 6 skills-fonte sumiram do disco**: interface-design, bencium, baseline-ui, make-interfaces-feel-better | `ls ~/.claude/skills`, `~/Desktop/IA/skills` |
| Sobrevivem: `taste-skill` (+ `gpt-tasteskill`), `shadcn` (como skill de plugin Vercel) | idem |

**A perda foi declarada no momento, não foi acidente.** A frase da linha 41 registra que a
lista bruta ficaria na conversa. Ninguém a moveu para arquivo depois.

---

## 2. Decisões 37-53 → onde cada uma está no código

Verificado item a item contra `house-style.js` e `agent/prompts.js`.

| # | Decisão | Critério no código | Estado |
|---|---|---|---|
| 37 | Fraunces + Instrument Serif **não** banidas | `type-no-ai-fonts` | ✅ íntegra, com `note` |
| 38 | mono banido; JetBrains vetado; hit area 44×44 adotada | `type-no-mono`, `type-no-ai-fonts`, `states-hitarea` | ✅ íntegra |
| 39 | (par de 38) mono banido | `type-no-mono` | ✅ íntegra |
| 40 | outline em **imagem** continua banido (imagem não é exceção) | — | ⚠️ **ausente**: `layout-border-shadow-conditional` fala de cards/containers; a nuance "imagem também" não está escrita em lugar nenhum |
| 41 | nem borda nem sombra salvo se fonte tem ou usuário pede | `layout-border-shadow-conditional` | ✅ íntegra |
| 42 | tracking negativo só no display grande; não alargar em caption/small | `type-tracking` | ⚠️ **número perdido**: a `note` foi reescrita em 2026-08-05 ("reference measurements override") e não cita mais a decisão 42. A regra derivou — hoje medição da referência manda, o prior genérico não |
| 43 | glassmorphism possível (só não reflexo) | `banned-glassmorphism-default` | ✅ íntegra |
| 44 | cursor customizado só sob pedido | `cursor-user-gated` | ✅ íntegra |
| 45 | bordas grossas + hard-shadows banidas; grain/mesh OK | `layout-no-thick-border-hardshadow` + `layout-atmosphere-ok` | ✅ íntegra (virou 2 critérios) |
| 46 | gradientes brand-appropriate permitidos, não encorajados | `color-gradients-brand` | ✅ íntegra |
| 47 | accent 1-3, cada um com função | `color-accent-count` | ✅ íntegra |
| 48 | motion por registro; feedback sempre | `motion-entrance-contextual` + `motion-feedback-always` | ✅ íntegra (2 critérios) |
| 49 | serif+sans OK, desencorajado como default | `type-serif-default` | ✅ íntegra |
| 50 | stagger 30-80ms conforme contexto | `motion-stagger` | ✅ íntegra |
| 51 | dark mode só quando existe | `darkmode-conditional` | ✅ íntegra |
| 52 | máx 1 pergunta por turno | `lib/agent/prompts.js:104` | ✅ íntegra, **fora** do house-style por decisão (é regra do agente) |
| 53 | literal da fonte; inventar só sem fonte | `content-real-numbers` | ✅ íntegra |

**Placar:** 15 de 17 íntegras e rastreáveis · 1 com o número perdido (42) · 1 sem
representação explícita (40).

---

## 3. Itens 1-36 (consenso) — o que dá para afirmar

Não são recuperáveis verbatim. A lista numerada não existe em lugar nenhum.

O que **é** recuperável, e é sólido: o handoff diz que cada conflito 37-53 virou um critério
com `note`. Segue que **todo critério sem `note` de decisão desceu da metade de consenso
(1-36)**. São 22, e esta é a única enumeração que existe deles:

**Conteúdo** — `content-exact-words` · `content-no-emoji-emdash`
**Tipografia** — `type-hierarchy` · `type-eyebrows` · `type-no-italic`
**Cor** — `color-no-pure-bw` · `color-no-ai-gradients`
**Layout** — `layout-proportions` · `layout-mobile-stable` · `layout-cards-lazy` ·
`layout-asymmetric-hero` · `layout-constrain-containers`
**Banidos** — `banned-decorative-italic` · `banned-side-stripe` · `banned-gradient-text` ·
`banned-hero-metric` · `banned-keyline` · `banned-modal-first`
**Motion** — `motion-transform-opacity`
**Meta** — `slop-test`
**Blocos condicionais** — `absorb-block` · `invent-block`

**Cuidado com a aritmética:** 22 critérios sem `note` **não** significam "22 dos 36
sobreviveram". Um critério pode ter fundido dois itens da lista, e um item pode ter virado
dois critérios (a 45 e a 48 fizeram exatamente isso do lado dos conflitos). O mapa 1-36 →
critério é o que se perdeu, não a substância — a substância está toda no código acima.

### ⚠️ Correção de 2026-08-12: esta seção superestimava a perda

A versão original deste doc tratava as skills sumidas como perda séria. **O Adilson
corrigiu**: o house-style é a DESTILAÇÃO — o cruzamento das skills virando critérios com um
booleano cada — e o propósito dela era justamente **tornar as skills dispensáveis**.
Material bruto se descarta depois de destilado. As skills terem sumido é o projeto
funcionando, não memória se perdendo.

Com isso, o que sobra de irrecuperável é bem menor:

1. A **numeração** 1-36 e o texto original de cada item — irrelevante na prática, já que a
   substância está toda nos 39 critérios.
2. A capacidade de **auditar se a destilação foi fiel**: sem as fontes, não dá para
   verificar se algo foi perdido no caminho. Este é o único resíduo real, e é estreito.

O que **não** é resíduo, ao contrário do que este doc dizia antes: "quais skills concordavam
sobre o quê". Numa destilação por intersecção, essa informação é o insumo, não o produto.

### As fontes, se alguém quiser auditar a destilação

Localizadas em 2026-08-12: `make-interfaces-feel-better` =
[jakubkrehel/make-interfaces-feel-better](https://github.com/jakubkrehel/make-interfaces-feel-better)
(2898★); `bencium` = [bencium/bencium-marketplace](https://github.com/bencium/bencium-marketplace)
(385★, contém `design-audit` — o mesmo citado na pendência 6 do handoff de 22/jul).
`taste-skill` segue em `~/Desktop/IA/skills/taste-skill` e `shadcn` como skill de plugin.
Faltam `baseline-ui` e `interface-design` (a org `Baseline-UI` no GitHub é biblioteca de
componentes, não skill).

---

## 4. Correções aplicadas junto com este doc

- Cabeçalho de `house-style.js` ganhou o bloco **PROVENANCE**, com os 3 gaps conhecidos
  (40, 42, 52) e a regra: **ao mudar um critério, preservar o número da decisão na `note`**.
  Perder o número foi exatamente como a 42 virou inrastreável.
- Este doc é o alvo do link no cabeçalho. `house-style.js` passa a ser o índice: quem chega
  no arquivo descobre de onde ele veio sem precisar saber que o handoff existe.

## 5. Regra de processo que teria evitado isto

A sessão de 2026-07-22 **sabia** que estava perdendo a lista — escreveu isso na linha 41 — e
seguiu em frente. A regra que falta no ritual [SALVAR]:

> Lista bruta que gerou decisões vai para arquivo, mesmo que só as decisões pareçam
> importar. Se ficou só na conversa, foi perdida — e escrever "ficou na conversa" não é
> preservar, é datar a perda.

## 6. O eval ainda não existe

Não há eval de 53 critérios, nem de 39. Existe o plano
([2026-07-06-anti-slop-eval-handoff.md](../handoffs/2026-07-06-anti-slop-eval-handoff.md)) e a
pendência 5 do handoff de 07-22: "esboçar o rubric espelhando o switchboard, cada critério →
1 check pontuado". O rubric mira este arquivo — o que torna a proveniência acima um
pré-requisito e não um exercício de arquivo morto.
