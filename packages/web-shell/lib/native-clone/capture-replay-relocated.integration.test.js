/**
 * O PACOTE EXECUTADO NOUTRA ORIGEM, SOB PREFIXO — a testemunha do replay (Astra B3 #5/#6).
 *
 * Os testes de sandbox provam a REGRA; só isto prova o RESULTADO: captura-se um site
 * com o produtor real, serve-se o pacote gerado num SEGUNDO servidor, sob
 * `/api/runtime/tok/` (a forma do gateway), abre-se em Chromium e lê-se o que o
 * script do PRÓPRIO site recebeu de `fetch`.
 *
 * Cobre, num só percurso: chamada root-relative (`/api`) batendo na identidade da
 * FONTE; ocorrências repetidas na ordem certa; buraco (ocorrência cujo corpo a captura
 * não obteve) como miss NA POSIÇÃO; XHR fora da lista do fetch; JSON reescrito com
 * imagem resolvendo sob o prefixo; POST externo sem envelope falhando fechado sem
 * alcançar servidor nenhum.
 */
import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('node:dns/promises', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: { ...(actual.default || {}), lookup: async () => [{ address: '93.184.216.34', family: 4 }] },
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
  };
});

const { captureNativeBundle, identidadeDeRequisicao } = await import('./capture-bundle.js');
const { chromium } = await import('playwright-core');

let fonte, fonteOrigin, clone, cloneOrigin, externo, externoOrigin;
const hits = { api: 0, xhr: 0, externoPost: 0, clonePost: 0 };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const SITE = (externoOrigin) => `<!doctype html>
<html><head><meta charset="utf-8"><title>relocado</title></head>
<body><h1>Um site que chama a própria API, um XHR, um JSON com imagem e um POST externo</h1>
<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.</p>
<img src="${externoOrigin}/avatar.png" alt="">
<script>addEventListener('load', async function () {
  const r = {};
  // Imagem cross-origin capturada PRIMEIRO como asset; depois o mesmo URL por fetch no-cors
  // (Astra B41): ao vivo e opaco; no clone nunca pode virar o arquivo local legivel.
  try { const o = await fetch('${externoOrigin}/avatar.png', { mode: 'no-cors' }); r.avatar = o.type + ':' + o.status + ':' + (await o.arrayBuffer()).byteLength; } catch (e) { r.avatar = 'ERRO ' + e.message; }
  // XHR de identidade IGUAL vem ANTES do 1º fetch (Astra B4 #6): se a captura voltasse
  // a registrar XHR, a1 receberia a resposta do XHR e este teste ficaria vermelho.
  r.xhr = await new Promise((res) => { const x = new XMLHttpRequest(); x.open('POST', '/api'); x.onloadend = () => res(x.responseText); x.onerror = () => res('erro'); x.send('q'); });
  const chama = () => fetch('/api', { method: 'POST', body: 'q' }).then((x) => x.text()).catch((e) => 'ERRO ' + e.message);
  r.a1 = await chama(); r.a2 = await chama(); r.a3 = await chama();
  r.a4 = await chama();   // 302 → destino: a vaga e a do pedido raiz (Astra B4 #1)
  r.a5 = await chama();   // recusa antecipada (declara 41 MiB): buraco NOMEADO
  r.a6 = await chama();   // depois do buraco, a posicao se mantem
  // 300 TERMINAL (sem Location) com corpo: o site LE o corpo ao vivo, mas o Playwright
  // nao entrega corpo de 3xx — tem que virar perda NOMEADA (miss), nunca um 300 vazio
  // fabricado (Astra B5 #2 + B6 (c)). Registra-se status:texto para distinguir.
  const chamaComStatus = () => fetch('/api', { method: 'POST', body: 'q' }).then(async (x) => x.status + ':' + await x.text()).catch((e) => 'ERRO ' + e.message);
  r.a7 = await chamaComStatus();
  r.a8 = await chamaComStatus();
  const j = await (await fetch('/dados.json')).json();
  r.foto = j.foto;
  r.fotoDecodificou = await new Promise((res) => { const i = new Image(); i.onload = () => res(i.naturalWidth > 0); i.onerror = () => res(false); i.src = j.foto; });
  try { r.externo = await (await fetch('${externoOrigin}/coleta', { method: 'POST', body: 'x' })).text(); } catch (e) { r.externo = 'ERRO ' + e.message; }
  // no-cors para OUTRA origem (Astra B16): ao vivo e resposta OPACA; no clone o envelope
  // legivel capturado NUNCA pode aparecer.
  try { const o = await fetch('${externoOrigin}/opaco', { mode: 'no-cors' }); r.opaco = o.type + ':' + o.status + ':' + await o.text(); } catch (e) { r.opaco = 'ERRO ' + e.message; }
  // ACAO de origem ALHEIA (Astra B17): continua opaco ao vivo; no clone idem.
  try { const o = await fetch('${externoOrigin}/opaco2', { mode: 'no-cors' }); r.opaco2 = o.type + ':' + o.status + ':' + await o.text(); } catch (e) { r.opaco2 = 'ERRO ' + e.message; }
  // Raiz SAME-ORIGIN que redireciona para fora (Astra B18): sob no-cors e opaco ao vivo,
  // mesmo com ACAO * no terminal; sob cors e legivel (controle positivo).
  try { const o = await fetch('/relay', { mode: 'no-cors' }); r.relayOpaco = o.type + ':' + o.status + ':' + await o.text(); } catch (e) { r.relayOpaco = 'ERRO ' + e.message; }
  try { r.relayCors = await (await fetch('/relay')).text(); } catch (e) { r.relayCors = 'ERRO ' + e.message; }
  // CORS CREDENCIADO (Astra B38/B39): ACAO exato + ACAC 'True' (caixa errada) NAO
  // habilita include — ao vivo o navegador rejeita; no clone tem que rejeitar tambem.
  // ACAC 'true' exato habilita e replaya.
  try { r.credTrue = await (await fetch('${externoOrigin}/cred-True', { credentials: 'include' })).text(); } catch (e) { r.credTrue = 'ERRO ' + e.message; }
  try { r.credOk = await (await fetch('${externoOrigin}/cred-ok', { credentials: 'include' })).text(); } catch (e) { r.credOk = 'ERRO ' + e.message; }
  // Astra B80: 302 com ACAO '*' -> /cred-ok (origem explicita + ACAC true). Em 'omit' passa e e
  // legivel; a elegibilidade CREDENCIADA do envelope tem que olhar o salto, nao so o terminal.
  try { r.credRelay = await (await fetch('${externoOrigin}/cred-relay', { credentials: 'omit' })).text(); } catch (e) { r.credRelay = 'ERRO ' + e.message; }
  // Astra B93: GET com cabecalho de script (preflight). OPTIONS sem ACAC + GET com ACAC true:
  // em 'omit' passa, mas o envelope NAO pode ficar credenciado (o preflight nao autorizou);
  // controle: OPTIONS com ACAC true e a propria chamada em 'include' => credenciado.
  try { r.credPre = await (await fetch('${externoOrigin}/cred-pre', { headers: { 'api-key': 'k' }, credentials: 'omit' })).text(); } catch (e) { r.credPre = 'ERRO ' + e.message; }
  try { r.credPreOk = await (await fetch('${externoOrigin}/cred-pre-ok', { headers: { 'api-key': 'k' }, credentials: 'include' })).text(); } catch (e) { r.credPreOk = 'ERRO ' + e.message; }
  // Astra B94: preflight por VALOR — Accept com 129 bytes (safelist limita a 128). OPTIONS sem ACAC.
  try { r.credPreAccept = await (await fetch('${externoOrigin}/cred-pre-accept', { headers: { accept: 'a'.repeat(129) }, credentials: 'omit' })).text(); } catch (e) { r.credPreAccept = 'ERRO ' + e.message; }
  // Astra B95: cabecalho que fica FORA da identidade (cache-control) mas, posto pelo script, obriga preflight.
  try { r.credPreCc = await (await fetch('${externoOrigin}/cred-pre-cc', { headers: { 'cache-control': 'no-cache' }, credentials: 'omit' })).text(); } catch (e) { r.credPreCc = 'ERRO ' + e.message; }
  // Astra B97: POST simples (text/plain, corpo vazio) em 'omit' — permissao do terminal para credenciais,
  // mas nenhum preflight verificado. So no replay, o MESMO pedido com corpo em FLUXO + 'include'
  // exige preflight: tem que rejeitar, nunca servir o envelope.
  try { r.credPost = await (await fetch('${externoOrigin}/cred-post', { method: 'POST', body: '', headers: { 'content-type': 'text/plain' }, credentials: 'omit' })).text(); } catch (e) { r.credPost = 'ERRO ' + e.message; }
  // Astra B105: 'text/plain ;charset=utf-8' e simples (sem OPTIONS). Na fonte, corpo string; no
  // clone, a MESMA chamada com corpo em fluxo e a 1a consumidora do envelope — tem que rejeitar.
  if (location.origin === '${fonteOrigin}') {
    try { r.ctPost = await (await fetch('${externoOrigin}/ct-post', { method: 'POST', body: '', headers: { 'content-type': 'text/plain ;charset=utf-8' }, credentials: 'include' })).text(); } catch (e) { r.ctPost = 'ERRO ' + e.message; }
  } else {
    try { const o = await fetch('${externoOrigin}/ct-post', { method: 'POST', body: new ReadableStream({ start(c) { c.close(); } }), duplex: 'half', headers: { 'content-type': 'text/plain ;charset=utf-8' }, credentials: 'include' }); r.ctPost = o.type + ':' + (await o.text()); } catch (e) { r.ctPost = 'ERRO ' + e.message; }
  }
  // Astra B106: POST same-origin por 307 e por 303 — a captura marca so o 307 (fluxo nao atravessa).
  try { r.r307 = await (await fetch('/post-307', { method: 'POST', body: 'x', headers: { 'content-type': 'text/plain' } })).text(); } catch (e) { r.r307 = 'ERRO ' + e.message; }
  try { r.r303 = await (await fetch('/post-303', { method: 'POST', body: 'x', headers: { 'content-type': 'text/plain' } })).text(); } catch (e) { r.r303 = 'ERRO ' + e.message; }
  // Astra B107: A (JSON, preflight-trigger) -> 303 -> B/final (GET credenciado; OPTIONS 403). Sem
  // preflight real; a captura nao pode certificar. No clone, a mesma chamada em fluxo e a 1a consumidora.
  if (location.origin === '${fonteOrigin}') {
    try { r.p303 = await (await fetch('/json-303', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' }, credentials: 'include' })).text(); } catch (e) { r.p303 = 'ERRO ' + e.message; }
  } else {
    try { const o = await fetch('/json-303', { method: 'POST', body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{}')); c.close(); } }), duplex: 'half', headers: { 'content-type': 'application/json' }, credentials: 'include' }); r.p303 = o.type + ':' + (await o.text()); } catch (e) { r.p303 = 'ERRO ' + e.message; }
  }
  // Astra B112: XHR com preflight (sem ACAC) e depois um fetch SIMPLES a mesma URL. A evidencia do
  // XHR nao pode passar para o fetch; no clone, o fetch em fluxo como 1a consumidora rejeita.
  if (location.origin === '${fonteOrigin}') {
    await new Promise(function (done) { try { const x = new XMLHttpRequest(); x.open('POST', '${externoOrigin}/xhr-then-fetch'); x.setRequestHeader('api-key', 'k'); x.onloadend = done; x.send(''); } catch (e) { done(); } });
    try { r.xtf = await (await fetch('${externoOrigin}/xhr-then-fetch', { method: 'POST', body: '', headers: { 'content-type': 'text/plain' }, credentials: 'include' })).text(); } catch (e) { r.xtf = 'ERRO ' + e.message; }
  } else {
    try { const o = await fetch('${externoOrigin}/xhr-then-fetch', { method: 'POST', body: new ReadableStream({ start(c) { c.close(); } }), duplex: 'half', headers: { 'content-type': 'text/plain' }, credentials: 'include' }); r.xtf = o.type + ':' + (await o.text()); } catch (e) { r.xtf = 'ERRO ' + e.message; }
  }
  // Astra B113: A (simples, include, resposta atrasada) comeca; B (api-key, omit, preflight sem ACAC)
  // comeca e termina antes. A nao pode herdar a evidencia de B; no clone, A em fluxo e a 1a consumidora.
  if (location.origin === '${fonteOrigin}') {
    const pa = fetch('${externoOrigin}/overlap', { method: 'POST', body: 'lento', headers: { 'content-type': 'text/plain' }, credentials: 'include' }).then(function (o) { return o.text(); }, function (e) { return 'ERRO ' + e.message; });
    await new Promise(function (d) { setTimeout(d, 50); });
    await fetch('${externoOrigin}/overlap', { method: 'POST', body: '', headers: { 'content-type': 'text/plain', 'api-key': 'k' }, credentials: 'omit' }).catch(function () {});
    // Astra B114: variante — B2 com Range >= INT64_MAX (preflight real, sem ACAC) sobreposto a um A2 lento
    const pa2 = fetch('${externoOrigin}/overlap', { method: 'POST', body: 'lento', headers: { 'content-type': 'text/plain' }, credentials: 'include' }).then(function (o) { return o.text(); }, function () { return ''; });
    await new Promise(function (d) { setTimeout(d, 50); });
    await fetch('${externoOrigin}/overlap', { method: 'POST', body: 'b2', headers: { 'content-type': 'text/plain', range: 'bytes=0-9223372036854775808' }, credentials: 'omit' }).catch(function () {});
    await pa2;
    r.overlapA = await pa;
  } else {
    try { const o = await fetch('${externoOrigin}/overlap', { method: 'POST', body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('lento')); c.close(); } }), duplex: 'half', headers: { 'content-type': 'text/plain' }, credentials: 'include' }); r.overlapA = o.type + ':' + (await o.text()); } catch (e) { r.overlapA = 'ERRO ' + e.message; }
  }
  // Astra B115: cabecalho valido chamado __proto__. Na fonte, com ele; no clone, SEM ele — o
  // pedido sem cabecalho nao pode receber (nem consumir) a resposta do pedido com __proto__.
  if (location.origin === '${fonteOrigin}') {
    try { r.proto = await (await fetch('${externoOrigin}/proto-acct', { headers: [['__proto__', 'A']] })).text(); } catch (e) { r.proto = 'ERRO ' + e.message; }
  } else {
    try { r.proto = await (await fetch('${externoOrigin}/proto-acct')).text(); } catch (e) { r.proto = 'ERRO ' + e.message; }
  }
  // Astra B119: Request com corpo Blob criado num IFRAME same-origin (outro realm) passado ao fetch
  // da janela principal. No clone, um POST sem corpo nao pode receber a resposta do Blob.
  if (location.origin === '${fonteOrigin}') {
    try {
      const f = document.createElement('iframe'); document.body.appendChild(f);
      const W = f.contentWindow;
      r.blobIframe = await (await fetch(new W.Request(location.origin + '/blob-iframe', { method: 'POST', body: new W.Blob(['A'], { type: 'application/octet-stream' }) }))).text();
    } catch (e) { r.blobIframe = 'ERRO ' + e.message; }
  } else {
    try { r.blobIframe = await (await fetch(new URL('blob-iframe', location.href).href, { method: 'POST', headers: { 'content-type': 'application/octet-stream' } })).text(); } catch (e) { r.blobIframe = 'ERRO ' + e.message; }
  }
  // Astra B124: cache aquecido — normal (OLD), only-if-cached (OLD do cache), reload (NEW). A sonda de
  // cache nao pode ocupar vaga: no clone, o reload tem que receber NEW.
  try {
    r.c1 = await (await fetch('/cache-api')).text();
    try { r.c2 = await (await fetch('/cache-api', { mode: 'same-origin', cache: 'only-if-cached' })).text(); } catch (e) { r.c2 = 'ERRO ' + e.message; }
    r.c3 = await (await fetch('/cache-api', { cache: 'reload' })).text();
  } catch (e) { r.c3 = 'ERRO ' + e.message; }
  // Astra B118: 1a chamada com corpo herdado de Request (nao provado), 2a identica por string.
  // Sem envenenar o grupo, no replay a 1a casaria a ocorrencia da 2a (SECOND).
  if (location.origin === '${fonteOrigin}') {
    try { r.ordem1 = await (await fetch(new Request('/ordem', { method: 'POST', body: 'A' }))).text(); } catch (e) { r.ordem1 = 'ERRO ' + e.message; }
    try { r.ordem2 = await (await fetch('/ordem', { method: 'POST', body: 'A' })).text(); } catch (e) { r.ordem2 = 'ERRO ' + e.message; }
  } else {
    const base = new URL('ordem', location.href).href;
    try { r.ordem1 = await (await fetch(new Request(base, { method: 'POST', body: 'A' }))).text(); } catch (e) { r.ordem1 = 'ERRO ' + e.message; }
    try { r.ordem2 = await (await fetch(base, { method: 'POST', body: 'A' })).text(); } catch (e) { r.ordem2 = 'ERRO ' + e.message; }
  }
  // Astra B116: POST same-origin com corpo Blob (bytes que o Chromium omite do postData). No clone,
  // um POST SEM corpo com o mesmo Content-Type nao pode receber a resposta do Blob.
  if (location.origin === '${fonteOrigin}') {
    try { r.blob = await (await fetch('/blob-post', { method: 'POST', body: new Blob(['A'], { type: 'application/octet-stream' }) })).text(); } catch (e) { r.blob = 'ERRO ' + e.message; }
    // Astra B120: Blob nao vazio com size sombreado para 0
    try { const bs = new Blob(['A'], { type: 'application/octet-stream' }); Object.defineProperty(bs, 'size', { value: 0 }); r.blobSize = await (await fetch('/blob-size', { method: 'POST', body: bs })).text(); } catch (e) { r.blobSize = 'ERRO ' + e.message; }
    // Astra B121: Blob disfarcado de ArrayBuffer (prototipo trocado + byteLength 0)
    try { const bd = new Blob(['A'], { type: 'application/octet-stream' }); Object.setPrototypeOf(bd, ArrayBuffer.prototype); Object.defineProperty(bd, 'byteLength', { value: 0 }); r.blobDisf = await (await fetch('/blob-disf', { method: 'POST', body: bd })).text(); } catch (e) { r.blobDisf = 'ERRO ' + e.message; }
    // Astra B122: a pagina troca o .call do getter intrinseco (restaurado logo depois)
    try {
      const g = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
      g.call = function () { return 0; };
      try { r.blobCall = await (await fetch('/blob-call', { method: 'POST', body: new Blob(['A'], { type: 'application/octet-stream' }) })).text(); } finally { delete g.call; }
    } catch (e) { r.blobCall = 'ERRO ' + e.message; }
    // Astra B117: o mesmo corpo Blob dentro de um Request (corpo HERDADO) — URL propria
    try { r.blobReq = await (await fetch(new Request('/blob-post-req', { method: 'POST', body: new Blob(['A'], { type: 'application/octet-stream' }) }))).text(); } catch (e) { r.blobReq = 'ERRO ' + e.message; }
  } else {
    try { r.blob = await (await fetch('/blob-post', { method: 'POST', headers: { 'content-type': 'application/octet-stream' } })).text(); } catch (e) { r.blob = 'ERRO ' + e.message; }
    try { r.blobSize = await (await fetch(new URL('blob-size', location.href).href, { method: 'POST', headers: { 'content-type': 'application/octet-stream' } })).text(); } catch (e) { r.blobSize = 'ERRO ' + e.message; }
    try { r.blobDisf = await (await fetch(new URL('blob-disf', location.href).href, { method: 'POST', headers: { 'content-type': 'application/octet-stream' } })).text(); } catch (e) { r.blobDisf = 'ERRO ' + e.message; }
    try { r.blobCall = await (await fetch(new URL('blob-call', location.href).href, { method: 'POST', headers: { 'content-type': 'application/octet-stream' } })).text(); } catch (e) { r.blobCall = 'ERRO ' + e.message; }
    try { r.blobReq = await (await fetch(new URL('blob-post-req', location.href).href.replace('/api/runtime/tok/blob-post-req', '/blob-post-req'), { method: 'POST', headers: { 'content-type': 'application/octet-stream' } })).text(); } catch (e) { r.blobReq = 'ERRO ' + e.message; }
  }
  // Astra B131: o servidor decide por Sec-Fetch-Mode. A fonte captura em cors; no clone o
  // no-cors chega PRIMEIRO e nao pode receber nem consumir a resposta do cors.
  if (location.origin === '${fonteOrigin}') {
    try { r.sfm = await (await fetch('/mode-sfm')).text(); } catch (e) { r.sfm = 'ERRO ' + e.message; }
  } else {
    try { const o = await fetch('/mode-sfm', { mode: 'no-cors' }); r.sfmNoCors = o.status + ':' + (await o.text()); } catch (e) { r.sfmNoCors = 'ERRO ' + e.message; }
    try { r.sfm = await (await fetch('/mode-sfm')).text(); } catch (e) { r.sfm = 'ERRO ' + e.message; }
  }
  // Astra B132: com referrer default o Referer sai da URL ATUAL do documento. A fonte chama de
  // /private; no clone a 1a chamada sai de /public e nao pode receber nem consumir a de /private.
  {
    const volta = location.href;
    if (location.origin === '${fonteOrigin}') {
      history.pushState(null, '', '/private');
      try { r.refPriv = await (await fetch('/ref-api')).text(); } catch (e) { r.refPriv = 'ERRO ' + e.message; }
    } else {
      history.pushState(null, '', '/public');
      try { const o = await fetch('/ref-api'); r.refPub = o.status + ':' + (await o.text()); } catch (e) { r.refPub = 'ERRO ' + e.message; }
      history.pushState(null, '', '/private');
      try { r.refPriv = await (await fetch('/ref-api')).text(); } catch (e) { r.refPriv = 'ERRO ' + e.message; }
    }
    history.pushState(null, '', volta);
  }
  // Astra B134: DELETE sem corpo x DELETE com corpo vazio. Controle (so na fonte): o navegador
  // manda Content-Length diferente nos dois. A fonte captura o sem corpo; no clone o vazio vem 1o.
  if (location.origin === '${fonteOrigin}') {
    await fetch('/del-ctl', { method: 'DELETE' }).then(function (x) { return x.text(); }).catch(function () {});
    await fetch('/del-ctl', { method: 'DELETE', body: new Uint8Array(0) }).then(function (x) { return x.text(); }).catch(function () {});
    try { r.delAus = await (await fetch('/del-cl', { method: 'DELETE' })).text(); } catch (e) { r.delAus = 'ERRO ' + e.message; }
  } else {
    try { r.delVazio = await (await fetch('/del-cl', { method: 'DELETE', body: new Uint8Array(0) })).text(); } catch (e) { r.delVazio = 'ERRO ' + e.message; }
    try { r.delAus = await (await fetch('/del-cl', { method: 'DELETE' })).text(); } catch (e) { r.delAus = 'ERRO ' + e.message; }
  }
  // Astra B135 (a politica do documento nao volta atras: vale para o resto do script, igual nos dois lados). So a <meta name=referrer>
  // muda; URL e atributos do Request iguais. Controle nativo na fonte: o servidor ve Referer
  // antes e nao depois. A fonte captura /ref-pol2 SEM meta (PRIVATE) e /ref-pol3 COM meta.
  {
    const meta = () => { const m = document.createElement('meta'); m.name = 'referrer'; m.content = 'no-referrer'; document.head.appendChild(m); };
    if (location.origin === '${fonteOrigin}') {
      await fetch('/ref-ctl').then(function (x) { return x.text(); }).catch(function () {});
      try { r.pol2 = await (await fetch('/ref-pol2')).text(); } catch (e) { r.pol2 = 'ERRO ' + e.message; }
      try { r.pol4 = await (await fetch('/ref-pol4', { referrer: '/private' })).text(); } catch (e) { r.pol4 = 'ERRO ' + e.message; }
      meta();
      await fetch('/ref-ctl').then(function (x) { return x.text(); }).catch(function () {});
      try { r.pol3 = await (await fetch('/ref-pol3')).text(); } catch (e) { r.pol3 = 'ERRO ' + e.message; }
      try { r.pol5 = await (await fetch('/ref-pol5', { referrer: '/private' })).text(); } catch (e) { r.pol5 = 'ERRO ' + e.message; }
    } else {
      meta();
      try { const o = await fetch('/ref-pol2'); r.pol2 = o.status + ':' + (await o.text()); } catch (e) { r.pol2 = 'ERRO ' + e.message; }
      try { r.pol3 = await (await fetch('/ref-pol3')).text(); } catch (e) { r.pol3 = 'ERRO ' + e.message; }
      // Astra B136: referrer EXPLICITO tambem herda a politica do documento
      try { const o = await fetch('/ref-pol4', { referrer: '/private' }); r.pol4 = o.status + ':' + (await o.text()); } catch (e) { r.pol4 = 'ERRO ' + e.message; }
      try { r.pol5 = await (await fetch('/ref-pol5', { referrer: '/private' })).text(); } catch (e) { r.pol5 = 'ERRO ' + e.message; }
    }
  }
  // Astra B141: upload em FLUXO same-origin com os mesmos bytes do corpo pronto capturado.
  if (location.origin === '${fonteOrigin}') {
    try { r.upPronto = await (await fetch('/up-api', { method: 'POST', body: 'x', headers: { 'content-type': 'text/plain' } })).text(); } catch (e) { r.upPronto = 'ERRO ' + e.message; }
  } else {
    try { const o = await fetch('/up-api', { method: 'POST', body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array([0x78])); c.close(); } }), duplex: 'half', headers: { 'content-type': 'text/plain' } }); r.upFluxo = o.status + ':' + (await o.text()); } catch (e) { r.upFluxo = 'ERRO ' + e.message; }
    try { r.upPronto = await (await fetch('/up-api', { method: 'POST', body: 'x', headers: { 'content-type': 'text/plain' } })).text(); } catch (e) { r.upPronto = 'ERRO ' + e.message; }
  }
  // Astra B111: DPR:1 e safelisted pelo Chromium (sem OPTIONS). Na fonte, corpo string; no clone,
  // a mesma chamada em fluxo como 1a consumidora — a captura nao pode ter certificado preflight.
  if (location.origin === '${fonteOrigin}') {
    try { r.dpr = await (await fetch('${externoOrigin}/dpr-post', { method: 'POST', body: '', headers: { 'content-type': 'text/plain', dpr: '1' }, credentials: 'include' })).text(); } catch (e) { r.dpr = 'ERRO ' + e.message; }
  } else {
    try { const o = await fetch('${externoOrigin}/dpr-post', { method: 'POST', body: new ReadableStream({ start(c) { c.close(); } }), duplex: 'half', headers: { 'content-type': 'text/plain', dpr: '1' }, credentials: 'include' }); r.dpr = o.type + ':' + (await o.text()); } catch (e) { r.dpr = 'ERRO ' + e.message; }
  }
  // Astra B104: Range simples e safelisted — sem OPTIONS; a captura nao pode fabricar evidencia de preflight.
  try { r.rangePost = await (await fetch('${externoOrigin}/range-post', { method: 'POST', body: '', headers: { 'content-type': 'text/plain', range: 'bytes=0-0' }, credentials: 'include' })).text(); } catch (e) { r.rangePost = 'ERRO ' + e.message; }
  // Astra B81: 302 SEM ACAO -> /ok-star (200, ACAO '*'). Sob no-cors os saltos chegam (opacos);
  // em modo cors o nativo rejeitaria no 302. O envelope tem que sair OPACO, nao legivel.
  try { const o = await fetch('${externoOrigin}/relay-nocors', { mode: 'no-cors' }); r.relayNoCors = o.type + ':' + (await o.text()); } catch (e) { r.relayNoCors = 'ERRO ' + e.message; }
  // Astra B82: A -> B (302 sem ACAO) -> A (200, ACAO '*', corpo secreto). O terminal volta a A, mas
  // a cadeia cruzou origem: opaco sob no-cors, rejeitado sob cors; o corpo nunca entra no pacote.
  try { const o = await fetch('/relay-a', { mode: 'no-cors' }); r.relayA = o.type + ':' + (await o.text()); } catch (e) { r.relayA = 'ERRO ' + e.message; }
  // Astra B83: A -> B (302, ACAO *) -> A. Terminal com ACAO = A: em modo cors o nativo REJEITA
  // (origem serializada = null depois do salto) => opaco. Terminal com ACAO = null: passa.
  try { const o = await fetch('/relay-a2', { mode: 'no-cors' }); r.relayA2 = o.type + ':' + (await o.text()); } catch (e) { r.relayA2 = 'ERRO ' + e.message; }
  try { const o = await fetch('/relay-null', { mode: 'no-cors' }); r.relayNull = o.type + ':' + (await o.text()); } catch (e) { r.relayNull = 'ERRO ' + e.message; }
  // Astra B84: A -> B (terminal em B). Em B a origem serializada ainda e A: ACAO = A le (e o
  // replay em cors recebe o corpo); ACAO = null NAO le (opaco em no-cors, rejeitado em cors).
  // Astra B85: o 302 sem ACAO traz um content-type de midia (ou um content-length enorme) — as
  // guardas de asset saiam antes de registrar o salto e a cadeia ficava so com o terminal.
  try { const o = await fetch('${externoOrigin}/relay-media', { mode: 'no-cors' }); r.relayMedia = o.type + ':' + (await o.text()); } catch (e) { r.relayMedia = 'ERRO ' + e.message; }
  try { const o = await fetch('${externoOrigin}/relay-big', { mode: 'no-cors' }); r.relayBig = o.type + ':' + (await o.text()); } catch (e) { r.relayBig = 'ERRO ' + e.message; }
  // Astra B86: TERMINAL de midia (video/mp4) sem ACAO — direto em B e via A -> B -> A. A guarda de
  // midia saia antes da classificacao e a repescagem guardava o corpo como asset desprotegido.
  try { const o = await fetch('${externoOrigin}/secret-media-b', { mode: 'no-cors' }); r.mediaB = o.type + ':' + (await o.text()); } catch (e) { r.mediaB = 'ERRO ' + e.message; }
  try { const o = await fetch('/relay-media-a', { mode: 'no-cors' }); r.mediaA = o.type + ':' + (await o.text()); } catch (e) { r.mediaA = 'ERRO ' + e.message; }
  // Astra B87: midia LEGIVEL (video/mp4 com ACAO '*') — e envelope, nunca asset da repescagem;
  // em cors o replay recebe o corpo do envelope; em no-cors segue opaco.
  try { const o = await fetch('${externoOrigin}/media-star', { mode: 'no-cors' }); r.mediaStarNoCors = o.type + ':' + (await o.text()); } catch (e) { r.mediaStarNoCors = 'ERRO ' + e.message; }
  try { const o = await fetch('${externoOrigin}/media-star', { mode: 'cors' }); r.mediaStarCors = o.type + ':' + (await o.text()); } catch (e) { r.mediaStarCors = 'ERRO ' + e.message; }
  try { const o = await fetch('/relay-media-star', { mode: 'no-cors' }); r.mediaStarA = o.type + ':' + (await o.text()); } catch (e) { r.mediaStarA = 'ERRO ' + e.message; }
  // Astra B88: cadeia SAME-ORIGIN /relay-movie -> /movie (video/mp4) com identidade por cabecalho.
  // A midia same-origin vai para a repescagem (sem envelope), mas o asset /movie tem que ficar
  // PROTEGIDO: um miss de identidade nunca pode receber a copia estatica.
  try { const o = await fetch('/relay-movie', { headers: { 'api-key': 'A' } }); r.movie = o.type + ':' + (await o.text()).length; } catch (e) { r.movie = 'ERRO ' + e.message; }
  // Astra B89: XHR (nao fetch) de midia com api-key A — o asset da repescagem tambem tem que ficar
  // protegido: um fetch do replay com outra identidade nunca pode receber a copia.
  await new Promise(function (done) { try { const x = new XMLHttpRequest(); x.open('GET', '/movie-x'); x.setRequestHeader('api-key', 'A'); x.onloadend = function () { r.movieX = x.status + ':' + x.responseText.length; done(); }; x.send(); } catch (e) { r.movieX = 'ERRO ' + e.message; done(); } });
  // So NO REPLAY (origem do clone): uma chamada com OUTRA identidade que a captura nunca viu — miss
  // num caminho protegido tem que rejeitar, nunca servir a copia estatica de /movie.
  if (location.origin !== '${fonteOrigin}') {
    try { const o = await fetch('${externoOrigin}/range-post', { method: 'POST', body: new ReadableStream({ start(c) { c.close(); } }), duplex: 'half', headers: { 'content-type': 'text/plain', range: 'bytes=0-0' }, credentials: 'include' }); r.rangeStream = o.type + ':' + (await o.text()); } catch (e) { r.rangeStream = 'ERRO ' + e.message; }
    try { const o = await fetch('${externoOrigin}/cred-post', { method: 'POST', body: new ReadableStream({ start(c) { c.close(); } }), duplex: 'half', headers: { 'content-type': 'text/plain' }, credentials: 'include' }); r.credPostStream = o.type + ':' + (await o.text()); } catch (e) { r.credPostStream = 'ERRO ' + e.message; }
    // o alvo e o asset LOCALIZADO (sob o prefixo do pacote), como um literal reescrito
    try { const o = await fetch(new URL('movie', location.href).href, { headers: { 'api-key': 'B' } }); r.movieB = o.type + ':' + (await o.text()).length; } catch (e) { r.movieB = 'ERRO ' + e.message; }
    try { const o = await fetch(new URL('movie-x', location.href).href, { headers: { 'api-key': 'B' } }); r.movieXB = o.type + ':' + (await o.text()).length; } catch (e) { r.movieXB = 'ERRO ' + e.message; }
  }
  try { const o = await fetch('/relay-b-a', { mode: 'no-cors' }); r.relayBaNoCors = o.type + ':' + (await o.text()); } catch (e) { r.relayBaNoCors = 'ERRO ' + e.message; }
  try { const o = await fetch('/relay-b-a', { mode: 'cors' }); r.relayBaCors = o.type + ':' + (await o.text()); } catch (e) { r.relayBaCors = 'ERRO ' + e.message; }
  try { const o = await fetch('/relay-b-null', { mode: 'no-cors' }); r.relayBnullNoCors = o.type + ':' + (await o.text()); } catch (e) { r.relayBnullNoCors = 'ERRO ' + e.message; }
  try { const o = await fetch('/relay-b-null', { mode: 'cors' }); r.relayBnullCors = o.type + ':' + (await o.text()); } catch (e) { r.relayBnullCors = 'ERRO ' + e.message; }
  // ACAO em CAIXA DIFERENTE (Astra B40): sob no-cors ha resposta (opaca) e a captura ve o
  // corpo; sob cors o nativo rejeita. O corpo escondido nunca pode replayar sob cors.
  try { const o = await fetch('${externoOrigin}/acao-case', { mode: 'no-cors' }); r.acaoCaseNoCors = o.type + ':' + o.status + ':' + await o.text(); } catch (e) { r.acaoCaseNoCors = 'ERRO ' + e.message; }
  try { r.acaoCaseCors = await (await fetch('${externoOrigin}/acao-case')).text(); } catch (e) { r.acaoCaseCors = 'ERRO ' + e.message; }
  // Controle positivo: cross-origin LEGIVEL (ACAO *) em modo cors replaya pelo envelope.
  try { r.legivel = await (await fetch('${externoOrigin}/legivel')).text(); } catch (e) { r.legivel = 'ERRO ' + e.message; }
  // <base href> CROSS-ORIGIN inserido no fim (Astra B12): a partir daqui '/coleta2' e
  // um POST EXTERNO para o navegador; no clone tem que falhar fechado.
  document.head.appendChild(Object.assign(document.createElement('base'), { href: '${externoOrigin}/' }));
  try { r.baseExterno = await (await fetch('/coleta2', { method: 'POST', body: 'x' })).text(); } catch (e) { r.baseExterno = 'ERRO ' + e.message; }
  window.__resultado = r; document.body.dataset.pronto = '1';
});</script>
</body></html>`;

beforeAll(async () => {
  externo = createServer((req, res) => {
    if (req.url === '/opaco') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('hidden-payload'); return; }
    if (req.url === '/opaco2') { res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': 'https://unrelated.example' }); res.end('hidden-payload-2'); return; }
    if (req.url === '/legivel') { res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' }); res.end('visible'); return; }
    if (req.url === '/avatar.png') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(PNG); return; }
    if (req.url === '/acao-case') { res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': String(req.headers.origin || '').replace('localhost', 'LOCALHOST') }); res.end('hidden-case'); return; }
    if (req.url === '/cred-True') { res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': req.headers.origin || '', 'access-control-allow-credentials': 'True' }); res.end('vazou'); return; }
    if (req.url === '/cred-ok') { res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': req.headers.origin || '', 'access-control-allow-credentials': 'true' }); res.end('privado'); return; }
    if (req.url === '/cred-relay') { res.writeHead(302, { location: '/cred-ok', 'access-control-allow-origin': '*' }); res.end(); return; }
    if (req.url === '/cred-pre' && req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': req.headers.origin || '', 'access-control-allow-headers': 'api-key', 'access-control-allow-methods': 'GET' }); res.end(); return; }
    if (req.url === '/cred-pre') { res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': req.headers.origin || '', 'access-control-allow-credentials': 'true' }); res.end('PRE_PAYLOAD'); return; }
    if (req.url === '/json-final' && req.method === 'OPTIONS') { hits.jsonOptions = (hits.jsonOptions || 0) + 1; res.writeHead(403); res.end(); return; }
    if (req.url === '/json-final') { res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': req.headers.origin || '', 'access-control-allow-credentials': 'true' }); res.end('CAPTURED_FINAL'); return; }
    if (req.url === '/proto-acct' && req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': req.headers.origin || '', 'access-control-allow-headers': '__proto__', 'access-control-allow-methods': 'GET' }); res.end(); return; }
    if (req.url === '/proto-acct') { res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': req.headers.origin || '' }); res.end(req.headers['__proto__'] === 'A' ? 'ACCOUNT_A' : 'LIVE_SEM_CABECALHO'); return; }
    if (req.url === '/overlap' && req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': req.headers.origin || '', 'access-control-allow-headers': 'api-key, x-lento, range', 'access-control-allow-methods': 'POST' }); res.end(); return; }
    if (req.url === '/overlap') { let corpo = ''; req.on('data', (c) => { corpo += c; }); req.on('end', () => { const h = { 'content-type': 'text/plain', 'access-control-allow-origin': req.headers.origin || '', 'access-control-allow-credentials': 'true' }; if (corpo === 'lento') { setTimeout(() => { res.writeHead(200, h); res.end('A_PAYLOAD'); }, 600); return; } res.writeHead(200, h); res.end('B_PAYLOAD'); }); return; }
    if (req.url === '/xhr-then-fetch' && req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': req.headers.origin || '', 'access-control-allow-headers': 'api-key', 'access-control-allow-methods': 'POST' }); res.end(); return; }
    if (req.url === '/xhr-then-fetch') { res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': req.headers.origin || '', 'access-control-allow-credentials': 'true' }); res.end('CAPTURED_PAYLOAD'); return; }
    if (req.url === '/dpr-post' && req.method === 'OPTIONS') { hits.dprOptions = (hits.dprOptions || 0) + 1; res.writeHead(403); res.end(); return; }
    if (req.url === '/dpr-post') { res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': req.headers.origin || '', 'access-control-allow-credentials': 'true' }); res.end('CAPTURED_PAYLOAD'); return; }
    if (req.url === '/ct-post' && req.method === 'OPTIONS') { hits.ctOptions = (hits.ctOptions || 0) + 1; res.writeHead(403); res.end(); return; }
    if (req.url === '/ct-post' && req.method === 'POST') { res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': req.headers.origin || '', 'access-control-allow-credentials': 'true' }); res.end('CAPTURED'); return; }
    if (req.url === '/range-post' && req.method === 'OPTIONS') { hits.rangeOptions = (hits.rangeOptions || 0) + 1; res.writeHead(403); res.end(); return; }
    if (req.url === '/range-post' && req.method === 'POST') { res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': req.headers.origin || '', 'access-control-allow-credentials': 'true' }); res.end('RANGE_OK'); return; }
    if (req.url === '/cred-post' && req.method === 'POST') { res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': req.headers.origin || '', 'access-control-allow-credentials': 'true' }); res.end('POST_PAYLOAD'); return; }
    if (req.url === '/cred-pre-cc' && req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': req.headers.origin || '', 'access-control-allow-headers': 'cache-control', 'access-control-allow-methods': 'GET' }); res.end(); return; }
    if (req.url === '/cred-pre-cc') { res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': req.headers.origin || '', 'access-control-allow-credentials': 'true' }); res.end('PRE_CC'); return; }
    if (req.url === '/cred-pre-accept' && req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': req.headers.origin || '', 'access-control-allow-headers': 'accept', 'access-control-allow-methods': 'GET' }); res.end(); return; }
    if (req.url === '/cred-pre-accept') { res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': req.headers.origin || '', 'access-control-allow-credentials': 'true' }); res.end('PRE_ACCEPT'); return; }
    if (req.url === '/cred-pre-ok' && req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': req.headers.origin || '', 'access-control-allow-headers': 'api-key', 'access-control-allow-methods': 'GET', 'access-control-allow-credentials': 'true' }); res.end(); return; }
    if (req.url === '/cred-pre-ok') { res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': req.headers.origin || '', 'access-control-allow-credentials': 'true' }); res.end('PRE_OK'); return; }
    if (req.url === '/relay-nocors') { res.writeHead(302, { location: '/ok-star' }); res.end(); return; }
    if (req.url === '/ok-star') { res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' }); res.end('HIDDEN'); return; }
    if (req.url === '/relay-back') { res.writeHead(302, { location: `${fonteOrigin}/ok-star-a` }); res.end(); return; }
    if (req.url === '/back-a2') { res.writeHead(302, { location: `${fonteOrigin}/secret-a`, 'access-control-allow-origin': '*' }); res.end(); return; }
    if (req.url === '/back-null') { res.writeHead(302, { location: `${fonteOrigin}/secret-null`, 'access-control-allow-origin': '*' }); res.end(); return; }
    if (req.url === '/b-a') { res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': fonteOrigin }); res.end('VISIBLE_B'); return; }
    if (req.url === '/relay-media') { res.writeHead(302, { location: '/ok-media', 'content-type': 'video/mp4' }); res.end(); return; }
    if (req.url === '/relay-big') { res.writeHead(302, { location: '/ok-media', 'content-length': '999999999' }); res.end(); return; }
    if (req.url === '/ok-media') { res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' }); res.end('HIDDEN_MEDIA'); return; }
    if (req.url === '/secret-media-b') { res.writeHead(200, { 'content-type': 'video/mp4' }); res.end('SECRET_MEDIA_B'); return; }
    if (req.url === '/media-star') { res.writeHead(200, { 'content-type': 'video/mp4', 'access-control-allow-origin': '*' }); res.end('MEDIA_STAR'); return; }
    if (req.url === '/back-media-star') { res.writeHead(302, { location: `${fonteOrigin}/media-star-a`, 'access-control-allow-origin': '*' }); res.end(); return; }
    if (req.url === '/back-media') { res.writeHead(302, { location: `${fonteOrigin}/secret-media`, 'access-control-allow-origin': '*' }); res.end(); return; }
    if (req.url === '/b-null') { res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': 'null' }); res.end('SECRET_BNULL'); return; }
    hits.externoPost += 1; res.writeHead(200); res.end('coletado');   // /coleta e /coleta2
  });
  await new Promise((d) => externo.listen(0, '127.0.0.1', d));
  externoOrigin = `http://localhost:${externo.address().port}`;

  fonte = createServer((req, res) => {
    let corpo = '';
    req.on('data', (c) => { corpo += c; });
    req.on('end', () => {
      if (req.url === '/api') {
        // A 2ª chamada de fetch tem o corpo DESTRUÍDO a meio (ocorrência que a captura
        // não obtém): a lista tem que ficar [primeira, BURACO, terceira].
        hits.api += 1;
        const n = hits.api;   // 1=xhr, 2=a1, 3=a2 (destruida), 4=a3, 5=a4 (302), 6=a5 (41 MiB), 7=a6, 8/9=a7/a8 (300 terminal)
        if (n === 8 || n === 9) { res.writeHead(300, { 'content-type': 'text/plain' }); res.end('trezentos'); return; }
        if (n === 3) { res.writeHead(200, { 'content-type': 'text/plain', 'content-length': '100' }); res.write('meta'); setTimeout(() => res.socket.destroy(), 50); return; }
        if (n === 5) { res.writeHead(302, { location: '/api-destino' }); res.end(); return; }
        if (n === 6) { res.writeHead(200, { 'content-type': 'text/plain', 'content-length': String(41 * 1024 * 1024) }); res.write('x'); setTimeout(() => res.socket.destroy(), 50); return; }
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end({ 1: 'xhr', 2: 'primeira', 4: 'terceira', 7: 'sexta' }[n] || 'inesperada');
        return;
      }
      if (req.url === '/api-destino') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('quarta'); return;
      }
      if (req.url === '/relay') { res.writeHead(302, { location: `${externoOrigin}/legivel` }); res.end(); return; }
      if (req.url === '/blob-call') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end(corpo === 'A' ? 'ACCOUNT_BLOB_CALL' : 'SEM_CORPO'); return; }
      if (req.url === '/blob-disf') { hits.blobDisf = corpo; res.writeHead(200, { 'content-type': 'text/plain' }); res.end(corpo === 'A' ? 'ACCOUNT_BLOB_DISF' : 'SEM_CORPO'); return; }
      if (req.url === '/blob-size') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end(corpo === 'A' ? 'ACCOUNT_BLOB_SIZE' : 'SEM_CORPO'); return; }
      if (req.url === '/blob-iframe') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end(corpo === 'A' ? 'ACCOUNT_BLOB_IFRAME' : 'SEM_CORPO'); return; }
      if (req.url === '/cache-api') { hits.cacheApi = (hits.cacheApi || 0) + 1; res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'max-age=60' }); res.end(hits.cacheApi === 1 ? 'OLD' : 'NEW'); return; }
      if (req.url === '/ordem') { hits.ordem = (hits.ordem || 0) + 1; res.writeHead(200, { 'content-type': 'text/plain' }); res.end(hits.ordem === 1 ? 'FIRST' : 'SECOND'); return; }
      if (req.url === '/blob-post-req') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end(corpo === 'A' ? 'ACCOUNT_BLOB_REQ' : 'SEM_CORPO'); return; }
      if (req.url === '/blob-post') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end(corpo === 'A' ? 'ACCOUNT_BLOB' : 'SEM_CORPO'); return; }
      if (req.url === '/json-303') { res.writeHead(303, { location: `${externoOrigin}/json-final` }); res.end(); return; }
      if (req.url === '/post-307') { res.writeHead(307, { location: '/post-final' }); res.end(); return; }
      if (req.url === '/mode-sfm') { hits.sfm = (hits.sfm || 0) + 1; const ok = req.headers['sec-fetch-mode'] === 'cors'; res.writeHead(ok ? 200 : 403, { 'content-type': 'text/plain', 'cache-control': 'no-store' }); res.end(ok ? 'PRIVATE' : 'DENIED'); return; }
      if (req.url === '/ref-api') { hits.ref = (hits.ref || 0) + 1; const ok = /\/private$/.test(req.headers.referer || ''); res.writeHead(ok ? 200 : 403, { 'content-type': 'text/plain', 'cache-control': 'no-store' }); res.end(ok ? 'PRIVATE' : 'DENIED'); return; }
      if (req.url === '/del-ctl') { (hits.delCtl = hits.delCtl || []).push(req.headers['content-length'] === undefined ? 'sem' : req.headers['content-length']); res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' }); res.end('ok'); return; }
      if (req.url === '/del-cl') { hits.delCl = (hits.delCl || 0) + 1; res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' }); res.end(req.headers['content-length'] === '0' ? 'EMPTY' : 'ABSENT'); return; }
      if (req.url === '/ref-ctl') { (hits.refCtl = hits.refCtl || []).push(req.headers.referer ? 'com' : 'sem'); res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' }); res.end('ok'); return; }
      if (['/ref-pol2', '/ref-pol3', '/ref-pol4', '/ref-pol5'].includes(req.url)) { hits[req.url] = (hits[req.url] || 0) + 1; res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' }); res.end(req.headers.referer ? 'PRIVATE' : 'DENIED'); return; }
      if (req.url === '/up-api') { hits.up = (hits.up || 0) + 1; res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' }); res.end('PRIVATE'); return; }
      if (req.url === '/post-303') { res.writeHead(303, { location: '/post-final-get' }); res.end(); return; }
      if (req.url === '/post-final') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('FINAL_307'); return; }
      if (req.url === '/post-final-get') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('FINAL_303'); return; }
      if (req.url === '/relay-a') { res.writeHead(302, { location: `${externoOrigin}/relay-back` }); res.end(); return; }
      if (req.url === '/ok-star-a') { res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' }); res.end('HIDDEN_A'); return; }
      if (req.url === '/relay-a2') { res.writeHead(302, { location: `${externoOrigin}/back-a2` }); res.end(); return; }
      if (req.url === '/secret-a') { res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': fonteOrigin }); res.end('SECRET_A2'); return; }
      if (req.url === '/relay-null') { res.writeHead(302, { location: `${externoOrigin}/back-null` }); res.end(); return; }
      if (req.url === '/relay-b-a') { res.writeHead(302, { location: `${externoOrigin}/b-a` }); res.end(); return; }
      if (req.url === '/relay-b-null') { res.writeHead(302, { location: `${externoOrigin}/b-null` }); res.end(); return; }
      if (req.url === '/relay-media-a') { res.writeHead(302, { location: `${externoOrigin}/back-media` }); res.end(); return; }
      if (req.url === '/secret-media') { res.writeHead(200, { 'content-type': 'video/mp4' }); res.end('SECRET_MEDIA_A'); return; }
      if (req.url === '/relay-media-star') { res.writeHead(302, { location: `${externoOrigin}/back-media-star` }); res.end(); return; }
      if (req.url === '/media-star-a') { res.writeHead(200, { 'content-type': 'video/mp4', 'access-control-allow-origin': '*' }); res.end('MEDIA_STAR_A'); return; }
      if (req.url === '/relay-movie') { res.writeHead(302, { location: '/movie' }); res.end(); return; }
      if (req.url === '/movie') { res.writeHead(200, { 'content-type': 'video/mp4' }); res.end('MOVIE_BYTES'); return; }
      if (req.url === '/movie-x') { res.writeHead(200, { 'content-type': 'video/mp4' }); res.end('MOVIE_X_BYTES'); return; }
      if (req.url === '/secret-null') { res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': 'null' }); res.end('VISIBLE_NULL'); return; }
      if (req.url === '/dados.json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ foto: `${fonteOrigin}/m/f.png` })); return; }
      if (req.url === '/m/f.png') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(PNG); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(SITE(externoOrigin));
    });
  });
  await new Promise((d) => fonte.listen(0, '127.0.0.1', d));
  fonteOrigin = `http://localhost:${fonte.address().port}`;
}, 30000);

afterAll(async () => { for (const s of [fonte, clone, externo]) if (s) await new Promise((d) => s.close(d)); });

describe('o pacote executado noutra origem', () => {
  it('replaya as chamadas do site sob /api/runtime/tok/ e falha fechado no POST externo', async () => {
    const r = await captureNativeBundle(`${fonteOrigin}/`, { viewport: { width: 800, height: 600 } });
    expect(hits.api).toBe(9);   // 8 fetch + 1 XHR chegaram à fonte
    const arquivos = new Map(r.bundle.assets.map((a) => [a.path, a]));
    // Três perdas NOMEADAS, cada uma real: o corpo destruído a meio (o `finished()` do
    // Playwright não resolve para ele — é o teto de tempo que o nomeia), os 41 MiB
    // declarados, e o POST externo que o navegador vivo bloqueou por CORS (nunca houve
    // resposta terminal; a varredura final o nomeia).
    expect(r.relatorio.envelopesPerdidos.map((x) => `${x.motivo} @ ${new URL(x.u).pathname}`).sort())
      // `/cred-True`: o proprio Chromium bloqueia a resposta (ACAC 'True' nao e 'true' — medido:
      // nenhum evento de resposta), logo nenhum envelope existe e a raiz e nomeada.
      .toEqual(['corpo de 3xx indisponivel na captura @ /api', 'corpo de 3xx indisponivel na captura @ /api', 'grande demais (declarado) @ /api', 'sem resposta terminal @ /acao-case', 'sem resposta terminal @ /coleta', 'sem resposta terminal @ /coleta2', 'sem resposta terminal @ /cred-True', 'sem resposta terminal @ /relay-b-null', 'sem resposta terminal @ /relay-movie', 'teto de tempo @ /api']);

    // Segundo servidor, outra origem, sob o prefixo do gateway.
    const PREFIXO = '/api/runtime/tok/';
    clone = createServer((req, res) => {
      if (req.method === 'POST') { hits.clonePost += 1; res.writeHead(404); res.end(); return; }
      const caminho = req.url.split('?')[0];
      if (!caminho.startsWith(PREFIXO)) { res.writeHead(404); res.end(); return; }
      const rel = decodeURIComponent(caminho.slice(PREFIXO.length)) || r.bundle.entryPath;
      const a = arquivos.get(rel);
      if (!a) { res.writeHead(404); res.end('nao existe'); return; }
      res.writeHead(200, { 'content-type': a.contentType || 'application/octet-stream' });
      res.end(Buffer.from(a.body));
    });
    await new Promise((d) => clone.listen(0, '127.0.0.1', d));
    cloneOrigin = `http://localhost:${clone.address().port}`;

    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const externosAntes = hits.externoPost;
      await page.goto(`${cloneOrigin}${PREFIXO}${r.bundle.entryPath}`, { waitUntil: 'load' });
      await page.waitForSelector('body[data-pronto="1"]', { timeout: 20000 });
      const res = await page.evaluate(() => window.__resultado);
      // Astra B80: o envelope de /cred-relay (302 ACAO '*' -> 200 credenciado) NAO e elegivel a
      // credenciais — o nativo rejeita 'include' no 302. Le-se o manifesto embutido no HTML.
      {
        const html = Buffer.from(arquivos.get(r.bundle.entryPath).body).toString('utf8');
        const m = /^\s*var M = (\{.*\});\s*$/m.exec(html);   // literal JSON numa linha (jsonParaScript)
        expect(m, 'manifesto embutido').toBeTruthy();
        const M = JSON.parse(m[1]);
        const idRelay = identidadeDeRequisicao('GET', `${externoOrigin}/cred-relay`, Buffer.alloc(0), {}, 'omit');
        expect(M[idRelay], 'envelope do relay').toBeTruthy();
        expect(M[idRelay][0].corsCredenciado).toBeUndefined();
        expect(M[idRelay][0].externo).toBe(true);
        expect(res.credRelay).toBe('privado');   // em 'omit' a chamada e legivel, ao vivo e no replay
        // Astra B93: preflight sem ACAC + captura em 'omit' => envelope legivel mas NAO credenciado;
        // controle: captura em 'include' com preflight credenciado => credenciado.
        const idPre = identidadeDeRequisicao('GET', `${externoOrigin}/cred-pre`, Buffer.alloc(0), { 'api-key': 'k' }, 'omit');
        expect(M[idPre], 'envelope cred-pre').toBeTruthy();
        expect(M[idPre][0].status).toBe(200);
        expect(M[idPre][0].corsCredenciado).toBeUndefined();
        const idPreOk = identidadeDeRequisicao('GET', `${externoOrigin}/cred-pre-ok`, Buffer.alloc(0), { 'api-key': 'k' }, 'include');
        expect(M[idPreOk], 'envelope cred-pre-ok').toBeTruthy();
        expect(M[idPreOk][0].corsCredenciado).toBe(true);
        expect(M[idPreOk][0].preflightCabecalhos).toEqual(['api-key']);   // Astra B108
        expect(res.credPre).toBe('PRE_PAYLOAD'); expect(res.credPreOk).toBe('PRE_OK');
        // Astra B94: Accept de 129 bytes obriga preflight; capturado em 'omit' => sem corsCredenciado
        const idPreAccept = identidadeDeRequisicao('GET', `${externoOrigin}/cred-pre-accept`, Buffer.alloc(0), { accept: 'a'.repeat(129) }, 'omit');
        expect(M[idPreAccept], 'envelope cred-pre-accept').toBeTruthy();
        expect(M[idPreAccept][0].status).toBe(200);
        expect(M[idPreAccept][0].corsCredenciado).toBeUndefined();
        expect(res.credPreAccept).toBe('PRE_ACCEPT');
        // Astra B95: cache-control do script => preflight; em 'omit' => sem corsCredenciado
        const idPreCc = identidadeDeRequisicao('GET', `${externoOrigin}/cred-pre-cc`, Buffer.alloc(0), { 'cache-control': 'no-cache' }, 'omit');   // todo cabecalho do script entra (B128)
        expect(M[idPreCc], 'envelope cred-pre-cc').toBeTruthy();
        expect(M[idPreCc][0].status).toBe(200);
        expect(M[idPreCc][0].corsCredenciado).toBeUndefined();
        expect(res.credPreCc).toBe('PRE_CC');
        // Astra B97: POST simples em omit => corsCredenciado (terminal) mas SEM preflightCredenciado;
        // o replay-only com corpo em fluxo + include e rejeitado (exigiria preflight); o omit e servido.
        const idPost = identidadeDeRequisicao('POST', `${externoOrigin}/cred-post`, Buffer.alloc(0), { 'content-type': 'text/plain' }, 'omit');
        expect(M[idPost], 'envelope cred-post').toBeTruthy();
        expect(M[idPost][0].corsCredenciado).toBe(true);
        expect(M[idPost][0].preflightCredenciado).toBeUndefined();
        expect(M[idPreOk][0].preflightCredenciado).toBe(true);   // include + preflight na captura => verificado
        // Astra B103: preflight em modo cors (omit) => verificado em geral; POST simples => nao houve preflight
        expect(M[idPre][0].preflightVerificado).toBe(true);
        expect(M[idPost][0].preflightVerificado).toBeUndefined();
        expect(res.credPost).toBe('POST_PAYLOAD');
        expect(res.credPostStream, 'replay include com corpo em fluxo').toMatch(/^ERRO /);
        // Astra B104: Range simples => nenhum OPTIONS e nenhuma evidencia de preflight
        const idRange = identidadeDeRequisicao('POST', `${externoOrigin}/range-post`, Buffer.alloc(0), { 'content-type': 'text/plain', range: 'bytes=0-0' }, 'include');
        expect(M[idRange], 'envelope range-post').toBeTruthy();
        expect(M[idRange][0].preflightVerificado).toBeUndefined();
        expect(M[idRange][0].preflightCredenciado).toBeUndefined();
        expect(res.rangePost).toBe('RANGE_OK');
        expect(hits.rangeOptions || 0).toBe(0);
        expect(res.rangeStream, 'replay em fluxo com Range').toMatch(/^ERRO /);
        // Astra B105: content-type com espaco => simples; nenhum OPTIONS, nenhuma evidencia; 1a consumidora em fluxo rejeita
        const idCt = identidadeDeRequisicao('POST', `${externoOrigin}/ct-post`, Buffer.alloc(0), { 'content-type': 'text/plain ;charset=utf-8' }, 'include');
        expect(M[idCt], 'envelope ct-post').toBeTruthy();
        expect(M[idCt][0].preflightVerificado).toBeUndefined();
        expect(M[idCt][0].preflightCredenciado).toBeUndefined();
        expect(hits.ctOptions || 0).toBe(0);
        expect(res.ctPost, 'replay em fluxo nunca recebe o capturado (Astra B141)').not.toContain('CAPTURED');
        // Astra B106: o 1o salto 307 marca o envelope; o 303 nao
        // Astra B141: o fluxo nunca recebe o envelope do corpo pronto; o corpo pronto recebe
        expect(hits.up).toBe(1);
        expect(res.upFluxo, 'upload em fluxo nunca recebe o PRIVATE do corpo pronto').not.toMatch(/PRIVATE/);
        expect(res.upPronto, 'o corpo pronto recebe a sua ocorrencia').toBe('PRIVATE');
        // Astra B135: premissa nativa (so a meta muda o Referer) e o replay
        expect(hits.refCtl, 'a meta muda o Referer no navegador real').toEqual(['com', 'sem']);
        expect(hits['/ref-pol2']).toBe(1); expect(hits['/ref-pol3']).toBe(1);   // o clone nunca chegou a fonte
        expect(res.pol2, 'sob no-referrer nunca recebe o PRIVATE capturado sem meta').not.toMatch(/PRIVATE/);
        expect(res.pol3, 'a mesma politica casa (controle positivo)').toBe('DENIED');
        expect(hits['/ref-pol4']).toBe(1); expect(hits['/ref-pol5']).toBe(1);
        expect(res.pol4, 'referrer explicito sob no-referrer nunca recebe o PRIVATE').not.toMatch(/PRIVATE/);
        expect(res.pol5, 'referrer explicito sob a mesma politica casa').toBe('DENIED');
        // Astra B134: premissa medida no navegador real, depois o replay
        expect(hits.delCtl, 'o navegador distingue ausente de vazio').toEqual(['sem', '0']);
        expect(hits.delCl).toBe(1);
        expect(res.delVazio, 'o corpo vazio nunca recebe o ABSENT do sem corpo').not.toBe('ABSENT');
        expect(res.delAus, 'o sem corpo recebe a sua ocorrencia').toBe('ABSENT');
        // Astra B132: o documento de onde a chamada partiu decide a ocorrencia
        expect(hits.ref).toBe(1);
        expect(res.refPub, 'chamada de /public nunca recebe o PRIVATE de /private').not.toMatch(/PRIVATE/);
        expect(res.refPriv, 'a chamada de /private recebe a sua ocorrencia').toBe('PRIVATE');
        // Astra B131: modo fora da identidade deixava o no-cors do clone receber o PRIVATE do cors
        const idSfm = identidadeDeRequisicao('GET', `${fonteOrigin}/mode-sfm`, Buffer.alloc(0), {});
        expect(M[idSfm], 'envelope mode-sfm (cors)').toBeTruthy();
        expect(hits.sfm).toBe(1);
        expect(res.sfmNoCors, 'no-cors nunca recebe o PRIVATE do cors').not.toMatch(/PRIVATE/);
        expect(res.sfm, 'o cors recebe a sua ocorrencia').toBe('PRIVATE');
        const id307 = identidadeDeRequisicao('POST', `${fonteOrigin}/post-307`, Buffer.from('x'), { 'content-type': 'text/plain' });
        const id303 = identidadeDeRequisicao('POST', `${fonteOrigin}/post-303`, Buffer.from('x'), { 'content-type': 'text/plain' });
        expect(M[id307], 'envelope 307').toBeTruthy(); expect(M[id303], 'envelope 303').toBeTruthy();
        expect(M[id307][0].redirectRejeitaFluxo).toBe(true);
        expect(M[id303][0].redirectRejeitaFluxo).toBeUndefined();
        expect(res.r307).toBe('FINAL_307'); expect(res.r303).toBe('FINAL_303');
        // Astra B107: A -> 303 -> B sem OPTIONS: nenhuma evidencia; a 1a consumidora em fluxo rejeita
        const idJ = identidadeDeRequisicao('POST', `${fonteOrigin}/json-303`, Buffer.from('{}'), { 'content-type': 'application/json' }, 'include');
        expect(M[idJ], 'envelope json-303').toBeTruthy();
        expect(M[idJ][0].preflightVerificado).toBeUndefined();
        expect(M[idJ][0].preflightCredenciado).toBeUndefined();
        expect(hits.jsonOptions || 0).toBe(0);
        expect(res.p303, 'replay em fluxo nunca recebe o capturado (Astra B141)').not.toContain('CAPTURED');
        // Astra B111: DPR safelisted pelo Chromium — zero OPTIONS, nenhuma certificacao, fluxo rejeitado
        const idDpr = identidadeDeRequisicao('POST', `${externoOrigin}/dpr-post`, Buffer.alloc(0), { 'content-type': 'text/plain', dpr: '1' }, 'include');
        expect(M[idDpr], 'envelope dpr-post').toBeTruthy();
        expect(M[idDpr][0].preflightVerificado).toBeUndefined();
        expect(M[idDpr][0].preflightCredenciado).toBeUndefined();
        expect(hits.dprOptions || 0).toBe(0);
        expect(res.dpr, 'replay em fluxo nunca recebe o capturado (Astra B141)').not.toContain('CAPTURED');
        // Astra B112: a evidencia do preflight do XHR nao passa para o fetch simples a mesma URL
        const idXtf = identidadeDeRequisicao('POST', `${externoOrigin}/xhr-then-fetch`, Buffer.alloc(0), { 'content-type': 'text/plain' }, 'include');
        expect(M[idXtf], 'envelope xhr-then-fetch').toBeTruthy();
        expect(M[idXtf][0].preflightVerificado).toBeUndefined();
        expect(M[idXtf][0].preflightCredenciado).toBeUndefined();
        expect(res.xtf, 'replay em fluxo nunca recebe o capturado (Astra B141)').not.toContain('CAPTURED');
        // Astra B113: sobreposicao — A (x-lento, include) nao herda o preflight de B
        const idA = identidadeDeRequisicao('POST', `${externoOrigin}/overlap`, Buffer.from('lento'), { 'content-type': 'text/plain' }, 'include');
        expect(M[idA], 'envelope overlap A').toBeTruthy();
        expect(M[idA][0].preflightCredenciado).toBeUndefined();
        expect(res.overlapA, 'A em fluxo, 1a consumidora').toMatch(/^ERRO /);
        // Astra B114: B2 (Range >= INT64_MAX, omit, preflight sem ACAC) nao pode ficar credenciado
        const idB2 = identidadeDeRequisicao('POST', `${externoOrigin}/overlap`, Buffer.from('b2'), { 'content-type': 'text/plain', range: 'bytes=0-9223372036854775808' }, 'omit');
        expect(M[idB2], 'envelope B2').toBeTruthy();
        expect(M[idB2][0].corsCredenciado).toBeUndefined();
        // Astra B115: a identidade capturada inclui __proto__; o pedido sem cabecalho nao recebe ACCOUNT_A
        const idProto = identidadeDeRequisicao('GET', `${externoOrigin}/proto-acct`, Buffer.alloc(0), Object.fromEntries([['__proto__', 'A']]));
        const idSem = identidadeDeRequisicao('GET', `${externoOrigin}/proto-acct`, Buffer.alloc(0), {});
        expect(idProto).not.toBe(idSem);
        expect(M[idProto], 'envelope com __proto__').toBeTruthy();
        expect(M[idSem], 'nenhum envelope sem cabecalho').toBeUndefined();
        expect(res.proto, 'pedido sem cabecalho no clone').not.toBe('ACCOUNT_A');
        // Astra B116: corpo Blob inobservavel => nenhum envelope sob a identidade de corpo vazio
        const idVazio = identidadeDeRequisicao('POST', `${fonteOrigin}/blob-post`, Buffer.alloc(0), { 'content-type': 'application/octet-stream' });
        expect(M[idVazio], 'nenhum envelope de corpo vazio para o Blob').toBeUndefined();
        expect(res.blob, 'POST sem corpo no clone').not.toBe('ACCOUNT_BLOB');
        // Astra B117: corpo Blob HERDADO de Request — tambem nunca sob a identidade vazia
        const idVazioReq = identidadeDeRequisicao('POST', `${fonteOrigin}/blob-post-req`, Buffer.alloc(0), { 'content-type': 'application/octet-stream' });
        expect(M[idVazioReq], 'nenhum envelope de corpo vazio para o Blob herdado').toBeUndefined();
        expect(res.blobReq, 'POST sem corpo no clone (herdado)').not.toBe('ACCOUNT_BLOB_REQ');
        // Astra B118: grupo com chamada de corpo nao provado sai do replay inteiro — nunca SECOND na 1a
        const idOrdem = identidadeDeRequisicao('POST', `${fonteOrigin}/ordem`, Buffer.from('A'), { 'content-type': 'text/plain;charset=UTF-8' });
        expect(M[idOrdem], 'grupo envenenado sem envelopes').toBeUndefined();
        expect(res.ordem1, '1a chamada no clone').not.toBe('SECOND');
        // Astra B124: a sonda only-if-cached nao ocupa vaga — no clone o reload recebe NEW
        expect(hits.cacheApi, 'servidor viu 2 pedidos na captura (normal + reload)').toBe(2);
        expect(res.c1).toBe('OLD');
        expect(res.c3, 'reload no clone').toBe('NEW');
        // Astra B119: Blob herdado de Request de outro realm — nunca sob a identidade vazia
        const idIframe = identidadeDeRequisicao('POST', `${fonteOrigin}/blob-iframe`, Buffer.alloc(0), { 'content-type': 'application/octet-stream' });
        expect(M[idIframe], 'nenhum envelope de corpo vazio para o Blob de iframe').toBeUndefined();
        expect(res.blobIframe, 'POST sem corpo no clone (iframe)').not.toBe('ACCOUNT_BLOB_IFRAME');
        // Astra B120: Blob com size sombreado — nunca sob a identidade vazia
        const idSize = identidadeDeRequisicao('POST', `${fonteOrigin}/blob-size`, Buffer.alloc(0), { 'content-type': 'application/octet-stream' });
        expect(M[idSize], 'nenhum envelope de corpo vazio para o Blob de size sombreado').toBeUndefined();
        expect(res.blobSize, 'POST sem corpo no clone (size sombreado)').not.toBe('ACCOUNT_BLOB_SIZE');
        // Astra B121: Blob disfarcado de ArrayBuffer — o cenario tem que ter enviado o corpo real,
        // e nunca sob a identidade vazia
        expect(hits.blobDisf, 'Chromium enviou o corpo real do Blob disfarcado').toBe('A');
        const idDisf = identidadeDeRequisicao('POST', `${fonteOrigin}/blob-disf`, Buffer.alloc(0), { 'content-type': 'application/octet-stream' });
        expect(M[idDisf], 'nenhum envelope de corpo vazio para o Blob disfarcado').toBeUndefined();
        expect(res.blobDisf, 'POST sem corpo no clone (disfarcado)').not.toBe('ACCOUNT_BLOB_DISF');
        const idCall = identidadeDeRequisicao('POST', `${fonteOrigin}/blob-call`, Buffer.alloc(0), { 'content-type': 'application/octet-stream' });
        expect(M[idCall], 'nenhum envelope de corpo vazio com .call adulterado').toBeUndefined();
        expect(res.blobCall, 'POST sem corpo no clone (.call adulterado)').not.toBe('ACCOUNT_BLOB_CALL');
        // Astra B81: cadeia com salto sem ACAO => marcador OPACO (o corpo HIDDEN nunca entra no pacote)
        const idRelayNoCors = identidadeDeRequisicao('GET', `${externoOrigin}/relay-nocors`, Buffer.alloc(0), {}, { mode: 'no-cors' });
        expect(M[idRelayNoCors], 'envelope do relay no-cors').toBeTruthy();
        expect(M[idRelayNoCors][0]).toEqual({ opaco: true, documento: expect.any(String), politica: expect.any(String) });
        expect(html).not.toContain('HIDDEN');
        expect(res.relayNoCors).toBe('opaque:');   // ao vivo e no replay: opaco
        // Astra B82: A -> B -> A — terminal same-origin, cadeia cruzada => opaco; HIDDEN_A em lugar nenhum
        const idRelayA = identidadeDeRequisicao('GET', `${fonteOrigin}/relay-a`, Buffer.alloc(0), {}, { mode: 'no-cors' });
        expect(M[idRelayA], 'envelope do relay A->B->A').toBeTruthy();
        expect(M[idRelayA][0]).toEqual({ opaco: true, documento: expect.any(String), politica: expect.any(String) });
        for (const [caminho, a] of arquivos) expect(Buffer.from(a.body).toString('utf8'), caminho).not.toContain('HIDDEN_A');
        // No replay a ocorrencia opaca e miss e a URL (relativa ao clone) cai na propria origem do
        // clone: `basic` 404 com corpo vazio, nao `opaque` (residual declarado do modulo: `type` e o
        // do arquivo local). O que importa: corpo vazio, segredo em lugar nenhum.
        expect(res.relayA.endsWith(':')).toBe(true);
        expect(res.relayA).not.toContain('HIDDEN_A');
        // Astra B83: terminal ACAO = A depois de um salto cross-origin => a origem serializada e null,
        // o cors nativo rejeita => OPACO, segredo em lugar nenhum. Controle positivo: ACAO = null passa.
        const idA2 = identidadeDeRequisicao('GET', `${fonteOrigin}/relay-a2`, Buffer.alloc(0), {}, { mode: 'no-cors' });
        expect(M[idA2], 'envelope A->B->A com ACAO A').toBeTruthy();
        expect(M[idA2][0]).toEqual({ opaco: true, documento: expect.any(String), politica: expect.any(String) });
        for (const [caminho, a] of arquivos) expect(Buffer.from(a.body).toString('utf8'), caminho).not.toContain('SECRET_A2');
        const idNull = identidadeDeRequisicao('GET', `${fonteOrigin}/relay-null`, Buffer.alloc(0), {}, { mode: 'no-cors' });
        expect(M[idNull], 'envelope A->B->A com ACAO null').toBeTruthy();
        expect(M[idNull][0].opaco).toBeUndefined();
        expect(M[idNull][0].status).toBe(200);
        expect(M[idNull][0].externo).toBe(true);
        expect(res.relayA2.endsWith(':')).toBe(true);
        expect(res.relayA2).not.toContain('SECRET_A2');
        // Astra B84: A -> B com ACAO = A: legivel nas duas ocorrencias (no-cors e cors) e o replay
        // em cors recebe o corpo; com ACAO = null: opaco em no-cors e BURACO em cors (o Chromium
        // bloqueia no 302 sem evento de resposta), segredo em lugar nenhum.
        const idBa = identidadeDeRequisicao('GET', `${fonteOrigin}/relay-b-a`, Buffer.alloc(0), {}, { mode: 'no-cors' });
        // modo na identidade (Astra B131): uma ocorrencia por modo
        const idBaCors = identidadeDeRequisicao('GET', `${fonteOrigin}/relay-b-a`, Buffer.alloc(0), {});
        expect(M[idBa], 'envelopes A->B com ACAO A').toBeTruthy();
        expect(M[idBa].length).toBe(1); expect(M[idBaCors].length).toBe(1);
        expect(M[idBa][0].status).toBe(200); expect(M[idBaCors][0].status).toBe(200);
        expect(res.relayBaCors.endsWith(':VISIBLE_B')).toBe(true);   // servido do envelope (o `type` e o de uma Response construida)
        const idBnull = identidadeDeRequisicao('GET', `${fonteOrigin}/relay-b-null`, Buffer.alloc(0), {}, { mode: 'no-cors' });
        expect(M[idBnull], 'envelopes A->B com ACAO null').toBeTruthy();
        const idBnullCors = identidadeDeRequisicao('GET', `${fonteOrigin}/relay-b-null`, Buffer.alloc(0), {});
        expect(M[idBnull]).toEqual([{ opaco: true, documento: expect.any(String), politica: expect.any(String) }]);
        expect(M[idBnullCors]).toEqual([{ perdido: true, documento: expect.any(String), politica: expect.any(String) }]);
        for (const [caminho, a] of arquivos) expect(Buffer.from(a.body).toString('utf8'), caminho).not.toContain('SECRET_BNULL');
        expect(res.relayBnullCors).not.toContain('SECRET_BNULL');
        // Astra B85: salto com content-type de midia / content-length enorme, sem ACAO => opaco
        for (const rota of ['/relay-media', '/relay-big']) {
          const idRota = identidadeDeRequisicao('GET', `${externoOrigin}${rota}`, Buffer.alloc(0), {}, { mode: 'no-cors' });
          expect(M[idRota], `envelope de ${rota}`).toBeTruthy();
          expect(M[idRota][0], rota).toEqual({ opaco: true, documento: expect.any(String), politica: expect.any(String) });
        }
        for (const [caminho, a] of arquivos) expect(Buffer.from(a.body).toString('utf8'), caminho).not.toContain('HIDDEN_MEDIA');
        expect(res.relayMedia).toBe('opaque:'); expect(res.relayBig).toBe('opaque:');
        // Astra B86: terminal de midia sem ACAO => opaco; o corpo em arquivo nenhum
        const idMediaB = identidadeDeRequisicao('GET', `${externoOrigin}/secret-media-b`, Buffer.alloc(0), {}, { mode: 'no-cors' });
        expect(M[idMediaB], 'envelope midia direta em B').toBeTruthy();
        expect(M[idMediaB][0]).toEqual({ opaco: true, documento: expect.any(String), politica: expect.any(String) });
        const idMediaA = identidadeDeRequisicao('GET', `${fonteOrigin}/relay-media-a`, Buffer.alloc(0), {}, { mode: 'no-cors' });
        expect(M[idMediaA], 'envelope midia A->B->A').toBeTruthy();
        expect(M[idMediaA][0]).toEqual({ opaco: true, documento: expect.any(String), politica: expect.any(String) });
        for (const [caminho, a] of arquivos) { const s = Buffer.from(a.body).toString('utf8'); expect(s, caminho).not.toContain('SECRET_MEDIA_B'); expect(s, caminho).not.toContain('SECRET_MEDIA_A'); }
        expect(res.mediaB).toBe('opaque:');
        expect(res.mediaA.endsWith(':')).toBe(true);
        // Astra B87: midia legivel => envelopes (no-cors E cors), NUNCA asset da repescagem
        const idStar = identidadeDeRequisicao('GET', `${externoOrigin}/media-star`, Buffer.alloc(0), {}, { mode: 'no-cors' });
        expect(M[idStar], 'envelopes midia legivel em B').toBeTruthy();
        const idStarCors = identidadeDeRequisicao('GET', `${externoOrigin}/media-star`, Buffer.alloc(0), {});
        expect(M[idStar].length).toBe(1); expect(M[idStarCors].length).toBe(1);
        expect(M[idStar][0].status).toBe(200); expect(M[idStarCors][0].status).toBe(200);
        expect([...arquivos.keys()].some((c) => /media-star(?:-a)?$/.test(c))).toBe(false);   // nenhum asset estatico
        expect(res.mediaStarCors.endsWith(':MEDIA_STAR')).toBe(true);   // servido do envelope
        expect(res.mediaStarNoCors).toBe('opaque:');
        const idStarA = identidadeDeRequisicao('GET', `${fonteOrigin}/relay-media-star`, Buffer.alloc(0), {}, { mode: 'no-cors' });
        expect(M[idStarA], 'envelope midia legivel A->B->A').toBeTruthy();
        expect(M[idStarA][0].status).toBe(200);
        expect(M[idStarA][0].externo).toBe(true);
        // Astra B88: o terminal de midia same-origin /movie e asset (repescagem) mas PROTEGIDO
        const mDe = /var DE_FETCH = JSON\.parse\(("(?:[^"\\]|\\.)*")\)/.exec(html);
        expect(mDe, 'DE_FETCH embutido').toBeTruthy();
        const DE = JSON.parse(JSON.parse(mDe[1]));
        expect(Object.keys(DE)).toContain('movie');
        expect(arquivos.has('movie'), 'asset estatico /movie (repescagem)').toBe(true);   // existe — e por isso precisa da protecao
        // No replay, a chamada com OUTRA identidade (api-key B) e miss num caminho protegido: rejeita,
        // nunca a copia estatica (com a captura anterior recebia 'basic:11').
        expect(res.movieB, 'replay de /movie com api-key B').toMatch(/^ERRO /);
        // Astra B89: asset deixado por XHR de midia tambem protegido
        expect(Object.keys(DE)).toContain('movie-x');
        expect(arquivos.has('movie-x'), 'asset estatico /movie-x (repescagem)').toBe(true);
        expect(res.movieXB, 'replay de /movie-x com api-key B').toMatch(/^ERRO /);
      }
      expect(res.xhr).not.toBe('xhr');       // XHR não é replayado (vai ao servidor do clone)
      expect(res.xhr).not.toBe('primeira');
      expect(res.a1).toBe('primeira');       // …e NÃO consumiu a 1ª ocorrência do fetch
      expect(res.a2).not.toBe('terceira');   // o buraco NÃO empurra a 3ª para a 2ª
      expect(res.a3).toBe('terceira');
      expect(res.a4).toBe('quarta');         // redirect: a vaga é a do pedido raiz
      expect(res.a5).not.toBe('sexta');      // recusa antecipada deixa buraco
      expect(res.a6).toBe('sexta');
      expect(res.a7).not.toMatch(/^300:/);   // nunca um 300 vazio fabricado…
      expect(res.a8).not.toMatch(/^300:/);   // …nem na ocorrencia repetida (miss nomeado nas duas)
      expect(res.foto).toBe(`${cloneOrigin}${PREFIXO}m/f.png`);   // marcador → RAIZ do pacote
      expect(res.fotoDecodificou).toBe(true);
      expect(res.externo).toMatch(/^ERRO /);                         // falha fechada…
      expect(res.baseExterno).toMatch(/^ERRO /);                     // …tambem via <base> cross-origin…
      expect(res.opaco).not.toContain('hidden-payload');            // no-cors: nunca o envelope legivel
      // e o literal do script NAO foi reescrito para um arquivo local (a resposta opaca ficou fora do pacote)
      expect(Buffer.from(arquivos.get(r.bundle.entryPath).body).toString('utf8')).toContain(`'${externoOrigin}/opaco'`);
      expect(r.bundle.assets.some((a) => a.path.endsWith('/opaco'))).toBe(false);
      expect(res.opaco === 'opaque:0:' || res.opaco.startsWith('ERRO ')).toBe(true);
      expect(res.opaco2).not.toContain('hidden-payload-2');         // ACAO alheio nao libera
      expect(res.opaco2 === 'opaque:0:' || res.opaco2.startsWith('ERRO ')).toBe(true);
      expect(Buffer.from(arquivos.get(r.bundle.entryPath).body).toString('utf8')).toContain(`'${externoOrigin}/opaco2'`);
      expect(r.bundle.assets.some((a) => a.path.endsWith('/opaco2') || a.path.endsWith('/legivel'))).toBe(false);
      expect(res.legivel).toBe('visible');                          // legivel cross-origin: envelope, sem asset
      expect(res.credTrue).toMatch(/^ERRO /);                        // ACAC 'True' nao habilita include (paridade nativa)
      expect(res.avatar).not.toMatch(/^(basic|default):200:[1-9]/);  // imagem-primeiro: nunca o arquivo local legivel
      expect(res.avatar === 'opaque:0:0' || res.avatar.startsWith('ERRO ')).toBe(true);
      expect(res.acaoCaseNoCors).not.toContain('hidden-case');       // ACAO em caixa diferente: opaco sob no-cors…
      expect(res.acaoCaseCors).not.toContain('hidden-case');         // …e nunca legivel sob cors
      expect(res.acaoCaseCors).toMatch(/^ERRO /);
      expect(res.credOk).toBe('privado');                            // ACAC 'true' exato: replaya sob include
      expect(res.relayOpaco).not.toContain('visible');              // relay same-origin -> fora, sob no-cors: nunca o corpo
      expect(res.relayOpaco).not.toMatch(/^(default|basic):200:/);
      expect(res.relayCors).toBe('visible');                        // …e sob cors replaya
      expect(hits.externoPost).toBe(externosAntes);                  // …sem alcançar o servidor
    } finally { await browser.close(); }
  }, 180000);
});
