# Handoff — próxima sessão (escrito em 2026-08-05, atualizado no fim da sessão)

> **Porta de entrada.** Substitui `2026-08-03-next-session-handoff.md`.
> **A PRÓXIMA AÇÃO É EXECUTAR UM PLANO JÁ PRONTO E AUDITADO POR ADVISE:**
> `docs/superpowers/plans/2026-08-05-fase1-b4-per-target-writer.md` (Tasks 1–9, inline via
> `superpowers:executing-plans`, TDD com RED observado). Não re-decidir nada listado em
> "Decisões fechadas" abaixo.

## Estado

- Branch `codex/live-animated-clone-editing` · HEAD **`95d8b9f3`** · suíte **1538/1538** (10 skip).
- Witnesses: **editwrite 0 RED baseline BATE** (novo); inspeção/fase-2/entry-edit/furo2
  VERDES; detach **11 RED byte-estáveis** (contrato aberto, intocado — não mexer).
- Docs canônicos: spec `docs/superpowers/specs/2026-08-05-chain-override-per-target-design.md`
  · finding doc `docs/superpowers/handoffs/2026-08-05-fase0-provas-finding.md` (Tabelas A/B +
  Gate) · plano B4 (acima).

## Decisões fechadas (NÃO reabrir)

1. **Contrato de produto (Adilson, brainstorm 2026-08-03→05):** sempre-override — corrente =
   indicador puro; editar camada acorrentada = edição só dela; NUNCA recusa ao usuário.
   Reset POR PROPRIEDADE (marquinha discreta no campo) + "Reset all changes" só no menu de
   contexto; indicador de sobrescrita SÓ nos campos. "Provar primeiro, entregar depois."
   Detach = rota interna (disposição do handoff 2026-08-03, mantida).
2. **Arquitetura do writer per-target (Adilson, 2026-08-05): OPÇÃO B — canal de override com
   mapa vivo**, na versão ENDURECIDA do advise do Sol (máquina de estados, proveniência
   contextual, wrapper de identidade estável). O advise completo está incorporado no plano;
   os pontos não-negociáveis viraram Global Constraints do plano.
3. **Roteador forma→degrau:** hoje TUDO roteia degrau 4 (exceto single-owner = edição direta
   shipada); promoção SÓ por probe combinado da chave exata
   `{estrutura, modificadores+dono/local de autoria, targetScope, caminho}`. B4 é a primeira
   chave a promover; **B5/B6/B2a/B2b/B3/B7 NÃO são consequência de B4**.

## O que esta sessão fez (resumo; detalhe nos docs canônicos)

1. **Fase 0 COMPLETA** — 6 provas (P1–P6) no GSAP 3.15 real: SplitText re-split substitui
   tudo (identidade=índice); harness de escrita real (`_probe-fase0-harness.mjs`, v1);
   conversão escalar→função viável no MOTOR; conversão CRUA fail-closa a edição inteira
   (protocolo positivo = obrigação da Fase 1); transplante núcleo estreito provado (fachada
   carrega repeat/yoyo/timeScale/callbacks); **fix P6b SHIPPED `5e19d88d`** — edição não
   danifica mais o temporal de repeat/yoyo (park/restore E amostra-início por `totalTime`;
   veto r1 do Sol reproduzido: `additive-base` corrompia loops; MERGE OK r2).
2. **Audit consolidada do finding doc: MERGE OK r10** — 10 achados do Sol aceitos; 2 probes
   de dono (o MESMO `repeat/repeatRefresh` muda de dono conforme autorado top-level=fachada
   vs dentro de `stagger{}`=filho); 1 claim vácuo meu derrubado por probe.
3. **Fase 1 aberta**: advise do Sol sobre a arquitetura B4 (Opção B endossada e endurecida;
   3 bugs latentes achados no código atual — ver plano Tasks 4/5/6) + plano de 9 tasks
   escrito e commitado.

## Como retomar (execução do plano B4)

```bash
cd ~/Desktop/IA/Uncraft && git checkout codex/live-animated-clone-editing
cd packages/web-shell
npx vitest run                        # 1538 — baseline antes de começar
node _probe-editwrite-witness.mjs     # "0 RED · contrato-vs-baseline: BATE"
node _probe-detach-witness.mjs        # 11 RED (contrato aberto)
```

Depois: `superpowers:executing-plans` com o plano B4, task a task, commit por task.
Estruturas centrais e assinaturas estão no bloco "Estruturas centrais" do plano — usar os
MESMOS nomes (`gsapOverrideChannels`, `gsapOverrideProvenance`, `applyGsapPerTargetOverride`,
`gsapPerTargetEligibility`, `gsapAttestOverrideEndpoints`, `ownership.perTarget`).

**Âncoras de código pro B4** (verificadas nesta sessão):
- `applyGsapRetarget` + gate `scope_mismatch`: `runtime-bridge-source.js:4691`.
- Entrada `retarget.final` em `applyMotionPatch`: `:5045`. Transações v2:
  `apply-transaction`/`rollback-transaction`/`validate-transaction` `:6836-6858`;
  `commandV2` em `lib/motion-editor/protocol.js:79`; boot v2 = `bootV2Runtime` do
  `runtime-bridge-source.test.js`.
- Precedente de função escrita pelo bridge: `applyGsapFunctionOffset` + `gsapFunctionRetargets`.
- Hazard de função/proveniência: `gsapRandomObservedAnimations`/`gsapTopFunctionProps`/
  `gsapHasRandomizedValue` `:1330-1570` (memória MONOTÔNICA — a exceção do canal não pode
  contaminá-la nem limpá-la).
- Serializer/colateral: `gsapVarsCollateralState` ~`:3905`. Teardown: ~`:7194`.
- UI: `buildFinalTargetPatch` em `lib/motion-editor/retarget-patch.js:64` (descriptor v2 hoje;
  v3 na Task 7 — POR ÚLTIMO, ordem do advise).
- ⚠️ Bugs latentes que o advise achou (as tasks 4/5/6 os matam — não esquecer):
  re-inspeção classificaria wrapper como `function-offset`; `readGsapRetarget` amostra
  `record.target` (editar B capturaria A no undo); `teardown` não restaura `vars`.

- Witnesses de DENTRO de `packages/web-shell`; **caminhos absolutos SEMPRE** (o cwd herdado
  mordeu 2× nesta sessão — inclusive mandou bundle VAZIO pro Sol na r8 da audit; conferir o
  1º byte do output de comando composto).
- Sol: `~/.claude/bin/codex-adversary.sh --mode prose --effort max --timeout 1400` (review) /
  `--mode advise` (decisão), `--repo` no root, `run_in_background`. Veto assimétrico nas duas
  direções: achado dele = reproduzir rodando; refutação minha = só com probe.
- Modelo de coordenação: **Sol dirige a frente; Claude executa/revisa (lead) + [SALVAR]**.
- Budget (regra standing): avisar se baixo ANTES de trabalho grande; Task 8 (witness) e Task 9
  (audit até MERGE OK) são as mais caras do plano.

## Fila depois do B4

1. **B5/B6** (repeat/yoyo per-target) — witnesses próprios, mesma infra do canal.
2. **Wrapper de transplante** (B1 → B2a/B2b → B3) — degrau 1; decisão de produto pendente:
   "quem herda o callback de conclusão do grupo" (levar ao Adilson quando chegar lá).
3. **UI de polish do override** (marquinha visual, menu de contexto "Reset all changes") —
   fase própria; contrato já decidido.
4. **Task 16 / gate persistido `/canvas`** — Tasks 12–20 pausadas. Env Neon isolado
   `ep-orange-frost-acaedcil` — NUNCA produção.
5. **Residual `</body>` do injetor** (bounded) · **r46** (deferida, dono Adilson, gatilho).

## Lições de método desta sessão (novas; o resto no CLAUDE.md)

1. ⭐ **Witness que força um write model não cobre o classificador** — derivar SEMPRE da
   publicação (`ownership.writeModel`); dois instrumentos independentes podem partilhar o
   mesmo ponto cego de fixação.
2. ⭐ **Assinatura de prova completa = {estrutura, modificadores + DONO/local de autoria,
   targetScope, caminho}** — e tabela de FATOS separada de tabela de HIPÓTESES (10 rodadas
   do Sol pra convergir; cada bloqueio dele era uma herança indevida real).
3. **`progress(0)` não é o início** em tween repeat parado em iteração posterior (renderiza o
   FIM da iteração anterior); início semântico só por `totalTime(0, true)`.
4. **Probe de modificador exige o modificador ATIVO** (`yoyo` sem repeat, `repeatRefresh` sem
   fronteira = verde vácuo).
5. **Recomendação sem estado-de-prova anexado é opinião** — o "baseado em quê?" do Adilson
   converteu a decisão de produto em sequência de provas (Finding registrado).
