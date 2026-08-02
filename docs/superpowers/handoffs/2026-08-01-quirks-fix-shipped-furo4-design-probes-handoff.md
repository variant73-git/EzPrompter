# Handoff 2026-08-01 (sessão 2) — spike r46 fechado · quirks do gateway SHIPPED · furo #4 com desenho mapeado por probe

> **Para a próxima sessão.** Frente `live-animated-clone-editing`, branch `codex/live-animated-clone-editing`.
> HEAD ao escrever: `ed0809a3` · suíte **1536/1536** (10 skip).
> Probes desta sessão (untracked por convenção, em `packages/web-shell/`):
> `_probe-docstart-order.mjs`, `_probe-docstart-anchor-attack.mjs`, `_probe-docstart-stash-bypass.mjs`,
> `_probe-docstart-stash-call.mjs`, `_probe-docstart-sw.mjs`, `_probe-gateway-anchor-fix.mjs`,
> `_probe-gateway-charset.mjs`, `_probe-furo4-multitarget.mjs`, `_probe-furo4-splittext.mjs`,
> `_probe-furo4-stagger-children.mjs`, `_probe-furo4-stagger-why.mjs`.

## 1. Passo 0 do handoff anterior — CONCLUÍDO (spike `document_start`)

**Resultado A, com escopo estreitado.** Documento canônico com todas as correções e o placar da
auditoria: `docs/superpowers/handoffs/2026-08-01-r46-document-start-spike-finding.md`.

O essencial:
- A premissa do handoff anterior estava errada **a favor**: o bridge não vem de content script. O
  HTML do runtime é emitido inteiro pelo servidor (`injectRuntimeBridge`, 2 rotas HTTP shipadas) e o
  iframe carrega por `src` com sandbox sem `allow-same-origin`. Não há corrida — nós escrevemos o
  documento byte a byte.
- A janela existe, mas **as duas âncoras óbvias caem**: após `<head>` (morre com decoy
  `<!-- <head> -->` — a injeção vai comentada e nunca roda) e âncora no doctype por regex (morre com
  `<!-->`, comentário abreviado que o parser fecha e o regex não — captura veneno parecendo prístino).
  A forma que sobrevive é **posição 0**, sem heurística: ordem segura 15/15 por construção.
- **A r46 CONTINUA DEFERIDA.** O spike só barateou e mapeou a receita; não acendeu gatilho. E a
  auditoria **aumentou** o custo real: o bootstrap é barato, mas cada ponto de consumo precisa de
  **wrapper uncurried** (`Object.freeze` é raso — `stash.map.call(...)` cai em 3/3 ataques,
  `Function.prototype.call.bind(map)` resiste 3/3), o que muda a FORMA de invocação, não só a
  referência.
  > **Sobre o tamanho da migração:** uma versão anterior citava "31 pontos / 206 no bridge" como se
  > fosse inventário. **Não é** — vieram de `grep -c` de uma lista PARCIAL de padrões, contando
  > LINHAS, e omitem categorias como `Object.keys`, `Array.from`, `.forEach`, `.includes`, `.slice`,
  > que exigem remédios diferentes de `call.bind`. Tratar como **piso provisório**, nunca como
  > denominador. Um inventário semântico de verdade é tarefa da obra, se ela for autorizada.
  > E a migração parcial **não fecha a classe** — mas tem valor real de defesa em profundidade
  > (fecha o bypass conhecido, protege contra polyfill acidental do site), como o item 171 e o finding
  > canônico já registravam. Dizer "não vale nada" contradizia os dois.
- Pré-requisitos se a obra for autorizada: normalizar o entrypoint pra `text/html` UTF-8; **verificar
  de verdade** o vetor de service worker (o probe desta sessão mede registro de dentro do iframe, não
  interceptação por SW pré-registrado — claim rebaixado a "não demonstrado"); e tornar a injeção do
  bootstrap **idempotente** — `removePriorInjection` limpa `data-uncraft-runtime-(bridge|config)` mas
  NÃO limparia um `data-uncraft-runtime-intrinsics`, então bootstraps acumulariam em re-injeção.

## 2. Quirks mode do gateway — SHIPPED (`ed0809a3`)

Achado **colateral** do spike, não da r46. `injectRuntimeBridge` só reconhecia `<head>` literal;
quando o regex não casava (`<head lang="en">`, documento sem head) o fallback prependia o meta de CSP
**antes do doctype** → doctype ignorado → **quirks mode** → box model diferente do original. Valia nas
duas rotas. Medido: `CSS1Compat → BackCompat`.

A âncora nova espelha os tokens que o modo "initial" do parser tolera sem sair do standards mode: BOM,
whitespace HTML (conjunto fechado `[\t\n\f\r ]` — `\s` do JS casa U+00A0 e julgava o preâmbulo
errado), comentários (incl. abreviados `<!-->`/`<!--->` e fechamento `--!>`), bogus comments (prólogo
XML) e **referências de caractere que resolvem pra whitespace** (`&#10;`, `&#x0a;`, `&Tab;`,
`&NewLine;`; `;` opcional nas numéricas, como o tokenizer).

Verificado em Chromium real contra a implementação ANTIGA, 10 casos, **nenhum em que o novo seja
pior**: 4 saem de quirks pra standards, 2 recuperam a CSP do meta. O caso do nbsp revelou um ganho
não previsto — com nbsp antes do doctype o parser entra em body cedo e o antigo punha o meta no
`<body>`, onde **CSP por meta não é honrada**.

**3 rodadas do Sol, 2 bloqueadores dele corrigidos com RED observado** (prólogo XML; referência de
caractere), **MERGE OK na rodada 3**. Ele também adjudicou dois pontos abertos: `<!DOCTYPE html PUBLIC
"a>b">` termina no primeiro `>` mesmo dentro da string (o tokenizer emite com force-quirks), então o
`indexOf('>')` coincide; e o tratamento de referências de caractere está fiel.

**RESIDUAL aceito, escopo separado:** a injeção do bridge ainda usa `/<\/body>/i`. É classe **mais
ampla** que comentário — um `<script>const x = "</body>";</script>` faria a injeção cair dentro do
script do site, quebrando os dois, e documentos com `<frameset>` não têm `</body>`. Pede política
própria de posicionamento, não outro regex.

## 3. Furo #4 — OBSERVAÇÕES numa fixture simples (NENHUM código escrito, NADA decidido)

> ⚠️ **Leia esta ressalva antes da seção.** Uma versão anterior deste handoff dizia que o fork estava
> "decidido" e que o eixo do desenho era um hazard de parent-invalidate. **A auditoria do Sol derrubou
> isso**, e o re-probe confirmou que ele estava certo — ver §3.3. O que segue são observações numa
> fixture **feita à mão** (spans escritos por mim, não SplitText real), suficientes pra orientar a
> investigação e **insuficientes pra escolher arquitetura**.

O fork que o handoff anterior deixou aberto ("detach + edit independente" vs "ownership per-target no
binding") **continua aberto**. O que os probes mostraram é que existem dois caminhos de escrita com
semânticas diferentes, e que o principal risco que eu imaginei não se confirmou.

### 3.1 Tween multi-target SIMPLES (sem stagger)

Converter o escalar autoral numa **função por alvo** isola o edit e faz rollback exato:

| | valores |
|---|---|
| antes | `[100, 100, 100]` |
| editando só o alvo do meio | `[100, **500**, 100]` |
| rollback restaurando o escalar | `[100, 100, 100]` — exato |

`startAt` — a razão original da tranca (objeto compartilhado, `[10,20] → [10,10]`, probe `_probe-r19`)
— **também aceita função por alvo na criação**. Isso é promissor, mas não foi testado no fluxo de
edição real (substituir `startAt` num tween já instanciado).

### 3.2 Tween com STAGGER (split-text)

Distinção **temporal**, e ela importa: uma função por alvo na `vars` da fachada **é honrada na
criação** do tween (probe splittext Q1 — valores `[10,20,30,40,50,60]`). O que **não** funciona é
**substituir `vars.x` depois de instanciado**: os filhos não são reconstruídos (probe H5). Dizer que
"a fachada é inútil" seria falso sem essa qualificação.

A verdade por alvo, num tween já vivo, está nos **filhos internos**, cada um com `vars` PRÓPRIA (não
compartilhada com o pai nem entre irmãos — probe H1). Caminho que funciona: `child.vars[prop] = novo`
+ `child.invalidate()` + **renderizar a partir do início** → `[50, **400**, 50]`, isolado, com
`startTime` preservado.

> ⚠️ **Armadilha de método que me pegou duas vezes:** a rodada 3 concluiu "editar o filho não
> funciona" — era erro do probe: eu renderizava `progress(1)` sem voltar a 0, então não havia re-init.
> Ao validar um edit de `vars` num tween GSAP 3.15 já instanciado, renderizar a partir do início.

### 3.3 O hazard de parent-invalidate que eu inventei — REFUTADO

Uma versão anterior deste handoff afirmava que `invalidate()` no pai apagava os edits por-filho e
elegia isso como "o eixo do desenho". **O Sol pegou que nenhum probe demonstrava isso** e estava
certo: nas rodadas 3/4 o edit **nunca chegou a ser aplicado** (faltou `child.invalidate()` e/ou render
a partir do início), então o que observei foi um edit não-aplicado continuar não-aplicado.

Re-probe com o edit **comprovadamente aplicado** (`_probe-furo4-parent-invalidate.mjs`), partindo de
`[50,400,50]`:

| sequência | resultado |
|---|---|
| `parent.invalidate()` cru | `[50,400,50]` — **sobrevive** |
| `invalidatePreservingStart(parent)` — a sequência REAL do bridge | `[50,400,50]` — **sobrevive** |
| pai parado no meio (progress 0.5) | sobrevive, e o final também |
| `child.vars.x` após o invalidate do pai | segue `400`, sem divergir do renderizado |

**Conclusão: o hazard não existe** nessa fixture. Isso torna o furo #4 mais simples do que eu havia
documentado, não mais difícil — e apaga a suposta necessidade de replay de journal e de tocar todos os
writers. Nada disso deve ser levado adiante como premissa.

### 3.4 Endereçamento — parcialmente observado, NÃO resolvido

A função recebe `(índice, elemento, listaDeAlvos)`; cada filho de stagger expõe `targets()` com
exatamente 1 alvo. Isso **sugere** endereçar por elemento em vez de índice, o que seria estável contra
reordenação.

⚠️ **Ressalva importante:** a fixture usa spans que eu escrevi à mão, **não SplitText real**. A
"contiguidade" dos fragmentos de uma linha é consequência da minha marcação, e não prova nada sobre
estabilidade após split/re-split, nem sobre a substituição de elementos que o SplitText faz. Testar
com SplitText de verdade, incluindo re-split, é pré-requisito de qualquer decisão de endereçamento.

### 3.5 Onde está a tranca hoje

`lib/motion-editor/runtime-bridge-source.js:2133` — `targetCount > 1 ? 'multi-target'`, dentro do
cálculo de `keyframeEditReason`. `detachElementFromSharedTween` (linha ~4776) já existe pra stagger,
mas é honestamente irreversível pra tweens staggered (o próprio código diz "reload the page to
restore it") — por isso o caminho de ownership é preferível a detach.

## 4. RECOMENDAÇÃO para a próxima sessão

**Fechar a investigação antes de decidir arquitetura — e só então escrever o plano.** A sessão passada
mostrou que declarar "decidido" cedo demais custa caro: eu elegi um eixo de desenho que não existia.

Pré-requisitos de evidência, na ordem (nenhum deles está feito):

1. **SplitText REAL**, incluindo re-split e substituição de elementos — a fixture atual é feita à mão
   e não prova nada sobre endereçamento estável (§3.4).
2. **Proveniência congelada / token da fase-2**: converter escalar → função muda o *shape* de `vars`,
   e essa malha existe justamente pra detectar mudança de shape. Ela vai reclamar. Não é impeditivo —
   é provavelmente onde o trabalho está. **Medir antes de qualquer desenho.**
3. **Cobertura do caminho de escrita real**: os probes editam `vars` direto; o bridge escreve por
   canais com guardas, transação e journal. Provar o comportamento pela via real, não pela sintética.

Só com isso: (a) plano escrito com as duas semânticas de escrita e a decisão de se o **target** entra
na CHAVE do binding (hoje per-(animation, property)) ou vira dimensão do valor; (b) TDD por camada,
rodada do Sol a cada camada, witness real a cada green, até MERGE OK.

Coordenar com a **Task 12 do gate** (`/canvas`): fixture do chooser = **Entrance+Hover** (item 168 —
`x`+`x` e CSS drift+pulse são ambiguidade falsa; o chooser real são 2 motions distintos no mesmo canal).

## 5. Fila depois do furo #4

**Task 16 / gate persistido `/canvas`** — Tasks 12–20 (Task 14 = seam de fault em código de PROD,
server-only fail-closed). Env Neon isolado `ep-orange-frost-acaedcil` — **NUNCA produção**. Plano
`docs/superpowers/plans/2026-07-28-task16-persisted-e2e-gate-implementation.md`.

**r46** — deferida, dono Adilson, 7 gatilhos no handoff anterior §3. Reabre por gatilho, não por
calendário.

## 6. Lições de método desta sessão

1. **Atacar a própria proposta antes de recomendá-la.** Achei o furo da âncora no doctype (`<!-->`)
   sozinho, atacando o que eu ia recomendar. O Sol achou o furo do `Object.freeze` raso, que eu tinha
   medido na camada errada e declarado seguro. Nenhum dos dois modelos pegaria os dois.
2. **Todo probe precisa de CONTROLE de sensibilidade.** O probe de charset deu "sem risco" e o
   controle mostrou que ele era insensível (Chromium caía em windows-1252 e acertava por acaso). O
   comparativo com o injetor antigo deu "CSP não vale em nada" porque o MEU stub omitia
   `script-src 'unsafe-inline'` e bloqueava o próprio script de report. Um probe sem controle mede
   o próprio bug.
3. **Renderizar a partir do início ao validar edit de `vars` num tween GSAP 3.15 já instanciado**
   (§3.2) — senão não há re-init e o edit parece não pegar. Isso me fez concluir errado uma rodada
   inteira; e a versão seguinte do MESMO erro (medir o efeito de um invalidate sobre um edit que
   nunca foi aplicado) produziu um hazard inteiro que não existe (§3.3). **Ao medir se X destrói Y,
   confirmar que Y ESTAVA VIVO antes de X.**
4. **`\s` do JS ≠ whitespace do HTML.** `\s` casa U+00A0, que o parser trata como texto comum.
5. **Filtro de glob esconde caller.** Meu `git grep -- '*.js' '*.jsx'` não pegou um caller `.mjs`
   (`smoke-motion-controls.mjs:501`) e eu afirmei "só existem dois callers". Absolutos exigem varredura
   sem filtro de extensão.
