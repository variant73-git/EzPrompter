# @uncraft/design-eval

Detector das ordens de construção do Uncraft. Roda uma página gerada num Chromium real e
aponta **quais ordens do [house-style](../web-shell/lib/design/house-style.js) não foram
seguidas**.

Não dá nota. Não tem threshold, não tem peso. Os critérios são ordens objetivas do que
fazer e do que não fazer, então a única pergunta é "a ordem foi seguida?".

## Uso

```js
import { chromium } from 'playwright-core';
import { runDesignEval } from '@uncraft/design-eval';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const out = await runDesignEval(page, html, {
  palette: ['#c8ff3d', '#1a1a18'], // medida da fonte (opcional)
  italicCount: 0,                  // elementos em itálico NA FONTE
  monoInSource: false,
  explicitFonts: [],               // fontes que o usuário pediu explicitamente
});
```

### CSS externo? Não use `setContent`

`runDesignEval` usa `setContent`, que deixa o documento em `about:blank` — aí uma folha
servida por HTTP vira cross-origin, `cssRules` lança, e **todos** os checks de CSS voltam
`unjudged`. Se o seu sistema vive num `system.css` externo, navegue de verdade:

```js
await page.goto('http://localhost:4321/index.html');
const out = await runDesignEvalOnPage(page, ground, { source: readFileSync(arquivo, 'utf8') });
```

`source` é opcional e serve só para a integridade do artefato. Ele **não** é lido de
`page.content()` de propósito: aquilo devolve o DOM já serializado, depois de o parser ter
consertado o que o modelo truncou — perguntar à página destrói justamente a evidência. Sem
`source`, a integridade volta `unjudged`, nunca aprovada.

### ⚠️ `observeInPage` roda DENTRO da página

Chamar `observeInPage(page)` direto no Node falha com `document is not defined`, um erro que
não aponta para a causa. Use `page.evaluate(observeInPage)`, ou deixe que `observeHtml` e os
`run*` façam isso por você.

De fora do monorepo, sem instalar nada:

```js
import { runDesignEval } from '/caminho/Uncraft/packages/design-eval/src/index.js';
```

**O pacote não tem dependência de runtime.** O Playwright entra como o `page` que você
passa — quem controla o browser é você.

## O que volta

| Campo | Significa |
|---|---|
| `violations` | achou algo. Evidência forte, aja |
| `notDetected` | este leitor não achou nada. **Não é atestado de saúde** |
| `unjudged` | faltou insumo (sem chão de verdade, ou CSS que não deu para ler) |

Cada item de `results` traz `status: 'violation' | 'notDetected' | 'unjudged'`. **Não existe
booleano `pass`** — `pass: true` era lido como aprovação, e esta camada nunca aprova.
| `integrity` | só truncamento ESTRUTURAL (documento termina dentro de tag aberta) — nível de string, separado do gosto |
| `observations` | os fatos crus, se você quiser julgar por conta própria |

Cada resultado pode trazer `remedy`:

- `substitute` — tem conserto mecânico (Inter → qualquer grotesca helvetica-like)
- `forbidden` — regra absoluta, sem substituição (JetBrains)

Pedido explícito do usuário vence os dois: ordem sobrescrita nunca foi violação.

## Por que `notDetected` não é aprovação

Nenhum critério tem cobertura determinística completa — `COVERAGE` é todo `partial`, e cada
entrada declara o que ela **não** enxerga. Três critérios já foram marcados `full` e caíram
numa auditoria por não cobrirem todas as cláusulas do próprio texto. Uma camada sem
cobertura completa não pode publicar percentual sem contar silêncio como conformidade.

Todo critério continua indo ao juiz de visão. Isto aqui é o adiantamento barato e
determinístico, não um jeito de pular o juiz.

### O que a integridade NÃO detecta

Só existe um sinal: o documento termina dentro de uma tag aberta. Marcadores de texto
("... rest of the code", "[truncated]") foram **removidos** depois que três rodadas de
auditoria seguidas produziram documentos completos que eles acusavam — `<p>Screen readers
announce clipped labels as [truncated]` é copy legítima, e tags de fechamento opcionais
tornam aquilo um documento válido.

Custo assumido: um modelo que escreveu "... rest of the code" e fechou as tags não é mais
detectado. Como a camada só afirma `violation`, acusação errada em copy real custa mais que
marcador perdido.

O check de imagem placeholder saiu daqui e virou check do DOM — regex sobre markup cortava
`<img alt="2 > 1" src="/real.png">` ao meio.

## O que ele alcança, e o que não

Lê: `<style>`, `style=""`, folhas do documento, **folhas construídas** adotadas via
`adoptedStyleSheets`, e **shadow roots abertos** (elementos e folhas, até 6 níveis).

Não lê, e por isso vira `unjudged` em vez de aprovação silenciosa:

- folha externa que não pôde ser lida (cross-origin, ou ainda não carregada)
- **shadow root fechado** — inalcançável por construção, e este código não consegue nem
  detectar que existe. É a única cegueira que não sabe que é cega. Se o seu artefato usa
  shadow root fechado, o resultado não fala sobre o que está lá dentro.

## Regra de importação

**Importe só `src/index.js`.** Em 12/08 as tripas foram trocadas (um leitor de string virou
um observador in-browser) e um consumidor em outro projeto quebrou no meio da sessão com
`ERR_MODULE_NOT_FOUND` — nada no uso dele tinha mudado, ele só tinha alcançado além da
porta. `EVAL_API_VERSION` sobe quando a FORMA do retorno muda.

## Testes

Rodam junto com a suíte do web-shell (o `vitest.config.js` de lá inclui `../design-eval/src`):

```sh
cd ../web-shell && npx vitest run ../design-eval/src
```

Os testes de integração sobem um Chromium real. Cada caso ali é um achado de auditoria ou
um falso positivo relatado em campo — a rede de regressão da troca de arquitetura.
