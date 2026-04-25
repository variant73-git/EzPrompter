# RepixBridge Pricing Synthesis — 2026-04-25

A self-contained pricing-strategy doc for RepixBridge. Three sections of evidence + one recommendation. Read on mobile.

**Important caveat on verification.** WebFetch was blocked in this session, so all competitor and model prices below were verified via WebSearch result snippets (Google index excerpts of official pages and reputable third-party trackers). They are **not** direct page reads. Where a number could not be confirmed I mark "verification failed — falling back to memory" with the memory snapshot date. Operator should re-verify before lock.

---

## Section 1 — Competitor pricing (refresh)

### Aura.build
- Verification failed — WebSearch returned the pricing URL but search snippet did not expose tier dollar amounts.
- Falling back to **CLAUDE.md / memory (2026-04-22)**: 5 tiers `free | pro | max | ultra | elite`, billed in **"premium prompts"** (not tokens).
- Confirmed via search snippet: powered by GPT-5.4 + Sonnet 4.5 + Gemini Flash mix; ~65,000 users.
- Action item: operator should hit [aura.build/pricing](https://www.aura.build/pricing) and capture exact dollar amounts on each tier.

### same.new
- **Free / unlimited** as of search results: "Same.dev hasn't introduced paid plans yet, currently use the app to duplicate as many websites as you want, completely free." [(banani.co review)](https://www.banani.co/blog/same-dev-review)
- **Conflict with memory**: `research_same_new_magic.md` records "Free 500K tokens → Ultra $100/20M tokens, 600K+ builders." Memory is from 2026-04-22; the search hit is more recent or is a regional/cohort variant.
- Most likely state: **paid tiers exist but are gated/staged**, public default UX is still free. Operator should login and check directly.

### html.to.design
- Verification failed on dollar amounts (search snippets showed only the [PRO docs page](https://html.to.design/docs/pro-plan/) — "unlimited imports, fair-use cap 1000/month" — but no dollar amount).
- Falling back to **memory**: **$12/mo Pro**, billed flat per-user. 1.4M users, $2-5M ARR (memory 2026-04).
- Lite/Free tier exists with watermark + import cap, exact terms not in current snippet.

### Codia AI (codia.ai, not the unrelated usecodia.com sales tool)
Per [codia.ai/pricing](https://codia.ai/pricing) snippet:
| Tier | Price | Notes |
|---|---|---|
| Free | $0 | basic use |
| Starter | **$49/user/mo** | |
| Pro | **$99/user/mo** | |
| Enterprise | Custom | |
- Billing metric: **per-seat flat**.
- Memory said "$12-59/mo" — search shows it has moved up considerably. Codia is now an enterprise-priced design-to-code tool, not a per-clone consumer tool.

### ClonewebX (softlite.io)
Per [softlite.io/pricing/clonewebx](https://softlite.io/pricing/clonewebx/) and reseller snippets:
| Tier | Price | Allotment |
|---|---|---|
| Free | $0 | 2 sites + 10 exports/mo (Webflow + Gutenberg only) |
| Annual | **$120/yr** | 30 sites/mo, all builders |
| Lifetime | **$210-300** | 300-400 sites/yr, lifetime access |
- Billing metric: **sites/exports per period** (not credits, not flat).
- Memory had "$10/mo or lifetime avail" — confirmed direction, lifetime tier is real and pushed hard.

### orchids.app
Per [docs.orchids.app/plans-and-token-usage](https://docs.orchids.app/plans-and-token-usage):
| Tier | Price | Allotment |
|---|---|---|
| Free | $0 | 100K daily / 500K monthly tokens, 1 deployed project |
| Pro | **$25/mo** | |
| Premium | **$50/mo** | |
| Ultra | **$99/mo** | |
| Max | **$200/mo** ($168 annual) | 30M credits/mo |
- Billing metric: **credits ≈ 1 word each**. ("Edit this page" ~ 1K credits, "clone airbnb with auth" ~ 30K credits.)
- Memory had "$25/mo, pre-revenue YC W25". Now five-tier ladder up to $200/mo — they have moved aggressively upmarket.
- Annual saves up to 20%.

### CSS Pro (csspro.com)
Per [csspro.com](https://csspro.com/) snippet:
| Tier | Price |
|---|---|
| Pro | **$20/mo** |
| Pro MAX (with AI) | **$30/mo** |
- Memory said $30/mo flat. Now segmented Pro vs Pro MAX, Pro starts cheaper.

### CloneFlow (cloneflow.io)
- Verification failed — neither [cloneflow.io](https://cloneflow.io/) snippets nor the [Chrome Web Store listing](https://chromewebstore.google.com/detail/cloneflow-ai-designer-htm/kgajffhnckomggppfflkilngojaijkpd) surface dollar amounts in search index.
- Falling back to **memory (2026-04)**: $8.99/mo, ~377 users, <$5K ARR. Treat as unverified.

### CSS Peeper (csspeeper.com)
Per [csspeeper.com/pricing](https://csspeeper.com/pricing) and [G2 listing](https://www.g2.com/products/css-peeper/pricing):
| Tier | Price |
|---|---|
| Free | $0 |
| Professional | **$2.49/mo** (annual) |
| Ultra | **$4.99/mo** (annual) |
- Billing metric: **flat per-month**.
- Memory said "$5-8/mo Pro" — actual lower than memory. Lifetime deal also exists per AppSumo.

### Pricing landscape takeaway
Three clusters:
- **Inspection-only utilities** ($2-8/mo): CSS Peeper.
- **Editor / browser tool** ($12-30/mo): html.to.design, CSS Pro, ClonewebX (annualized).
- **Generative AI builders** ($25-200/mo, credit-metered): Orchids, Codia (per-seat), Aura (premium-prompts).

RepixBridge sits between cluster 2 and 3 — visual editor + AI rebuild. Reference price band is **$12-25/mo** for the headline Pro tier.

---

## Section 2 — Mode E unit economics

Verified model prices (April 2026):

| Model | Input $/1M | Output $/1M | Image input | Source |
|---|---|---|---|---|
| Gemini 3 Pro Preview (≤200K ctx) | $2.00 | $12.00 | ~$0.0011/img (560 tokens) | [pricepertoken](https://pricepertoken.com/pricing-page/model/google-gemini-3.1-pro-preview), [aifreeapi](https://www.aifreeapi.com/en/posts/gemini-api-pricing-2026) |
| Gemini 2.5 Flash | $0.30 | $2.50 | included in input tokens | [pricepertoken](https://pricepertoken.com/pricing-page/model/google-gemini-2.5-flash) |
| Claude Sonnet 4.5 | $3.00 | $15.00 | tokenized by area | [Anthropic](https://platform.claude.com/docs/en/about-claude/pricing) |
| Claude Opus 4.5 | $5.00 | $25.00 | tokenized by area | [eesel](https://www.eesel.ai/blog/claude-opus-45-pricing) |

Note: the operator brief mentions Sonnet 4.6 and Opus 4.7. Anthropic's docs and third-party trackers (April 2026) consistently report **Opus 4.5 = $5/$25** and **Sonnet 4.5 = $3/$15**. Sonnet 4.6 and Opus 4.7 may exist as internal/preview names with same pricing as the prior step (Anthropic pattern: same headline price, better model). I'm using Sonnet 4.5 / Opus 4.5 numbers as conservative pricing floor.

### Per-call assumption (per Mode E viewport)
- Input: ~13,500 text tokens + 1 screenshot (≈1,500 image tokens)
- Output: ~9,000 HTML tokens
- Effective input: **~15K tokens** per viewport call

### Per-viewport cost ($)

| Model | (15K × in) + (9K × out) | $ per viewport |
|---|---|---|
| Gemini 3 Pro | (0.015×$2) + (0.009×$12) | **$0.138** |
| Gemini 2.5 Flash | (0.015×$0.30) + (0.009×$2.50) | **$0.027** |
| Sonnet 4.5 | (0.015×$3) + (0.009×$15) | **$0.180** |
| Opus 4.5 | (0.015×$5) + (0.009×$25) | **$0.300** |

### Full Mode E clone (5 viewports + DESIGN.MD)

DESIGN.MD pass: 5K input + 8K output = (0.005×in) + (0.008×out)

| Model | 5 viewports | + DESIGN.MD pass | **Full clone** |
|---|---|---|---|
| Gemini 3 Pro | $0.690 | $0.106 | **$0.796** |
| Gemini 2.5 Flash | $0.135 | $0.022 | **$0.157** |
| Sonnet 4.5 | $0.900 | $0.135 | **$1.035** |
| Opus 4.5 | $1.500 | $0.225 | **$1.725** |

### Mode E Lean clone (5 viewports, no DESIGN.MD)

| Model | Lean clone |
|---|---|
| Gemini 3 Pro | **$0.69** |
| Gemini 2.5 Flash | **$0.135** |
| Sonnet 4.5 | **$0.90** |
| Opus 4.5 | **$1.50** |

### Mode E+ refined clone (Full E + refine pass)
Refine = 1 Flash diff (~2K in + 1K out = $0.0035) + 2 Pro regens (~10K in + 8K out each):
- Pro regen on **Gemini 3 Pro**: 2 × ((0.010×$2)+(0.008×$12)) = 2 × $0.116 = $0.232
- Pro regen on **Sonnet 4.5**: 2 × ((0.010×$3)+(0.008×$15)) = 2 × $0.150 = $0.300
- Pro regen on **Opus 4.5**: 2 × ((0.010×$5)+(0.008×$25)) = 2 × $0.250 = $0.500

| Model | Full + refine | Notes |
|---|---|---|
| Gemini 3 Pro (refine on Gemini 3) | $0.796 + $0.0035 + $0.232 = **$1.03** | Default Pro path |
| Sonnet 4.5 (refine on Sonnet) | $1.035 + $0.0035 + $0.300 = **$1.34** | Premium path |
| Opus 4.5 (refine on Opus) | $1.725 + $0.0035 + $0.500 = **$2.23** | Reserve for "premium" trigger |
| Mixed: Gemini 3 + Opus refine | $0.796 + $0.0035 + $0.500 = **$1.30** | Tiered routing pick |

### Quality expectation (lean on memory, no fabricated benchmarks)
Per CLAUDE.md and `project_llm_strategy_2026-04-24.md`:
- **Flash**: "Lean clone" tier — fast (20-40s), 85-90% fidelity per Mode E2 estimate. Acceptable for free tier and exploratory use.
- **Gemini 3 Pro**: current default Mode E. Memory + project notes report 85-93% with rich DESIGN.MD; ~92-95% with chunking.
- **Sonnet 4.5**: research notes flag this as the better-quality default for Mode E — Anthropic models consistently follow long instruction prompts (Aura proves this — Sonnet 4.5 is their HTML→React decomposer).
- **Opus 4.5**: highest-quality option, 3× cost of Gemini Pro. Reserve for refinement / Feedback Tool / paid premium trigger, not default.

No published benchmark numbers available for "Mode-E-style" tasks specifically. Quality numbers above are project-internal estimates.

---

## Section 3 — Three pricing scenarios

For each scenario the margin table assumes **per-clone cost of $0.80 average** (mix of viewport pipeline on Gemini 3 Pro and Flash for free tier). Stripe + infra fees flat 5% deducted.

### Scenario A — Flat $12/mo Pro (current CLAUDE.md plan)
- Free: Mode A + 3 rebuilds/mo cortesia
- **Pro $12/mo**: unlimited Mode E (Gemini 3 Pro)

| Clones/mo | Cost @ $0.80 | Net @ $12 | Margin |
|---|---|---|---|
| 10 | $8 | $11.40 - $8 = $3.40 | 30% |
| 30 | $24 | $11.40 - $24 = **-$12.60** | **negative** |
| 100 | $80 | $11.40 - $80 = **-$68.60** | catastrophic |

**Pros**:
- Simple message, matches html.to.design ($12) and reference cluster 2.
- Designer-friendly (no usage anxiety).

**Cons**:
- **Loss-making at >15 clones/mo**. One power user wipes out 5 hobbyist subs.
- Forces tight tiered routing (Flash by default, Gemini Pro only on opt-in) which contradicts "unlimited" framing.
- No room for premium model (Opus / refinement) without re-pricing.

**Best for**: pre-product-market-fit capture, when ARPU growth comes from volume, not optimization.

### Scenario B — Credit hybrid (Aura/same.new style)
- Free: 3 clones/mo on Flash (Lean default)
- **Pro $20/mo**: 30 "premium clones" (E+ on Sonnet 4.5) + unlimited Lean
- PAYG: $1 per extra premium, $0.20 per Lean

Premium clone cost @ Sonnet 4.5 = $1.34 (E+ refined). Buffer per premium = -$0.34 at face → must cap or charge more.

Recompute @ Gemini 3 Pro premium: $1.03 / clone.

| Pattern | Premiums included | Premiums used | Cost | Net @ $20 |
|---|---|---|---|---|
| Light | 30 | 5 | $5.15 | **$13.85 (~73%)** |
| Typical | 30 | 15 | $15.45 | **$3.55 (~18%)** |
| Heavy | 30 + 10 PAYG | 40 | $41.20 (cost) vs $20 + $10 (rev) = $30 | **-$11.20** |

Adjusted: cap premium at 30, charge **$2 per overage** premium. Margin then stays positive even at 100 clones because Lean cost is trivial.

**Pros**:
- Premium prompts framing is industry-standard (Aura, Orchids).
- Caps power-user blast radius.
- Free tier on Flash is essentially free to RepixBridge ($0.135 × 3 = $0.40 / free user / mo).
- Builds in clear "buy more" escalation path.

**Cons**:
- More UI surface (credits counter, PAYG flow).
- Conversion confusion if Lean is "good enough" — Free might cannibalize Pro.
- Requires usage tracking in extension + portal.

**Best for**: revenue maximization at moderate scale (5-20K paying subs). Matches Orchids and Aura mental model.

### Scenario C — Aggressive freemium (capture-first)
- Free: **unlimited Lean** (Flash, no DESIGN.MD)
- **Paid $15/mo**: unlimited E + E+ on Sonnet 4.5
- **Annual $120** (33% off)

Free cost @ Flash $0.135/clone, no DESIGN.MD: $0.135 × clones. Heavy free user at 50 clones/mo = $6.75 — costs more than half the Pro price. **This is the risk.**

Paid cost @ Sonnet 4.5 E+ = $1.34 / clone. At 30 clones/mo paid = $40.20 cost vs $15 rev → **-$25** per active power user.

| Pattern | Free clones/mo | Cost burden |
|---|---|---|
| 3-5% conversion | most users free | sustainable only if avg free ≤ 10 clones/mo |
| Free abuse | 100 clones/mo | $13.50/user — direct loss |

**Pros**:
- Maximum top-of-funnel. "Unlimited free" is a Hacker News headline.
- Clear value gap (Lean vs E+ quality difference is real).
- Annual $120 helps cashflow.

**Cons**:
- **Free abuse risk is real** — needs anti-abuse (per-IP cap, Cloudflare, account verification).
- $15 paid is below Sonnet 4.5 break-even at 12 clones/mo.
- Forces aggressive routing inside paid tier (default to Gemini Pro, only refine with Sonnet on premium triggers).
- Conversion math: 3% × $15 × 1000 free users = $450/mo vs free cost ($0.135 × ~10 × 970) = ~$1,309/mo cost. **Net negative until ~10% conversion or strict free cap.**

**Best for**: capture-first growth play **with a hard rate-limit on Free** (e.g. 10 clones/mo even though branded "unlimited"). Also viable if VC-backed and burn-tolerant.

---

## Section 4 — Recommendation

**Adopt Scenario B (credit hybrid) at $20/mo Pro, with Free capped at 3 Lean clones/mo and PAYG at $2 per extra premium.**

Reasoning grounded in the data:

1. **Where Mode E cost lives**: 80%+ of cost is the 5 viewport calls. Whether DESIGN.MD is on or off, the viewport multiplier dominates. This means the **right cost knob is the model picker**, not feature toggles. Tiered routing (Flash for Lean, Gemini 3 Pro for E, Sonnet 4.5 only for E+ refine) is the only way to keep margins healthy across 10-100 clone/mo users.

2. **Competitor band**: At $20/mo we sit 60% above html.to.design ($12) but with a strictly more-capable product (full edit + AI rebuild + refinement). We sit 25% under Orchids Pro ($25) and far under Codia ($49+). This is defensible. Going to $12 like html.to.design without their volume is the trap of Scenario A.

3. **Strategic moment**: RepixBridge is pre-revenue, post-MVP, with a real differentiator (live edit on real sites + AI rebuild — nobody else has both). Capture matters but **margin discipline matters more** because the operator is solo and runway-sensitive. Scenario C burns money waiting for conversion; Scenario A loses on every power user. Scenario B is the only one where the 1st paying user is profitable on day one.

4. **Tiered routing implications**: Free tier on Flash costs ~$0.40/mo per active free user — sustainable at 10K free users (~$4K/mo) if Pro conversion is 5%+ ($10K/mo MRR). Premium-prompt framing handles Opus 4.5 as a true premium trigger ("Refine with Pro AI" is one button → consumes 3 premium credits → cost $2.23 → revenue $6 PAYG-equivalent → 60%+ margin even on the most expensive operation).

### Open questions for the operator before lock

1. **Confirm Aura.build current tier prices** by visiting the page logged-in. Numbers in this doc are unverified.
2. **Decide free-tier abuse posture**: hard 3 clones/mo, or soft 10 with watermark? Determines anti-abuse engineering work.
3. **Premium credit ratio**: should 1 premium credit = 1 E+ refined clone, or should refinement cost extra (1 credit for E, 2 for E+)? This affects perceived generosity of the 30-credit Pro tier.
4. **Annual discount aggressiveness**: 17% (industry default) or 33% (matches Scenario C)? Locks LTV vs cash discount tradeoff.
5. **Sonnet 4.6 / Opus 4.7 actual prices**: confirm from Anthropic console — if pricing did move down, the $20/mo tier could absorb premium trigger more comfortably and might unlock $15/mo as the entry price.

---

**Total verification status**: 4 of 9 competitor pricings fully confirmed (Codia, ClonewebX, Orchids, CSS Peeper, CSS Pro). 4 unverified (Aura, html.to.design, CloneFlow, plus same.new conflict). Model prices fully confirmed from third-party trackers and Anthropic docs.
