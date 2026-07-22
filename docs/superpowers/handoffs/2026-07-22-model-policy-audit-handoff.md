# Handoff — Auditoria de política de modelos (Claude × Sol, 2026-07-22)

> Contexto: auditoria vault (Brain) × código, pedida pelo dono, com Sol (Codex)
> como segundo auditor. Aplicado nesta branch (preview/soma): escada do
> orquestrador corrigida (pro=Flash), picker restrito à criação, pins por seam,
> mitigação de clone. Este doc registra o que FICOU PENDENTE (estrutural).

## Decisões validadas (vault é a autoridade)

- **Orquestrador = gemini-2.5-flash** (free E pro; enterprise=sonnet). Fonte:
  `Decisões/Modelo operador vs modelo de conteúdo.md` (eval promptfoo: Flash 82%
  × 71% gpt-4o-mini, modo de falha mais seguro) + checkpoint 2026-07-06 (Flash
  7/7 × 2/7) + `Estratégia/Billing - Monetization.md` ("Free=Flash, Pro=Flash,
  Enterprise=Sonnet"). O código estava com pro=gpt-4o-mini — DRIFT corrigido.
- **Picker do chat = só criação de sites** (compose/edit-site/imagem via
  ctx.pickerModel). O picker-vence-no-orquestrador (2026-06-19) era workaround
  para Gemini prepaid-depleted; chave hoje fundeada. `resolveAgentModel` e
  MODEL_ALIAS da rota removidos; testes atualizados (contrato morto eliminado).
- **Pins por seam**: extract=`gemini-2.5-flash` (A/B vs 3.1-pro: mesmos tokens
  de ground truth, 2× mais rápido, ~10× mais barato) · restyle=`gemini-3.1-pro`
  · compose=`GPT-5.5` (A/B: modelo forte compra COMPOSIÇÃO, não fidelidade de
  token — flash acerta paleta mas empilha; GPT-5.5 desenha).

## Achado do Sol (confirmar e corrigir — PENDENTE, invasivo)

**O circuit breaker mascara erros não-retriáveis.** `lib/agent/circuit.js:53`
registra um `fallback()` que relança tudo como `code='circuit_open'`; no
opossum, o fallback roda em QUALQUER falha (node_modules/opossum/lib/circuit.js:941),
não só com circuito aberto. Consequência: o 400 "credit balance too low" da
Anthropic vira `circuit_open` → `driver.js:569` considera retriable → failover
silencioso. **Clone "em Opus" degrada pra Flash sem avisar** — pior que quebrar.
Os testes de "400 não faz fallback" mockam o LLM direto, sem breaker: a
composição breaker→driver NÃO está coberta.

### Correção durável proposta (sessão própria)
1. Remover o fallback do breaker que apaga o erro original.
2. Normalizar erros por semântica: `invalid_request` / `auth` /
   `provider_balance` / `rate_limit` / `outage` / `timeout`.
3. Só `provider_balance`, 429, 5xx, circuito aberto e timeout são failover-elegíveis;
   400 malformado e 401/403 fora da contagem do breaker.
4. **Política de fallback por operação**: chat comum Flash→econômico; clone
   Opus→GPT-5.5 (nunca Flash — fail closed se ambos indisponíveis); enterprise
   Sonnet→fallback aprovado ou erro claro.
5. Failover sticky pelo resto do run (hoje cada iteração recomeça no primário).
6. Nunca failover após emitir texto/tool-calls parciais sem rollback (risco de
   saída duplicada no stream).
7. Teste de integração da composição breaker→driver→fallback.

## Outros apontamentos do Sol (menores, pendentes)

- `isCloneRequest` é regex por MENSAGEM: "agora corrija o header" (continuação
  de clone) volta pro Flash; "capture esta imagem" pode forçar Opus sem ser
  clone. Modo clone deveria ser sticky no run/thread.
- Enterprise com Sonnet seco = indisponibilidade de tier se houver QUALQUER
  tráfego enterprise — decidir fail-closed vs fallback aprovado.

## Mitigações ativas nesta branch

- `.env.local`: `UNCRAFT_CLONE_MODEL=gpt-5.5` (clone previsível enquanto
  Anthropic estiver seco) + pins de extract/restyle.
- Smoke da rota real de clone (POST /api/chat com tools) ainda não rodado —
  fazer antes de confiar no caminho completo (recomendação do Sol).
