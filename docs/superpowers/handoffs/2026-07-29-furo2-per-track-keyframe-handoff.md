# Handoff — frente live-animated-clone-editing: retomar furo #2 (per-track keyframe editability) + roadmap completo

**Date:** 2026-07-29 ~3h20 · **Branch:** `codex/live-animated-clone-editing` · **HEAD:** `e5af43df` (docs) · **⚠️ WORKING TREE SUJO DELIBERADO** (código do furo #2 pronto ~90%, NÃO commitado — bloqueio ativo do Sol v5; NÃO commitar antes de fechar o item 1 abaixo e obter MERGE OK).

**Regras da frente:** Sol dirige; Claude executa + [SALVAR]. **STANDING: TODO trabalho substantivo com auditoria do Sol antes do commit** ([[feedback_sol_audit_everything]]; bundle escopado `--mode prose --file`, effort max, veto assimétrico = verificar rodando). Método: **probe no GSAP 3.15 real decide** (asset `~/Desktop/IA/Unspirit-Clone-1to1/site/assets/gsap/3.15.0/gsap.min.js`), TDD estrito (RED observado antes de GREEN), 1 commit/item.

**Decisões de produto do Adilson (STANDING):** 2 animações num elemento → AMBAS sempre nos controles, cada uma editável; NUNCA dialog bloqueante sem escolha. Scale uniforme: arrastar proporcional = desejado. UI text em INGLÊS.

---

## 1. RETOMAR AQUI — furo #2: per-track keyframe editability (fecha o bloqueio Sol v5)

### Estado do working tree (uncommitted, suíte 1320/1320 verde, witness real-GSAP verde)
- `packages/web-shell/lib/motion-editor/runtime-bridge-source.js`:
  - `'css'` adicionado a `GSAP_CONFIG_VARS` (wrapper nunca vira track).
  - Helper novo `gsapDescriptorComponentKeys(property)` (component-keys possíveis por runtimeProperty — espelhado por classificador E writer).
  - `gsapClips`: `cssWrapper` extraído; sub-keys mergeadas em `topLevelProps` (dedup); `cssOnlyTween` (todo animatedProp autoral no wrapper); `rawValue` lê o wrapper quando top-level ausente (writeModel real p/ `css:{x:'+=60'}`); locks de retargetable: `(authoredInCss && writeModel!=='absolute') || cssProvenanceMismatch` — mismatch = `authoredInCss !== writeLandsInCss`, onde `writeLandsInCss` usa o MESMO predicado do bucket do writer (name OU component no wrapper; pega `{scale, css:{scaleX}}` e a colisão x↔css.x).
  - `gsapEditableTracks` `endOnly`: valor cai pro wrapper (nunca `''` quando o valor é conhecido).
  - `gsapKeyframeProps`: recursão em `entry.css` (GSAP honra css DENTRO de entradas de keyframes — probado).
  - `assignGsapAbsolute`: **bucket** = wrapper se `property in css || descriptor.component in css` (rollback com descriptor stale pós-split acha o wrapper), senão vars; todos os branches (origin/transform/scale-split/generic) escrevem no bucket.
  - `applyGsapKeyframe`: guarda por-propriedade pra css (`property in vars.css` → throw).
  - `capabilities.keyframes`: `sampled && !runBackwards && !vars.keyframes && !cssOnlyTween`.
- `packages/web-shell/lib/motion-editor/runtime-bridge-source.test.js`: **7 testes novos** (retarget INTO vars.css; component-split + writeModel relative lock + ROLLBACK stale-descriptor; kf-css entries + loop css lock; colisão x↔css.x com sampling DISPONÍVEL + cross-family `{scale, css:{scaleX}}` + endOnly wrapper; tween MISTO mantém capability).
- `packages/web-shell/_probe-furo2-witness.mjs` (untracked, PRESERVADO): witness end-to-end no GSAP real — re-rodar após qualquer mudança (`node _probe-furo2-witness.mjs`).

### O bloqueio Sol v5 (verbatim, o que falta)
No tween misto `{x:100, css:{opacity:0.5}}`, `capabilities.keyframes=true` do clip habilita na UI o diamond/input de `opacity` (wrapper), cuja `keyframe.opacity` a guarda SEMPRE rejeita — capability promete o que o guard recusa (`runtime-bridge-source.js:706` vs `:1945`; consumo na UI `NativeMotionEditor.jsx:1589`).
**Fix prescrito:** expor **editabilidade de keyframe POR TRACK** (ex.: flag na track/ownership) e fazê-la valer no controller/UI — `x=true`, `opacity=false` no misto — mantendo o guard como defesa. **Regressões exigidas:** `keyframe.x` APLICA; `opacity` desabilitada SEM emitir patch.
**Nota de design:** essa infra por-track é **pré-requisito natural da FASE 2** (item 3) — desenhar a flag já pensando nela (keyframes tweens da forma array vão precisar do mesmo canal).

### Sequência sugerida
RED (regressões do Sol) → GREEN (flag na track + consumo no controller/UI — mapear onde `capabilities.keyframes` é lido: `NativeMotionEditor.jsx:1589` região, `useNativeMotionController` autoKeyframe path) → suíte + witness → **veredito v6 do Sol** (bundle com delta) → commit ÚNICO do furo #2 inteiro (mensagem já meio pronta no addendum do finding).

### Placar Sol no furo #2 (contexto — 5 rodadas, todas com achado real)
r1: css-em-keyframes invisível + relative/function/loop writeback errado + component escapando do wrapper. r2: procedência instável (undo silenciosamente falho — stale descriptor). r3: cross-family `{scale, css:{scaleX}}`. r4: falso-positivo (blanket `!vars.css` travava misto legítimo). r5 (ATIVO): capability×guard inconsistentes no misto. Probes que decidiram: transform-string writeback LIMPO (metade do furo caiu — audit original errado); `vars.css.x`/`css.scale`/split `css.scaleX/scaleY` limpos; top-level write em css tween = no-op.

---

## 2. FEATURE caminho-seguro (retarget real da forma array de keyframes)
O que é: tweens `keyframes:[{x:0},{x:60}]` hoje são detectados mas read-only (furo #1, `8e21daaa`). Probe (2026-07-29, semântica EXATA `invalidatePreservingStart`) provou writeback SEGURO: **editar as ENTRADAS de `vars.keyframes`** + preserved-start → path `[0,0,100,200,200]` limpo (início intacto, forma preservada, fim retargetado). O writeback atual (`vars[prop]`) corrompe mesmo com preserved-start — NUNCA usar pra keyframes.
Trabalho: semântica multi-entrada (quais entradas carregam o valor final — trailing run), undo restaurando as entradas certas, loops/unidades, classificação por-forma (array editável; objeto/percent seguem sem caminho — no-op probado); flip de `retargetable` pra array-form; TDD + probes + Sol. Formas: array `[{x,duration}...]`; property-array `{x:[...],easeEach}`; stops `"50%"` E numéricos `50` (GSAP parseFloat'a).

## 3. FASE 2 da feature — editar ETAPAS INDIVIDUAIS na timeline
Keyframes tweens hoje têm timeline 100% read-only. Fase 2: diamantes por etapa (offsets derivados das durations das entradas), edição de cada etapa (write por entry-edit do item 2), reabilitar `capabilities` por-forma (usar a infra POR-TRACK do item 1), afrouxar a guarda do `applyGsapKeyframe` só pra forma array. Explicação de produto: a coreografia inteira editável passo a passo, como editor de animação de verdade.

## 4. Furo #4 — multi-target/split-text ownership
Ownership atribuída ao 1º target; selecionar o 2º membro filtra o candidato (`motion-ownership.js:102-103`) → `unowned` → style-stomp. Fix: membership vs target efetivo; classificar `unsupported/shared`, nunca `unowned`. Corrobora: comentário in-code sobre stagger facade (`applyGsapKeyframe`). **Esbarra no unchain da Task 12 do gate** — coordenar com o Sol.

## 5. Fila da Task 16 (gate persistido /canvas) — pausada, contexto completo nos handoffs
- Task 12 (ambiguous/unlink/reconnect): handoff `2026-07-28-task16-task12-ready-handoff.md` COM ADDENDUM — fixture do chooser = **Entrance+Hover** (x+x e CSS drift+pulse = ambiguidade falsa); unlink tem 2 bloqueios documentados; regra do Adilson (ambas nos controles) deve orientar o redesign do cenário COM o Sol.
- Tasks 13–18 + 19–20: ver plano `2026-07-28-task16-persisted-e2e-gate-implementation.md` + handoffs. Env isolado Neon `ep-orange-frost-acaedcil` PRONTO (nunca produção `ep-lingering-shadow-achloaoq`); run command no handoff da Task 11.

## 6. Residuais conhecidos (menores, documentados)
- Foco de teclado do LAB (3032) não move ao ativar o cadeado (tabs sem id — refactor de refs; superfície dev).
- Tween misto: keyframe-edit de track do wrapper protegido só pela guarda (erro claro) até o item 1 aterrissar.
- endOnly fallback: valores de função viram `''` (convenção).

## Como rodar
- Suíte: `cd packages/web-shell && npx vitest run` (esperado: 1320 passed / 10 skipped no estado atual).
- Witness furo #2: `node _probe-furo2-witness.mjs` (na raiz do web-shell).
- Sol: `cat <bundle.md> | ~/.claude/bin/codex-adversary.sh --mode prose --timeout 1200 --focus "..."` (bundle = contexto + `git diff` dos arquivos; nunca `--mode diff` neste repo).
- Probes GSAP real: playwright-core + `gsap.min.js` do clone (padrão dos `_probe-*.mjs` desta sessão, reproduzíveis pelo finding).

## Docs canônicos
- Finding do arco (inventário, probes, placar, addenda): `docs/superpowers/handoffs/2026-07-29-gsap-ownership-audit-finding.md`.
- CLAUDE.md itens 167–168 (+168b desta sessão). Memória: [[checkpoint_2026-07-29_gsap-ownership-audit-furos]]. Vault: `Sessões/checkpoint_2026-07-29_gsap-ownership-furos`.
