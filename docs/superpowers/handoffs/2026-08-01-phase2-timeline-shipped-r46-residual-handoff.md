# Handoff 2026-08-01 — Fase-2 timeline (step-edit de etapas individuais) SHIPPED · r46 residual

> **Para a próxima sessão.** Frente `live-animated-clone-editing`, branch `codex/live-animated-clone-editing`.
> Estado ao escrever: HEAD `6870f314` · suíte **1530/1530** (10 skip) · witness fase-2 **29/29** · witness caminho-seguro **114/114** · witness furo #2 **37/37**. Working tree limpo (probes `_probe-*.mjs` untracked por convenção).

## 1. O que fechou

A **fase-2 timeline** — editar o VALOR de **etapas individuais** (entradas intermediárias) da forma ARRAY de `vars.keyframes`, não só o END (trailing run) e o START (startAt). Era o próximo item da fila desde o fechamento do caminho-seguro (item 170).

**Implementação (5 commits de feature + 42 rodadas de auditoria do Sol):**
- **Bridge** (`lib/motion-editor/runtime-bridge-source.js`): canal novo `keyframeStep.<prop>`, endereço canônico = **rawEntryIndex** (não offset — offsets duplicam com `duration:0` e somem com total zero). Plano expõe `steps[]` `{entryIndex, offset, value, editable, reason?, isEnd?, token}`. Writer `applyGsapKeyframeStep`, binding/journal ÚNICO por (animation, property) compartilhado com o END writer (`ensureFrozenEntryBinding`/`createFrozenEntryBinding`). Reader transacional + pre-flight r82 por índice.
- **Controller** (`useNativeMotionController.js`): `changeStepValue`.
- **UI** (`NativeMotionEditor.jsx`): diamantes por entrada na TimelinePanel (terminal escondido por `isEnd`, alocação GLOBAL de slots pra offsets duplicados), edição de valor pelo label; `NativeMotionTimelineDock.jsx` plumbing.
- **Witness real** `_probe-phase2-witness.mjs` (29 checks no GSAP 3.15 real).

## 2. O método (mesmo do caminho-seguro): veto adversarial nas duas direções

**46 rodadas do Sol** (Codex, `--mode prose`, effort max/high), cada achado verificado por probe/RED antes de aceitar. Placar: **36 bloqueadores corrigidos + 5 refutados com evidência (r18, r36, r41, r42 + r12 adjudicado)**. Minhas duas refutações que CAÍRAM (r12→r13, r16→r17) — o Sol produziu a sequência, RED confirmou, corrigi. Veto vale nas duas direções.

A invariante central que emergiu: **congelar TUDO que `invalidate()` relê; mutação latente da página estala o binding, edição própria do bridge refresca (padrão captura-antes/refresca-depois)**. Rodadas por camada dessa invariante:
- Núcleo (r4–r24): endereçamento, pré-simulação de unidade nos restores STEP e END, identity `child.vars===entry`, `allEntries` INTEGRAL, gate no 1º toque de cada índice, token de exposição.
- Token/serialização (r25–r30, r43–r45): shape EXATO (hash forjável → serialização literal), profunda descriptor-based parametrizada (entry-root vs nested), backedge por LOCALIZAÇÃO, arrays por length+descriptor, encoding INJETIVO, encoder **realm-safe** (`gsapEncNode`, sem `JSON.stringify` — honrava `toJSON` envenenado).
- Funções (r27–r29, r37): serializa por source + identidade `===` na exposição/binding + session-bound + identidade de sessão dobrada no token.
- startAt (r31–r35): estado no token/binding/gate, START(y) não envenena binding de x, não-serializável tranca.
- Colateral (r38–r42): `gsapVarsCollateralState` (ease + canais top-level), `retarget.final` no ciclo, `gsapEntryOtherFieldsShape` (campos irmãos dentro das entries).

Detalhe de cada rodada: nas mensagens de commit `git log 3732a2f0..6870f314` (uma linha `Sol rNN` por commit).

## 3. RESIDUAL ACEITO — r46 (decisão do Adilson: parar; adjudicada com advise do Sol)

**Owner:** Adilson (decisão de arquitetura de produto). **Revisão:** disparada por gatilho (§ abaixo), não por calendário.

**Sol r46 (não implementado):** os serializers/gates de segurança usam métodos de `Array.prototype` (`.map/.some/.filter/.sort/.every/.push`) e intrinsics (`Object.getOwnPropertyDescriptor`, `for-in`) do realm da página. Um site clonado **adversarial** poderia envenenar cirurgicamente `Array.prototype.map` (detectando o callback por `Function.prototype.toString`) pra colapsar dois shapes distintos e furar o gate por token → **undo mis-journalado**.

**Consequência (corrigida pelo advise do Sol — NÃO chamar de "cosmético"):** é **integridade do undo**, não estético. Um "desfazer" que não restaura exato pode **corromper trabalho salvo** e gerar custo de suporte. Continua **não sendo breach** (sem exfiltração, escalação ou execução além do que a página já podia) — mas a régua é perda-de-trabalho, não vaidade.

**Por que deferir a obra grande (SES/realm confiável), confirmado pelo Sol:**
- Construir realm blindado product-wide agora "porque um dia será necessário" **amplia superfície e risco de regressão hoje**, e pode nunca ser necessário no modelo de ameaça real (designer inspecionando sites; sem segredo do usuário no realm; sem clone compartilhado entre usuários).
- O bridge carrega **DEPOIS** do conteúdo clonado → capturar intrinsics no load do bridge é tarde. Defesa robusta exige captura **antes** do conteúdo rodar (ver spike abaixo) OU rodar os gates fora do realm da página (Worker/isolated world) — infraestrutura deliberada.

**Correção de escopo (advise do Sol — meu "fix só na fase-2 = falsa segurança" estava forte demais):** fechar só os serializers da fase-2 NÃO fecha a classe product-wide, MAS como **defesa em profundidade** tem valor real (elimina o bypass conhecido + protege contra quebra ACIDENTAL — um polyfill mal-comportado do próprio site, não só malícia). Escopo limitado ≠ valor zero. Só é "falsa segurança" se for **vendido como** fechamento da classe.

**Caminho BARATO a avaliar PRIMEIRO (antes do SES), se um gatilho acender:** um **bootstrap mínimo em `document_start`** — a extensão captura os intrinsics usados pelos serializers/gates (`Array.prototype.*`, `Object.getOwnPropertyDescriptor/getPrototypeOf`, `Reflect.ownKeys`) **ANTES** dos scripts do conteúdo clonado rodarem, e os serializers passam a usar essas referências capturadas. **Pré-condição (provar antes de implementar):** que a arquitetura garante a extensão rodando ANTES do conteúdo (checar a ordem de carregamento do native bundle/iframe). Se NÃO houver garantia de ordem, **não fazer remendo tardio** (falso conforto) — aí sim é decisão arquitetural (SES/Worker). Um teste adversarial de ordem-de-carregamento é parte do spike.

**Gatilhos que MUDAM a conta (vigiar — se qualquer um acender, reabrir a decisão):**
1. Segredos do usuário no mesmo realm do conteúdo clonado (chaves/API/pagamento/tokens).
2. Clones **compartilhados/publicados/exportados** entre usuários (multi-tenant — autor malicioso ataca quem VÊ o clone) — inclui persistir/reabrir clones.
3. Importação de **URLs arbitrárias não confiáveis**.
4. O bridge ganhar **RPC privilegiado, filesystem, rede ou credenciais**.
5. **Mutações automáticas em lote** (aí um undo corrompido escala o dano).
6. Evidência de monkeypatch real no campo (mesmo não malicioso — quebra acidental).
7. Uncraft **prometer undo exato** como garantia de produto (aumenta o impacto de perda de trabalho).

## 4. Como retomar (mecânica)

```bash
cd ~/Desktop/IA/Uncraft && git checkout codex/live-animated-clone-editing
cd packages/web-shell
npx vitest run lib/motion-editor/runtime-bridge-source.test.js   # 267 testes do bridge
node _probe-phase2-witness.mjs                                   # 29 checks — GSAP real
node _probe-entryedit-witness.mjs                                # 114 (caminho-seguro)
node _probe-furo2-witness.mjs                                    # 37
```
- Witnesses rodam de DENTRO de `packages/web-shell` (fixture GSAP em `~/Desktop/IA/Unspirit-Clone-1to1/site`).
- Sol: `~/.claude/bin/codex-adversary.sh --mode prose --timeout 1400` com **bundle enxuto** (só o diff da última rodada + histórico compacto de 1 linha — o diff cumulativo de 1405 linhas estourou o contexto do Codex na r41, morreu sem veredito).
- Modelo de coordenação: **Sol dirige a frente; Claude executa/revisa (lead) + faz o [SALVAR]**.

## 5. PRÓXIMOS PASSOS (ordem acordada com o Adilson — começar por 0)

### 0. Checagem `document_start` (PRIMEIRO — ~1h, decide o seguro barato da r46) — NÃO é a obra
**Objetivo:** descobrir se a extensão consegue rodar código **ANTES** do conteúdo clonado carregar no iframe/native bundle. Isso decide se o hardening BOUNDED barato da r46 (defesa em profundidade — §3) é sequer possível, ou se a r46 fica 100% deferida pra decisão arquitetural.
- **Onde olhar:** ordem de injeção/carregamento do native bundle e do bridge (`runtime-bridge-source.js` é injetado via `getRuntimeBridgeSource()` — ver quem chama e QUANDO relativo ao conteúdo clonado; `manifest.json` `run_at`/content scripts da extensão; como o iframe do runtime é populado).
- **Resultado A (roda antes):** existe janela pra capturar intrinsics prístinos (`Array.prototype.map/some/filter/sort/every/push`, `Object.getOwnPropertyDescriptor/getPrototypeOf`, `Reflect.ownKeys`) num bootstrap mínimo → hardening bounded vale a pena (barato, fecha o bypass conhecido + quebra acidental de site real). Escrever probe adversarial de ordem-de-carregamento antes de implementar.
- **Resultado B (não há garantia de ordem):** remendo tardio = falso conforto → **não implementar**; r46 fica deferida pros gatilhos do §3 (decisão arquitetural SES/Worker).
- **Custo confirmado:** ZERO impacto no tempo de clone (a serialização da fase-2 roda só no editor ao editar animação; o bootstrap é captura de ~6 referências uma vez no load). Medido/raciocinado nesta sessão.

### 1. Furo #4 — multi-target / split-text ownership (item de trabalho REAL principal)
Do audit de ownership (item 168 do CLAUDE.md). **Estado atual:** o canal step (e o retarget) TRANCA multi-target com `reason: 'multi-target'` — `vars.startAt` é UM objeto compartilhado, um edit offset-0 achata os starts distintos por-target e um rollback de valor único não restaura (`[10,20]→[10,10]`, probe `_probe-r19.mjs`). O furo #4 é a **solução de ownership real por-target**: destravar edição independente de cada target de um tween multi-target / split-text.
- **Coordenar com a Task 12 do gate** (`/canvas`): fixture do chooser = **Entrance+Hover** (item 168; x+x e CSS drift+pulse são ambiguidade falsa — o chooser real é 2 motions distintos no mesmo canal).
- **Infra reusável:** a malha per-track do furo #2 + o journal/binding da fase-2 (per-(animation,property)); o furo #4 estende pra per-(animation,property,**target**). O detach de target já existe (`detachElementFromSharedTween` — stagger chains); ver se o caminho é "detach + edit independente" ou "ownership per-target no binding".
- **Método:** igual às frentes anteriores — probe no GSAP real ANTES de assumir semântica de write per-target, TDD estrito (RED observado), bundle enxuto pro Sol a cada rodada, witness real, até MERGE OK.

### 2. Fila da Task 16 (gate persistido `/canvas`)
Tasks 12–20 (Task 14 = seam de fault em código de PROD, server-only fail-closed). Env Neon isolado `ep-orange-frost-acaedcil` — **NUNCA produção**. Plano `docs/superpowers/plans/2026-07-28-task16-persisted-e2e-gate-implementation.md` + lições das Tasks 10/11 no CLAUDE.md.

### r46 realm-hardening (deferido — só reabre por gatilho)
Ver §3. Não é próximo passo; é decisão arquitetural disparada pelos 7 gatilhos. A checagem (0) só decide se há um seguro barato intermediário — não é começar a obra.

## 6. Lições operacionais desta frente (valem pras próximas)

1. **Bundle enxuto quando o diff cresce** — diff só da última rodada + histórico 1-linha; o cumulativo (~1405 linhas) matou o Codex sem veredito na r41. Sempre conferir que o processo TERMINOU (output não-vazio) antes de ler o veredito.
2. **Witness real freia o próprio fix** — rodar os 3 witnesses a CADA green, não só no fim.
3. **RED pelo motivo certo** — várias vezes um teste passou/falhou por um caminho diferente do pretendido (r36 getter nunca invocado; r40 cross precisava re-inspeção; r43 test passava pelo hazard scan). Confirmar o mecanismo, não só o resultado.
4. **Refutar com evidência é tratar o achado** — 5 refutações verificadas por teste (o cenário já era fail-closed a montante). Aplicar a guarda defensiva prescrita mesmo quando refutando (hardening estrito).
5. **Serialização de segurança é traiçoeira** — for..in omite length/holes/não-enumeráveis de arrays; `join` não é injetivo; `JSON.stringify` honra `toJSON` do realm. Encoder length-prefixed próprio (`gsapEncNode`) é o piso; realm-safe total precisa de intrinsics prístinos (r46).

## 7. Referências

- Handoff anterior (caminho-seguro fechado): `docs/superpowers/handoffs/2026-07-31-safe-path-closed-next-phase2-timeline-handoff.md`
- Memória: `[[checkpoint_2026-08-01_phase2-timeline]]`
- Commits: `git log 3732a2f0..6870f314` (47 commits: 5 feature + 42 rodadas Sol)
