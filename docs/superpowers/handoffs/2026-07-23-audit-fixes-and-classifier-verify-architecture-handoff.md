# Handoff — Audit dos fixes do extract + arquitetura do classificador (sinais → verify) (2026-07-23)

> **Para o próximo agente.** Branch `main`, HEAD `1828254f`. Esta sessão (a) auditou o commit anterior `bbd5dea9` com Claude (3 lentes) + GPT Sol, (b) corrigiu os 2 bugs reais que o audit achou (commit `1828254f`, TDD, re-revisado pelo Sol), e (c) **decidiu a arquitetura do classificador free-vs-pago** — que muda de "detector que prevê" para "verificador do output barato". A decisão (§3) é o resultado estratégico mais importante desta sessão; leia-a antes de tocar no classificador.
>
> **Ordem de leitura**: este doc → `2026-07-23-componentization-and-clone-router-handoff.md` (o que era o classificador antes) → o spec `2026-07-23-clone-router-and-ditto-export-design.md` (histórico).

---

## 1. Audit do commit `bbd5dea9` (extract hardening + classificador shadow)

Rodado com **Claude (3 lentes: concorrência/abort, classificador/shadow, wiring/integração) + GPT Sol** em paralelo, sintetizado por lead. Convergência alta. Achados:

- 🔴 **Double-charge + node duplicado** (clone/styleclone) — o deadline era **por-chamada (150s), não por-rota**; o timeout do cliente (180s) abortava enquanto o servidor continuava, cobrava e criava o node. Regressão introduzida pelo próprio timeout do cliente. **CORRIGIDO** (§2).
- 🟠 **Misroute fable/mythos/chatgpt** — `assertProvider`/`providerFor` aceitam nomes que os seams roteavam com `isAnthropic`/`isOpenAI` mais estreitos → caíam no Gemini → 404. Latente hoje (id real = `claude-fable-5`). **CORRIGIDO** (§2).
- 🟡 **Shadow classifier morto-ao-nascer** (só o Sol pegou, confirmado por runtime) — `snapshot.js` chama `probe.setJavaScriptEnabled(false)`, **método que não existe no Playwright** (é opção de `newContext`, não de página — API do Puppeteer). Lança sempre, o `catch` engole → `classificationShadow` nunca é produzido. **PENDENTE** (§3) — é o pré-requisito do gate de calibração.
- 🟡 **Classificador (métrica) vaza** (shadow-only, risco de runtime = zero hoje): cobertura por vocabulário-único mascara perda de seções; `extractVisibleText` cego a transform/clip/off-screen; empty-text/CJK → falso-OK/falso-pago; `stickyStack` inline ≥3 → falso-paywall. **Endereçado pela decisão de arquitetura** (§3).
- ✅ Sólido: primitivo `withDeadline` (race + abort real nos 3 SDKs + sem leak), bloco shadow gated/isolado/inerte (só nunca roda), fix do `models/gemini-*`.

---

## 2. FEITO — os 2 bugs corrigidos (commit `1828254f`, 832/832)

**Misroute:** os 3 seams (`design-md`, `demarcelize`, `extract-llm` callText+callVision) agora despacham pelo `provider` que `assertProvider` **retorna**; regex locais `isAnthropic`/`isOpenAI` removidos. Guard e routing = uma fonte de verdade.

**Double-charge/dup:** deadline de rota **absoluto desde a entrada do handler** (`nodes/[id]/extract/route.js`), dispara **dentro** do `runBilledOperation` (refund + rethrow → nenhum node criado), env-clamp `[1s,180s]` < cliente (subido pra 200s), `maxDuration=210`, e `jsonOrThrow` surface a `message` limpa. Ladder: seam 150s < rota 160s (≤180s) < cliente 200s < maxDuration 210s.

**Refinamentos que o Sol pegou na revisão do fix (aplicados):**
- deadline absoluto-desde-a-entrada (antes envolvia só o `runExtract` → janela de pré-trabalho);
- signal do deadline atravessa o `runExtract` com checagens entre estágios (`throwIfAborted`) → clone/styleclone param de **lançar** a 2ª chamada/embed pago após abort (corta orphan spend);
- teste de rota usa `runBilledOperation` **real** + ledger fake → testemunha o **refund** de verdade.

**Testes novos:** `provider-routing.test.js`, `canvas-api.extract.test.js`, `extract.abort.test.js`, `nodes/[id]/extract/route.test.js`. Todos TDD (RED→GREEN).

---

## 3. ⭐ DECISÃO — arquitetura do classificador: detector-verificador, não detector-preditor

Discussão longa com o Adilson (as contra-ideias dele venceram). Cadeia do raciocínio:

1. **O detector só faz sentido se for perfeito** — porque é um **roteador** entre o processo estático (barato, $0) e o animado (caro). Ambos os erros custam: falso-positivo = gasta dinheiro à toa no processo caro; falso-negativo = entrega clone quebrado.
2. **Um detector que PREVÊ (por sinais) nunca é perfeito** — GSAP bundled/JS custom é invisível até renderizar. Pelo próprio critério do Adilson, sinais-como-roteador não qualificam sozinhos.
3. **Não preveja — VERIFIQUE.** O clone estático é grátis e rápido. Então: rode o clone estático, **confira se saiu certo** (o output real vs a fonte), escale pro caro **só quando a conferência falhar**. Isso ataca os dois riscos por construção. O detector vira verificador (chão firme), não adivinhador.
4. **Instrumento visual, não texto.** "Renderizou fiel?" é pergunta visual → diff visual (screenshot do clone × screenshot da fonte), imune aos vazamentos de tokenização/vocabulário/layout que o audit achou. (O Sol apontou isso sozinho no achado #4.)

**A arquitetura decidida (a implementar):**
```
site → SINAIS (barato, sempre roda: detect.js builder + GSAP/Three/Lenis global + ScrollTrigger pin/scrub)
  ├─ web builder (Framer/Webflow/…) → PESADO (processo animado) — 100% por fiat do Adilson*
  ├─ GSAP/etc com rastro       → PESADO
  └─ "sobreviveu" (sinais limpos) → VERIFY visual (clone estático × fonte)
        ├─ bate  → ESTÁTICO (entrega o grátis)
        └─ quebrou → PESADO (escala)  [resíduo ambíguo → olho do designer + rebuild de 1 clique]
```
\* *tradeoff aceito: um web-builder estático puro pega o caminho caro à toa — raro (builders = sites animados), e o custo do erro oposto é pior. Sub-check de "esse builder tem motion mesmo?" fica pra depois se doer.*

**Consequências pro código:**
- **Cortar** o coverage-diff de texto + o calibrador como estavam (métrica de shape errado; calibrar não conserta o shape).
- **Consertar o shadow** primeiro (`browser.newContext({ javaScriptEnabled:false })` em vez do método inexistente + cleanup) — é o **instrumento do gate**. Um shadow morto não é neutro: faria o placar dizer "coverage-diff nunca discorda" → cortar a rede pelo motivo errado.
- **Sequência do gate** (a ordem que o Adilson cravou): consertar shadow → shadow observa passivo (logar **texto E visual** lado a lado) → o net pega uma cauda que os sinais erram? → **sim**: calibrar (corpus **diverso**, 15-30 sites, NUNCA os 3 âncoras langchain/sanity/farmminerals = circular); **quase nunca**: cortar a rede, sinais + ressalva bastam.
- Custo: os sinais são ~grátis (um `page.evaluate` já na pipeline); o verify (2ª renderização) custa ~1-5s e **só roda quando os sinais estão limpos**. Diff visual precisa de screenshot **fullPage** dos dois lados (hoje a fonte é só acima-da-dobra) e tem ruído (anti-aliasing, imagem lazy, conteúdo dinâmico) — não é bala de prata, por isso o gate decide se vale.

---

## 4. PENDENTE

- **#3 refund best-effort** (Sol, pré-existente): `billing/context.js` engole erros do `refundHold` e depois settla com `holdCredits:0` → se o `UPDATE` do refund falhar transientemente, o saldo fica **debitado** com um 502 limpo. Fix: settlement de falha atômico/idempotente (hold→zero-charge) + retry durável/surface em vez de engolir. Alto risco (mexe no ledger) — endereçar com TDD e review do Sol.
- **Classificador**: implementar a arquitetura do §3 (consertar shadow → gate → verify visual). O `calibrate-classify.mjs` do handoff anterior fica **pós-gate**, não é o próximo passo.
- **Frente maior (não desta sessão)**: componentização própria (seções estáveis) — ver `2026-07-23-componentization-and-clone-router-handoff.md`.

---

## Regras da casa
- Trabalho no **`main`** (tronco). Sessão paralela também mexe no main — **nunca `git add -A`**, stage arquivos específicos.
- **web-shell = bun** (bun.lock source of truth), Vitest, mock de SDK class-based, `vi.hoisted` pra spies referenciados em `vi.mock`.
- **snapshot.js = caminho de captura, delicado** — mudanças gated + try/caught.
- **Codex/Sol neste repo**: bundle escopado (`--mode prose --file <diff>`, `--mode diff` estoura com untracked) + `--timeout 1500`. Validar mudança substantiva com o Sol (regra global do Adilson).
- Texto de produto em INGLÊS; conversa em PT.
