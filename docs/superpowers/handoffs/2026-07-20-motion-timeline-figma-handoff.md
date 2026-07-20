# Handoff — Timeline Figma Motion + rounds de smoke + revisão adversarial (2026-07-20)

**Branch:** `feat/native-motion-editor` · **746/746 testes** · Commits `cd1dec5d..78de1b3b` (9) + compactação do CLAUDE.md (`3d35423d`).

## O que existe agora

A timeline do motion editor foi redesenhada no modelo **Figma Motion** (teardown completo feito: página, 6 vídeos com frames extraídos, docs — frames em scratchpad da sessão, resumo no plano). Plano canônico: `docs/superpowers/plans/2026-07-20-motion-timeline-figma-style.md`. Ponteiro no doc antigo: plano 2026-07-18 §7.

### Arquitetura da timeline (NativeMotionEditor.jsx)
- **UM scroller** contém labels (sticky left) e tracks; régua sticky top; playhead full-height com **cap ancorada na régua** (sobrevive a scroll vertical da lista). Dessincronizar labels/strips é estruturalmente impossível.
- Rows: **layer** (elemento; chevron expande; strip = botão que seleciona o elemento no site; brackets; trim handles) → **clips** (sub-rows por animação, label+strip clicáveis, homônimos diferenciados por `nome · propriedade · duração`) → **properties** (losangos + steppers `< ◇ >` + valor no playhead).
- Scrub = pointer em área vazia (playhead sobre strips FIXAS); inset de 5px (`TRACK_INSET` espelha o border-left do CSS — mudar um exige mudar o outro); resize de altura (166–332, handle na borda superior) e de labels (110–340, divisor) persistidos em localStorage.
- Painel direito (MotionPanel) = **só propriedades do clip ativo** (transporte e lista removidos; Stagger vive em Timing).
- Drag de duração (borda direita de strip time, só na régua de scroll): **DELTA** px→ms a 0.06px/ms sobre a duração do clip ativo.

### Bridge (runtime-bridge-source.js) — modelo de dados
- **Full-page inventory**: toda animação da página vira row (offscreen flagada, nunca escondida).
- **Hosts**: fragmento dentro de h1–h6/p/blockquote pertence AO TEXTO (exceto media: img/svg/video/etc mantêm row própria); heurística de split continua pra resto.
- **Ownership**: clip pertence ao host do SEU alvo — containers nunca absorvem tweens dos filhos (`inspectMotion`/`gsapAnimationsFor` filtram por `safeHost(target) === safeHost(element)`).
- **Estabilidade (regra do Adilson)**: lista ordenada por **CHEGADA** (`rowCache` com seq; novidade SEMPRE no fim), posições latched (`revealAtCache`); invalidação: resize do viewport, mudança >2% de scrollHeight, comando refresh. Validado: 0/133 strips movem num scrub 0→9000px.
- **Seleção site↔timeline**: `hostRowId` resolvido contra as rows EMITIDAS (`lastRowHosts` — atribuição de host DERIVA entre emits com split markers lazy); wrapper com 2+ hosts dentro → null.
- **Replay-on-pass (convenção edit-mode)**: cruzar strip (scrub ou scroll) re-toca animações time-driven. Peças: `autoRemoveChildren=false` no edit (GSAP mata one-shots ao completar — 27→15 medido; valor ORIGINAL do site é guardado/restaurado no preview), guarda anti-inchaço (>600 children → mata micro-tweens completos <250ms), restart pela RAIZ da cadeia (pula raízes pausadas-nunca-tocadas = menus/hover), WAAPI escopado por ownership. Preview = comportamento original, nada persiste.
- **Tudo clicável**: `chooseElement` tem fallback pro nó atingido (28/28 numa varredura do fixture).
- Comandos novos: `focus-element` (seleciona + rola até + re-toca 1×, gated edit), `describe-element` (detalhe sem tocar seleção, alimenta `motionDetail` do shell).

## Revisão adversarial (obrigatória — o user cobrou)
Claude lens + **Codex Sol** (`~/.claude/bin/codex-adversary.sh --mode prose --file <diff escopado>` — NUNCA `--mode diff` neste repo, untracked estoura). 11 fixes verificados no commit `78de1b3b` (mensagem tem a lista fonte-a-fonte); 1 achado do Sol refutado com grep. **Tradeoffs aceitos e documentados**: re-latch em churn >2% de scrollHeight (páginas pin-pesadas), `motionDetail` stale até re-seleção, replay re-dispara callbacks do site.

## Ferramental da sessão (reusável)
- Fixture: `UNCRAFT_NATIVE_CLONE_ROOT=~/Desktop/IA/Unspirit-Clone-1to1/site npm run dev:motion` (porta 3032, `.next-motion`; ⚠️ matar porta + rm -rf ao duvidar; compile frio pode levar 2min).
- Probes playwright no scratchpad da sessão (`debug-*.mjs`, import via caminho `.bun` absoluto): estabilidade de strips, replay (contagem active/completed), seleção, clicabilidade. Vale recriar o padrão: validar TUDO ao vivo no fixture, não só na suíte.

## Pendências
1. **Smoke manual do Adilson** (rounds anteriores geraram 6+7+5 itens; esperar novo lote).
2. Spike de import no Framer (USER, plano 2026-07-18 §3.5).
3. Achatamento opcional da layer-mãe (user sinalizou "só precisa das layers de tweens" — mantive a mãe = elemento, modelo Figma; oferecido achatar se ele preferir).
4. CSS morto do painel antigo (motionTransport/motionList/viewport* órfãos no module.css).
5. `motionDetail` staleness (baixa) e teste de serializabilidade real do postMessage (a suíte mocka com array — structured clone nunca é exercido).
