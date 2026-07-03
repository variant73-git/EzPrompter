# Sistema de Créditos — medição dinâmica de custo + cobrança por operação

**Data:** 2026-07-03 · **Escopo:** `packages/web-shell/` · **Status:** aprovado em brainstorm, aguardando plano de implementação
**Decisões tomadas com o founder nesta sessão; valores marcados como [default] são ajustáveis na revisão.**

---

## 1. Objetivo e princípios

Medir o custo real de TODA operação de IA (tokens e imagens) e repassar ao usuário em créditos, com margem variável por operação.

Princípios decididos:

1. **Medir fino, cobrar grosso, arredondar uma vez.** Custo interno em micro-centavos exatos por chamada; cobrança em créditos múltiplos de 5, arredondada uma única vez no fim da operação, sempre pra cima.
2. **Conversar é grátis; resultado custa.** Chat leve (sem ferramenta executada) = 0. O mesmo resultado custa os mesmos créditos, seja pedido via chat, via ▶ da section ou via cordão manual — sem taxa por conversar.
3. **Captura é grátis; entregável custa.** Adicionar URL ao canvas (o *subject*) nunca cobra. Clonar — produzir o node editável do usuário — cobra.
4. **Multiplicador é alavanca de posicionamento.** Operações commodity ~3×; únicas no mercado (iter9) 10×+.
5. **Falha não cobra.** Operação que erra registra o custo (pro teto anti-abuso) mas devolve a reserva inteira.
6. **Nunca cobrança-surpresa.** Estimativa antes, bloqueio antes de gastar, débito visível depois.

## 2. Unidade e matemática

- **1 crédito = $0,01 de preço.** O saldo vive em `users.credits_cents` (coluna já esperada pelo `lib/credits.js`).
- **Custo interno em micro-centavos** (1¢ = 10.000 µ¢): `computeCostMicrocents()` na mesma `MODEL_PRICES` de `lib/agent/cost.js` (que passa a derivar dele). Uma chamada Flash de 0,152¢ = 1.520 µ¢ exatos — o `Math.round` pra centavo inteiro que zerava chamadas baratas morre.
- **Cobrança da operação:** `creditos = max(5, ceilParaMultiploDe5( Σ µ¢ × multiplicador / 10.000 ))` — com piso/fixo por operação quando definido (§3). Erro máximo de medição: meio µ¢ por chamada ($0,000005) — irrelevante, documentado.

Exemplo: turno de chat com 3 chamadas Flash = 4.560 µ¢ = $0,00046 de custo. Se leve → 0. Um clone de $0,53 × 4 = $2,12 → 215 créditos.

## 3. Tabela de operações (config em `lib/billing/pricing.js`)

| Operação | Regra | Créditos típicos |
|---|---|---|
| Captura de URL (adicionar site ao canvas) | **grátis** | 0 |
| Chat leve (nenhuma ferramenta executada) | **grátis** (medido, com cercas §5) | 0 |
| Clone de site normal (estático → node editável; zero tokens) | **fixo 25 [default]** | 25 |
| Reconstrução iter9 (site animado: Framer/Webflow/Lenis) | **10× com piso 150** | 150-250 |
| Clone / styleclone de imagem (GPT-5.5 vision) | 4× (limpeza de UI generativa entra DENTRO da mesma operação) | 215 limpo / 315-415 com regiões sujas |
| Imagem generativa (gpt-image-1 alta) | 4× | ~100 |
| Imagem generativa (Imagen fast) | 4× | ~20 |
| Compose de site (run-flow, 1 node) | 3× | 60-90 |
| Extracts (design.md, content, prompt, tokens, style) | 3× | 15-30 |
| Transplante / reskin / inject (demarcelize) | 3× | 75-80 |
| Edit de site via agente | 3× | conforme tokens |

Correção embutida: `IMAGE_PRICES` está desatualizada (6¢ = qualidade média; o adapter usa alta ~25¢) — parametrizar por qualidade.

**Roteamento honesto do clone de URL:** `detectAnimatedBuilder` já decide o caminho. Adicionar URL = captura grátis sempre. Quando a detecção aponta site animado, modal de escolha: *"Quick capture (free — animations frozen)"* vs *"Full AI reconstruction (~150-250 credits)"*; a reconstrução também fica disponível depois como ação no node ("Reconstruct"). Cobrança premium só com intenção explícita.

## 4. Flows: soma por node + arquétipos

- O ▶ da section executa uma cadeia; **cada node-operação cobra a si mesma ao completar** (falhou no meio = só pagou o que rodou; cada node pode exibir "−N" ao terminar).
- **Estimativa de cadeia:** conhecemos os nodes e cordões antes de rodar → o ▶ mostra *"Run flow ≈ N credits"* somando as estimativas; bloqueia se o saldo não cobre a soma; se um node intermediário não couber, a cadeia para ali com aviso claro.
- Estimativas iniciais por operação (recalibráveis com dados do ledger): clone 250 · styleclone 300 · compose 75 · transplante 75 · imagem 100 (GPT) / 20 (Imagen) · extract 30 · reconstruct 200 · clone estático 25.

**Arquétipos (o espaço real de flows — o sistema de tipos proíbe cadeias sem sentido; uso concentra nestes 8):**

| Arquétipo | Créditos típicos |
|---|---|
| Prompt → site | 60-90 |
| Clone de imagem (limpo / sujo) | 215 / 315-415 |
| Styleclone | 230-245 |
| Rebrand (extract md + transplante) | 90-105 |
| Captura + restyle (0 + extract + compose) | ~90 |
| Reconstrução iter9 | 150-250 |
| Pipeline de imagem (N iterações) | 20-100/iteração |
| Showcase completo (clone + extract + transplante + 2 imagens) | ~360 (Imagen) / ~515 (GPT) |

Testes unitários fixam a faixa esperada de cada arquétipo (§13).

## 5. Chat: grátis com cercas

Conversa nunca é cobrada — nem no run com ferramentas (os tokens do operador são custo de venda). Cercas contra flood/sabotagem:

1. **Rate limit** [defaults]: 10 mensagens/min; 150 turnos leves/dia no free ("Daily free chat limit reached — resultados cobráveis continuam disponíveis").
2. **Teto mensal de custo real** (já existe em `lib/credits.js`): conta TODO uso, inclusive grátis. Free tier [default $2]; pagante [default $50].
3. **Caps por run** (já existem): 10 iterações soft / 50 hard / timeout 10 min.

O medidor roda sempre: turno grátis gera `usage_events` com cobrança 0 — o perdão é só da cobrança, nunca da contabilidade.

## 6. Boas-vindas: 500 créditos + templates

- **+500 créditos**, uma vez, no cadastro com e-mail verificado (linha `welcome` no ledger). Retroativo para contas existentes na migração.
- **Compensação por FTUE**: templates de workflows prontos canalizam a exploração (tutoriais/tooltips; fora do escopo desta build, com um requisito exportado: **o template flagship deve custar ≤360 créditos** — usar Imagen nos nodes de imagem — e cada template exibe seu custo estimado antes de rodar).
- **Economia** (validada em sessão): custo real por pack integral ≈ $1,25-1,67; queima média realista com curva de ativação + templates ≈ **$0,55-0,60/cadastro**; 1.000 cadastros ≈ $550-600 únicos (não mensais). Conversão de planejamento: ~10% na coorte inicial, **3%** em escala (diluição por canal, não "lei logarítmica").

## 7. Camada de segurança contra bot farming

Cada conta nova vale ~$1,50 de inferência — farm de cadastros é extração de dinheiro em forma de computação. Defesas em camadas, todas na identidade e no orçamento (nunca em marcos de comportamento, que sufocariam a exploração livre):

1. **E-mail verificado mandatório** para usar a ferramenta em qualquer nível (dependência: §12).
2. **Blocklist de domínios descartáveis** (mailinator etc., lista mantida) + **normalização de plus-addressing** (`fulano+1@gmail` conta como `fulano@gmail` para unicidade do pack).
3. **1 pack por dispositivo/IP em janela de 30 dias** — contas extras criam normalmente, mas ganham 0 de boas-vindas.
4. **Orçamento global mensal de boas-vindas** [default: env `WELCOME_BUDGET_MONTHLY_CREDITS`] — estourou (pico viral ou ataque), novos cadastros recebem pack reduzido/fila + alerta ao admin. Teto de catástrofe escolhido, não sofrido.
5. **Rate limits** de operação [default 6 operações cobráveis/min] além dos do chat (§5).
6. **Teto mensal de custo real por usuário** (§5.2) — vale também pro que é grátis.
7. **Flags comportamentais (v1: só log)**: cadastro→operação cara em <60s; N contas do mesmo IP/dispositivo; ASN de datacenter. Alimentam consultas no ledger; enforcement automático fica pra depois, com dados.

## 8. Medição: contexto de operação + funis

**`lib/billing/context.js`** (AsyncLocalStorage): `runBilledOperation({ userId, op, boardId, nodeId }, fn)`:
1. Pré-voo: estimativa + **reserva atômica** (§9); insuficiente → `402 { error: 'insufficient_credits', estimate, balance }`.
2. Roda `fn`; qualquer funil no fundo da pilha chama `recordUsage(...)`/`recordImage(...)` no contexto — sem passar `userId` por parâmetro.
3. Fecho: grava `usage_events`, calcula a cobrança (§2), **acerta a reserva** e escreve o ledger numa transação.

**Aninhamento:** registro vai pro contexto MAIS INTERNO. `/api/chat` abre contexto `chat` só-medição (cobra 0); cada ferramenta executada (runFlow → `compose`, createImage → `image.generate`, editSite → `edit`, captureUrl → reconstrução quando aplicável) abre o próprio contexto. Uma cobrança por operação, nunca dupla.

**Funis instrumentados** (uma vez cada): `extract-llm.js` (callText/callVision) · `run-flow.js` (callLLM, 3 provedores) · `demarcelize.js` · `design/style-extract.js` · `design-md.js` · `reconstruct.js` · `image-gen/gemini-imagen.js` · `image-gen/openai-image.js` · adapters do agente (`llm-anthropic/openai/gemini.js`, que já devolvem uso — passam a registrar no contexto; `agent_runs` continua para status).

**Mapa rota → operação:** `nodes/[id]/run` → `compose` · `nodes/[id]/extract` → `extract.<to>` (clone/styleclone 4×; demais 3×; site→html = clone estático fixo 25) · `images/generate` → `image.generate` · `sections/rerun` → `compose` | `image.generate` (um contexto POR node da cadeia) · `snapshot/capture` → grátis (estático) ou `reconstruct` (após escolha explícita do usuário) · `/api/chat` → meter-only + ops das ferramentas · rotas demarcelize → `transplant`.

## 9. Reserva atômica (corrida com prioridade)

- **Pré-voo = hold:** uma única instrução SQL desconta a ESTIMATIVA condicionada a `saldo ≥ estimativa`. Quem chega primeiro ganha; o segundo já vê o saldo reduzido e recebe o 402 honesto. Sem estouro, sem absorção.
- **Fecho = settle:** custo real < estimativa → devolve a diferença; real > estimativa → cobra o excedente (pode encostar no piso 0 — excedente raro e pequeno); **falha da operação → devolve a reserva inteira** (falha não cobra; µ¢ ficam registrados no teto de custo).
- Ledger registra hold/settle como uma única linha final `charge` com `op_id` (o extrato do usuário mostra 1 débito por operação).

## 10. Dados e migração

**`usage_events`** (auditoria por chamada): `id, user_id, op_id, op, board_id?, node_id?, provider, model, tokens_in, tokens_out, cached_in, images, cost_microcents, charged (bool), meta, created_at`.

**`credit_ledger`** (fonte de verdade do histórico de saldo): `id, user_id, delta_credits, reason ('welcome'|'charge'|'grant'|'refund'|'purchase' reservado), op_id?, balance_after, meta, created_at`.

**`users`** (colunas que `credits.js` já detecta): `credits_cents` (o saldo de créditos — 1 crédito ≙ 1¢, coluna existente serve), `monthly_cost_cents`, `cost_window_start`. Novas para anti-farm: `email_verified_at`, `signup_ip`, `signup_device_hash` (ou tabela própria se preferir na implementação).

**Migração:** 1 arquivo SQL (2 tabelas + colunas + índices por `user_id, created_at` e `op_id`); grant retroativo de +500 para contas existentes; saldo em coluna como cache + ledger como extrato, atualizados na mesma transação.

## 11. UX v1

- **Pill de saldo** junto ao UserPill; tooltip com extrato simples (últimas linhas do ledger). Atualiza com o `balance_after` que toda rota cobrável devolve.
- **Estimativas:** ▶ da section mostra *"≈ N credits"* (soma da cadeia); ações de node único mostram no menu/confirm; débito real aparece como "−N" transiente no node ao completar. Operações grátis não mostram nada (sem "−0").
- **Modal de bloqueio** (família frosted): *"Not enough credits — this run needs ~N, you have M"* + CTA **"Buy credits"** → **modal de planos**: Free (current) / **Pro $12/mês → 1.500 créditos/mês [default]** / **Ultimate $39/mês → 6.000/mês [default]**. V1: botões em waitlist/"coming soon" (Stripe é v2) com clique medido (dado de demanda pré-cobrança).
- **Detecção de site animado** ao adicionar URL: modal de escolha grátis-vs-reconstrução (§3). Texto de produto em inglês.

## 12. Dependências e fora de escopo

**Dependência real:** verificação de e-mail não existe hoje (auth por senha + OAuth stub). Entra como pré-requisito da v1: fluxo de verificação (link/código) + `email_verified_at` gating o pack E o uso de operações cobráveis.

**Fora de escopo v1:** Stripe/checkout e assinaturas (v2); construção dos templates/FTUE (projeto próprio, com o requisito de custo ≤360 exportado daqui); pesquisa formal de pricing de concorrentes (Flora/Weavy/etc — padrão conhecido: assinatura com pool mensal de créditos, menu de preço por node, estimativa pré-run); enforcement automático dos flags comportamentais; refunds/disputas.

## 13. Testes

1. Matemática pura: arredondamento (159→160, mínimo 5), multiplicadores, pisos (iter9 150) e fixos (estático 25), µ¢→créditos.
2. Aninhamento de contexto: chat externo cobra 0; ferramenta interna cobra a própria operação; registro vai pro contexto mais interno.
3. Arquétipos: cada um dos 8 dentro da faixa esperada (fixture de tokens típicos).
4. Reserva: hold atômico nega o segundo concorrente; settle devolve diferença; falha devolve tudo.
5. Rotas: 402 com estimativa/saldo; `balance_after` na resposta; captura estática nunca cobra.
6. Funis: formato de usage dos 3 SDKs (Anthropic/OpenAI/Gemini) + eventos de imagem por qualidade.
7. Anti-farm: pack único por identidade; blocklist; orçamento global estourado → pack reduzido; rate limits.

## 14. Decisões em aberto para a revisão (defaults marcados) — ✅ SHIPPED 2026-07-03 com estes valores

Todos os defaults abaixo foram implementados como estão (plano `docs/superpowers/plans/2026-07-03-credits-system.md`, 19 tasks):

- Clone estático fixo: **25** créditos. *(shipped: `OP_PRICING['extract.html'] = { flat: 25 }`)*
- Planos placeholder: Pro **$12/1.500** · Ultimate **$39/6.000**. *(shipped: `PlansModal.jsx`, waitlist v1)*
- Cercas: **10 msg/min**, **150 turnos leves/dia**, **6 ops cobráveis/min**, teto free **$2/mês**, orçamento global de boas-vindas via env `WELCOME_BUDGET_MONTHLY_CREDITS` (0 = sem teto até definir). *(shipped: `lib/billing/rate-limit.js` + `welcome.js`; envs `UNCRAFT_CHAT_PER_MIN`, `UNCRAFT_LIGHT_TURNS_PER_DAY`, `UNCRAFT_OPS_PER_MIN`)*
- Grant retroativo para contas existentes: **sim**. *(executado 2026-07-03 — 1 conta, +500, ledger `{"retroactive":true}`)*
