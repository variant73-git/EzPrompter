# Fase 0 — Provas P1–P6 do override per-target (Opção A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar as 6 provas de evidência (P1–P6) do spec `docs/superpowers/specs/2026-08-05-chain-override-per-target-design.md` — o mapa "forma → degrau da escada" sai daqui, não de argumento. Zero arquitetura nova; o único código de produção tocado é o fix do P6 (template já auditado).

**Architecture:** Probes Playwright sobre GSAP 3.15 real (fixture farmminerals) + witnesses assertivos com baseline, seguindo o padrão consolidado de `_probe-detach-witness.mjs` e `_probe-inspect-witness.mjs`. Cada prova registra veredito + FORMA testada num finding doc. P6 tem witness RED (contrato do defeito) + fix de produção (rebobinador auditado reusado) + witness GREEN.

**Tech Stack:** Node ESM (`.mjs`), `playwright-core`/chromium, GSAP 3.15 + SplitText da fixture, vitest (só no P6-fix), Sol via `codex-adversary.sh`.

## Global Constraints

- Probes rodam de DENTRO de `packages/web-shell`; TODOS os caminhos absolutos (`cwd` herdado mordeu duas sessões).
- Fixture GSAP: `/Users/adilsonporto/Desktop/IA/Unspirit-Clone-1to1/site/assets/gsap/3.15.0/` (`gsap.min.js`, `SplitText.min.js`).
- A/B de código por `git show HEAD:<path> > <path>` — NUNCA stash.
- Método obrigatório em todo probe: (1) página nova por caso, alvos próprios; (2) verdade INDEPENDENTE do instrumento (referência nunca tocada); (3) controle de sensibilidade (o probe tem que detectar o positivo); (4) provar que Y estava VIVO antes de medir se X destrói Y; (5) validar edits renderizando A PARTIR DO INÍCIO; (6) dano temporal medido no TICK SEGUINTE.
- Registrar veredito SEMPRE junto com a FORMA testada ("não reproduzido" ≠ refutado).
- **Proibição (Sol):** nada aqui é a 7ª tentativa de provar detach universal. As provas validam o override e, separadamente, o candidato a transplante.
- Fix do P6 (único código de produção): Sol audit com MERGE OK ANTES do commit (standing rule). Probes/witness são artefatos de evidência: commit direto, auditoria consolidada na Task 8.
- Suíte de referência: 1536/1536 (10 skip). Witnesses verdes: inspeção, fase-2, caminho-seguro, furo #2. Detach: 11 RED (contrato, não mexer).
- Texto de produto user-facing em inglês; docs/probes em PT como o restante da frente.

## Finding doc (criado na Task 1, alimentado por todas)

`docs/superpowers/handoffs/2026-08-05-fase0-provas-finding.md` — uma seção por prova:
`## P<n> — <título>` com **Pergunta**, **Forma testada** (código/matriz do probe), **Resultado bruto**, **Veredito** (`provado` / `refutado` / `não estabelecido — <o que falta>`), **Consequência pro degrau da escada**. Termina com a tabela `forma → degrau` (entrada da Fase 1).

---

### Task 1: P1 — SplitText REAL com re-split

O probe já existe (`_probe-furo4-splittext-real.mjs`, untracked, resultado nunca registrado). Q1–Q5 no header do arquivo: DOM produzido, contiguidade em `targets()`, re-split substitui elementos?, identidade estável através do re-split, `revert()` restaura?

**Files:**
- Create: `docs/superpowers/handoffs/2026-08-05-fase0-provas-finding.md`
- Modify (se necessário): `packages/web-shell/_probe-furo4-splittext-real.mjs`

**Interfaces:**
- Produces: veredito P1 no finding doc — em particular a resposta de ENDEREÇAMENTO (elemento? índice? nenhum?) que P5 consome no caso SplitText.

- [ ] **Step 1: Criar o finding doc** com o esqueleto acima (6 seções vazias + tabela final vazia) e a referência ao spec.
- [ ] **Step 2: Ler o probe inteiro** e conferir contra o método obrigatório: tem controle de sensibilidade? A verdade é independente? Se faltar, adicionar — ex.: pro Q3 (tween sobre fragmentos antigos sobrevive ao re-split?), o controle é um caso onde o tween anima fragmentos AINDA vivos e o probe tem que reportar "vivo" (prova que sabe distinguir).
- [ ] **Step 3: Rodar** — `cd /Users/adilsonporto/Desktop/IA/Uncraft/packages/web-shell && node _probe-furo4-splittext-real.mjs`. Esperado: JSON com q1–q5.
- [ ] **Step 4: Cobrir o buraco conhecido do resize**: se o probe atual não força um re-split REAL (mudar width do container + `split.split()` ou o autoSplit do 3.15), adicionar esse caso — a pergunta decisiva é se referências capturadas ANTES apontam pra nós fora do documento DEPOIS.
- [ ] **Step 5: Registrar no finding doc**: forma testada (colar a matriz de casos), resultado bruto, veredito, consequência (qual identidade o degrau 1/3 pode usar pra endereçar um fragmento de SplitText).
- [ ] **Step 6: Commit** — `git add packages/web-shell/_probe-furo4-splittext-real.mjs docs/superpowers/handoffs/2026-08-05-fase0-provas-finding.md && git commit -m "probe(fase0): P1 SplitText real — veredito registrado"`.

### Task 2: P3 — Harness de escrita REAL do bridge

P3 do spec é transversal: toda prova de edição tem que passar pelo caminho de escrita real (patch → bridge), nunca `vars` direto. Deliverable: helper reutilizável + caso de validação que prova que o helper NÃO é um atalho.

**Files:**
- Create: `packages/web-shell/_probe-fase0-harness.mjs`

**Interfaces:**
- Produces: `openCase({ html, setup })` → `{ page, applyPatch(patch), tracksFor(elementId), close() }` onde `applyPatch` envia o patch pelo MESMO seam de mensagens que a UI usa (copiar a mecânica do helper `detach(el)` de `_probe-detach-witness.mjs`, que já dispara `link.detach` pelo caminho real) e retorna `{ ok, erro }`. Tasks 3–6 consomem.

- [ ] **Step 1: Extrair a mecânica** do `_probe-detach-witness.mjs` (injeção de `getRuntimeBridgeSource()`, criação de página por caso, o driver de patch real) pra um módulo compartilhado — sem mudar o witness existente (ele é baseline tracked; NÃO tocar).
- [ ] **Step 2: Caso de validação de sensibilidade**: um patch deliberadamente inválido (canal inexistente) tem que voltar `{ ok: false, erro }` VINDO do bridge (não do helper); e um patch válido de retarget simples tem que produzir mudança OBSERVÁVEL no DOM renderizando do início. Se o helper "aplicasse" direto em `vars`, o primeiro caso passaria silencioso — é isso que o teste pega.
- [ ] **Step 3: Rodar** `node _probe-fase0-harness.mjs` (self-test). Esperado: `HARNESS OK (2/2)`.
- [ ] **Step 4: Registrar P3 no finding doc** (forma: o self-test; veredito: caminho real estabelecido e sensível) e **commit**.

### Task 3: P4 — Função-por-alvo no fluxo de edição REAL (multi-target simples)

O probe de 172 (`_probe-furo4-multitarget.mjs`) provou função-por-alvo NA CRIAÇÃO, via `vars` direto. A prova que falta: a CONVERSÃO escalar→função num tween JÁ VIVO, pelo caminho real, com rollback exato.

**Files:**
- Create: `packages/web-shell/_probe-fase0-p4-multitarget.mjs` (usa o harness da Task 2)

**Interfaces:**
- Consumes: `openCase`/`applyPatch` da Task 2.
- Produces: veredito P4 — se a conversão limpa existe, ela é o mecanismo do degrau 3 pra multi-target plano.

- [ ] **Step 1: Escrever a matriz** (página nova por caso, referência nunca tocada em página separada):
  - `caso-basico`: `gsap.to([a,b], { x: 100, duration: 1 })` parado em 0.5 → retarget do X SÓ de `a` pra 160 via `applyPatch`. Asserções: (i) ANTES do patch, provar tween vivo (X de `a` mudou de 0 → controle de vida); (ii) render do início ao fim: `a` termina em 160, `b` termina em 100 byte-igual à referência; (iii) trajetória de `a` parte do MESMO início da referência (preserved start).
  - `caso-rollback`: mesmo setup, aplicar patch e desfazer via caminho real de undo do bridge. Asserção: `vars` e trajetória de `a` e `b` byte-iguais à referência (rollback exato — comparar shape de `vars` inclusive, não só pixels).
  - `caso-sensibilidade`: um "retarget" que deliberadamente escreve escalar em `vars.x` cru (sem função por alvo) tem que fazer `b` TAMBÉM mudar — prova que o probe detecta contaminação de irmão.
- [ ] **Step 2: Rodar.** Esperado declarado ANTES de rodar: básico e rollback passam OU falham com modo de falha específico (registrar qual).
- [ ] **Step 3: Registrar P4 no finding doc** (forma + resultado + veredito) e **commit**.

### Task 4: P2 — Conversão escalar→função vs malha de proveniência da fase-2

A malha da fase-2 congela shape+source+props de `vars` pra detectar mutação LATENTE da página; edição própria do bridge tem que capturar-antes/refrescar-depois. Converter escalar→função MUDA o shape — a prova: o caminho de escrita real refresca a proveniência ou o binding estala?

**Files:**
- Create: `packages/web-shell/_probe-fase0-p2-provenance.mjs` (usa o harness; `_probe-furo4-provenance.mjs` existente é leitura de referência, não base — ele media por `vars` direto)

**Interfaces:**
- Consumes: harness da Task 2; resultado de P4 (a conversão que funcionou).
- Produces: veredito P2 — a regra exata de proveniência que o degrau 3 precisa implementar na Fase 1 (refrescar após edição própria vs isenção pontual).

- [ ] **Step 1: Matriz:**
  - `caso-conversao-propria`: retarget per-target (a conversão de P4) via caminho real → em seguida, uma SEGUNDA edição no mesmo tween (retarget de end do canal keyframe ou X) via caminho real. Asserção: a segunda edição NÃO é bloqueada por hazard/proveniência (a malha reconheceu a conversão como edição própria).
  - `caso-pagina-adversarial`: depois da conversão própria, a PÁGINA muta `vars.x` (simulando o site). Asserção: a malha AINDA detecta a mutação latente (a conversão não cegou o detector — sensibilidade preservada nos dois lados).
  - `caso-controle`: sem conversão nenhuma, página muta `vars.x` → malha detecta (controle de que o detector estava vivo).
- [ ] **Step 2: Rodar; registrar P2 no finding doc** — se `caso-conversao-propria` falhar, o veredito NÃO é "impossível": é "a Fase 1 precisa de refresh explícito no writer da conversão", registrado como consequência. **Commit.**

### Task 5: P5 — Transplante da instância viva (o caminho novo do Sol)

A aposta: pra stagger, reparentear o FILHO interno vivo (PropTweens, plugin state, randoms resolvidos, tempo local intactos) pra uma timeline independente, em vez de reconstruir clone por medição (o que falhou 6×). Probe de GSAP puro (sem bridge — é mecânica do motor; a integração é Fase 1).

**Files:**
- Create: `packages/web-shell/_probe-fase0-p5-transplant.mjs`

**Interfaces:**
- Consumes: veredito P1 (endereçamento de fragmento SplitText).
- Produces: veredito P5 por LINHA da matriz — quais semânticas do pai o wrapper precisa projetar; decide o alcance do degrau 1.

- [ ] **Step 1: Mecânica base** (mesmo esqueleto de página dos outros probes): `gsap.to('.item', { x: 100, duration: 1, stagger: 0.2 })` com 3 alvos → localizar o filho vivo do alvo do meio (`tween.timeline` interna; discriminador já provado: `child.targets().length === 1 && child.targets()[0] === alvo`), `parent.remove(child)`, `novaTl = gsap.timeline({ paused: true }); novaTl.add(child, offsetPreservado)`, posicionar `novaTl.totalTime()` pra continuidade.
- [ ] **Step 2: Matriz — cada caso vs referência intocada em página própria, medindo no tick seguinte:**
  - `plain-midflight` (parado em 0.5): alvo transplantado continua a trajetória byte-igual à referência; irmãos byte-iguais; playhead do transplantado agora é independente (avançar SÓ a novaTl move só ele — a prova de INDEPENDÊNCIA, que o override não dá).
  - `pai-repeat-yoyo`: pai com `repeat: 2, yoyo: true` — o filho transplantado precisa herdar a semântica? Medir o que se perde e registrar (é o "o que o wrapper projeta").
  - `pai-timescale`: pai com `timeScale(2)` — idem.
  - `callbacks`: pai com `onComplete` — dispara 1×? 2×? 0×? (registro, sem juízo — a semântica de herança é decisão da Fase 1).
  - `repeatRefresh-child`: tween stagger com `repeat: 1, repeatRefresh: true` — o transplante preserva os valores JÁ resolvidos? (é a chance de promover formas adaptativas pro degrau 1).
  - `splittext-stagger`: alvos = `split.chars` de SplitText REAL (usar o endereçamento que P1 aprovou) — transplante + re-split depois: o que acontece?
  - `sensibilidade`: um transplante deliberadamente ERRADO (adicionar o filho com offset 0 em vez do preservado) tem que ser DETECTADO como salto pelo instrumento — prova que a régua funciona.
- [ ] **Step 3: Antes de cada medição de dano, asserção positiva de vida** (o edit/estado que será medido existia e movia — lição ⭐ do 172).
- [ ] **Step 4: Rodar; registrar P5 no finding doc** linha a linha (não um veredito só). **Commit.**

### Task 6: P6a — Witness do caminho de escrita (RED = contrato do defeito)

O residual documentado: `sampleGsapValue` (linha ~3497) e `invalidatePreservingStart` (~3482) salvam/restauram por `progress` — mesma classe do defeito da inspeção já consertado (`1ada4a7b`), agora no caminho de EDIÇÃO. Template: `_probe-inspect-witness.mjs` (estrutura inteira: referência intocada, tick seguinte, controle positivo, `--record`).

**Files:**
- Create: `packages/web-shell/_probe-editwrite-witness.mjs`
- Create (baseline no repo, como o do detach): `packages/web-shell/_probe-editwrite-witness.baseline.json` — conferir como o witness do detach guarda o dele e seguir o mesmo formato.

**Interfaces:**
- Produces: contrato RED que a Task 7 vira GREEN; casos exatos que o vitest da Task 7 espelha.

- [ ] **Step 1: Casos** (edição via caminho REAL — retarget de end-value pelo harness):
  - `controle-simples`: tween plain sem repeat — edição já deve ser inócua ao estado temporal (controle positivo: se isso falhar, o instrumento está torto, não o código).
  - `repeat-loop`: `repeat: -1` parado mid-2ª-iteração → editar end de X → tick seguinte vs referência: iteração/fase idênticas? (esperado hoje: RED — volta de batida).
  - `yoyo-vaivem`: `repeat: 3, yoyo: true` parado na volta → editar → tick seguinte: direção preservada? (esperado hoje: RED — inverte).
  - `pos-edicao-funciona`: a edição em si tem que TER acontecido (end novo vale renderizando do início) — o witness não pode passar por edição-que-não-aplicou.
- [ ] **Step 2: Rodar com `--record`**, congelar baseline com os RED esperados documentados caso a caso no header do arquivo.
- [ ] **Step 3: Registrar P6 (parte witness) no finding doc; commit** (witness + baseline TRACKED, como o do detach).

### Task 7: P6b — Fix: restauração temporal por `totalTime` no caminho de escrita

Único código de produção da Fase 0. Reusar o rebobinador auditado da inspeção (o vai-e-vem em coordenada TOTAL, `runtime-bridge-source.js:2110-2140`: `totalTime(0, true)` → restaura `totalTime` capturado, guarda pra doubles, restore dentro de `finally`) nos DOIS pontos que hoje salvam/restauram por `progress`.

**Files:**
- Modify: `packages/web-shell/lib/motion-editor/runtime-bridge-source.js` (funções `invalidatePreservingStart` ~3482 e `sampleGsapValue` ~3497 — trocar captura/restauração de `progress` por `totalTime` com o MESMO padrão de guarda do rebobinador; NÃO duplicar o rebobinador: extrair/reusar o helper existente se já for função nomeada, senão fatorar o padrão num helper único usado pelos dois seams + inspeção)
- Test: `packages/web-shell/lib/motion-editor/__tests__/` (seguir onde vivem os testes atuais do bridge — 267 testes existem; adicionar no arquivo que já cobre sampling/invalidate)

**Interfaces:**
- Consumes: casos RED da Task 6.
- Produces: witness GREEN; formas `repeat`/`yoyo` seguras pro degrau 3.

- [ ] **Step 1: Escrever os testes vitest** espelhando `repeat-loop` e `yoyo-vaivem` da Task 6 (RED observado — rodar e ver falhar ANTES do fix; se não falhar, o teste está torto: parar e consertar o teste).
- [ ] **Step 2: Implementar** a troca `progress`→`totalTime` nos dois seams com o padrão do rebobinador (captura antes, `finally` restaura, guarda `typeof animation.totalTime === 'function'` com fallback `progress` pra doubles).
- [ ] **Step 3: Rodar os testes novos** (esperado: PASS) e a suíte inteira — `npx vitest run` de dentro de `packages/web-shell`. Esperado: 1536+novos, 0 fail.
- [ ] **Step 4: Witness da Task 6 vira GREEN**: rodar `node _probe-editwrite-witness.mjs` — os casos RED agora passam; re-record baseline com header atualizado (defeito consertado, contrato agora é verde). Rodar TAMBÉM os witnesses vizinhos (inspeção, fase-2, entry-edit, furo2) — esperado: todos como antes; detach segue 11 RED.
- [ ] **Step 5: Sol audit ANTES do commit** (standing rule; bundle: diff + witness + finding doc §P6): `~/.claude/bin/codex-adversary.sh --mode prose --effort max --timeout 1400`, em background. Achado dele → reproduzir rodando antes de aceitar (veto assimétrico). Iterar até MERGE OK.
- [ ] **Step 6: Commit** fix + testes + baseline re-gravado, mensagem citando o residual do handoff e o MERGE OK.

### Task 8: Auditoria consolidada da Fase 0 + fechamento

**Files:**
- Modify: `docs/superpowers/handoffs/2026-08-05-fase0-provas-finding.md` (tabela final `forma → degrau`)
- Modify: `docs/superpowers/handoffs/2026-08-03-next-session-handoff.md` OU novo handoff de entrada (o que estiver mais enxuto — substituindo, como a linhagem faz)

**Interfaces:**
- Produces: a entrada da Fase 1 — tabela `forma → degrau` com um veredito provado por linha.

- [ ] **Step 1: Preencher a tabela final** do finding doc: linhas = formas autorais (single-owner, multi-target plano, stagger, stagger+SplitText, repeat/yoyo, adaptativas, plugin desconhecido) × colunas = degrau atribuído (1–4) + prova que sustenta (P#/caso) + o que fica pra Fase 1.
- [ ] **Step 2: Sol audit da Fase 0 inteira** (bundle: finding doc completo + lista de probes; mode prose, effort max, background). Cada achado: reproduzir rodando; refutação só com probe. Registrar dissensos com crédito.
- [ ] **Step 3: Ajustes que a auditoria exigir** (probes re-rodados, vereditos re-escritos) — cada um commitado.
- [ ] **Step 4: Handoff de entrada da próxima sessão** atualizado (estado, o que a Fase 1 recebe, fila) + **commit final**.
- [ ] **Step 5: [SALVAR]** — checkpoint de memória, CLAUDE.md item novo, Findings harvest, commit do vault Brain.

---

## Self-review (feito na escrita)

- **Cobertura do spec §3:** P1→Task 1, P2→Task 4, P3→Task 2, P4→Task 3, P5→Task 5, P6→Tasks 6+7; "formas adaptativas confirmadas/promovidas" → caso `repeatRefresh-child` da Task 5 + tabela da Task 8. Proibição da 7ª tentativa → Global Constraints.
- **Ordem de dependência:** P1 antes de P5 (endereçamento SplitText); harness (P3) antes de P4/P2/P6; P4 antes de P2 (a conversão provada é o insumo).
- **Placeholders:** nenhum "TBD"; onde o resultado é desconhecido por natureza (probe!), o passo declara o esperado ANTES de rodar e o que registrar em cada desfecho.
- **Consistência de nomes:** `openCase`/`applyPatch` definidos na Task 2 e consumidos em 3/4/6; `_probe-editwrite-witness.mjs` consistente entre 6 e 7.
