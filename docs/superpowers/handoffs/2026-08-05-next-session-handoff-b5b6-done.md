# Handoff — próxima sessão (escrito em 2026-08-05, noite)

> **Porta de entrada.** Substitui `2026-08-05-next-session-handoff-b4-done.md` (aquele
> mandava executar B5/B6 — **feito**: executado, auditado até MERGE OK POR CHAVE,
> promovido na Tabela B).

## Estado

- Branch `codex/live-animated-clone-editing` · HEAD **`454c316b`** (+ este handoff/[SALVAR]
  por cima) · suíte **1623/1623** (10 skip).
- **Chaves B5 e B6 SHIPPED com MERGE OK POR CHAVE do Sol (r6)**: per-target override sob
  repeat finito (B5) e repeat+yoyo (B6), como **predicados QUANTIFICADOS provados por
  MATRIZ**. Witnesses próprios (B5 `_probe-b5-witness.mjs` 96 checks; B6
  `_probe-b6-witness.mjs` com matriz de paridade), baselines congelados, GSAP 3.15 real,
  protocolo v2, publicação como verdade.
- Witnesses: B5 BATE · B6 BATE · B4 BATE (check (j) mudou de fronteira: repeat:-1
  permanente) · editwrite BATE · inspeção/fase-2/entry-edit/furo2 VERDES · detach **11 RED
  byte-estáveis** (contrato aberto, intocado — não mexer).
- Audit da rodada: **6 rodadas, 10 achados corrigidos** (todos com RED/repro observado),
  detalhe no checkpoint `checkpoint_2026-08-05_fase1-b5-b6-shipped` e nos commits
  `c329b0aa`→`454c316b`.

## ~~⚠️ PENDENTE DE CIÊNCIA DO ADILSON~~ → RESOLVIDO (2026-08-05)

> **Adilson deu ciência e manteve a emenda** (sessão de 2026-08-05, noite): predicados
> quantificados ficam; sem rollback. Decisões da mesma sessão: callback de conclusão do
> grupo vai pro Sol como advise antes do martelo; fila retomada pelo item 1 (transplante).

**Emenda doutrinária na Tabela B** (finding doc `2026-08-05-fase0-provas-finding.md`,
addendum B5+B6): as linhas B5/B6 deixaram de ser chaves literais (`repeat: 2` / `repeat:
3`) e viraram **predicados quantificados** ("repeat inteiro positivo finito") provados por
MATRIZ (B5: n=1/2/5; B6: paridades par/ímpar/canônico). Recomendação do advise do Sol
(abrir família por 2 exemplares seria indevido; chave literal seria suporte de produto
arbitrário), endossada por 6 rodadas de audit dele até MERGE OK. **Se o Adilson discordar,
o rollback é: estreitar o classificador pros n literais + re-registrar baselines** (o
código torna isso um par de condições).

## Decisões/estreitamentos NOVOS desta sessão (não reabrir)

1. **Classificador temporal ÚNICO em 4 lanes** (publicação/gate-do-clear/sampler/
   elegibilidade-normal) — `gsapOverrideClockUnsampleable` é o predicado de clock
   compartilhado; qualquer lane nova que leia o clock DEVE usá-lo (lição r3–r4: cada
   lane esquecida virou bloqueador).
2. **Publicação split**: `perTarget.available` = removibilidade EFETIVA (gates do clear
   real); `perTarget.writable` = forma atual aceita write novo. **A UI do override (fila
   3) deve consumir `writable`** pra desabilitar campos sob drift sem esconder o estado.
3. **Atestação amostra na FRONTEIRA da 1ª iteração pelo clock TOTAL** (nunca
   progress(1) — inválido sob repeat infinito; verde antigo era acidental).
4. **Recusas temporais por mensagem própria** (11 formas) — recusa testada por MENSAGEM,
   nunca rejeição genérica.
5. **Fora das chaves** (seguem recusados, promoção só com witness próprio): repeatDelay
   (qualquer sinal + presença autoral), repeatRefresh, yoyoEase, easeReverse, infinito,
   fração, duração zero/não-finita, clock NaN, ScrollTrigger, timeline-pai, write model
   per-target additive-base.

## Fila (ordem herdada)

1. **Wrapper de transplante** (B1 → B2a/B2b → B3) — degrau 1; decisão de produto
   pendente ("quem herda o callback de conclusão do grupo" — levar ao Adilson).
2. **UI de polish do override** (marquinha no campo, menu "Reset all changes";
   `resetOverride` já existe; consumir `perTarget.writable` novo).
3. **Task 16 / gate persistido `/canvas`** — Tasks 12–20 pausadas. Env Neon isolado
   `ep-orange-frost-acaedcil` — NUNCA produção.
4. Residual `</body>` do injetor (bounded) · r46 (deferida, dono Adilson, por gatilho).

## Como retomar

```bash
cd ~/Desktop/IA/Uncraft && git checkout codex/live-animated-clone-editing
cd packages/web-shell
npx vitest run                     # 1623
node _probe-b5-witness.mjs         # "0 RED · contrato-vs-baseline: BATE" (96 checks)
node _probe-b6-witness.mjs         # "0 RED · BATE"
node _probe-b4-witness.mjs         # "0 RED · BATE"
node _probe-editwrite-witness.mjs  # "0 RED · BATE"
```

- Witnesses de DENTRO de `packages/web-shell`; caminhos absolutos SEMPRE.
- Sol: `~/.claude/bin/codex-adversary.sh --mode prose/advise --effort max --timeout 1400`
  (`--repo` no root, `run_in_background`). Veto assimétrico nas duas direções.
- Modelo de coordenação: **Sol dirige a frente; Claude executa/revisa (lead) + [SALVAR]**.

## Lições de método desta sessão

1. ⭐ **JSON.stringify mascara Infinity/NaN como null** — todo probe de getter serializa
   typeof + String + Number.isFinite explícitos. Dois claims caíram por isso (repeat()
   e duration() devolvem Infinity NUMÉRICO, não null).
2. ⭐ **Procedência de RED→GREEN = par de hashes MEDIDO dos dois lados** — "commit pai"
   sem verificar onde o fix entrou declara causalidade falsa (r5).
3. ⭐ **Verde acidental**: um check pode passar por estado path-dependent; quando um fix
   ortogonal quebra um check verde, re-derivar POR QUE ele era verde (bisect em worktree
   resolve em uma rodada).
4. **Getters do GSAP normalizam** (yoyo() false com vars.yoyo true; duration() Infinity
   pra 1e308; repeat() Infinity pra -2) — gate lê getter vivo E presença autoral.
5. **Fatos por probe ANTES do design**: os probes F1–F4 provaram que o motor já servia
   — a sessão inteira foi gate/lanes/witnesses, zero mudança no writer/canal.
