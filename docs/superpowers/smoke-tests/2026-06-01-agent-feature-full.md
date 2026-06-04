# Smoke Tests — Agent PromptDock end-to-end (2026-06-01)

Roteiro manual no browser pra validar Phases 2/3/4/4b/4c/4d/5b/5c (~50 commits, 167/167 unit tests verdes). Rode em ordem; cada bloco assume o anterior passou.

## Pré-flight

```bash
cd packages/web-shell && npm run dev
# → http://localhost:3030
```

`.env.local` precisa ter:
- `ANTHROPIC_API_KEY=<key>` (Claude tests + créditos em console.anthropic.com)
- `GEMINI_API_KEY=<key>` (Gemini agent + Imagen)
- `OPENAI_API_KEY=<key>` (GPT agent + gpt-image-1)
- `DATABASE_URL=<neon-conn>`
- `UNCRAFT_AGENT_MODEL=gemini-2.5-flash` (default — override por cenário)

Login + criar/abrir board, navegar pra `/canvas/<board-id>`.

---

## Bloco A — Chat básico (Phase 1+5a baseline)

| # | Cenário | Esperado |
|---|---|---|
| A1 | `crie 3 nodes prompt` + Enter | Painel expande → 3 tool chips `createNode` done → canvas auto-refetch + auto-frame, 3 nodes amarelos |
| A2 | `lista os nodes` | Chip `queryNodes` → resposta textual do agent com lista |
| A3 | Click chevron pra colapsar | Painel encolhe, mensagens preservadas em memória |

---

## Bloco B — Destructive flow (Phase 2)

| # | Cenário | Esperado |
|---|---|---|
| B1 | `delete o primeiro node prompt` | Amber chip `⚠ deleteNode` com Confirm/Skip — agent pausa |
| B2 | Click Confirm | Chip running azul → done cinza → canvas refetch, node sumiu |
| B3 | Repete B1, click Skip | Chip `⊘ skipped` italic, node permanece |
| B4 | Cancel mid-run via devtools: `fetch('/api/chat/cancel', {method:'POST', headers:{'content-type':'application/json'}, credentials:'include', body: JSON.stringify({runId: '<runId-from-state>'})})` | Stream fecha, `agent_runs.status='cancelled'` |

---

## Bloco C — Anti-loop caps (Phase 2)

Editar `.env.local` + restart entre testes.

| # | Cenário | Setup | Esperado |
|---|---|---|---|
| C1 | Soft pause | `UNCRAFT_AGENT_SOFT_ITER=2` | `crie 5 prompt nodes` → SoftPauseChip amber em iter 2 com breakdown `createNode × 2` + Continue/Stop → Continue completa run |
| C2 | Hard kill | `UNCRAFT_AGENT_HARD_ITER=3` (remover SOFT) | Mesmo prompt → `run_status: hard_limited` em iter 3 |
| C3 | DB verify | — | `psql -c "SELECT id, status, iterations, tool_call_counts FROM agent_runs ORDER BY started_at DESC LIMIT 5"` → status + JSONB batem |

Remover overrides depois.

---

## Bloco D — Image generation (Phase 3)

| # | Cenário | Setup | Esperado |
|---|---|---|---|
| D1 | Default Gemini + attachToBoard | `UNCRAFT_AGENT_MODEL=gemini-2.5-flash` | `generate an image of a teal mountain at sunset and attach to board` → auto-confirma silencioso → asset node aparece com imagem inline |
| D2 | Claude conversation model | `UNCRAFT_AGENT_MODEL=claude-sonnet-4-6` + restart | Mesmo prompt → 2-button needs_choice chip `Gemini (auto)` + `GPT-5.5` → click → gera via provider escolhido |
| D3 | Provider explícito | `UNCRAFT_AGENT_MODEL=gemini-2.5-flash` | `use openai to generate a cat image and attach to board` → auto-confirma → asset node via gpt-image-1 |
| D4 | DB verify | — | `psql -c "SELECT id, type, name, meta->>'provider', meta->>'model', created_at FROM assets ORDER BY created_at DESC LIMIT 5"` |

---

## Bloco E — Smart Edit canvas (Phase 4 + 4c + 4d)

Pré: ter pelo menos um asset node de D1/D2/D3.

| # | Cenário | Esperado |
|---|---|---|
| E1 | Hover no asset node | Botão sparkle "Smart Edit" fade-in canto superior direito |
| E2 | Click botão | Dock 320px abre 12px à direita do node (frosted glass) |
| E3 | `make it sunset colored` + Enter | Spinner blue → 30-60s → img inline + botão "Generate another" |
| E4 | Click "Generate another" | Volta pro textarea |
| E5 | Click fora do dock | NÃO fecha (intencional) |
| E6 | Click X | Dock fecha |
| E7 | Drag dentro da textarea | NÃO move o node |
| E8 | **Viewport clamp** — mover node pra borda direita, click Smart Edit | Dock abre do lado esquerdo do node |
| E9 | **AbortController** — Smart Edit + prompt + fechar X antes de imagem voltar | Sem console errors; run server-side completa OU cancela (ambos OK) |
| E10 | **Multi-choice picker** — `UNCRAFT_AGENT_MODEL=claude-sonnet-4-6` + Smart Edit + prompt | Dock mostra 2 botões inline Gemini/GPT-5.5 + Cancel embaixo |
| E11 | Click Cancel no picker | Volta pro textarea, skip mandado pro server |

---

## Bloco F — Orphan asset backfill (Phase 4b)

Pré: criar asset node sem `meta.assetId` — right-click canvas Add screenshot ou via SQL:

```sql
INSERT INTO nodes (board_id, kind, pos_x, pos_y, width, height, meta)
VALUES ('<board-id>', 'asset', 0, 0, 512, 512,
  '{"dataUrl": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "name": "orphan"}'::jsonb);
```

| # | Cenário | Esperado |
|---|---|---|
| F1 | Hover no orphan asset node | Botão Smart Edit aparece (agora visível pra qualquer asset com dataUrl OR assetId) |
| F2 | Click | Botão fica disabled brevemente (`.busy`) → backfill POST → dock abre |
| F3 | DB verify | `psql -c "SELECT id, name, meta FROM assets WHERE meta->>'source' = 'backfill-from-node' ORDER BY created_at DESC LIMIT 3"` |
| F4 | Idempotência: click Smart Edit de novo | Sem spinner backfill (já tem resolvedAssetId em state) |

---

## Bloco G — History reconstruction (Phase 5b)

| # | Cenário | Esperado |
|---|---|---|
| G1 | Rodar A1 | Painel mostra 3 chips |
| G2 | **Cmd+R reload** | Painel auto-expande mostrando histórico — user msg + 3 chips com IDs (`created abc12345`) |
| G3 | DB verify | `psql -c "SELECT id, role, content, tool_calls FROM chat_messages WHERE thread_id = (SELECT id FROM chat_threads WHERE board_id = '<board>' LIMIT 1) ORDER BY created_at"` → assistant row com content + tool_calls JSONB |
| G4 | Trocar de board | Painel limpa + recarrega histórico do novo |

---

## Bloco H — Cost + tier routing (Phase 5c)

| # | Cenário | Esperado |
|---|---|---|
| H1 | Rodar qualquer chat | DB acumula tokens + cost |
| H2 | DB verify | `psql -c "SELECT id, status, iterations, tokens_in, tokens_out, cost_cents FROM agent_runs ORDER BY started_at DESC LIMIT 5"` |
| H3 | Tier ladder: remover `UNCRAFT_AGENT_MODEL` + restart | Default → `gemini-2.5-flash` (user.plan='free') |
| H4 | `UPDATE users SET plan='enterprise' WHERE id=<id>` + restart + relogar | Chat usa `claude-sonnet-4-6` automaticamente |
| H5 | Credits gate | Hoje stub unlimited; pra testar 402: mudar `hasEnoughCredits` pra `return false` temporariamente |

---

## Bloco I — Regressões extension

| # | Cenário | Esperado |
|---|---|---|
| I1 | Smart Edit na extension Chrome | Funciona via chrome.runtime (Phase 4 não tocou) |
| I2 | Mode E / Mode S | Funcionam normal |
| I3 | `bash scripts/build-editor.sh` | Roda sem erro, dist sincronizado |

---

## Bugs Important deferidos

1. **SmartEditDockWrap flicker** — dock renderiza no lado direito antes do useEffect detectar viewport overflow e flippar. Fix: `useLayoutEffect` ou cálculo síncrono de `node.pos_x + node.width`
2. **Stale node.meta após backfill** — local `resolvedAssetId` correto mas `CanvasClient.nodes[id].meta` não atualiza até refetch. Sem perda de dado, só UX confuso em reload
3. **DeepSeek pro tier** — hoje cai em gemini-2.5-flash (TODO Phase 5d). Wiring: branch `^deepseek` em `resolveAdapter` + `baseURL: 'https://api.deepseek.com'` no callOpenAI

Se algum cenário falhar: marcar bloco + número + screenshot. Iteramos.
