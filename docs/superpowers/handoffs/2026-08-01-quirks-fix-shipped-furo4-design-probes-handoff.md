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

### 3.3b Pré-requisito 1 CUMPRIDO — SplitText REAL (`_probe-furo4-splittext-real.mjs`)

Rodado com o `SplitText.min.js` do fixture (GSAP 3.15 Club). O que o fixture à mão escondia:

| | resultado |
|---|---|
| chars produzidos | `DIV` **sem classe e sem id** — só `aria-hidden` e `style` |
| contiguidade por linha | **confirmada** (o fixture à mão acertou por acaso) |
| re-split substitui elementos? | **SIM — 0 de 25** dos antigos permanecem no documento |
| tween construído antes do re-split | **ÓRFÃO** — os 25 alvos ficam fora do DOM |
| `revert()` | devolve o DOM original byte a byte |

**Constraint real, já corrigido pela auditoria do Sol:** não há identidade de **referência DOM** — a
referência não sobrevive a um `split()`. Mas duas conclusões que eu tirei daí estavam
**sobre-declaradas**:

- ❌ *"um resize com `type:"lines"` refaz tudo"* — **falso**. `autoSplit` é `false` por padrão e a
  reconstrução da animação exige `onSplit`. O fixture real cria SplitText **sem nenhum dos dois**
  (`index.html:630, 657, 1308`). Reflow muda o agrupamento de **linhas**, não a sequência nem a
  contagem de caracteres de um texto inalterado.
- ❌ *"não há identidade estável"* — forte demais. Não há identidade de referência DOM, mas um
  **endereço lógico** `(heading, charIndex)` é estável enquanto o texto não muda.

O único re-split do fixture real é **manual e depois de trocar o texto** (`index.html:1650`:
`heading.innerHTML = "Now you can see the results."`). Nesse caso, fazer um journal per-char
sobreviver seria **errado** — aplicaria edits de caractere à frase errada. Portanto o "pré-requisito"
que eu havia derivado (journal sobreviver à substituição do tween) **não está demonstrado como
requisito**, e no único caso real observado seria um anti-requisito.

### 3.3c Pré-requisito 2 CUMPRIDO — a conversão escalar→função SE AUTO-TRANCA (`_probe-furo4-provenance.mjs`)

Medido pelo bridge REAL, lendo a `keyframeEditReason` que a inspeção publica:

| tween | reason |
|---|---|
| multi-target, escalar | `multi-target` (a tranca que queremos remover) |
| multi-target, **função por alvo** | **`keyframes`** — o hazard de função dinâmica dispara |
| single-target, escalar | *(destravado)* |
| single-target, **função** | **`keyframes`** — a função sozinha já tranca, mesmo com 1 alvo |

**O que isso prova, com precisão (delimitado pela auditoria do Sol):** o **classificador ATUAL** manda
qualquer função top-level pro hazard do canal keyframe (`runtime-bridge-source.js:2118`), antes mesmo
da tranca `multi-target`. O contraste single-target escalar × função isola a variável — não há
explicação alternativa material.

**O que isso NÃO prova:** que uma função **criada e registrada pelo bridge** tenha que permanecer
indistinguível. O probe nunca converte o mesmo tween de escalar pra função, nem exercita writer,
binding, token, journal, rollback ou reinspeção pós-write. Existe uma **terceira alternativa ainda não
refutada** (apontada pelo Sol): identidade guardada num `WeakSet`/binding com o escalar original
journalado — o que manteria funções **autorais** bloqueadas sem reabrir a política inteira.

**Opções pro caso multi-target simples** (um tween assim não tem filhos pra editar — não há timeline
interna, é um tween com N alvos e `_ptLookup`):

- **(a)** conversão pra função com identidade registrada → não refutada; precisa do probe do writer;
- **(b)** **detach** do alvo pra um tween próprio → **hipótese NÃO validada** (ver §3.3d);
- **(c)** outra coisa ainda não mapeada.

O fork **não está decidido** e nenhuma das opções está pronta pra virar arquitetura.

### 3.3d ⚠️ O `detach` existente NÃO preserva o estado (defeito latente no código shipado)

Eu havia elevado o detach a "candidato forte". O Sol derrubou, e o probe
(`_probe-furo4-detach-continuity.mjs`) confirma — a réplica da sequência do bridge
(`runtime-bridge-source.js:4799-4820`) num tween `x:0→100`:

| estado do tween | antes do detach | logo após | trajetória do clone |
|---|---|---|---|
| parado em 0 | 0 | 0 | `0→100` ✅ |
| parado em 0.5 | 75 | **93,75** — salto visível | `75→100` ❌ |
| parado em 1 | 100 | 100 | `100→100` (clone morto) ❌ |
| rodando | — | — | clone nasce **`paused:true`** |

A causa: o clone é criado a partir do valor **já renderizado** no DOM (from implícito) e depois recebe
`progress(parked)` — então o ponto de partida vira o valor corrente e o progresso é aplicado **de
novo** sobre ele. (Com o ease padrão `power1.out`, 0.5 renderiza 75, não 50 — por isso o salto é
maior que a aritmética linear sugeriria.)

⚠️ **Isso não é só um problema do furo #4:** esse é o caminho de `link.detach` **já shipado**, usado
hoje pra desacorrentar stagger.

### 3.3e Tentativa de consertar o `detach` — ABANDONADA após 4 rodadas (produção intocada)

Tentei consertar e **revertí**. A produção está byte-idêntica ao shipado; o defeito segue lá,
documentado aqui. Vale ler antes de tentar de novo.

**A ideia** era rebobinar o tween compartilhado pra `progress 0`, deixar o clone gravar o início
verdadeiro, e devolver os dois. Funciona pro caso simples (witness verde nos 3 estados de parada).
**O problema é o perímetro de segurança**: rebobinar só é válido se re-renderizar o compartilhado for
uma re-interpolação PURA, e eu errei esse perímetro quatro vezes seguidas.

Cada rodada de auditoria produziu regressão em comportamento shipado. As quatro primeiras linhas
foram **confirmadas por A/B local** (arquivo shipado × meu fix, com alvos isolados); a última é relato
do auditor que eu não reproduzi:

| forma | shipado | com o fix | rodada |
|---|---|---|---|
| `gsap.from` parado em .5 | 25→43,75; clone 100→25 | 25→**100**; clone **morto** | 1 |
| `runBackwards` dentro de entrada de `keyframes` | 50→75; clone 100→50 | 50→**100**; clone **morto** | 2 |
| `clearProps:'all'` | estilo posterior do irmão sobrevive | estilo do irmão **apagado** | 2 |
| `duration: i => i+1` | [100,50]; clone 100→100 | [**50**,50]; clone 0→100 | 3 |
| `easeReverse`/`yoyoEase` | irmão em 62,5 | irmão movido pra 75 | 3 — ⚠️ **relato do auditor, NÃO reproduzido localmente** |

Trocar a blacklist por um "predicado positivo" **não resolveu** — a versão positiva ainda deixava
passar `duration` funcional (tratava a chave como controle benigno sem olhar o valor) e ainda
divergia do `gsapPluginOwnedVar` em chaves herdadas.

Na combinação final do predicado (guarda estrutural + checagem de valor + consulta direta ao registro
de plugins), o **controle positivo também foi recusado** — o tween simples deixou de ser corrigido, ou
seja, o gate virou no-op. ⚠️ **Não isolei a causa.** O trace mostra `tween.timeline` FALSO num tween
puro, então a guarda estrutural sozinha não explica a recusa; havia outra condição na mesma leva
(candidata mais provável: a troca de `gsapPluginOwnedVar` por consulta direta ao registro). Portanto
**a abordagem estrutural NÃO foi refutada** — ficou por avaliar. Isolar isso é o caminho barato que
sobra, e não muda a decisão de parar a frente agora.

**O que sobrou de valor, e é real:**

1. ⭐ **Candidato estrutural observado:** `tween.timeline` (com `getChildren`) mediu **falso** num
   tween puro e **verdadeiro** em stagger, `duration` funcional e `delay` funcional. Quatro formas
   não provam que seja "a assinatura" da classe inteira — trate como **candidato promissor a
   discriminador**, não como fronteira de segurança estabelecida. Ainda assim é o ponto de partida
   mais promissor pra uma tentativa futura, porque endereça uma CLASSE em vez de nomes.
2. **A causa raiz está entendida:** uma tween grava os valores de início no PRIMEIRO RENDER, não na
   criação; o clone nasce lendo o DOM já renderizado e recebe `progress()` por cima.
3. **Os probes ficam** (`_probe-detach-real-path.mjs` como witness assertivo,
   `_probe-detach-blockers*.mjs`, `_probe-funcdur-isolated.mjs`) com A/B pronto.

**Por que parei:** o valor é um papercut (detach no meio da animação salta), e cada tentativa
introduziu quebra em comportamento shipado e auditado. Continuar era trocar um defeito conhecido e
contido por defeitos novos e desconhecidos. **Se for retomado, começar pela guarda estrutural, não
por lista de nomes** — e tratar como frente própria, com witness cobrindo desde o início:

- ⭐ **controle POSITIVO** — tween puro destacável, nos 3 estados de parada. Sem ele, um gate que vira
  no-op passa a matriz negativa inteira, que foi exatamente o que aconteceu comigo;
- ⭐ **stagger** — o consumidor shipado que motivou o `detach`; sem ele o witness não exercita o
  caminho real;
- `from`/`runBackwards`, `runBackwards` dentro de `keyframes`, `clearProps`, duração/delay funcionais,
  `easeReverse`/`yoyoEase`, timeline-pai, reverse e reprodução ativa;
- **cada caso com alvos próprios** — alvos compartilhados entre casos contaminam a medição.

> **Erro de método que me custou duas rodadas aqui:** medi o caso de `duration` funcional num probe
> onde blocos anteriores tinham criado e matado tweens **nos mesmos elementos**, e li "sem regressão"
> de um resultado contaminado. Isolado, a regressão aparece exatamente como o auditor descreveu.
> Cada caso de A/B precisa de alvos próprios.

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

Pré-requisitos de evidência:

1. 🟡 **PARCIAL — SplitText REAL** (§3.3b). Sabemos que `split()` substitui os elementos e órfã o
   tween, e que não há identidade de referência DOM. **Falta separar os três casos**: (a) resize real
   com `autoSplit:true` + `onSplit`; (b) re-split manual com o texto PRESERVADO; (c) substituição
   semântica do texto. Medir chars/words/lines em cada um. A política de endereçamento sai daí — e um
   endereço **lógico** `(heading, charIndex)` continua candidato, ao contrário do que escrevi antes.
2. 🟡 **PARCIAL — proveniência/token** (§3.3c). Temos o **baseline do classificador atual**: qualquer
   função top-level cai no hazard do canal keyframe. **Falta o probe do writer proposto**: escalar →
   função com identidade própria → invalidate → reinspeção → segundo edit → undo exato, incluindo
   tentativa da página de **trocar/forjar** a função. Só isso decide se a terceira alternativa
   (identidade em `WeakSet`/binding, escalar journalado) fecha sem reabrir a política.
3. ⬜ **PENDENTE — caminho de escrita real**: os probes editam `vars` direto; o bridge escreve por
   canais com guardas, transação e journal. Provar pela via real, não pela sintética.
4. ⬜ **PENDENTE — validar o `detach`** (§3.3d) em progresso 0/meio/1, reprodução ativa, reverse e
   timeline-pai, exigindo continuidade visual e trajetória equivalente. Hoje ele **não** preserva o
   estado; sem isso não é candidato.

> ❌ **Um "pré-requisito" que eu havia inventado e foi retirado:** "o journal precisa sobreviver à
> substituição do tween". Não está demonstrado como requisito — e no único caso real observado
> (re-split após troca de texto) sobreviver seria **errado**.

**A decisão de arquitetura ainda não está madura.** As três opções seguem vivas e nenhuma validada.
Quando amadurecer, a pergunta pro Adilson será de PRODUTO: **vale a identidade registrada (que mexe
na política do canal keyframe) para ter edição per-target sem detach, ou aceitamos a semântica de
detach — o alvo vira uma animação própria — depois de consertar a continuidade?**

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
