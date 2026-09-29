/**
 * REPLAY DE CHAMADAS DE RUNTIME (fetch/XHR) DENTRO DO CLONE — 2026-09-29.
 *
 * O problema, medido no gsap.com (2ª cobaia): `js/header.js` chama `fetch` com uma
 * URL **construída em código** e **POST com corpo GraphQL**. A reescrita de referências
 * só troca URL que aparece como texto, e um mapa por URL não pode representar uma
 * requisição cuja identidade inclui o corpo. Offline a chamada morre, e o efeito visível
 * foi 3 imagens ausentes (injetadas por JS com os dados que o fetch traria).
 *
 * O DESENHO (o que o Astra prescreveu): manifesto indexado por IDENTIDADE de requisição
 * — método + URL + hash do corpo — guardando o ENVELOPE (status, cabeçalhos, corpo). O
 * envelope vira arquivo dentro do pacote (`_replay/<id>`), e o remendo faz um GET local
 * dele e reconstrói uma `Response` com o status e os cabeçalhos originais. Sem gateway,
 * sem lógica de servidor, e **nenhum POST chega a servidor algum** — o que fecha o
 * confused deputy por construção. Funciona no portão e no produto.
 *
 * A identidade é calculada com a MESMA fórmula no Node (captura) e no navegador
 * (SubtleCrypto): qualquer divergência vira "não encontrado", nunca replay errado.
 *
 * LIMITES DECLARADOS:
 *  • Só traduz o que está no manifesto. O resto passa intacto.
 *  • `Response.url` e `response.type` são os do arquivo local ('basic'), não os
 *    originais; um site que os leia vê outra coisa. Status e cabeçalhos são fiéis.
 *  • Corpo `FormData`/multipart não replaya: o navegador gera outra fronteira a cada
 *    envio e o hash nunca bate. Passa intacto.
 *  • XHR: só GET/HEAD sem corpo (identidade resolvível de forma síncrona em `open`);
 *    XHR com corpo passa intacto — `send` não pode esperar um hash assíncrono.
 *  • Não alcança `img.src`, CSS, worker, iframe, `sendBeacon`, `EventSource`,
 *    WebSocket, nem uma substituição de `fetch` posterior à nossa.
 *  • Sem SubtleCrypto (contexto não seguro — http fora de localhost) tudo passa
 *    intacto. É a mesma fronteira em que o próprio site já morre (crypto.randomUUID).
 */
import { rewriteDocumentReferences } from './rewrite-references.js';

/** Escapa para caber dentro de `<script>` sem fechar a tag. */
function jsonParaScript(valor) {
  return JSON.stringify(valor)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    // Os separadores de linha U+2028/U+2029 são escapados por CÓDIGO, não por literal
    // de regex: o caractere cru dentro de `/.../` é erro de sintaxe.
    .replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028')
    .replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029');
}

/**
 * Transforma os envelopes capturados em arquivos do pacote + manifesto do remendo.
 * @param {Map<string, Array<{metodo,url,status,statusText,headers,contentType,bytes}>>} envelopes
 * @param {Map<string,string>} mapa URL original -> caminho no pacote (para reescrever JSON)
 */
export function montarReplay(envelopes, mapa) {
  const manifesto = {};
  const porUrlGet = {};
  const arquivos = [];
  for (const [id, lista] of envelopes || []) {
    const entradas = [];
    lista.forEach((env, n) => {
      const path = n === 0 ? `_replay/${id}` : `_replay/${id}.${n}`;
      let body = env.bytes;
      // Corpo JSON leva a MESMA reescrita dos assets: é assim que a URL absoluta que o
      // JS põe em `img.src` chega já local (caminho relativo à RAIZ, ver
      // rewrite-references.js).
      if (/^application\/json/i.test(env.contentType || '')) {
        try {
          body = Buffer.from(rewriteDocumentReferences({
            text: Buffer.from(env.bytes).toString('utf8'), kind: 'json',
            resourceUrl: env.url, assetPath: path, map: mapa,
          }), 'utf8');
        } catch { body = env.bytes; }
      }
      arquivos.push({ path, body: new Uint8Array(body), contentType: env.contentType || undefined });
      entradas.push({
        status: env.status, statusText: env.statusText || '', headers: env.headers || {}, path: `./${path}`,
        // Diagnosticável: o manifesto diz o que cada identidade era.
        metodo: env.metodo, url: env.url,
        // Só corpo de texto passa pela troca do marcador de origem.
        texto: /^(application\/json|text\/|application\/(javascript|xml))/i.test(env.contentType || ''),
      });
      // Índice síncrono para XHR: GET/HEAD sem corpo resolve pela URL.
      const m = String(env.metodo || 'GET').toUpperCase();
      if (n === 0 && (m === 'GET' || m === 'HEAD')) porUrlGet[env.url] = `./${path}`;
    });
    manifesto[id] = entradas;
  }
  return { manifesto, porUrlGet, arquivos };
}

/**
 * Script do remendo. Vazio quando não há nada a replayar — um clone sem chamada de
 * runtime não carrega código que não precisa.
 */
export function runtimeFetchShim(manifesto, porUrlGet = {}) {
  if (!manifesto || !Object.keys(manifesto).length) return '';
  return `<script data-uncraft-runtime-fetch-map>(function(){
  if (window.__uncraftFetchMapped) return;
  window.__uncraftFetchMapped = true;
  var M = ${jsonParaScript(manifesto)};
  var G = ${jsonParaScript(porUrlGet || {})};
  var vezes = {};
  var subtle = (window.crypto && window.crypto.subtle) || null;
  var enc = new TextEncoder();
  function hex(buf) {
    var b = new Uint8Array(buf), s = '';
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16);
    return s;
  }
  // MESMA formula da captura: sha256(METODO + LF + url + LF + sha256hex(corpo)).
  function identidade(metodo, url, corpo) {
    return subtle.digest('SHA-256', corpo).then(function (h) {
      var texto = String(metodo || 'GET').toUpperCase() + '\\n' + url + '\\n' + hex(h);
      return subtle.digest('SHA-256', enc.encode(texto));
    }).then(hex);
  }
  function local(caminho) { return new URL(caminho, location.href).href; }
  var fOriginal = window.fetch;
  if (typeof fOriginal === 'function' && subtle) {
    window.fetch = function (entrada, init) {
      var args = arguments, self = this;
      var req;
      try { req = new Request(entrada, init); } catch (e) { return fOriginal.apply(self, args); }
      // FormData/multipart nunca bate (fronteira aleatoria): passa intacto.
      var ct = req.headers.get('content-type') || '';
      if (/multipart\\/form-data/i.test(ct)) return fOriginal.apply(self, args);
      return req.clone().arrayBuffer().then(function (corpo) {
        return identidade(req.method, req.url, corpo);
      }).then(function (id) {
        var lista = M[id];
        if (!lista || !lista.length) return fOriginal.apply(self, args);
        var n = vezes[id] || 0; vezes[id] = n + 1;
        var env = lista[Math.min(n, lista.length - 1)];
        return fOriginal.call(window, local(env.path), { cache: 'no-store' }).then(function (r) {
          return env.texto ? r.text() : r.arrayBuffer();
        }).then(function (corpo) {
          // O marcador de origem vira a origem REAL de onde o clone esta sendo servido:
          // a URL continua absoluta http(s), que e o que o codigo do site testa.
          var saida = env.texto ? corpo.split('__UNCRAFT_ORIGIN__').join(location.origin) : corpo;
          return new Response(saida, { status: env.status, statusText: env.statusText || '', headers: env.headers || {} });
        });
      }).catch(function () { return fOriginal.apply(self, args); });
    };
  }
  var abrirOriginal = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (metodo, url) {
    var args = Array.prototype.slice.call(arguments);
    try {
      var m = String(metodo || 'GET').toUpperCase();
      if (m === 'GET' || m === 'HEAD') {
        var abs = new URL(url, document.baseURI).href;
        if (Object.prototype.hasOwnProperty.call(G, abs)) args[1] = local(G[abs]);
      }
    } catch (e) { /* nunca quebrar a pagina por causa do remendo */ }
    return abrirOriginal.apply(this, args);
  };
})();</script>`;
}
