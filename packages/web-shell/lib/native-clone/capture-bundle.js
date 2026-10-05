/**
 * PRODUTOR DE CLONE NATIVO — a peça que faltava.
 *
 * O plano da frente (2026-07-26, l.332) pedia: "Extend deferred reconstruction
 * with an explicit native result kind. Keep the current Iter9 result path
 * unchanged." O lado que RECEBE foi construído (`register-bundle.js`,
 * `bundle-store.js`, a rota `/api/native-clone`); o lado que PRODUZ nunca foi.
 * Sem ele, `reconstructSiteNode` só tem `reconstructPage`, que devolve HTML de
 * visão — e esse HTML **descarta o movimento** (medido: zero ocorrências de
 * gsap/@keyframes/animation na saída).
 *
 * Este produtor faz o oposto do iter9: em vez de reconstruir a aparência por
 * visão, ele **preserva o site** — baixa cada recurso que a página pediu,
 * reescreve as referências para caminhos do bundle e mantém os scripts vivos.
 * É o mesmo princípio do clone que já provou fidelidade neste projeto
 * (`Clone/`, SSIM 0,96, altura exata, 369 assets).
 *
 * O que ele NÃO faz, e não finge fazer: não grava vídeo de referência, não
 * documenta inventário de animação e não roda QA offline. Essas três etapas da
 * receita original continuam fora. Aqui está a base — a página independente do
 * domínio, com o runtime do site preservado, no formato que o editor consome.
 */
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { chromium as chromiumPadrao } from 'playwright-core';
import { measureBundleSimilarity } from '../clone-similarity.js';
import { ChallengeRequiredError, detectChallengePage } from '../snapshot.js';
import { criarContabilidade } from './byte-ledger.js';
import { parseContentRange } from './byte-range.js';
import { referenceKindFor, rewriteDocumentReferences } from './rewrite-references.js';
import { montarReplay, runtimeFetchShim } from './runtime-fetch-map.js';
import { leadingDoctypeEnd } from './doctype-anchor.js';

/**
 * SSRF — o produtor GRAVA o corpo de cada resposta num bundle que o usuário vê.
 * Sem este bloqueio, uma página pública pode pedir `169.254.169.254` ou um
 * serviço interno e o conteúdo sai do outro lado. É diferente de só buscar a
 * URL: aqui há EXFILTRAÇÃO. Achado P0 do Sol.
 */
const FAIXAS_PROIBIDAS = [
  /^127\./, /^10\./, /^169\.254\./, /^192\.168\./, /^0\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];
function ipEhPrivado(ip) {
  if (!ip) return true;
  if (isIP(ip) === 6) {
    const n = ip.toLowerCase();
    return n === '::1' || n === '::' || n.startsWith('fc') || n.startsWith('fd')
      || n.startsWith('fe80') || n.startsWith('::ffff:127.') || n.startsWith('::ffff:10.')
      || n.startsWith('::ffff:169.254.') || n.startsWith('::ffff:192.168.');
  }
  return FAIXAS_PROIBIDAS.some((r) => r.test(ip));
}
const cacheHost = new Map();
export async function hostEhPublico(hostname) {
  if (cacheHost.has(hostname)) return cacheHost.get(hostname);
  let ok = false;
  try {
    if (isIP(hostname)) ok = !ipEhPrivado(hostname);
    else {
      const enderecos = await lookup(hostname, { all: true });
      // TODOS precisam ser públicos: um nome que resolve para público E privado
      // é o vetor clássico de rebind.
      ok = enderecos.length > 0 && enderecos.every((e) => !ipEhPrivado(e.address));
    }
  } catch (_) { ok = false; }
  cacheHost.set(hostname, ok);
  return ok;
}

/**
 * Mesma política de navegador do caminho de captura já existente: usa o
 * Browserbase quando há chave, senão um Chromium local. Sem isto o produtor
 * funcionaria no laboratório e falharia no servidor, que é o modo de falha que
 * separou o editor do produto até agora.
 */
async function abrirNavegador(launcher) {
  const chromium = launcher || chromiumPadrao;
  if (!launcher && process.env.BROWSERBASE_API_KEY) {
    return chromium.connectOverCDP(`wss://connect.browserbase.com?apiKey=${encodeURIComponent(process.env.BROWSERBASE_API_KEY)}`);
  }
  return chromium.launch({ headless: true });
}

const MAX_ASSETS = 1200;
const MAX_BYTES_TOTAL = 220 * 1024 * 1024;
const MAX_ASSET_BYTES = 40 * 1024 * 1024;
// Tetos da SEGUNDA tentativa. Ela existe para recuperar o caso comum (a
// resposta não chegou naquela passagem), não para virar um segundo download da
// internet inteira.
const RETRY_MAX_ARQUIVOS = 120;
const RETRY_CONCORRENCIA = 6;
const RETRY_MAX_SALTOS = 3;
const RETRY_ORCAMENTO_BYTES = 60 * 1024 * 1024;
// Página com altura absurda mantinha o navegador rolando por horas (P0 do Sol).
const MAX_ALTURA_PX = 120000;
// Teto da espera pelos corpos em voo na etapa 'collecting' (ver lá). Bem
// abaixo do prazo de 90s da rota; corpos já recebidos resolvem na hora. O env
// existe para o teste de corrida (resposta tardia × repescagem) rodar em
// segundos; fora de teste fica o padrão.
const COLETA_TETO_MS = Math.max(200, Number(process.env.UNCRAFT_CAPTURE_COLLECT_CAP_MS) || 20_000);
// Quanto tempo uma interstitial de challenge tem para se limpar sozinha antes
// de ser recusada (ver o detector na captura).
const CHALLENGE_TOLERANCIA_MS = 5_000;

const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const hexSha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// ⭐ IDENTIDADE DE REQUISIÇÃO para replay (2026-09-29). A lição do gsap.com: a
// chamada de runtime é POST com corpo GraphQL, e um mapa por URL não pode
// representá-la (a mesma URL com outro corpo devolve outra coisa). A identidade é
// método + URL + hash do corpo, e a MESMA fórmula roda no navegador (SubtleCrypto)
// — qualquer divergência entre os dois lados vira "não encontrado", nunca replay
// errado. Cabeçalhos que carregam segredo ou são de transporte ficam de fora.
// ⚠️ FALSO MATCH existia (Astra B2 #2): método + URL + corpo NÃO identificam uma
// resposta HTTP — a mesma chamada com `Authorization`, `Content-Type` ou `X-Tenant`
// diferentes recebe respostas diferentes e colidia no mesmo id. Entram na identidade
// os cabeçalhos que o SCRIPT pode ter posto e que os dois lados enxergam igual:
// `content-type`, `authorization` e todo `x-*`. (Os que o NAVEGADOR acrescenta —
// accept, accept-language, cookie, sec-*, origin, referer — o Playwright vê e o
// objeto Request não; incluí-los daria falso MISS, então ficam fora. Resíduo: resposta
// que varia por cookie de sessão cai no mesmo id.)
// E o método só é normalizado para maiúsculas nos que o próprio Fetch normaliza:
// `patch` e `PATCH` são métodos DISTINTOS na plataforma e viravam o mesmo id.
const METODOS_NORMALIZADOS = new Set(['DELETE', 'GET', 'HEAD', 'OPTIONS', 'POST', 'PUT']);
export function metodoCanonico(metodo) {
  const m = String(metodo || 'GET');
  return METODOS_NORMALIZADOS.has(m.toUpperCase()) ? m.toUpperCase() : m;
}
// `accept` entra SÓ quando não é o default do navegador (`*/*`): o script que fixa
// `Accept: text/csv` recebe outra resposta (Astra B3 #7), mas o `*/*` que o navegador
// acrescenta sozinho é invisível ao objeto Request e daria falso miss em tudo.
// REGRA INVERTIDA (Astra B52): TODO cabeçalho que o script pôs entra na identidade —
// um `api-key` diferente é OUTRO pedido. Ficam fora só os que o NAVEGADOR acrescenta
// sozinho (o objeto Request não os vê; incluí-los daria falso miss em tudo) e os que
// o Fetch proíbe ao script (idem). `accept` é o caso especial: entra só quando não é o
// default `*/*`. Resíduo declarado: script que fixa um cabeçalho desta lista
// (accept-language, cache-control…) colide com o default do navegador.
const CABECALHOS_DO_NAVEGADOR = new Set([
  'accept-charset', 'accept-encoding', 'accept-language', 'access-control-request-headers', 'access-control-request-method',
  'cache-control', 'connection', 'content-length', 'cookie', 'cookie2', 'date', 'dnt', 'expect', 'host', 'keep-alive',
  'origin', 'pragma', 'priority', 'purpose', 'referer', 'set-cookie', 'te', 'trailer', 'transfer-encoding', 'upgrade',
  'upgrade-insecure-requests', 'user-agent', 'via',
]);
// So ESPACO HTTP (tab, LF, CR, espaco) e aparado, como o Fetch normaliza (Astra B90):
// `String.prototype.trim` tira tambem NBSP e outros brancos Unicode, e 'A' e 'A\u00a0'
// viravam a MESMA identidade — o servidor pode autentica-los diferente; falso hit.
const APARAR_HTTP = /^[\t\n\r ]+|[\t\n\r ]+$/g;
export function apararHttp(valor) { return String(valor).replace(APARAR_HTTP, ''); }
// TODO cabecalho entra (Astra B128): a identidade vem dos cabecalhos do Request CONSTRUIDO
// (anunciados na captura, `req.headers` no remendo) — so o que o script pos; os defaults do
// navegador nunca aparecem ali. A lista de exclusao descartava cabecalhos EXPLICITOS do
// script (Accept-Language: en e fr colidiam). Os proibidos ao script nem chegam a existir.
// EXCETO os de RASTREIO (revisao Claude, 2026-09-30): Sentry, Datadog, OpenTelemetry e B3
// poem em TODO fetch um id ALEATORIO novo a cada pedido — com eles na identidade nenhum replay
// casava num site com rastreio (e os dados de movimento carregados por fetch sumiam). Nao
// mudam a resposta: so correlacionam o pedido. Lista explicita, espelhada no remendo.
export const CABECALHOS_DE_RASTREIO = new Set(['sentry-trace', 'baggage', 'traceparent', 'tracestate', 'b3', 'x-b3-traceid', 'x-b3-spanid', 'x-b3-parentspanid', 'x-b3-sampled', 'x-b3-flags', 'x-datadog-trace-id', 'x-datadog-parent-id', 'x-datadog-origin', 'x-datadog-sampling-priority', 'x-datadog-tags']);
export function cabecalhoEntraNaIdentidade(nome) { return !CABECALHOS_DE_RASTREIO.has(String(nome || '').toLowerCase()); }
// PREFLIGHT (Astra B93): metodo fora de GET/HEAD/POST ou cabecalho de script fora do
// safelist CORS (accept, accept-language, content-language, content-type com os 3 tipos
// simples) obriga um OPTIONS que o Playwright NAO reporta (medido). A autorizacao de
// CREDENCIAIS do preflight e portanto inobservavel: um envelope capturado em `omit` com
// preflight nao pode servir `include` — so se a propria captura foi `include` (o
// navegador ja fez o preflight credenciado) ou se nao houve preflight.
const SAFELIST_CORS = new Set(['accept', 'accept-language', 'content-language', 'content-type', 'range']);
// `range` e safelisted quando e UM intervalo simples de bytes, sem espaco (Astra B104):
// bytes=N- ou bytes=N-M, com N obrigatorio e M >= N.
const RANGE_SIMPLES = /^bytes=(\d+)-(\d*)$/;
// Comparacao EXATA como decimais normalizados (Astra B110): Number() arredonda acima de 2^53.
function decimalMaiorOuIgual(a, b) { const x = a.replace(/^0+(?=\d)/, ''); const y = b.replace(/^0+(?=\d)/, ''); return x.length !== y.length ? x.length > y.length : x >= y; }
// Chromium recusa do safelist extremos >= INT64_MAX (Astra B114).
const INT64_MAX = '9223372036854775807';
function abaixoDoInt64(s) { return !decimalMaiorOuIgual(s, INT64_MAX); }
function rangeSimples(v) { const m = RANGE_SIMPLES.exec(String(v)); if (!m) return false; if (!abaixoDoInt64(m[1]) || (m[2] !== '' && !abaixoDoInt64(m[2]))) return false; return m[2] === '' || decimalMaiorOuIgual(m[2], m[1]); }
// Restricoes de VALOR do safelist (Fetch, "CORS-safelisted request-header"; Astra B94): mais
// de 128 bytes, ou um byte CORS-inseguro (qualquer byte < 0x20 exceto TAB, " ( ) : < > ? @ [ \ ] { } DEL),
// ou, em accept-language/content-language, qualquer byte fora de [0-9A-Za-z *,-.;=], obriga
// preflight — e o preflight decide as credenciais (B93).
const BYTE_CORS_INSEGURO = /[\x00-\x08\x0A-\x1F"():<>?@[\\\]{}\x7F]/;   // todo byte < 0x20 exceto TAB (Astra B96: 0x0B/0x0C/0x0E/0x0F sobrevivem ao Request)
const LINGUA_OK = /^[0-9A-Za-z *,\-.;=]*$/;
export function valorSafelisted(nome, valor) {
  const n = String(nome).toLowerCase();
  const v = String(valor);
  if (Buffer.byteLength(v, 'latin1') > 128) return false;
  if (n === 'accept') return !BYTE_CORS_INSEGURO.test(v);
  if (n === 'accept-language' || n === 'content-language') return LINGUA_OK.test(v);
  if (n === 'range') return rangeSimples(v);
  if (n === 'content-type') {
    if (BYTE_CORS_INSEGURO.test(v)) return false;
    const mime = apararHttp(v.split(';')[0]).toLowerCase();   // essencia MIME aparada DEPOIS do corte (Astra B105: 'text/plain ;x' e simples)
    return ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'].includes(mime);
  }
  return false;
}
// `headers` sao os cabecalhos que o SCRIPT pos (os do Request construido pelo embrulho,
// anunciados na captura) — sem exclusao por identidade (Astra B95): `cache-control` fica
// fora da identidade porque o navegador tambem o poe sozinho, mas posto pelo script obriga
// preflight. Todo cabecalho aqui conta; os safelisted pelo valor, os demais sempre.
// Nomes de cabecalho do script que NAO sao safelisted (pelo nome ou pelo valor) — o que o
// preflight autorizou (Astra B108). Minusculos, ordenados, sem repeticao.
export function nomesInseguros(headers) {
  const s = new Set();
  for (const [nome, valor] of Object.entries(headers || {})) {
    const n = String(nome).toLowerCase();
    if (SAFELIST_CORS.has(n) && valorSafelisted(n, valor)) continue;
    s.add(n);
  }
  return [...s].sort();
}
export function precisaPreflight(metodo, headers) {
  const m = metodoCanonico(metodo);
  if (m !== 'GET' && m !== 'HEAD' && m !== 'POST') return true;
  for (const [nome, valor] of Object.entries(headers || {})) {
    const n = String(nome).toLowerCase();
    if (SAFELIST_CORS.has(n)) { if (!valorSafelisted(n, valor)) return true; continue; }
    return true;
  }
  return false;
}
export function cabecalhosDeIdentidade(headers) {
  const pares = [];
  for (const [nome, valor] of Object.entries(headers || {})) {
    if (cabecalhoEntraNaIdentidade(nome, valor)) pares.push(`${nome.toLowerCase()}:${apararHttp(valor)}`);
  }
  return pares.sort().join('\n');
}
// ATRIBUTOS DO PEDIDO entram na identidade (Astra B129 credenciais; B131 generalizado): o
// navegador envia coisas diferentes conforme o modo (Sec-Fetch-Mode), as credenciais (cookie),
// o cache (Cache-Control/Pragma, condicionais), o referrer e a politica dele (Referer) — o
// servidor pode responder diferente a cada um. Identidade mais estrita so produz miss, nunca
// resposta errada. So o que difere do default e acrescentado (identidades do default
// intactas), em ordem fixa, separado por NUL (Astra B130: nenhum cabecalho contem \0).
// ⚠️ Espelhado LITERALMENTE no remendo (runtime-fetch-map.js, marcaDeAtributos).
// A linha: entra o que muda o PEDIDO QUE O SERVIDOR RECEBE. `redirect`, `integrity` e
// `keepalive` nao chegam ao servidor (so mudam o que o navegador faz com a resposta) e ja
// tem guarda propria no remendo — la a guarda e mais fiel que um miss.
export const ATRIBUTOS_DE_IDENTIDADE = [
  ['cache', 'default'], ['credentials', 'same-origin'], ['mode', 'cors'],
  ['referrer', 'about:client'], ['referrerPolicy', ''],
];
export function marcaDeAtributos(atributos) {
  const at = typeof atributos === 'string' ? { credentials: atributos } : (atributos || {});
  let s = '';
  for (const [k, padrao] of ATRIBUTOS_DE_IDENTIDADE) {
    const v = at[k];
    if (v === undefined || v === null || v === padrao) continue;
    s += `\n\0${k}:${String(v)}`;
  }
  return s;
}
// CORPO PRESENTE E VAZIO (Astra B134): fora de POST/PUT, corpo ausente nao manda Content-Length
// e corpo vazio manda `Content-Length: 0` — o servidor ve pedidos diferentes com os mesmos bytes.
// Em POST/PUT o navegador manda 0 nos dois casos (Fetch, http-network-or-cache fetch): iguais.
export function marcaDeCorpoVazio(metodo, corpo, atributos) {
  const presente = atributos && typeof atributos === 'object' && atributos.corpoPresente === true;
  const m = metodoCanonico(metodo);
  return presente && !(corpo && corpo.length) && m !== 'POST' && m !== 'PUT' ? '\n\0corpo:vazio' : '';
}
export function identidadeDeRequisicao(metodo, url, corpo, headers = {}, atributos = 'same-origin') {
  const corpoHash = hexSha256(corpo && corpo.length ? corpo : Buffer.alloc(0));
  return hexSha256(`${metodoCanonico(metodo)}\n${url}\n${corpoHash}\n${cabecalhosDeIdentidade(headers)}${marcaDeAtributos(atributos)}${marcaDeCorpoVazio(metodo, corpo, atributos)}`);
}
// ⚠️ ALLOWLIST, não denylist (Astra B2 #6). Uma Response sintética torna legível o que
// o CORS original ESCONDIA: o site real lia `null` em `X-Internal-Token` sem
// `Access-Control-Expose-Headers`; o replay entregava o segredo. Resposta de OUTRA
// origem expõe só os safelisted do CORS + os que a própria resposta expôs; resposta da
// MESMA origem expõe o que o JavaScript já podia ler ao vivo. Fora sempre: transporte,
// políticas, validadores que a reescrita invalida, e `location` (redirect não é
// modelado).
const CORS_SAFELISTED = new Set(['cache-control', 'content-language', 'content-length', 'content-type', 'expires', 'last-modified', 'pragma']);
const NUNCA_NO_REPLAY = /^(set-cookie|cookie|authorization|proxy-authorization|transfer-encoding|connection|content-length|content-encoding|keep-alive|strict-transport-security|access-control-.*|content-security-policy.*|x-frame-options|cross-origin-.*|date|vary|server|location|etag|digest|content-range|alt-svc|report-to|nel)$/i;
// Elegibilidade a CORS CREDENCIADO (Astra B38/B39): comparação EXATA, sem dobra de
// caixa — o Fetch exige `Access-Control-Allow-Credentials` byte a byte igual a `true`
// (`True` NÃO vale) e ACAO igual à serialização da origem da página.
// LEGIBILIDADE não credenciada (Astra B40): ACAO `*` ou EXATAMENTE a origem da página —
// sem dobra de caixa; `https://SITE.example` NÃO libera `https://site.example`.
// ACAO/ACAC comparados apos aparar SO espaco HTTP (Astra B92): `trim()` Unicode fazia
// `*\u00a0` valer `*` e `true\u00a0` valer `true`; o nativo nao aceita nenhum dos dois.
export function acaoLiberaLeitura(headers, origemDaPagina) {
  const h = {};
  for (const [nome, valor] of Object.entries(headers || {})) h[nome.toLowerCase()] = String(valor);
  const acao = apararHttp(h['access-control-allow-origin'] || '');
  return acao === '*' || acao === String(origemDaPagina);
}
// CADEIA DE REDIRECT sob CORS (Astra B83): o nativo faz uma checagem CORS em CADA resposta
// que nao e same-origin (ou depois de a resposta ja estar "tainted" como cors), comparando
// ACAO com a origem SERIALIZADA do pedido — que vira `null` (tainted origin flag, pegajoso)
// no salto cuja URL de ORIGEM difere tanto do destino quanto da origem do documento
// (Fetch, HTTP-redirect fetch; Astra B84: A -> B ainda serializa A em B; e o B -> A que
// tinge). Assim, A -> B -> A com ACAO `A` no terminal FALHA em modo cors (la a origem
// serializada ja e `null`); em B, ACAO `A` passa e `null` NAO.
// Entrada: origem do documento e as respostas NA ORDEM (saltos, depois o terminal), cada
// uma { url, headers }. Saida: { legivel, credenciado } para a cadeia inteira.
export function avaliarCadeiaCors(origemDoDocumento, respostas) {
  let serializada = String(origemDoDocumento);
  let tingidaCors = false;
  let legivel = true;
  let credenciado = true;
  const lista = Array.isArray(respostas) ? respostas : [];
  for (let i = 0; i < lista.length; i += 1) {
    const atual = lista[i];
    let origemAtual = null;
    try { origemAtual = new URL(atual.url).origin; } catch { origemAtual = null; }
    const mesmaOrigem = origemAtual !== null && origemAtual === String(origemDoDocumento);
    if (!mesmaOrigem) tingidaCors = true;
    if (tingidaCors) {
      const h = {};
      for (const [nome, valor] of Object.entries(atual.headers || {})) h[nome.toLowerCase()] = String(valor);
      const acao = apararHttp(h['access-control-allow-origin'] || '');
      const acac = apararHttp(h['access-control-allow-credentials'] || '');
      if (!(acao === '*' || acao === serializada)) legivel = false;
      if (!(acao === serializada && acac === 'true')) credenciado = false;
    }
    const proximo = lista[i + 1];
    if (proximo) {
      let origemProxima = null;
      try { origemProxima = new URL(proximo.url).origin; } catch { origemProxima = null; }
      if (origemAtual === null || origemProxima === null) serializada = 'null';
      else if (origemAtual !== origemProxima && origemAtual !== String(origemDoDocumento)) serializada = 'null';
    }
  }
  return { legivel, credenciado: legivel && credenciado };
}
export function elegivelCorsCredenciado(headers, origemDaPagina) {
  const h = {};
  for (const [nome, valor] of Object.entries(headers || {})) h[nome.toLowerCase()] = String(valor);
  const acao = apararHttp(h['access-control-allow-origin'] || '');
  const acac = apararHttp(h['access-control-allow-credentials'] || '');
  return acao === String(origemDaPagina) && acac === 'true';
}
// MAPA DE PROVENIÊNCIA (Astra B44/B48): caminho de asset EMITIDO → identidade exata do
// GET simples à URL ORIGINAL. Entram todos os assets de OUTRA origem (`_ext/`) e todo
// asset da própria origem cujo caminho emitido difere do caminho natural da URL
// (query em hash, caracteres sanitizados, diretório → index.html): para esses, a
// URL reconstruída do caminho é OUTRA URL e podia selecionar o envelope de outro
// pedido. Sem URL no HTML — só o hash.
export function mapaDeProveniencias(mapa, origemDaEntrada = '') {
  // Sem protótipo (Astra B54): `saida['__proto__'] = hash` num objeto comum invoca o
  // setter herdado e a entrada some.
  const saida = Object.create(null);
  for (const [urlOriginal, caminhoAsset] of mapa || []) {
    if (typeof caminhoAsset !== 'string') continue;
    let natural = null;
    try {
      const u = new URL(urlOriginal);
      // Caminho NATURAL = o pathname CRU (sem decodificar — Astra B49: `items/a%2Fb`
      // decodificado coincidia com o caminho emitido e ficava fora do mapa; sem a regra
      // do index.html: um diretório vira `dir/index.html` no pacote e a reconstrução
      // daria OUTRA URL).
      // Exatamente UMA barra inicial (Astra B50): `//items/a` emitido como `items/a`
      // parecia natural e ficava fora do mapa; barras extras fazem parte da identidade.
      natural = u.pathname.replace(/^\//, '');
    } catch { natural = null; }
    // Um '?' na URL original (mesmo vazio) faz o caminho emitido ser OUTRA URL (Astra B51).
    let temQuery = false;
    try { temQuery = new URL(urlOriginal).href.split('#')[0].indexOf('?') !== -1; } catch { temQuery = false; }
    // ORIGEM completa, com esquema (Astra B78): o caminho do pacote compara só o HOST, então
    // `https://host/a.png` numa página `http://host` vira o natural `a.png` — sem proveniência,
    // o remendo reconstruía `http://host/a.png`, OUTRA identidade (a de um pedido real).
    let origemDiferente = false;
    try { origemDiferente = Boolean(origemDaEntrada) && new URL(urlOriginal).origin !== origemDaEntrada; } catch { origemDiferente = true; }
    const transformado = caminhoAsset.startsWith('_ext/') || natural === null || caminhoAsset !== natural || temQuery || origemDiferente;
    if (transformado) saida[caminhoAsset] = identidadeDeRequisicao('GET', urlOriginal, Buffer.alloc(0), {});
  }
  return saida;
}
// GRUPO CANONICO de cada caminho localizado (Astra B126): hash de "GET <URL original sem
// fragmento>" — a mesma chave que o remendo calcula para o pedido feito pela URL original, para
// que o desalinhamento de um grupo valha para o alias e para a original. So o hash vai ao HTML.
export function gruposDeProveniencia(mapa) {
  const saida = Object.create(null);
  for (const [urlOriginal, caminhoAsset] of mapa || []) {
    if (typeof caminhoAsset !== 'string') continue;
    saida[caminhoAsset] = createHash('sha256').update(`GET ${String(urlOriginal).split('#')[0]}`).digest('hex');
  }
  return saida;
}
// ORIGENS ALHEIAS com caminho natural (Astra B79): asset de OUTRA origem (esquema/host/porta)
// que nao foi para `_ext/` (o caminho do pacote compara so o host) — o remendo precisa de
// uma marca explicita para classifica-lo como externo (nunca servir a copia local num miss;
// `same-origin` rejeita; a rede vai a URL ORIGINAL). caminho -> URL original.
export function origensAlheias(mapa, origemDaEntrada = '') {
  const saida = Object.create(null);
  if (!origemDaEntrada) return saida;
  for (const [urlOriginal, caminhoAsset] of mapa || []) {
    // `_ext/` TAMBEM (Astra B144): o nome no pacote tem hash e perde a query — reconstruir a
    // URL dele (sprite.64e8aa27.svg) mandava o fetch de hover a um endereco inventado (404).
    if (typeof caminhoAsset !== 'string') continue;
    if (caminhoAsset.startsWith('_ext/')) { saida[caminhoAsset] = String(urlOriginal).split('#')[0]; continue; }
    let alheia = false;
    try { alheia = new URL(urlOriginal).origin !== origemDaEntrada; } catch { alheia = false; }
    if (alheia) saida[caminhoAsset] = String(urlOriginal).split('#')[0];
  }
  return saida;
}
// CAMINHOS PROTEGIDOS contra o fallback estático (Astra B55/B57): todo asset cuja URL
// foi vista em QUALQUER pedido de fetch (raiz ou terminal), mais todo asset iniciado por
// script (`fetch` OU `xhr` — ambos carregam identidade por cabeçalho). Independe de
// qual pedido povoou primeiro o asset estático: XHR primeiro + fetch depois deixava o
// asset como `xhr` e a cópia estática respondia a um miss de identidade.
// VARY por cabecalho de PEDIDO (Astra B145): a resposta capturada pelo markup e UMA
// representacao — o <img> manda um Accept de imagem, o fetch simples manda */*. Com `Vary`
// num cabecalho de pedido (qualquer um alem de Accept-Encoding, que e transporte), o fetch
// podia receber OUTRA representacao na fonte: o asset vira protegido contra o fallback.
export function variaPorPedido(vary) {
  if (typeof vary !== 'string' || !vary.trim()) return false;
  return vary.split(',').map((t) => apararHttp(t).toLowerCase()).some((t) => t && t !== 'accept-encoding');
}
// Validade de cache NAO entra (revisao Claude, 2026-09-30, revertendo B147/B148): na Vercel e na
// Netlify o padrao e `max-age=0, must-revalidate` — todo asset proprio ficaria protegido e o hover
// quebraria. Sem `Vary`, o servidor nao pode escolher outra representacao pelo pedido (o 304 da
// revalidacao devolve os mesmos bytes). Residual declarado: servidor que negocia SEM declarar
// `Vary` (viola o HTTP) pode responder outra coisa ao fetch.
export function caminhosProtegidos(congelados, mapa, urlsDeFetch = new Set(), origemDaEntrada = '') {
  const saida = new Set();
  for (const [u, v] of congelados || []) {
    const caminho = mapa.get(u);
    if (typeof caminho !== 'string') continue;
    // A protecao por cache (Astra B145/B147) so vale para asset da PROPRIA origem: o miss de um
    // asset de outra origem vai a URL original (proveniencia), nunca a copia local.
    let propria = false; try { propria = Boolean(origemDaEntrada) && new URL(u).origin === origemDaEntrada; } catch { propria = false; }
    if ((v && (v.tipo === 'fetch' || v.tipo === 'xhr' || (v.varia === true && propria))) || urlsDeFetch.has(u)) saida.add(caminho);
  }
  for (const u of urlsDeFetch) { const c = mapa.get(u); if (typeof c === 'string') saida.add(c); }
  return [...saida];
}
const TOKEN_HTTP = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
export function cabecalhosDeReplay(headers, { mesmaOrigem = true } = {}) {
  const todos = {};
  for (const [nome, valor] of Object.entries(headers || {})) todos[nome.toLowerCase()] = String(valor);
  // `*` NÃO expande (Astra B3 #2): com `credentials: 'include'` o `*` é nome literal e
  // a página real não lia nada além do safelisted. O modo de credenciais não chega
  // aqui, então a leitura conservadora vale sempre — perde-se um cabeçalho legítimo
  // em modo omit, nunca se publica um escondido.
  // Lista de exposicao como o Chromium a le (Astra B91): elementos separados por virgula,
  // so espaco HTTP aparado, cada nome um TOKEN HTTP; um elemento malformado (ex.: NBSP no
  // fim) invalida a lista INTEIRA — nada alem do safelisted e exposto. `trim()` Unicode
  // apagava o NBSP e publicava um cabecalho que o nativo escondia.
  const brutos = (todos['access-control-expose-headers'] || '').split(',').map((s) => apararHttp(s));
  const malformado = brutos.some((s) => s !== '' && !TOKEN_HTTP.test(s));
  const expostos = new Set(malformado ? [] : brutos.map((s) => s.toLowerCase()).filter((n) => n && n !== '*'));
  const saida = {};
  for (const [nome, valor] of Object.entries(todos)) {
    if (NUNCA_NO_REPLAY.test(nome)) continue;
    if (!mesmaOrigem && !CORS_SAFELISTED.has(nome) && !expostos.has(nome)) continue;
    saida[nome] = valor;
  }
  return saida;
}
const ENVELOPE_MAX_BYTES = 4 * 1024 * 1024;

/**
 * Caminho de bundle a partir de uma URL absoluta. Determinístico e sem colisão
 * entre hosts: o host entra no caminho, então dois CDNs com `/main.js` não se
 * sobrescrevem.
 */
export function bundlePathForUrl(rawUrl, entryUrl) {
  const url = new URL(rawUrl);
  const entry = new URL(entryUrl);
  const mesmoHost = url.host === entry.host;
  let caminho = url.pathname.replace(/^\/+/, '');
  if (!caminho || caminho.endsWith('/')) caminho += 'index.html';
  // A query faz parte da identidade do recurso: `?v=2` costuma ser outro
  // arquivo. Sem isso, duas versões colidiriam e uma sumiria em silêncio.
  if (url.search) {
    const marca = createHash('sha1').update(url.search).digest('hex').slice(0, 8);
    caminho = caminho.replace(/(\.[^./]+)$/, `.${marca}$1`) || `${caminho}.${marca}`;
    if (!/\.[^./]+$/.test(caminho)) caminho += `.${marca}`;
  }
  const prefixo = mesmoHost ? '' : `_ext/${url.host}/`;
  return `${prefixo}${caminho}`
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/[^A-Za-z0-9._/-]/g, '_');
}

/**
 * Candidatos de um valor de `srcset` (defeito 1b, 2026-08-20). A captura só
 * salvava o candidato que o browser escolheu no viewport da captura; os outros
 * ficavam absolutos no HTML e a CSP do gateway (img-src 'self') os bloqueia
 * para sempre. Split cru por vírgula é proibido — data URLs contêm vírgula.
 * Algoritmo (WHATWG simplificado): um candidato é um token sem whitespace
 * seguido de descriptor opcional; a vírgula separadora vem DEPOIS do
 * descriptor (ou do token). Limitação documentada: uma URL com vírgula crua
 * seguida de espaço quebra — o formato exige que URLs assim sejam escapadas.
 */
export function srcsetCandidateUrls(value) {
  if (typeof value !== 'string' || !value.trim()) return [];
  const urls = [];
  let rest = value.trim();
  while (rest) {
    rest = rest.replace(/^[,\s]+/, '');
    if (!rest) break;
    // A candidate runs to the next whitespace. Per the HTML spec the comma is
    // only a separator: if the token ENDS with commas, this candidate has no
    // descriptor and the next one starts right after. Scanning greedily past
    // the comma (the old `\S*`) swallowed the separator and turned every
    // later candidate into a "descriptor" — `srcset="a.png, a_2x.png 2x"`
    // yielded ONE url, and the rest became unreachable images in the clone
    // (measured on a real site, 2026-08-21). Commas inside a data: URL are
    // safe because they never sit at the end of the token.
    const token = /^\S+/.exec(rest)[0];
    rest = rest.slice(token.length);
    const url = token.replace(/,+$/, '');
    if (url) urls.push(url);
    if (token.endsWith(',')) continue;
    // Otherwise skip this candidate's descriptor, up to the separating comma.
    let depth = 0;
    let i = 0;
    while (i < rest.length) {
      const ch = rest[i];
      if (ch === '(') depth += 1;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      else if (ch === ',' && depth === 0) break;
      i += 1;
    }
    rest = rest.slice(i);
  }
  return urls;
}


/**
 * Captura uma URL como bundle nativo.
 *
 * @param {string} url
 * @param {object} opts
 * @param {(estado: object) => void} [opts.onProgress]
 * @param {object} [opts.browser] navegador já aberto (para teste)
 * @returns {Promise<{kind:'native', bundle:object, relatorio:object}>}
 */
// Adaptador: a resposta do `context.request.fetch` (Playwright) com a MESMA
// forma que a repescagem lê do `fetch` do Node — status, headers.get, ok e um
// body com getReader() de um pedaço só. `maxRedirects: 0` devolve o 3xx para
// o salto ser validado aqui, como no caminho do Node.
async function pedirPeloNavegador(context, alvo) {
  const r = await context.request.fetch(alvo, { maxRedirects: 0, timeout: 12000 });
  const h = r.headers();
  const status = r.status();
  const ok = r.ok();
  const get = (k) => (h[String(k).toLowerCase()] ?? null);
  // Redirect: devolve o 3xx para o salto ser validado pelo chamador; a
  // resposta não carrega corpo, mas ainda ocupa memória no processo do
  // Playwright até `dispose()` — libera já.
  if (status >= 300 && status < 400) {
    await r.dispose().catch(() => {});
    return { status, ok, headers: { get }, body: null };
  }
  // ⚠️ `context.request` BUFFERIZA o corpo inteiro antes de devolver (não há
  // leitura em fluxo por esta API), então o teto de tamanho tem que morder
  // ANTES da alocação: content-length acima do teto por-arquivo = recusa sem
  // baixar (Astra 2026-09-08 #4). Cabeçalho ausente/mentiroso no site honesto
  // do modelo de ameaça é o resíduo já aceito da interceptação.
  const declarado = Number(get('content-length') || 0);
  if (!ok || declarado > MAX_ASSET_BYTES) {
    await r.dispose().catch(() => {});
    return { status, ok, headers: { get }, body: null };
  }
  const bytes = await r.body();
  // O corpo já está em mão: descarta o handle do vendor para não acumular
  // respostas não liberadas até o fim da captura (Astra #4).
  await r.dispose().catch(() => {});
  return {
    status,
    ok,
    headers: { get },
    body: {
      getReader() {
        let entregue = false;
        return {
          async read() {
            if (entregue) return { done: true, value: undefined };
            entregue = true;
            return { done: false, value: new Uint8Array(bytes) };
          },
          async cancel() { /* corpo já bufferizado e handle já liberado */ },
        };
      },
    },
  };
}

export async function captureNativeBundle(url, opts = {}) {
  const {
    onProgress = () => {}, viewport = { width: 1440, height: 900 }, chromium, signal,
    // Sessão EMPRESTADA (spec 2026-09-08 §4.4): navegador/contexto/página já
    // verificados por outro (o job de challenge). O produtor usa a página
    // dada — a liberação da verificação vive nela — e NÃO fecha o que não é
    // dele. Sem `session`, comportamento idêntico ao de sempre.
    session = null,
    challengeToleranceMs = CHALLENGE_TOLERANCIA_MS,
  } = opts;
  const emprestada = Boolean(session && session.page);

  // A URL de ENTRADA passa pelo mesmo bloqueio dos subrecursos.
  const alvo = new URL(url);
  if (!/^https?:$/.test(alvo.protocol) || !(await hostEhPublico(alvo.hostname))) {
    throw Object.assign(new Error('native_bundle_blocked_host'), { code: 'blocked_host' });
  }

  onProgress({ etapa: 'launching' });
  const browser = emprestada ? session.browser : await abrirNavegador(chromium);
  const fecharSePropria = async () => { if (!emprestada) await browser.close().catch(() => {}); };
  const recursos = new Map();   // url absoluta -> { bytes, contentType }
  // url FINAL guardada -> urls dos SALTOS de redirect que levaram a ela (so para reescrever MARCACAO)
  const apelidosDeRedirect = new Map();
  const TIPOS_DE_APELIDO = new Set(['document', 'stylesheet', 'script', 'image', 'font', 'media', 'manifest', 'texttrack']);
  // UMA porta para os bytes: interceptação e repescagem reservam pela mesma
  // contabilidade, então o teto global não pode ser furado por corrida entre
  // as duas (achado do Sol).
  const conta = criarContabilidade(MAX_BYTES_TOTAL);
  const descartados = [];
  // ⚠️ Os handlers de `response` são assíncronos e ninguém os aguardava: a
  // montagem do bundle podia rodar com corpos ainda em leitura, e eles sumiam
  // sem sequer entrar em `descartados`. Achado P1 do Sol.
  const emVoo = new Set();
  // URL de cada corpo ainda em leitura: quem estiver aqui quando o teto da
  // coleta morder é "não terminou", e a repescagem NÃO deve gastar mais 12s
  // re-pedindo exatamente o que acabou de travar (Claude review r1 #3).
  const lendo = new Map(); // url -> quantos handlers ainda leem (refcount: Astra r2 #3)
  // Geração do documento principal por URL (ver o handler): recarregar a
  // mesma URL substitui o documento anterior mesmo com o corpo dele em voo.
  const geracao = new Map();
  // ⭐ PEDIDOS QUE O NAVEGADOR RECUSOU (2026-09-28). A captura só escutava
  // `response`, então um recurso cuja resposta o próprio Chrome bloqueia era
  // INVISÍVEL: nada a gravar, nenhum descarte nomeado, e a referência ficava
  // absoluta no HTML — o clone herdava uma chamada externa condenada a falhar
  // para sempre. Medido no farmminerals: dois `<script>` do Webflow com
  // separador percent-encoded (`%2F`) que o Chrome recusa por ORB (Opaque
  // Response Blocking) NA PÁGINA VIVA TAMBÉM. Eles nunca executam em lugar
  // nenhum; o clone só herdava o pedido morto.
  const recusados = new Map();   // url -> { erro, tipo }
  // Envelopes de fetch/XHR por IDENTIDADE (método+URL+corpo). Lista por identidade:
  // a mesma chamada repetida pode receber respostas diferentes, e o replay entrega a
  // n-ésima na ordem em que foram vistas.
  const envelopes = new Map();   // identidade -> [{ url, status, statusText, headers, contentType, bytes, mesmaOrigem }]
  // ORDEM DE EMISSÃO do pedido, não de conclusão: a ocorrência repetida percorre um
  // caminho mais curto e terminava ANTES da primeira — o replay entregaria a 2ª
  // resposta à 1ª chamada do site (medido no teste de integração).
  const ordemDoPedido = new WeakMap();
  let seqPedido = 0;
  // A CHAMADA do site é o pedido RAIZ da cadeia de redirects (Astra B3 #4): cada salto
  // é outro Request para o Playwright, com URL e sequência próprias — a identidade que
  // o remendo calcula é a da URL que o script chamou, e a ordem é a da chamada.
  const pedidoRaiz = (req) => { let r = req; while (typeof r.redirectedFrom === 'function' && r.redirectedFrom()) r = r.redirectedFrom(); return r; };
  // Só `fetch` (Astra B3 #4): o remendo consome só chamadas de fetch; um XHR de mesma
  // identidade misturado na lista entregaria a resposta do XHR à 1ª chamada de fetch.
  const ehChamadaDeFetch = (req) => req.resourceType() === 'fetch';
  // So o DOCUMENTO DE ENTRADA reserva ocorrencias (Astra B67): a identidade nao carrega
  // documento e o remendo so e injetado na entrada — a chamada identica de um iframe,
  // se entrasse na lista, nunca seria consumida no replay e o principal receberia a
  // resposta do filho. Pedidos de outros frames seguem contando para os assets.
  // Replay dentro de iframes: limite declarado (sem interceptor la).
  const doDocumentoDeEntrada = (req) => {
    try { const f = typeof req.frame === 'function' ? req.frame() : null; return !f || f === f.page().mainFrame(); } catch { return false; }
  };
  const temVaga = (req) => vagaPorRaiz.has(pedidoRaiz(req));
  // Cabecalhos da identidade: os ANUNCIADOS pelo embrulho (pares sem perda, objeto sem
  // prototipo) quando existem — `req.headers()` do Playwright monta um `{}` comum e um
  // cabecalho valido chamado `__proto__` some no setter herdado (Astra B115), fundindo a
  // identidade com a do pedido sem cabecalho.
  const identidadeDoPedido = (req, cabecalhosAnunciados = null, atributos = 'same-origin') => {
    const raiz = pedidoRaiz(req);
    const corpoReq = typeof raiz.postDataBuffer === 'function' ? (raiz.postDataBuffer() || Buffer.alloc(0)) : Buffer.alloc(0);
    return { id: identidadeDeRequisicao(raiz.method(), raiz.url(), corpoReq, cabecalhosAnunciados || raiz.headers(), atributos || 'same-origin'), seq: ordemDoPedido.get(raiz) ?? Number.MAX_SAFE_INTEGER };
  };
  // ⭐ UMA VAGA POR PEDIDO RAIZ, reservada no evento `request` e finalizada UMA vez
  // (Astra B4 #1). Antes, a posição nascia na resposta: um redirect no meio virava
  // buraco E o destino virava outra posição (`[primeira, null, segunda, terceira]` —
  // a 3ª chamada recebia a 2ª resposta), e uma recusa antecipada (41 MiB declarados)
  // não deixava buraco nenhum. Agora a vaga nasce como BURACO; a resposta TERMINAL a
  // preenche; salto de redirect não toca nela; recusa a deixa como está.
  const vagaPorRaiz = new WeakMap();
  const vagas = [];   // todas, para nomear no fim as que ficaram sem desfecho
  const gruposEnvenenados = new Set();   // (metodo URL) com uma chamada de corpo nao provado (Astra B118)
  // PREFLIGHTS OBSERVADOS (Astra B111): a evidencia de preflight vem do que o navegador FEZ,
  // nao de um classificador — o Chromium safelista cabecalhos a mais (DPR, ...) e cada
  // divergencia fabricava certificacao. Via CDP (o Playwright nao emite o OPTIONS): URL ->
  // quantos preflights bem-sucedidos ainda nao consumidos. Sem observacao (cache de preflight,
  // CDP indisponivel), nada e certificado — o erro so pode custar um replay, nunca inventa-lo.
  // Associacao EXATA preflight -> pedido (Astra B112): o OPTIONS traz initiator.requestId do
  // pedido real; so pedidos do tipo Fetch do frame principal entram (XHR, worker e iframe
  // nao). Consumo em ordem por (metodo, URL); havendo mais de um candidato nao consumido
  // (concorrencia), a associacao e ambigua e nada e certificado.
  const pedidosCdp = new Map();       // requestId -> { metodo, url, preflightOk, consumido }
  const preflightDe = new Map();      // requestId do OPTIONS -> requestId do pedido real
  const consumirPreflight = (url, metodo) => {
    const k = String(url).split('#')[0];
    const candidatos = [...pedidosCdp.values()].filter((p) => !p.consumido && p.url === k && p.metodo === String(metodo).toUpperCase());
    // 'sim' (preflight provado para ESTE pedido), 'nao' (registro inequivoco sem preflight),
    // 'ambiguo' (pode ter havido — nunca certifica, mas conta como "houve" para recusar:
    // Astra B114) ou 'desconhecido' (sem registro CDP).
    if (!candidatos.length) return 'desconhecido';
    // Ambiguidade envenena TODOS os participantes, para sempre (Astra B113).
    if (candidatos.length > 1) for (const c of candidatos) c.ambiguo = true;
    candidatos[0].consumido = true;
    if (candidatos.length > 1 || candidatos[0].ambiguo) return 'ambiguo';
    return candidatos[0].preflightOk === true ? 'sim' : 'nao';
  };
  // GERACAO DO DOCUMENTO de entrada (Astra B68): o frame principal persiste entre
  // navegacoes, mas o documento nao — uma recarga na mesma URL cria outro documento, e
  // as ocorrencias do anterior nao podem entrar na lista do que virou a entrada
  // (`[OLD, MAIN]` faria o replay servir OLD). Cada vaga nasce com a geracao corrente;
  // a geracao avanca a cada resposta de documento do frame principal (nao em mudanca
  // de historico same-document, que nao pede documento); no fim so a geracao final e
  // emitida, e respostas tardias de documentos substituidos ficam de fora.
  // O sinal de COMMIT e o frame principal navegar de fato (`framenavigated`) DEPOIS de
  // uma resposta de documento que pode virar documento (Astra B69): 204/205 e download
  // (Content-Disposition: attachment) deixam o documento atual vivo, por norma HTML, e
  // nao avancam; mudanca de historico same-document navega sem resposta pendente e
  // tambem nao avanca.
  let geracaoDoc = 0;
  let navegacaoPendente = false;
  const respostaQueViraDocumento = (res) => {
    const st = res.status();
    if (st === 204 || st === 205) return false;
    return !/^\s*attachment\b/i.test(String(res.headers()['content-disposition'] || ''));
  };
  const urlsDeFetch = new Set();   // toda URL vista num pedido de fetch (raiz e terminal)
  // HOP = o navegador seguiu (`redirectedTo`) OU status de redirect COM `Location`
  // (Astra B5 #2). 300 é terminal; 302 sem Location termina o fetch — e eram
  // descartados como "salto". O Fetch só redireciona em 301/302/303/307/308.
  const ehHop = (res) => Boolean(res.request().redirectedTo())
    || ([301, 302, 303, 307, 308].includes(res.status()) && Boolean(res.headers().location));
  const reservarVaga = (req, credenciais = '', cabecalhosDoScript = null, modo = '', atributos = null, documento = null, politica = null) => {
    urlsDeFetch.add(req.url());
    const { id, seq } = identidadeDoPedido(req, cabecalhosDoScript, atributos || credenciais || 'same-origin');
    const lista = envelopes.get(id) || [];
    const vaga = { seq, perdido: true, u: req.url(), metodo: metodoCanonico(req.method()), geracao: geracaoDoc, credenciais, cabecalhosDoScript, modo };
    // DOCUMENTO de onde a chamada partiu (Astra B132): com referrer default o navegador deriva
    // o Referer da URL ATUAL do documento — pushState muda o que o servidor recebe sem mudar a
    // identidade. Guardado como hash ('' = a URL de entrada do documento): o remendo so serve a
    // ocorrencia a uma chamada feita do MESMO documento; outro = miss sem consumir.
    if (typeof documento === 'string') vaga.documento = hexSha256(documento);
    // POLITICA de referrer do documento na chamada (Astra B135/B136), SEPARADA do documento: ela
    // decide tambem o referrer EXPLICITO quando o pedido nao traz politica propria. Valor do
    // padrao (nao sensivel), '' = nenhuma meta aplicada.
    if (typeof politica === 'string') vaga.politica = politica;
    vagas.push(vaga);
    lista.push(vaga);
    envelopes.set(id, lista);
    vagaPorRaiz.set(req, vaga);
  };
  // RESPOSTA OPACA (Astra B16): fetch cross-origin cuja resposta não traz
  // `Access-Control-Allow-Origin` só pôde chegar à página como OPACA (`no-cors`:
  // status 0, sem cabeçalhos, corpo nulo) — em modo cors o navegador a bloqueia e
  // nem emite `response`. Guardá-la como asset e reescrever o literal do script para
  // o arquivo local tornava LEGÍVEL no clone o que a página nunca leu. Fica FORA do
  // pacote e o envelope vira marcador opaco (replay = miss, ocorrência consumida).
  // Resíduo declarado: dedup por URL — uma URL vista primeiro por fetch opaco não
  // entra no pacote mesmo que um <img> também a referencie.
  // (Astra B17) A PRESENÇA de ACAO não prova legibilidade: um ACAO de origem alheia
  // não libera nada, e sob `no-cors` a resposta é opaca mesmo com ACAO certo. Regra
  // sem exceções: resposta de fetch CROSS-ORIGIN nunca vira asset (o literal fica
  // absoluto e o pedido segue cross-origin no clone, onde o modo decide); o envelope
  // só é LEGÍVEL se o ACAO nomeia a origem da página ou é `*`; senão é marcador opaco.
  // ORIGEM DO DOCUMENTO que iniciou o pedido (Astra B66), nao a da navegacao INICIAL: a
  // navegacao pode redirecionar de origem (example.com -> www.example.com) e o documento
  // final faz `fetch('/api')` same-origin — comparar com `alvo.origin` classificava-o
  // como cross-origin e, sem ACAO (que uma resposta same-origin nao precisa), descartava
  // o corpo como opaco: o replay perdia a API que funcionava. O frame do pedido e o
  // documento que o fez; frame de origem opaca (srcdoc/about:blank) herda o topo; sem
  // frame (destacado) cai na origem inicial.
  const origemDoDocumento = (req) => {
    const origemDe = (u) => { try { const o = new URL(u).origin; return o === 'null' ? null : o; } catch { return null; } };
    try {
      const frame = typeof req.frame === 'function' ? req.frame() : null;
      if (frame) {
        const propria = origemDe(frame.url());
        if (propria) return propria;
        const topo = origemDe(frame.page().mainFrame().url());
        if (topo) return topo;
      }
    } catch { /* frame destacado: origem inicial */ }
    return alvo.origin;
  };
  // Cross-origin se o TERMINAL e de outra origem OU se QUALQUER pedido da cadeia cruzou
  // origem (Astra B82): A -> B -> A volta ao terminal same-origin, mas o nativo ja fez a
  // checagem CORS em B (e a resposta final segue "tainted"); sem isto o corpo entrava
  // como asset/envelope comum e o replay o servia a `cors`/`omit`.
  const fetchCrossOrigin = (req, u) => {
    if (!ehChamadaDeFetch(req)) return false;
    let mesma = false; try { mesma = new URL(u).origin === origemDoDocumento(req); } catch { mesma = false; }
    return !mesma || cadeiaCruzouOrigem(req, u);
  };
  const acaoLibera = (res) => acaoLiberaLeitura(res.headers(), origemDoDocumento(res.request()));
  // LEGIBILIDADE em TODA a cadeia (Astra B81): o nativo faz a checagem CORS em cada
  // resposta antes de segui-la — um 302 sem ACAO ja rejeita em modo `cors`, mesmo que o
  // terminal traga `*`. Sob `no-cors` os saltos chegam (opacos) e a captura via so o
  // terminal: emitia envelope legivel que o replay servia a `cors`/`omit`.
  // ... com a origem SERIALIZADA e o tainting do Fetch (Astra B83): ver avaliarCadeiaCors.
  const respostasDaCadeia = (req, res) => {
    const vaga = vagaPorRaiz.get(pedidoRaiz(req));
    return [...((vaga && vaga.saltos) || []), { url: res.url(), headers: res.headers() }];
  };
  // Cadeia INCOMPLETA (um salto que a captura nao registrou) = conservador: nem legivel nem
  // credenciada (Astra B85) — o terminal sozinho passaria na validacao.
  const cadeiaCompleta = (req) => {
    const vaga = vagaPorRaiz.get(pedidoRaiz(req));
    let esperados = 0;
    for (let r = req; typeof r.redirectedFrom === 'function' && r.redirectedFrom(); r = r.redirectedFrom()) esperados += 1;
    return ((vaga && vaga.saltos) || []).length >= esperados;
  };
  const avaliarCadeia = (req, res) => (cadeiaCompleta(req) ? avaliarCadeiaCors(origemDoDocumento(req), respostasDaCadeia(req, res)) : { legivel: false, credenciado: false });
  const cadeiaLegivel = (req, res) => avaliarCadeia(req, res).legivel;
  const respostaOpaca = (req, res, u) => fetchCrossOrigin(req, u) && !cadeiaLegivel(req, res);
  // TAINT DE REDIRECT (Astra B18): se QUALQUER salto da cadeia (ou o terminal) saiu da
  // origem da página, o fetch nativo trata a resposta como cross-origin — sob
  // `no-cors` fica OPACA mesmo que o terminal traga ACAO `*`. Um `/relay` same-origin
  // que redireciona para fora expunha o corpo no clone porque a raiz era same-origin.
  const cadeiaCruzouOrigem = (req, u) => {
    const origem = origemDoDocumento(req);
    const urls = [u];
    for (let r = req; r; r = (typeof r.redirectedFrom === 'function' ? r.redirectedFrom() : null)) urls.push(r.url());
    return urls.some((x) => { try { return new URL(x).origin !== origem; } catch { return true; } });
  };
  const registrarEnvelope = (req, res, u, bytes, extra = {}) => {
    const vaga = vagaPorRaiz.get(pedidoRaiz(req));
    if (!vaga || !vaga.perdido) return;   // sem vaga (não é raiz de fetch) ou já finalizada
    urlsDeFetch.add(u);
    const origem = origemDoDocumento(req);
    let mesmaOrigem = false;
    try { mesmaOrigem = new URL(u).origin === origem; } catch { mesmaOrigem = false; }
    const cruzouOrigem = cadeiaCruzouOrigem(req, u);
    // Houve REDIRECT na cadeia (mesmo same-origin) — Astra B37: a politica `redirect`
    // do pedido ('error' rejeita, 'manual' e opaco) so se aplica a envelopes que
    // vieram de um redirect seguido; sem esta marca o remendo os servia a qualquer
    // politica.
    const redirecionou = pedidoRaiz(req) !== req;
    // CORS CREDENCIADO (Astra B38): um envelope cross-origin legível em modo `omit`
    // (ACAO `*`) NÃO pode servir a `credentials:'include'` — o nativo exige origem
    // explícita E `Access-Control-Allow-Credentials: true`. Marca-se a elegibilidade.
    const externo = !mesmaOrigem || cruzouOrigem;
    // ... em TODA a cadeia (Astra B80): cada salto cross-origin passa pela checagem CORS
    // antes de ser seguido; basta um 302 com ACAO `*` para o nativo rejeitar `include`.
    // ... e, se o pedido exigiu preflight, so quando a propria captura foi `include`
    // (Astra B93): o OPTIONS nao e observavel, e um `omit` capturado nao prova que o
    // preflight autorizaria credenciais.
    // Cabecalhos do SCRIPT (anunciados) decidem o preflight (Astra B95); sem anuncio (nao
    // deveria acontecer: so anunciado reserva) = preflight presumido.
    const raiz = pedidoRaiz(req);
    let raizAlheia = false;
    try { raizAlheia = new URL(raiz.url()).origin !== origem; } catch { raizAlheia = false; }
    // Um preflight OBSERVADO (CDP) para a raiz conta sempre; o classificador so pode ACRESCENTAR
    // "houve preflight" (lado que recusa), nunca tira-lo (Astra B111).
    const observacao = raizAlheia ? consumirPreflight(raiz.url(), raiz.method()) : 'desconhecido';
    const preflightObservado = observacao === 'sim';
    const houvePreflight = observacao === 'sim' || observacao === 'ambiguo' || (vaga.cabecalhosDoScript ? precisaPreflight(raiz.method(), vaga.cabecalhosDoScript) : true);
    const preflightNaoVerificado = houvePreflight && vaga.credenciais !== 'include';
    const corsCredenciado = externo && !preflightNaoVerificado && avaliarCadeia(req, res).credenciado;
    // Preflight CREDENCIADO VERIFICADO (Astra B97): a captura foi `include` E houve preflight
    // — o navegador ja aceitou o OPTIONS com credenciais. Separado da permissao do
    // terminal: no replay, um pedido que EXIGE preflight (corpo em fluxo, cabecalho novo)
    // so pode ser servido com `include` se isto for verdade.
    // Evidencia de preflight so vale para o PROPRIO pedido raiz, cross-origin, SEM redirect
    // (Astra B107): num A -> 303 -> B a raiz e same-origin (nao faz preflight) e o 303 tira
    // corpo e cabecalhos antes de B — o OPTIONS nunca aconteceu. Conservador: cadeia
    // redirecionada nunca certifica preflight (residual declarado: um replay que exige
    // preflight de uma cadeia assim e recusado mesmo que o nativo passasse).
    const preflightObservavel = preflightObservado && !redirecionou;
    const preflightCredenciado = corsCredenciado && preflightObservavel && vaga.credenciais === 'include';
    // Preflight VERIFICADO em geral (Astra B103): houve preflight, a captura foi em modo cors
    // e a resposta chegou — o navegador aceitou o OPTIONS. Sem isto, um replay que exige
    // preflight (fluxo, cabecalho novo) nao pode ser servido em NENHUM modo de credenciais.
    const preflightVerificado = externo && preflightObservavel && vaga.modo === 'cors';
    // O que o preflight AUTORIZOU (Astra B108): um replay com cabecalho inseguro fora deste
    // conjunto exigiria outra autorizacao, que a captura nunca viu.
    const preflightCabecalhos = (preflightVerificado || preflightCredenciado) ? nomesInseguros(vaga.cabecalhosDoScript || {}) : null;
    // Corpo em FLUXO e redirect (Astra B106; Fetch, HTTP-redirect fetch passo 11): um salto
    // que nao e 303 com corpo presente de fonte nula e erro de rede — e esse passo vem antes
    // da reescrita POST->GET do 301/302. So o 1o salto importa: depois de um 303 o corpo e nulo.
    const redirectRejeitaFluxo = Boolean(vaga.saltos && vaga.saltos.length && vaga.saltos[0].status !== 303);
    if (extra.opaco) { delete vaga.perdido; Object.assign(vaga, { opaco: true, url: u, status: res.status(), statusText: '', headers: {}, contentType: '', bytes: Buffer.alloc(0), mesmaOrigem, cruzouOrigem }); return; }
    // `url` fica aqui só para a reescrita de JSON resolver referências relativas; NÃO
    // vai para o manifesto público (Astra B2 #6): query com token apareceria no HTML.
    delete vaga.perdido;
    Object.assign(vaga, {
      url: u, status: res.status(), statusText: res.statusText() || '',
      headers: cabecalhosDeReplay(res.headers(), { mesmaOrigem: mesmaOrigem && !cruzouOrigem }),
      contentType: (res.headers()['content-type'] || '').split(';')[0].trim(),
      bytes, mesmaOrigem, cruzouOrigem, redirecionou, externo, corsCredenciado, preflightCredenciado, preflightVerificado, redirectRejeitaFluxo, preflightCabecalhos,
    });
  };
  // Ocorrência PERDIDA = a vaga fica BURACO (Astra B3 #4); o remendo trata como miss.
  // Só se NOMEIA uma vez por vaga.
  const registrarPerda = (req, u, motivo) => {
    const vaga = vagaPorRaiz.get(pedidoRaiz(req));
    if (!vaga || !vaga.perdido || vaga.nomeada) return;
    vaga.nomeada = true;
    envelopesRepetidosPerdidos.push({ u, motivo, geracao: vaga.geracao });
  };
  // Ocorrência REPETIDA (mesma URL já reservada): o dedup de assets a descartaria e o
  // replay fabricaria a última resposta para sempre (Astra B2 #3). Lê-se o corpo com
  // a MESMA guarda de tamanho (declarado antes de materializar) e um teto de tempo —
  // uma resposta que nunca termina não pode segurar a captura, e vira NOMEADA.
  const ENVELOPE_REPETIDO_TETO_MS = 8_000;
  const MAX_ENVELOPES_REPETIDOS = 60;
  let envelopesRepetidos = 0;
  const envelopesRepetidosPerdidos = [];
  // As MESMAS guardas do caminho principal (Astra B3 #3): rejeição pelo declarado,
  // medida pelo recebido ANTES de materializar, teto agregado pelo livro-razão
  // (`conta`), teto de contagem e teto de tempo. Sem isto sessenta repetições de 4 MiB
  // passavam por cima do orçamento inteiro da captura. O que não entra é NOMEADO e
  // deixa BURACO na lista. Resíduo: o `Promise.race` não cancela a leitura pendente
  // (a API do Playwright não oferece), só deixa de esperá-la.
  // Hop visto numa vaga: se NUNCA vier sucessor (redirect: 'manual' → o site recebe um
  // opaqueredirect, que não é construível em JS), a varredura nomeia isso de forma
  // específica (Astra B6 #3). Resíduo declarado: esse caso é miss no replay.
  // Cada SALTO da cadeia fica registrado na vaga (Astra B80): a elegibilidade a CORS
  // credenciado (e qualquer checagem CORS) vale para TODA resposta da cadeia, nao so a
  // terminal — um 302 com ACAO `*` ja faz o nativo rejeitar `credentials:'include'`.
  const marcarHop = (req, res) => {
    const vaga = vagaPorRaiz.get(pedidoRaiz(req));
    if (!vaga || !vaga.perdido) return;
    vaga.hopVisto = true;
    vaga.ultimoSalto = req;   // o pedido que recebeu o 3xx: `redirectedTo()` diz se o navegador SEGUIU
    if (res) {
      // Idempotente por resposta (Astra B85): o salto e registrado no INICIO do handler,
      // antes de qualquer guarda; as chamadas posteriores nao duplicam.
      vaga.saltosVistos = vaga.saltosVistos || new Set();
      if (vaga.saltosVistos.has(res)) return;
      vaga.saltosVistos.add(res);
      (vaga.saltos = vaga.saltos || []).push({ url: res.url(), headers: res.headers(), status: res.status() });
    }
  };
  const envelopeRepetido = async (req, res, u) => {
    if (!temVaga(req)) return;   // iframe ou vaga impossivel: sem lista, sem orcamento, sem contagem (Astra B67)
    // Salto de redirect NÃO finaliza a vaga: quem a preenche é a resposta terminal
    // da cadeia, sob a identidade do pedido raiz (Astra B4 #1).
    // ⚠️ No evento `response` do 3xx o pedido seguinte pode ainda não existir
    // (`redirectedTo()` nulo) — o 3xx era então NOMEADO como perda e o destino
    // preenchia a vaga em seguida: replay certo, relatório errado. Um 3xx que não é
    // 304 nunca é a resposta terminal de um fetch seguido; se o navegador não seguir,
    // a vaga fica buraco (miss), sem nome — raro e declarado.
    if (ehHop(res)) { marcarHop(req, res); return; }
    if (respostaOpaca(req, res, u)) { registrarEnvelope(req, res, u, null, { opaco: true }); return; }
    const status = res.status();
    if (status === 204 || status === 304) { registrarEnvelope(req, res, u, Buffer.alloc(0)); return; }
    // ⚠️ MEDIDO: o Playwright não entrega corpo de NENHUM 3xx ("Response body is
    // unavailable for redirect responses"), mesmo de um 300 terminal que o site lê.
    // Fabricar envelope vazio replayaria um 300 sem corpo como se fosse a resposta —
    // é perda NOMEADA, e o replay é miss.
    if (status >= 300 && status < 400) { registrarPerda(req, u, 'corpo de 3xx indisponivel na captura'); return; }
    // A vaga de CONTAGEM é tomada ANTES do 1º await (Astra B4 #4): checar antes e
    // incrementar depois deixava 61 repetições concorrentes passarem todas.
    if (envelopesRepetidos >= MAX_ENVELOPES_REPETIDOS) { registrarPerda(req, u, 'limite de envelopes repetidos'); return; }
    envelopesRepetidos += 1;
    let entrou = false;
    const declarado = Number(res.headers()['content-length'] || 0);
    let temporizador = null;
    const teto = new Promise((_, rej) => { temporizador = setTimeout(() => rej(new Error('teto de tempo')), ENVELOPE_REPETIDO_TETO_MS); });
    try {
      if (declarado > ENVELOPE_MAX_BYTES || (declarado && declarado > conta.restante())) { registrarPerda(req, u, 'grande demais (declarado)'); return; }
      await Promise.race([res.finished().catch(() => {}), teto]);
      const medidos = await Promise.race([res.request().sizes().then((t) => t.responseBodySize, () => null), teto]);
      if (Number.isFinite(medidos) && (medidos > ENVELOPE_MAX_BYTES || medidos > conta.restante())) { registrarPerda(req, u, 'grande demais (recebido)'); return; }
      const corpo = await Promise.race([res.body().catch(() => null), teto]);
      // Sem corpo legível = perda NOMEADA, nunca envelope vazio fabricado: não há como
      // distinguir "sem corpo por natureza" de "corpo que a captura não alcançou".
      if (!corpo) { registrarPerda(req, u, 'corpo nao obtido'); return; }
      if (corpo.byteLength > ENVELOPE_MAX_BYTES) { registrarPerda(req, u, 'grande demais'); return; }
      const bilhete = conta.reservar(corpo.byteLength);
      if (bilhete === null) { registrarPerda(req, u, conta.estaFechada() ? 'chegou apos a montagem' : 'orcamento esgotado'); return; }
      conta.confirmar(bilhete);
      entrou = true;
      registrarEnvelope(req, res, u, corpo);
    } catch (e) { registrarPerda(req, u, String(e && e.message || e)); }
    finally { if (temporizador) clearTimeout(temporizador); if (!entrou) envelopesRepetidos -= 1; }
  };
  // ⚠️ O `Promise.race` de fora rejeita, mas nada cancelava a captura — o
  // navegador seguia rolando por horas numa página gigante. Achado P0 do Sol.
  let cancelado = false;
  const aoCancelar = () => { cancelado = true; fecharSePropria(); };
  if (signal) {
    if (signal.aborted) { await fecharSePropria(); throw Object.assign(new Error('native_bundle_aborted'), { code: 'aborted' }); }
    signal.addEventListener('abort', aoCancelar, { once: true });
  }

  try {
    const context = emprestada ? session.context : await browser.newContext({ viewport });
    const page = emprestada ? session.page : await context.newPage();
    if (emprestada) await page.setViewportSize(viewport).catch(() => {});

    // ANUNCIO das chamadas de `window.fetch` do DOCUMENTO DE ENTRADA (Astra B71). O
    // contrato honesto: ocorrencia = chamada que o REMENDO da entrada vai interceptar —
    // e o remendo embrulha `window.fetch` do documento. Frame nao distingue: o Playwright
    // atribui ao frame dono os pedidos de um worker dedicado, que nao tem interceptor,
    // e a lista ficava [WORKER, MAIN]. Um script de inicializacao embrulha `fetch` no
    // MESMO ponto e anuncia (metodo, url) por binding ANTES de despachar; so a chamada
    // anunciada reserva vaga. Worker, iframe e XHR seguem contando para os assets.
    // Ordem: o anuncio e emitido pelo renderer ANTES de despachar o pedido, na mesma
    // sessao CDP, e o binding e entregue antes do evento `request` (medido pelas
    // testemunhas: sem nenhuma pendencia de fallback, toda chamada anunciada casa).
    // Um pedido raiz da entrada que chega SEM anuncio (worker, referencia a `fetch`
    // obtida de outra janela) nao reserva vaga — nunca se casa um anuncio com um
    // pedido anterior (a 1a versao fazia isso e o pedido do WORKER, ja respondido,
    // roubava o anuncio da janela). Anuncios zeram a cada documento novo.
    // Residual declarado: worker e janela chamando a MESMA identidade no mesmo instante
    // podem trocar de lugar.
    // Anuncio SO de chamada que vai despachar (Astra B72): o embrulho constroi o Request
    // efetivo UMA vez (e o 1o passo do proprio fetch), nao anuncia se o sinal ja esta
    // abortado (rejeita sem pedido algum) nem se a construcao falha (o fetch rejeitaria
    // igual), e entrega ESSE Request ao original — nada e consumido duas vezes. Um anuncio
    // que ainda assim nao encontrar pedido em ANUNCIO_TTL_MS e aposentado (o pedido segue
    // o anuncio no mesmo turno do renderer; um caso de nao-despacho desconhecido nao pode
    // ficar a espera de um pedido alheio com a mesma chave).
    const ANUNCIO_TTL_MS = 10_000;
    const anuncios = new Map();      // "METODO\nurl" -> [instantes das chamadas anunciadas ainda sem pedido]
    const chaveDeAnuncio = (m, u) => `${metodoCanonico(m)}\n${String(u).split('#')[0]}`;
    const anunciosVivos = (k) => { const agora = Date.now(); const l = (anuncios.get(k) || []).filter((a) => agora - a.t < ANUNCIO_TTL_MS); if (l.length) anuncios.set(k, l); else anuncios.delete(k); return l; };
    const NOME_DO_ANUNCIO = `__uncraftAnuncioDeFetch_${Math.random().toString(36).slice(2, 10)}`;
    const reservarSePossivel = (req, credenciais, cabecalhos, modo, atributos, documento, politica) => { try { reservarVaga(req, credenciais, cabecalhos, modo, atributos, documento, politica); } catch (_) { /* vaga impossível = sem replay para esta chamada */ } };
    // RETIRADA (Astra B74): uma chamada que rejeita SEM ter despachado pedido (Chromium
    // recusa antes de criar o loader: `same-origin` para outra origem, e o que mais houver)
    // deixaria o anuncio pendente para um worker herdar. O embrulho observa a promessa
    // devolvida: rejeicao => retira UM anuncio pendente da mesma chave (os anuncios de uma
    // chave sao intercambiaveis; se o pedido desta chamada JA consumiu um, so ha pendente
    // se houver um orfao de verdade — o pedido de um irmao anunciado depois precede a
    // rejeicao no renderer). O caso conhecido nem chega a anunciar.
    await page.exposeBinding(NOME_DO_ANUNCIO, (source, evento, metodo, url, credenciais, cabecalhos, modo, tamanhoCorpo, atributos, documento, politica) => {
      if (source.frame !== page.mainFrame()) return;
      const k = chaveDeAnuncio(metodo, url);
      const vivos = anunciosVivos(k);
      if (evento === 'retirada') { if (vivos.length) { vivos.shift(); if (vivos.length) anuncios.set(k, vivos); else anuncios.delete(k); } return; }
      const semProto = Object.create(null);
      if (Array.isArray(cabecalhos)) for (const par of cabecalhos) if (Array.isArray(par) && par.length === 2) semProto[String(par[0]).toLowerCase()] = String(par[1]);
      // Atributos do pedido CONSTRUIDO (Astra B131), so os conhecidos e so primitivos.
      const at = Object.create(null);
      if (atributos && typeof atributos === 'object') for (const [k] of ATRIBUTOS_DE_IDENTIDADE) { const v = atributos[k]; if (typeof v === 'string' || typeof v === 'boolean') at[k] = v; }
      if (typeof credenciais === 'string' && credenciais) at.credentials = credenciais;
      if (typeof modo === 'string' && modo) at.mode = modo;
      if (atributos && atributos.corpoPresente === true) at.corpoPresente = true;
      vivos.push({ t: Date.now(), credenciais: String(credenciais || ''), cabecalhos: semProto, modo: String(modo || ''), tamanho: Number.isInteger(tamanhoCorpo) ? tamanhoCorpo : -1, atributos: at, documento: typeof documento === 'string' ? documento : null, politica: typeof politica === 'string' ? politica : null }); anuncios.set(k, vivos);
    });
    await page.addInitScript((nome) => {
      if (self !== top) return;
      const anunciar = self[nome]; const original = self.fetch;
      if (typeof anunciar !== 'function' || typeof original !== 'function') return;
      try { Object.defineProperty(self, nome, { value: anunciar, enumerable: false, configurable: true, writable: true }); } catch (e) { /* segue visivel */ }
      // Intrinsecos capturados ANTES de qualquer script da pagina (init script).
      // Pre-ligados (uncurried) na inicializacao (Astra B122): guardar a referencia do getter
      // nao basta — `.call` e procurado de novo na funcao, que a pagina alcanca. Defesa em
      // profundidade: a pagina que adultera intrinsecos para sabotar o proprio clone esta fora
      // do modelo de ameaca (decisao de produto, 2026-08-09).
      const LIGAR = Function.prototype.call.bind(Function.prototype.bind);
      const uncurry = function (fn) { return LIGAR(Function.prototype.call, fn); };
      const AB_LEN = uncurry(Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get);
      const TA_LEN = uncurry(Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength').get);
      const DV_LEN = uncurry(Object.getOwnPropertyDescriptor(DataView.prototype, 'byteLength').get);
      const USP_STR = uncurry(URLSearchParams.prototype.toString);
      const E_VIEW = ArrayBuffer.isView;
      const ENC_ENCODE = uncurry(TextEncoder.prototype.encode);
      const ENC = new TextEncoder();
      const BYTES_LEN = uncurry(Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength').get);
      const tamanhoIntrinseco = function (v) {
        try { return AB_LEN(v); } catch (e) { /* nao e ArrayBuffer */ }
        try { if (E_VIEW(v)) { try { return TA_LEN(v); } catch (e) { return DV_LEN(v); } } } catch (e) { /* nao e view */ }
        try { return BYTES_LEN(ENC_ENCODE(ENC, USP_STR(v))); } catch (e) { /* nao e URLSearchParams */ }
        return -1;   // Blob, FormData, fluxo, ou qualquer objeto: desconhecido (grupo excluido)
      };
      // URL do documento no momento da CHAMADA (Astra B132), sem fragmento; '' = a de entrada
      // deste documento (a mesma regra no remendo, onde a entrada e a URL do clone).
      // POLITICA DE REFERRER do documento (Astra B135): Request.referrerPolicy '' herda a do
      // documento, que um <meta name="referrer"> muda sem mudar URL nem atributos. JS nao le a
      // politica, mas ela so muda quando uma meta de referrer entra ou tem o conteudo trocado —
      // acompanhada por MutationObserver, com takeRecords() na chamada (sem atraso de microtarefa).
      // ⚠️ Espelhado LITERALMENTE no remendo. Residual: o cabecalho Referrer-Policy da resposta
      // do documento (constante por documento) nao entra.
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
      const DOC_ENTRADA = String(location.href).split('#')[0];
      const documentoDaChamada = function () { const h = String(location.href).split('#')[0]; return h === DOC_ENTRADA ? '' : h; };
      self.fetch = function (input, init) {
        let pedido;
        // Tamanho do corpo CONHECIVEL de forma sincrona (Astra B116): o construtor e o unico
        // leitor de init.body — um Proxy transparente so anota o valor lido. -1 = desconhecido
        // (FormData, fluxo, corpo herdado de Request): a captura nao pode provar os bytes.
        let lido = { houve: false, valor: undefined };
        let initC = init;
        if (init !== null && (typeof init === 'object' || typeof init === 'function') && typeof Proxy === 'function') {
          initC = new Proxy(init, { get: function (a, p) { const v = Reflect.get(a, p, a); if (p === 'body') { lido.houve = true; lido.valor = v; } return v; } });
        }
        try { pedido = new Request(input, initC); }
        catch (e) { return Promise.reject(e); }   // o erro ORIGINAL, sem reavaliar os argumentos (Astra B73: um getter com estado despacharia na 2a leitura); nada despacha, nada se anuncia
        let despachavel = !(pedido.signal && pedido.signal.aborted);
        // Rejeicoes GARANTIDAS antes de despachar (medidas em Chromium: zero pedidos):
        // 'same-origin' para outra origem; 'no-cors' com redirect != 'follow' para outra
        // origem (Astra B75). Nao anunciam — o remendo rejeita as mesmas antes de alocar.
        try {
          const alheia = new URL(pedido.url).origin !== self.location.origin;
          if (despachavel && alheia && pedido.mode === 'same-origin') despachavel = false;
          if (despachavel && alheia && pedido.mode === 'no-cors' && pedido.redirect !== 'follow') despachavel = false;
        } catch (e) { /* segue anunciavel */ }
        // only-if-cached nunca e anunciado (Astra B124): o replay o rejeita sem alocar, entao a
        // captura tambem nao lhe da vaga — senao a lista desloca e o reload seguinte recebe o
        // envelope do cache.
        if (pedido.cache === 'only-if-cached') despachavel = false;
        if (!despachavel) return original.call(this, pedido);   // rejeita no nativo (ou segue sem vaga), sem anuncio
        try {
          const cabecalhos = []; pedido.headers.forEach(function (v, k) { cabecalhos.push([k, v]); });   // so o que o script pos; PARES sem perda (Astra B115)
          let tamanho = -1;
          const b = lido.houve ? lido.valor : undefined;
          // Corpo HERDADO de Request (Astra B117): o construtor consome o input, entao bodyUsed nao
          // prova ausencia — so pedido.body === null prova. Herdado nao nulo = desconhecido.
          // ... decidido pelo pedido CONSTRUIDO, nunca pelo realm do input (Astra B119: um Request
          // de iframe falha o instanceof da janela e virava 0).
          if (b === undefined || b === null) tamanho = pedido.body === null ? 0 : -1;
          else if (typeof b === 'string') tamanho = new TextEncoder().encode(b).byteLength;
          // Objetos: tamanho SO por getter intrinseco com checagem de marca (Astra B121) —
          // instanceof e protótipo sao falsificaveis (um Blob com protótipo de ArrayBuffer
          // anunciava 0). Marca que nao confere = desconhecido.
          else tamanho = tamanhoIntrinseco(b);
          if (pedido.body === null) tamanho = 0;
          anunciar('anuncio', pedido.method, pedido.url, pedido.credentials, cabecalhos, pedido.mode, tamanho,
            { cache: pedido.cache, credentials: pedido.credentials, mode: pedido.mode, referrer: pedido.referrer, referrerPolicy: pedido.referrerPolicy, corpoPresente: pedido.body !== null },
            documentoDaChamada(), politicaDoDocumento());
        } catch (e) { /* sem anuncio = sem vaga; o pedido segue igual */ }
        // Promessa DERIVADA (nao se marca a original como tratada: o `unhandledrejection`
        // da pagina continua a disparar para quem nao trata) — na rejeicao retira o anuncio.
        return original.call(this, pedido).then(function (v) { return v; }, function (e) {
          try { anunciar('retirada', pedido.method, pedido.url); } catch (e2) { /* nada */ }
          throw e;
        });
      };
    }, NOME_DO_ANUNCIO);

    try {
      const cdp = await page.context().newCDPSession(page);
      const arvore = await cdp.send('Page.getFrameTree');
      const frameTopo = arvore && arvore.frameTree && arvore.frameTree.frame && arvore.frameTree.frame.id;
      await cdp.send('Network.enable');
      cdp.on('Network.requestWillBeSent', (p) => {
        if (!p || !p.request) return;
        if (p.initiator && p.initiator.type === 'preflight' && p.initiator.requestId) { preflightDe.set(p.requestId, p.initiator.requestId); return; }
        if (p.type !== 'Fetch' || !frameTopo || p.frameId !== frameTopo) return;
        if (pedidosCdp.has(p.requestId)) return;   // salto de redirect: a raiz e a 1a
        const novo = { metodo: String(p.request.method).toUpperCase(), url: String(p.request.url).split('#')[0], preflightOk: false, consumido: false, ambiguo: false };
        // Sobreposicao ja no INICIO (Astra B113): outro pedido nao consumido com o mesmo
        // (metodo, URL) em voo torna os dois ambiguos, qualquer que seja a ordem de termino.
        for (const outro of pedidosCdp.values()) if (!outro.consumido && outro.url === novo.url && outro.metodo === novo.metodo) { outro.ambiguo = true; novo.ambiguo = true; }
        pedidosCdp.set(p.requestId, novo);
      });
      cdp.on('Network.responseReceived', (p) => {
        if (!p || p.type !== 'Preflight' || !p.response) return;
        const st = Number(p.response.status);
        if (!(st >= 200 && st < 300)) return;
        const alvo = pedidosCdp.get(preflightDe.get(p.requestId));
        if (alvo) alvo.preflightOk = true;
      });
    } catch { /* sem CDP: nenhum preflight e certificado (fail-closed) */ }
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame() || !navegacaoPendente) return;   // same-document ou 204/download: o documento nao trocou
      navegacaoPendente = false;
      geracaoDoc += 1;   // novo documento de entrada COMMITADO (Astra B68/B69)
      anuncios.clear();   // anuncios de um documento nao valem para o proximo
    });
    page.on('request', (req) => {
      ordemDoPedido.set(req, ++seqPedido);
      // TODA URL de uma cadeia de fetch (raiz E sucessores de redirect) entra nos caminhos
      // protegidos JA no pedido (Astra B88), independente de o envelope chegar a ser
      // registrado: um terminal de midia same-origin saia pela guarda antes de
      // `registrarEnvelope`, a repescagem o publicava sem `tipo` e um miss de identidade
      // (outro api-key) recebia a copia estatica — a resposta de OUTRO pedido.
      // ... e tambem XHR (Astra B89): a chamada respondida errado seria um `fetch` do replay ao
      // asset que um XHR de mídia (api-key A) deixou na repescagem sem `tipo`. A RESERVA de
      // vaga continua so para fetch; a PROTECAO cobre tudo o que um script pediu.
      if (ehChamadaDeFetch(req) || req.resourceType() === 'xhr') urlsDeFetch.add(req.url());
      // Só o pedido RAIZ (não um salto de redirect) do documento de entrada, ANUNCIADO
      // pelo seu `window.fetch`, ganha vaga na lista.
      if (ehChamadaDeFetch(req) && doDocumentoDeEntrada(req) && !req.redirectedFrom()) {
        const k = chaveDeAnuncio(req.method(), req.url());
        const vivos = anunciosVivos(k);
        if (vivos.length) {
          const a = vivos.shift(); if (!vivos.length) anuncios.delete(k);
          // Corpo PROVADO (Astra B116): o Chromium omite bytes de Blob/arquivo do postData e o
          // Playwright devolveria vazio — "ausente" viraria "vazio" e colidiria com o pedido sem
          // corpo. So reserva quando o tamanho anunciado e conhecido e bate com os bytes vistos.
          let visto = null; try { visto = req.postDataBuffer(); } catch { visto = null; }
          const nVisto = visto ? visto.length : 0;
          if (a.tamanho >= 0 && a.tamanho === nVisto) reservarSePossivel(req, a.credenciais, a.cabecalhos, a.modo, a.atributos, a.documento, a.politica);
          // Omitir a chamada DESLOCA a ordem das ocorrencias (Astra B118): no replay ela casaria a
          // ocorrencia de outra. O grupo (metodo, URL) inteiro sai do replay — miss, nunca troca.
          else gruposEnvenenados.add(`${metodoCanonico(req.method())} ${String(req.url()).split('#')[0]}`);
        }
      }
    });
    page.on('requestfailed', (req) => {
      const u = req.url();
      if (!/^https?:/i.test(u)) return;
      const erro = req.failure()?.errorText || 'desconhecido';
      // Só o PRIMEIRO registro por URL: uma retentativa que falhe de novo não
      // muda o veredito, e uma que tenha sucesso aparece em `recursos` — é lá
      // que a decisão final é tomada, nunca aqui.
      if (!recusados.has(u)) recusados.set(u, { erro, tipo: req.resourceType() });
    });

    page.on('response', (res) => {
      const tarefa = (async () => {
        const u = res.url();
        let registrei = false;
        try {
          if (cancelado || !/^https?:/i.test(u)) return;
          // Documento PRINCIPAL recarregado na MESMA URL substitui o anterior
          // (Astra r1 #1, 2026-09-06): uma interstitial de challenge que limpa
          // e recarrega U deixaria o dedup por URL descartar o documento REAL,
          // o detector veria a página boa e o pacote sairia com a interstitial.
          // O último documento navegado é o que o navegador está mostrando.
          // Os bytes do anterior ficam contados na contabilidade — sobra
          // conservadora, nunca fura o teto.
          const req = res.request();
          // SALTO registrado ANTES de qualquer guarda ou await (Astra B85): os filtros de
          // asset (midia, tamanho declarado) saiam antes de `marcarHop` e a cadeia ficava
          // incompleta — o terminal sozinho passava na validacao CORS.
          if (ehHop(res) && ehChamadaDeFetch(req)) marcarHop(req, res);
          // ⭐ SALTOS que levaram a esta resposta (2026-10-05): o HTML referencia a URL PEDIDA
          // (`unpkg.com/@barba/core`), o arquivo e guardado pela FINAL (`@barba/core@2.10.3/...`); sem o
          // apelido a referencia ficava fora do pacote, o script nao carregava e o codigo do site parava.
          // Registrado AQUI, antes do dedup (Astra r1 #2: destino ja guardado ou dois apelidos convergentes
          // se perdiam), e so para recurso ESTATICO (chamada fetch/XHR tem identidade propria no replay).
          if (!ehHop(res) && TIPOS_DE_APELIDO.has(req.resourceType())) {
            const saltos = []; for (let r = req.redirectedFrom(); r; r = r.redirectedFrom()) saltos.push(r.url());
            if (saltos.length) { const conj = apelidosDeRedirect.get(u) || new Set(); for (const x of saltos) conj.add(x); apelidosDeRedirect.set(u, conj); }
          }
          const documentoPrincipal = req.resourceType() === 'document' && req.isNavigationRequest() && req.frame() === page.mainFrame();
          if (documentoPrincipal && !ehHop(res)) navegacaoPendente = respostaQueViraDocumento(res);   // o commit e o `framenavigated` que segue (sincrono, antes de qualquer await)
          // So um substituto que PODE COMMITAR substitui o documento capturado (Astra B70):
          // uma recarga que responde 204/205 (ou download) na MESMA URL deixa o documento
          // vivo — e anulava o HTML ja capturado da entrada. Salto tampouco commita.
          const trocaDocumento = documentoPrincipal && !ehHop(res) && respostaQueViraDocumento(res);
          if (recursos.has(u) && !trocaDocumento) {
            if (ehChamadaDeFetch(req) && !cancelado) await envelopeRepetido(req, res, u);
            return;
          }
          // GERAÇÃO por URL: o recarregamento pode chegar enquanto o handler da
          // interstitial ainda lê o corpo (vaga ainda nula) — substituir "só
          // vaga preenchida" descartava o documento real por timing (oscilou
          // no teste). O último documento navegado é o dono; depois de esperar,
          // quem não for mais o dono sai calado.
          const geracaoMinha = (geracao.get(u) || 0) + 1;
          geracao.set(u, geracaoMinha);
          // Só quem REGISTROU desregistra, e por contagem: uma resposta
          // duplicada que sai cedo (ou uma geração antiga terminando) não
          // pode apagar o marcador de quem ainda lê (Astra r2 #3).
          lendo.set(u, (lendo.get(u) || 0) + 1);
          registrei = true;
          // ⚠️ RESERVA ANTES DE QUALQUER `await`. É o que torna a dupla
          // `has` + `set` atômica: em JavaScript nada intercala entre as duas
          // se não houver espera no meio. A checagem de host estava aqui e
          // furava a guarda — duas respostas simultâneas da mesma URL passavam
          // pelo `has` antes de qualquer uma reservar, e mídia pedida por
          // FAIXAS é exatamente o caso que produz respostas simultâneas da
          // mesma URL (Sol). Medir zero duplicações num clone não prova
          // impedimento: prova que a corrida não aconteceu naquela execução.
          if (recursos.size >= MAX_ASSETS) { descartados.push({ u, motivo: 'limite de arquivos' }); return; }
          recursos.set(u, null);
          if (!(await hostEhPublico(new URL(u).hostname))) {
            recursos.delete(u); descartados.push({ u, motivo: 'host nao publico' }); return;
          }
          // ⚠️ MÍDIA NÃO PASSA PELO `body()`. É o caso onde cabeçalho mentir
          // DÓI de verdade — vídeo de dezenas de MB bufferizado inteiro só
          // para ser recusado — e o `body()` de mídia costuma falhar de toda
          // forma (faixas 206, buffer que o Chromium não guarda). A reserva
          // fica NULA e a repescagem, que tem teto DURANTE a leitura, busca o
          // arquivo completo. Fecha o grosso do residual de memória.
          // Duas leituras somadas: `resourceType` classifica quem INICIOU o
          // pedido (o <video>), e um vídeo baixado por fetch/XHR chega como
          // 'fetch' — só o content-type da RESPOSTA o entrega (Sol).
          // Fetch CROSS-ORIGIN (terminal ou cadeia cruzada) decidido ANTES da guarda de midia
          // (Astra B86): um terminal `video/*` sem ACAO saia pela guarda com a reserva nula, a
          // repescagem o baixava e guardava como asset — sem `tipo` e fora de `urlsDeFetch`,
          // logo desprotegido e legivel no clone. Nunca asset; opaco fecha o envelope aqui;
          // legivel segue para o ramo de envelope (que le o corpo com teto).
          const fetchAlheio = !ehHop(res) && fetchCrossOrigin(req, u);
          if (fetchAlheio && !cadeiaLegivel(req, res)) {
            // Opaco: solta a reserva (nunca asset, a repescagem nao re-busca) e fecha o
            // envelope. O legivel NAO solta aqui: a reserva nula e o bilhete que o ramo de
            // envelope, mais abaixo, exige para registrar ("so quem ainda segura decide").
            recursos.delete(u);
            descartados.push({ u, motivo: 'resposta opaca (fetch cross-origin sem CORS)' });
            if (temVaga(req)) registrarEnvelope(req, res, u, null, { opaco: true });
            return;
          }
          const tipoResposta = (res.headers()['content-type'] || '').split(';')[0].trim();
          // Midia LEGIVEL de fetch cross-origin (Astra B87) NAO passa pela guarda de midia: ela
          // e envelope (com os tetos do ramo de envelope), nunca asset da repescagem — a guarda
          // a mandava para a repescagem, que a guardava como asset desprotegido, e a lista
          // ficava com buraco.
          if (!fetchAlheio && (res.request().resourceType() === 'media' || /^(?:video|audio)\//i.test(tipoResposta))) {
            // Salto de uma cadeia de FETCH nunca e asset (Astra B85): deixar a reserva nula
            // fazia a repescagem re-buscar a URL do salto pelo Node, seguir o redirect e
            // guardar o corpo TERMINAL como asset sob o caminho do salto — legivel no clone.
            if (ehHop(res) && ehChamadaDeFetch(req)) recursos.delete(u);
            return;
          }
          // ⚠️ REJEIÇÃO ANTECIPADA, não proteção de memória. `content-length` é
          // opcional, pode mentir e pode vir comprimido — quando falta ou está
          // errado, `res.body()` carrega o arquivo inteiro do mesmo jeito, e a
          // API de interceptação do Playwright não oferece leitura em fluxo.
          //
          // Ou seja: o cabeçalho poupa memória no caso comum (servidor honesto
          // anunciando arquivo grande) e não poupa nada no caso adversário. O
          // teto DEPOIS da leitura continua valendo, e é ele que garante que o
          // arquivo não entre no pacote. Quem tem limite de verdade durante a
          // leitura é a repescagem, que usa `fetch` com `getReader()` (Sol).
          //
          // Residual assumido, agora estreito: pico de memória de UM corpo
          // NÃO-mídia com cabeçalho ausente ou mentiroso — limitado ao que o
          // navegador já baixou, num site que o modelo de ameaça assume
          // honesto (decisão de 2026-08-09).
          const declarado = Number(res.headers()['content-length'] || 0);
          if (declarado > MAX_ASSET_BYTES || (declarado && declarado > conta.restante())) {
            recursos.delete(u); descartados.push({ u, motivo: 'grande demais (declarado)' });
            // Um SALTO nunca carrega o corpo: nomea-lo como perda era espurio (o terminal
            // preenche a vaga logo a seguir) — Astra B85 colateral.
            if (ehChamadaDeFetch(req) && !ehHop(res)) registrarPerda(req, u, 'grande demais (declarado)');
            return;
          }
          // SEGUNDA BARREIRA (Sol): sem content-length ainda dá para saber o
          // tamanho ANTES de materializar — `finished()` + `sizes()` entrega
          // os bytes RECEBIDOS (codificados). Rejeitar aqui evita o body() de
          // um corpo grande sem cabeçalho. Conservador com compressão: o
          // decodificado pode ser maior; o teto DEPOIS do body() segue sendo
          // a autoridade final.
          await res.finished().catch(() => {});
          const medidos = await res.request().sizes().then((t) => t.responseBodySize, () => null);
          if (Number.isFinite(medidos) && (medidos > MAX_ASSET_BYTES || medidos > conta.restante())) {
            recursos.delete(u); descartados.push({ u, motivo: 'grande demais (recebido)' });
            if (ehChamadaDeFetch(req)) registrarPerda(req, u, 'grande demais (recebido)');
            return;
          }
          const bytes = await res.body().catch(() => null);
          // ⚠️ DEPOIS de esperar, a reserva pode não ser mais minha (Astra r1
          // #3): com a coleta limitada, uma resposta original que só termina
          // depois do teto encontra a vaga já PREENCHIDA pela repescagem — ou
          // já PURGADA. Mexer nela apagaria um asset bom (`delete` no ramo de
          // teto) ou o contaria duas vezes (`confirmar` + `set`). Só quem ainda
          // segura a reserva nula decide; os outros saem calados.
          if (recursos.get(u) !== null || geracao.get(u) !== geracaoMinha) return;
          // Resposta OPACA de fetch cross-origin (não é salto): fora do pacote, envelope
          // marcador — decidido ANTES de olhar o corpo, que a página nunca leu.
          // Fetch CROSS-ORIGIN (não é salto): NUNCA vira asset (Astra B16/B17) — o literal
          // fica absoluto e o pedido segue cross-origin no clone, onde o modo decide.
          // Legível (ACAO da página ou `*`) → envelope com corpo; senão → marcador opaco.
          if (!ehHop(res) && fetchCrossOrigin(req, u)) {
            const legivel = cadeiaLegivel(req, res);
            recursos.delete(u); descartados.push({ u, motivo: legivel ? 'fetch cross-origin: so envelope, nunca asset' : 'resposta opaca (fetch cross-origin sem CORS)' });
            if (!temVaga(req)) return;   // iframe: nunca asset (acima), mas tambem nenhum envelope/orcamento (Astra B67)
            if (!legivel) { registrarEnvelope(req, res, u, null, { opaco: true }); return; }
            // Envelope legível fora do mapa de assets: passa pelo MESMO livro-razão e
            // pelo MESMO teto de contagem dos envelopes repetidos (Astra B19) — sem
            // isto 61 respostas de 4 MiB somavam 244 MiB com o razão em zero. Recusa =
            // buraco NOMEADO.
            if (!bytes) { registrarPerda(req, u, 'corpo nao obtido'); return; }
            if (bytes.byteLength > ENVELOPE_MAX_BYTES) { registrarPerda(req, u, 'envelope grande demais'); return; }
            if (envelopesRepetidos >= MAX_ENVELOPES_REPETIDOS) { registrarPerda(req, u, 'limite de envelopes'); return; }
            const reservaEnv = conta.reservar(bytes.byteLength);
            if (reservaEnv === null) { registrarPerda(req, u, conta.estaFechada() ? 'chegou apos a montagem' : 'orcamento esgotado'); return; }
            conta.confirmar(reservaEnv);
            envelopesRepetidos += 1;
            registrarEnvelope(req, res, u, bytes);
            return;
          }
          if (!bytes) {
            const status = res.status();
            // 204/304 não têm corpo por natureza. Redirect PODE ter corpo
            // (uma página "Moved") — mas esse corpo nunca é conteúdo: o
            // navegador não o renderiza, segue para o destino, e o destino
            // chega como resposta PRÓPRIA, com URL própria, capturada por si.
            // Guardar a vaga faria a repescagem buscar a URL do redirect e
            // duplicar o destino sob outro nome.
            //
            // Mas "redirecionou de fato" é veredito do NAVEGADOR, não
            // inferência por cabeçalho: `Location` presente não prova que foi
            // seguido (um 300 carrega Location e o navegador fica). O fato é
            // `request().redirectedTo()` — medido no ponto exato desta
            // decisão: 301 seguido aponta o sucessor, 300 parado vem nulo.
            // Quem não redirecionou fica como reserva nula: a repescagem
            // tenta, e se também não conseguir, a URL entra NOMEADA no
            // relatório em vez de sumir calada (Sol, 4 rodadas até aqui).
            // Envelope de fetch SEM corpo: 204/304 é resposta legítima (vazia) e vira
            // envelope; redirect não registra (o destino registra sob a identidade
            // RAIZ); o resto é ocorrência perdida = BURACO na lista (Astra B3 #4).
            if (ehChamadaDeFetch(req)) {
              if (status === 204 || status === 304) registrarEnvelope(req, res, u, Buffer.alloc(0));
              else if (ehHop(res)) marcarHop(req, res);
              else registrarPerda(req, u, status >= 300 && status < 400 ? 'corpo de 3xx indisponivel na captura' : 'corpo nao obtido');
            }
            const redirecionou = status >= 300 && status < 400 && Boolean(res.request().redirectedTo());
            if (status === 204 || status === 304 || redirecionou) { recursos.delete(u); return; }
            // ⚠️ O RESTO FICA COMO RESERVA NULA — é exatamente isso que a
            // repescagem procura (`filter(([, v]) => !v)`). Apagar aqui fazia
            // `faltantes` nascer sempre vazio e a repescagem virar código
            // morto: medido no site real, a etapa `retrying` nunca disparava e
            // os dois vídeos ficavam de fora. Quem apaga e nomeia no relatório
            // é o purgo DEPOIS da repescagem.
            //
            // É o caso comum de mídia: vídeo é pedido por FAIXAS de bytes, e o
            // corpo dessas respostas não é legível pela interceptação.
            return;
          }
          // ⚠️ 206 PARCIAL com corpo legível EXISTE — medido no site real
          // (`bytes=622592-` chegou legível com 2,3MB de um arquivo de 2,9MB).
          // Guardá-lo como o arquivo inteiro poria um pedaço do MEIO do vídeo
          // no lugar do vídeo; hoje a ordem das respostas salva, e ordem não é
          // garantia. Só entra 206 cujo Content-Range cobre o arquivo inteiro
          // E cujo corpo tem exatamente esse tamanho; o resto fica como
          // reserva nula, e a repescagem busca o arquivo completo, sem Range.
          if (res.status() === 206) {
            const cobertura = parseContentRange(res.headers()['content-range']);
            const completo = cobertura
              && cobertura.inicio === 0
              && cobertura.fim === cobertura.total - 1
              && bytes.byteLength === cobertura.total;
            if (!completo) return;
          }
          const bilhete = bytes.byteLength > MAX_ASSET_BYTES ? null : conta.reservar(bytes.byteLength);
          if (!bilhete) {
            // Contabilidade FECHADA não é "grande demais": é corpo que chegou
            // depois da montagem (a página viva ainda pede coisas entre o
            // fechamento e o retorno). O rótulo fabricado ia parar no
            // relatório do usuário (Claude review r1 #1).
            recursos.delete(u);
            descartados.push({ u, motivo: conta.estaFechada() ? 'chegou apos a montagem' : 'grande demais' });
            return;
          }
          // O corpo já está em mão: confirma na hora.
          conta.confirmar(bilhete);
          // ⚠️ O TIPO do recurso é guardado porque `fetch`/`xhr` precisam de
          // tratamento próprio na montagem: a URL deles é construída em código e
          // a reescrita estática não a alcança (ver o remendo de fetch abaixo).
          recursos.set(u, {
            bytes,
            contentType: (res.headers()['content-type'] || '').split(';')[0].trim(),
            tipo: req.resourceType(),
            varia: variaPorPedido(res.headers()['vary']),
          });
          // ⭐ ENVELOPE DE REPLAY para fetch/XHR — AQUI, com os bytes já em mão e
          // depois de TODAS as guardas (host, mídia, tamanho medido antes de
          // materializar, contabilidade). Uma versão anterior lia o corpo mais cedo,
          // antes da reserva: quebrava a ordem que os testes do Sol protegem e deixava
          // uma resposta que nunca termina SEM reserva — logo sem nome no relatório.
          // Resíduo declarado: um 2º POST para a MESMA URL com outro corpo não entra
          // (o dedup por URL fica intacto); a identidade por corpo já está na chave,
          // então estender é só registrar antes do dedup — com as mesmas guardas.
          if (ehChamadaDeFetch(req)) {
            if (bytes.byteLength <= ENVELOPE_MAX_BYTES) registrarEnvelope(req, res, u, bytes);
            else registrarPerda(req, u, 'envelope grande demais');
          }
        } catch (_) { /* resposta sem corpo (redirect, 204, 304) não é falha */ }
        finally {
          if (registrei) {
            const n = (lendo.get(u) || 1) - 1;
            if (n <= 0) lendo.delete(u); else lendo.set(u, n);
          }
        }
      })();
      emVoo.add(tarefa);
      tarefa.finally(() => emVoo.delete(tarefa));
    });

    onProgress({ etapa: 'navigating' });
    await page.goto(url, { waitUntil: 'load', timeout: 90000 });
    await page.waitForTimeout(2500);

    // Interstitial de bot-protection (Cloudflare "Just a moment…", hCaptcha,
    // Akamai, PerimeterX): a captura de referência já recusa e entrega o
    // handoff humano; este produtor NÃO recusava e empacotaria a interstitial
    // COMO o site (medido no amigosecreto, 2026-09-06). Mesmo detector, mesmo
    // erro tipado — a rota devolve 409 e a UI reaproveita o fluxo do modal.
    //
    // Com TOLERÂNCIA: uma interstitial pode se limpar sozinha e recarregar a
    // mesma URL (é o que a "managed challenge" faz num navegador comum), e o
    // veredito tem que ser sobre o documento ESTÁVEL — medido no teste: o
    // recarregamento já tinha sido servido e o detector ainda via a
    // interstitial porque o navegador não tinha trocado o documento. Re-checa
    // por até CHALLENGE_TOLERANCIA_MS; só recusa o que PERSISTE (o site real
    // medido persistiu 45s+ — recusa em 5s em vez de estourar 90s).
    //
    // ⚠️ O detector é FAIL-OPEN (exceção → null): um contexto destruído por
    // navegação NO MEIO da re-checagem viraria "limpou" (Astra r2 #1). Por
    // isso o veredito que libera é sempre o de um documento CARREGADO — depois
    // de qualquer null, espera o load e checa de novo dentro do prazo.
    // Modo ESTRITO: `null` = olhei e está limpo (libera); objeto = challenge;
    // `undefined` = não consegui olhar (NÃO libera — segue tentando no prazo).
    let veredito = await detectChallengePage(page, { strict: true });
    if (veredito !== null) {
      const limite = Date.now() + challengeToleranceMs;
      let ultimo = veredito || null;
      for (;;) {
        if (Date.now() >= limite || cancelado) {
          const k = ultimo || { kind: 'generic_challenge', signals: ['uninspectable'] };
          throw new ChallengeRequiredError(k.kind, url, k.signals);
        }
        await page.waitForTimeout(500);
        // Documento que não terminou de carregar também é "não consegui
        // olhar" — um veredito limpo só vale sobre documento carregado
        // (Astra r3; defesa em profundidade, site hostil está fora do modelo).
        const carregou = await page.waitForLoadState('load', { timeout: 2000 }).then(() => true, () => false);
        veredito = carregou ? await detectChallengePage(page, { strict: true }) : undefined;
        if (veredito === null) break;
        if (veredito) ultimo = veredito;
      }
    }

    // Percorre a página inteira: recurso preguiçoso só é pedido quando entra na
    // tela, e sem isso o bundle sairia sem metade das imagens.
    onProgress({ etapa: 'scrolling' });
    // Um site que NAVEGA (recarrega) no meio da rolagem destroi o contexto do `evaluate`
    // e derrubava a captura inteira (visto na suite completa sob carga; deterministico na
    // testemunha). O documento novo e o dono (geracao): espera-se o load e rola-se de novo
    // do topo, com teto de tentativas. Outros erros seguem subindo.
    const contextoDestruido = (e) => /Execution context was destroyed|Cannot find context with specified id|Frame was detached|Execution context is not available/i.test(String((e && e.message) || e));
    for (let tentativa = 0; ; tentativa += 1) {
      try {
        const altura = Math.min(await page.evaluate(() => document.body.scrollHeight), MAX_ALTURA_PX);
        for (let y = 0; y < altura && !cancelado; y += 700) {
          await page.evaluate((v) => window.scrollTo(0, v), y);
          await page.waitForTimeout(160);
        }
        break;
      } catch (e) {
        if (!contextoDestruido(e) || tentativa >= 3) throw e;
        await page.waitForLoadState('load', { timeout: 15000 }).catch(() => {});
      }
    }
    if (cancelado) throw Object.assign(new Error('native_bundle_aborted'), { code: 'aborted' });
    await page.evaluate(() => window.scrollTo(0, 0)).catch((e) => { if (!contextoDestruido(e)) throw e; });
    await page.waitForTimeout(1200);

    // A referência do SSIM permanente: o site VIVO, topo, assentado — tirada
    // AQUI porque depois desta linha a página ainda muda (fechamento dispara
    // buscas) e o browser fecha antes de qualquer medição externa. Fail-open.
    let screenshotVivo = null;
    try {
      const png = await page.screenshot({ type: 'png' });
      screenshotVivo = `data:image/png;base64,${png.toString('base64')}`;
    } catch (_) { /* sem referência = sem medida, nunca sem clone */ }

    // FECHAMENTO DE REFERÊNCIAS (defeito 1b, 2026-08-20): o browser só pediu o
    // candidato de `srcset` que o viewport da captura escolheu e os backgrounds
    // de regras CSS que algum elemento casou. Tudo que ficar de fora permanece
    // ABSOLUTO no HTML/CSS gravado e a CSP do gateway (img-src 'self') bloqueia
    // para sempre. Duas fases DE PROPÓSITO (achado P0 do Sol, 2026-08-20):
    // (1) coletar os candidatos na página; (2) filtrar no Node com
    // `hostEhPublico` ANTES de carregar — a guarda do handler de response só
    // roda depois que o pedido já saiu. Isto checa a URL INICIAL dos GETs que
    // NÓS iniciamos; NÃO é política de egress completa: um 3xx para endereço
    // privado escapa (Sol r2 #1), e rebind DNS idem (lookup aqui, o browser
    // re-resolve — mesmo resíduo da rota from-url, 182). Ambos exigem site
    // adversarial, que está FORA do modelo de ameaça por decisão registrada
    // (178/171, mesmos 7 gatilhos); a guarda de EXFILTRAÇÃO (persistir corpo)
    // segue no handler de response, que era o P0 original do 179. Egress por
    // request (route interception por hop) é a re-arquitetura deferida.
    // Os aprovados carregam via `new Image()` (sem CORS) e entram pela
    // interceptação normal — limites e relatório se aplicam por construção.
    onProgress({ etapa: 'closing-refs' });
    const candidatosBrutos = await page.evaluate((cap) => {
      // Parser duplicado de srcsetCandidateUrls DE PROPÓSITO: page.evaluate
      // não serializa closures do Node; o teste unitário cobre o exportado.
      const parseSrcset = (value) => {
        if (typeof value !== 'string' || !value.trim()) return [];
        const urls = [];
        let rest = value.trim();
        while (rest) {
          rest = rest.replace(/^[,\s]+/, '');
          if (!rest) break;
          const token = /^\S+/.exec(rest)[0];
          rest = rest.slice(token.length);
          const url = token.replace(/,+$/, '');
          if (url) urls.push(url);
          if (token.endsWith(',')) continue;
          let depth = 0;
          let i = 0;
          while (i < rest.length) {
            const ch = rest[i];
            if (ch === '(') depth += 1;
            else if (ch === ')') depth = Math.max(0, depth - 1);
            else if (ch === ',' && depth === 0) break;
            i += 1;
          }
          rest = rest.slice(i);
        }
        return urls;
      };
      const seen = new Set();
      const candidatos = [];
      const push = (u, base) => {
        let abs = null;
        try { abs = new URL(u, base || document.baseURI).href; } catch { return; }
        if (!/^https?:/i.test(abs) || seen.has(abs)) return;
        seen.add(abs);
        candidatos.push(abs);
      };
      // `querySelectorAll` does not enter <template>, whose content is a
      // separate fragment — markup that a site clones into the page later
      // (Sol). Collect the roots first and query each of them.
      const raizes = [document];
      const filaTpl = [...document.querySelectorAll('template')];
      while (filaTpl.length && raizes.length < 500) {
        const tpl = filaTpl.shift();
        if (!tpl.content) continue;
        raizes.push(tpl.content);
        filaTpl.push(...tpl.content.querySelectorAll('template'));
      }
      const buscarTodos = (sel) => raizes.flatMap((raiz) => [...raiz.querySelectorAll(sel)]);
      for (const el of buscarTodos('img[srcset], source[srcset]')) {
        for (const u of parseSrcset(el.getAttribute('srcset'))) push(u);
      }
      // The plain `src` is skipped by the browser whenever a srcset candidate
      // wins, so it never reaches the interception — and then the rewriter has
      // nowhere to point it, leaving a broken fallback (measured 2026-08-21).
      for (const el of buscarTodos('img[src], source[src], video[src], audio[src], video[poster]')) {
        const raw = el.getAttribute('src') || el.getAttribute('poster');
        if (raw) push(raw);
      }
      for (const el of buscarTodos('[data-srcset]')) {
        for (const u of parseSrcset(el.getAttribute('data-srcset'))) push(u);
      }
      for (const el of buscarTodos('link[imagesrcset]')) {
        for (const u of parseSrcset(el.getAttribute('imagesrcset'))) push(u);
      }
      // Icons: the browser fetches at most the one it picks for the tab, so
      // the alternates stay uncaptured and their references end up blocked.
      for (const el of buscarTodos('link[rel*="icon"][href], link[rel="apple-touch-icon"][href]')) {
        push(el.getAttribute('href'));
      }
      const urlRe = () => /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
      for (const sheet of document.styleSheets) {
        let rules;
        try { rules = sheet.cssRules; } catch { continue; }
        const base = sheet.href || document.baseURI;
        for (const rule of rules) {
          const text = rule.cssText || '';
          const re = urlRe();
          let m;
          while ((m = re.exec(text))) push(m[2], base);
        }
      }
      for (const el of buscarTodos('[style*="url("]')) {
        const re = urlRe();
        let m;
        const text = el.getAttribute('style') || '';
        while ((m = re.exec(text))) push(m[2]);
      }
      return candidatos.slice(0, cap);
      // Sanity ceiling only. The REAL budget is applied on the Node side,
      // after dropping candidates already captured — cutting here would let
      // already-present URLs at the head of the list eat the whole budget and
      // hide the missing ones behind them (Sol).
    }, 5000).catch(() => []);
    const aprovados = [];
    const orcamento = Math.max(0, MAX_ASSETS - recursos.size);
    for (const u of candidatosBrutos) {
      if (cancelado || aprovados.length >= orcamento) break;
      if (recursos.has(u)) continue;   // já capturado: não gasta orçamento
      try {
        if (await hostEhPublico(new URL(u).hostname)) aprovados.push(u);
        else descartados.push({ u, motivo: 'host nao publico' });
      } catch (_) { /* URL inválida não carrega */ }
    }
    const refsExtras = aprovados.length === 0 ? 0 : await page.evaluate(async (urls) => {
      await Promise.all(urls.map((u) => new Promise((done) => {
        const img = new Image();
        img.onload = done;
        img.onerror = done;
        setTimeout(done, 8000);
        img.src = u;
      })));
      return urls.length;
    }, aprovados).catch(() => 0);
    if (cancelado) throw Object.assign(new Error('native_bundle_aborted'), { code: 'aborted' });
    // Respostas dos candidatos ainda podem estar em voo; o allSettled do
    // 'collecting' logo abaixo as espera junto com todo o resto.

    // DESIGN.MD typography — computed-style measurement of the LIVE page
    // (same probe as lib/snapshot.js), run BEFORE the collection settles ON
    // PURPOSE: getComputedStyle can trigger late font fetches, and a response
    // arriving after the purge loop would crash the destructure or mutate the
    // supposedly immutable assets/contentHash (Sol review, reproduced). Inside
    // the interception window, anything it triggers is collected normally.
    // Best-effort by construction: failure yields null, capture untouched.
    // page (same probe as lib/snapshot.js). Best-effort by construction: any
    // failure yields null and the capture proceeds untouched. The value rides
    // the producer OUTPUT as a sibling of `bundle` — NEVER inside it — so the
    // bundle's content hash, runtime fingerprint, and every existing clone
    // stay byte-identical (no price to pay).
    const typeSample = await page.evaluate(() => {
      const pick = (selectors) => {
        for (const sel of selectors) {
          let el = null;
          try { el = [...document.querySelectorAll(sel)].find((cand) => { const r = cand.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (cand.textContent || '').trim().length > 2; }); } catch { /* bad selector */ }
          if (el) {
            const cs = getComputedStyle(el);
            const family = (cs.fontFamily.split(',')[0] || '').replace(/["']/g, '').trim();
            const size = Math.round(parseFloat(cs.fontSize) || 0);
            if (family && size > 0) return { family, size, weight: Number(cs.fontWeight) || 400 };
          }
        }
        return null;
      };
      const display = pick(['h1', 'h2', '[class*="hero"] *']);
      const body = pick(['main p', 'p', 'body']);
      return (display || body) ? { display, body } : null;
    }).catch(() => null);

    onProgress({ etapa: 'collecting' });
    // Espera os corpos que ainda estavam sendo lidos ANTES de montar o bundle —
    // COM TETO. Medido em site real (amigosecreto, 2026-09-06): um beacon da
    // Cloudflare (`fetch` 204) cujo `finished()` NUNCA resolvia segurou esta
    // espera por 45s+, o prazo de 90s da rota estourou e a captura inteira
    // virou 504 + reembolso, com a página já toda em mãos. Uma resposta que
    // não termina não pode ser refém da coleta: passado o teto, o que ainda
    // está em voo fica como reserva nula e o purgo abaixo o NOMEIA no
    // relatório ('corpo nao chegou'). Um corpo já recebido resolve na hora,
    // então o teto só morde quem de fato não terminou.
    await Promise.race([
      Promise.allSettled([...emVoo]),
      new Promise((resolve) => setTimeout(resolve, COLETA_TETO_MS)),
    ]);
    // Quem ainda estava lendo quando o teto mordeu NÃO vai à repescagem: o
    // navegador não terminou em COLETA_TETO_MS, e pedir de novo pelo Node
    // custaria mais 12s por arquivo em cima do mesmo endpoint travado. Fica
    // como reserva nula e o purgo o nomeia ('corpo nao chegou').
    const presos = new Set(lendo.keys());

    // ⭐ UMA SEGUNDA TENTATIVA, pelo servidor, antes de desistir.
    //
    // Medido no clone real: 3 imagens ficaram de fora com "corpo nao chegou", e
    // como o carrossel as repete, 7 quadros do site aparecem vazios. Não é
    // lacuna de desenho — a coleta já pede o `src` simples; é a resposta que não
    // chegou a tempo naquela passagem. Uma tentativa pelo contexto da página
    // (mesmos cookies e cabeçalhos) recupera o caso comum, e o que continuar
    // faltando segue nomeado no relatório.
    const faltantes = [...recursos].filter(([u, v]) => !v && !presos.has(u)).map(([u]) => u);
    if (faltantes.length) {
      onProgress({ etapa: 'retrying', quantos: faltantes.length });
      const fila = faltantes.slice(0, RETRY_MAX_ARQUIVOS);
      // ⚠️ O orçamento da repescagem é o dela, mas cada byte passa pela MESMA
      // contabilidade da interceptação — que segue viva enquanto isto roda. Um
      // orçamento próprio calculado uma vez gastaria o mesmo espaço livre duas
      // vezes (Sol).
      let orcamento = Math.min(RETRY_ORCAMENTO_BYTES, conta.restante());
      const buscarUmaVez = async (u) => {
        // Geração no INÍCIO da repescagem: se o navegador recarregar U no meio
        // (documento principal → geração nova, vaga nula nova), os bytes
        // antigos desta repescagem não podem vencer o documento mais novo
        // (Astra r2 #2). Exige-se a mesma geração ao confirmar e ao publicar.
        const geracaoNoInicio = geracao.get(u) || 0;
        // ⚠️ REDIRECT MANUAL, com cada salto validado. Seguir sozinho valida só
        // o primeiro host — um 302 de host público para link-local passaria por
        // cima da guarda (mesma classe do achado de 2026-08-14).
        //
        // ⚠️ E LEITURA EM FLUXO, com aborto. `page.request.fetch` já baixa a
        // resposta inteira antes de devolver, e `content-length` pode estar
        // ausente ou mentir — um teto conferido depois disso limita o que se
        // ACEITA, nunca a memória nem os bytes trafegados (Sol). Aqui os bytes
        // são contados enquanto chegam e a conexão é cortada no limite.
        let alvo = u;
        for (let salto = 0; salto <= RETRY_MAX_SALTOS; salto += 1) {
          if (!(await hostEhPublico(new URL(alvo).hostname))) return null;
          const parada = new AbortController();
          const relogio = setTimeout(() => parada.abort(), 12000);
          try {
            // Com sessão emprestada a repescagem usa o JAR de cookies da
            // sessão verificada (`context.request` compartilha os cookies do
            // contexto) — o fetch do Node não os tem. ⚠️ RESÍDUO NOMEADO
            // (Astra 2026-09-08 #2): `context.request` roda no processo LOCAL
            // do Playwright, NÃO pelo egress do navegador remoto; um
            // cf_clearance amarrado ao IP da sessão NÃO valida nesta
            // repescagem. A captura PRIMÁRIA (os pedidos do navegador real)
            // não é afetada; um asset atrás de challenge que faltou na 1ª
            // passagem fica NOMEADO como ausente, nunca corrompe. Sem
            // streaming aqui: `body()` bufferiza, então o adaptador rejeita
            // ANTES pelo content-length e a resposta é sempre descartada.
            const resposta = emprestada
              ? await pedirPeloNavegador(context, alvo)
              : await fetch(alvo, { redirect: 'manual', signal: parada.signal });
            const status = resposta.status;
            if (status >= 300 && status < 400) {
              const destino = resposta.headers.get('location');
              if (!destino) return null;
              alvo = new URL(destino, alvo).toString();
              continue;
            }
            if (!resposta.ok || !resposta.body) return null;
            const pedacos = [];
            let lidos = 0;
            // ⚠️ Reserva feita e NÃO aceita tem que voltar em TODO caminho de
            // saída, não só no ramo de estouro: se `read()` rejeitar no meio
            // (timeout, aborto, erro de rede), o que já foi reservado ficaria
            // preso e o teto encolheria para sempre (Sol).
            const bilhetes = [];
            let aceita = false;
            try {
            const leitor = resposta.body.getReader();
            for (;;) {
              const { done, value } = await leitor.read();
              if (done) break;
              lidos += value.byteLength;
              // ⚠️ O orçamento é debitado do que TRAFEGOU, não do que foi
              // aceito: senão várias respostas grandes recusadas puxariam bytes
              // sem limite, e o orçamento agregado não limitaria nada (Sol).
              orcamento -= value.byteLength;
              // E a reserva é feita na contabilidade compartilhada, pedaço a
              // pedaço: é ela que impede os dois caminhos de estourar o teto.
              const bilhete = conta.reservar(value.byteLength);
              if (lidos > MAX_ASSET_BYTES || orcamento < 0 || !bilhete) {
                if (bilhete) conta.devolver(bilhete);
                await leitor.cancel().catch(() => {});
                parada.abort();
                return null;
              }
              bilhetes.push(bilhete);
              pedacos.push(value);
            }
            if (!lidos) return null;
            // A vaga ainda é minha? A resposta ORIGINAL pode ter terminado
            // enquanto eu lia (a coleta agora tem teto) e já preenchido a
            // vaga — confirmar aqui contaria o mesmo corpo duas vezes e o
            // `set` de fora sobrescreveria um asset bom (Claude review r1 #4).
            if (recursos.get(u) !== null || (geracao.get(u) || 0) !== geracaoNoInicio) return null;
            // Só agora o corpo entra no pacote: pendente vira confirmado.
            for (const b of bilhetes) conta.confirmar(b);
            aceita = true;
            return {
              bytes: Buffer.concat(pedacos.map((p) => Buffer.from(p))),
              contentType: resposta.headers.get('content-type') || 'application/octet-stream',
              varia: variaPorPedido(resposta.headers.get('vary')),   // so .get e garantido no adaptador da sessao emprestada
              // Quem publica confere de novo: entre este `return` e o `set`
              // de fora há um microtask, e a geração pode virar nele.
              geracao: geracaoNoInicio,
            };
            } finally {
              // Vale para TODO caminho de saída, não só o ramo de estouro: se
              // `read()` rejeitar no meio, o pendente volta aqui. Depois do
              // fechamento não há o que devolver — `fechar()` já descartou o
              // que estava em voo (Sol).
              if (!aceita) for (const b of bilhetes) conta.devolver(b);
            }
          } finally {
            clearTimeout(relogio);
          }
        }
        return null;
      };
      // Concorrência limitada: disparar tudo de uma vez é rajada de rede e pico
      // de memória proporcional à quantidade que faltou.
      const pendentes = [...fila];
      await Promise.allSettled(Array.from({ length: RETRY_CONCORRENCIA }, async () => {
        for (;;) {
          const u = pendentes.shift();
          // `cancelado`: o prazo da rota já estourou e reembolsou — a
          // repescagem (até 120 arquivos × 12s em 6 filas) não pode seguir
          // trabalhando à toa depois disso (Astra r1 #2).
          if (!u || orcamento <= 0 || cancelado) return;
          try {
            const valor = await buscarUmaVez(u);
            // Já reservado pedaço a pedaço durante a leitura — somar aqui
            // contaria os mesmos bytes duas vezes.
            // Publicar exige a vaga ainda nula E a mesma geração (Astra r3:
            // o `await` acima é um microtask — a checagem de dentro não basta).
            if (valor && recursos.get(u) === null && (geracao.get(u) || 0) === valor.geracao) {
              recursos.set(u, { bytes: valor.bytes, contentType: valor.contentType, tipo: valor.tipo, varia: valor.varia === true });
            }
          } catch { /* segue faltando, e o relatório dirá */ }
        }
      }));
    }

    for (const [u, v] of [...recursos]) if (!v) { recursos.delete(u); descartados.push({ u, motivo: 'corpo nao chegou' }); }

    // SNAPSHOT IMUTÁVEL (Sol r2 #2, 2026-08-20): daqui em diante `mapa`,
    // reescrita e montagem leem o MESMO congelado de entradas completas. Uma
    // resposta tardia (mais lenta que o timeout do closing-refs) que chegue
    // após o purge muta `recursos` vivo — se ela entrasse no `mapa`, os
    // textos seriam reescritos para um caminho cujo asset nunca entra no
    // bundle: referência local quebrada em silêncio, pior que o crash.
    // ⚠️ Daqui em diante nada mais entra no pacote. Fechar a contabilidade
    // impede que uma resposta atrasada some bytes que NUNCA serão empacotados —
    // o relatório passaria a contar o que não existe (Sol).
    conta.fechar();
    const congelados = new Map([...recursos].filter(([, v]) => v));
    const engines = await page.evaluate(() => ({
      gsap: Boolean(window.gsap),
      scrollTrigger: Boolean(window.ScrollTrigger || (window.gsap && window.gsap.plugins && window.gsap.plugins.ScrollTrigger)),
      lenis: Boolean(window.lenis),
      lottie: Boolean(window.lottie || window.bodymovin),
      browserAnimations: typeof document.getAnimations === 'function' ? document.getAnimations().length : 0,
    }));

    // ⚠️ O HTML do bundle é o DOM SERVIDO, não o serializado do DOM vivo. Um DOM
    // vivo já mutado pelos scripts, servido de novo COM os scripts, seria
    // processado duas vezes — animação de entrada partindo do estado final,
    // elementos duplicados. Preservar significa entregar o documento original.
    // Respostas nunca carregam fragmento, mas `page.url()` pode — e depois de um
    // redirect a URL original também não serve. Compara-se SEM fragmento dos
    // dois lados, tentando a final antes da pedida. Achado P1 do Sol.
    const semHash = (u) => u.split('#')[0];
    const finalUrl = semHash(page.url());
    const entradaOriginal = [...congelados.keys()].find((u) => semHash(u) === finalUrl)
      || [...congelados.keys()].find((u) => semHash(u) === semHash(url));
    if (!entradaOriginal) throw new Error('native_bundle_entry_not_captured');

    // ⚠️ Caminhos podem COLIDIR (`/a%20b.js` e `/a_20b.js` normalizam igual; o
    // macOS ainda trata `A.js` e `a.js` como o mesmo arquivo). Sem desempate, o
    // registrador aborta o clone inteiro. Desempata-se por conteúdo. Achado P1.
    const mapa = new Map();
    const usados = new Set();
    for (const u of congelados.keys()) {
      let caminho = bundlePathForUrl(u, page.url());
      const chave = caminho.toLowerCase();
      if (usados.has(chave)) {
        const marca = createHash('sha1').update(u).digest('hex').slice(0, 10);
        caminho = /\.[^./]+$/.test(caminho)
          ? caminho.replace(/(\.[^./]+)$/, `.${marca}$1`)
          : `${caminho}.${marca}`;
      }
      usados.add(caminho.toLowerCase());
      mapa.set(u, caminho);
    }
    // ⚠️ Uma URL como `/promo` vira o caminho `promo`, SEM extensão — e qualquer
    // servidor estático entrega isso como binário, então a página nunca abre.
    // Renomeia-se a entrada ANTES de reescrever, para que toda referência a ela
    // aponte para o nome novo.
    const entradaBruta = mapa.get(entradaOriginal);
    if (!/\.html?$/i.test(entradaBruta)) {
      const dir = entradaBruta.includes('/') ? entradaBruta.slice(0, entradaBruta.lastIndexOf('/') + 1) : '';
      mapa.set(entradaOriginal, `${dir}index.html`);
    }
    const entryPath = mapa.get(entradaOriginal);
    // APELIDOS (salto -> caminho do destino), a parte do mapa de identidade: proveniencias, remendo de fetch
    // e replay usam a identidade EXATA; o apelido so entra na reescrita de MARCACAO. URL que ja e um recurso
    // proprio nunca vira apelido. Destino fora do pacote final = sem apelido.
    const apelidos = new Map();
    for (const [u, saltos] of apelidosDeRedirect) {
      const caminho = mapa.get(u); if (!caminho) continue;
      for (const salto of saltos) if (!mapa.has(salto) && !apelidos.has(salto)) apelidos.set(salto, caminho);
    }
    const apelidosAplicados = apelidos.size;

    // Mapa das respostas que só existem em tempo de execução (fetch/XHR) e o script
    // que as redireciona para o pacote. Vazio => nada é injetado.
    // Marcador de origem ALEATÓRIO por pacote (Astra B2 #7): um marcador fixo trocado
    // por split/join corrompia conteúdo legítimo que o contivesse. `montarReplay` ainda
    // confere que o corpo não o contém antes de reescrever.
    // Raiz de fetch que nunca teve desfecho (pedido pendente no fim, hop sem destino):
    // buraco NOMEADO, nunca silencioso (Astra B5 #2).
    const geracaoDaEntrada = geracaoDoc;
    // "Redirect nao seguido" so quando o navegador de fato NAO seguiu o ultimo salto (Astra
    // B84): um salto seguido cuja resposta seguinte foi bloqueada por CORS (sem evento) e
    // "sem resposta terminal", nao politica `manual`.
    const naoSeguiu = (vaga) => { try { return Boolean(vaga.hopVisto) && !(vaga.ultimoSalto && typeof vaga.ultimoSalto.redirectedTo === 'function' && vaga.ultimoSalto.redirectedTo()); } catch { return Boolean(vaga.hopVisto); } };
    for (const vaga of vagas) if (vaga.geracao === geracaoDaEntrada && vaga.perdido && !vaga.nomeada) { vaga.nomeada = true; envelopesRepetidosPerdidos.push({ u: vaga.u, motivo: naoSeguiu(vaga) ? 'redirect nao seguido (manual) - opaqueredirect nao reproduzivel' : 'sem resposta terminal', geracao: vaga.geracao }); }
    // So as ocorrencias do documento cuja HTML virou a entrada (Astra B68).
    for (const [id, lista] of [...envelopes]) {
      const envenenada = lista.some((v) => gruposEnvenenados.has(`${v.metodo} ${String(v.u).split('#')[0]}`));
      const vivas = envenenada ? [] : lista.filter((v) => v.geracao === geracaoDaEntrada);
      if (vivas.length) envelopes.set(id, vivas); else envelopes.delete(id);
    }
    const perdasDaEntrada = envelopesRepetidosPerdidos.filter((p) => p.geracao === geracaoDaEntrada).map(({ u, motivo }) => ({ u, motivo }));
    for (const lista of envelopes.values()) lista.sort((a, b) => a.seq - b.seq);
    const marcador = `__UNCRAFT_ORIGIN_${createHash('sha1').update(String(Date.now()) + Math.random()).digest('hex').slice(0, 12)}__`;
    const { manifesto: manifestoDeReplay, arquivos: arquivosDeReplay } = montarReplay(envelopes, mapa, { marcador });
    // O remendo precisa saber a RAIZ do pacote (o gateway serve sob `/api/runtime/<token>/`,
    // não na raiz da origem — Astra B3 #6) e a ORIGEM DA FONTE, para uma chamada relativa
    // do site (`fetch('/api')`) bater com a identidade capturada (Astra B3 #5).
    // MAPA DE PROVENIÊNCIA (Astra B44): asset localizado sob _ext/ → identidade EXATA do
    // GET simples à URL original. Sem URL no HTML (só o hash); a URL reconstruída do
    // caminho é com perdas e NUNCA pode selecionar envelope — só este mapa pode.
    const proveniencias = mapaDeProveniencias(mapa, new URL(entradaOriginal).origin);
    const alheias = origensAlheias(mapa, new URL(entradaOriginal).origin);
    // ASSETS VINDOS DE FETCH (Astra B55): a cópia estática de uma resposta de fetch
    // same-origin não pode responder a um miss de identidade (api-key B recebia o
    // corpo de A pelo fallback estático). O remendo recebe os caminhos e rejeita o
    // miss neles; consumidores de markup (<img>) seguem lendo o arquivo direto.
    const caminhosDeFetch = caminhosProtegidos(congelados, mapa, urlsDeFetch, new URL(entradaOriginal).origin);
    const remendoDeFetch = runtimeFetchShim(manifestoDeReplay, { marcador, entryPath, origemFonte: new URL(entradaOriginal).origin, proveniencias, caminhosDeFetch, origensAlheias: alheias, gruposDeProveniencia: gruposDeProveniencia(mapa), sempre: true });

    const assets = [];
    for (const [u, valor] of congelados) {
      // Cinto extra sobre o snapshot congelado (Claude review 2026-08-20 #2):
      // entrada sem corpo é descarte nomeado, nunca crash de destructuring.
      if (!valor || !mapa.has(u)) {
        descartados.push({ u, motivo: !valor ? 'corpo nao chegou' : 'chegou apos a montagem' });
        continue;
      }
      const { bytes, contentType } = valor;
      const caminho = mapa.get(u);
      let corpo = bytes;
      // Rewriting is per CONTENT TYPE and by URL position now: a stylesheet
      // resolves its own relative URLs against ITSELF, and script bodies are
      // never touched (see rewrite-references.js). The old blind pass only
      // closed absolute URLs, so `src="/hero.png"` — a file on the site's own
      // root — stayed unreachable behind the runtime gateway.
      const kind = referenceKindFor(caminho, contentType);
      if (kind) {
        let texto = rewriteDocumentReferences({
          text: bytes.toString('utf8'),
          kind,
          resourceUrl: u,
          assetPath: caminho,
          map: mapa,
          apelidos,
        });
        // ⚠️ Reescrever o conteúdo invalida o hash de `integrity=`, e o browser
        // passa a BLOQUEAR o próprio arquivo que acabamos de preservar — a
        // página abriria sem script nenhum. Achado P1 do Sol.
        if (/\.html?$/i.test(caminho)) texto = texto.replace(/\s+integrity=(["'])[^"']*\1/gi, '');
        // ⭐ REMENDO DE `fetch`/XHR no documento de ENTRADA (2026-09-29). Uma URL
        // montada em código não aparece como texto, então a reescrita não a alcança;
        // sem isto o clone perde o conteúdo que a página busca em runtime (medido no
        // gsap.com: 3 imagens ausentes por causa de um `fetch` morto). Entra logo após
        // o doctype, antes de qualquer marcação do site — se o site guardar uma
        // referência a `fetch` antes, o remendo não o alcança. A âncora é a MESMA do
        // gateway (`leadingDoctypeEnd`), que espelha os tokens do modo "initial" do
        // parser; escrever outra por regex divergiria dele.
        if (caminho === entryPath && remendoDeFetch) {
          const at = leadingDoctypeEnd(texto);
          texto = `${texto.slice(0, at)}${remendoDeFetch}${texto.slice(at)}`;
        }
        corpo = Buffer.from(texto, 'utf8');
      }
      assets.push({ path: caminho, body: new Uint8Array(corpo), contentType: contentType || undefined });
    }

    for (const a of arquivosDeReplay) assets.push(a);

    if (!emprestada) await context.close();
    onProgress({ etapa: 'finalizing' });

    // SSIM do clone recém-montado contra o vivo (pedido antigo: tracking
    // permanente). Fail-open: falha vira null e loga; nunca derruba o clone.
    let similarity = null;
    // Com sessão emprestada não se abre página nova no navegador de outrem:
    // a similaridade fica null (fail-open já existente).
    if (screenshotVivo && !emprestada) {
      try {
        similarity = await measureBundleSimilarity({
          browser, assets, entryPath, screenshotDataUrl: screenshotVivo, signal,
        });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`[native-clone] similarity falhou: ${String(e?.message || e).slice(0, 120)}`);
      }
    }

    return {
      kind: 'native',
      // Sibling of `bundle` ON PURPOSE — see the measurement note above:
      // anything added inside `bundle` would change contentHash/fingerprint.
      ...(typeSample ? { typeSample } : {}),
      bundle: {
        entryPath,
        assets,
        runtimeFingerprint: sha256(Buffer.from(assets.map((a) => a.path).sort().join('\n'))),
        reconstructionCapabilities: {
          detectedEngines: Object.entries(engines).filter(([, v]) => v).map(([k]) => k),
          candidateControls: [],
        },
      },
      // O relatório viaja com o resultado: sem ele o snapshot fica 'pronto'
      // mesmo faltando script ou fonte, e a falta some. Achado P1 do Sol.
      relatorio: {
        arquivos: assets.length,
        similarity,
        // ⚠️ DUAS quantidades, não uma. `bytes` é o que chegou da rede (é
        // sobre ele que os tetos de memória e de tráfego decidem);
        // `bytesNoPacote` é o que ficou guardado, e é menor porque a reescrita
        // de referências encurta HTML/CSS/JS. Com um nome só, a diferença
        // aparecia como erro de contabilidade e não como o que é.
        bytes: conta.gasto(),
        bytesNoPacote: assets.reduce((total, a) => total + a.body.byteLength, 0),
        entryPath,
        engines,
        // Quantos candidatos de srcset/CSS o fechamento carregou de propósito.
        refsExtras,
        // Nada some em silêncio: o que não coube é nomeado.
        descartados: descartados.slice(0, 40),
        // ⭐ PEDIDOS QUE FALHARAM (2026-09-28). Antes disto a captura só
        // escutava `response`, então um recurso cujo pedido falha era
        // INVISÍVEL: nada gravado, nenhum descarte nomeado, e a referência
        // ficava absoluta no HTML — o clone herdava uma chamada condenada.
        //
        // NÃO se fabrica destino para eles. Uma primeira versão gravava um
        // arquivo VAZIO no lugar, e a auditoria (Astra + revisor Claude,
        // convergentes) derrubou por três razões medidas: (1) um 200 vazio faz
        // o `<script>` disparar `load` onde ao vivo dispara `error`, então um
        // site com caminho de erro muda de comportamento — o oposto de
        // preservar; (2) o módulo já tem o invariante deliberado de que
        // referência localizada sem asset é proibida ("pior que o crash"),
        // então fabricar destino contraria decisão existente; (3) se o pedido
        // bloqueado fosse o DOCUMENTO de entrada, o clone sairia com
        // `index.html` de zero byte e PASSARIA, em vez de estourar
        // `native_bundle_entry_not_captured`.
        //
        // Então a referência externa fica como está, e o clone falha
        // exactamente onde o site falha — fidelidade, inclusive na falha. O que
        // muda é que a falha passa a ser DITA.
        //
        // ⚠️ A separação é o ponto: `geracao` recebe toda URL que teve resposta
        // e passou o dedup, então `geracao.has(u)` distingue as duas classes que
        // de outro modo se confundem — o purge de entradas sem corpo roda ANTES
        // daqui e apagaria a evidência. "Houve resposta e o corpo não entrou" é
        // falha NOSSA (repescagem, teto, tardia); "nunca houve resposta" é o
        // navegador ou a rede recusando. Tratar as duas como a mesma coisa
        // esconderia defeito nosso atrás de recusa alheia.
        // Quantas chamadas de runtime o clone passou a alcançar dentro do pacote.
        // Quantas IDENTIDADES de chamada de runtime o clone consegue responder do
        // pacote, e quantos envelopes ao todo (a mesma chamada pode ter várias).
        chamadasDeRuntimeMapeadas: Object.keys(manifestoDeReplay).length,
        apelidosDeRedirect: apelidosAplicados,
        envelopesDeReplay: arquivosDeReplay.length,
        // Ocorrências repetidas de fetch/XHR cujo corpo não chegou no teto: NOMEADAS.
        envelopesPerdidos: perdasDaEntrada.slice(0, 20),
        pedidosQueFalharam: (() => {
          const lista = [...recusados].map(([u, info]) => ({ u, erro: info.erro, tipo: info.tipo }));
          const nossa = lista.filter((x) => geracao.has(x.u));
          const alheia = lista.filter((x) => !geracao.has(x.u));
          return {
            total: lista.length,
            // Amostra COM NOMES, não contagem anônima: uma contagem sem nomes é
            // silêncio, e foi exatamente o que obrigou a reconstruir por fora o
            // diagnóstico das 264 tentativas externas.
            recusadosPelaRedeOuNavegador: { n: alheia.length, amostra: alheia.slice(0, 20) },
            houveRespostaMasNaoEntrou: { n: nossa.length, amostra: nossa.slice(0, 20) },
          };
        })(),
        totalDescartados: descartados.length,
        // ⭐ Contagem sobre a lista INTEIRA, antes do corte da amostra. Sem
        // ela, quem lê contaria os 40 guardados e apresentaria "100 perdidos:
        // 40× limite de arquivos" como se fosse a explicação completa — uma
        // amostra truncada com cara de diagnóstico fechado (Sol).
        motivosDescartados: descartados.reduce((acc, d) => {
          if (d?.motivo) acc[d.motivo] = (acc[d.motivo] || 0) + 1;
          return acc;
        }, {}),
      },
    };
  } finally {
    await fecharSePropria();
  }
}
