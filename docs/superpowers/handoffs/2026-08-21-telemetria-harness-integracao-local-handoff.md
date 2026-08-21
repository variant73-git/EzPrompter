# Handoff — telemetria por clone + harness switch → integração local (2026-08-21)

> Sessão remota (claude.ai/code) na branch `claude/skill-clone-comparison-fg9h0l`
> do espelho GitHub. **Continuação é LOCAL** (decisão do Adilson): o widget DEV
> real (pill horizontal no canvas) existe só na máquina dele — o espelho não tem
> os branches `codex/*` recentes. Esta branch carrega tudo que a sessão local
> precisa integrar.

## O que está na branch (testado: 1640 pass; build OK)

1. **Experimento video-to-superprompt** (`_teste-skill-video/` + REPORT.md):
   skill do MengTo rodada no farmminerals com builder cego; veredito no REPORT
   (com retificações do Adilson: 35min era custo do protocolo; skill manual
   ~3-8min; zero-IA só no produtor native). Artifact publicado:
   https://claude.ai/code/artifact/042e0723-cdc9-449f-b1c1-dd51d208c4d0

2. **Telemetria por clone** (pedido: "cada clone no canvas → dados no widget dev"):
   - `lib/clone-telemetry.js` — registro canônico {engine, harness, stages,
     totalMs, credits, usageMicrocents, costUsd} em `node.meta.cloneTelemetry`
   - `billing/context.js` devolve `usageMicrocents` (metering puro; cobrança intacta)
   - `deferred-reconstruction.js` grava pós-settle (native + iter9; dedup não grava;
     fail-open); rota extract grava `meta.cloneCost` no clone estático
   - `lib/dev-clock.js` — wall-clock DO USUÁRIO nos call-sites do canvas-api
     (captureUrl/Stream, reconstructNode, extractNode clone/styleclone)
   - `components/DevWidget.jsx` (⌥D, bottom-right) — casca PROVISÓRIA; o conteúdo
     (buildRows + switch) é o que migra pro pill DEV local

3. **Harness switch** (`lib/harness.js`): registry {baseline: gpt-5.5, terra:
   gpt-5.6-terra} no slot `cloneVision`; cookie `uncraft-harness` lido POR
   REQUISIÇÃO nas rotas (reconstruct, run, extract) → `reconstructPage({visionModel})`,
   `runCompose({visionFallbackModel})`, extract clone/styleclone. Id desconhecido
   → baseline (fail-closed de qualidade); env `UNCRAFT_HARNESS` vence cookie.
   Telemetria etiqueta cada clone com o harness → A/B direto no widget.

4. **Correções de metering** (`lib/agent/cost.js`): terra repriced $2/$12
   (corte OpenAI 30/jul; estava $2.50/$15); kimi-k2.6 adicionado ($0.95/$4)
   — estava no picker metrando $0.

## Tarefas da sessão local (ordem sugerida)

1. Merge desta branch no tronco local (⚠️ o espelho está ATRÁS do local —
   conferir conflitos em deferred-reconstruction/billing/extract-route, que
   podem ter divergido nos branches codex/*).
2. Integrar o conteúdo do DevWidget no pill DEV existente (o componente é
   autocontido: rows de `buildRows(nodes, devClockAll())` + switch de harness);
   aposentar a casca ⌥D ou manter como atalho.
3. **Auditoria do Sol** (standing item 168) — prioridade nos pontos money-
   adjacent: retorno `usageMicrocents`, tabela de preços, cookie→modelo
   (superfície: cookie do usuário escolhe modelo — mitigado por registry
   fechado; Sol deve validar).
4. **A/B Terra**: farmminerals + 2-3 sites de perfis distintos, mesmo site nos
   dois harnesses; julgar por SSIM (meta.similarity) + house-style checker +
   olho nos pares. Se Terra segurar: −40-45%/clone (input-heavy; $5/$15 →
   $2/$12). Só então mudar default.
5. **Auditoria de roteamento do fluxo real** (pendência do REPORT §retificações):
   com o widget vivo, ver qual engine atende o clone do dia a dia — se minutos,
   não está caindo no native (classe do achado 179).
6. **[SALVAR]** acumulado da sessão remota inteira: memo + item no CLAUDE.md +
   vault + Findings (candidatos: "espelho GitHub desatualizado quase causou
   integração no lugar errado"; retificação 35min/protocolo; zero-IA só no
   produtor).

## Custo — a conta do Terra (para o memo)

gpt-5.5 $5/$15/$2.50cache → terra $2/$12/$0.20cache. Clone é input-heavy
(screenshots): extract.clone medido $0.525 → ~$0.30 no Terra (−43%); iter9
proporcional. Credits: ~215 → ~120. Número REAL sai do widget por harness.
