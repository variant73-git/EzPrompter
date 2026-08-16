# Spike r46 — checagem `document_start` · RESULTADO A (com ressalva)

> Passo 0 do handoff `2026-08-01-phase2-timeline-shipped-r46-residual-handoff.md` §5.
> Objetivo: descobrir se existe janela pra capturar intrinsics prístinos ANTES do
> conteúdo clonado rodar — o que decide se o seguro barato da r46 é possível.
> **Não é a obra.** Zero linha de código de produção alterada.
>
> Probes: `packages/web-shell/_probe-docstart-order.mjs` (9 cenários × 2 estratégias,
> com baseline) e `_probe-docstart-sw.mjs` (vetor service worker, com controle).

## 1. Correção de premissa: não existe corrida a ganhar

O handoff formulou a pergunta como "a extensão consegue rodar antes do conteúdo?".
Olhando o código, **a pergunta não se aplica** ao caminho do motion editor:

- O bridge NÃO vem de content script da extensão. O HTML inteiro do runtime é
  produzido **server-side** por `injectRuntimeBridge`
  ([native-clone-gateway.js:35](packages/web-shell/lib/motion-editor/native-clone-gateway.js#L35)).
- São **duas rotas HTTP shipadas**: `/api/native-clone/[...path]` (lab local) e
  `/api/runtime/[token]/[...path]` (persistido). Todo HTML servido por elas passa
  por lá — nessas rotas não há `srcdoc` nem injeção pós-load.
  > **Correção (achado #5 do Sol, confirmado).** Eu escrevi "só existem dois
  > callers" e "não há caminho de srcdoc" — os dois absolutos estavam errados.
  > Há um terceiro caller direto em
  > [smoke-motion-controls.mjs:501](packages/web-shell/scripts/smoke-motion-controls.mjs#L501)
  > (meu `git grep` filtrou `*.js`/`*.jsx` e não pegou `.mjs` — falha de método,
  > não do código). E o produto usa `srcDoc` em
  > [CanvasNode.jsx:1550](packages/web-shell/components/CanvasNode.jsx#L1550) —
  > outro subsistema, mas a frase absoluta não se sustentava. O escopo correto é
  > **o caminho HTTP nativo shipado**, não "o produto".
- O iframe carrega por `src`, com `sandbox="allow-scripts allow-pointer-lock"`
  (sem `allow-same-origin`) — [NativeEditViewport.jsx:164](packages/web-shell/components/motion-editor/NativeEditViewport.jsx#L164).

Ou seja: **nós emitimos o documento byte a byte.** A ordem não é uma corrida
com timing incerto — é ordem de parse, determinística e garantida pelo parser.
Isso é uma posição *melhor* que um `run_at: document_start` de extensão.

O que o handoff descreveu corretamente é o **sintoma**: o bridge é injetado
antes de `</body>`, portanto depois de todo script do conteúdo. Confirmado nos
9 cenários: na posição do bridge, `Array.prototype.map` **já estava envenenado**.
A janela de vulnerabilidade da r46 é real e reproduzível, não teórica.

## 2. Resultado: A — existe janela. Mas o ponto óbvio de injeção é uma armadilha.

Testei duas estratégias de posicionamento do bootstrap contra 9 cenários
adversariais de ordem, num Chromium real com a CSP real de produção:

| Estratégia | Onde | Cenários 100% limpos |
|---|---|---|
| **HEAD** — o ponto que o injetor usa hoje (após o 1º `<head>`) | junto do meta de CSP | **4/9** |
| **DOCTYPE** — após o doctype líder (pulando BOM/espaços/comentários), senão posição 0 | topo absoluto | **7/9** |

**Onde o ponto atual (HEAD) é derrotado:**

- **B — script do site ANTES do `<head>` na fonte.** Ordem observada
  `site;boot;bridge` → o bootstrap captura o `map` **já envenenado**. Pior que
  não ter: entrega intrinsics contaminados com cara de prístinos.
- **C — decoy `<!-- <head> -->` antes do head real.** O `indexOf('<head>')` casa
  **dentro do comentário** → o bootstrap é injetado comentado e **nunca roda**.
  Falha silenciosa: nenhum erro, stash ausente.
- **G — sem doctype, script no início.** Mesma inversão de ordem do B.

A âncora no doctype resolve os três. As 2 falhas restantes da DOCTYPE (cenários
D e E) **não são causadas pelo bootstrap** — são o bug de produção da §4, e
aparecem idênticas nas duas estratégias.

**Conclusão operacional:** o seguro barato é possível, mas **só com a âncora
certa**. Implementar no ponto óbvio produziria exatamente o "falso conforto" que
o handoff mandou evitar — e sem probe adversarial ninguém notaria, porque no
fixture do Farm Minerals (cenário A, `<head>` limpo) as duas estratégias passam.

### 2b. A âncora no doctype TAMBÉM cai — e a auto-auditoria derrubou a própria proposta

Antes de recomendar a âncora no doctype, ataquei ela
(`_probe-docstart-anchor-attack.mjs`, cenários J–O). **Dois ataques a derrotam:**

- **J — `<!-->`** e **K — `<!--->`** (comentário abreviado). O parser HTML5
  **fecha** o comentário aí; o regex `<!--[\s\S]*?-->` não reconhece a forma
  abreviada e segue lazy até o próximo `-->`, **atravessando por cima de um
  `<script>` real**. Ordem observada `site;boot;bridge`, stash `["POISONED"]`.

É a falha perigosa: o bootstrap roda, o stash existe, tudo parece certo — e os
intrinsics já estão contaminados. É a **mesma lição dos itens 163/164**: regex
não reimplementa o tokenizer HTML. Só que aqui não dá pra "rodar no DOM" como no
pin de CSS, porque estamos emitindo bytes antes de existir DOM.

### 2c. Estratégia que não depende de parsing nenhum — `ZERO`

`<!DOCTYPE html>` nosso + bootstrap + fonte **verbatim**, tudo na **posição 0**.
A ordem passa a ser garantida **por construção** (nada pode preceder o byte 0),
sem interpretar uma vírgula do HTML do site. O doctype do site, se houver, vira
token duplicado que o parser ignora.

| Estratégia | Ordem segura (segurança) | compatMode preservado (fidelidade) |
|---|---|---|
| DOCTYPE (regex) | 13/15 — **derrotada em J e K** | 15/15 |
| **ZERO (posição 0)** | **15/15** | 9/15 |

As 6 divergências de compatMode do ZERO são **todas** em fontes cujo baseline já
era `BackCompat` (sem doctype, bogus comment, doctype não fechado) — o nosso
doctype as promove a standards. Em bundle capturado de verdade isso não ocorre:
a captura da extensão emite `'<!DOCTYPE html>\n'` fixo
([capture.js:208](packages/extension-shell/handoff/capture.js#L208)) e
`page.content()` serializa o doctype do documento.

**Separação que fecha a questão:** ordem é **segurança** → posição 0, sem
heurística. compatMode é **fidelidade** → aí um regex é aceitável, porque errar
custa layout, nunca a garantia de ordem. Nunca usar a mesma heurística pras duas.

## 3. O stash resiste a ataque direto

Com `Object.defineProperty(window, …, {value: Object.freeze(…), writable:false, configurable:false})`,
o script hostil do site tentou e falhou em todos os cenários bem-posicionados:

- atribuição direta → silenciosamente ignorada (não-strict)
- `delete` → retorna `false`
- `Object.defineProperty` por cima → **TypeError**
- mutar a propriedade do objeto congelado → sem efeito

Consumidor na posição do bridge lê `[2,4]` pelo stash enquanto o realm devolve
`["POISONED"]`. Confirma que o padrão captura-cedo/usa-depois fecha o bypass
conhecido da r46 **e** protege contra quebra acidental (polyfill mal-comportado
do próprio site) — o valor de defesa em profundidade que o Sol apontou.

> ⛔ **CORREÇÃO (achado #3 do Sol, confirmado por probe).** A tabela abaixo mede
> ataques ao **contêiner** do stash e está correta *nesse escopo* — mas a
> conclusão que eu tirei dela ("o stash resiste a ataque direto") estava
> **ERRADA**, porque o caminho de CONSUMO que demonstrei (`stash.map.call(...)`)
> é atacável. `Object.freeze` é **raso**: congela o contêiner, não as funções
> guardadas. O site pode redefinir `.call` na própria função guardada, ou
> envenenar `Function.prototype.call`/`apply`. Medido em
> `_probe-docstart-stash-call.mjs`:
>
> | Consumo | Comprometido |
> |---|---|
> | `stash.map.call(arr, cb)` — o que eu demonstrei | **3/3 ataques** → `["HIJACK"]` |
> | wrapper **uncurried** capturado no bootstrap (`Function.prototype.call.bind(map)`) | **0/3** → `[2,4]` |
>
> Ou seja: o padrão só fecha se o bootstrap capturar **wrappers uncurried** e o
> consumidor invocá-los direto, sem nenhum lookup posterior de `.call`/`.apply`.
> Isso **encarece a migração**: não basta trocar a referência em cada call site,
> a forma de invocação muda. Meu probe original atacou a camada errada.

Bateria dedicada de bypass (`_probe-docstart-stash-bypass.mjs`) — ataques ao
**contêiner**, todos sem efeito sobre ele:

| Ataque | Resultado |
|---|---|
| atribuição direta | silenciosamente ignorada |
| `delete` | retorna `false` |
| `defineProperty` por cima (valor) | **TypeError** |
| `defineProperty` por cima (getter) | **TypeError** |
| mutar o objeto congelado | sem efeito |
| getter em `Window.prototype` | é definido, mas a própria propriedade em `window` faz shadow |
| `document.open()` + `document.write()` | global sobrevive, stash intacto |
| `document.write()` sem `open()` | stash intacto |

Ressalva de escopo: isso protege as **referências dos intrinsics**. Não substitui
as guardas descriptor-based já existentes contra objetos hostis passados como
argumento (r43–r45) — são camadas distintas.

## 4. ⚠️ Achado independente (fora da r46): o gateway joga clones em QUIRKS MODE

Não era o objetivo do spike; apareceu na baseline.

`injectRuntimeBridge` só reconhece `<head>` **literal** (`/<head>/i`). Quando não
casa — `<head lang="en">`, `<head>` com atributo/quebra de linha, ou documento
sem head — cai no fallback `${securityMeta}${config}${cleaned}`, que **prepende
o `<meta>` de CSP ANTES do `<!DOCTYPE html>`**. Doctype que não é a primeira
coisa do documento é ignorado → o navegador entra em **quirks mode**.

Medido, comparando com a fonte crua servida sem injeção nenhuma:

| Cenário | Fonte crua | Servido pelo gateway hoje |
|---|---|---|
| D · `<head lang="en">` | `CSS1Compat` | **`BackCompat`** |
| E · sem `<head>` | `CSS1Compat` | **`BackCompat`** |

Quirks mode muda o **box model** — o clone renderiza diferente do original. É a
classe de bug que o projeto trata como regressão, não limitação (lição do hero
pixelado, item 163). Vale nas duas rotas do gateway. **Não corrigi** — está fora
do escopo acordado; fica como recomendação.

Detalhe adjacente pra quem for implementar o bootstrap: `removePriorInjection`
limpa `data-uncraft-runtime-(bridge|config)` mas não limparia um
`data-uncraft-runtime-intrinsics` — acumularia em re-injeção.

## 5. Vetor service worker — NÃO demonstrado (probe mede a coisa errada)

> ⛔ **CORREÇÃO (achado #4 do Sol, aceito).** O que segue abaixo mede se o
> conteúdo **dentro** do iframe sandboxado consegue REGISTRAR um service worker.
> O vetor declarado é outro: um SW **registrado antes**, por outro contexto da
> mesma origem, **interceptando a navegação** do iframe. São ameaças diferentes,
> e o probe não testa a segunda. Pior: o controle sem sandbox deu `TypeError`
> (interceptação do Playwright não serve SW de verdade), então **não existe
> controle positivo** — não provei nem que o registro funcionaria sem sandbox.
>
> O `SecurityError` isola apenas o **acesso à API** na origem opaca. A hipótese
> de que clientes de origem opaca não são controlados por SW é plausível e tem
> base em spec, mas **não é resultado deste spike**. Fica como **pré-requisito a
> verificar** se a obra da r46 for autorizada: servidor real, registrar e esperar
> `activated` FORA do iframe, depois navegar as versões sandboxada e não
> sandboxada sob o scope, com o SW devolvendo HTML marcado.

### 5b. O que o probe realmente mediu (registro de dentro do iframe)

Único caminho sério pro conteúdo rodar antes de nós sem depender de ordem de
parse: um SW registrado por um clone anterior na mesma origem, interceptando o
fetch do HTML.

Primeira rodada do probe deu falso "fechado" pelo motivo errado — a origem era
`http://`, que não é secure context, então a API sumiria de qualquer jeito.
Refeito em `http://localhost` (secure context) e com controle sem sandbox:

- **com sandbox** (como o `NativeEditViewport` monta): acessar
  `navigator.serviceWorker` lança **`SecurityError`** — origem opaca.
- **sem sandbox** (controle): não lança.

O sandbox sem `allow-same-origin` fecha o vetor. A diferença isola a causa.

## 5c. Pré-requisito de encoding (achado #2 do Sol, confirmado)

Tudo que este spike provou vale para **`text/html` em UTF-8**. O probe fixa
`charset=utf-8`; a rota persistida não garante isso:

- `route.js:215` decodifica **sempre** com `new TextDecoder()` — UTF-8 — mas
  `headers.set('Content-Type', asset.contentType)` (linha 205) **preserva o
  charset declarado** pelo bundle.
- `bundle-contract.js:88` aceita **qualquer** content type não-vazio.

Logo um asset declarado `text/html; charset=utf-16le` é decodificado errado,
re-serializado em UTF-8 pela `Response`, e entregue com header UTF-16 — o
navegador não vê os caracteres sobre os quais qualquer injeção nossa operou.
E `application/xhtml+xml` **nunca entra** em `injectRuntimeBridge` (o gate é
`/^text\/html/`), logo nem bridge nem bootstrap existiriam ali.

Isso é bug pré-existente do gateway, independente da r46 — mas vira
**pré-condição** se a obra for autorizada: restringir o entrypoint a
`text/html` UTF-8 (normalizando bytes e resposta) antes de confiar em qualquer
garantia de ordem.

## 6. O que isso decide — e o que NÃO decide

**Decide:** o seguro barato da r46 é **tecnicamente possível e bounded** —
um `<script>` de ~10 linhas no topo do documento, custo desprezível no tempo de
clone (≈9 leituras de propriedade, uma vez, no load; a serialização da fase-2 só
roda no editor ao editar animação, não na captura). E decide a **forma**:
**posição 0 (`ZERO`), sem heurística de parsing** — nem `<head>`, nem âncora de
doctype por regex, porque ambas são derrotáveis por HTML hostil.

**Corrigido após a auditoria do Sol — o "bounded" é MAIOR do que eu escrevi.**
O bootstrap continua barato, mas o que o cerca não é:
1. cada ponto de consumo tem que usar **wrapper uncurried** (§3) — muda a forma
   de invocação, não só a referência; são **31 pontos** só no bloco de
   serialização/token do bridge (206 no bridge inteiro);
2. o entrypoint precisa ser normalizado pra `text/html` UTF-8 (§5c);
3. o vetor de service worker precisa ser **verificado de verdade** (§5).

**NÃO decide:** se vale fazer. Isso continua sendo decisão do Adilson pelos 7
gatilhos do handoff §3, e a r46 segue deferida. Escopo limitado ≠ fechamento da
classe: fecha o bypass conhecido, não substitui realm confiável (SES/Worker).
Só vira "falsa segurança" se for **vendido** como fechamento da classe.

**Recomendação separada:** o bug de quirks mode da §4 é pequeno, real e não tem
nada a ver com a r46 — vale corrigir por conta própria.

## 7. Auditoria adversarial (Claude lead × Sol) — placar

Sol (`gpt-5.6-sol`, `--mode prose --effort max`) auditou o snapshot do doc de
14:00. Veredito dele: *"rejeitar o RESULTADO A"*. **Adjudicação (Claude tem
lead): Resultado A SOBREVIVE, com escopo estreitado e três correções aceitas.**

| # | Achado do Sol | Veredito | Como foi verificado |
|---|---|---|---|
| 1 | Âncora no doctype é derrotada por `<!-->` | **Convergente** — eu já tinha achado e substituído por `ZERO` antes do veredito chegar (o bundle era snapshot). Não é informação nova, mas é confirmação independente. | `_probe-docstart-anchor-attack.mjs` J/K |
| 2 | Spike só prova UTF-8 `text/html`; charset/XHTML escapam | **Aceito** — vira pré-condição §5c | leitura de `route.js:205,215` + `bundle-contract.js:88` |
| 3 | `Object.freeze` é raso; `stash.map.call` é atacável | **Aceito — derruba afirmação minha** | `_probe-docstart-stash-call.mjs`: 3/3 comprometidos; uncurried 0/3 |
| 4 | Probe de SW mede registro, não interceptação; sem controle positivo | **Aceito** — claim rebaixado a "não demonstrado" (§5) | releitura do desenho do probe |
| 5 | Absolutos errados ("dois callers", "sem srcdoc", "custo ZERO") | **Aceito** | `smoke-motion-controls.mjs:501`, `CanvasNode.jsx:1550` |

**Por que o Resultado A sobrevive apesar do veredito.** Os dois "críticos" do Sol
atacam (1) a âncora que já foi abandonada e (2) o escopo de encoding. Nenhum dos
dois refuta a **existência** da janela: a estratégia `ZERO` é 15/15 em ordem por
construção, sem interpretar HTML. O que caiu foram as **afirmações de segurança
ao redor** — e essas caíram de verdade, por probe. Resultado A ≠ "está seguro":
é "a janela existe, e agora sabemos o preço real de usá-la".

**Método que funcionou:** achei o furo #1 sozinho atacando a minha própria
proposta antes de recomendá-la; o Sol achou o #3, que eu tinha medido na camada
errada e declarado seguro. Nenhum dos dois modelos pegaria os dois.
