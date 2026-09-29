/**
 * REMENDO DE `fetch`/XHR DENTRO DO CLONE — 2026-09-29.
 *
 * O problema, medido no gsap.com (2ª cobaia): `js/header.js` chama `fetch` com uma
 * URL **construída em código**. A reescrita de referências troca apenas URL que
 * aparece como TEXTO e que casa exatamente com uma resposta capturada, então uma URL
 * montada em runtime é inalcançável por construção — é resíduo declarado no cabeçalho
 * de `rewrite-references.js`. Offline essa chamada morre (`TypeError: Failed to
 * fetch`), e o efeito visível foi **3 imagens ausentes**: elas não estão no HTML, são
 * injetadas por JS com os dados que o `fetch` traria. O sintoma era "faltam imagens";
 * a causa era uma chamada de rede morta.
 *
 * A captura JÁ guarda as respostas de fetch/XHR (o pacote do gsap.com contém
 * `community/index.93580e97.php`). O que faltava era o clone REDIRECIONAR a chamada
 * para o pacote. É isso que este remendo faz, e ele vive DENTRO do pacote — não no
 * gateway — para valer também offline e sob o portão.
 *
 * ⚠️ ESCOPO CONTIDO A **GET/HEAD SEM CORPO** (Astra, 2026-09-29).
 * A primeira versão afirmava, no próprio comentário, que "Request com corpo passa
 * intacto" — e era FALSO: a guarda existia só no ramo do objeto `Request`, enquanto a
 * forma comum `fetch(url, { method: 'POST', body })` passa a URL como STRING e era
 * traduzida. Consequências reais: método e corpo colapsavam num arquivo estático; e
 * converter uma URL de outra origem em mesma origem REMOVE a fronteira CORS, podendo
 * enviar cookies do gateway e fazer um POST atingir rota real (confused deputy).
 * Agora o método é lido do `init` E do `Request`, e qualquer coisa que não seja
 * GET/HEAD sem corpo passa intacta.
 *
 * LIMITES DECLARADOS (não são bugs escondidos):
 *  • Só traduz URL que está no mapa, e só GET/HEAD sem corpo.
 *  • Não preserva o ENVELOPE da resposta: status, cabeçalhos, `Response.url`,
 *    `redirected` e `responseURL` passam a ser os do arquivo local. Um site que leia
 *    esses campos vê outra coisa. Replay fiel exige interceptar na camada de rede do
 *    player, com o manifesto indexado por identidade de requisição (método + URL +
 *    hash do corpo + ocorrência) — re-arquitetura, não remendo.
 *  • Duas respostas diferentes para a MESMA URL não são representáveis.
 *  • Não alcança `img.src`, CSS, worker, iframe, `sendBeacon`, `EventSource`,
 *    WebSocket, nem uma substituição de `fetch` posterior à nossa.
 *  • Se o site guardar uma referência a `fetch` ANTES deste script, o remendo não o
 *    alcança. Por isso a injeção é logo após o doctype, antes de qualquer marcação
 *    do site.
 */

/** Escapa para caber dentro de `<script>` sem fechar a tag. */
function jsonParaScript(valor) {
  return JSON.stringify(valor)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    // ⚠️ Os separadores de linha U+2028/U+2029 são escapados por CÓDIGO, não por
    // literal de regex: escrever o caractere cru dentro de `/.../` é erro de sintaxe.
    .replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028')
    .replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029');
}

/**
 * Mapa das respostas que só são pedidas em tempo de execução.
 * @param {Map<string, {tipo?: string}>} congelados respostas capturadas
 * @param {Map<string, string>} caminhos URL original -> caminho no pacote
 * @returns {Record<string,string>} URL absoluta original -> caminho local
 */
export function runtimeFetchMap(congelados, caminhos) {
  const mapa = {};
  for (const [url, valor] of congelados) {
    const tipo = valor && valor.tipo;
    if (tipo !== 'fetch' && tipo !== 'xhr') continue;
    const local = caminhos.get(url);
    if (!local) continue;
    mapa[url] = `./${local}`.replace(/^\.\/\.\//, './');
  }
  return mapa;
}

/**
 * Script do remendo. Devolve string vazia quando não há nada a traduzir — um clone
 * sem chamada de runtime não deve carregar código que não precisa.
 */
export function runtimeFetchShim(mapa) {
  if (!mapa || !Object.keys(mapa).length) return '';
  return `<script data-uncraft-runtime-fetch-map>(function(){
  if (window.__uncraftFetchMapped) return;
  window.__uncraftFetchMapped = true;
  var M = ${jsonParaScript(mapa)};
  function traduz(u) {
    try {
      if (typeof u !== 'string' || !u) return null;
      var abs = new URL(u, document.baseURI).href;
      if (!Object.prototype.hasOwnProperty.call(M, abs)) return null;
      // O caminho local resolve contra a URL DO DOCUMENTO, nunca contra o baseURI:
      // uma tag base remanescente mandaria a chamada de volta para fora ou para o
      // caminho errado (Astra). Sem acentos graves aqui: isto vive dentro de um
      // template literal e um acento grave o fecharia.
      return new URL(M[abs], location.href).href;
    } catch (e) { return null; }
  }
  function seguro(metodo) {
    var m = String(metodo || 'GET').toUpperCase();
    return m === 'GET' || m === 'HEAD';
  }
  var fOriginal = window.fetch;
  if (typeof fOriginal === 'function') {
    window.fetch = function (entrada, init) {
      try {
        // O metodo pode vir do init OU do Request; o init VENCE, como na plataforma.
        var doInit = init && init.method;
        var comCorpo = Boolean(init && init.body != null);
        if (typeof entrada === 'string') {
          if (seguro(doInit || 'GET') && !comCorpo) {
            var l = traduz(entrada);
            if (l) return fOriginal.call(this, l, init);
          }
        } else if (entrada && typeof entrada.url === 'string') {
          if (seguro(doInit || entrada.method) && !comCorpo && !entrada.bodyUsed && entrada.body == null) {
            var r = traduz(entrada.url);
            // Sem mode/credentials forcados: mexer nisso muda semantica
            // observavel. O caminho local e de mesma origem por construcao.
            if (r) return fOriginal.call(this, r, init);
          }
        }
      } catch (e) { /* nunca quebrar a pagina por causa do remendo */ }
      return fOriginal.apply(this, arguments);
    };
  }
  var abrirOriginal = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (metodo, url) {
    var args = Array.prototype.slice.call(arguments);
    try {
      if (seguro(metodo)) {
        var l = traduz(url);
        if (l) args[1] = l;
      }
    } catch (e) { /* idem */ }
    return abrirOriginal.apply(this, args);
  };
})();</script>`;
}
