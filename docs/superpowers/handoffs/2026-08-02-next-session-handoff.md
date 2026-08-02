# Handoff — próxima sessão (escrito em 2026-08-02)

> **Porta de entrada.** Estado, o que fazer e como retomar. O registro detalhado de evidência está em
> `2026-08-01-quirks-fix-shipped-furo4-design-probes-handoff.md` (§ citadas abaixo) e o do spike em
> `2026-08-01-r46-document-start-spike-finding.md`. **Não duplico aqui** — quando precisar do detalhe,
> ler a § citada, nunca adivinhar.

## Estado

- Branch `codex/live-animated-clone-editing` · HEAD **`52ae17c6`** · suíte **1536/1536** (10 skip).
- **Produção inalterada desde `ed0809a3`.** Dos 5 commits da sessão, só esse tocou código; os outros
  quatro são documentação. `git diff ed0809a3 HEAD -- packages/` é vazio.
- Witnesses do bridge verdes: fase-2, caminho-seguro, furo #2.

**Shipado na sessão:** `ed0809a3` — o `injectRuntimeBridge` prependia o meta de CSP **antes do
doctype** quando o `<head>` tinha atributo ou não existia, jogando o clone em **quirks mode** (box
model errado). Âncora nova espelha o preâmbulo que o parser tolera. 10 casos em Chromium real contra a
implementação antiga, nenhum pior; MERGE OK do Sol na rodada 3.

**Fechado sem código:** o spike `document_start` da r46 (Resultado A com escopo estreitado; **r46
segue deferida**, nenhum gatilho aceso — pré-requisitos no finding §1).

**Deliberadamente NÃO fechado:** furo #4 (fork aberto) e o defeito de continuidade do `link.detach`
(tentativa revertida). Ambos com evidência preservada e probes prontos.

## Próximos passos

### 0. `detach` — exceção estreita ao gate (PRIMEIRO; pequeno, não trivial)

**Contexto:** destacar um alvo no meio da animação salta o elemento — o clone nasce lendo o valor já
renderizado e recebe `progress()` por cima. Rebobinar o compartilhado conserta o caso simples, mas o
perímetro de segurança me escapou 4 rodadas seguidas (detalhe e tabela de A/B em §3.3d–e do handoff
anterior). A produção está no estado shipado.

**A causa do último no-op está isolada:** naquele controle positivo `vars.ease` era função e a regra
"controle funcional → recusa" o derrubou; `inner` era `false`.

⚠️ **O que NÃO fazer:** remover a regra funcional inteira. Medido: callbacks (`onUpdate`…) são
controles funcionais e **não** criam timeline interna, então `!inner` é cego pra eles. A guarda
estrutural **não serve como gate único** e segue **candidata, não validada**.

**Fazer:** avaliar uma exceção **estreita**, começando por `ease` e só depois considerando callbacks —
**demonstrada, não deduzida**. Pista a favor: o rewind usa `progress(_, true)`, que suprime eventos.
Pista contra: o isolamento pós-`kill` já é frágil (o alvo continua em `targets()` e os callbacks do
tween original seguem ativos sobre o elemento "isolado" — defeito próprio, pré-existente).

**Witness antes do código**, com:
- ⭐ **controle POSITIVO** — tween puro destacável, nos 3 estados de parada. Sem ele um gate que vira
  no-op passa a matriz negativa inteira, que foi exatamente o que me aconteceu;
- ⭐ **stagger** — o consumidor shipado que motivou o `detach`;
- negativos: `from`/`runBackwards`, `runBackwards` dentro de `keyframes`, `clearProps`, duração/delay
  funcionais, **callbacks top-level**, **ease custom/stateful**, `easeReverse`/`yoyoEase` (relato do
  auditor, **não reproduzido localmente**), timeline-pai, reverse, reprodução ativa;
- **alvos próprios por caso** — alvos compartilhados contaminaram uma medição minha.

**Regra de parada acordada:** mais uma regressão CONFIRMADA em comportamento shipado → reverter e
deixar documentado, em vez de emendar uma quinta vez.

**Por que primeiro:** a guarda estrutural é candidata a mecanismo do furo #4, então o aprendizado vale
duas vezes.

### 1. Furo #4 — fechar evidência antes de arquitetura

Multi-target / split-text ownership. **Fork aberto, três opções vivas, nenhuma validada** (§3.3c).
A decisão final é de **produto**: vale a identidade registrada — que mexe na política auditada do canal
keyframe — para ter edição per-target sem detach, ou aceitamos a semântica de detach?

Pré-requisitos:
1. 🟡 **SplitText real** — separar (a) resize com `autoSplit:true`+`onSplit`, (b) re-split manual com
   texto PRESERVADO, (c) troca semântica de texto. Medir chars/words/lines em cada.
2. 🟡 **Proveniência/token** — falta o probe do writer proposto: escalar → função com identidade
   própria → invalidate → reinspeção → segundo edit → undo exato, incluindo a página tentando
   **forjar** a função.
3. ⬜ **Caminho de escrita real** — provar pela via do bridge (guardas, transação, journal), não
   editando `vars` direto.
4. ⬜ **Validar o `detach`** como mecanismo — depende do passo 0.

Coordenar com a **Task 12 do gate** (`/canvas`): fixture do chooser = **Entrance+Hover** (item 168).

### 2. Residual do `</body>` no injetor (independente, bounded)

`injectRuntimeBridge` posiciona o script do bridge por `/<\/body>/i`. Classe mais ampla que
comentário: um `<script>const x = "</body>";</script>` derruba a injeção **dentro** do script do site,
e documentos com `<frameset>` não têm `</body>`. Pede política própria de posicionamento — a lógica de
preâmbulo do fix de quirks não resolve este caso.

### Fila depois

**Task 16 / gate persistido `/canvas`** — Tasks 12–20 (Task 14 = seam de fault em código de PROD,
server-only fail-closed). Env Neon isolado `ep-orange-frost-acaedcil` — **NUNCA produção**. Plano
`docs/superpowers/plans/2026-07-28-task16-persisted-e2e-gate-implementation.md`.

**r46** — deferida, dono Adilson, 7 gatilhos (handoff de 2026-08-01 §3). Reabre por gatilho, não por
calendário.

## Como retomar

```bash
cd ~/Desktop/IA/Uncraft && git checkout codex/live-animated-clone-editing
cd packages/web-shell
npx vitest run                        # 1536
node _probe-detach-real-path.mjs      # witness do detach (RED hoje: 3 falhas, esperado)
node _probe-phase2-witness.mjs        # fase-2          — esperado "TUDO VERDE"
node _probe-entryedit-witness.mjs     # caminho-seguro  — esperado "TUDO VERDE"
node _probe-furo2-witness.mjs         # furo #2         — esperado "TUDO VERDE"
```

- Os quatro comandos acima foram executados ao escrever este handoff: suíte 1536, os três witnesses
  em "TUDO VERDE", e o do detach com 3 FAIL (o defeito documentado no passo 0).
- Witnesses rodam de DENTRO de `packages/web-shell` (fixture GSAP em `~/Desktop/IA/Unspirit-Clone-1to1/site`).
- Probes `_probe-*.mjs` são **untracked por convenção**; os desta sessão estão listados no cabeçalho do
  handoff de 2026-08-01.
- Sol: `~/.claude/bin/codex-adversary.sh --mode prose --effort max --timeout 1400` com **bundle
  enxuto** (diff da rodada + histórico de 1 linha). Sempre conferir que o processo TERMINOU antes de
  ler o veredito.
- Modelo de coordenação: **Sol dirige a frente; Claude executa/revisa (lead) + faz o [SALVAR]**.

## Lições de método desta sessão (as que mais custaram)

1. ⭐ **Ao medir se X destrói Y, provar primeiro que Y ESTAVA VIVO.** Declarei um "hazard de
   parent-invalidate" como eixo de desenho de uma frente inteira medindo um edit que nunca fora
   aplicado. O re-probe válido **não reproduziu** o hazard nos casos testados (invalidate cru,
   `invalidatePreservingStart`, pai parado no meio) — o que derruba a evidência, não prova
   inexistência.
2. ⭐ **Matriz de verificação precisa de CONTROLE POSITIVO.** Um gate que virou no-op passou em todos
   os casos negativos e parecia seguro.
3. **Todo probe precisa de controle de sensibilidade.** O de charset deu "sem risco" porque era
   insensível; o comparativo com o injetor antigo media um stub meu quebrado.
4. **Alvos próprios por caso de A/B** — alvos compartilhados entre blocos me fizeram ler "sem
   regressão" de resultado sujo, e isso escondeu uma regressão real por duas rodadas.
5. **Fixture à mão não prova propriedade estrutural** — spans que escrevi "provaram" contiguidade que
   era da minha marcação, não do SplitText.
6. **GSAP: validar edit de `vars` renderizando a partir do início** (tween já instanciado) — senão não
   há re-init e o edit parece não pegar.
7. **`cwd` de comando composto persiste e morde** — aconteceu duas vezes: um `cd` anterior fez o path
   do `git stash push` não casar, e o `pop` seguinte aplicou um stash ANTIGO de outra branch (com
   conflitos); depois o mesmo fez um bloco Python morrer sem aplicar uma correção. Usar **caminho
   absoluto** em script, e para A/B de código **copiar o arquivo** (`git show HEAD:<path> > <path>`)
   em vez de stash.
8. **Absoluto exige varredura sem filtro de extensão** — `git grep -- '*.js' '*.jsx'` escondeu um
   caller `.mjs` e virou a afirmação falsa "só existem dois callers".

> **Padrão a vigiar:** várias conclusões minhas caíram nesta sessão, sempre pelo mesmo mecanismo —
> tirar a conclusão geral cedo demais a partir de um caso que confirma a hipótese. As lições 1–5 são
> anticorpos diretos disso. Quando um probe confirmar sua hipótese, esse é o momento de maior risco.
