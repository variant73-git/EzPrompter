# Handoff — seek silencioso shipado; o que resta

**Branch** `codex/live-animated-clone-editing` · HEAD `66ff038d` · 20 commits de
feature (`40c40186`→`3a3c3607`) · suíte **1645 passed | 10 skipped** · 6 witnesses
da frente exit 0 · árvore limpa.

Contexto completo: `2026-08-07-tabela-b-medida-finding.md` (§1 vereditos, §4
obrigações, **§4b residuais**, **§4c encerramento da auditoria**) e o plano
`2026-08-07-supressao-seletiva-de-callbacks-no-seek.md`.

---

## 1. O que está pronto

A janela `withSeekLifecycleSilenced` (acima de `seekTimeline` em
`runtime-bridge-source.js`) silencia os **quatro** callbacks de ciclo de vida em
volta de UMA escrita de relógio, mantendo o `onUpdate` vivo.

**A garantia, na forma exata que a medição sustenta — não arredondar ao citar:**
> nenhum disparo ocorre **enquanto o slot permanecer anulado**. Um callback volta
> a disparar se o slot DELE receber uma função **antes do ponto de despacho dele**
> naquele render — **independente da identidade** (reinstalar a MESMA função
> dispara igual). Reescrever depois do despacho, ou escrever chave que não é de
> ciclo de vida, **não** reabre.

---

## 2. O que resta — em ordem de dependência

### 2.1 ⚠️ B5 — o único item que impede declarar a feature FECHADA

O que existe: prova de que **nosso código não instala** callback de ciclo de vida
em animação do site (busca sem filtro de extensão em `app/ components/ lib/ hooks/`).

O que **falta**: witness comportamental provando que nenhum consumidor NOSSO
dependia **indiretamente** de um EFEITO que esses callbacks produzem. Busca não
resolve isso — só um witness que exercite o caminho real dos consumidores
(seleção → seek → operação posterior que poderia depender do efeito).

**Enquanto isso não existir, a feature é "shipada com B5 parcial", não "fechada".**
Quem retomar: não escrever em nenhum lugar que a feature está fechada sem isto.

### 2.2 O caminho do ScrollTrigger — a segunda porta, nunca medida

A régua do editor **rola a página** (modelo de "régua única" da frente). Rolar é
outro caminho, e ScrollTrigger tem callbacks próprios (`onEnter`/`onLeave`/
`onToggle`/…) que este fork **não toca**. Se a regra de produto é "o editor é
silencioso", essa porta pode furá-la inteira — e **nada foi medido** sobre ela.

Primeiro passo honesto: um probe que verifique se o scrubber realmente dispara
reações de ScrollTrigger no clone real, antes de qualquer desenho. Vale o mesmo
protocolo desta frente: controle de sensibilidade por braço, pré-render, dano
medido no tick seguinte.

### 2.3 CSS/WAAPI (B4)

Fora de escopo por decisão do handoff original. WAAPI **não tem** `suppressEvents`;
pode não haver mecanismo, e aí a saída honesta é documentar como limitação em vez
de fingir que a regra vale ali.

### 2.4 Residuais aceitos (não são pendência — são contrato)

Estão em **§4b** do finding, com teste fixando cada um onde aplicável:
1. animação **destacada** é invisível ao inventário (`globalTimeline`);
2. fail-closed **por nó**, não pelo arrasto inteiro (decisão do Adilson);
3. nenhum seek roda enquanto a janela decide ou mexe em `vars`;
4. instalação atômica por nó, com pós-condição e revalidação do nó;
5. **remoção indistinguível ressuscita** a reação;
6. **B5 aberto** (ver 2.1).

### 2.5 Fila da frente, que estava pausada

Task 16 (gate persistido `/canvas`), **Tasks 12–20** — env Neon isolado
`ep-orange-frost-acaedcil`, **nunca produção**. Ver item 167 do CLAUDE.md.

---

## 3. Decisão de escopo que NÃO deve ser reaberta sem gatilho

**Site adversarial está FORA do modelo de ameaça desta feature** (decisão do
Adilson, 2026-08-09), junto com o residual r46 do item 171 e sob os **mesmos sete
gatilhos** (handoff `2026-08-01-phase2-timeline-shipped-r46-residual-handoff.md` §3).

Fundamento **medido**: a janela não referencia manifesto/transação/histórico/
`postMessage`; o site já roda no mesmo realm o tempo todo, então um trap dá
**momento**, não capacidade — e o momento está fechado nas três portas; o dano
medido é o site hostil sabotando o clone de si mesmo.

⚠️ **Quem retomar não deve reabrir isto por conta própria.** As 6 últimas rodadas
de auditoria perseguiram essa classe e a rodada 10 provou que ela **não fecha**.
Reabre-se por **gatilho** — clones compartilhados entre usuários, segredos no
realm do clone, bridge com rede/credenciais, mutações em lote, promessa de
desfazer exato — e aí reabre junto com o r46.

---

## 4. Como não repetir os erros desta sessão

Quatro modos de falha meus, cada um com o instrumento que os pegou:

- **Verde vácuo por medir o estado final** quando a pergunta era sobre o meio —
  aconteceu **três vezes**. Se a pergunta é "algo aconteceu durante X?", contar o
  evento durante X; o estado depois de X frequentemente está certo e esconde.
- **Apagar um teste deixa a suíte VERDE.** Uma edição por fatia comeu um teste
  inteiro; quem pegou foi a **contagem** (370→369). Conferir contagem após
  reescrever bloco de teste.
- **Substituição que não casa passa silenciosa** — uma correção minha num doc
  nunca entrou e o commit afirmava que sim. Asserir que o alvo casou.
- **Mesma obrigação corrigida em rodadas seguidas = instância, não regra.** A
  travessia caiu 2×, o TOCTOU 3×. O sinal de alarme é o **reincidir**.

E o de método, que vale mais que os quatro:
**rigor sem modelo de ameaça vira esteira** — antes de gastar rodada numa classe,
perguntar de quem é o dano e até onde ele chega.

---

## 5. Estado do repo

Nada pendente. `git status` limpo fora de pastas de build (`.next-*`) e dos
`.firecrawl/` que já eram untracked antes desta frente.
