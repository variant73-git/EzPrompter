# Diff-Refinement Loop — Plano Concreto para Mode E
**Data:** 2026-04-22
**Autor:** Sessão Repix

## Contexto estratégico

Entre os 3 competidores analisados (Aura, same.new, CloneWebX), **nenhum compara o output renderizado com o screenshot original**. Todos fazem refinement "vs self":

| Ferramenta | Refinement Loop | Baseline de comparação |
|---|---|---|
| Aura | `html-to-component phase:6` | errorsFound (lint/typecheck server-side) |
| same.new | `versioning` tool | self-screenshot + lint errors |
| CloneWebX | Nenhum | — |

**Isso é um moat explorável.** Se o Repix implementa diff-vs-original, entregamos fidelidade superior a preço similar ou menor.

## Arquitetura proposta

### Pipeline expandido do Mode E

```
[atual]
capture → extract → DESIGN.md → generate(HTML) → inject → fim

[com refinement]
capture → extract → DESIGN.md → generate(HTML) → render(output) →
  diff(original_ss vs output_ss) → identify divergent regions →
  regenerate(regions) → stitch → inject → fim
```

### Componentes novos

**1. `modeE-render.js` — Render Output para Screenshot**

Após `generate-html`, renderizar o HTML gerado num iframe sandbox invisível e capturar screenshot via `html2canvas` ou `captureVisibleTab` (precisa aprofundar qual funciona melhor em extension context).

```js
async function renderOutputToScreenshot(generatedHtml) {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;left:-9999px;width:1360px;height:1024px;';
  frame.srcdoc = generatedHtml;
  document.body.appendChild(frame);
  await waitForLoad(frame);
  const canvas = await html2canvas(frame.contentDocument.body);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
  document.body.removeChild(frame);
  return dataUrl;
}
```

**Gotcha:** html2canvas não renderiza tudo perfeitamente (SVG filters, certain CSS). Alternativa: `chrome.tabs.captureVisibleTab` com iframe temporário numa aba background. Precisa prototipo.

**2. `modeE-diff.js` — Visual Diff**

Duas estratégias possíveis, complementares:

**Estratégia A: Vision-based diff (LLM-julgado)**
```js
async function visualDiff(originalSS, outputSS) {
  const prompt = `Compare these two screenshots. The first is the original site, the second is an AI-generated clone. Identify divergent regions. For each region, return:
{
  "region": "hero|navigation|features|pricing|footer|etc",
  "severity": "high|medium|low",
  "bbox": {x,y,w,h} (approximate, normalized 0-1),
  "issue": "description"
}
Focus on: layout differences, color mismatches, missing elements, wrong text, typography divergence.
Return JSON array.`;

  return await callFlash({
    images: [originalSS, outputSS],
    prompt,
    model: 'gemini-3-flash-preview', // cheap
    responseFormat: 'json'
  });
}
```

**Estratégia B: Pixel-based diff (determinístico)**
```js
function pixelDiff(originalBitmap, outputBitmap, threshold=0.15) {
  // 1. Redimensionar ambos para mesma resolução (e.g. 1360×1024)
  // 2. Dividir em grid 8x8 (64 cells)
  // 3. Para cada cell, calcular SSIM ou perceptual hash
  // 4. Cells com score < threshold = divergent
  // 5. Agrupar cells adjacentes em regions (bbox)
  // 6. Retornar [{bbox, score}]
}
```

**Recomendação: A primeiro, B depois.**
- A é 1 call Flash barato ($0.01) e retorna semântica (sabe que "o hero tá errado")
- B é mais preciso mas retorna só geometria, precisa de pass LLM pra semântica depois
- A é ship-today, B é v2

**3. `modeE-regen.js` — Regenerate Divergent Regions**

Para cada região divergente, gerar prompt focado + call LLM + stitch no HTML existente:

```js
async function regenerateRegion(originalHtml, region, issue, screenshot, designMd) {
  const regionHtml = extractRegionFromHtml(originalHtml, region); // via CSS selector match

  const prompt = `You generated this HTML for the [${region}] section:
\`\`\`html
${regionHtml}
\`\`\`

The user reports this issue: "${issue}"

Here is the ORIGINAL screenshot (see attached) — reproduce this section faithfully. Return ONLY the replacement HTML for the [${region}] section. Match colors, layout, typography exactly.`;

  const newRegionHtml = await callLLM({
    model: 'gpt-5.4', // or whichever
    images: [screenshot],
    prompt,
    maxTokens: 4000
  });

  return replaceRegionInHtml(originalHtml, region, newRegionHtml);
}
```

**4. Orchestration em `modeE-refine.js`**

```js
async function refineMode(generatedHtml, originalScreenshot, designMd, options = {}) {
  const maxPasses = options.maxPasses || 2;
  const severityThreshold = options.severityThreshold || 'medium';

  let currentHtml = generatedHtml;

  for (let pass = 0; pass < maxPasses; pass++) {
    const outputSS = await renderOutputToScreenshot(currentHtml);
    const divergences = await visualDiff(originalScreenshot, outputSS);

    const toFix = divergences.filter(d =>
      d.severity === 'high' ||
      (severityThreshold === 'medium' && d.severity === 'medium')
    );

    if (toFix.length === 0) break;

    // Regenerate divergent regions in parallel (concurrency 2)
    const regenerated = await concurrentMap(toFix, 2, async (d) =>
      regenerateRegion(currentHtml, d.region, d.issue, originalScreenshot, designMd)
    );

    // Merge regenerated regions into currentHtml
    currentHtml = mergeRegenerations(currentHtml, regenerated);
  }

  return currentHtml;
}
```

## Budget e custo

Para um rebuild típico:
- Original Mode E: 1 call = ~$0.08 (GPT-5.4 monolítico)
- Refinement pass 1: +1 diff call (Flash, $0.01) + até 3 regen calls (parciais, ~$0.04 cada = $0.12) = +$0.13
- Refinement pass 2: +$0.13

**Total com 2 refinements: ~$0.34 por clone**

Versus same.new: $0.50-1.00 por clone (GPT-4.1 iterativo). Ainda estamos mais baratos.

**Opção "fast mode":** skipar refinement pra quem não precisa. Setting por user.

## Integração no fluxo atual do Repix

**Onde tocar em `editor/mode-e.js`:**

1. Adicionar `refine:true|false` no shape de options
2. Após `runModeE` terminar com sucesso, se `refine:true`, chamar novo `modeE-refine.js` antes do `injectToPage`
3. Progresso via `showToast`/`updateToast` (já existente): "Refining (1/2)..." → "Fixed hero, retrying pricing..."
4. Hard cap 2 passes (igual same.new 3-loop cap)

**Arquivos novos a criar:**
- `editor/mode-e-render.js` — iframe sandbox + html2canvas
- `editor/mode-e-diff.js` — vision diff via Flash
- `editor/mode-e-regen.js` — region-specific regeneration
- `editor/mode-e-refine.js` — orchestrator

**Arquivos existentes a modificar:**
- `editor/mode-e.js` — hook pra chamar refine depois de generate
- `background.js` — novo endpoint `modeEDiffCall` similar ao `modeE2Call`
- `manifest.json` — web_accessible_resources pros novos JS
- `editor/editor.js` — expor toggle "refinement" no UI (opcional, v2)

## Riscos conhecidos

1. **html2canvas não renderiza perfeitamente.** Mitigação: testar alternativas (`domvas`, `screenshot API via extension bg`). Se nenhum funcionar, usar captureVisibleTab numa aba background (mais lento, +$0.01 por pass, mas fiel).

2. **Vision diff pode alucinar regions.** Mitigação: cross-check com pixel diff (Estratégia B) antes de regenerar. Se pixel-score da region for alto mas LLM diz "errada", descartar.

3. **Region boundaries podem ser imprecisas.** Mitigação: usar headings/section tags como anchors (o HTML gerado tem estrutura semântica).

4. **Regen pode piorar o output.** Mitigação: comparar antes/depois de cada regen, reverter se score piorou.

5. **Custo pode explodir.** Mitigação: hard-cap 2 passes, skip regions de `severity:low`, opção "fast mode".

## Ordem de implementação sugerida (4 marcos)

**Marco 1 (MVP, 2-3 dias):**
- `mode-e-render.js` com html2canvas
- `mode-e-diff.js` chamada Flash simples (vision only, sem pixel)
- `mode-e-refine.js` 1 pass hard-coded
- Toggle manual no UI (checkbox "High fidelity")

**Marco 2 (qualidade, 2 dias):**
- Pixel diff (Estratégia B) como cross-check
- 2 passes com early-exit se score converge
- Progress toast detalhado

**Marco 3 (robustez, 1 dia):**
- Revert se regen piora (compare scores)
- Fallback pro captureVisibleTab se html2canvas falha
- Rate limit / concurrency tuning

**Marco 4 (posicionamento, deferred):**
- Landing page angle: "Repix clones with diff-verified fidelity — unique in the market"
- A/B test Mode E original vs Mode E refined em sites-problema (Framer, Webflow)
- Benchmark SSIM vs original em 10 sites → número público

## Hypothesis tests

H1: **Diff-vs-original eleva fidelidade de 85% → 95%.**
Test: 10 sites de referência (5 Framer, 5 Webflow), medir SSIM do output vs original antes e depois. Pass se Δ ≥ 10pp.

H2: **LLM-based diff é suficiente sozinho (skip pixel diff).**
Test: sample de 20 outputs — comparar regions identificadas por LLM-diff vs por pixel-diff. Pass se 80%+ overlap.

H3: **1 pass de refinement já entrega 80% do ganho total.**
Test: mesma comparação em 10 sites, 0/1/2 passes. Pass se Δ(0→1) >= 0.7 × Δ(0→2).

## Decisões deferidas

- Qual modelo pro vision diff? Gemini 3 Flash (barato) ou GPT-5.4 (mais acurado)? Testar ambos em 10 sites.
- Quando ligar refinement automaticamente? Default on ou default off?
- Expor regions individualmente pra user clicar "regenerate this section"? (UI feature)
- Persistir diffs no IndexedDB pra learning histórico?

## Próximo passo se aprovado

1. Abrir branch nova `feat/mode-e-refinement`
2. Invocar superpowers:writing-plans pra converter este spec em plano implementável
3. Subagent-driven development pra execução em paralelo dos marcos
