# Handoff (BRAINSTORM) — Idempotência de operação lógica / dedup de retry no billing (2026-07-24)

> **Para o próximo agente.** Isto NÃO é um plano de implementação — é o setup de um **brainstorm**. O problema é money-safety (cobrança dupla), foi descoberto pelo audit do Sol (2026-07-24) e **não** está fechado no código. **Rode a skill `superpowers:brainstorming` primeiro** (o Adilson decide as escolhas de design abaixo antes de qualquer código). Só depois: plano → TDD → review do Sol. Alto risco (mexe em dinheiro + na borda da API).
>
> Contexto que JÁ ESTÁ FEITO (não refazer): o settlement virou **atômico** (commit `5a276baa`) — `settleOperation`/`grantCredits` rodam via `sql.transaction([...])`, então o estado-pela-metade DENTRO do acerto está eliminado. Isto aqui é o que aquele fix **não** fecha.

---

## 1. O problema (concreto, money-safety)

O billing hoje: `runBilledOperation` (em `lib/billing/context.js`) **reserva** (`holdCredits` — deduz o estimado do saldo, um commit) → roda a operação → **acerta** (`settleOperation` — cobra o real, devolve a diferença, agora atômico). Cada chamada gera um `opId = randomUUID()` fresco.

**Dois furos que o atômico NÃO fecha (Sol audit 2026-07-24):**

1. **Cobrança dupla no retry.** Uma operação paga **commita o resultado (node/snapshot), cobra, e ENTÃO perde a resposta HTTP/tool** (queda de rede depois do commit; o `Promise.race` do agente não cancela o tool subjacente; o retry-budget do agente permite re-chamar). O cliente ou o agente **re-executa** → **novo opId, novo hold, nova cobrança, novo artefato**. Nada liga o retry à ação já concluída → **a mesma ação lógica é cobrada 2×**. (O fix da cobrança-dupla do extract em `1828254f` fechou o caso específico do *timing* cliente-vs-servidor no extract; ESTE é a classe geral, em qualquer op paga.)

2. **Hold encalhado.** O hold é um commit **separado e anterior** ao settlement. Se o settlement falha (mesmo atômico — ele faz rollback de si mesmo), o hold **permanece deduzido**, sem registro de acerto → saldo debitado a mais, órfão. (Loud-log já adicionado no sucesso e na falha — mas log não recupera dinheiro.)

**Por que opId fresco NÃO resolve** (o erro que a investigação anterior cometeu): a investigação parou em "nada re-roda o `settleOperation` do MESMO opId → idempotência é YAGNI". Está factualmente certo e **estrategicamente errado**: o opId fresco por retry é justamente o que **impede a deduplicação**. Um marcador `settled` por opId não ajuda — o opId já é único por tentativa. A dedup tem que ser por **AÇÃO LÓGICA**, não por opId.

---

## 2. A direção (a decidir no brainstorm — NÃO decidida)

A forma canônica: **idempotency key + registro durável de operação**. Uma chave estável que identifica a AÇÃO (não a tentativa) + uma linha durável que grava hold/settlement/resultado com **unique constraint** nessa chave. No retry: em vez de criar operação nova, **retorna o resultado existente** (se já concluiu) ou **retoma** (se ficou no meio).

**Perguntas do brainstorm (o Adilson decide):**

1. **De onde vem a chave?** Request-level (o cliente manda um header `Idempotency-Key`, padrão Stripe) vs tool-level (o agente gera/passa uma chave por invocação de tool) vs derivada (hash de userId+op+input). Cada um tem tradeoffs: header exige mudar o cliente; derivada é automática mas pode colidir/deduplica demais (duas ações genuinamente iguais viram uma).
2. **Escopo:** só as ops PAGAS (extract, clone, create-image, edit-site, deferred-reconstruction)? Ou toda `runBilledOperation`? Provavelmente as pagas.
3. **Tabela nova vs coluna:** uma `operations` durável (id lógico UNIQUE, userId, op, status: held|settled|failed, hold_credits, charge_credits, result_ref, created_at) vs estender o que existe. Onde o `opId` atual entra.
4. **Dedup vs resume:** no retry, se a op já está `settled` → retorna o resultado gravado (precisa gravar o resultado/aponta pro node criado). Se está `held` (ficou no meio) → retoma ou expira+reconcilia. Como lidar com o artefato (node/snapshot) já criado — não criar de novo.
5. **Reconciliação de holds órfãos:** um job/varredura que acha holds `held` velhos sem settlement e devolve? Ou TTL no hold?
6. **Concorrência:** dois retries chegam juntos → a unique constraint + `INSERT ... ON CONFLICT` decide quem ganha; o perdedor espera/lê o resultado.
7. **Interação com o hold-first:** o hold-first é o mecanismo "first-come-wins" de concorrência (spec §9). A operação durável precisa conviver com ele — provavelmente o hold vira parte da linha de operação.

**Referência de indústria:** Stripe idempotency keys (chave no header, resultado cacheado por 24h, mesmo request → mesma resposta). Vale ler antes do brainstorm.

---

## 3. Onde mexer (mapa pro brainstorm, não prescrição)

- `lib/billing/context.js` — `runOperation`/`runBilledOperation`: onde o hold + settle acontecem; onde a chave entraria e o dedup/resume viveria.
- `lib/billing/ledger.js` — `holdCredits`/`settleOperation` (já atômico): a linha de operação durável provavelmente encapsula esses.
- **Callers pagos** (a borda de onde vem a chave): `app/api/nodes/[id]/extract/route.js`, `lib/agent/tools/edit-site.js`, `lib/agent/tools/create-image.js`, `lib/deferred-reconstruction.js`. O agente: `lib/agent/driver.js` (retry-budget, `Promise.race` que não cancela o tool — `:402`, `:494`).
- `schema.sql` — a tabela nova (`operations`) + migração.
- Testes: precisará de teste de **retry-dedup** (mesma chave 2× → 1 cobrança) e de **hold órfão** — e o Sol notou que um teste de rollback de verdade precisa de **Postgres/Neon real** (o fake não modela rollback); considerar um teste de integração com DB.

---

## 4. Sequência sugerida
1. `superpowers:brainstorming` com o Adilson — fechar as 7 perguntas do §2 (especialmente #1: de onde vem a chave).
2. Plano (`superpowers:writing-plans`).
3. TDD (o dedup e o resume são a lógica-chave a testar) + teste de integração com DB pro rollback/atomicidade.
4. Review do Sol (regra da casa, é dinheiro).

## Regras da casa
- `main` (tronco), nunca `git add -A`, stage arquivos específicos.
- web-shell = bun, Vitest, mock class-based; neon `sql.transaction([...])` é o primitivo de transação (verificado 0.10.4, funciona via o Proxy do db.js).
- Validar mudança de dinheiro com o Sol.
- Detalhe do que já foi feito nesta linha: handoff `2026-07-23-audit-fixes-and-classifier-verify-architecture-handoff.md` §4.
