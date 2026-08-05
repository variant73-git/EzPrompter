# Handoff — próxima sessão (escrito em 2026-08-05)

> **Porta de entrada.** Substitui `2026-08-03-next-session-handoff.md`. Detalhe de evidência:
> finding doc `2026-08-05-fase0-provas-finding.md` (as 6 provas + Tabelas A/B + gate) e spec
> `docs/superpowers/specs/2026-08-05-chain-override-per-target-design.md`. Ler a § citada,
> nunca adivinhar.

## Estado

- Branch `codex/live-animated-clone-editing` · HEAD `d3667f48` · suíte **1538/1538** (10 skip).
- Witnesses: **editwrite (novo) 0 RED baseline BATE**; inspeção/fase-2/entry-edit/furo2
  VERDES; detach **11 RED byte-estáveis** (contrato aberto, intocado).

## O que esta sessão fechou (2026-08-03→05)

1. **Brainstorm da Opção A com o Adilson → decisões de produto** (spec §1 e §6): contrato
   sempre-override; "provar primeiro, entregar depois"; reset por propriedade (marquinha no
   campo) + "Reset all changes" só no menu de contexto; indicador de sobrescrita SÓ nos
   campos; corrente = indicador puro. Disposição do detach (rota interna) mantida, não
   reaberta.
2. **Advise do Sol sobre "detach é intransponível?"**: impossível EM PRINCÍPIO pra runtime
   arbitrário (fronteira = cooperativo vs arbitrário, não amostrável vs adaptativo); caro-
   porém-viável em universo fechado; corrigiu meu otimismo do PropTweens ("não fecha por
   construção") e trouxe o caminho do TRANSPLANTE. Escada de 4 degraus no spec §2.
3. **Fase 0 executada INTEIRA (plano `2026-08-05-fase0-provas-override-per-target.md`)** —
   6 provas, cada uma com witness/probe + registro no finding doc:
   - P1 SplitText real (re-split substitui tudo; identidade = índice)
   - P3 harness de escrita real (`_probe-fase0-harness.mjs`, sensível nos 2 lados)
   - P4 conversão escalar→função (viabilidade no MOTOR; isola alvo, rollback byte-igual)
   - P2 proveniência (conversão crua fail-closa TUDO; protocolo positivo = obrigação Fase 1)
   - P5 transplante (núcleo estreito provado; fachada carrega repeat/yoyo/timeScale/callbacks)
   - P6 caminho de escrita: witness 6 RED → **fix SHIPPED `5e19d88d`** (park/restore por
     `totalTime` + amostra-início por `totalTime(0)`; veto r1 do Sol reproduzido número a
     número — `additive-base` corrompia loops; MERGE OK r2)
4. **Audit consolidada da Fase 0: MERGE OK na rodada 10.** Placar: 10 achados do Sol aceitos
   (3 na r1 + 7 nas r2–r9), 2 probes de dono novos, 1 claim vácuo meu derrubado por probe.
   Resultado estrutural: **Tabela A (fatos provados com assinatura completa) separada da
   Tabela B (hipóteses B1–B7)**; roteador conjuntivo; **degrau HOJE = 4 pra tudo** (exceto
   canal single-owner = edição direta shipada); promoção SÓ por probe combinado da chave
   exata (Gate da Fase 1, no finding doc).

## Fase 1 — o que ela é (quando for aberta)

Construir o sistema de override com o mapa da Fase 0. Peças, na ordem que o gate sugere:

1. **Writer per-target no bridge** (novo write model em `applyGsapRetarget`; hoje
   `scope_mismatch`) com o **protocolo de edição própria** (P2): proveniência positiva da
   função introduzida + refresh de bindings/colateral + re-exposição. Fechar B4 (plano sem
   mod.) primeiro — é a chave mais simples.
2. **B5/B6** (repeat/yoyo per-target) — o padrão temporal do P6b já protege o writer atual;
   re-provar na chave exata.
3. **Wrapper de transplante** (B1) projetando fachada (repeat/yoyo/timeScale/callbacks =
   decisão de produto pendente pro "quem herda callback"); depois B2a/B2b (owner por LOCAL de
   autoria!) e B3 (re-engate SplitText).
4. **UI**: marquinha de override nos campos + reset por propriedade + "Reset all changes" no
   menu de contexto; corrente vira indicador com tooltip. Texto em inglês.
5. Cada promoção passa pelo probe combinado do Gate (finding doc, seção final) com witness
   por chave, e por audit do Sol (standing).

## Fila depois

1. **Task 16 / gate persistido `/canvas`** — Tasks 12–20 pausadas desde o item 168. Env Neon
   isolado `ep-orange-frost-acaedcil` — NUNCA produção. Plano
   `docs/superpowers/plans/2026-07-28-task16-persisted-e2e-gate-implementation.md`.
2. **Furo #4** — absorvido pela Fase 0/1 desta frente (os 4 pré-requisitos viraram P1–P4).
3. **Residual `</body>` do injetor** (bounded, política própria).
4. **r46** — deferida, dono Adilson, reabre por gatilho.

## Como retomar

```bash
cd ~/Desktop/IA/Uncraft && git checkout codex/live-animated-clone-editing
cd packages/web-shell
npx vitest run                        # 1538
node _probe-editwrite-witness.mjs     # esperado "0 RED · contrato-vs-baseline: BATE"
node _probe-inspect-witness.mjs       # esperado "WITNESS VERDE"
node _probe-phase2-witness.mjs        # esperado "TUDO VERDE"
node _probe-entryedit-witness.mjs     # esperado "TUDO VERDE"
node _probe-furo2-witness.mjs         # esperado "TUDO VERDE"
node _probe-detach-witness.mjs        # esperado 11 RED (contrato aberto)
```

- Witnesses de DENTRO de `packages/web-shell`; caminhos absolutos SEMPRE (o cwd herdado
  mordeu de novo nesta sessão — inclusive mandou um bundle VAZIO pro Sol na r8; conferir o
  primeiro byte do output de comandos compostos).
- Probes fase-0 (rodáveis): `_probe-furo4-splittext-real.mjs`, `_probe-fase0-{harness,p4-multitarget,p2-provenance,p5-transplant}.mjs`.
- Sol: `~/.claude/bin/codex-adversary.sh --mode prose --effort max --timeout 1400`, bundle
  com `cd` explícito pro repo root; `--mode advise` pra decisões. `run_in_background`.
- Modelo de coordenação: **Sol dirige a frente; Claude executa/revisa (lead) + [SALVAR]**.

## Lições de método desta sessão (novas)

1. ⭐ **Witness que força um write model não cobre o classificador** — meus DOIS instrumentos
   (witness + vitest) forçavam `absolute` e o defeito real morava no `additive-base`
   publicado. Derivar o write model da PUBLICAÇÃO (`ownership.writeModel`), nunca fixar.
2. ⭐ **Assinatura de prova completa = {estrutura, modificadores + DONO/local de autoria,
   targetScope, caminho}** — o MESMO par `repeat/repeatRefresh` muda de dono conforme
   autorado top-level (fachada) ou dentro de `stagger{}` (filho); prova de um escopo não
   promove outro. E separar SEMPRE tabela de fatos (A) de tabela de hipóteses (B).
3. **`progress(0)` não é o início** em tween repeat parado em iteração posterior — a
   fronteira renderiza como FIM da iteração anterior; início semântico só por
   `totalTime(0)`. (Mesma família da lição "validar renderizando do início".)
4. **Probe de modificador exige o modificador ATIVO** — `yoyo` sem `repeat>0` e
   `repeatRefresh` sem fronteira cruzada dão verde vácuo (a classe "controle de
   sensibilidade", de novo, em forma nova).
