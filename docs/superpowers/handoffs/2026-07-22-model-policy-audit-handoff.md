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

> **✅ RESOLVIDO em 2026-07-22 (branch `fix/agent-failover-policy`, 4 commits:
> 356dceae witness → 1bbc68e2 taxonomia+breaker → 698dfebe política por
> operação → e36631a5 review round).** Ver seção "Estado pós-fix" no fim
> deste doc para o que entrou, o que foi rejeitado com razão, e as
> pendências que sobraram.

## Achado do Sol (confirmar e corrigir — RESOLVIDO, ver acima)

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
  **✅ Rodado em 2026-07-22** no fix da branch `fix/agent-failover-policy`:
  clone com Anthropic seco de verdade → SSE mostrou
  `provider_failover{anthropic→openai, reason:provider_balance}` na iter 1,
  ANTES de qualquer token, GPT-5.5 completou o run. Zero Flash no stream.

## Estado pós-fix (2026-07-22, branch `fix/agent-failover-policy`)

Os 7 pontos da correção proposta: **todos implementados** (suíte 802/802;
baseline era 766). Em resumo: `lib/agent/provider-errors.js` (taxonomia,
UM lugar, formas reais dos 3 SDKs), breaker honesto (erro original atravessa
categorizado; `circuit_open` só com circuito aberto; errorFilter tira
invalid_request/auth/provider_balance da contagem), elegibilidade por
categoria no driver, `FAILOVER_POLICIES` declarativa por operação (chat
escada; clone gpt-5.5↔opus fail-closed NUNCA Flash; enterprise fail-closed),
failover sticky, guarda de saída parcial, teste de integração da composição
real breaker→driver (o witness do bug, invertido pelo fix).

Review adversarial (2 lenses Claude + Codex Sol, síntese com adjudicação):
**7 fixes extras** — gating por época de attempt (stream pós-timeout não
contamina: texto/tools/usage), driver retorna `usedModelId` e a rota persiste
o modelo que SERVIU o run (registro não mente mais), auth sanitizado pro
cliente, `resolveCloneModel()` (env dual-bind não fura o invariante),
`billing_error`/wording real do Gemini/`APIConnectionTimeoutError`/408 no
classificador, chave do stash de breakers versionada (breaker velho com
fallback mascarador sobrevivia a HMR).

**Rejeitados com razão** (não são bugs): flag run-wide de no-failover
(mataria o failover sticky entre iterações, que é design); guard em
`UNCRAFT_AGENT_MODEL` (escape hatch explícito de dev/test); parsing fino de
quota do Gemini (limitação de telemetria aceita — quota diária sem wording
de billing conta pro breaker como rate_limit).

**Pendências que sobraram** (por ordem de valor):
1. **Failover invisível na UI** — `provider_failover` é emitido no SSE mas
   nenhum client (PromptDock/AssetSmartEditDock) renderiza; a troca de
   modelo não deixa rastro visível. UI nova era fora-de-escopo do fix.
2. **Clone-mode sticky no thread (Fase 4, não coube limpo)** — exige coluna
   de meta em `chat_threads` (migração Neon), reordenar o POST (thread antes
   da resolução de operação) e decisão de produto (quando o modo expira?).
   Sintomas: "agora corrija o header" volta pra política de chat; "capture
   esta imagem" força política de clone (custo + mensagem errada). O
   enforcement certo talvez seja por CAPACIDADE (tool captureUrl/runFlow sob
   orquestrador barato ⇒ escalar), não por regex.
3. **Texto parcial órfão persistido** — run que falha após streamar meia
   frase persiste o accumulatedText como turno assistant e o replay no turno
   seguinte.
4. **Enterprise sem retry** — chain vazia = um 429 transiente mata o turn;
   retry-once com backoff no MESMO provider não violaria a promessa de tier.
5. **Seam de conteúdo**: `runFlow` aceita `modelId` livre do agente (sem
   allowlist em run-flow.js) — caminho comportamental pro conteúdo cair em
   modelo fraco; e abort real (AbortSignal nos adapters) para matar streams
   pós-timeout no provider (hoje só descartamos os eventos).
