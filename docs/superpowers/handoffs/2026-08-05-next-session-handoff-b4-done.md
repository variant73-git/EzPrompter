# Handoff — próxima sessão (escrito em 2026-08-05, fim do dia)

> **Porta de entrada.** Substitui `2026-08-05-next-session-handoff.md` (aquele mandava
> EXECUTAR o plano B4 — **feito**: executado inteiro, auditado até MERGE OK, promovido).

## Estado

- Branch `codex/live-animated-clone-editing` · HEAD **`02865a4a`** (+ este handoff/[SALVAR]
  por cima) · suíte **1589/1589** (10 skip).
- **Fase 1 / chave B4 SHIPPED com MERGE OK do Sol (r6)**: OverrideChannel per-target
  completo (Tasks 1–9 do plano, TDD, RED observado em cada), witness
  `_probe-b4-witness.mjs` **55 checks verdes** no GSAP 3.15 real pelo protocolo v2
  (baseline congelado). **B4 PROMOVIDO na Tabela B** do finding doc (degrau 3) com
  addendum da audit.
- Witnesses: B4 BATE · editwrite BATE · inspeção/fase-2/entry-edit/furo2 VERDES · detach
  **11 RED byte-estáveis** (contrato aberto, intocado — não mexer).
- Audit da Fase 1: review Claude adversarial (5 achados) + Sol r2–r6 (7) = **12 fixes,
  todos com RED reproduzido antes**; detalhe no checkpoint
  `checkpoint_2026-08-05_fase1-b4-shipped` e nos commits `ac1aa96e`→`02865a4a`.

## Decisões/estreitamentos NOVOS desta sessão (não reabrir)

1. **Chave B4 estreitada pela audit** (recusas, não promoções): unidade relativa (%/vw/rem)
   FORA (atestação mede px via getProperty); carriers `snap`/`roundProps`/`modifiers` FORA;
   slot precisa ser PRÓPRIO/DATA/GRAVÁVEL. Carrier desconhecido fail-closa pela
   **verificação pós-write** (projeção + endpoints, rollback interno completo).
2. **`intent: 'clear'`** no schema v3 = forma de remoção (rollback replaya ausência);
   **no-op idempotente antes de TODOS os gates** (ressurreição incluída — r5/r6). Com
   entrada real: hazard e carrier são gates duros; só repeat/css estruturais são puláveis.
3. **Teardown sob hazard NÃO invalida** (colapsa o slot; render fica pro próximo invalidate
   da página — não se executa função da página que os writers recusam tocar).
4. **Adiamento aceito pelo Sol**: marcador estável do serializer colateral NÃO conta como
   evidência B4/B5/B6.
5. **Residuais documentados** (addendum do finding doc): lock monotônico permanente com
   wrapper deslocado pela página (doutrina fail-closed; recuperação por atestação =
   decisão de produto se um dia doer); clear sob hazard de função recusa; registro forte
   de canais retém animations até teardown (bounded).

## Fila (ordem herdada, inalterada)

1. **B5/B6** (repeat/yoyo per-target) — witnesses próprios, mesma infra do canal; a
   promoção do B4 NÃO os promove.
2. **Wrapper de transplante** (B1 → B2a/B2b → B3) — degrau 1; decisão de produto pendente
   ("quem herda o callback de conclusão do grupo" — levar ao Adilson).
3. **UI de polish do override** (marquinha no campo, menu "Reset all changes") — contrato
   já decidido; `resetOverride` do controller é o comando que a UI vai chamar.
4. **Task 16 / gate persistido `/canvas`** — Tasks 12–20 pausadas. Env Neon isolado
   `ep-orange-frost-acaedcil` — NUNCA produção.
5. Residual `</body>` do injetor (bounded) · r46 (deferida, dono Adilson, por gatilho).

## Como retomar

```bash
cd ~/Desktop/IA/Uncraft && git checkout codex/live-animated-clone-editing
cd packages/web-shell
npx vitest run                     # 1589
node _probe-b4-witness.mjs         # "0 RED · contrato-vs-baseline: BATE"
node _probe-editwrite-witness.mjs  # "0 RED · BATE"
node _probe-detach-witness.mjs     # 11 RED (contrato aberto)
```

- Witnesses de DENTRO de `packages/web-shell`; caminhos absolutos SEMPRE.
- Sol: `~/.claude/bin/codex-adversary.sh --mode prose --effort max --timeout 1400`
  (`--repo` no root, `run_in_background`). Veto assimétrico nas duas direções.
- Modelo de coordenação: **Sol dirige a frente; Claude executa/revisa (lead) + [SALVAR]**.

## Lições de método desta sessão

1. ⭐ **Cada fix de audit pode criar o bloqueador da rodada seguinte** — r3–r6 foram todos
   consequência dos fixes anteriores (lane do clear × hazard × no-op × ressurreição).
   Fix num gate exige re-examinar TODAS as lanes que o atravessam, na ordem.
2. ⭐ **Verificação pós-write com rollback interno fecha CLASSES; lista fecha instâncias.**
3. **No-op idempotente vem antes de qualquer gate** (replay/rollback dependem disso).
4. **Recusa testada por MENSAGEM específica, nunca por rejeição genérica** (o gate de
   schemaVersion tornaria tudo verde por vácuo).
5. **Dois revisores independentes convergiram no mesmo par de bugs** (readback-v2 +
   tombstone) por caminhos diferentes — o custo do adversarial-review duplo segue pagando.
