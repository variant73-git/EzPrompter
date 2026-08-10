# Handoff — tudo que ficou aberto (2026-08-10)

**Tronco:** `main` = `origin/main` = `bed7c276`, zero divergência.
**Suíte:** 1718 passaram | 17 puladas | **zero falhas**.
**Motion editor:** 591 testes, 27 arquivos; 6 witnesses da frente em exit 0.
**Branch** `codex/live-animated-clone-editing` preservada — a frente continua nela.

## Escopo deste documento

Cobre o que **esta sessão tocou ou verificou de primeira mão**, mais a fila
declarada da frente de motion. **NÃO** é uma auditoria dos residuais de frentes
antigas (billing/idempotência, política de modelos, componentização): esses têm
handoffs próprios e não foram reconferidos aqui. Quem precisar deles, ler os
handoffs correspondentes — não presumir que este documento os cobre.

---

## 1. Bloqueia declarar o seek silencioso FECHADO

### 1.1 B5 — witness comportamental de consumidor NOSSO

**Único item que impede dizer que a feature está fechada.**

O que existe: prova de que nosso código **não instala** callback de ciclo de vida
em animação do site (busca sem filtro de extensão em `app/ components/ lib/ hooks/`
— só 4 linhas em `runtime-bridge-source.js`, todas de configuração/strip).

O que falta: witness provando que nenhum consumidor NOSSO dependia
**indiretamente** de um EFEITO que esses callbacks produzem. Busca não resolve —
precisa exercitar o caminho real: seleção → seek → operação posterior que poderia
depender do efeito.

⚠️ **Enquanto isso não existir, escrever "shipado com B5 parcial", nunca "fechado".**

Detalhe em `2026-08-07-tabela-b-medida-finding.md` §1 (linha B5) e §4b item 6.

---

## 2. Portas nunca medidas (não são bugs conhecidos — são desconhecidos)

### 2.1 ⚠️ O caminho do ScrollTrigger

A régua do editor **rola a página** — é o modelo de "régua única" da frente.
Rolar é outro caminho, e ScrollTrigger tem callbacks próprios
(`onEnter`/`onLeave`/`onToggle`/…) que o seek silencioso **não toca**.

Se a regra de produto é "o editor é silencioso", **esta porta pode furá-la
inteira**, e nada foi medido sobre ela. Não é resíduo aceito: é área não
explorada.

Primeiro passo honesto: um probe que verifique se o scrubber dispara reações de
ScrollTrigger no clone real — **antes** de qualquer desenho. Mesmo protocolo da
frente: controle de sensibilidade por braço, pré-render, dano medido no tick
seguinte.

### 2.2 CSS/WAAPI (B4)

Fora de escopo por decisão do handoff original. WAAPI **não tem**
`suppressEvents`; pode não haver mecanismo, e aí a saída honesta é documentar
como limitação em vez de fingir que a regra vale ali.

---

## 3. Frentes de código incompletas

### 3.1 Task 16 — gate persistido `/canvas` (sub-tarefas 12–20)

Arnês de teste que dirige o `/canvas` real num navegador contra banco
descartável. Sub-tarefas 1–11 feitas (itens 166–167 do CLAUDE.md); **12–20
pendentes**, e a 14 mexe em código de PRODUÇÃO (seam de fault).

**Env:** Neon isolado `ep-orange-frost-acaedcil` — **NUNCA produção**. O `neondb`
de produto não qualifica.

### 3.2 Transplante (B1) — só probes, zero código de produção

Reparentear a instância viva para soltar um elemento do grupo. O gate vive na
**PUBLICAÇÃO**, não no writer: abrir B1 = fazer o stagger publicar `perTarget`.
Wrapper **aninhado** confirmado; externo refutado. Fila declarada no item 176:
probes 8/10/11 + resto do 12 **antes** de qualquer linha de produção.

Doc: `2026-08-06-b1-transplant-motor-probes-finding.md`.

---

## 4. Residuais ACEITOS (contrato, não pendência)

Do seek silencioso, todos em `2026-08-07-tabela-b-medida-finding.md` §4b, com
teste fixando cada um onde aplicável:

1. animação **destacada** é invisível ao inventário (`globalTimeline`);
2. fail-closed **por nó**, não pelo arrasto inteiro (decisão do Adilson);
3. nenhum seek roda enquanto a janela decide ou mexe em `vars`;
4. instalação atômica por nó, com pós-condição e revalidação do nó;
5. **remoção indistinguível ressuscita** a reação;
6. B5 aberto (§1.1 acima).

E o mais antigo, ainda vivo: **r46** — serializers/gates usam intrinsics do realm
da página; site adversarial poderia envenená-los. **Não é breach** — é integridade
do desfazer. Deferido por decisão sua, com sete gatilhos.

---

## 5. ⚠️ Decisão de escopo que NÃO se reabre sem gatilho

**Site adversarial está FORA do modelo de ameaça** do seek silencioso (decisão do
Adilson, 2026-08-09), junto com o r46 e sob os **mesmos sete gatilhos**.

Fundamento **medido**: a janela não referencia manifesto/transação/histórico/
`postMessage`; o site já roda no mesmo realm o tempo todo, então um trap dá
**momento**, não capacidade — e o momento está fechado nas três portas; o dano
medido é o site hostil sabotando o clone de si mesmo.

**Os sete gatilhos** (handoff `2026-08-01-phase2-timeline-shipped-r46-residual-handoff.md` §3):
segredos do usuário no realm do clone · clones compartilhados/publicados entre
usuários · importação de URL não confiável · bridge com rede/credenciais/filesystem ·
mutações automáticas em lote · monkeypatch real observado em campo · a Uncraft
prometer **desfazer exato** como garantia de produto.

⚠️ Quem retomar **não deve reabrir por conta própria**: as 6 últimas rodadas de
auditoria perseguiram essa classe e a rodada 10 provou que ela **não fecha**.
Reabre por gatilho, e aí reabre junto com o r46.

---

## 6. Higiene do repositório — dois pontos herdados

### 6.1 Os planos não são rastreadores confiáveis

`2026-07-26-live-animated-clone-editing-implementation.md`: **447 checkboxes, zero
marcados**. `2026-07-28-task16-persisted-e2e-gate-implementation.md`: **98, zero
marcados**. Muito do que está lá **foi feito** — mas o papel não sabe.

Consequência prática: **"quanto falta" não é legível dos planos.** A reconstrução
que fiz veio de dois rastros indiretos (mensagens dos commits e checkpoints do
CLAUDE.md), e é frágil nos dois sentidos: um commit pode citar uma tarefa sem
concluí-la, e uma tarefa pode ter sido feita sem citá-la.

**Reconstrução, com essa ressalva:** tarefas 1–12 têm commits; a 16 está parcial;
as 13, 14, 15 e 17 não aparecem no rastro (a 17 é "rollout em etapas", tipicamente
a última).

**Se quiser um número confiável**, é trabalho à parte: abrir cada tarefa do plano
e conferir contra o código. Vale a pena antes de qualquer conversa de "estamos
perto do fim".

### 6.2 `.gitignore` com alteração não commitada

`graphify-out/` foi acrescentado ao `.gitignore` e **está na árvore sem commit
desde antes desta sessão**. Não é da frente de motion nem da de referências. Foi
preservado de propósito em todo o merge (guardado e devolvido). Decidir e
commitar — ou descartar — é do dono da mudança.

---

## 7. O que a fusão com a frente Start from a Ref ensinou

O `main` remoto tinha andado **22 commits** de outra frente enquanto esta
trabalhava. A fusão exigiu resolver `package.json` (aditivo: 3 scripts de motion +
18 de `refs:`) e expôs uma fragilidade **herdada**: sete testes do banco de
referências quebravam em qualquer checkout limpo, porque dependiam de arquivos em
`.firecrawl/`, que é ignorado pelo git. Verifiquei rodando no `origin/main` puro —
não era contaminação da fusão.

A outra frente corrigiu (suíte padrão hermética + suíte de integração explícita
atrás de comando próprio), e isso já está no tronco.

**Lição para as próximas fusões:** duas frentes longas no mesmo repo divergem em
silêncio. Trazer o tronco **para dentro** da branch primeiro, resolver e testar
lá, e só então mover o ponteiro — assim o tronco nunca fica quebrado no meio.

---

## 8. Modos de falha desta sessão (para o próximo não repetir)

- **Verde vácuo por medir o estado final** quando a pergunta era sobre o meio —
  **três vezes**. Se a pergunta é "algo aconteceu durante X?", contar o evento
  durante X.
- **Apagar um teste deixa a suíte VERDE.** Uma edição por fatia comeu um teste
  inteiro; quem pegou foi a **contagem** (370→369).
- **Substituição que não casa passa silenciosa** — uma correção minha num doc
  nunca entrou e o commit afirmava que sim. Asserir que o alvo casou.
- **Mesma obrigação corrigida em rodadas seguidas = instância, não regra.** A
  travessia caiu 2×, o TOCTOU 3×.
- **Grep por substring engana**: `reference-bank-promotion` casa `motion`.
- ⭐ **Rigor sem modelo de ameaça vira esteira** — antes de gastar rodada numa
  classe, perguntar **de quem é o dano** e **até onde ele chega**. E não oferecer
  escolha binária quando falta o fato que decide.

---

## 9. Ordem sugerida para retomar

1. **B5** — é o que destrava chamar o seek silencioso de fechado, e é pequeno
   perto do resto.
2. **Probe do ScrollTrigger** — barato, e pode revelar que a regra de produto tem
   uma porta aberta que ninguém viu.
3. **Varredura de "quanto falta"** contra o plano — antes de qualquer promessa de
   prazo.
4. Depois disso: Task 16 (12–20) ou transplante B1, conforme a prioridade for
   qualidade de gate ou capacidade nova.
