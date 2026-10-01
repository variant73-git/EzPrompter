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
      // BURACO: ocorrência perdida na captura vira `null` no manifesto — o remendo a
      // trata como miss, e as seguintes mantêm a posição (Astra B3 #4).
      // Com o documento da chamada (Astra B133): o buraco tambem e conferido antes de o cursor
      // andar — senao uma chamada de OUTRO documento o consumia e deslocava as seguintes.
      const contexto = { ...(typeof env.documento === 'string' ? { documento: env.documento } : {}), ...(typeof env.politica === 'string' ? { politica: env.politica } : {}) };
      if (env.perdido) { entradas.push(Object.keys(contexto).length ? { perdido: true, ...contexto } : null); return; }
      // OPACO (Astra B16): a pagina nunca leu esta resposta; o remendo consome a
      // ocorrencia e segue pelo miss. Sem arquivo.
      if (env.opaco) { entradas.push({ opaco: true, ...contexto }); return; }
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
        // A cadeia saiu da origem da página (Astra B18): sob no-cors e opaco; sob
        // same-origin o nativo falha. O remendo decide pelo modo do pedido.
        ...(env.cruzouOrigem ? { cruzouOrigem: true } : {}),
        // Veio de um redirect SEGUIDO (Astra B37): o remendo aplica a politica
        // `redirect` do pedido antes de servir.
        ...(env.redirecionou ? { redirecionou: true } : {}),
        // Cross-origin e elegibilidade a CORS credenciado (Astra B38).
        ...(env.externo ? { externo: true } : {}),
        ...(env.corsCredenciado ? { corsCredenciado: true } : {}),
        // Preflight credenciado VERIFICADO na captura (Astra B97): so com ele um replay
        // `include` que exige preflight (corpo em fluxo, cabecalho fora do safelist) e servido.
        ...(env.preflightCredenciado ? { preflightCredenciado: true } : {}),
        // Preflight verificado em geral (Astra B103): exigido por QUALQUER replay cors externo
        // que precise de preflight, em qualquer modo de credenciais.
        ...(env.preflightVerificado ? { preflightVerificado: true } : {}),
        // 1o salto nao-303 (Astra B106): o nativo rejeita um corpo em fluxo que o atravesse.
        ...(env.redirectRejeitaFluxo ? { redirectRejeitaFluxo: true } : {}),
        // Cabecalhos inseguros que o preflight capturado autorizou (Astra B108).
        ...(Array.isArray(env.preflightCabecalhos) ? { preflightCabecalhos: env.preflightCabecalhos } : {}),
        // Hash do documento de onde a chamada partiu (Astra B132) — hash, nunca a URL (token).
        ...(typeof env.documento === 'string' ? { documento: env.documento } : {}),
        // Politica de referrer do documento na chamada (Astra B136).
        ...(typeof env.politica === 'string' ? { politica: env.politica } : {}),
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
export function runtimeFetchShim(manifesto, { marcador = '__UNCRAFT_ORIGIN__', entryPath = 'index.html', origemFonte = '', tetoIdentidadeMs = 15000, proveniencias = {}, caminhosDeFetch = [], origensAlheias = {}, gruposDeProveniencia = {}, sempre = false } = {}) {
  // Emitido quando ha envelopes OU caminhos protegidos (Astra B58): uma captura so de XHR
  // tem manifesto vazio, mas o asset estatico dela nao pode responder a um fetch de
  // outra identidade — sem interceptor, respondia.
  const temEnvelopes = Boolean(manifesto && Object.keys(manifesto).length);
  const temProtegidos = Boolean(caminhosDeFetch && caminhosDeFetch.length);
  // ... OU proveniencias externas (Astra B62): a opacidade do asset `_ext/` (B41) vive no
  // remendo — sem ele, um fetch same-origin leria a copia local do que ao vivo era opaco.
  const temProveniencias = Boolean(proveniencias && Object.keys(proveniencias).length) || Boolean(origensAlheias && Object.keys(origensAlheias).length);
  // `sempre` (Astra B143): a guarda de negociacao vale tambem num pacote so de assets estaticos.
  if (!sempre && !temEnvelopes && !temProtegidos && !temProveniencias) return '';
  manifesto = manifesto || {};
  // A origem da fonte so serve para reconstruir a identidade de um pedido same-origin
  // contra os envelopes; sem envelopes ninguem a le — e o HTML servido nao deve carregar
  // a origem original sem necessidade (o fechamento de referencias garante que nada
  // aponta para ela).
  if (!temEnvelopes) origemFonte = '';
  return `<script data-uncraft-runtime-fetch-map>(function(){
  if (window.__uncraftFetchMapped) return;
  window.__uncraftFetchMapped = true;
  var M = ${jsonParaScript(manifesto)};
  var MARCADOR = ${jsonParaScript(marcador)};
  var ENTRY = ${jsonParaScript(entryPath)};
  // Proveniencia EXATA (Astra B44): caminho de asset _ext/ -> identidade do GET simples
  // a URL original. A URL reconstruida do caminho e com perdas e nunca seleciona
  // envelope; so este mapa seleciona, e so para GET sem corpo e sem cabecalho de
  // identidade. O resto e miss.
  // Desserializado por JSON.parse (Astra B54): num literal de objeto JS, a chave
  // "__proto__" define o prototipo em vez de uma propriedade propria; JSON.parse cria a
  // propriedade propria, e a consulta e por hasOwnProperty.
  var PROV = JSON.parse(${jsonParaScript(JSON.stringify(proveniencias || {}))});
  // Grupo canonico (hash de "GET <URL original>") de cada caminho localizado (Astra B126).
  var PROV_GRUPO = JSON.parse(${jsonParaScript(JSON.stringify(gruposDeProveniencia || {}))});
  // Assets de OUTRA ORIGEM com caminho natural no pacote (Astra B79): pagina http com
  // imagem https do mesmo host, por exemplo. Sem a marca, um miss lia a copia local
  // (legivel) do que ao vivo era opaco/recusado. caminho servido -> URL original.
  var ALHEIOS = JSON.parse(${jsonParaScript(JSON.stringify(origensAlheias || {}))});
  // Caminhos de asset que vieram de FETCH (Astra B55): um miss de identidade neles
  // NUNCA cai na copia estatica — rejeita, como se a rede tivesse falhado.
  var DE_FETCH = JSON.parse(${jsonParaScript(JSON.stringify(Object.fromEntries((caminhosDeFetch || []).map((c) => [c, true]))))});
  var FONTE = ${jsonParaScript(origemFonte)};
  // RAIZ do pacote, FIXADA na injecao (Astra B2 #5 / B3 #6): o gateway serve sob um
  // prefixo (/api/runtime/<token>/), e a entrada pode ser aninhada (docs/index.html)
  // ou servida como diretorio. Este script esta logo apos o doctype, antes de
  // qualquer pushState: location.href AQUI e a URL da entrada.
  var TETO_IDENTIDADE_MS = ${Number(tetoIdentidadeMs) || 15000};
  // Comparacao por SEGMENTOS DECODIFICADOS (Astra B4 #5): '/%64ocs/index.html' e
  // '/docs/index.html' sao o mesmo caminho para o servidor, e a comparacao textual
  // punha a raiz no diretorio errado (miss em todo replay).
  function decodificar(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }
  var BASE = location.href.split('#')[0].split('?')[0];
  var CAMINHO = location.pathname.split('/').map(decodificar).join('/');
  var DIR_ENTRY = ENTRY.slice(0, ENTRY.lastIndexOf('/') + 1);
  var RAIZ_CAMINHO = CAMINHO.slice(-ENTRY.length) === ENTRY ? CAMINHO.slice(0, CAMINHO.length - ENTRY.length)
    : (DIR_ENTRY && CAMINHO.slice(-DIR_ENTRY.length) === DIR_ENTRY) ? CAMINHO.slice(0, CAMINHO.length - DIR_ENTRY.length)
    : CAMINHO.slice(0, CAMINHO.lastIndexOf('/') + 1);
  var RAIZ = new URL(RAIZ_CAMINHO, location.origin).href;
  var RAIZ_SEM_BARRA = RAIZ.replace(/\\/$/, '');
  var vezes = {};
  // Grupos (metodo, URL na fonte) cuja ordem de ocorrencias se perdeu (Astra B125): so miss.
  var DESALINHADOS = Object.create(null);
  // Chave CANONICA (Astra B126): alias localizado conhecido => o hash emitido pela captura; senao
  // hash de "METODO <URL na fonte>" — a mesma forma, entao alias e original caem no mesmo grupo.
  function chaveDeGrupo(req) {
    try {
      var s = restoServido(req.url);
      // O hash emitido e de "GET <original>" — so vale para GET (Astra B127); outro metodo usa o
      // proprio metodo e a URL reconstruida, como o pedido pela URL original.
      if (req.method === 'GET' && s && Object.prototype.hasOwnProperty.call(PROV_GRUPO, s.resto) && !queryCrua(s.abs)) return Promise.resolve(PROV_GRUPO[s.resto]);
      var txt = req.method + ' ' + urlNaFonte(req.url).split('#')[0];
      if (!subtle) return Promise.resolve('');
      return subtle.digest('SHA-256', enc.encode(txt)).then(hex, function () { return ''; });
    } catch (e) { return Promise.resolve(''); }
  }
  function desalinhar(req) { return chaveDeGrupo(req).then(function (k) { if (k) DESALINHADOS[k] = true; }); }
  function grupoDesalinhado(req) { return chaveDeGrupo(req).then(function (k) { return !!(k && DESALINHADOS[k]); }); }
  // Marca INTERNA de typed array (Astra B28): o getter intrinseco de
  // %TypedArray%.prototype[Symbol.toStringTag] le o slot interno, ignora um
  // Symbol.toStringTag proprio forjado e vale entre realms. Capturado UMA vez aqui.
  var marcaTyped = (function () {
    try {
      var d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), Symbol.toStringTag);
      return d && typeof d.get === 'function' ? d.get : null;
    } catch (e) { return null; }
  })();
  function ehUint8(x) {
    if (!marcaTyped) return x instanceof Uint8Array;
    try { return marcaTyped.call(x) === 'Uint8Array'; } catch (e) { return false; }
  }
  // Comprimento pelo getter INTRINSECO (Astra B29): um byteLength PROPRIO forjado no
  // chunk fazia o remendo montar bytes a mais e bater no envelope de OUTRO pedido.
  var tamanhoTyped = (function () {
    try {
      var d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength');
      return d && typeof d.get === 'function' ? d.get : null;
    } catch (e) { return null; }
  })();
  function bytesDe(x) { return tamanhoTyped ? tamanhoTyped.call(x) : x.byteLength; }
  // Fila: a alocacao da ocorrencia segue a ORDEM DE CHAMADA do site, nao a ordem em
  // que os hashes terminam (Astra B3 #4). O HASH corre em paralelo; so a alocacao e
  // serializada, e cada passo espera no maximo TETO_IDENTIDADE_MS pela identidade
  // (Astra B4 #2: um corpo em fluxo que nunca termina travava todo fetch da pagina).
  var fila = Promise.resolve();
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
  // MESMA regra da captura (Astra B52): todo cabecalho do script entra; ficam fora os
  // que o navegador acrescenta sozinho e os proibidos ao script; accept so se != */*.
  // Sem prototipo (Astra B53): num objeto comum, 'constructor'/'toString' sao truthy por
  // heranca e um cabecalho de aplicacao com esse nome seria excluido da identidade.
  var DO_NAVEGADOR = Object.create(null);
  ['accept-charset', 'accept-encoding', 'accept-language', 'access-control-request-headers', 'access-control-request-method',
   'cache-control', 'connection', 'content-length', 'cookie', 'cookie2', 'date', 'dnt', 'expect', 'host', 'keep-alive',
   'origin', 'pragma', 'priority', 'purpose', 'referer', 'set-cookie', 'te', 'trailer', 'transfer-encoding', 'upgrade',
   'upgrade-insecure-requests', 'user-agent', 'via'].forEach(function (h) { DO_NAVEGADOR[h] = true; });
  // So ESPACO HTTP e aparado (Astra B90), como o Fetch: trim() tirava NBSP e 'A\u00a0'
  // casava o envelope de 'A' (falso hit, que ainda consumia a ocorrencia). Regex montada
  // sem barras invertidas: o template do remendo as reinterpretaria.
  var BRANCO_HTTP = String.fromCharCode(9, 10, 13, 32);
  var APARAR_HTTP = new RegExp('^[' + BRANCO_HTTP + ']+|[' + BRANCO_HTTP + ']+$', 'g');
  function apararHttp(v) { return String(v).replace(APARAR_HTTP, ''); }
  // Rastreio fora da identidade (espelho de CABECALHOS_DE_RASTREIO da captura): id aleatorio
  // por pedido, nao muda a resposta.
  var RASTREIO = {};
  ['sentry-trace', 'baggage', 'traceparent', 'tracestate', 'b3', 'x-b3-traceid', 'x-b3-spanid', 'x-b3-parentspanid', 'x-b3-sampled', 'x-b3-flags', 'x-datadog-trace-id', 'x-datadog-parent-id', 'x-datadog-origin', 'x-datadog-sampling-priority', 'x-datadog-tags'].forEach(function (h) { RASTREIO[h] = true; });
  function cabecalhosDeIdentidade(headers) {
    var pares = [];
    headers.forEach(function (valor, nome) {
      var n = nome.toLowerCase();
      // Todo cabecalho do Request entra (Astra B128): so contem o que o script pos — salvo rastreio.
      if (Object.prototype.hasOwnProperty.call(RASTREIO, n)) return;
      pares.push(n + ':' + apararHttp(valor));
    });
    return pares.sort().join('\\n');
  }
  // A URL DA IDENTIDADE e a que o site chamou NA FONTE (Astra B3 #5): servido noutra
  // origem, fetch('/api') resolve para a origem do clone e nunca bateria. Uma URL do
  // proprio clone e devolvida a fonte: sob a RAIZ do pacote perde o prefixo; na raiz
  // da origem (root-relative) troca so a origem.
  // Caminhos RESERVADOS do pacote nunca sao devolvidos a fonte (Astra B4 #3): um
  // envelope da fonte para '/x' nao pode sequestrar uma chamada a RAIZ + '_replay/x'
  // ou '_uploads/...'. Residual declarado: uma chamada do site a um ASSET estatico do
  // pacote que tambem tenha envelope de mesma identidade recebe o envelope — mesmos
  // bytes, resultado equivalente.
  function reservado(resto) { return /^(_replay|_uploads)(\\/|$)/.test(resto); }
  // A decodificacao serve SO para achar a fronteira do prefixo (Astra B9): a URL da
  // fonte e reconstruida com o sufixo CRU — decodificar e juntar colapsava
  // '/items/a%2Fb' em '/items/a/b', outra identidade, e o replay entregava a resposta
  // de outro pedido.
  var SEG_RAIZ = RAIZ_CAMINHO.split('/');
  var N_RAIZ = SEG_RAIZ.length - 1;   // RAIZ_CAMINHO termina em '/', o ultimo segmento e ''
  // PROVENIENCIA EXTERNA (Astra B41): um asset localizado sob _ext/<host>/... veio de
  // OUTRA origem (imagem capturada primeiro, literal do script reescrito para a
  // copia local). Tratar essa chamada como same-origin exporia o arquivo local a um
  // fetch que ao vivo era opaco ou bloqueado por CORS. A identidade e a rede usam a
  // URL de proveniencia (melhor esforco: https://<host>/<caminho>; a codificacao e
  // com perdas — scheme, query e caracteres — logo um miss ali vai a rede REAL,
  // nunca ao arquivo local).
  // Query CRUA com o delimitador (Astra B51): URL.search devolve '' tanto para '/api?'
  // quanto para '/api', mas sao URLs distintas; o href preserva o '?' vazio.
  function queryCrua(abs) {
    var h = abs.href.split('#')[0];
    var i = h.indexOf('?');
    return i === -1 ? '' : h.slice(i);
  }
  function restoSobRaiz(url) {
    var abs; try { abs = new URL(url, BASE); } catch (e) { return null; }
    if (abs.origin !== location.origin) return null;
    var segRaw = abs.pathname.split('/');
    var cabeca = segRaw.slice(0, N_RAIZ).map(decodificar).join('/') + '/';
    if (segRaw.length > N_RAIZ && cabeca === RAIZ_CAMINHO) return { resto: segRaw.slice(N_RAIZ).join('/'), abs: abs };
    return { resto: null, abs: abs };
  }
  // A proveniencia e classificada sobre o sufixo DECODIFICADO (Astra B43): o servidor
  // de assets decodifica o caminho antes de procurar o arquivo, entao '%5fext/...' e
  // '_ext%2fhost/...' sao o MESMO asset protegido — e escapavam a checagem crua.
  function restoDecodificado(s) { return s && s.resto ? decodificar(s.resto) : null; }
  // O caminho SERVIDO (Astra B59/B60/B61/B62): o que o servidor entrega para a URL, nao a
  // URL crua — o Next colapsa barras repetidas no pathname inteiro e tira a barra final
  // por redirect (seguido pelo fetch nativo sem voltar aqui), e o sufixo vazio e o alias
  // da entrada no gateway. CLASSIFICACAO (proveniencia externa, asset protegido) e
  // destino da rede usam isto; a IDENTIDADE do pedido segue vendo a URL crua (B51), e um
  // alias nunca casa a ocorrencia canonica.
  var BARRAS = new RegExp('/{2,}', 'g');
  function restoServido(url) {
    var abs; try { abs = new URL(url, BASE); } catch (e) { return null; }
    abs.pathname = abs.pathname.replace(BARRAS, '/');
    var s = restoSobRaiz(abs.href);
    if (!s || s.resto === null) return null;
    var resto = s.resto;
    if (resto.slice(-1) === '/') resto = resto.slice(0, -1);
    var d = resto === '' ? ENTRY : decodificar(resto);
    return d ? { resto: d, abs: s.abs } : null;
  }
  function alheioConhecido(s) { return !!(s && Object.prototype.hasOwnProperty.call(ALHEIOS, s.resto)); }
  function provenienciaExterna(url) {
    var s = restoServido(url);
    return !!(s && (/^_ext\\/[^\\/]+\\//.test(s.resto) || alheioConhecido(s)));
  }
  function urlDeProveniencia(url) {
    var s = restoServido(url);
    if (alheioConhecido(s)) {
      // A URL ORIGINAL (com o esquema real); a query do pedido no clone, se houver, e outra
      // URL (B45) e substitui a original.
      var q = queryCrua(s.abs);
      if (!q) return ALHEIOS[s.resto];
      var o = ALHEIOS[s.resto].split('#')[0]; var i = o.indexOf('?');
      return (i === -1 ? o : o.slice(0, i)) + q;
    }
    var m = s && /^_ext\\/([^\\/]+)\\/(.*)$/.exec(s.resto);
    if (!m) return url;
    return 'https://' + m[1] + '/' + m[2] + queryCrua(s.abs);
  }
  function urlNaFonte(url) {
    if (provenienciaExterna(url)) return urlDeProveniencia(url);
    if (!FONTE) return url;
    var s = restoSobRaiz(url);
    if (!s) return url;
    // Reservado pelo caminho SERVIDO (Astra B64/B65), ANTES de olhar o sufixo cru:
    // '%5freplay/<id>' e servido como '_replay/<id>' (o gateway decodifica) e
    // 'runtime//tok/_replay/<id>' e servido sob a raiz (o Next colapsa as barras) — sao
    // arquivos do pacote, nunca uma URL da fonte reconstruida, que podia casar o
    // envelope de OUTRO pedido real e consumir a ocorrencia dele.
    var sv = restoServido(url);
    if (sv && reservado(sv.resto)) return url;
    if (s.resto !== null) {
      if (reservado(s.resto)) return url;
      return FONTE + '/' + s.resto + queryCrua(s.abs);
    }
    return FONTE + s.abs.pathname + queryCrua(s.abs);
  }
  // ALHEIA NA FONTE (Astra B77): a relocacao muda o que e "mesma origem" — uma URL
  // ABSOLUTA da fonte construida em codigo era same-origin na fonte (a captura decidiu
  // ali se havia ocorrencia) e e cross-origin no clone. As rejeicoes pre-despacho seguem
  // a semantica da FONTE; so a rede fisica olha a origem do clone.
  function alheiaNaFonte(url) {
    if (!FONTE) return true;
    var f = urlNaFonte(url); var o;
    try { o = new URL(f, BASE).origin; } catch (e) { return true; }
    return o !== FONTE;
  }
  // Atributos do pedido na identidade (Astra B129/B130/B131) — espelho LITERAL de
  // ATRIBUTOS_DE_IDENTIDADE da captura: so o que difere do default, em ordem fixa, separado
  // por NUL. O referrer escolhido pelo script e a URL do CLONE aqui; volta para a da fonte.
  var ATRIBUTOS_DE_IDENTIDADE = [['cache', 'default'], ['credentials', 'same-origin'], ['mode', 'cors'], ['referrer', 'about:client'], ['referrerPolicy', '']];
  function marcaDeAtributos(req) {
    var s = '';
    for (var i = 0; i < ATRIBUTOS_DE_IDENTIDADE.length; i++) {
      var k = ATRIBUTOS_DE_IDENTIDADE[i][0]; var v = req[k];
      if (v === undefined || v === null || v === ATRIBUTOS_DE_IDENTIDADE[i][1]) continue;
      if (k === 'referrer' && typeof v === 'string' && v !== '') v = urlNaFonte(v);
      s += '\\n' + String.fromCharCode(0) + k + ':' + String(v);
    }
    return s;
  }
  // Documento atual na forma da FONTE (Astra B132): '' = a URL de entrada (a do clone ao
  // carregar); outra = traduzida para a fonte. Espelho de documentoDaChamada da captura.
  // Politica de referrer do documento (Astra B135) — espelho LITERAL da captura.
  var POLITICAS_VALIDAS = { 'no-referrer': 1, 'no-referrer-when-downgrade': 1, 'same-origin': 1, 'origin': 1, 'strict-origin': 1, 'origin-when-cross-origin': 1, 'strict-origin-when-cross-origin': 1, 'unsafe-url': 1 };
  var metasConhecidas = typeof WeakSet === 'function' ? new WeakSet() : null;   // metas cujo efeito ja foi aplicado
  var POLITICA_DESCONHECIDA = String.fromCharCode(0) + 'desconhecida';
  var politicaMeta = '';
  function aplicarMeta(el) {
    // So o CERTO e aplicado (Astra B139): nome exatamente 'referrer' e valor exatamente um token
    // do padrao; conteudo vazio e ignorado (norma). Qualquer outro valor numa meta de referrer —
    // legado ('none', 'never'...), caixa ou espaco diferentes — e interpretado pelo navegador de
    // um jeito que nao se reproduz com certeza aqui: politica DESCONHECIDA (so miss, nunca erro).
    try {
      if (!el || el.nodeName !== 'META' || !el.isConnected) return;
      var nome = el.getAttribute('name');
      if (nome === null || String(nome).toLowerCase() !== 'referrer') return;
      var v = el.getAttribute('content');
      if (v === null) return;   // sem content o Chromium nao processa; vazio ele tenta — desconhecido abaixo
      if (nome === 'referrer' && Object.prototype.hasOwnProperty.call(POLITICAS_VALIDAS, v)) politicaMeta = v;
      else politicaMeta = POLITICA_DESCONHECIDA;
    } catch (e) { politicaMeta = POLITICA_DESCONHECIDA; }
  }
  function processarMetas(registros) {
    // Lote RECONSTRUIVEL so quando cada meta aparece UMA vez e segue conectada (Astra B137): o
    // registro aponta para o elemento de AGORA — uma meta inserida e removida na mesma tarefa,
    // ou alterada duas vezes, ja nao mostra o valor que a politica tomou (remover nao desfaz a
    // politica). Fora disso a politica fica DESCONHECIDA para o resto do documento.
    if (politicaMeta === POLITICA_DESCONHECIDA) return;
    var eventos = [];   // [elemento, 'direto' | 'sub' | 'attr' | 'rem']
    for (var i = 0; i < registros.length; i++) {
      var rg = registros[i];
      if (rg.type === 'attributes') { if (rg.target && rg.target.nodeName === 'META') eventos.push([rg.target, 'attr']); continue; }
      for (var j = 0; j < rg.addedNodes.length; j++) {
        var no = rg.addedNodes[j];
        if (no.nodeName === 'META') eventos.push([no, 'direto']);
        else if (no.querySelectorAll) { var ms = no.querySelectorAll('meta'); for (var k = 0; k < ms.length; k++) eventos.push([ms[k], 'sub']); }
      }
      // REMOCAO de meta (Astra B138): remover nao desfaz a politica e o que a meta valia na
      // insercao pode nao estar em nenhum registro de adicao (subarvore montada e esvaziada).
      for (var rr = 0; rr < rg.removedNodes.length; rr++) {
        var rm = rg.removedNodes[rr];
        if (rm.nodeName === 'META') eventos.push([rm, 'rem']);
        else if (rm.querySelectorAll) { var rms = rm.querySelectorAll('meta'); for (var rk = 0; rk < rms.length; rk++) eventos.push([rms[rk], 'rem']); }
      }
    }
    // A mesma insercao vista duas vezes: o parser insere o ancestral vazio e depois a meta (que
    // tem registro proprio); a busca no ancestral a acha de novo. Sub descartado quando ha direto.
    var vale = [];
    for (var a = 0; a < eventos.length; a++) {
      var ev = eventos[a];
      if (ev[1] === 'sub') { var temDireto = false; for (var d = 0; d < eventos.length; d++) if (eventos[d][0] === ev[0] && eventos[d][1] === 'direto') temDireto = true; if (temDireto) continue; }
      vale.push(ev);
    }
    for (var b = 0; b < vale.length; b++) {
      var el = vale[b][0]; var vezes = 0; var mexido = false;
      for (var c = 0; c < vale.length; c++) if (vale[c][0] === el) { vezes++; if (vale[c][1] === 'attr') mexido = true; }
      var nome = ''; try { nome = String(el.getAttribute('name') || '').toLowerCase(); } catch (e) { nome = ''; }
      // Irrelevante: nao e de referrer agora e nenhum atributo mudou (ex.: meta charset).
      if (nome !== 'referrer' && !mexido) continue;
      // Removida SEM insercao vista (Astra B138): o valor que ela aplicou nao e reconstruivel. Uma meta
      // ja processada em lote anterior, sem atributo mexido agora, sai sem efeito (remover nao desfaz).
      var removida = false; for (var g = 0; g < vale.length; g++) if (vale[g][0] === el && vale[g][1] === 'rem') removida = true;
      if (removida && vezes === 1 && !mexido && metasConhecidas && metasConhecidas.has(el)) continue;
      if (removida || !el.isConnected || vezes > 1) { politicaMeta = POLITICA_DESCONHECIDA; return; }
    }
    for (var f = 0; f < vale.length; f++) if (vale[f][1] !== 'rem') { aplicarMeta(vale[f][0]); if (metasConhecidas) metasConhecidas.add(vale[f][0]); }
  }
  var observadorDeMetas = null;
  try {
    var iniciais = document.querySelectorAll('meta'); for (var q = 0; q < iniciais.length; q++) { aplicarMeta(iniciais[q]); if (metasConhecidas) metasConhecidas.add(iniciais[q]); }
    observadorDeMetas = new MutationObserver(processarMetas);
    observadorDeMetas.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['name', 'content', 'media'] });   // os tres que o Chromium reprocessa (Astra B140)
  } catch (e) { observadorDeMetas = null; }
  function politicaDoDocumento() {
    if (observadorDeMetas) { try { processarMetas(observadorDeMetas.takeRecords()); } catch (e) { /* segue */ } }
    return politicaMeta;
  }
  var DOC_ENTRADA = String(location.href).split('#')[0];
  function documentoAtual() { var h = String(location.href).split('#')[0]; return h === DOC_ENTRADA ? '' : urlNaFonte(h); }
  function identidadeDeProveniencia(req) {
    if (req.method !== 'GET' || req.body || cabecalhosDeIdentidade(req.headers) !== '') return null;
    if (marcaDeAtributos(req) !== '') return null;   // a proveniencia e do GET default (Astra B129/B131)
    var s = restoSobRaiz(req.url);
    // O mapa e por caminho EMITIDO, sem query (Astra B45): um caminho localizado com
    // query e OUTRO pedido (o site mexeu na URL depois da reescrita) — miss, sem
    // consumir a ocorrencia mapeada.
    if (!s || (s.abs && queryCrua(s.abs) !== '')) return null;   // qualquer '?' (mesmo vazio) e outro pedido
    var d = restoDecodificado(s);
    return (d && Object.prototype.hasOwnProperty.call(PROV, d)) ? PROV[d] : null;
  }
  // Caminho localizado CONHECIDO (no mapa) — de outra origem ou da propria origem com
  // nome transformado (Astra B48): so o mapa seleciona; a URL reconstruida nunca.
  // CLASSIFICA pelo caminho SERVIDO (Astra B63): um alias de caminho localizado conhecido
  // (barra final, barras repetidas) e "conhecido" — nunca cai na URL reconstruida, que e
  // ficticia para um nome transformado e podia casar o envelope de OUTRO pedido. A
  // consulta da identidade (identidadeDeProveniencia) segue CRUA: o alias e miss sem
  // consumir ocorrencia nenhuma.
  function caminhoConhecido(url) {
    var s = restoServido(url);
    return !!(s && Object.prototype.hasOwnProperty.call(PROV, s.resto));
  }
  // A protecao e decidida sobre o asset SERVIDO (Astra B59/B60), nao sobre a URL crua:
  // o servidor canonicaliza a barra final por redirect (o fetch nativo segue o redirect
  // sem voltar ao remendo) e o sufixo vazio (URL de diretorio da raiz) e o alias da
  // entrada no gateway. Resolve os dois antes da consulta; a IDENTIDADE do pedido segue
  // sendo calculada sobre a URL original, intocada.
  function caminhoDeFetch(url) {
    var s = restoServido(url);
    return !!(s && Object.prototype.hasOwnProperty.call(DE_FETCH, s.resto));
  }
  function identidade(req, corpo) {
    if (provenienciaExterna(req.url) || caminhoConhecido(req.url)) return Promise.resolve(identidadeDeProveniencia(req));
    return subtle.digest('SHA-256', corpo).then(function (h) {
      // Sem FRAGMENTO (Astra B76): a captura hasheia a URL que o Playwright entrega SEM
      // fragmento; Request.url no navegador o mantem, e a URL alheia passava intacta
      // — 'U#x' nao casava a ocorrencia de 'U' e a chamada seguinte recebia a errada.
      // Corte LITERAL no '#' (a URL ja esta serializada: '%23' segue codificado, query intacta).
      // corpo PRESENTE e vazio fora de POST/PUT (Astra B134): Content-Length 0 x ausente
      var vazio = (req.body !== null && req.body !== undefined && corpo && corpo.byteLength === 0 && req.method !== 'POST' && req.method !== 'PUT') ? '\\n' + String.fromCharCode(0) + 'corpo:vazio' : '';
      var texto = req.method + '\\n' + urlNaFonte(req.url).split('#')[0] + '\\n' + hex(h) + '\\n' + cabecalhosDeIdentidade(req.headers) + marcaDeAtributos(req) + vazio;
      return subtle.digest('SHA-256', enc.encode(texto));
    }).then(hex);
  }
  function local(caminho) { return new URL(caminho, RAIZ).href; }
  // SUBRESOURCE INTEGRITY no hit (Astra B34): o fetch nativo rejeita bytes que nao
  // batem com req.integrity; o replay entregava qualquer envelope. Regras do SRI:
  // varios tokens separados por espaco, vale o algoritmo MAIS FORTE presente, qualquer
  // digest desse algoritmo que bata aprova; metadado vazio/ilegivel nao impoe nada.
  var ALGOS_SRI = { sha256: 'SHA-256', sha384: 'SHA-384', sha512: 'SHA-512' };
  var FORCA_SRI = { sha256: 1, sha384: 2, sha512: 3 };
  function base64DeBytes(buf) {
    var b = new Uint8Array(buf), s = '';
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s);
  }
  function verificarIntegridade(metadado, bytes) {
    var tokens = String(metadado || '').split(/\\s+/).filter(Boolean);
    var candidatos = [], forca = 0;
    for (var i = 0; i < tokens.length; i++) {
      // Alfabeto base64 COMPLETO, incluindo o URL-safe (Astra B35): o Chromium aceita
      // e normaliza '-' e '_'; recusa-los descartava o digest e, sem candidato, a
      // verificacao nao impunha nada.
      // Aliases hifenizados (Astra B36): o Chromium aceita 'sha-256'/'sha-384'/'sha-512';
      // ler 'sha-256-…' como algoritmo 'sha' descartava o token e falhava aberto.
      var m = /^(sha-?(?:256|384|512))-([A-Za-z0-9+\\/_=-]+)(?:\\?.*)?$/i.exec(tokens[i]);
      if (!m) continue;
      var algo = m[1].toLowerCase().replace('-', '');
      if (!ALGOS_SRI[algo]) continue;
      var digest = m[2].replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
      if (FORCA_SRI[algo] > forca) { forca = FORCA_SRI[algo]; candidatos = []; }
      if (FORCA_SRI[algo] === forca) candidatos.push({ algo: algo, digest: digest });
    }
    if (!candidatos.length) return Promise.resolve(true);
    return subtle.digest(ALGOS_SRI[candidatos[0].algo], bytes).then(function (h) {
      var real = base64DeBytes(h).replace(/=+$/, '');
      for (var j = 0; j < candidatos.length; j++) if (candidatos[j].digest === real) return true;
      return false;
    });
  }
  function mesmaOrigem(url) { try { return new URL(url, BASE).origin === location.origin; } catch (e) { return false; } }
  function falhaOffline() { return Promise.reject(new TypeError('Failed to fetch')); }
  // Abort REJEITA como o Fetch nativo (Astra B5 #1) — nunca vira miss nem replay.
  function erroDeAbort() {
    var x;
    try { x = new DOMException('The operation was aborted.', 'AbortError'); }
    catch (e) { x = new Error('The operation was aborted.'); x.name = 'AbortError'; }
    try { x.uncraftAbort = true; } catch (e) {}
    return x;
  }
  // Abort atravessa TODOS os handlers de miss: a 1a versao lancava o AbortError e o
  // handler da fase de identidade o convertia em passthrough (Astra B5 #1, medido).
  function ehAbort(e) { return !!(e && (e.uncraftAbort || e.name === 'AbortError')); }
  function abortado(req) { return !!(req && req.signal && req.signal.aborted); }
  // A RAZAO do sinal e o que o site espera receber (Astra B6 #2): abort(meuErro)
  // rejeita com meuErro, nao com um AbortError generico.
  function razaoDeAbort(req) {
    var s = req && req.signal;
    if (s && s.aborted && s.reason !== undefined) return s.reason;
    return erroDeAbort();
  }
  var fOriginal = window.fetch;
  if (typeof fOriginal === 'function' && subtle) {
    // PREFLIGHT no replay (Astra B97): o pedido EFETIVO do replay pode exigir preflight que
    // a captura nunca viu (corpo em fluxo; um Request de entrada com corpo, cuja fonte nao
    // e observavel, conta como fluxo — conservador, declarado). Regras do safelist portadas
    // sem barras invertidas (o template as reinterpretaria).
    var SAFELIST_CORS = { accept: 1, 'accept-language': 1, 'content-language': 1, 'content-type': 1, range: 1 };
    // range simples: bytes=N- ou bytes=N-M (M >= N), so digitos, sem espaco (Astra B104)
    function rangeSimples(v) {
      if (v.slice(0, 6) !== 'bytes=') return false;
      var resto = v.slice(6); var i = resto.indexOf('-'); if (i <= 0) return false;
      var a = resto.slice(0, i), b = resto.slice(i + 1);
      var digitos = function (s) { if (!s.length) return false; for (var k = 0; k < s.length; k += 1) { var c = s.charCodeAt(k); if (c < 48 || c > 57) return false; } return true; };
      if (!digitos(a)) return false;
      // Chromium recusa extremos >= INT64_MAX (Astra B114)
      var LIMITE = '9223372036854775807';
      var menorQueLimite = function (s) { var k = 0; while (k < s.length - 1 && s.charAt(k) === '0') k += 1; s = s.slice(k); return s.length !== LIMITE.length ? s.length < LIMITE.length : s < LIMITE; };
      if (!menorQueLimite(a)) return false;
      if (b === '') return true; if (!digitos(b)) return false;
      if (!menorQueLimite(b)) return false;
      // comparacao EXATA de decimais normalizados (Astra B110: Number arredonda acima de 2^53)
      var semZeros = function (s) { var k = 0; while (k < s.length - 1 && s.charAt(k) === '0') k += 1; return s.slice(k); };
      var x = semZeros(b), y = semZeros(a);
      return x.length !== y.length ? x.length > y.length : x >= y;
    }
    var PONTUACAO_INSEGURA = [34, 40, 41, 58, 60, 62, 63, 64, 91, 92, 93, 123, 125, 127];
    function byteInseguro(v) { for (var i = 0; i < v.length; i += 1) { var c = v.charCodeAt(i); if ((c < 32 && c !== 9) || PONTUACAO_INSEGURA.indexOf(c) !== -1) return true; } return false; }
    function linguaOk(v) { for (var i = 0; i < v.length; i += 1) { var c = v.charCodeAt(i); var ok = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 32 || c === 42 || c === 44 || c === 45 || c === 46 || c === 59 || c === 61; if (!ok) return false; } return true; }
    function valorSafelisted(n, v) {
      if (v.length > 128) return false;
      if (n === 'accept') return !byteInseguro(v);
      if (n === 'accept-language' || n === 'content-language') return linguaOk(v);
      if (n === 'range') return rangeSimples(v);
      if (n === 'content-type') { if (byteInseguro(v)) return false; var mime = apararHttp(v.split(';')[0]).toLowerCase(); return mime === 'application/x-www-form-urlencoded' || mime === 'multipart/form-data' || mime === 'text/plain'; }
      return false;
    }
    // Metodo e cabecalhos primeiro (sem ler nada do init); o corpo em fluxo so por ultimo,
    // e por um getter LAZY de leitura unica — o contrato B13/B14/B15 (init lido so pelo
    // construtor) fica intacto fora desta lane estreita (include + externo + credenciado
    // sem preflight verificado + pedido simples), onde UMA leitura extra e declarada.
    function nomesInseguros(req) {
      var s = [];
      req.headers.forEach(function (v, n) { n = String(n).toLowerCase(); if (SAFELIST_CORS[n] === 1 && valorSafelisted(n, String(v))) return; if (s.indexOf(n) === -1) s.push(n); });
      return s;
    }
    function cabecalhosAutorizados(req, env) {
      var ok = env.preflightCabecalhos; if (!ok || typeof ok.length !== 'number') return false;
      var nomes = nomesInseguros(req);
      for (var i = 0; i < nomes.length; i += 1) if (ok.indexOf(nomes[i]) === -1) return false;
      return true;
    }
    function precisaPreflight(req, corpoEhFluxo) {
      var m = req.method;
      if (m !== 'GET' && m !== 'HEAD' && m !== 'POST') return true;
      var precisa = false;
      req.headers.forEach(function (v, n) { if (precisa) return; n = String(n).toLowerCase(); if (SAFELIST_CORS[n] === 1) { if (!valorSafelisted(n, String(v))) precisa = true; } else precisa = true; });
      if (precisa) return true;
      return corpoEhFluxo();
    }
    var LER_CORPO = (typeof Request !== 'undefined' && Object.getOwnPropertyDescriptor(Request.prototype, 'body')) || null;
    // Marca INTRINSECA de ReadableStream (Astra B102): instanceof falha para um fluxo de
    // outro realm (iframe same-origin) que o construtor nativo aceita. O getter de locked
    // capturado aqui checa o slot interno sem consumir nada; objeto alheio lanca.
    var LER_TRAVADO = (typeof ReadableStream !== 'undefined' && Object.getOwnPropertyDescriptor(ReadableStream.prototype, 'locked')) || null;
    function ehFluxo(v) {
      if (v === null || (typeof v !== 'object' && typeof v !== 'function')) return false;
      if (LER_TRAVADO && LER_TRAVADO.get) { try { LER_TRAVADO.get.call(v); return true; } catch (e) { return false; } }
      return typeof ReadableStream !== 'undefined' && v instanceof ReadableStream;
    }
    function corpoDoRequest(rq) { try { return LER_CORPO && LER_CORPO.get ? LER_CORPO.get.call(rq) : rq.body; } catch (e) { return rq.body; } }
    window.fetch = function (entrada, init) {
      // Proveniencia do corpo ANOTADA na mesma conversao de argumentos que constroi o
      // Request (Astra B99): o construtor nativo segue o UNICO leitor de init.body, UMA
      // vez — um Proxy transparente so anota o valor que ele leu. Reler o init do
      // chamador depois era TOCTOU: init.body = '' logo apos a chamada furava a guarda.
      // Corpo SUBSTITUIDO so quando o construtor leu init.body NAO-NULO (B98); senao
      // HERDA o do Request de entrada — fonte inobservavel => fluxo (conservador).
      var abortadoNaEntrada = true;   // ate o Request existir, nada foi despachado
      var corpoEmFluxo = false;
      var corpoLido = { houve: false, valor: null };
      var initConstrutor = init;
      // Objeto OU funcao (Astra B100): um dicionario WebIDL aceita qualquer objeto, e uma
      // funcao com propriedades e um init valido — sem o Proxy a proveniencia nao era anotada.
      if (init !== null && (typeof init === 'object' || typeof init === 'function') && typeof Proxy === 'function') {
        initConstrutor = new Proxy(init, { get: function (alvo, prop) { var v = Reflect.get(alvo, prop, alvo); if (prop === 'body') { corpoLido.houve = true; corpoLido.valor = v; } return v; } });
      }
      var corpoEhFluxo = function () { return corpoEmFluxo; };
      var args = arguments, self = this;
      // O passthrough e chamado NO MAXIMO UMA VEZ, e sua rejeicao nunca e capturada
      // por este remendo: a falha de rede e do site, e tem que chegar ao site como
      // chegaria sem nos. A 1a versao envolvia tudo num catch — uma chamada NAO
      // mapeada que falhava na rede disparava um SEGUNDO passthrough (sonda do
      // Astra: n=2), e para um POST que alcance servidor real isso e envio duplo.
      // Corpo em FLUXO no init (Astra B10/B11): o hash o consumiria e o passthrough
      // entregaria ao fetch nativo um fluxo ja perturbado. Um tee() MANUAL antes de
      // validar transformava um corpo INVALIDO (lido em parte e destravado) num POST
      // truncado valido (B11). Ordem certa: o Request NATIVO valida o corpo primeiro
      // (fluxo perturbado => TypeError => o fetch nativo tambem rejeita, nada e
      // enviado); so entao clone() preserva um ramo para a rede.
      var reqRede = null;
      var req;
      var leitorCorpo = null;
      var desistiu = false;   // teto da identidade estourou: parar de ler e soltar o que se guardou
      // Solta o ramo do HASH: pelo leitor, se ja existe; senao pelo proprio corpo do
      // Request (retornos antecipados — multipart, mode same-origin — acontecem antes
      // de qualquer leitor, e deixavam o produtor correndo: Astra B24).
      // Soltura do corpo (Astra B21–B25). Antes de qualquer tee, o corpo e UM fluxo:
      // soltarCorpo o cancela direto — vale para stream do chamador, stream herdado de
      // um Request de entrada e stream vindo de getter, sem reler opcao nenhuma. Depois
      // do tee, cada ramo tem a sua soltura; a fonte so recebe cancel() quando os dois
      // forem soltos.
      var soltarCorpo = function (razao) { if (req && req.body && !req.body.locked) { try { req.body.cancel(razao).then(null, function () {}); } catch (e) {} } };
      var soltarLeitura = function (razao) {
        if (reqRede === req) return;   // sem ramo de hash (multipart): o corpo E o da rede
        if (leitorCorpo) { try { leitorCorpo.cancel(razao).then(null, function () {}); } catch (e) {} return; }
        soltarCorpo(razao);
      };
      var soltarRamoDaRede = function (razao) {
        if (!reqRede || !reqRede.body || reqRede.body.locked) return;
        try { reqRede.body.cancel(razao).then(null, function () {}); } catch (e) {}
      };
      var cancelarRamos = function () { var razao = razaoDeAbort(req); soltarLeitura(razao); soltarRamoDaRede(razao); };
      var promessaPassthrough = null;
      // A rede SO recebe o Request construido e clonado — nunca os argumentos do
      // chamador (Astra B13/B14/B15: init mutavel, getters, releituras).
      var passthrough = function () {
        // Corpo que nao coube nos limites (teto de bytes/tempo) ja foi consumido em
        // parte e nao pode ir a rede: rejeita. Limite declarado — o gateway nao recebe
        // uploads por fetch (vao pelo host) e o externo mutavel ja falha fechado.
        if (!reqRede || desistiu) return Promise.reject(new TypeError('Failed to fetch'));
        if (!promessaPassthrough) promessaPassthrough = fOriginal.call(self, reqRede);
        return promessaPassthrough;
      };
      var mutavel = true, externa = true;   // ate o Request ser construido, nada e seguro
      var proveniente = false;              // URL local de asset vindo de outra origem (_ext/)
      // FALHA FECHADA para metodo mutavel a OUTRA origem (Astra B2 #1): um miss NAO
      // pode virar POST real no servidor original — CORS impede LER a resposta, nao
      // ENVIAR o pedido. O clone e offline; a chamada falha como falharia sem rede.
      // Ao rejeitar SEM rede, o ramo da rede tambem e solto (Astra B23): ninguem mais o
      // consumiria e ele seguiria acumulando o upload. So o passthrough o preserva.
      var semRede = function () {
        // Chegou-se a uma decisao de miss: o ramo do hash nunca mais e necessario.
        soltarLeitura();
        if (mutavel && externa) { soltarRamoDaRede(); return falhaOffline(); }
        // Miss num caminho de asset vindo de fetch: a copia estatica seria a resposta
        // de OUTRO pedido (Astra B55). Rejeita.
        if (req && caminhoDeFetch(req.url)) { soltarRamoDaRede(); return falhaOffline(); }
        // NEGOCIACAO (Astra B143): um miss servido do pacote recebe o arquivo estatico capturado
        // pelo markup — certo para o fetch simples da mesma URL (icone, dado de hover: a captura
        // nao passa o mouse, entao esses fetches nunca tem envelope). Com cabecalho do script
        // (Accept: application/json...) o servidor podia devolver OUTRA representacao: recusa.
        // Modo/credenciais nao entram: nao mudam a representacao, e cookie/sessao esta fora do
        // escopo (decisao de 2026-09-30: a copia serve layout, links internos e hover).
        // QUERY (Astra B146): o gateway serve pelo caminho e ignora a query — "visual?format=json"
        // recebia o arquivo de "visual". A URL local reescrita nao carrega query; uma query
        // montada pelo script em tempo de execucao e OUTRO pedido (como no B45): recusa.
        if (req && !proveniente && (req.method === 'GET' || req.method === 'HEAD')) {
          var comQuery = String(req.url).split('#')[0].indexOf('?') !== -1;
          if (comQuery || cabecalhosDeIdentidade(req.headers) !== '') {   // proveniencia vai a URL original, nao ao pacote
            var sv = restoServido(req.url);
            if (sv && sv.resto !== null) { soltarRamoDaRede(); return falhaOffline(); }
          }
        }
        return passthrough();
      };
      // Cancelamento reconhecido pelo ESTADO do sinal, nao pelo nome do erro.
      // Corpo INVALIDO (chunk que nao e Uint8Array — Astra B27): o fetch nativo rejeita
      // ao consumir; aqui rejeita igual, solta os dois ramos e NAO consome ocorrencia.
      var corpoInvalido = null;
      var integridadeFalhou = null;
      var missOuAbort = function (e) { if (abortado(req)) throw razaoDeAbort(req); if (ehAbort(e)) throw e; if (corpoInvalido) throw corpoInvalido; if (integridadeFalhou) throw integridadeFalhou; return semRede(); };
      // NENHUMA leitura previa das opcoes do chamador (Astra B14/B15): um init com
      // getters respondia uma coisa a classificacao e outra a rede. O construtor nativo
      // e o UNICO leitor, UMA vez; dele saem o ramo do hash (req) e o da rede (clone).
      // Como no fetch nativo, um Request de entrada tem o corpo consumido pela chamada.
      try {
        req = new Request(entrada, initConstrutor);
        abortadoNaEntrada = abortado(req);
        // Corpo HERDADO decidido no Request recem-construido, pelo getter INTRINSECO de
        // body (Astra B101): entrada.body era propriedade sombreavel — um Request valido
        // com body redefinido como null escondia o fluxo que o construtor herdou. O objeto
        // novo nao tem sombra e o getter e o do prototipo.
        corpoEmFluxo = (corpoLido.houve && corpoLido.valor != null)
          ? ehFluxo(corpoLido.valor)
          : corpoDoRequest(req) !== null;
        // Classificacao pelo Request CONSTRUIDO (Astra B12): o navegador resolve '/api'
        // contra o <base href> do documento; com um <base> cross-origin, '/api' e um
        // POST EXTERNO. O passthrough recebe o clone (URL congelada).
        mutavel = !(req.method === 'GET' || req.method === 'HEAD');
        // Proveniencia externa conta como EXTERNA (Astra B41): a copia local nunca
        // responde a um fetch que ao vivo era cross-origin.
        proveniente = provenienciaExterna(req.url);
        externa = !mesmaOrigem(req.url) || proveniente;
        // Rejeicao pre-despacho so quando alheia NOS DOIS lados: fisicamente no clone E na
        // fonte (Astra B77). Relativa/reservada = mesma origem fisica, despacha; absoluta da
        // fonte = alheia fisica mas propria na fonte, replaya a ocorrencia que a captura viu.
        var rejeitaPreDespacho = externa && alheiaNaFonte(req.url);
        // Decisoes ANTECIPADAS logo apos a construcao, ANTES de qualquer tee (Astra
        // B25): o corpo ainda e um fluxo so, e cancela-lo aqui para o produtor seja
        // ele do chamador, herdado de um Request ou vindo de getter.
        // MODO (Astra B16): 'same-origin' para outra origem falha no fetch nativo ANTES
        // de qualquer rede — nenhum pedido, nenhuma ocorrencia. Rejeita igual.
        if (rejeitaPreDespacho && req.mode === 'same-origin') { soltarCorpo(new TypeError('Failed to fetch')); return Promise.reject(new TypeError('Failed to fetch')); }
        // Cache SO-SE-EM-CACHE (Astra B123): o envelope nao e cache HTTP — a resposta pode ter sido
        // no-store, e o cache do navegador na fonte estaria vazio. Rejeita como cache vazio,
        // ANTES de alocar (nao consome a ocorrencia do pedido normal seguinte).
        if (req.cache === 'only-if-cached') { soltarCorpo(new TypeError('Failed to fetch')); return Promise.reject(new TypeError('Failed to fetch')); }
        // 'no-cors' com redirect != 'follow' para outra origem (Astra B75): o Chromium
        // rejeita ANTES de criar pedido algum (medido: zero eventos de request, zero hits)
        // — e a captura nem anuncia. Rejeitar aqui, antes de alocar ocorrencia, senao a
        // chamada consumiria o envelope da chamada legitima seguinte.
        if (rejeitaPreDespacho && req.mode === 'no-cors' && req.redirect !== 'follow') { soltarCorpo(new TypeError('Failed to fetch')); return Promise.reject(new TypeError('Failed to fetch')); }
        // FormData/multipart nunca bate (fronteira aleatoria): miss por construcao, sem
        // hash e sem tee — externo mutavel falha fechado e solta o corpo; senao passa
        // com o proprio Request.
        if (/multipart\\/form-data/i.test(req.headers.get('content-type') || '')) {
          // Atalho do multipart respeita a proveniencia (Astra B42) E passa pela lane de
          // miss (Astra B56): e la que vivem o fail-closed do externo mutavel e a guarda
          // dos assets vindos de fetch — voltar direto ao passthrough os contornava.
          reqRede = proveniente ? requestDoSnapshot(new Uint8Array(0)) : req;
          return semRede();
        }
        // SEM TEE (Astra B32): o tee de um fluxo de bytes COPIA cada chunk antes de
        // qualquer guarda nossa — um chunk de 64 MiB ja custava 64 MiB nativos. O corpo
        // e lido UMA vez, com as guardas, do fluxo unico; a rede recebe um Request
        // reconstruido do SNAPSHOT limitado. Sem corpo, a rede recebe o proprio req.
        // Sem corpo, a rede recebe o proprio req — salvo proveniencia externa, em que
        // a rede recebe a URL de PROVENIENCIA (nunca o arquivo local).
        reqRede = req.body ? null : (proveniente ? requestDoSnapshot(new Uint8Array(0)) : req);
      } catch (e) {
        // Falha de construcao REJEITA, como o fetch nativo rejeitaria a mesma entrada
        // (Astra B14). Reexecutar os argumentos do chamador permitia que um init com
        // getters entregasse a rede um POST externo que a validacao nativa recusava.
        return Promise.reject(e);
      }
      // Enfileirado: a alocacao vezes[id] acontece na ORDEM DE CHAMADA, porque cada
      // passo so comeca quando o anterior terminou de calcular a sua identidade.
      // O hash comeca JA (em paralelo); a fila so ordena a alocacao. Identidade que nao
      // chega no teto, ou pedido abortado, e miss — e a fila segue. Residual: uma
      // chamada assim pulada nao consome ocorrencia; uma posterior de mesma identidade
      // pode receber a que seria dela.
      // Leitor EXPLICITO do corpo (Astra B21): req.arrayBuffer() seguia consumindo o
      // fluxo depois do abort, e o ramo da rede (clone) tambem nao era cancelado — um
      // produtor sem fim acumularia bytes ate esgotar a memoria da aba. No abort os
      // DOIS ramos do tee sao cancelados (so entao a fonte recebe cancel()).
      // O sinal EFETIVO e o do Request construido (funde init.signal e o sinal de um
      // Request de entrada) — Astra B5 #1. Declarado AQUI, antes do leitor e do ouvinte
      // (Astra B22): declarado depois, o hoisting fazia o ouvinte de limpeza ver
      // undefined e nunca ser ligado — a cancelacao dependia de chegar outro chunk.
      var sinal = req.signal;
      // Um produtor cujo pull() enfileira de forma SINCRONA mantem este laco so em
      // microtarefas: o setTimeout do teto nunca corre (Astra B26). Por isso o laco
      // aplica ele mesmo o prazo (relogio), um teto de bytes e cede a fila de tarefas
      // periodicamente — e um limite atingido cai na MESMA limpeza do miss.
      var MAX_CORPO_HASH = 8 * 1024 * 1024;
      var inicioLeitura = Date.now();
      function lerCorpo() {
        if (!req.body) return Promise.resolve(new Uint8Array(0));
        leitorCorpo = req.body.getReader();
        var partes = [], total = 0, pedacos = 0;
        function desistir(motivo) { desistiu = true; partes.length = 0; soltarLeitura(new TypeError(motivo)); return Promise.reject(new TypeError(motivo)); }
        function passo() {
          if (abortado(req)) { cancelarRamos(); return Promise.reject(razaoDeAbort(req)); }
          if (desistiu) { partes.length = 0; return Promise.reject(new TypeError('identidade nao calculada no teto')); }
          if (Date.now() - inicioLeitura > TETO_IDENTIDADE_MS) return desistir('identidade nao calculada no teto');
          if (total > MAX_CORPO_HASH) return desistir('corpo grande demais para identidade');
          return leitorCorpo.read().then(function (x) {
            // Teto/abort e TERMINAL (Astra B33): cancelar o leitor faz a leitura pendente
            // resolver como EOF, e o ramo done concatenava o corpo PARCIAL e publicava um
            // snapshot truncado que o miss same-origin encaminhava.
            if (abortado(req)) { cancelarRamos(); return Promise.reject(razaoDeAbort(req)); }
            if (desistiu) { partes.length = 0; return Promise.reject(new TypeError('identidade nao calculada no teto')); }
            if (x.done) {
              var tudo = new Uint8Array(total), pos = 0;
              for (var i = 0; i < partes.length; i++) { tudo.set(partes[i], pos); pos += bytesDe(partes[i]); }
              return tudo;
            }
            if (!ehUint8(x.value)) {
              corpoInvalido = new TypeError('Received non-Uint8Array chunk');
              partes.length = 0; soltarLeitura(corpoInvalido); soltarRamoDaRede(corpoInvalido);
              return Promise.reject(corpoInvalido);
            }
            // COPIA imediata (Astra B30): guardar a referencia deixava o produtor mutar
            // o buffer entre leituras e o hash sair de OUTRO corpo. O Fetch copia cada
            // chunk ao le-lo; aqui tambem — e so as copias entram em partes.
            var n = bytesDe(x.value);
            // Teto checado ANTES de alocar a copia (Astra B31): um unico chunk de 64 MiB
            // alocava 64 MiB dentro do remendo apesar do limite de 8 MiB.
            if (n > MAX_CORPO_HASH - total) return desistir('corpo grande demais para identidade');
            var copia = new Uint8Array(n); copia.set(x.value);
            partes.push(copia); total += n; pedacos += 1;
            // Cede a fila de TAREFAS a cada 64 pedacos: da vez ao temporizador e a pagina.
            if (pedacos % 64 === 0) return new Promise(function (res) { setTimeout(res, 0); }).then(passo);
            return passo();
          });
        }
        return passo();
      }
      if (sinal && typeof sinal.addEventListener === 'function') sinal.addEventListener('abort', cancelarRamos);
      function requestDoSnapshot(corpo) {
        var opts = {
          // Corpo presente segue presente MESMO vazio (Astra B134): null tirava o Content-Length 0.
          method: req.method, headers: req.headers, body: (req.body !== null && req.body !== undefined) ? corpo : null,
          mode: req.mode, credentials: req.credentials, cache: req.cache, redirect: req.redirect,
          referrer: req.referrer, referrerPolicy: req.referrerPolicy, integrity: req.integrity,
          keepalive: req.keepalive, signal: req.signal,
        };
        var urlRede = proveniente ? urlDeProveniencia(req.url) : req.url;
        try { return new Request(urlRede, opts); }
        catch (e) { delete opts.mode; return new Request(urlRede, opts); }   // 'navigate' e afins nao sao construiveis
      }
      var identidadePronta = lerCorpo().then(function (corpo) {
        if (desistiu || abortado(req)) return null;   // nunca publicar snapshot depois de desistir
        // KEEPALIVE (Astra B109): corpo acima do orcamento de 64 KiB e erro de rede nativo —
        // rejeita ANTES de alocar ocorrencia (o marcador de corpo invalido nunca aloca).
        // Residual declarado: a soma com OUTROS keepalive em voo nao e contabilizada.
        if (req.keepalive && corpo && corpo.byteLength > 65536) { corpoInvalido = new TypeError('Failed to fetch'); return null; }
        if (req.body) { try { reqRede = requestDoSnapshot(corpo); } catch (e) { reqRede = null; } }
        return identidade(req, corpo);
      }).then(function (id) { return id; }, function () { return null; });
      var teveTeto = false;
      var comTeto = new Promise(function (res) {
        var t = setTimeout(function () {
          // Teto (Astra B23): parar a leitura e soltar os pedacos guardados — o hash
          // nao vai acontecer; o ramo da rede e decidido por semRede().
          teveTeto = true;
          desistiu = true; soltarLeitura(new TypeError('identidade nao calculada no teto'));
          res(null);
        }, TETO_IDENTIDADE_MS);
        identidadePronta.then(function (id) { clearTimeout(t); res(id); });
        if (sinal && typeof sinal.addEventListener === 'function') {
          if (sinal.aborted) { clearTimeout(t); res(null); }
          else sinal.addEventListener('abort', function () { clearTimeout(t); res(null); });
        }
      });
      // Documento da CHAMADA, lido agora (Astra B132): so importa com referrer default e politica
      // que envia algo; referrer explicito ja esta na identidade.
      var docDaChamada = (req.referrer === 'about:client' && req.referrerPolicy !== 'no-referrer')
        ? subtle.digest('SHA-256', enc.encode(documentoAtual())).then(hex) : Promise.resolve(null);
      docDaChamada.catch(function () {});
      // Politica herdada do documento (Astra B136): vale para QUALQUER referrer nao vazio —
      // inclusive o explicito — quando o pedido nao traz politica propria. Lida agora.
      var polDaChamada = (req.referrerPolicy === '' && req.referrer !== '') ? politicaDoDocumento() : null;
      var minhaVez = fila.then(function () { return comTeto; }).then(function (id) {
        // Abortado ate aqui: rejeita e NAO consome ocorrencia. Se foi DEPOIS da entrada, a
        // captura pode ou nao ter guardado vaga para ele (depende de o abort ter chegado antes
        // ou depois do envio — inobservavel no replay): consumir ou pular podem ambos deslocar a
        // lista, entao o grupo (metodo, URL) sai do replay (Astra B125). O mesmo vale para o
        // teto da identidade: sem identidade, a ocorrencia deste pedido nao tem dono.
        if (abortado(req)) {
          if (abortadoNaEntrada) throw razaoDeAbort(req);
          return desalinhar(req).then(function () { throw razaoDeAbort(req); });
        }
        if (corpoInvalido) throw corpoInvalido;   // idem: corpo invalido nunca aloca
        if (!id) { if (teveTeto) return desalinhar(req).then(function () { return null; }); return null; }
        // Corpo em FLUXO nunca recebe envelope (Astra B141): a captura nunca guarda upload em
        // fluxo (o grupo inteiro sai), e o navegador trata fluxo e corpo pronto como pedidos
        // DIFERENTES — recusa no HTTP/1.x, manda sem Content-Length no h2. Com os mesmos bytes o
        // fluxo casava o envelope de um corpo pronto. Lido com todas as guardas (abort, chunk
        // invalido, teto), mas miss SEM consumir: a ocorrencia fica para o corpo pronto.
        if (corpoEmFluxo) return null;
        return Promise.all([grupoDesalinhado(req), docDaChamada]).then(function (par) {
          var fora = par[0]; var doc = par[1];
          if (fora) return null;
          var lista = M[id];
          if (!lista || !lista.length) return null;
          var n = vezes[id] || 0;
          // Documento diferente do da captura (Astra B132): o Referer seria outro — miss SEM
          // consumir; a ocorrencia fica para a chamada do documento certo.
          if (n < lista.length && lista[n] && typeof lista[n].documento === 'string' && doc !== null && lista[n].documento !== doc) return null;
          // Politica desconhecida (Astra B137) nunca casa — nem com '' nem com outra desconhecida.
          if (n < lista.length && lista[n] && typeof lista[n].politica === 'string' && polDaChamada !== null && (polDaChamada === POLITICA_DESCONHECIDA || lista[n].politica !== polDaChamada)) return null;
          vezes[id] = n + 1;
          // Ocorrencias ESGOTADAS = miss (Astra B2 #3); BURACO (null ou marcado) = miss (B3 #4),
          // consumido so pela chamada do documento dele (B133).
          var oc = n < lista.length ? lista[n] : null;
          return oc && oc.perdido ? null : oc;
        });
      });
      fila = minhaVez.then(function () {}, function () {});
      if (abortado(req)) return Promise.reject(razaoDeAbort(req));
      // A promessa do CHAMADOR rejeita no proprio abort (Astra B20): enfileirada atras
      // de um corpo que nao chega, ela esperava o teto do outro (ate 15 s) para
      // rejeitar. A alocacao continua serializada e ainda checa o abort antes de
      // consumir ocorrencia; a cadeia que segue em fundo tem handler proprio.
      var abortouCedo = new Promise(function (_, rej) {
        if (!sinal || typeof sinal.addEventListener !== 'function') return;
        if (sinal.aborted) rej(razaoDeAbort(req));
        else sinal.addEventListener('abort', function () { rej(razaoDeAbort(req)); });
      });
      abortouCedo.then(null, function () {});
      var resultado = minhaVez.then(function (env) {
        if (!env) return semRede();
        // 'no-cors' para outra origem (Astra B16): o fetch nativo devolve resposta OPACA
        // (status 0, sem cabecalhos, corpo nulo), que nao e construivel. A ocorrencia
        // ja foi consumida (a chamada existiu na captura); o envelope legivel NUNCA e
        // entregue — a chamada segue pelo miss (GET: o fetch nativo faz o no-cors real e
        // devolve o opaco; mutavel: falha fechada).
        // Decide pela origem que a CAPTURA viu (env.externo), nao pela fisica do clone (Astra
        // B77): a URL absoluta da fonte era same-origin la — resposta basica, legivel.
        if (env.externo && req.mode === 'no-cors') return semRede();
        if (env.opaco) return semRede();
        // Raiz same-origin cuja cadeia CRUZOU origem (Astra B18): no-cors => opaco ao vivo
        // (miss aqui); same-origin => o nativo falha na rede (rejeita aqui).
        if (env.cruzouOrigem && req.mode === 'no-cors') return semRede();
        if (env.cruzouOrigem && req.mode === 'same-origin') return Promise.reject(new TypeError('Failed to fetch'));
        // POLITICA DE REDIRECT (Astra B37): envelope de redirect seguido so serve a
        // 'follow'; 'error' rejeita como o nativo; 'manual' (opaqueredirect, nao
        // construivel) vai pelo miss declarado.
        if (env.redirecionou && req.redirect === 'error') return Promise.reject(new TypeError('Failed to fetch'));
        if (env.redirecionou && req.redirect === 'manual') return semRede();
        if (env.redirectRejeitaFluxo && corpoEhFluxo()) return Promise.reject(new TypeError('Failed to fetch'));
        // CORS CREDENCIADO (Astra B38): envelope cross-origin capturado sem origem
        // explicita + Allow-Credentials nao pode servir a credentials:'include' — o
        // nativo rejeita mesmo sem cookie nenhum.
        if (env.externo && req.credentials === 'include' && !env.corsCredenciado) return Promise.reject(new TypeError('Failed to fetch'));
        // O pedido do REPLAY exige preflight (Astra B97/B103): em modo cors e externo, so com
        // preflight verificado na captura — e, com include, verificado COM credenciais.
        if (env.externo && req.mode === 'cors' && precisaPreflight(req, corpoEhFluxo)) {
          if (!env.preflightVerificado && !env.preflightCredenciado) return Promise.reject(new TypeError('Failed to fetch'));
          if (!cabecalhosAutorizados(req, env)) return Promise.reject(new TypeError('Failed to fetch'));
          if (req.credentials === 'include' && !env.preflightCredenciado) return Promise.reject(new TypeError('Failed to fetch'));
        }
        // O sinal do site alcanca a busca do envelope LOCAL: um abort durante uma
        // leitura parada nao pode deixar a promessa pendente para sempre.
        var initLocal = { cache: 'no-store' };
        if (sinal) initLocal.signal = sinal;
        return fOriginal.call(window, local(env.path), initLocal).then(function (r) {
          // O arquivo local tem que ser o envelope — nao um 404, nem o index.html de
          // fallback de uma SPA embrulhado como corpo (Astra B2 #5).
          if (!r.ok) throw new TypeError('envelope ausente');
          return r.arrayBuffer();
        }).then(function (buf) {
          if (abortado(req)) throw razaoDeAbort(req);
          if (typeof env.bytes === 'number' && buf.byteLength !== env.bytes) throw new TypeError('envelope com tamanho errado');
          // HIT confirmado: o ramo da rede nao sera usado — solta-o para parar de
          // acumular o corpo do pedido em memoria.
          if (reqRede && reqRede.body && !reqRede.body.locked) { try { reqRede.body.cancel().then(null, function () {}); } catch (e) {} }
          var corpo = buf;
          if (env.resolveMarcador) {
            // So o envelope que FOI reescrito: o marcador vira a origem REAL de onde o
            // clone esta sendo servido, e a URL continua absoluta http(s).
            // …a RAIZ do pacote, nao a origem: sob o gateway os assets vivem em
            // /api/runtime/<token>/media/…, nao em /media/… (Astra B3 #6).
            corpo = new TextDecoder().decode(buf).split(MARCADOR).join(RAIZ_SEM_BARRA);
          }
          // Integridade sobre os bytes FINAIS entregues (ja com o marcador resolvido).
          var bytesFinais = typeof corpo === 'string' ? enc.encode(corpo) : new Uint8Array(corpo);
          return verificarIntegridade(req.integrity, bytesFinais).then(function (ok) {
            if (!ok) { integridadeFalhou = new TypeError('integrity mismatch'); throw integridadeFalhou; }
            return montarResposta(bytesFinais);
          });
        }).then(null, missOuAbort);   // falha do replay local = miss; abort/invalido/integridade = rejeicao
        function montarResposta(bytes) {
          // Status sem corpo exigem body null, senao new Response lanca (Astra B2 #5).
          var semCorpo = env.status === 204 || env.status === 205 || env.status === 304 || req.method === 'HEAD';
          // O corpo e entregue por um fluxo que consulta o sinal ao ser LIDO: abort
          // depois da resposta faz .text() rejeitar, como no Fetch nativo.
          // Cancelamento DIRIGIDO A EVENTO (Astra B7 #1): so checar no pull nao basta —
          // clone() faz tee, e o tee de um fluxo padrao puxa na hora (o pull fechava a
          // fonte antes do abort); e um leitor ocioso nunca chama pull. Fluxo de BYTES
          // (o tee de bytes nao puxa antes da leitura) + highWaterMark 0 (sem ele o
          // pull corre na construcao) + ouvinte de abort que erra o controlador.
          var fluxo = null;
          if (!semCorpo) {
            var errar = null;
            fluxo = new ReadableStream({
              type: 'bytes',
              start: function (c) {
                errar = function () { try { c.error(razaoDeAbort(req)); } catch (e) {} };
                if (sinal && typeof sinal.addEventListener === 'function') sinal.addEventListener('abort', errar);
                if (abortado(req)) errar();
              },
              pull: function (c) {
                if (abortado(req)) { errar(); return; }
                // Fluxo de bytes recusa enqueue de comprimento ZERO (Astra B8 #1): um 200
                // vazio nao enfileira nada, so fecha — e um pedido BYOB pendente termina
                // com respond(0) DEPOIS do close, senao a leitura fica pendurada.
                if (bytes.length) c.enqueue(bytes.slice());
                c.close();
                if (c.byobRequest) { try { c.byobRequest.respond(0); } catch (e) {} }
                // O ouvinte de abort FICA (Astra B8 #2): apos close() ainda pode haver bytes
                // na fila (leitura BYOB parcial), e o abort tem que erra-los. Um error()
                // sobre fluxo ja drenado lanca e e engolido no errar().
              },
              cancel: function () { if (sinal && typeof sinal.removeEventListener === 'function') sinal.removeEventListener('abort', errar); },
            }, { highWaterMark: 0 });
          }
          return new Response(fluxo, { status: env.status, statusText: env.statusText || '', headers: env.headers || {} });
        }
      }, missOuAbort);            // falha na fase de IDENTIDADE: idem; abort = abort
      resultado.then(null, function () {});   // a corrida ja entrega a rejeicao ao chamador
      return Promise.race([resultado, abortouCedo]);
    };
  }
  // XHR: declaradamente FORA (Astra B2 #4). Trocar a URL em open() entregava status e
  // cabecalhos do servidor estatico e o corpo cru — nao era replay. Um XHR sai e e
  // bloqueado, como sem o remendo. Replay de XHR exige um proxy completo do objeto.
})();</script>`;
}
