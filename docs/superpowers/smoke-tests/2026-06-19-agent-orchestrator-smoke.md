# Agent conversational-orchestrator — manual smoke (2026-06-19)

Run in the live chat (pick GPT-5.5 or a funded provider in the dropdown). Each
case states the expected board outcome. Generation calls cost credit.

## A. Type vocabulary (the bug)
- [ ] "a site fed by an md node" → builds [blank design-system] → [blank site],
      correct TYPES (design-system, NOT a prompt node), wired. Both blank.

## B. Bare creative request generates real content
- [ ] "create a fintech site" → [prompt: "fintech site"] → [site] where the
      site is ACTUALLY generated (real fintech HTML), not an empty blank node.
      (Confirms the createNode-content + runFlow follow-through.)

## C. Specified content generates; unspecified stays blank
- [ ] "a fintech site styled by this .md" (upload an .md) → design-system node
      holds the real spec; the site is generated using it.
- [ ] "create the site and its .md" → [site generated] → [design-system with
      the site's extracted design.md], wired site→md.

## D. New-vs-continue ALWAYS asks on ambiguity
- [ ] Select a fintech site, type "create a pricing page" → the agent ASKS
      "add to the fintech site, or start a new one?" (does NOT silently guess).
- [ ] Nothing selected, "create a portfolio" → starts a new chain, no question.
- [ ] Site selected, "make it darker" → continues that site, no question.

## E. Conversational clarification on thin prompts
- [ ] "make me a site" (no domain) → the agent asks the minimum (what for /
      audience / style) before building, instead of dumping a generic page.

## F. Behaves like the real model (not a caged bot)
- [ ] A request that needs a sequence (e.g. "take the style of <url> and apply
      it to a new landing page") → the agent chains capture/extract/apply
      rather than refusing. Refusal is the last resort.
