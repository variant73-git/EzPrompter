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
 * dele e reconstrói uma `Response` com o status e os cabeçalhos originais. Sem gateway
 * e sem lógica de servidor. ⚠️ A afirmação anterior "nenhum POST chega a servidor
 * algum" era FALSA (Astra B2 #1): um miss passava ao `fetch` original, e CORS impede
 * LER a resposta, não ENVIAR o pedido. Agora um método mutável a outra origem, sem
 * envelope, FALHA como falharia offline; só GET/HEAD (ou mesma origem) passam.
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
 *  • XHR: FORA. Trocar a URL em `open()` não é replay (status/cabeçalhos do servidor
 *    estático, corpo cru). Um XHR sai e é bloqueado. Replay real exige proxy completo.
 *  • Identidade inclui `content-type`, `authorization` e `x-*` do pedido; cabeçalhos que
 *    o navegador acrescenta sozinho (accept, cookie, sec-*) ficam fora — o objeto
 *    Request não os vê, então incluí-los daria falso miss. Resíduo: resposta que varia
 *    por cookie de sessão não é distinguível e cai no mesmo id.
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
export function montarReplay(envelopes, mapa, { marcador = '__UNCRAFT_ORIGIN__' } = {}) {
  const manifesto = {};
  const arquivos = [];
  for (const [id, lista] of envelopes || []) {
    const entradas = [];
    lista.forEach((env, n) => {
      const path = n === 0 ? `_replay/${id}` : `_replay/${id}.${n}`;
      let body = env.bytes;
      let reescrito = false;
      // Corpo JSON leva a MESMA reescrita dos assets: é assim que a URL absoluta que o
      // JS põe em `img.src` chega já local. O marcador é por pacote e conferido AUSENTE
      // do corpo antes (Astra B2 #7): se o corpo já o contiver, não se reescreve, para
      // nunca corromper conteúdo legítimo na troca.
      if (/^application\/json/i.test(env.contentType || '') && env.url && !Buffer.from(env.bytes).includes(marcador)) {
        try {
          const texto = rewriteDocumentReferences({
            text: Buffer.from(env.bytes).toString('utf8'), kind: 'json',
            resourceUrl: env.url, assetPath: path, map: mapa, marcadorDeOrigem: marcador,
          });
          reescrito = texto.includes(marcador);
          body = reescrito ? Buffer.from(texto, 'utf8') : env.bytes;
        } catch { body = env.bytes; reescrito = false; }
      }
      const bytes = Buffer.byteLength(body);
      arquivos.push({ path, body: new Uint8Array(body), contentType: env.contentType || undefined });
      // ⚠️ SEM `metodo`/`url` no manifesto público (Astra B2 #6): query com token vazaria
      // no HTML. SEM índice de XHR (Astra B2 #4): trocar a URL em `open()` não é replay
      // — o XHR via status e cabeçalhos do servidor estático e o corpo cru. XHR fica
      // declaradamente fora; a chamada sai e é bloqueada, como sem o remendo.
      entradas.push({
        status: env.status, statusText: env.statusText || '', headers: env.headers || {}, path: `./${path}`,
        bytes,
        // Só o envelope que FOI reescrito passa pela troca do marcador.
        resolveMarcador: reescrito,
      });
    });
    manifesto[id] = entradas;
  }
  return { manifesto, arquivos };
}

/**
 * Script do remendo. Vazio quando não há nada a replayar — um clone sem chamada de
 * runtime não carrega código que não precisa.
 */
export function runtimeFetchShim(manifesto, { marcador = '__UNCRAFT_ORIGIN__' } = {}) {
  if (!manifesto || !Object.keys(manifesto).length) return '';
  return `<script data-uncraft-runtime-fetch-map>(function(){
  if (window.__uncraftFetchMapped) return;
  window.__uncraftFetchMapped = true;
  var M = ${jsonParaScript(manifesto)};
  var MARCADOR = ${jsonParaScript(marcador)};
  // Base FIXADA na injecao (Astra B2 #5): depois de pushState para /a/b, resolver
  // './_replay' contra location.href procuraria /a/_replay. Este script esta logo
  // apos o doctype, antes de qualquer codigo do site: location.href AQUI e a entrada.
  var BASE = location.href;
  var vezes = {};
  var subtle = (window.crypto && window.crypto.subtle) || null;
  var enc = new TextEncoder();
  function hex(buf) {
    var b = new Uint8Array(buf), s = '';
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16);
    return s;
  }
  // MESMA formula da captura: sha256(METODO + LF + url + LF + sha256hex(corpo) + LF +
  // cabecalhos de identidade ordenados). O metodo ja vem normalizado pela plataforma
  // (so os seis que o Fetch normaliza vao a maiusculas; 'patch' fica 'patch').
  function cabecalhosDeIdentidade(headers) {
    var pares = [];
    headers.forEach(function (valor, nome) {
      var n = nome.toLowerCase();
      if (n === 'content-type' || n === 'authorization' || n.indexOf('x-') === 0) pares.push(n + ':' + String(valor).trim());
    });
    return pares.sort().join('\\n');
  }
  function identidade(req, corpo) {
    return subtle.digest('SHA-256', corpo).then(function (h) {
      var texto = req.method + '\\n' + req.url + '\\n' + hex(h) + '\\n' + cabecalhosDeIdentidade(req.headers);
      return subtle.digest('SHA-256', enc.encode(texto));
    }).then(hex);
  }
  function local(caminho) { return new URL(caminho, BASE).href; }
  function mesmaOrigem(url) { try { return new URL(url, BASE).origin === location.origin; } catch (e) { return false; } }
  function falhaOffline() { return Promise.reject(new TypeError('Failed to fetch')); }
  var fOriginal = window.fetch;
  if (typeof fOriginal === 'function' && subtle) {
    window.fetch = function (entrada, init) {
      var args = arguments, self = this;
      // O passthrough e chamado NO MAXIMO UMA VEZ, e sua rejeicao nunca e capturada
      // por este remendo: a falha de rede e do site, e tem que chegar ao site como
      // chegaria sem nos. A 1a versao envolvia tudo num catch — uma chamada NAO
      // mapeada que falhava na rede disparava um SEGUNDO passthrough (sonda do
      // Astra: n=2), e para um POST que alcance servidor real isso e envio duplo.
      var promessaPassthrough = null;
      var passthrough = function () {
        if (!promessaPassthrough) promessaPassthrough = fOriginal.apply(self, args);
        return promessaPassthrough;
      };
      var req;
      try {
        // Construir um Request a partir de outro Request CONSOME o corpo do original;
        // o passthrough depois receberia um corpo ja usado. Clona-se ANTES.
        var fonte = (typeof Request !== 'undefined' && entrada instanceof Request) ? entrada.clone() : entrada;
        req = new Request(fonte, init);
      } catch (e) { return passthrough(); }
      // FALHA FECHADA para metodo mutavel a OUTRA origem (Astra B2 #1): um miss NAO
      // pode virar POST real no servidor original — CORS impede LER a resposta, nao
      // ENVIAR o pedido. O clone e offline; a chamada falha como falharia sem rede.
      var mutavel = !(req.method === 'GET' || req.method === 'HEAD');
      var externa = !mesmaOrigem(req.url);
      var semRede = function () { return (mutavel && externa) ? falhaOffline() : passthrough(); };
      // FormData/multipart nunca bate (fronteira aleatoria): e um miss por construcao.
      var ct = req.headers.get('content-type') || '';
      if (/multipart\\/form-data/i.test(ct)) return semRede();
      return req.arrayBuffer().then(function (corpo) {
        return identidade(req, corpo);
      }).then(function (id) {
        var lista = M[id];
        if (!lista || !lista.length) return semRede();
        var n = vezes[id] || 0; vezes[id] = n + 1;
        // Ocorrencias ESGOTADAS = miss (Astra B2 #3): repetir a ultima resposta para
        // sempre fabricava respostas para chamadas que nunca foram capturadas.
        if (n >= lista.length) return semRede();
        var env = lista[n];
        return fOriginal.call(window, local(env.path), { cache: 'no-store' }).then(function (r) {
          // O arquivo local tem que ser o envelope — nao um 404, nem o index.html de
          // fallback de uma SPA embrulhado como corpo (Astra B2 #5).
          if (!r.ok) throw new TypeError('envelope ausente');
          return r.arrayBuffer();
        }).then(function (buf) {
          if (typeof env.bytes === 'number' && buf.byteLength !== env.bytes) throw new TypeError('envelope com tamanho errado');
          var corpo = buf;
          if (env.resolveMarcador) {
            // So o envelope que FOI reescrito: o marcador vira a origem REAL de onde o
            // clone esta sendo servido, e a URL continua absoluta http(s).
            corpo = new TextDecoder().decode(buf).split(MARCADOR).join(location.origin);
          }
          // Status sem corpo exigem body null, senao new Response lanca (Astra B2 #5).
          var semCorpo = env.status === 204 || env.status === 205 || env.status === 304 || req.method === 'HEAD';
          return new Response(semCorpo ? null : corpo, { status: env.status, statusText: env.statusText || '', headers: env.headers || {} });
        }).then(null, semRede);   // QUALQUER falha do caminho de replay local = miss
      }, semRede);                // falha na fase de IDENTIDADE: idem
    };
  }
  // XHR: declaradamente FORA (Astra B2 #4). Trocar a URL em open() entregava status e
  // cabecalhos do servidor estatico e o corpo cru — nao era replay. Um XHR sai e e
  // bloqueado, como sem o remendo. Replay de XHR exige um proxy completo do objeto.
})();</script>`;
}
