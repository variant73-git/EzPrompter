# Spec — Idempotência de operação lógica no billing (dedup de retry / money-safety)

> **Data:** 2026-07-24 · **Origem:** brainstorm com o Adilson a partir do handoff `docs/superpowers/handoffs/2026-07-24-logical-idempotency-brainstorm-handoff.md` (furo descoberto pelo audit do Sol). **Alto risco — mexe em dinheiro e na borda da API.**
>
> **Sequência:** esta spec → plano → **TDD** → **review adversarial do Sol** (regra da casa: dinheiro sempre passa pelo Sol; aqui, ao longo do caminho).
>
> **Já feito antes (não refazer):** o settlement virou **atômico** (commit `5a276baa`) — `settleOperation`/`grantCredits` rodam via `sql.transaction([...])`. Esta spec fecha o que aquele fix **não** fecha.

---

## 1. Problema (money-safety, concreto)

O billing hoje (`lib/billing/context.js` → `lib/billing/ledger.js`): `runBilledOperation` **reserva** (`holdCredits` — deduz o estimado do saldo, um commit) → roda a operação → **acerta** (`settleOperation` — cobra o real, devolve a diferença; agora atômico). Cada chamada gera `opId = randomUUID()` fresco, **consumido em lugar nenhum** fora do billing (grep vazio) — por isso não deduplica nada.

**Dois furos que o atômico NÃO fecha (Sol audit 2026-07-24):**

1. **Cobrança dupla no retry.** Uma op paga commita o resultado (node/snapshot), cobra, e **então perde a resposta** (rede cai depois do commit; ou o `Promise.race` do agente rejeita mas o `tool.execute` continua rodando por baixo — `lib/agent/driver.js:506` — e o modelo re-chama a tool). O pedinte (cliente/agente) **re-executa** → novo opId, novo hold, nova cobrança, novo artefato. Nada liga o retry à ação concluída → **a mesma ação lógica é cobrada 2×**.
2. **Hold encalhado.** O hold é um commit **separado e anterior** ao settlement. Se o settlement falha (mesmo atômico, ele faz rollback de si mesmo), o hold **permanece deduzido**, sem registro de acerto → saldo debitado a mais, órfão.

**Por que `opId` fresco não resolve:** o opId é único **por tentativa** — é justamente o que *impede* a dedup. A dedup tem que ser por **AÇÃO LÓGICA**, não por tentativa.

---

## 2. Regra de produto (cravada pelo Adilson — é o que decide o design)

- **Resultado consistente, não roleta.** Mesma entrada → resultado muito próximo do já entregue. Não existe "rodar de novo pra ganhar uma variação".
- **Re-run deliberado sempre paga.** Se o usuário escolhe rodar de novo mesmo já tendo um resultado, é uma ação nova e cobra.

Consequência: **não há "refazer de graça" nem "variação".** Isso **elimina a necessidade de qualquer janela de tempo** no dedup. O único caso a proteger é o **acidental** — o mesmo pedido entregue 2× porque o pedinte não recebeu a resposta.

**Vetores de retry reais** (nenhum é duplo-clique humano — o botão da UI desativa no clique e só volta com o resultado):
- **Resposta perdida** — servidor cobrou+criou o node, a resposta não voltou; o cliente reenvia.
- **Agente re-chama a tool** depois do falso-timeout de 3 min — automático, imediato, sem UI; o modelo **não sabe** que está repetindo.

---

## 3. Decisões travadas

| # | Decisão | Escolha |
|---|---|---|
| Postura | Prevenir vs detectar depois | **Prevenir (idempotência no hot path) + rede de segurança pra holds órfãos** |
| Mecanismo da chave | Etiqueta do pedinte vs derivada vs janela de tempo | **Etiqueta do pedinte (idempotency key) é o mecanismo PRINCIPAL.** Só o pedinte sabe distinguir "estou re-pedindo a mesma resposta que não chegou" de "estou pedindo de novo de propósito" — nem o relógio nem o conteúdo acertam os dois |
| Cliente (HTTP) | — | Gera a etiqueta ao disparar o gesto pago, **persiste** enquanto a ação está no ar, e **reusa no reenvio**. Clique novo de propósito → etiqueta nova → **paga** (regra §2) |
| Agente | — | O modelo não carrega etiqueta estável (falso-timeout esconde o sucesso) → etiqueta **derivada por run**: `hash(runId + tool + input_normalizado)`, só pra ligar a re-chamada à original |
| Janela de tempo | Curta vs generosa vs nenhuma | **NENHUMA.** A regra §2 removeu os dois únicos motivos da janela (variação, refazer-de-graça). Sem janela fuzzy. Único timer que sobra: TTL de reconciliação de holds presos (§7) — outro assunto |
| Retry no meio | Dedup-only vs resume | **Dedup-only:** terminou → retorna resultado gravado; rodando → "em andamento"; preso/morto → reconciliação expira+devolve |
| Escopo | Só pagas vs toda `runBilledOperation` | **Só as ops pagas** (`extract.*`, `run`, `images/generate`, `edit-site`, `run-flow`, `create-image`, `deferred-reconstruction`). `runMeteredOperation` não precisa |

---

## 4. Modelo de dados — tabela `operations` que absorve o hold

Uma linha por **ação lógica**. O `opId` atual (hoje descartável) vira o `id` durável.

```sql
CREATE TABLE IF NOT EXISTS operations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idem_key       TEXT NOT NULL,          -- a etiqueta do pedinte (ou a derivada do agente)
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  op             VARCHAR(40) NOT NULL,   -- extract.designmd, clone, create-image…
  board_id       UUID,
  node_id        UUID,                   -- node de ORIGEM (não o artefato criado)
  status         VARCHAR(12) NOT NULL,   -- in_flight | settled | failed | expired
  hold_credits   BIGINT DEFAULT 0,       -- o hold vive AQUI, não solto no saldo
  charge_credits BIGINT DEFAULT 0,
  result         JSONB,                  -- a RESPOSTA gravada p/ replay no dedup + ref do artefato criado
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  settled_at     TIMESTAMPTZ,
  UNIQUE (user_id, idem_key)
);
CREATE INDEX IF NOT EXISTS operations_user_status ON operations(user_id, status);
CREATE INDEX IF NOT EXISTS operations_inflight_age ON operations(status, created_at);  -- p/ a varredura
```

**Ponto-chave:** o hold deixa de ser um débito solto no saldo e passa a ser um campo da linha. Consequência — "hold órfão" vira simplesmente **linha `in_flight` que nunca liquidou**, que a §7 acha por query determinística (não por adivinhação).

**Papel da tabela:** `operations` é a tabela de **coordenação/dedup** — guarda a linha por `(user_id, idem_key)`. O **audit imutável de dinheiro continua onde está** — `credit_ledger` (cada movimento de crédito) e `usage_events` (cada chamada de IA), inalterados. Perder histórico na linha de `operations` nunca perde o rastro contábil.

---

## 5. Fluxo do hot path (miolo novo — `runIdempotentOperation`)

```
1. idemKey = etiqueta do pedinte (cliente)  ||  hash(runId + tool + input_normalizado) (agente)

2. Transação A (reivindicar + segurar):
   INSERT INTO operations (…, status='in_flight', hold_credits=estimate)
   ON CONFLICT (user_id, idem_key) DO NOTHING RETURNING id
   + UPDATE users SET credits_cents = credits_cents - estimate
       WHERE id = userId AND credits_cents >= estimate   (só se o insert ganhou)

   ├─ INSERT ganhou            → somos donos; roda o trabalho (passo 3)
   │  (se o hold falhar por saldo → 402 InsufficientCredits; desfaz a linha na mesma tx)
   └─ conflitou → lê a linha existente:
        · status=settled    → retorna result gravado, cobra 0, NÃO roda, NÃO cria artefato   (DEDUP HIT)
        · status=in_flight  → responde "em andamento" (cliente/agente aguarda/retenta)
        · status=failed | expired → reivindica de volta e roda limpo:
             UPDATE … SET status='in_flight', hold_credits=estimate WHERE id=<row> AND status IN ('failed','expired') RETURNING
             0 linhas = alguém já reivindicou → trata como in_flight

3. Roda o trabalho (LLM + cria o artefato — DENTRO da unidade, ver §6).

4. Fim:
   sucesso → Transação B: cobra o real + grava result(resposta + ref do artefato)
             + status='settled', settled_at=now   [+ usage_events + credit_ledger, como hoje]
   falha   → Transação C: devolve o hold + status='failed'   [+ usage_events charge=0, como hoje]
```

Sem janela: uma re-entrada com a **mesma etiqueta** cai no ramo `settled` (retorna sem cobrar); um re-run deliberado tem **etiqueta diferente** (não colide, paga). O settle que falha deixa a linha `in_flight` → §7 devolve.

---

## 6. ⚠️ Contrato dos callers (o maior pedaço de escopo — APROVADO)

Pra o dedup **realmente** retornar o node existente sem re-criar nada, o efeito colateral (criar o node/snapshot) e a resposta HTTP precisam entrar **DENTRO da unidade idempotente**. Hoje, no extract, a criação do node acontece **fora** do `runBilledOperation`, na rota (linhas 113+) — o que quebraria o dedup.

**Mudança:** `runBilledOperation` vira `runIdempotentOperation({ …, idemKey }, fn)`, onde `fn` faz tudo (LLM + cria artefato) e devolve a **resposta final**; no dedup hit, pula o `fn` e devolve a resposta gravada. Cada caller pago passa a:
- (a) **receber a etiqueta** (header/campo do request, ou derivada no caso do agente) e repassá-la ao `runIdempotentOperation`;
- (b) **mover a criação do artefato pra dentro** do `fn`;
- (c) no dedup hit, **pular o efeito** e só replayar a resposta gravada.

**Ordem crash-safe:** cria o artefato → **depois** cobra+grava-result+`settled` numa transação (Transação B). Se cair no meio: linha `in_flight`, **sem cobrança**, artefato órfão sem referência → §7 devolve o hold e o retry roda limpo. Custo residual: no máximo **1 node órfão**, **nunca cobrança dupla**.

**Callers a migrar (5–7):** `app/api/nodes/[id]/extract/route.js`, `app/api/nodes/[id]/run/route.js`, `app/api/images/generate/route.js`, `lib/agent/tools/edit-site.js`, `lib/agent/tools/run-flow.js`, `lib/agent/tools/create-image.js`, `lib/deferred-reconstruction.js`.

> **Não é drop-in no billing — é tocar cada caller pago.** É o que torna o dedup honesto.

---

## 7. Rede de segurança (reconciliação de holds órfãos)

Varredura periódica (job leve / cron) que:
- acha linhas `in_flight` mais velhas que um TTL de segurança (ex. 10 min — acima de qualquer op real; o mais lento, reconstruct, leva 2–3 min);
- **devolve o hold** (transação atômica que credita `hold_credits` de volta ao saldo + `credit_ledger` reason `refund`) e marca a linha `expired`.

Como o hold vive na linha, é query determinística. É o backstop pro caso raro do settle que falha (furo #2). **Este é o ÚNICO timer do sistema** — não confundir com "janela de dedup" (que foi eliminada pela regra §2).

---

## 8. A etiqueta no cliente (agora em escopo — a regra §2 exige)

O navegador, ao disparar um **gesto pago**:
1. **gera** uma etiqueta única (uuid) para aquele gesto;
2. **manda** a etiqueta no request (header `Idempotency-Key` ou campo no body);
3. **persiste** a etiqueta enquanto a ação está no ar (memória; e um espelho durável — ex. localStorage/keyed pela ação — pra sobreviver a um reload no meio);
4. **reusa** a mesma etiqueta se **ele mesmo** precisar reenviar (não recebeu resposta);
5. **descarta** ao confirmar a conclusão. Um novo gesto deliberado gera etiqueta nova → **paga**.

**Borda do reload:** se o usuário recarrega a página no meio (perdeu a resposta) e re-dispara, a etiqueta em memória some. Pra não cobrar 2× nesse caso, o passo (3) mantém um espelho durável da etiqueta **pendente** por ação; ao recarregar, o cliente reusa a etiqueta pendente em vez de gerar nova. Detalhe de implementação fechado no plano.

---

## 9. Concorrência + atomicidade

- **Corrida de dois retries:** o `INSERT … ON CONFLICT DO NOTHING RETURNING` decide o vencedor atomicamente; o perdedor lê a linha e cai no ramo `settled`/`in_flight`. Reivindicação de `failed/expired` via `UPDATE … WHERE status IN (…) RETURNING` — 0 linhas = alguém já reivindicou → trata como `in_flight`.
- **Atomicidade:** tudo via `sql.transaction([...])` do neon (primitivo já verificado, funciona pelo Proxy do `db.js`). Transações A / B / C do §5.
- **Nota do Sol (handoff §3):** o fake de teste não modela rollback de verdade — o teste de atomicidade/rollback precisa de **Neon/Postgres real** (teste de integração), não só o mock class-based.

---

## 10. Testes (a lógica-chave)

1. **Retry-dedup:** mesma etiqueta 2× → **1 cobrança, 1 artefato** (o 2º retorna o gravado).
2. **Re-run deliberado:** etiqueta nova, mesmo input → **cobra de novo** (regra §2).
3. **In-flight:** retry enquanto roda → "em andamento", sem 2º hold.
4. **Órfão:** linha `in_flight` velha → reconciliação devolve o hold + `expired`.
5. **Corrida:** dois inserts simultâneos → um ganha, um dedup.
6. **Crash entre artefato e settle:** linha fica `in_flight`, sem cobrança; reconciliação devolve; retry limpo (≤1 órfão).
7. **Agente re-chama a tool** (mesmo runId+tool+input) → dedup, 1 cobrança.
8. **Integração real (Neon):** rollback/atomicidade das transações A/B/C.

---

## 11. Escopo fora / YAGNI

- **Resume de op no meio** — descartado (as ops são unidade única, não saga).
- **`runMeteredOperation` (não-cobrado)** — fora de escopo.
- **Limpeza de nodes órfãos** — o caso é raro (≤1 por crash) e não é money-safety; tratar só se aparecer em campo.

---

## 12. Residuais conhecidos aceitos

- **≤1 node órfão** por crash entre artefato e settle (sem referência, sem cobrança). Aceito.
- **Reload no meio sem espelho durável da etiqueta** — se o passo §8(3) falhar em persistir (ex. localStorage indisponível), o re-dispara pós-reload pode cobrar 2×. Mitigado pelo espelho durável; o backstop de reconciliação **não** cobre isto (é cobrança dupla, não hold preso). Fechar o espelho no plano.
