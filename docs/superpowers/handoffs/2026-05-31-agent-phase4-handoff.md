# Agent PromptDock — Handoff for Phase 4+ (after Phase 3 ships)

> Written 2026-05-31 right after Phase 3 (createImage + provider routing + auto-confirm UX) shipped on branch `feat/canvas`. All 144 tests green.

## What state you're picking up

The agent now has 10 tools. Full board-agent surface:
- **6 safe**: createNode, addEdge, updateNode, queryNodes, getNodeOutput, listAssets
- **3 destructive (confirm)**: deleteNode, runFlow, editSite
- **1 destructive (choice)**: createImage — needs_choice with auto-confirm when only 1 provider option

`createImage` provider routing:
- Conversation model is Claude + provider='auto' → user picks Gemini or OpenAI
- Conversation model is GPT + provider='auto' → silently uses OpenAI
- Conversation model is Gemini + provider='auto' → silently uses Gemini
- provider='gemini' / 'openai' / 'claude' → explicit (claude = error)
- ctx.choice from resolveChoice takes precedence over args.provider

Storage:
- Generated images saved to `assets` table with `type='image'`, `meta.dataUrl` (base64), `meta.provider`, `meta.model`, `meta.aspectRatio`, `meta.prompt`
- `attachToBoard:true` → also creates `nodes` row with `kind='asset'`, 512×512, `meta.assetId/dataUrl/name`

## Smoke tests not yet run

Phase 5 of the plan has 4 manual smoke scenarios — needs user in browser:
1. Default Gemini agent + `generate an image of a teal mountain at sunset and attach to board` → silent auto-confirm → asset node appears
2. `UNCRAFT_AGENT_MODEL=claude-sonnet-4-6` restart → same prompt → 2-button choice chip → click → image gens via picked provider
3. `use openai to generate a cat image` → silent single-confirm → openai generates
4. `psql "$DATABASE_URL" -c "SELECT id, type, name, meta->>'provider', meta->>'model', created_at FROM assets ORDER BY created_at DESC LIMIT 5"` → verify rows

These are first thing to run next session.

## Suggested next pickup

**Phase 4 — Smart Edit chat dock**
- `buildAssetChatDock()` in `editor.js` already has UI (textarea + model picker + send arrow), works in extension, silent-fails in canvas
- Replace `chrome.runtime.sendMessage({action:'generateImage'})` with `POST /api/chat` carrying `{threadScope:'asset', assetId, tools:['createImage','getNodeOutput'], systemPromptKey:'EDIT_IMAGE_SYSTEM'}`
- Asset-scoped threads already supported in schema (`chat_threads.scope='asset', asset_id NOT NULL`) and `getOrCreateActiveThread`
- POST /api/chat already routes asset-scope to `buildSafeRegistry` — Phase 4 needs the UI wire + scope-aware registry override to include createImage in asset chats

**Phase 5b — history reconstruction**
- Currently `appendMessage({role:'assistant', content:''})` saves empty stub. Phase 5b populates content + saves separate `role:'tool'` messages with tool_call_id + result JSON + builds tool_calls JSONB on assistant message → ChatPanel rehydrates on reload

**Phase 5c — cost tracking + credits**
- `agent_runs.{tokens_in, tokens_out, cost_cents}` columns exist but never written
- `lib/agent-cost.js` price table per model + per image gen
- Driver tallies usage → route persist at run end
- `lib/credits.js` decrements user balance, returns 402 if would go negative

**Phase 3b (deferred from Phase 3) — image-to-image**
- Pass existing image as input to next generation (regenerate with edits)
- Both Gemini Imagen and gpt-image-1 support reference images — add `referenceImageUrl` / `referenceImageBase64` to createImage's input schema + adapter signatures

## Things NOT to do (lessons from Phase 3)

- **Don't create blob_url storage in Phase 3** — base64 dataUrl in meta works everywhere (serverless, local dev, etc). Migrate when storage cost becomes a real issue
- **Don't make `classification` dynamic per call** — driver inspects it once. Always-needs_choice + `choices()` returning 1 element for the no-choice case is the right pattern
- **Don't render a 1-button choice menu** — auto-confirm at the SSE handler level, not inside ToolChip
- **Don't direct-call adapters from the tool** — route is the single source of truth for keys + provider mapping. HTTP roundtrip overhead is negligible vs image generation time

## How to run / develop

```bash
# Tests:
cd packages/web-shell && npm test
# Expected: 144/144 passing

# Dev server:
cd packages/web-shell && npm run dev
# → http://localhost:3030/canvas/<board-id>

# Env vars (.env.local):
#   GEMINI_API_KEY=<your-key>  # required for Gemini Imagen + Gemini agent
#   OPENAI_API_KEY=<your-key>  # required for OpenAI gpt-image-1 + OpenAI agent
#   ANTHROPIC_API_KEY=<your-key>  # required for Claude agent (needs credit on console.anthropic.com)
#   UNCRAFT_AGENT_MODEL=gemini-2.5-flash  # default agent model (override for testing)
```
