# Handoff — Executar o sistema de créditos INLINE (plano pronto)

**Data:** 2026-07-03 · **Branch:** `feat/canvas` · **Suite:** 456 verdes (`cd packages/web-shell && npx vitest run`)
**Contexto de budget:** o usuário bateu o limite mensal de gastos — EXECUTAR INLINE (superpowers:executing-plans), SEM subagentes/workflows.

## Passo 0 — OBRIGATÓRIO antes de qualquer coisa: commitar o trabalho pendente

O working tree tem DUAS entregas prontas e testadas (456/456) que NÃO são do sistema de créditos. Commitar separado, nesta ordem:

1. `packages/web-shell/components/CanvasClient.jsx` + `lib/canvas-layout.js` + `lib/canvas-layout.test.js`:
   `fix(canvas): section walls on move/resize + merge-confirm popup + members-only section move`
   (Conteúdo: popup "Merge sections?" no cordão manual entre sections distintas com snapshot pré-gesto e gate por componente real; parede 24px no resize E no move de section — clampFrameToNeighbors/clampMoveToNeighbors com histerese e freeze em gap-band; move carrega só memberIds; parede do core contra centros alheios fecha absorção por drop; teclado gated atrás de modais; revalidação no commitEdgeCreate.)
2. `packages/web-shell/lib/clone-images.js` + `lib/extract-llm.js` + `lib/clone-images.test.js`:
   `feat(clone): 2D content-snap crop + UI paint-out + placeholder padrão + gated generative cleanup`
   (Conteúdo: snapRegionToContent 2D por manchas conexas — expande borda cortada, descarta blob de UI separado, paint-out com cor local e pad adaptativo [4,2]; cap 0.35→0.85; innerHTML limpo no embed; placeholder X-diagonal com label "<coisa> image not generated"; cleanCropUi gated por needsCleanup — pad determinístico → gpt-image-1 edit → unpad; kill-switch `UNCRAFT_CLONE_UI_CLEANUP=0`.)

Validações de campo PENDENTES dessas entregas (não bloqueiam o billing): clone real da imagem do jato (bases dos botões devem sumir 100% agora) e smoke das paredes de section no browser.

## Passo 1 — Executar o plano

- **Plano:** `docs/superpowers/plans/2026-07-03-credits-system.md` (commit `67d5967`) — 19 tasks TDD com código completo.
- **Spec aprovado:** `docs/superpowers/specs/2026-07-03-credits-system-design.md` (commit `6bc8146`). Defaults do §14 valem como estão (clone estático 25 · Pro $12/1.500 · Ultimate $39/6.000 · 10 msg/min · 150 turnos leves/dia · 6 ops/min · teto free $2/mês).
- **Skill:** superpowers:executing-plans, em lotes com checkpoints. Ordem do plano é dependência real (1→2→3→4→5 antes dos funis 8-12; rotas 13-15 depois; UI 16-18; arquétipos 19).
- **Task 3 (migração)** precisa de acesso ao banco (`psql "$DATABASE_URL" -f migrations/2026-07-03-credits.sql` ou console Neon) — se não houver credencial na sessão, PEDIR ao usuário pra aplicar e seguir (o código degrada graciosamente sem as colunas, padrão já existente no credits.js). O grant retroativo (+500 contas existentes) roda UMA vez após a Task 6.
- Commit por task, mensagens no plano. Nunca quebrar a suite.

## Decisões de negócio já fechadas (NÃO re-perguntar)

- 1 crédito = $0,01; µ¢ interno; arredonda UMA vez: `max(5, ceil/5*5)`.
- Conversa grátis (medida, com cercas); resultado custa igual por qualquer caminho (chat = soma das operações executadas, sem taxa de conversa).
- Captura de URL grátis sempre; clone estático fixo 25; reconstruct iter9 deliberado 10× piso 150 (modal de escolha quando detecta site animado); clone de imagem 4× com limpeza embutida; compose/extracts/transplante 3×.
- Flow = soma por node, cobrado por node ao completar; estimativa de cadeia no ▶.
- Boas-vindas 500, uma vez por identidade (e-mail normalizado + dispositivo/IP 30d), orçamento global mensal env, retroativo pra contas existentes. FTUE/templates = projeto separado (flagship ≤360 créditos exportado como requisito).
- Falha não cobra (refund total do hold); corrida = hold atômico, primeiro ganha.
- Stripe/assinaturas = v2; modal de planos v1 em waitlist. Fluxo de VERIFICAÇÃO de e-mail = plano separado futuro (coluna entra agora; contas pré-migração grandfathered).

## Fatos de código que economizam exploração

- Auth nas rotas: `const { user, error } = await requireUser(request)`.
- Signup: `app/api/auth/signup/route.js` (INSERT users → hook do welcome na Task 15).
- Seção ▶ já chama `/api/nodes/[id]/run` POR node → billing por node do flow cai de graça da rota (Task 13).
- OpenAI streaming NÃO devolve usage sem `stream_options: { include_usage: true }` (Tasks 8-10).
- Mocks de SDK nos testes: class-based (`default: class {...}`), convenção do projeto.
- `lib/credits.js` (teto mensal de custo real) e `lib/agent/cost.js` (MODEL_PRICES) já existem — Tasks 1/5 estendem, não substituem.
- Sem pasta `migrations/` até agora — schema.sql é a fonte idempotente; a Task 3 cria ambos.
