# Compact board state — manual smoke (2026-06-22)

Goal: confirm `buildBoardSummary` made the agent STOP opening board-scope turns
with a reflexive `listBoard` reconnaissance call, because it already knows the
board's shape from the per-turn hint.

Commit: `d776538` — `perf(agent): inject compact board summary…`

## Setup
- Run `npm run dev` in `packages/web-shell` (watch the server console — the
  diagnostic logs `[agent] iter=N stop=…` and `[agent] EXEC tool=…` from the
  style-transfer debug session are still in place and are exactly what we read).
- Open a board that already has **3-5 nodes** (a mix: a site, a prompt, an
  asset). An empty board won't exercise the summary.

## A. The win — no reconnaissance turn (board scope)
- [ ] Select nothing. In the chat, type a question that needs board awareness:
      **"what's on this board?"** or **"add a pricing section to the landing
      page"**.
- [ ] In the server console, read the first iterations. **PASS** = the agent
      does NOT call `listBoard` as its first move (no `[agent] EXEC tool=listBoard`
      at iter 0). It already named/used the nodes from the hint.
- [ ] **FAIL** = a `listBoard` EXEC appears at the very start anyway → the hint
      isn't reaching the model or isn't trusted; check the user message in the
      request actually carries the `[Board has N nodes: …]` line.

## B. The hint is actually present
- [ ] Optional: log or inspect the outgoing user message (the `initialMessages`
      text). It should START with `[Board has N nodes: "…" (kind…); …]` then the
      typed message.

## C. No regression on asset Smart Edit (board summary must NOT appear)
- [ ] Open an asset node's Smart Edit dock (asset-scope chat), send any edit.
- [ ] **PASS** = no `[Board has …]` preamble in that turn (asset scope is
      deliberately excluded — it doesn't reason over the graph).

## D. Still works when board genuinely needs detail
- [ ] Ask something that needs a node's CONTENT, not just its name (e.g. "use
      the same headline as the landing page"). The agent SHOULD still call
      `viewNode`/`getNodeOutput` for that — the summary only carries name+kind,
      never content. PASS = it fetches detail on demand, doesn't hallucinate.

## Cleanup note (not this smoke, but adjacent)
The diagnostic `[agent] …` / `[createImage] …` console logs are debug leftovers
flagged for removal "next session" in [[checkpoint_2026-06-02_session]]. They're
useful FOR this smoke — remove them after.
