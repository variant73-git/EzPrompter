import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { montarReplay, runtimeFetchShim } from './runtime-fetch-map.js';
import { acaoLiberaLeitura, cabecalhosDeReplay, caminhosProtegidos, elegivelCorsCredenciado, identidadeDeRequisicao, mapaDeProveniencias, metodoCanonico, origensAlheias, gruposDeProveniencia } from './capture-bundle.js';
import { ReadableStream } from 'node:stream/web';

// A formula do NAVEGADOR, transcrita do remendo, rodando sobre o SubtleCrypto do Node.
// `metodo` chega como a plataforma o entrega em `req.method` (ja normalizado).
async function identidadeNoNavegador(metodo, url, corpo, headers = {}) {
  const subtle = webcrypto.subtle;
  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const h = await subtle.digest('SHA-256', corpo);
  const pares = [];
  new Headers(headers).forEach((valor, nome) => {
    const n = nome.toLowerCase();
    pares.push(`${n}:${String(valor).replace(/^[\t\n\r ]+|[\t\n\r ]+$/g, '')}`);   // todo cabecalho do Request (Astra B128)
  });
  const texto = `${metodo}\n${url}\n${hex(h)}\n${pares.sort().join('\n')}`;
  return hex(await subtle.digest('SHA-256', new TextEncoder().encode(texto)));
}

describe('identidade de requisição', () => {
  it('a formula do Node e a do navegador dao o MESMO id (paridade), com cabecalhos', async () => {
    const corpo = Buffer.from('{"query":"{core{me{photo}}}"}', 'utf8');
    const url = 'https://site/community/index.php?app=x&controller=api';
    const h = { 'Content-Type': 'application/json', Accept: '*/*', 'X-Csrf': 'abc' };
    const node = identidadeDeRequisicao('post', url, corpo, h);
    const pagina = await identidadeNoNavegador('POST', url, new Uint8Array(corpo), h);
    expect(node).toBe(pagina);
    expect(identidadeDeRequisicao('GET', url, Buffer.alloc(0))).toBe(await identidadeNoNavegador('GET', url, new Uint8Array(0)));
  });

  it('corpo diferente na mesma URL = identidade diferente (o que o mapa por URL nao sabia)', () => {
    const url = 'https://site/api';
    expect(identidadeDeRequisicao('POST', url, Buffer.from('a'))).not.toBe(identidadeDeRequisicao('POST', url, Buffer.from('b')));
    expect(identidadeDeRequisicao('POST', url, Buffer.from('a'))).not.toBe(identidadeDeRequisicao('GET', url, Buffer.from('a')));
  });

  // Astra B2 #2: metodo+URL+corpo colidiam com Authorization/Content-Type diferentes.
  it('todo cabecalho EXPLICITO distingue (Astra B128: Accept-Language en vs fr nao colidem)', () => {
    const url = 'https://site/api'; const c = Buffer.from('q');
    const base = identidadeDeRequisicao('POST', url, c, { 'content-type': 'application/json' });
    expect(identidadeDeRequisicao('POST', url, c, { 'content-type': 'application/json', authorization: 'Bearer a' })).not.toBe(base);
    expect(identidadeDeRequisicao('POST', url, c, { 'content-type': 'text/plain' })).not.toBe(base);
    expect(identidadeDeRequisicao('POST', url, c, { 'content-type': 'application/json', 'x-tenant': 't2' })).not.toBe(base);
    // A identidade vem dos cabecalhos do Request CONSTRUIDO (so os do script): todo cabecalho conta.
    expect(identidadeDeRequisicao('POST', url, c, { 'content-type': 'application/json', 'accept-language': 'en' })).not.toBe(identidadeDeRequisicao('POST', url, c, { 'content-type': 'application/json', 'accept-language': 'fr' }));
    expect(identidadeDeRequisicao('POST', url, c, { 'content-type': 'application/json', accept: '*/*' })).not.toBe(base);
  });

  // Astra B46/B47: Range e condicionais if-* sao outros pedidos.
  it('Range e If-* entram na identidade', () => {
    const url = 'https://site/v.mp4'; const c = Buffer.alloc(0);
    const base = identidadeDeRequisicao('GET', url, c, {});
    expect(identidadeDeRequisicao('GET', url, c, { range: 'bytes=0-0' })).not.toBe(base);
    for (const h of ['if-match', 'if-none-match', 'if-modified-since', 'if-unmodified-since', 'if-range']) {
      expect(identidadeDeRequisicao('GET', url, c, { [h]: '"x"' }), h).not.toBe(base);
    }
  });

  it('so os seis metodos que o Fetch normaliza vao a maiusculas: patch != PATCH', () => {
    expect(metodoCanonico('post')).toBe('POST');
    expect(metodoCanonico('delete')).toBe('DELETE');
    expect(metodoCanonico('patch')).toBe('patch');
    expect(metodoCanonico('PATCH')).toBe('PATCH');
    expect(identidadeDeRequisicao('patch', 'https://s/a', Buffer.alloc(0))).not.toBe(identidadeDeRequisicao('PATCH', 'https://s/a', Buffer.alloc(0)));
  });

  // Astra B3 #7: Accept EXPLICITO distingue; o default do navegador nao.
  it('Accept explicito entra na identidade (inclusive */* posto pelo script: o default do navegador nao aparece no Request)', () => {
    const url = 'https://site/api'; const c = Buffer.alloc(0);
    const semAccept = identidadeDeRequisicao('GET', url, c, {});
    expect(identidadeDeRequisicao('GET', url, c, { accept: '*/*' })).not.toBe(semAccept);
    expect(identidadeDeRequisicao('GET', url, c, { accept: 'application/json' })).not.toBe(semAccept);
    expect(identidadeDeRequisicao('GET', url, c, { accept: 'application/json' })).not.toBe(identidadeDeRequisicao('GET', url, c, { accept: 'text/csv' }));
  });

  // Astra B3 #2: com credentials 'include', `*` e nome literal — nao expande.
  it('Access-Control-Expose-Headers: * NAO expande para tudo', () => {
    const h = cabecalhosDeReplay({ 'Content-Type': 'application/json', 'X-Internal-Token': 'segredo', 'Access-Control-Expose-Headers': '*' }, { mesmaOrigem: false });
    expect(h).toEqual({ 'content-type': 'application/json' });
  });

  // Astra B44/B48: o mapa de proveniencia cobre _ext/ e todo asset da propria origem com
  // caminho TRANSFORMADO (query em hash, sanitizado, diretorio); caminho natural fica fora.
  it('mapaDeProveniencias: _ext/ e caminhos transformados entram com a identidade da URL original; natural fica fora', () => {
    const mapa = new Map([
      ['https://origin/avatar.png?v=1', 'avatar.258c7611.png'],
      ['https://origin/plain.css', 'plain.css'],
      ['https://origin/dir/', 'dir/index.html'],
      ['https://cdn.example/a.js', '_ext/cdn.example/a.js'],
      ['https://origin/we ird.png', 'we_ird.png'],
    ]);
    const m = mapaDeProveniencias(mapa);
    expect(m['avatar.258c7611.png']).toBe(identidadeDeRequisicao('GET', 'https://origin/avatar.png?v=1', Buffer.alloc(0), {}));
    expect(m).not.toHaveProperty('plain.css');
    expect(m['dir/index.html']).toBe(identidadeDeRequisicao('GET', 'https://origin/dir/', Buffer.alloc(0), {}));
    expect(m['_ext/cdn.example/a.js']).toBe(identidadeDeRequisicao('GET', 'https://cdn.example/a.js', Buffer.alloc(0), {}));
    expect(m['we_ird.png']).toBe(identidadeDeRequisicao('GET', 'https://origin/we ird.png', Buffer.alloc(0), {}));
    // Astra B49: caminho percent-encoded compara CRU — entra no mapa
    const m2 = mapaDeProveniencias(new Map([['https://origin/items/a%2Fb', 'items/a_2Fb'], ['https://origin/x/c%2Fd', 'x/c/d']]));
    expect(m2['items/a_2Fb']).toBe(identidadeDeRequisicao('GET', 'https://origin/items/a%2Fb', Buffer.alloc(0), {}));
    expect(m2['x/c/d']).toBe(identidadeDeRequisicao('GET', 'https://origin/x/c%2Fd', Buffer.alloc(0), {}));
    // Astra B50: barras iniciais repetidas fazem parte da identidade — entra no mapa
    const m3 = mapaDeProveniencias(new Map([['https://origin//items/a', 'items/a'], ['https://origin/items/b', 'items/b']]));
    expect(m3['items/a']).toBe(identidadeDeRequisicao('GET', 'https://origin//items/a', Buffer.alloc(0), {}));
    expect(m3).not.toHaveProperty('items/b');
    // Astra B51: '?' vazio na URL original tambem e outra URL — entra no mapa
    const m4 = mapaDeProveniencias(new Map([['https://origin/items/a?', 'items/a']]));
    expect(m4['items/a']).toBe(identidadeDeRequisicao('GET', 'https://origin/items/a?', Buffer.alloc(0), {}));
    // Astra B54: chave "__proto__" e propriedade PROPRIA do mapa
    // origem DIFERENTE da entrada, mesmo host, esquema outro (Astra B78): entra mesmo com caminho natural
    const m6 = mapaDeProveniencias(new Map([['https://origin.example/avatar.png', 'avatar.png'], ['http://origin.example/logo.png', 'logo.png']]), 'http://origin.example');
    expect(Object.keys(m6)).toEqual(['avatar.png']);
    expect(m6['avatar.png']).toBe(identidadeDeRequisicao('GET', 'https://origin.example/avatar.png', Buffer.alloc(0), {}));
    const m5 = mapaDeProveniencias(new Map([['https://origin/__proto__?', '__proto__']]));
    expect(Object.prototype.hasOwnProperty.call(m5, '__proto__')).toBe(true);
    expect(Object.getOwnPropertyDescriptor(m5, '__proto__').value).toBe(identidadeDeRequisicao('GET', 'https://origin/__proto__?', Buffer.alloc(0), {}));
  });


  // Astra B55/B57: caminhos protegidos contra o fallback estatico — por URL vista em fetch
  // (raiz ou terminal) e por asset iniciado por script (fetch OU xhr), independente de
  // quem povoou o asset primeiro.
  it('caminhosProtegidos: XHR-primeiro + fetch-depois protege; xhr sozinho protege; imagem nao', () => {
    const congelados = new Map([
      ['https://origin/account', { tipo: 'xhr', bytes: Buffer.alloc(1) }],      // XHR povoou; fetch veio depois
      ['https://origin/dados.json', { tipo: 'xhr', bytes: Buffer.alloc(1) }],   // so XHR
      ['https://origin/logo.png', { tipo: 'image', bytes: Buffer.alloc(1) }],   // markup
      ['https://origin/api', { tipo: 'fetch', bytes: Buffer.alloc(1) }],
    ]);
    const mapa = new Map([['https://origin/account', 'account'], ['https://origin/dados.json', 'dados.json'], ['https://origin/logo.png', 'logo.png'], ['https://origin/api', 'api']]);
    const prot = caminhosProtegidos(congelados, mapa, new Set(['https://origin/account']));
    expect(prot.sort()).toEqual(['account', 'api', 'dados.json']);
    // e uma URL de fetch cujo asset veio por markup (imagem primeiro) tambem protege
    expect(caminhosProtegidos(congelados, mapa, new Set(['https://origin/logo.png'])).includes('logo.png')).toBe(true);
  });

  // Astra B40: legibilidade nao credenciada tambem e EXATA — ACAO em caixa diferente
  // nao libera; '*' e a origem exata liberam.
  it('legibilidade por ACAO: "*" e origem exata liberam; caixa diferente nao', () => {
    const o = 'https://site.example';
    expect(acaoLiberaLeitura({ 'Access-Control-Allow-Origin': '*' }, o)).toBe(true);
    expect(acaoLiberaLeitura({ 'access-control-allow-origin': o }, o)).toBe(true);
    expect(acaoLiberaLeitura({ 'access-control-allow-origin': 'https://SITE.example' }, o)).toBe(false);
    expect(acaoLiberaLeitura({}, o)).toBe(false);
  });

  // Astra B39: ACAC e byte a byte 'true'; 'True'/'TRUE' nao valem; ACAO e exato.
  it('elegibilidade a CORS credenciado: so ACAC exatamente "true" e ACAO exatamente a origem', () => {
    const o = 'https://site.example';
    expect(elegivelCorsCredenciado({ 'Access-Control-Allow-Origin': o, 'Access-Control-Allow-Credentials': 'true' }, o)).toBe(true);
    expect(elegivelCorsCredenciado({ 'access-control-allow-origin': o, 'access-control-allow-credentials': 'True' }, o)).toBe(false);
    expect(elegivelCorsCredenciado({ 'access-control-allow-origin': o, 'access-control-allow-credentials': 'TRUE' }, o)).toBe(false);
    expect(elegivelCorsCredenciado({ 'access-control-allow-origin': '*', 'access-control-allow-credentials': 'true' }, o)).toBe(false);
    expect(elegivelCorsCredenciado({ 'access-control-allow-origin': 'https://SITE.example', 'access-control-allow-credentials': 'true' }, o)).toBe(false);
    expect(elegivelCorsCredenciado({ 'access-control-allow-origin': o }, o)).toBe(false);
  });

  // Astra B2 #6: allowlist. Uma Response sintetica torna legivel o que o CORS escondia.
  it('replay de OUTRA origem expoe so safelisted + Access-Control-Expose-Headers', () => {
    const h = cabecalhosDeReplay({
      'Content-Type': 'application/json', 'X-Internal-Token': 'segredo', 'X-Public': 'p',
      'Access-Control-Expose-Headers': 'X-Public', 'Access-Control-Allow-Origin': '*',
      'Set-Cookie': 'a=b', ETag: '"1"', Vary: 'Origin', 'Cache-Control': 'no-store', Location: '/x',
    }, { mesmaOrigem: false });
    expect(h).toEqual({ 'content-type': 'application/json', 'x-public': 'p', 'cache-control': 'no-store' });
  });

  it('replay da MESMA origem expoe o que o JS ja lia ao vivo, nunca transporte/politica/validador', () => {
    const h = cabecalhosDeReplay({
      'Content-Type': 'application/json', 'X-Csrf-Token': 't', 'Set-Cookie': 'a=b', 'Content-Length': '9',
      'Content-Encoding': 'br', 'Access-Control-Allow-Origin': '*', 'Content-Security-Policy': "default-src 'self'",
      ETag: '"1"', Digest: 'sha-256=x', 'Content-Range': 'bytes 0-1/2', Location: '/x', Vary: 'Accept', Date: 'x',
    });
    expect(h).toEqual({ 'content-type': 'application/json', 'x-csrf-token': 't' });
  });
});

describe('montarReplay + remendo', () => {
  const envelopes = () => new Map([
    ['id1', [
      { url: 'https://site/api', status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, contentType: 'application/json', bytes: Buffer.from('{"foto":"https://site/media/f.png"}') },
      { url: 'https://site/api', status: 201, statusText: 'Created', headers: {}, contentType: 'application/json', bytes: Buffer.from('{"n":2}') },
    ]],
    ['id2', [{ url: 'https://site/dados', status: 200, statusText: '', headers: {}, contentType: 'text/plain', bytes: Buffer.from('ola') }]],
  ]);
  const mapa = new Map([['https://site/media/f.png', 'media/f.png']]);

  it('cada envelope vira um arquivo, a mesma identidade repetida numera', () => {
    const { arquivos, manifesto } = montarReplay(envelopes(), mapa);
    expect(arquivos.map((a) => a.path)).toEqual(['_replay/id1', '_replay/id1.1', '_replay/id2']);
    expect(manifesto.id1.map((e) => e.status)).toEqual([200, 201]);
    expect(manifesto.id1[1].path).toBe('./_replay/id1.1');
  });

  it('corpo JSON do envelope sai REESCRITO com o marcador do pacote, e so ele resolve o marcador', () => {
    const { arquivos, manifesto } = montarReplay(envelopes(), mapa, { marcador: '__M_ab12__' });
    expect(JSON.parse(Buffer.from(arquivos[0].body).toString('utf8')).foto).toBe('__M_ab12__/media/f.png');
    expect(manifesto.id1[0].resolveMarcador).toBe(true);
    expect(manifesto.id1[0].bytes).toBe(arquivos[0].body.byteLength);
    expect(manifesto.id1[1].resolveMarcador).toBe(false);   // JSON sem referencia: intacto
    expect(Buffer.from(arquivos[2].body).toString('utf8')).toBe('ola');   // texto nao-JSON intacto
    expect(manifesto.id2[0].resolveMarcador).toBe(false);
  });

  // Astra B2 #7: um marcador fixo trocado por split/join corrompia conteudo legitimo.
  it('corpo que JA contem o marcador nao e reescrito (nunca corrompe conteudo legitimo)', () => {
    const env = new Map([['idg', [{ url: 'https://site/api.json', status: 200, statusText: '', headers: {}, contentType: 'application/json', bytes: Buffer.from('{"t":"__M__ texto","foto":"https://site/media/f.png"}') }]]]);
    const { arquivos, manifesto } = montarReplay(env, mapa, { marcador: '__M__' });
    expect(Buffer.from(arquivos[0].body).toString('utf8')).toBe('{"t":"__M__ texto","foto":"https://site/media/f.png"}');
    expect(manifesto.idg[0].resolveMarcador).toBe(false);
  });

  // Astra B2 #6: query com token apareceria literalmente no HTML.
  it('o manifesto publico NAO carrega url nem metodo', () => {
    const { manifesto } = montarReplay(envelopes(), mapa);
    for (const lista of Object.values(manifesto)) for (const e of lista) {
      expect(e).not.toHaveProperty('url'); expect(e).not.toHaveProperty('metodo');
    }
    expect(runtimeFetchShim(manifesto)).not.toContain('https://site/api');
  });

  it('sem envelope E sem caminho protegido nao injeta nada; com caminho protegido injeta mesmo sem envelope', () => {
    expect(runtimeFetchShim({})).toBe('');
    expect(runtimeFetchShim(null)).toBe('');
    expect(runtimeFetchShim({}, { caminhosDeFetch: ['account'] })).toContain('data-uncraft-runtime-fetch-map');   // Astra B58
    expect(runtimeFetchShim({}, { proveniencias: { '_ext/cdn.example/a.png': 'h' } })).toContain('data-uncraft-runtime-fetch-map');   // Astra B62
  });

  it('o script nao fecha a propria tag, nao mexe em XHR e nao repete a ultima ocorrencia', () => {
    const { manifesto } = montarReplay(new Map([['x', [{ url: 'https://s/a', status: 418, statusText: 'te</script><b>apot', headers: { 'x-k': 'v' }, contentType: 'text/plain', bytes: Buffer.from('') }]]]), new Map());
    const shim = runtimeFetchShim(manifesto, { marcador: '__M__' });
    expect(shim.slice(shim.indexOf('>') + 1)).not.toContain('</script><b>');
    expect(shim).not.toContain('XMLHttpRequest.prototype');
    expect(shim).not.toContain('Math.min(n, lista.length - 1)');
  });
});

// O remendo rodando numa sandbox: fetch original controlado, identidade calculada
// dos DOIS lados (Node pela captura, navegador pelo remendo) para a mesma chamada.
describe('o remendo rodando de verdade (sandbox)', () => {
  const ORIGEM = 'https://clone';
  function sandbox(manifesto, fetchOriginal, { marcador, entryPath, origemFonte, href = `${ORIGEM}/`, tetoIdentidadeMs, proveniencias, caminhosDeFetch, origensAlheias, gruposDeProveniencia: grupos } = {}) {
    const shim = runtimeFetchShim(manifesto, { marcador, entryPath, origemFonte, tetoIdentidadeMs, proveniencias, caminhosDeFetch, origensAlheias, gruposDeProveniencia: grupos });
    const js = shim.slice(shim.indexOf('>') + 1, shim.lastIndexOf('</script>'));
    const location = { href, origin: ORIGEM, pathname: new URL(href).pathname };
    const ctx = {
      window: { crypto: webcrypto, fetch: fetchOriginal }, Request, Response, Headers, TextEncoder, TextDecoder, Uint8Array, URL, setTimeout, clearTimeout, DOMException, ReadableStream, btoa,
      document: { baseURI: `${ORIGEM}/` }, location,
    };
    ctx.window.window = ctx.window; ctx.window.document = ctx.document; ctx.window.location = location;
    vm.runInNewContext(js, ctx);
    return { w: ctx.window, location };
  }
  const CT = 'text/plain;charset=UTF-8';   // o que Request poe num body string, nos dois lados
  const envelopeDe = (corpo, extra = {}) => ({ url: 'https://origin/api', status: 200, statusText: 'OK', headers: {}, contentType: 'text/plain', bytes: Buffer.from(corpo), ...extra });
  const manifestoVazio = { x: [{ path: './x', status: 200, statusText: 'OK', headers: {}, resolveMarcador: false }] };

  // Astra B2 #1: "nenhum POST chega a servidor algum" era falso — o miss passava.
  it('POST a OUTRA origem sem envelope FALHA como offline: o original NUNCA e chamado', async () => {
    let n = 0;
    const { w } = sandbox(manifestoVazio, async () => { n += 1; return new Response('ok'); });
    await expect(w.fetch('https://origin/api', { method: 'POST', body: 'x' })).rejects.toThrow('Failed to fetch');
    await expect(w.fetch('https://origin/api', { method: 'PUT', body: 'x' })).rejects.toThrow('Failed to fetch');
    await expect(w.fetch('https://origin/api', { method: 'DELETE' })).rejects.toThrow('Failed to fetch');
    // Multipart como STRING + cabecalho (o mesmo caminho do remendo): o corpo FormData que
    // o undici gera enfileira DEPOIS do cancel e vaza uma rejeicao interna so em Node.
    await expect(w.fetch('https://origin/api', { method: 'POST', body: '--x\r\na=b\r\n--x--', headers: { 'content-type': 'multipart/form-data; boundary=x' } })).rejects.toThrow('Failed to fetch');
    expect(n).toBe(0);
  });

  it('GET a outra origem sem envelope passa UMA vez e a falha de rede chega ao site', async () => {
    let n = 0;
    const { w } = sandbox(manifestoVazio, async () => { n += 1; throw new TypeError('network down'); });
    await expect(w.fetch('https://origin/outra')).rejects.toThrow('network down');
    expect(n).toBe(1);
  });

  it('POST a MESMA origem (o servidor do clone) passa com o corpo INTEIRO; a entrada e consumida como no fetch nativo', async () => {
    let recebido = null;
    const { w } = sandbox(manifestoVazio, async (entrada) => { recebido = entrada; return new Response('ok'); });
    const req = new Request(`${ORIGEM}/api`, { method: 'POST', body: 'abc', headers: { 'x-k': 'v' } });
    const r = await w.fetch(req);
    expect(await r.text()).toBe('ok');
    expect(recebido).toBeInstanceOf(Request);
    expect(recebido.url).toBe(req.url); expect(recebido.method).toBe('POST'); expect(recebido.headers.get('x-k')).toBe('v');
    expect(await recebido.text()).toBe('abc');
    expect(req.bodyUsed).toBe(true);   // fetch(request) nativo tambem consome a entrada
  });

  it('chamada MAPEADA: identidade bate dos dois lados, o envelope local e servido com status e cabecalhos', async () => {
    const id = identidadeDeRequisicao('POST', 'https://origin/api', Buffer.from('abc'), { 'content-type': CT });
    const { manifesto, arquivos } = montarReplay(new Map([[id, [envelopeDe('resposta', { status: 201, statusText: 'Created', headers: { 'x-k': 'v' } })]]]), new Map());
    const chamadas = [];
    const { w } = sandbox(manifesto, async (u) => { chamadas.push(String(u)); return new Response(arquivos[0].body); });
    const r = await w.fetch('https://origin/api', { method: 'POST', body: 'abc' });
    expect(r.status).toBe(201); expect(r.statusText).toBe('Created'); expect(r.headers.get('x-k')).toBe('v');
    expect(await r.text()).toBe('resposta');
    expect(chamadas).toEqual([`${ORIGEM}/_replay/${id}`]);
  });

  // Astra B2 #3: repetir a ultima resposta para sempre fabricava respostas.
  it('ocorrencias esgotadas = miss: a 3a chamada de um par capturado 2x falha fechada', async () => {
    const id = identidadeDeRequisicao('POST', 'https://origin/api', Buffer.from('abc'), { 'content-type': CT });
    const { manifesto, arquivos } = montarReplay(new Map([[id, [envelopeDe('um'), envelopeDe('dois')]]]), new Map());
    let n = 0;
    const { w } = sandbox(manifesto, async (u) => { n += 1; const i = String(u).endsWith('.1') ? 1 : 0; return new Response(arquivos[i].body); });
    expect(await (await w.fetch('https://origin/api', { method: 'POST', body: 'abc' })).text()).toBe('um');
    expect(await (await w.fetch('https://origin/api', { method: 'POST', body: 'abc' })).text()).toBe('dois');
    await expect(w.fetch('https://origin/api', { method: 'POST', body: 'abc' })).rejects.toThrow('Failed to fetch');
    expect(n).toBe(2);
  });

  // Astra B2 #5: 204 lancava em new Response; 404/SPA fallback virava corpo.
  it('204 reconstroi sem corpo; envelope local ausente (404) ou com tamanho errado NAO vira resposta', async () => {
    const id = identidadeDeRequisicao('POST', 'https://origin/api', Buffer.from('abc'), { 'content-type': CT });
    const { manifesto } = montarReplay(new Map([[id, [envelopeDe('', { status: 204, statusText: 'No Content' })]]]), new Map());
    const { w } = sandbox(manifesto, async () => new Response(''));
    const r = await w.fetch('https://origin/api', { method: 'POST', body: 'abc' });
    expect(r.status).toBe(204); expect(r.body).toBe(null);

    const id2 = identidadeDeRequisicao('POST', 'https://origin/api', Buffer.from('zz'), { 'content-type': CT });
    const m2 = montarReplay(new Map([[id2, [envelopeDe('esperado')]]]), new Map()).manifesto;
    const { w: w404 } = sandbox(m2, async () => new Response('<html>index</html>', { status: 404 }));
    await expect(w404.fetch('https://origin/api', { method: 'POST', body: 'zz' })).rejects.toThrow('Failed to fetch');
    const { w: wSpa } = sandbox(m2, async () => new Response('<html>fallback da SPA</html>', { status: 200 }));
    await expect(wSpa.fetch('https://origin/api', { method: 'POST', body: 'zz' })).rejects.toThrow('Failed to fetch');
  });

  // Astra B2 #5: `local()` resolvia contra o location.href NAVEGADO.
  it('o envelope local resolve contra a base da INJECAO, nao contra a URL apos pushState', async () => {
    const id = identidadeDeRequisicao('GET', 'https://origin/dados', Buffer.alloc(0));
    const { manifesto, arquivos } = montarReplay(new Map([[id, [envelopeDe('d')]]]), new Map());
    const chamadas = [];
    const { w, location } = sandbox(manifesto, async (u) => { chamadas.push(String(u)); return new Response(arquivos[0].body); });
    location.href = `${ORIGEM}/a/b/c`;   // o site navegou
    expect(await (await w.fetch('https://origin/dados')).text()).toBe('d');
    expect(chamadas).toEqual([`${ORIGEM}/_replay/${id}`]);
  });

  // Astra B3 #1: Request ja consumido + init com corpo novo — clone() lanca, o Fetch
  // nativo aceita, e a 1a versao devolvia o POST externo ao original.
  it('falha de construcao NUNCA passa um POST externo adiante', async () => {
    let n = 0;
    const { w } = sandbox(manifestoVazio, async () => { n += 1; return new Response('ok'); });
    const r = new Request('https://origin/api', { method: 'PUT', body: 'old' });
    await r.text();   // consumido: clone() lanca
    await expect(w.fetch(r, { method: 'POST', body: 'replacement' })).rejects.toThrow('Failed to fetch');
    expect(n).toBe(0);
    // e a mesma construcao para GET externo segue passando (uma vez)
    const g = new Request('https://origin/x'); await g.text();
    expect(await (await w.fetch(g, { method: 'GET' })).text()).toBe('ok');
    expect(n).toBe(1);
  });

  // Astra B3 #4: ocorrencia perdida na captura e BURACO, nao ausencia.
  it('buraco na lista = miss naquela posicao; a seguinte mantem a posicao', async () => {
    const id = identidadeDeRequisicao('POST', 'https://origin/api', Buffer.from('abc'), { 'content-type': CT });
    const { manifesto, arquivos } = montarReplay(new Map([[id, [envelopeDe('primeira'), { perdido: true }, envelopeDe('terceira')]]]), new Map());
    expect(manifesto[id][1]).toBe(null);
    expect(arquivos.map((a) => a.path)).toEqual([`_replay/${id}`, `_replay/${id}.2`]);
    const { w } = sandbox(manifesto, async (u) => new Response(arquivos[String(u).endsWith('.2') ? 1 : 0].body));
    expect(await (await w.fetch('https://origin/api', { method: 'POST', body: 'abc' })).text()).toBe('primeira');
    await expect(w.fetch('https://origin/api', { method: 'POST', body: 'abc' })).rejects.toThrow('Failed to fetch');
    expect(await (await w.fetch('https://origin/api', { method: 'POST', body: 'abc' })).text()).toBe('terceira');
  });

  // Astra B3 #4: a alocacao segue a ORDEM DE CHAMADA, nao a ordem em que o hash termina.
  // Astra B141: corpo em FLUXO nunca recebe envelope (a captura nunca guarda upload em fluxo) —
  // vai pelo miss SEM consumir, mesmo lento; o corpo pronto seguinte recebe a 1a ocorrencia.
  it('chamadas com corpo em fluxo (lenta e rapida) vao pelo miss sem consumir; o corpo pronto recebe a 1a resposta', async () => {
    const id = identidadeDeRequisicao('POST', 'https://origin/api', Buffer.from('abc'), {});
    const { manifesto, arquivos } = montarReplay(new Map([[id, [envelopeDe('primeira'), envelopeDe('segunda')]]]), new Map());
    const mock = async (u) => { const x = u instanceof Request ? u.url : String(u); const a = arquivos.find((f) => x.endsWith(f.path)); return new Response(a ? a.body : 'LIVE'); };
    const { w } = sandbox(manifesto, mock);
    const fluxo = (atrasoMs) => new ReadableStream({ start(c) { setTimeout(() => { c.enqueue(new TextEncoder().encode('abc')); c.close(); }, atrasoMs); } });
    // POST externo em miss falha fechado (offline): recusa, nunca o envelope
    const p1 = w.fetch('https://origin/api', { method: 'POST', body: fluxo(80), duplex: 'half' }).then((r) => r.text(), (e) => e.name);
    const p2 = w.fetch('https://origin/api', { method: 'POST', body: fluxo(0), duplex: 'half' }).then((r) => r.text(), (e) => e.name);
    expect(await p1).toBe('TypeError');
    expect(await p2).toBe('TypeError');
    expect(await (await w.fetch('https://origin/api', { method: 'POST', body: new TextEncoder().encode('abc') })).text()).toBe('primeira');
  });

  // Astra B3 #5 e #6: servido noutra origem, sob prefixo, a chamada relativa bate e o
  // marcador vira a RAIZ do pacote.
  it('sob /api/runtime/<token>/: fetch relativo bate na identidade da FONTE e o marcador vira a raiz', async () => {
    const FONTE = 'https://origin';
    const href = `${ORIGEM}/api/runtime/tok/index.html`;
    const id = identidadeDeRequisicao('POST', `${FONTE}/api?x=1`, Buffer.from('abc'), { 'content-type': CT });
    const idJson = identidadeDeRequisicao('GET', `${FONTE}/dados.json`, Buffer.alloc(0));
    const mapa = new Map([[`${FONTE}/m/f.png`, 'm/f.png']]);
    const envJson = { url: `${FONTE}/dados.json`, status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, contentType: 'application/json', bytes: Buffer.from(`{"foto":"${FONTE}/m/f.png"}`) };
    const { manifesto, arquivos } = montarReplay(new Map([[id, [envelopeDe('resposta')]], [idJson, [envJson]]]), mapa, { marcador: '__M__' });
    const chamadas = [];
    const { w } = sandbox(manifesto, async (u) => { chamadas.push(String(u)); const a = arquivos.find((x) => String(u).endsWith(x.path)); return new Response(a.body); },
      { marcador: '__M__', entryPath: 'index.html', origemFonte: FONTE, href });
    // root-relative: o site chamou '/api?x=1' e o navegador resolveu contra o clone
    expect(await (await w.fetch(`${ORIGEM}/api?x=1`, { method: 'POST', body: 'abc' })).text()).toBe('resposta');
    // relativo ao documento: './dados.json' resolve sob o prefixo
    const j = await (await w.fetch(`${ORIGEM}/api/runtime/tok/dados.json`)).json();
    expect(j.foto).toBe(`${ORIGEM}/api/runtime/tok/m/f.png`);
    // e os envelopes foram lidos sob o prefixo, nao na raiz da origem
    expect(chamadas).toEqual([`${ORIGEM}/api/runtime/tok/_replay/${id}`, `${ORIGEM}/api/runtime/tok/_replay/${idJson}`]);
  });

  it('entrada aninhada servida como diretorio: a raiz e a do pacote, nao a da entrada', async () => {
    const FONTE = 'https://origin';
    const id = identidadeDeRequisicao('GET', `${FONTE}/dados`, Buffer.alloc(0));
    const { manifesto, arquivos } = montarReplay(new Map([[id, [envelopeDe('d')]]]), new Map());
    const chamadas = [];
    const { w } = sandbox(manifesto, async (u) => { chamadas.push(String(u)); return new Response(arquivos[0].body); },
      { entryPath: 'docs/index.html', origemFonte: FONTE, href: `${ORIGEM}/p/docs/` });
    expect(await (await w.fetch(`${ORIGEM}/dados`)).text()).toBe('d');
    expect(chamadas).toEqual([`${ORIGEM}/p/_replay/${id}`]);
  });

  // Astra B4 #2: um corpo em fluxo que NUNCA termina travava todo fetch posterior.
  it('corpo que nunca chega nao trava a pagina: a chamada seguinte segue no teto', async () => {
    const id = identidadeDeRequisicao('GET', 'https://origin/dados', Buffer.alloc(0));
    const { manifesto, arquivos } = montarReplay(new Map([[id, [envelopeDe('d')]]]), new Map());
    const { w } = sandbox(manifesto, async () => new Response(arquivos[0].body), { tetoIdentidadeMs: 150 });
    const nunca = new ReadableStream({ start() {} });
    const pendente = w.fetch('https://origin/api', { method: 'POST', body: nunca, duplex: 'half' });
    const desfechoPendente = pendente.then(() => 'resolveu', (e) => e);   // handler ja anexado: a rejeicao pode chegar antes do assert
    const t0 = Date.now();
    expect(await (await w.fetch('https://origin/dados')).text()).toBe('d');
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(String(await desfechoPendente)).toContain('Failed to fetch');   // a pendente vira miss (POST externo)
  });

  it('pedido abortado libera a fila na hora', async () => {
    const id = identidadeDeRequisicao('GET', 'https://origin/dados', Buffer.alloc(0));
    const { manifesto, arquivos } = montarReplay(new Map([[id, [envelopeDe('d')]]]), new Map());
    const { w } = sandbox(manifesto, async () => new Response(arquivos[0].body), { tetoIdentidadeMs: 60000 });
    const ac = new AbortController();
    // O handler e ligado NA CRIACAO: a rejeicao acontece enquanto o teste espera o
    // fetch seguinte, e o vitest acusa rejeicao sem handler mesmo que se espere depois.
    const pendente = w.fetch('https://origin/api', { method: 'POST', body: new ReadableStream({ start() {} }), duplex: 'half', signal: ac.signal }).then(() => 'RESOLVEU', (e) => e);
    ac.abort();
    const t0 = Date.now();
    expect(await (await w.fetch('https://origin/dados')).text()).toBe('d');
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(await pendente).toMatchObject({ name: 'AbortError' });
  });

  // Astra B4 #3: caminho reservado do pacote nunca e devolvido a fonte.
  it('uma chamada a RAIZ/_replay/... nao e sequestrada por um envelope da fonte', async () => {
    const FONTE = 'https://origin';
    const id = identidadeDeRequisicao('GET', `${FONTE}/_replay/x`, Buffer.alloc(0));
    const { manifesto, arquivos } = montarReplay(new Map([[id, [envelopeDe('SOURCE')]]]), new Map());
    const chamadas = [];
    const { w } = sandbox(manifesto, async (u) => { chamadas.push(u instanceof Request ? u.url : String(u)); return new Response('do servidor'); },
      { entryPath: 'index.html', origemFonte: FONTE, href: `${ORIGEM}/api/runtime/tok/index.html` });
    expect(await (await w.fetch(`${ORIGEM}/api/runtime/tok/_replay/x`)).text()).toBe('do servidor');
    expect(chamadas).toEqual([`${ORIGEM}/api/runtime/tok/_replay/x`]);
  });

  // Astra B4 #5: href com segmento percent-encoded e o MESMO caminho para o servidor.
  it('href com segmento codificado (%64ocs) acha a raiz certa', async () => {
    const FONTE = 'https://origin';
    const id = identidadeDeRequisicao('GET', `${FONTE}/dados`, Buffer.alloc(0));
    const { manifesto, arquivos } = montarReplay(new Map([[id, [envelopeDe('d')]]]), new Map());
    const chamadas = [];
    const { w } = sandbox(manifesto, async (u) => { chamadas.push(String(u)); return new Response(arquivos[0].body); },
      { entryPath: 'docs/index.html', origemFonte: FONTE, href: `${ORIGEM}/api/runtime/tok/%64ocs/index.html` });
    expect(await (await w.fetch(`${ORIGEM}/dados`)).text()).toBe('d');
    expect(chamadas).toEqual([`${ORIGEM}/api/runtime/tok/_replay/${id}`]);
  });

  // Astra B5 #1: abort REJEITA e nao consome ocorrencia — pelo sinal EFETIVO do Request.
  it('Request ja abortado rejeita AbortError e a proxima chamada viva recebe a 1a ocorrencia', async () => {
    const id = identidadeDeRequisicao('GET', 'https://origin/dados', Buffer.alloc(0));
    const { manifesto, arquivos } = montarReplay(new Map([[id, [envelopeDe('one'), envelopeDe('two')]]]), new Map());
    let n = 0;
    const { w } = sandbox(manifesto, async (u) => { n += 1; return new Response(arquivos[String(u).endsWith('.1') ? 1 : 0].body); });
    const ac = new AbortController(); ac.abort();
    await expect(w.fetch(new Request('https://origin/dados', { signal: ac.signal }))).rejects.toMatchObject({ name: 'AbortError' });
    expect(await (await w.fetch('https://origin/dados')).text()).toBe('one');
    expect(n).toBe(1);
  });

  it('abort depois do hash e antes da alocacao: rejeita e nao consome', async () => {
    const id = identidadeDeRequisicao('GET', 'https://origin/dados', Buffer.alloc(0));
    const { manifesto, arquivos } = montarReplay(new Map([[id, [envelopeDe('one'), envelopeDe('two')]]]), new Map());
    const { w } = sandbox(manifesto, async (u) => { const s = u instanceof Request ? u.url : String(u); return new Response(s.includes('_replay/') ? arquivos[s.endsWith('.1') ? 1 : 0].body : 'LIVE'); }, { tetoIdentidadeMs: 300 });
    // 1º: um corpo que nunca chega segura a fila ate o teto (300 ms)
    const preso = w.fetch('https://origin/api', { method: 'POST', body: new ReadableStream({ start() {} }), duplex: 'half' });
    const ac = new AbortController();
    const abortavel = w.fetch('https://origin/dados', { signal: ac.signal });   // hash termina ja; alocacao espera a fila
    await new Promise((r) => setTimeout(r, 50));
    ac.abort();
    await expect(abortavel).rejects.toMatchObject({ name: 'AbortError' });
    await expect(preso).rejects.toThrow('Failed to fetch');
    // Astra B125: abort depois da entrada nao consome, e o grupo sai do replay — a chamada seguinte
    // NAO recebe 'one' (poderia ser a ocorrencia de outra chamada): vai a rede (miss).
    expect(await (await w.fetch('https://origin/dados')).text()).toBe('LIVE');
  });

  // Astra B6 #2: o contrato de cancelamento do Fetch, nas tres formas.
  it('abort(razao) rejeita com a MESMA razao', async () => {
    const id = identidadeDeRequisicao('GET', 'https://origin/dados', Buffer.alloc(0));
    const { manifesto, arquivos } = montarReplay(new Map([[id, [envelopeDe('one')]]]), new Map());
    const { w } = sandbox(manifesto, async () => new Response(arquivos[0].body));
    const razao = new Error('minha razao'); const ac = new AbortController(); ac.abort(razao);
    await expect(w.fetch('https://origin/dados', { signal: ac.signal })).rejects.toBe(razao);
  });

  it('abort durante a busca PARADA do envelope local rejeita (a promessa nao fica pendente)', async () => {
    const id = identidadeDeRequisicao('GET', 'https://origin/dados', Buffer.alloc(0));
    const { manifesto } = montarReplay(new Map([[id, [envelopeDe('one')]]]), new Map());
    // Astra B7 #2: esperar 30 ms nao provava que a busca local COMECOU — o abort durante o
    // hash satisfazia o teste sem encaminhamento nenhum. Espera-se o pedido do envelope
    // CHEGAR ao fetch original, confere-se o sinal nele, e so entao aborta.
    let chegou; const chegada = new Promise((r) => { chegou = r; });
    let sinalRecebido = null;
    const { w } = sandbox(manifesto, (u, init) => new Promise((_, rej) => {
      if (String(u).includes('/_replay/')) { sinalRecebido = init && init.signal; chegou(); }
      init && init.signal && init.signal.addEventListener('abort', () => rej(init.signal.reason));
    }));
    const ac = new AbortController();
    const p = w.fetch('https://origin/dados', { signal: ac.signal });
    await chegada;
    expect(sinalRecebido).toBeTruthy();
    expect(sinalRecebido.aborted).toBe(false);
    ac.abort();
    expect(sinalRecebido.aborted).toBe(true);   // o sinal do site ALCANCOU a busca local
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });

  // Astra B7 #1: clone() faz tee; abort depois do clone tem que errar as DUAS copias, e
  // um leitor ocioso tem que ver o abort sem nunca ter puxado.
  it('abort depois de clone() erra o original E a copia; leitor ocioso ve o abort', async () => {
    const id = identidadeDeRequisicao('GET', 'https://origin/dados', Buffer.alloc(0));
    const { manifesto, arquivos } = montarReplay(new Map([[id, [envelopeDe('one'), envelopeDe('two')]]]), new Map());
    const { w } = sandbox(manifesto, async (u) => new Response(arquivos[String(u).endsWith('.1') ? 1 : 0].body));
    const razao = new Error('cancelado pelo site');
    const ac = new AbortController();
    const r = await w.fetch('https://origin/dados', { signal: ac.signal });
    const copia = r.clone();
    await new Promise((res) => setTimeout(res, 0));
    ac.abort(razao);
    await expect(r.text()).rejects.toBe(razao);
    await expect(copia.text()).rejects.toBe(razao);
    // leitor ocioso
    const ac2 = new AbortController();
    const r2 = await w.fetch('https://origin/dados', { signal: ac2.signal });
    const leitor = r2.body.getReader();
    ac2.abort(razao);
    await expect(leitor.closed).rejects.toBe(razao);
  });

  it('abort DEPOIS da resposta replayada faz o corpo rejeitar ao ser lido', async () => {
    const id = identidadeDeRequisicao('GET', 'https://origin/dados', Buffer.alloc(0));
    const { manifesto, arquivos } = montarReplay(new Map([[id, [envelopeDe('one'), envelopeDe('two')]]]), new Map());
    const { w } = sandbox(manifesto, async (u) => new Response(arquivos[String(u).endsWith('.1') ? 1 : 0].body));
    const ac = new AbortController();
    const r = await w.fetch('https://origin/dados', { signal: ac.signal });
    expect(r.status).toBe(200);
    ac.abort();
    await expect(r.text()).rejects.toMatchObject({ name: 'AbortError' });
    const r2 = await w.fetch('https://origin/dados');
    expect(await r2.text()).toBe('two');
  });

  // Astra B8 #1: fluxo de bytes recusa enqueue vazio — um 200 vazio tem que ler "".
  it('200 com corpo VAZIO le como "" por text(), arrayBuffer() e BYOB (EOF)', async () => {
    const id = identidadeDeRequisicao('GET', 'https://origin/vazio', Buffer.alloc(0));
    const { manifesto, arquivos } = montarReplay(new Map([[id, [envelopeDe(''), envelopeDe(''), envelopeDe('')]]]), new Map());
    const { w } = sandbox(manifesto, async (u) => new Response(arquivos.find((a) => String(u).endsWith(a.path)).body));
    expect(await (await w.fetch('https://origin/vazio')).text()).toBe('');
    expect((await (await w.fetch('https://origin/vazio')).arrayBuffer()).byteLength).toBe(0);
    const r3 = await w.fetch('https://origin/vazio');
    const leitor = r3.body.getReader({ mode: 'byob' });
    const fim = await leitor.read(new Uint8Array(4));
    expect(fim.done).toBe(true);
  });

  // Astra B8 #2: depois de uma leitura BYOB parcial ainda ha bytes na fila; o abort tem
  // que erra-los (o ouvinte nao pode ser removido no close()).
  it('abort depois de leitura BYOB parcial erra o resto e o closed', async () => {
    const id = identidadeDeRequisicao('GET', 'https://origin/abc', Buffer.alloc(0));
    const { manifesto, arquivos } = montarReplay(new Map([[id, [envelopeDe('abc')]]]), new Map());
    const { w } = sandbox(manifesto, async () => new Response(arquivos[0].body));
    const razao = new Error('parou');
    const ac = new AbortController();
    const r = await w.fetch('https://origin/abc', { signal: ac.signal });
    const leitor = r.body.getReader({ mode: 'byob' });
    const parcial = await leitor.read(new Uint8Array(1));
    expect(parcial.done).toBe(false); expect(parcial.value.byteLength).toBe(1);
    ac.abort(razao);
    await expect(leitor.read(new Uint8Array(8))).rejects.toBe(razao);
    await expect(leitor.closed).rejects.toBe(razao);
  });

  // Astra B9: '/items/a%2Fb' e '/items/a/b' sao identidades DISTINTAS; decodificar o
  // sufixo ao devolver a URL a fonte entregava a resposta de um ao outro.
  it('sufixo percent-encoded e preservado ao devolver a URL a fonte: cada chamada recebe a sua', async () => {
    const FONTE = 'https://origin';
    const idEsc = identidadeDeRequisicao('GET', `${FONTE}/items/a%2Fb`, Buffer.alloc(0));
    const idPlano = identidadeDeRequisicao('GET', `${FONTE}/items/a/b`, Buffer.alloc(0));
    expect(idEsc).not.toBe(idPlano);
    const { manifesto, arquivos } = montarReplay(new Map([[idEsc, [envelopeDe('ESCAPADO')]], [idPlano, [envelopeDe('PLANO')]]]), new Map());
    const { w } = sandbox(manifesto, async (u) => new Response(arquivos.find((a) => String(u).endsWith(a.path)).body),
      { entryPath: 'index.html', origemFonte: FONTE, href: `${ORIGEM}/api/runtime/tok/index.html` });
    expect(await (await w.fetch(`${ORIGEM}/api/runtime/tok/items/a%2Fb`)).text()).toBe('ESCAPADO');
    expect(await (await w.fetch(`${ORIGEM}/api/runtime/tok/items/a/b`)).text()).toBe('PLANO');   // ocorrencia NAO consumida pelo outro
  });

  // Astra B10: corpo em fluxo no init era consumido pelo hash; o passthrough recebia um
  // fluxo perturbado e o POST same-origin nao mapeado falhava.
  it('POST same-origin NAO mapeado com corpo em fluxo chega ao fetch original com o corpo inteiro, UMA vez', async () => {
    const corpos = [];
    // O mock VALIDA como o fetch nativo: constroi um Request (fluxo perturbado lanca).
    const { w } = sandbox(manifestoVazio, async (entrada, init) => { const rq = new Request(entrada, init); corpos.push(await rq.text()); return new Response('ok'); });
    const fluxo = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('pay')); c.enqueue(new TextEncoder().encode('load')); c.close(); } });
    const r = await w.fetch(`${ORIGEM}/api`, { method: 'POST', body: fluxo, duplex: 'half' });
    expect(await r.text()).toBe('ok');
    expect(corpos).toEqual(['payload']);
  });

  // Astra B11: fluxo lido em parte e DESTRAVADO e invalido para o Fetch; um tee() antes
  // de validar o transformava num POST truncado valido.
  it('corpo perturbado-mas-destravado rejeita como o Fetch nativo: nada e enviado, nenhuma ocorrencia consumida', async () => {
    const id = identidadeDeRequisicao('POST', 'https://origin/api', Buffer.from('payload'), {});
    const { manifesto, arquivos } = montarReplay(new Map([[id, [envelopeDe('one')]]]), new Map());
    const enviados = [];
    const { w } = sandbox(manifesto, async (entrada, init) => { const rq = new Request(entrada, init); enviados.push(await rq.text()); return new Response(arquivos[0].body); });
    const fluxo = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('prefix')); c.enqueue(new TextEncoder().encode('payload')); c.close(); } });
    const leitor = fluxo.getReader(); await leitor.read(); leitor.releaseLock();   // perturbado, destravado
    await expect(w.fetch(`${ORIGEM}/api`, { method: 'POST', body: fluxo, duplex: 'half' })).rejects.toBeInstanceOf(TypeError);
    expect(enviados).toEqual([]);
    // e a ocorrencia do envelope segue disponivel para a chamada legitima
    // (corpo PRONTO: fluxo nunca recebe envelope — Astra B141)
    expect(await (await w.fetch('https://origin/api', { method: 'POST', body: new TextEncoder().encode('payload') })).text()).toBe('one');
  });

  // Astra B12: URL relativa nao e prova de mesma origem (<base href> cross-origin). Na
  // sandbox o Request nativo nem constroi uma relativa (sem base) — a lane de falha de
  // construcao tem que classifica-la como EXTERNA e falhar fechado para metodo mutavel.
  it('URL relativa cuja construcao falha REJEITA com o erro nativo, sem chamar o original', async () => {
    let n = 0;
    const { w } = sandbox(manifestoVazio, async () => { n += 1; return new Response('ok'); });
    await expect(w.fetch('/api', { method: 'POST', body: 'x' })).rejects.toBeInstanceOf(TypeError);
    await expect(w.fetch('/api')).rejects.toBeInstanceOf(TypeError);
    expect(n).toBe(0);
  });

  // Astra B14: init com GETTERS respondia GET a classificacao e POST a rede depois de uma
  // falha de construcao que caia no passthrough com os argumentos originais.
  it('falha de construcao rejeita e NUNCA reexecuta os argumentos do chamador', async () => {
    let n = 0;
    const { w } = sandbox(manifestoVazio, async (entrada, init) => { n += 1; new Request(entrada, init); return new Response('ok'); });
    let reads = 0;
    const init = { get method() { return ++reads < 3 ? 'GET' : 'POST'; }, body: 'payload' };
    await expect(w.fetch(new Request('https://origin/coleta'), init)).rejects.toBeInstanceOf(TypeError);
    expect(n).toBe(0);
  });

  it('o passthrough de uma chamada por string recebe o Request CONSTRUIDO (URL congelada)', async () => {
    let recebido = null;
    const { w } = sandbox(manifestoVazio, async (entrada) => { recebido = entrada; return new Response('ok'); });
    await w.fetch(`${ORIGEM}/x?y=1`, { method: 'POST', body: 'abc' });
    expect(recebido).toBeInstanceOf(Request);
    expect(recebido.url).toBe(`${ORIGEM}/x?y=1`);
    expect(await recebido.text()).toBe('abc');
  });

  // Astra B13: init MUTAVEL relido depois do hash — GET validado saia como POST externo.
  it('init trocado de GET para POST DEPOIS da chamada nao vira POST externo: a rede recebe o Request validado', async () => {
    let recebido = null;
    const { w } = sandbox(manifestoVazio, async (entrada, init) => { recebido = new Request(entrada, init); return new Response('ok'); });
    const init = { method: 'GET' };
    const pendente = w.fetch(new Request('https://origin/coleta'), init);
    init.method = 'POST'; init.body = 'x';
    expect(await (await pendente).text()).toBe('ok');
    expect(recebido.method).toBe('GET');
    expect(recebido.body).toBe(null);
  });

  // Astra B15: `init.body` era lido DUAS vezes antes do construtor — um getter devolvia um
  // fluxo perturbado as leituras previas e 'replacement' ao construtor, e um POST que o
  // fetch nativo recusaria saia valido.
  it('getter de body lido so pelo construtor: entrada invalida rejeita, zero chamadas ao original', async () => {
    let n = 0;
    const { w } = sandbox(manifestoVazio, async (entrada, init) => { n += 1; new Request(entrada, init); return new Response('ok'); });
    const perturbado = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('ab')); c.enqueue(new TextEncoder().encode('cd')); c.close(); } });
    const leitor = perturbado.getReader(); await leitor.read(); leitor.releaseLock();
    // Linha de base NATIVA: quantas vezes o proprio construtor le o getter (o undici le
    // mais de uma). O remendo nao pode acrescentar NENHUMA leitura alem dessas.
    let readsNativo = 0;
    const perturbado2 = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('ab')); c.close(); } });
    const l2 = perturbado2.getReader(); await l2.read(); l2.releaseLock();
    expect(() => new Request(`${ORIGEM}/api`, { method: 'POST', duplex: 'half', get body() { readsNativo += 1; return perturbado2; } })).toThrow(TypeError);
    let reads = 0;
    const init = { method: 'POST', duplex: 'half', get body() { return ++reads <= readsNativo ? perturbado : 'replacement'; } };
    await expect(w.fetch(`${ORIGEM}/api`, init)).rejects.toBeInstanceOf(TypeError);
    expect(reads).toBe(readsNativo);
    expect(n).toBe(0);
  });

  // Astra B16: no-cors para outra origem NUNCA recebe o envelope legivel (nativo = opaco).
  // O envelope de um fetch cross-origin na fonte vem marcado `externo` pela captura (B77: e essa
  // marca — a origem que a CAPTURA viu — que decide, nao a origem fisica do clone).
  // Astra B131: no-cors e OUTRO pedido (Sec-Fetch-Mode) — miss SEM consumir; o cors seguinte
  // recebe a ocorrencia capturada para ele.
  it('no-cors externo vai pelo miss sem consumir; same-origin externo rejeita sem rede', async () => {
    const id = identidadeDeRequisicao('GET', 'https://origin/dados', Buffer.alloc(0));
    const { manifesto, arquivos } = montarReplay(new Map([[id, [{ ...envelopeDe('hidden-payload'), externo: true }]]]), new Map());
    const chamadas = [];
    const { w } = sandbox(manifesto, async (entrada) => { const u = entrada instanceof Request ? entrada.url : String(entrada); const a = arquivos.find((x) => u.endsWith(x.path)); if (a) return new Response(a.body); chamadas.push(u); return new Response('do original'); });
    const r1 = await w.fetch('https://origin/dados', { mode: 'no-cors' });
    expect(await r1.text()).toBe('do original');                      // passthrough, nao o envelope
    expect(chamadas).toEqual(['https://origin/dados']);
    // a ocorrencia NAO foi consumida: a chamada cors (a capturada) a recebe
    const r2 = await w.fetch('https://origin/dados');
    expect(await r2.text()).toBe('hidden-payload');
    expect(chamadas.length).toBe(1);
    // mode 'same-origin' para outra origem: o nativo falha antes de qualquer rede
    await expect(w.fetch('https://origin/dados', { mode: 'same-origin' })).rejects.toThrow('Failed to fetch');   // TypeError do realm da sandbox
    expect(chamadas.length).toBe(1);
  });

  it('envelope marcado OPACO na captura nunca e servido: consome a ocorrencia e vai pelo miss', async () => {
    const id = identidadeDeRequisicao('GET', 'https://origin/ping', Buffer.alloc(0));
    const { manifesto, arquivos } = montarReplay(new Map([[id, [{ opaco: true, url: 'https://origin/ping', status: 200, statusText: '', headers: {}, contentType: '', bytes: Buffer.alloc(0) }, envelopeDe('segunda-legivel')]]]), new Map());
    expect(arquivos.map((a) => a.path)).toEqual([`_replay/${id}.1`]);   // o opaco nao tem arquivo
    expect(manifesto[id][0]).toEqual({ opaco: true });
    const chamadas = [];
    const { w } = sandbox(manifesto, async (entrada) => {
      const u = entrada instanceof Request ? entrada.url : String(entrada); chamadas.push(u);
      const a = arquivos.find((x) => u.endsWith(x.path)); return new Response(a ? a.body : 'do original');
    });
    expect(await (await w.fetch('https://origin/ping')).text()).toBe('do original');   // miss, nao um corpo fabricado
    expect(await (await w.fetch('https://origin/ping')).text()).toBe('segunda-legivel');   // a 2a ocorrencia segue na posicao
  });

  // Astra B18: raiz same-origin cuja cadeia de redirect saiu da origem — no-cors e opaco.
  // Astra B131: no-cors e same-origin sao OUTROS pedidos que o capturado (cors) — os dois vao
  // pelo miss sem consumir; a rejeicao do cruzouOrigem so vale para o pedido que casou.
  it('envelope com cruzouOrigem: no-cors e same-origin vao pelo miss sem consumir, cors replaya', async () => {
    const FONTE = 'https://origin';
    const id = identidadeDeRequisicao('GET', `${FONTE}/relay`, Buffer.alloc(0));
    const env = { ...envelopeDe('visible'), cruzouOrigem: true };
    const { manifesto, arquivos } = montarReplay(new Map([[id, [env, env, env]]]), new Map());
    expect(manifesto[id][0].cruzouOrigem).toBe(true);
    const chamadas = [];
    const { w } = sandbox(manifesto, async (entrada) => { const u = entrada instanceof Request ? entrada.url : String(entrada); chamadas.push(u); const a = arquivos.find((x) => u.endsWith(x.path)); return new Response(a ? a.body : 'do servidor do clone'); },
      { entryPath: 'index.html', origemFonte: FONTE, href: `${ORIGEM}/index.html` });
    expect(await (await w.fetch(`${ORIGEM}/relay`, { mode: 'no-cors' })).text()).toBe('do servidor do clone');   // nunca 'visible'
    expect(await (await w.fetch(`${ORIGEM}/relay`, { mode: 'same-origin' })).text()).toBe('do servidor do clone');
    expect(await (await w.fetch(`${ORIGEM}/relay`)).text()).toBe('visible');   // cors: legivel, replaya (1a ocorrencia)
    expect(chamadas.filter((u) => u.includes('_replay/')).length).toBe(1);
  });

  // Astra B20: B enfileirada atras de A (corpo que nunca chega) so rejeitava no teto de A.
  it('abort de uma chamada ENFILEIRADA rejeita na hora, sem esperar o teto da anterior e sem consumir ocorrencia', async () => {
    const id = identidadeDeRequisicao('GET', 'https://origin/dados', Buffer.alloc(0));
    const { manifesto, arquivos } = montarReplay(new Map([[id, [envelopeDe('one'), envelopeDe('two')]]]), new Map());
    const { w } = sandbox(manifesto, async (u) => { const s = u instanceof Request ? u.url : String(u); return new Response(s.includes('_replay/') ? arquivos[s.endsWith('.1') ? 1 : 0].body : 'LIVE'); }, { tetoIdentidadeMs: 800 });
    const presa = w.fetch('https://origin/api', { method: 'POST', body: new ReadableStream({ start() {} }), duplex: 'half' }).then(() => 'RESOLVEU', (e) => e);
    const ac = new AbortController();
    const razao = new Error('desisti');
    const t0 = Date.now();
    const b = w.fetch('https://origin/dados', { signal: ac.signal }).then(() => 'RESOLVEU', (e) => e);
    await new Promise((res) => setTimeout(res, 50)); ac.abort(razao);
    expect(await b).toBe(razao);
    expect(Date.now() - t0).toBeLessThan(400);   // muito antes do teto de 800 ms de A
    expect(await presa).toMatchObject({ name: 'TypeError' });   // A: miss (POST externo) no teto
    expect(await (await w.fetch('https://origin/dados')).text()).toBe('LIVE');   // B nao consumiu, e o grupo saiu do replay (Astra B125)
  });

  // Astra B21: abort rejeitava o chamador mas o corpo continuava a ser consumido e o ramo
  // da rede nunca era cancelado — produtor sem fim acumulava bytes indefinidamente.
  it('abort com corpo em PRODUCAO: rejeita ja, o produtor recebe cancel() e as leituras param', async () => {
    const { w } = sandbox(manifestoVazio, async () => new Response('ok'));
    let produzidos = 0, cancelado = null, timer = null;
    const produtor = new ReadableStream({
      start(c) { timer = setInterval(() => { try { c.enqueue(new Uint8Array(64 * 1024)); produzidos += 1; } catch (e) { clearInterval(timer); } }, 2); },
      cancel(razao) { cancelado = razao; clearInterval(timer); },
    });
    const ac = new AbortController(); const razao = new Error('chega');
    const p = w.fetch(`${ORIGEM}/upload`, { method: 'POST', body: produtor, duplex: 'half', signal: ac.signal }).then(() => 'RESOLVEU', (e) => e);
    await new Promise((res) => setTimeout(res, 40));
    expect(produzidos).toBeGreaterThan(3);   // controle: o corpo ESTAVA sendo produzido e lido
    ac.abort(razao);
    expect(await p).toBe(razao);
    await new Promise((res) => setTimeout(res, 20));
    // A fonte recebeu cancel(): com tee, o motivo chega como ARRAY dos dois ramos (spec).
    expect(Array.isArray(cancelado) ? cancelado.includes(razao) : cancelado === razao).toBe(true);
    const depois = produzidos;
    await new Promise((res) => setTimeout(res, 100));
    expect(produzidos).toBe(depois);          // e nada mais foi produzido/lido
    clearInterval(timer);
  });

  // Astra B22: o ouvinte de limpeza nunca era ligado (sinal lido antes de existir) e a
  // cancelacao dependia de chegar OUTRO chunk. Produz, PAUSA, aborta: tem que cancelar.
  it('abort com o produtor em PAUSA cancela a fonte sem precisar de outro chunk', async () => {
    const { w } = sandbox(manifestoVazio, async () => new Response('ok'));
    let cancelado = null, controlador = null;
    const produtor = new ReadableStream({ start(c) { controlador = c; c.enqueue(new Uint8Array(64 * 1024)); }, cancel(razao) { cancelado = razao; } });
    const ac = new AbortController(); const razao = new Error('pausa');
    const p = w.fetch(`${ORIGEM}/upload`, { method: 'POST', body: produtor, duplex: 'half', signal: ac.signal }).then(() => 'RESOLVEU', (e) => e);
    await new Promise((res) => setTimeout(res, 30));   // o unico chunk ja foi lido; a leitura seguinte esta pendente
    ac.abort(razao);
    expect(await p).toBe(razao);
    await new Promise((res) => setTimeout(res, 30));
    expect(Array.isArray(cancelado) ? cancelado.includes(razao) : cancelado === razao).toBe(true);   // sem nenhum chunk novo
    expect(controlador).toBeTruthy();
  });

  // Astra B23: no TETO da identidade a leitura continuava e o ramo da rede seguia
  // acumulando, mesmo depois de rejeitar sem rede.
  it('teto da identidade num POST externo em producao: rejeita, zero rede, fonte cancelada, producao para', async () => {
    let n = 0;
    const { w } = sandbox(manifestoVazio, async () => { n += 1; return new Response('ok'); }, { tetoIdentidadeMs: 50 });
    let produzidos = 0, cancelado = null, timer = null;
    const produtor = new ReadableStream({
      start(c) { timer = setInterval(() => { try { c.enqueue(new Uint8Array(64 * 1024)); produzidos += 1; } catch (e) { clearInterval(timer); } }, 2); },
      cancel(razao) { cancelado = razao; clearInterval(timer); },
    });
    const t0 = Date.now();
    await expect(w.fetch('https://origin/upload', { method: 'POST', body: produtor, duplex: 'half' })).rejects.toThrow('Failed to fetch');
    expect(Date.now() - t0).toBeLessThan(400);
    expect(n).toBe(0);
    await new Promise((res) => setTimeout(res, 30));
    expect(cancelado).not.toBe(null);          // os dois ramos soltos => a fonte recebeu cancel()
    const depois = produzidos;
    await new Promise((res) => setTimeout(res, 100));
    expect(produzidos).toBe(depois);
    clearInterval(timer);
  });

  // Astra B24: retornos ANTECIPADOS (multipart, mode same-origin) aconteciam antes de
  // existir leitor e deixavam o produtor correndo apos rejeitar.
  const produtorInfinito = () => {
    const estado = { produzidos: 0, cancelado: null, timer: null };
    estado.fluxo = new ReadableStream({
      start(c) { estado.timer = setInterval(() => { try { c.enqueue(new Uint8Array(64 * 1024)); estado.produzidos += 1; } catch (e) { clearInterval(estado.timer); } }, 2); },
      cancel(razao) { estado.cancelado = razao; clearInterval(estado.timer); },
    });
    return estado;
  };
  const paraDeProduzir = async (estado) => { await new Promise((res) => setTimeout(res, 30)); const d = estado.produzidos; await new Promise((res) => setTimeout(res, 100)); clearInterval(estado.timer); return estado.produzidos === d; };

  it('multipart EXTERNO em producao: rejeita sem rede, fonte cancelada, producao para', async () => {
    let n = 0;
    const { w } = sandbox(manifestoVazio, async () => { n += 1; return new Response('ok'); });
    const e = produtorInfinito();
    await expect(w.fetch('https://origin/upload', { method: 'POST', body: e.fluxo, duplex: 'half', headers: { 'content-type': 'multipart/form-data; boundary=x' } })).rejects.toThrow('Failed to fetch');
    expect(n).toBe(0);
    expect(await paraDeProduzir(e)).toBe(true);
    expect(e.cancelado).not.toBe(null);
  });

  it('mode same-origin EXTERNO em producao: rejeita sem rede, fonte cancelada, producao para', async () => {
    let n = 0;
    const { w } = sandbox(manifestoVazio, async () => { n += 1; return new Response('ok'); });
    const e = produtorInfinito();
    await expect(w.fetch('https://origin/upload', { method: 'POST', body: e.fluxo, duplex: 'half', mode: 'same-origin' })).rejects.toThrow('Failed to fetch');
    expect(n).toBe(0);
    expect(await paraDeProduzir(e)).toBe(true);
    expect(e.cancelado).not.toBe(null);
  });

  // Astra B25: stream HERDADO de um Request de entrada e stream vindo de GETTER tambem
  // sao produtores — a soltura acontece no proprio corpo, antes de qualquer tee.
  it('Request de entrada com stream em producao (multipart externo): rejeita, fonte cancelada, producao para', async () => {
    let n = 0;
    const { w } = sandbox(manifestoVazio, async () => { n += 1; return new Response('ok'); });
    const e = produtorInfinito();
    const rq = new Request('https://origin/upload', { method: 'POST', body: e.fluxo, duplex: 'half', headers: { 'content-type': 'multipart/form-data; boundary=x' } });
    await expect(w.fetch(rq)).rejects.toThrow('Failed to fetch');
    expect(n).toBe(0);
    expect(await paraDeProduzir(e)).toBe(true);
    expect(e.cancelado).not.toBe(null);
  });

  it('stream vindo de GETTER (mode same-origin externo): rejeita, fonte cancelada, producao para', async () => {
    let n = 0;
    const { w } = sandbox(manifestoVazio, async () => { n += 1; return new Response('ok'); });
    const e = produtorInfinito();
    const init = { method: 'POST', duplex: 'half', mode: 'same-origin', get body() { return e.fluxo; } };
    await expect(w.fetch('https://origin/upload', init)).rejects.toThrow('Failed to fetch');
    expect(n).toBe(0);
    expect(await paraDeProduzir(e)).toBe(true);
    expect(e.cancelado).not.toBe(null);
  });

  it('multipart SAME-ORIGIN passa pela rede com o corpo inteiro (so o ramo do hash e solto)', async () => {
    const corpos = [];
    const { w } = sandbox(manifestoVazio, async (entrada, init) => { corpos.push(await new Request(entrada, init).text()); return new Response('ok'); });
    const fluxo = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('--x\r\nparte\r\n--x--')); c.close(); } });
    expect(await (await w.fetch(`${ORIGEM}/form`, { method: 'POST', body: fluxo, duplex: 'half', headers: { 'content-type': 'multipart/form-data; boundary=x' } })).text()).toBe('ok');
    expect(corpos).toEqual(['--x\r\nparte\r\n--x--']);
  });

  // Astra B26: pull() SINCRONO mantem o laco em microtarefas e o setTimeout do teto nunca
  // corre — o laco tem que aplicar o prazo e o teto de bytes por si.
  it('produtor com pull sincrono: o teto vale mesmo assim, a fonte e cancelada e nada mais e lido', async () => {
    let n = 0;
    const { w } = sandbox(manifestoVazio, async () => { n += 1; return new Response('ok'); }, { tetoIdentidadeMs: 25 });
    let pedacos = 0, cancelado = null;
    const produtor = new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(256)); pedacos += 1; }, cancel(r) { cancelado = r; } });
    const t0 = Date.now();
    await expect(w.fetch('https://origin/upload', { method: 'POST', body: produtor, duplex: 'half' })).rejects.toThrow('Failed to fetch');
    const decorrido = Date.now() - t0;
    expect(decorrido).toBeLessThan(500);            // nao correu ate esgotar memoria
    expect(n).toBe(0);
    await new Promise((res) => setTimeout(res, 20));
    expect(cancelado).not.toBe(null);              // os dois ramos soltos => fonte cancelada
    const depois = pedacos;
    await new Promise((res) => setTimeout(res, 50));
    expect(pedacos).toBe(depois);                  // e nada mais foi puxado
  });

  // Astra B27: chunk que nao e Uint8Array — o nativo rejeita ao consumir; o remendo
  // montava bytes e podia roubar a ocorrencia de um pedido valido.
  it('chunk invalido (Uint16Array) rejeita com TypeError, solta os ramos e NAO consome a ocorrencia', async () => {
    const id = identidadeDeRequisicao('POST', 'https://origin/api', Buffer.from([65, 0]), {});
    const { manifesto, arquivos } = montarReplay(new Map([[id, [envelopeDe('one')]]]), new Map());
    const { w } = sandbox(manifesto, async () => new Response(arquivos[0].body));
    let cancelado = null;
    const invalido = new ReadableStream({ start(c) { c.enqueue(new Uint16Array([65])); }, cancel(r) { cancelado = r; } });
    await expect(w.fetch('https://origin/api', { method: 'POST', body: invalido, duplex: 'half' })).rejects.toMatchObject({ name: 'TypeError' });
    await new Promise((res) => setTimeout(res, 20));
    expect(cancelado).not.toBe(null);
    // o pedido VALIDO seguinte recebe a ocorrencia intacta
    // o pedido VALIDO seguinte (corpo pronto: fluxo nunca recebe envelope — Astra B141)
    expect(await (await w.fetch('https://origin/api', { method: 'POST', body: new Uint8Array([65, 0]) })).text()).toBe('one');
  });

  // Astra B28: Symbol.toStringTag proprio forjado enganava a checagem por tag.
  it('chunk Uint16Array com toStringTag forjado ainda rejeita e preserva a ocorrencia', async () => {
    const id = identidadeDeRequisicao('POST', 'https://origin/api', Buffer.from([65, 0]), {});
    const { manifesto, arquivos } = montarReplay(new Map([[id, [envelopeDe('one')]]]), new Map());
    const { w } = sandbox(manifesto, async () => new Response(arquivos[0].body));
    const forjado = new Uint16Array([65]);
    Object.defineProperty(forjado, Symbol.toStringTag, { value: 'Uint8Array' });
    const invalido = new ReadableStream({ start(c) { c.enqueue(forjado); c.close(); } });
    await expect(w.fetch('https://origin/api', { method: 'POST', body: invalido, duplex: 'half' })).rejects.toMatchObject({ name: 'TypeError' });
    // o pedido VALIDO seguinte (corpo pronto: fluxo nunca recebe envelope — Astra B141)
    expect(await (await w.fetch('https://origin/api', { method: 'POST', body: new Uint8Array([65, 0]) })).text()).toBe('one');
  });

  // Astra B29: byteLength PROPRIO forjado no chunk fazia montar bytes a mais.
  it('chunk com byteLength forjado: o fluxo nunca recebe envelope; os corpos prontos recebem os seus', async () => {
    const idA = identidadeDeRequisicao('POST', 'https://origin/api', Buffer.from([65]), {});
    const idB = identidadeDeRequisicao('POST', 'https://origin/api', Buffer.from([65, 0]), {});
    const { manifesto, arquivos } = montarReplay(new Map([[idA, [envelopeDe('A')]], [idB, [envelopeDe('B')]]]), new Map());
    const mock = async (u) => { const x = u instanceof Request ? u.url : String(u); const a = arquivos.find((f) => x.endsWith(f.path)); return new Response(a ? a.body : 'LIVE'); };
    const { w } = sandbox(manifesto, mock);
    const forjado = new Uint8Array([65]);
    Object.defineProperty(forjado, 'byteLength', { value: 2 });
    const corpoA = new ReadableStream({ start(c) { c.enqueue(forjado); c.close(); } });
    expect(await w.fetch('https://origin/api', { method: 'POST', body: corpoA, duplex: 'half' }).then((r) => r.text(), (e) => e.name)).toBe('TypeError');
    expect(await (await w.fetch('https://origin/api', { method: 'POST', body: new Uint8Array([65]) })).text()).toBe('A');
    expect(await (await w.fetch('https://origin/api', { method: 'POST', body: new Uint8Array([65, 0]) })).text()).toBe('B');
  });

  // Astra B30: chunk MUTADO depois de lido (mesmo buffer reemitido) — guardar referencia
  // fazia o hash sair de outro corpo. Copia-se cada chunk ao ler, como o Fetch.
  // ⚠️ Medido: com mutacao SINCRONA dentro do pull seguinte, o proprio consumo nativo
  // (Request.arrayBuffer) ja ve [66,66] — o pull corre antes dos passos de chunk. O
  // caso que DIFERE e a mutacao ASSINCRONA (depois da leitura resolver): o nativo
  // preserva [65,66]; o remendo antigo, guardando referencia, dava [66,66].
  it('buffer reutilizado e mutado entre leituras de um fluxo: nunca recebe envelope, nem consome o do corpo pronto', async () => {
    const idAB = identidadeDeRequisicao('POST', 'https://origin/api', Buffer.from([65, 66]), {});
    const idBB = identidadeDeRequisicao('POST', 'https://origin/api', Buffer.from([66, 66]), {});
    const { manifesto, arquivos } = montarReplay(new Map([[idAB, [envelopeDe('AB')]], [idBB, [envelopeDe('BB')]]]), new Map());
    const mock = async (u) => { const x = u instanceof Request ? u.url : String(u); const a = arquivos.find((f) => x.endsWith(f.path)); return new Response(a ? a.body : 'LIVE'); };
    const { w } = sandbox(manifesto, mock);
    const buffer = new Uint8Array([65]); let vez = 0;
    const fluxo = new ReadableStream({ pull(c) { vez += 1; if (vez === 1) { c.enqueue(buffer); return; } if (vez === 2) { return new Promise((res) => setTimeout(() => { buffer[0] = 66; c.enqueue(buffer); res(); }, 10)); } c.close(); } });
    expect(await w.fetch('https://origin/api', { method: 'POST', body: fluxo, duplex: 'half' }).then((r) => r.text(), (e) => e.name)).toBe('TypeError');
    expect(await (await w.fetch('https://origin/api', { method: 'POST', body: new Uint8Array([65, 66]) })).text()).toBe('AB');
    expect(await (await w.fetch('https://origin/api', { method: 'POST', body: new Uint8Array([66, 66]) })).text()).toBe('BB');
  });

  // Astra B31: a copia era alocada ANTES da checagem de tamanho — um chunk de 64 MiB
  // alocava 64 MiB no remendo apesar do teto de 8 MiB.
  it('um unico chunk acima do teto e recusado SEM alocar a sua copia', async () => {
    // Uint8Array que REGISTRA alocacoes: o remendo usa o global da sandbox. Proxy com
    // trap de construct (uma subclasse quebraria a cadeia de prototipos que a marca
    // intrinseca e o instanceof usam).
    const alocados = [];
    const U8 = new Proxy(Uint8Array, { construct(alvo, args) { if (typeof args[0] === 'number') alocados.push(args[0]); return Reflect.construct(alvo, args); } });
    const shim = runtimeFetchShim(manifestoVazio, {});
    const js = shim.slice(shim.indexOf('>') + 1, shim.lastIndexOf('</script>'));
    const location = { href: `${ORIGEM}/`, origin: ORIGEM, pathname: '/' };
    let n = 0;
    const ctx = { window: { crypto: webcrypto, fetch: async () => { n += 1; return new Response('ok'); } }, Request, Response, Headers, TextEncoder, TextDecoder, Uint8Array: U8, URL, setTimeout, clearTimeout, DOMException, ReadableStream, btoa, document: {}, location };
    ctx.window.window = ctx.window; ctx.window.location = location;
    vm.runInNewContext(js, ctx);
    let cancelado = null;
    const grande = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(64 * 1024 * 1024)); }, cancel(r) { cancelado = r; } });
    await expect(ctx.window.fetch('https://origin/upload', { method: 'POST', body: grande, duplex: 'half' })).rejects.toThrow('Failed to fetch');
    expect(n).toBe(0);
    expect(alocados.filter((x) => x >= 64 * 1024 * 1024)).toEqual([]);   // nenhuma copia de 64 MiB
    await new Promise((res) => setTimeout(res, 20));
    expect(cancelado).not.toBe(null);
  });

  // Astra B32: o tee de um fluxo de BYTES copia o chunk antes de qualquer guarda — a
  // regressao anterior (construtor JS) nao via a alocacao nativa. Sem tee, nada copia.
  it('fluxo de bytes com chunk de 64 MiB: nenhuma alocacao nativa da copia antes da recusa', async () => {
    let n = 0;
    const { w } = sandbox(manifestoVazio, async () => { n += 1; return new Response('ok'); });
    const chunk = new Uint8Array(64 * 1024 * 1024);   // alocado ANTES da linha de base
    let cancelado = null;
    const grande = new ReadableStream({ type: 'bytes', start(c) { c.enqueue(chunk); }, cancel(r) { cancelado = r; } });
    if (global.gc) global.gc();
    const antes = process.memoryUsage().arrayBuffers;
    await expect(w.fetch('https://origin/upload', { method: 'POST', body: grande, duplex: 'half' })).rejects.toThrow('Failed to fetch');
    const delta = process.memoryUsage().arrayBuffers - antes;
    expect(delta).toBeLessThan(32 * 1024 * 1024);   // nenhuma copia de 64 MiB (nativa ou JS)
    expect(n).toBe(0);
    await new Promise((res) => setTimeout(res, 20));
    expect(cancelado).not.toBe(null);
  });

  // Astra B33: no teto, cancelar o leitor resolvia a leitura pendente como EOF e o corpo
  // PARCIAL virava snapshot — um POST same-origin era encaminhado TRUNCADO.
  it('POST same-origin com corpo que nunca fecha: no teto rejeita, zero rede, fonte cancelada (nunca truncado)', async () => {
    let n = 0;
    const { w } = sandbox(manifestoVazio, async () => { n += 1; return new Response('ok'); }, { tetoIdentidadeMs: 30 });
    let cancelado = null;
    const pausado = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('prefix')); }, cancel(r) { cancelado = r; } });
    await expect(w.fetch(`${ORIGEM}/api`, { method: 'POST', body: pausado, duplex: 'half' })).rejects.toThrow('Failed to fetch');
    expect(n).toBe(0);
    await new Promise((res) => setTimeout(res, 20));
    expect(cancelado).not.toBe(null);
  });

  // Astra B34: req.integrity (SRI) nunca era verificado no hit — um envelope errado
  // passava onde o fetch nativo rejeita.
  it('Subresource Integrity no hit: digest que bate entrega; que nao bate rejeita; algoritmo mais forte vence', async () => {
    const { createHash } = await import('node:crypto');
    const sri = (algo, s) => `${algo}-${createHash(algo).update(s).digest('base64')}`;
    const id = identidadeDeRequisicao('GET', 'https://origin/lib.js', Buffer.alloc(0));
    const { manifesto, arquivos } = montarReplay(new Map([[id, [envelopeDe('EVIL'), envelopeDe('GOOD'), envelopeDe('GOOD'), envelopeDe('GOOD')]]]), new Map());
    const { w } = sandbox(manifesto, async (u) => new Response(arquivos.find((a) => String(u).endsWith(a.path)).body));
    // 1a ocorrencia: envelope 'EVIL' contra integrity de 'GOOD' (mesmo comprimento) => rejeita
    await expect(w.fetch('https://origin/lib.js', { integrity: sri('sha256', 'GOOD') })).rejects.toThrow('integrity mismatch');
    // 2a: 'GOOD' bate
    expect(await (await w.fetch('https://origin/lib.js', { integrity: sri('sha256', 'GOOD') })).text()).toBe('GOOD');
    // 3a: sha256 errado + sha384 certo => o mais forte (sha384) decide: aprova
    expect(await (await w.fetch('https://origin/lib.js', { integrity: `${sri('sha256', 'EVIL')} ${sri('sha384', 'GOOD')}` })).text()).toBe('GOOD');
    // 4a: algoritmo nao suportado nao impoe nada
    expect(await (await w.fetch('https://origin/lib.js', { integrity: 'md5-AAAA' })).text()).toBe('GOOD');
  });

  // Astra B35: digest em base64 URL-SAFE era descartado pela regex e, sem candidato, o SRI
  // nao impunha nada.
  it('SRI em base64 URL-safe: aceita GOOD, rejeita EVIL, e o mais forte URL-safe segue decidindo', async () => {
    const { createHash } = await import('node:crypto');
    const urlSafe = (algo, s) => `${algo}-${createHash(algo).update(s).digest('base64url')}=`;
    const padrao = (algo, s) => `${algo}-${createHash(algo).update(s).digest('base64')}`;
    const id = identidadeDeRequisicao('GET', 'https://origin/lib.js', Buffer.alloc(0));
    const { manifesto, arquivos } = montarReplay(new Map([[id, [envelopeDe('EVIL'), envelopeDe('GOOD'), envelopeDe('EVIL')]]]), new Map());
    const { w } = sandbox(manifesto, async (u) => new Response(arquivos.find((a) => String(u).endsWith(a.path)).body));
    await expect(w.fetch('https://origin/lib.js', { integrity: urlSafe('sha256', 'GOOD') })).rejects.toThrow('integrity mismatch');   // envelope EVIL
    expect(await (await w.fetch('https://origin/lib.js', { integrity: urlSafe('sha256', 'GOOD') })).text()).toBe('GOOD');
    // sha256 padrao que BATE com EVIL + sha384 URL-safe de GOOD: o mais forte decide => rejeita o EVIL
    await expect(w.fetch('https://origin/lib.js', { integrity: `${padrao('sha256', 'EVIL')} ${urlSafe('sha384', 'GOOD')}` })).rejects.toThrow('integrity mismatch');
  });

  // Astra B36: 'sha-256' (hifenizado, aceito pelo Chromium) era lido como algoritmo 'sha'
  // e descartado — SRI falhava aberto.
  it('SRI com alias hifenizado (sha-256/sha-384): aceita GOOD, rejeita EVIL, e o mais forte hifenizado decide', async () => {
    const { createHash } = await import('node:crypto');
    const hif = (algo, s) => `sha-${algo.slice(3)}-${createHash(algo).update(s).digest('base64')}`;
    const padrao = (algo, s) => `${algo}-${createHash(algo).update(s).digest('base64')}`;
    const id = identidadeDeRequisicao('GET', 'https://origin/lib.js', Buffer.alloc(0));
    const { manifesto, arquivos } = montarReplay(new Map([[id, [envelopeDe('EVIL'), envelopeDe('GOOD'), envelopeDe('EVIL')]]]), new Map());
    const { w } = sandbox(manifesto, async (u) => new Response(arquivos.find((a) => String(u).endsWith(a.path)).body));
    await expect(w.fetch('https://origin/lib.js', { integrity: hif('sha256', 'GOOD') })).rejects.toThrow('integrity mismatch');   // envelope EVIL
    expect(await (await w.fetch('https://origin/lib.js', { integrity: hif('sha256', 'GOOD') })).text()).toBe('GOOD');
    await expect(w.fetch('https://origin/lib.js', { integrity: `${padrao('sha256', 'EVIL')} ${hif('sha384', 'GOOD')}` })).rejects.toThrow('integrity mismatch');
  });

  // Astra B37: envelope vindo de redirect SEGUIDO era servido a qualquer politica
  // `redirect`; 'error' tem que rejeitar e 'manual' ir pelo miss.
  it('politica redirect: envelope de redirect seguido serve a follow, rejeita error, manual vai pelo miss; sem redirect serve a todas', async () => {
    const id = identidadeDeRequisicao('GET', 'https://origin/relay', Buffer.alloc(0));
    const idDireto = identidadeDeRequisicao('GET', 'https://origin/direto', Buffer.alloc(0));
    const env = { ...envelopeDe('final'), redirecionou: true };
    const { manifesto, arquivos } = montarReplay(new Map([[id, [env, env, env]], [idDireto, [envelopeDe('direto')]]]), new Map());
    expect(manifesto[id][0].redirecionou).toBe(true);
    expect(manifesto[idDireto][0]).not.toHaveProperty('redirecionou');
    const chamadas = [];
    const { w } = sandbox(manifesto, async (u) => { const s = u instanceof Request ? u.url : String(u); chamadas.push(s); const a = arquivos.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'do original'); });
    expect(await (await w.fetch('https://origin/relay')).text()).toBe('final');                         // follow (default)
    await expect(w.fetch('https://origin/relay', { redirect: 'error' })).rejects.toThrow('Failed to fetch');
    expect(await (await w.fetch('https://origin/relay', { redirect: 'manual' })).text()).toBe('do original');   // miss => passthrough
    expect(await (await w.fetch('https://origin/direto', { redirect: 'error' })).text()).toBe('direto');       // controle: sem redirect, serve
  });

  // Astra B38: envelope cross-origin legivel em modo omit (ACAO *) servia a
  // credentials:'include' — o nativo rejeita (exige origem explicita + Allow-Credentials).
  it('CORS credenciado: envelope externo sem elegibilidade serve a omit e rejeita include; elegivel serve a include', async () => {
    // Astra B129: omit e include sao identidades DIFERENTES — o envelope de omit nunca e o de include.
    const idOmit = identidadeDeRequisicao('GET', 'https://origin/dados', Buffer.alloc(0), {}, 'omit');
    const idInc = identidadeDeRequisicao('GET', 'https://origin/dados', Buffer.alloc(0), {}, 'include');
    const idOk = identidadeDeRequisicao('GET', 'https://origin/cred', Buffer.alloc(0), {}, 'include');
    const semCred = { ...envelopeDe('publico'), externo: true };
    const comCred = { ...envelopeDe('privado'), externo: true, corsCredenciado: true };
    const { manifesto, arquivos } = montarReplay(new Map([[idOmit, [semCred]], [idInc, [semCred]], [idOk, [comCred]]]), new Map());
    expect(manifesto[idOmit][0].externo).toBe(true); expect(manifesto[idOmit][0]).not.toHaveProperty('corsCredenciado');
    const { w } = sandbox(manifesto, async (u) => { const a = arquivos.find((x) => String(u instanceof Request ? u.url : u).endsWith(x.path)); return new Response(a ? a.body : 'LIVE'); });
    expect(await (await w.fetch('https://origin/dados', { credentials: 'omit' })).text()).toBe('publico');
    await expect(w.fetch('https://origin/dados', { credentials: 'include' })).rejects.toThrow('Failed to fetch');   // envelope de include sem elegibilidade
    expect(await (await w.fetch('https://origin/cred', { credentials: 'include' })).text()).toBe('privado');   // controle permitido
  });

  // Astra B129: o envelope capturado com include nunca e servido (nem consumido) por omit.
  it('credenciais distinguem: omit nao recebe nem consome a ocorrencia capturada com include', async () => {
    const FONTE = 'https://origin';
    const idInc = identidadeDeRequisicao('GET', `${FONTE}/account`, Buffer.alloc(0), {}, 'include');
    const { manifesto, arquivos } = montarReplay(new Map([[idInc, [envelopeDe('PRIVATE')]]]), new Map());
    const mock = async (u) => { const s = u instanceof Request ? u.url : String(u); const a = arquivos.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'LIVE'); };
    const { w } = sandbox(manifesto, mock, { entryPath: 'index.html', origemFonte: FONTE, href: `${ORIGEM}/api/runtime/tok/index.html` });
    expect(await (await w.fetch(`${ORIGEM}/api/runtime/tok/account`, { credentials: 'omit' })).text()).not.toBe('PRIVATE');
    expect(await (await w.fetch(`${ORIGEM}/api/runtime/tok/account`, { credentials: 'include' })).text()).toBe('PRIVATE');
  });

  // Astra B41: asset cross-origin capturado primeiro (imagem) + literal reescrito para a
  // copia local => o fetch virava same-origin e lia o arquivo local que ao vivo era
  // opaco. Proveniencia _ext/<host>/ e EXTERNA: identidade e rede pela URL de origem.
  it('caminho local _ext/<host>/ e proveniencia externa: vai a rede pela URL de origem, nunca ao arquivo local', async () => {
    const FONTE = 'https://origin';
    const chamadas = [];
    const { w } = sandbox(manifestoVazio, async (entrada) => { chamadas.push(entrada instanceof Request ? entrada.url : String(entrada)); return new Response('do original'); },
      { entryPath: 'index.html', origemFonte: FONTE, href: `${ORIGEM}/api/runtime/tok/index.html` });
    await w.fetch(`${ORIGEM}/api/runtime/tok/_ext/cdn.example/avatar.png`, { mode: 'no-cors' });
    await w.fetch(`${ORIGEM}/api/runtime/tok/_ext/cdn.example/avatar.png`);
    expect(chamadas).toEqual(['https://cdn.example/avatar.png', 'https://cdn.example/avatar.png']);
    // grafias CODIFICADAS (Astra B43): o servidor decodifica antes de servir; a proveniencia tambem
    await w.fetch(`${ORIGEM}/api/runtime/tok/%5fext/cdn.example/avatar.png`, { mode: 'no-cors' });
    await w.fetch(`${ORIGEM}/api/runtime/tok/_ext%2fcdn.example/avatar.png`, { mode: 'no-cors' });
    expect(chamadas.slice(2)).toEqual(['https://cdn.example/avatar.png', 'https://cdn.example/avatar.png']);
    // atalho do multipart (Astra B42): GET com cabecalho multipart a _ext/ tambem vai pela proveniencia
    await w.fetch(`${ORIGEM}/api/runtime/tok/_ext/cdn.example/avatar.png`, { mode: 'no-cors', headers: { 'content-type': 'multipart/form-data' } });
    expect(chamadas[4]).toBe('https://cdn.example/avatar.png');
    // e um POST para um caminho _ext/ e externo mutavel: falha fechado
    await expect(w.fetch(`${ORIGEM}/api/runtime/tok/_ext/cdn.example/api`, { method: 'POST', body: 'x' })).rejects.toThrow('Failed to fetch');
    await expect(w.fetch(`${ORIGEM}/api/runtime/tok/_ext/cdn.example/api`, { method: 'POST', body: 'x', headers: { 'content-type': 'multipart/form-data; boundary=x' } })).rejects.toThrow('Failed to fetch');
    expect(chamadas.length).toBe(5);
  });

  // Astra B44: a URL reconstruida do caminho _ext/ e com perdas (query em hash) e podia
  // bater no envelope de OUTRO pedido. So o mapa de proveniencia EXATO seleciona.
  it('proveniencia exata: o literal reescrito acha o SEU envelope; sem entrada no mapa e miss, nunca hit errado', async () => {
    const FONTE = 'https://origin';
    const idFirst = identidadeDeRequisicao('GET', 'https://cdn.example/avatar.png?v=1', Buffer.alloc(0), {});
    const idOther = identidadeDeRequisicao('GET', 'https://cdn.example/avatar.258c7611.png', Buffer.alloc(0), {});
    const { manifesto, arquivos } = montarReplay(new Map([[idFirst, [envelopeDe('FIRST')]], [idOther, [envelopeDe('OTHER')]]]), new Map());
    const chamadas = [];
    const mock = async (u) => { const s = u instanceof Request ? u.url : String(u); chamadas.push(s); const a = arquivos.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'da rede'); };
    const opts = { entryPath: 'index.html', origemFonte: FONTE, href: `${ORIGEM}/api/runtime/tok/index.html` };
    // COM o mapa: o caminho reescrito resolve para a identidade EXATA da URL original
    const { w } = sandbox(manifesto, mock, { ...opts, proveniencias: { '_ext/cdn.example/avatar.258c7611.png': idFirst } });
    // Astra B45: caminho localizado COM query e outro pedido — miss, sem consumir FIRST
    expect(await (await w.fetch(`${ORIGEM}/api/runtime/tok/_ext/cdn.example/avatar.258c7611.png?v=2`)).text()).toBe('da rede');
    expect(await (await w.fetch(`${ORIGEM}/api/runtime/tok/_ext/cdn.example/avatar.258c7611.png`)).text()).toBe('FIRST');
    expect(await (await w.fetch('https://cdn.example/avatar.258c7611.png')).text()).toBe('OTHER');   // ocorrencia intacta
    // SEM o mapa: miss (vai a rede pela URL de proveniencia), nunca o envelope de OTHER
    const { w: w2 } = sandbox(manifesto, mock, opts);
    expect(await (await w2.fetch(`${ORIGEM}/api/runtime/tok/_ext/cdn.example/avatar.258c7611.png`)).text()).toBe('da rede');
    expect(await (await w2.fetch('https://cdn.example/avatar.258c7611.png')).text()).toBe('OTHER');
    // Range primeiro (Astra B46): miss pela rede, sem consumir; o GET comum depois recebe FIRST
    const { w: w4 } = sandbox(manifesto, mock, { ...opts, proveniencias: { '_ext/cdn.example/avatar.258c7611.png': idFirst } });
    expect(await (await w4.fetch(`${ORIGEM}/api/runtime/tok/_ext/cdn.example/avatar.258c7611.png`, { headers: { Range: 'bytes=0-0' } })).text()).toBe('da rede');
    expect(await (await w4.fetch(`${ORIGEM}/api/runtime/tok/_ext/cdn.example/avatar.258c7611.png`)).text()).toBe('FIRST');
    // If-Match primeiro (Astra B47): miss, sem consumir; o GET comum depois recebe FIRST
    const { w: w6 } = sandbox(manifesto, mock, { ...opts, proveniencias: { '_ext/cdn.example/avatar.258c7611.png': idFirst } });
    expect(await (await w6.fetch(`${ORIGEM}/api/runtime/tok/_ext/cdn.example/avatar.258c7611.png`, { headers: { 'If-Match': '"stale"' } })).text()).toBe('da rede');
    expect(await (await w6.fetch(`${ORIGEM}/api/runtime/tok/_ext/cdn.example/avatar.258c7611.png`)).text()).toBe('FIRST');
    // e num envelope comum (nao localizado) o Range tambem e outra identidade
    const idPlano = identidadeDeRequisicao('GET', 'https://origin/v.mp4', Buffer.alloc(0), {});
    const { manifesto: m5, arquivos: a5 } = montarReplay(new Map([[idPlano, [envelopeDe('inteiro')]]]), new Map());
    const { w: w5 } = sandbox(m5, async (u) => { const s = u instanceof Request ? u.url : String(u); const a = a5.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'da rede'); });
    expect(await (await w5.fetch('https://origin/v.mp4', { headers: { Range: 'bytes=0-0' } })).text()).toBe('da rede');
    expect(await (await w5.fetch('https://origin/v.mp4', { headers: { 'If-None-Match': '"e"' } })).text()).toBe('da rede');   // condicional: outro pedido
    expect(await (await w5.fetch('https://origin/v.mp4')).text()).toBe('inteiro');
    // com cabecalho de identidade, o mapa nao vale: miss
    const { w: w3 } = sandbox(manifesto, mock, { ...opts, proveniencias: { '_ext/cdn.example/avatar.258c7611.png': idFirst } });
    expect(await (await w3.fetch(`${ORIGEM}/api/runtime/tok/_ext/cdn.example/avatar.258c7611.png`, { headers: { 'x-a': '1' } })).text()).toBe('da rede');
  });

  // Astra B48: asset da PROPRIA origem com nome transformado — a URL reconstruida
  // (FONTE + caminho) batia no envelope de OUTRO pedido real.
  it('asset same-origin com query em hash: o caminho localizado acha o SEU envelope, e o do outro pedido fica intacto', async () => {
    const FONTE = 'https://origin';
    const idFirst = identidadeDeRequisicao('GET', `${FONTE}/avatar.png?v=1`, Buffer.alloc(0), {});
    const idOther = identidadeDeRequisicao('GET', `${FONTE}/avatar.258c7611.png`, Buffer.alloc(0), {});
    const { manifesto, arquivos } = montarReplay(new Map([[idFirst, [envelopeDe('FIRST')]], [idOther, [envelopeDe('OTHER')]]]), new Map());
    const mock = async (u) => { const s = u instanceof Request ? u.url : String(u); const a = arquivos.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'da rede'); };
    const opts = { entryPath: 'index.html', origemFonte: FONTE, href: `${ORIGEM}/api/runtime/tok/index.html` };
    const { w } = sandbox(manifesto, mock, { ...opts, proveniencias: mapaDeProveniencias(new Map([[`${FONTE}/avatar.png?v=1`, 'avatar.258c7611.png']])) });
    expect(await (await w.fetch(`${ORIGEM}/api/runtime/tok/avatar.258c7611.png`)).text()).toBe('FIRST');
    expect(await (await w.fetch(`${FONTE}/avatar.258c7611.png`)).text()).toBe('OTHER');   // intacto
    // e um caminho NATURAL (fora do mapa) segue pela URL na fonte, como antes
    const idPlain = identidadeDeRequisicao('GET', `${FONTE}/plain.json`, Buffer.alloc(0), {});
    const { manifesto: m2, arquivos: a2 } = montarReplay(new Map([[idPlain, [envelopeDe('plain')]]]), new Map());
    const { w: w2 } = sandbox(m2, async (u) => { const s = u instanceof Request ? u.url : String(u); const a = a2.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'da rede'); }, opts);
    expect(await (await w2.fetch(`${ORIGEM}/api/runtime/tok/plain.json`)).text()).toBe('plain');
  });

  it('asset localizado de URL percent-encoded acha o SEU envelope; o do caminho real fica intacto', async () => {
    const FONTE = 'https://origin';
    const idFirst = identidadeDeRequisicao('GET', `${FONTE}/items/a%2Fb`, Buffer.alloc(0), {});
    const idOther = identidadeDeRequisicao('GET', `${FONTE}/items/a/b`, Buffer.alloc(0), {});
    const { manifesto, arquivos } = montarReplay(new Map([[idFirst, [envelopeDe('FIRST')]], [idOther, [envelopeDe('OTHER')]]]), new Map());
    const mock = async (u) => { const s = u instanceof Request ? u.url : String(u); const a = arquivos.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'da rede'); };
    const opts = { entryPath: 'index.html', origemFonte: FONTE, href: `${ORIGEM}/api/runtime/tok/index.html` };
    const { w } = sandbox(manifesto, mock, { ...opts, proveniencias: mapaDeProveniencias(new Map([[`${FONTE}/items/a%2Fb`, 'items/a/b']])) });
    expect(await (await w.fetch(`${ORIGEM}/api/runtime/tok/items/a/b`)).text()).toBe('FIRST');
    expect(await (await w.fetch(`${FONTE}/items/a/b`)).text()).toBe('OTHER');
  });

  // Astra B50: `//items/a` localizado como items/a nao pode receber o envelope de /items/a.
  it('asset de URL com barra dupla acha o SEU envelope; o de /items/a fica intacto', async () => {
    const FONTE = 'https://origin';
    const idFirst = identidadeDeRequisicao('GET', `${FONTE}//items/a`, Buffer.alloc(0), {});
    const idOther = identidadeDeRequisicao('GET', `${FONTE}/items/a`, Buffer.alloc(0), {});
    const { manifesto, arquivos } = montarReplay(new Map([[idFirst, [envelopeDe('FIRST')]], [idOther, [envelopeDe('OTHER')]]]), new Map());
    const mock = async (u) => { const s = u instanceof Request ? u.url : String(u); const a = arquivos.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'da rede'); };
    const opts = { entryPath: 'index.html', origemFonte: FONTE, href: `${ORIGEM}/api/runtime/tok/index.html` };
    const { w } = sandbox(manifesto, mock, { ...opts, proveniencias: mapaDeProveniencias(new Map([[`${FONTE}//items/a`, 'items/a']])) });
    expect(await (await w.fetch(`${ORIGEM}/api/runtime/tok/items/a`)).text()).toBe('FIRST');
    expect(await (await w.fetch(`${FONTE}/items/a`)).text()).toBe('OTHER');
  });

  // Astra B51: '/api?' e '/api' sao URLs distintas; URL.search e '' nas duas.
  it('query vazia (/api?) preserva o delimitador na fonte e nao rouba o envelope de /api', async () => {
    const FONTE = 'https://origin';
    const idComQ = identidadeDeRequisicao('GET', `${FONTE}/api?`, Buffer.alloc(0), {});
    const idSemQ = identidadeDeRequisicao('GET', `${FONTE}/api`, Buffer.alloc(0), {});
    expect(idComQ).not.toBe(idSemQ);
    const { manifesto, arquivos } = montarReplay(new Map([[idComQ, [envelopeDe('FIRST')]], [idSemQ, [envelopeDe('OTHER')]]]), new Map());
    const mock = async (u) => { const s = u instanceof Request ? u.url : String(u); const a = arquivos.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'da rede'); };
    const { w } = sandbox(manifesto, mock, { entryPath: 'index.html', origemFonte: FONTE, href: `${ORIGEM}/index.html` });
    expect(await (await w.fetch(`${ORIGEM}/api?`)).text()).toBe('FIRST');
    expect(await (await w.fetch(`${FONTE}/api`)).text()).toBe('OTHER');
    // e num caminho localizado conhecido, um '?' vazio e miss (nao consome)
    const idLoc = identidadeDeRequisicao('GET', `${FONTE}/a.png?v=1`, Buffer.alloc(0), {});
    const { manifesto: m2, arquivos: a2 } = montarReplay(new Map([[idLoc, [envelopeDe('LOC')]]]), new Map());
    const { w: w2 } = sandbox(m2, async (u) => { const s = u instanceof Request ? u.url : String(u); const a = a2.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'da rede'); },
      { entryPath: 'index.html', origemFonte: FONTE, href: `${ORIGEM}/index.html`, proveniencias: mapaDeProveniencias(new Map([[`${FONTE}/a.png?v=1`, 'a.258c7611.png']])) });
    expect(await w2.fetch(`${ORIGEM}/a.258c7611.png?`).then((r) => r.text(), (e) => e.name)).toBe('TypeError');   // miss com query servido do pacote: recusa (Astra B146)
    expect(await (await w2.fetch(`${ORIGEM}/a.258c7611.png`)).text()).toBe('LOC');
  });

  // Astra B52: cabecalho de aplicacao (api-key) fora da identidade — B recebia a conta de A.
  it('api-key diferente e outro pedido: B nao recebe ACCOUNT_A nem consome a ocorrencia de A', async () => {
    const idA = identidadeDeRequisicao('GET', 'https://origin/account', Buffer.alloc(0), { 'api-key': 'A' });
    const idB = identidadeDeRequisicao('GET', 'https://origin/account', Buffer.alloc(0), { 'api-key': 'B' });
    expect(idA).not.toBe(idB);
    const { manifesto, arquivos } = montarReplay(new Map([[idA, [envelopeDe('ACCOUNT_A')]]]), new Map());
    const { w } = sandbox(manifesto, async (u) => { const s = u instanceof Request ? u.url : String(u); const a = arquivos.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'da rede'); });
    expect(await (await w.fetch('https://origin/account', { headers: { 'api-key': 'B' } })).text()).toBe('da rede');
    expect(await (await w.fetch('https://origin/account', { headers: { 'api-key': 'A' } })).text()).toBe('ACCOUNT_A');
  });

  // Astra B53: nome de cabecalho que existe em Object.prototype ('constructor') era lido
  // como excluido por heranca.
  it('cabecalho chamado "constructor" entra na identidade: nao consome o envelope do pedido sem cabecalhos', async () => {
    const idSem = identidadeDeRequisicao('GET', 'https://origin/dados', Buffer.alloc(0), {});
    expect(identidadeDeRequisicao('GET', 'https://origin/dados', Buffer.alloc(0), { constructor: 'B' })).not.toBe(idSem);
    const { manifesto, arquivos } = montarReplay(new Map([[idSem, [envelopeDe('SEM')]]]), new Map());
    const { w } = sandbox(manifesto, async (u) => { const s = u instanceof Request ? u.url : String(u); const a = arquivos.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'da rede'); });
    expect(await (await w.fetch('https://origin/dados', { headers: { constructor: 'B' } })).text()).toBe('da rede');
    expect(await (await w.fetch('https://origin/dados')).text()).toBe('SEM');
  });

  // Astra B54: caminho de asset "__proto__" — o literal de objeto do remendo o tratava
  // como prototipo e o caminho localizado caia na URL reconstruida (BARE, consumindo).
  it('asset chamado __proto__ acha o SEU envelope (QUERY) e o de /__proto__ (BARE) fica intacto', async () => {
    const FONTE = 'https://origin';
    const idQuery = identidadeDeRequisicao('GET', `${FONTE}/__proto__?`, Buffer.alloc(0), {});
    const idBare = identidadeDeRequisicao('GET', `${FONTE}/__proto__`, Buffer.alloc(0), {});
    const { manifesto, arquivos } = montarReplay(new Map([[idQuery, [envelopeDe('QUERY')]], [idBare, [envelopeDe('BARE')]]]), new Map());
    const mock = async (u) => { const s = u instanceof Request ? u.url : String(u); const a = arquivos.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'da rede'); };
    const { w } = sandbox(manifesto, mock, { entryPath: 'index.html', origemFonte: FONTE, href: `${ORIGEM}/api/runtime/tok/index.html`, proveniencias: mapaDeProveniencias(new Map([[`${FONTE}/__proto__?`, '__proto__']])) });
    expect(await (await w.fetch(`${ORIGEM}/api/runtime/tok/__proto__`)).text()).toBe('QUERY');
    expect(await (await w.fetch(`${FONTE}/__proto__`)).text()).toBe('BARE');
  });

  // Astra B55: a copia ESTATICA de uma resposta de fetch same-origin respondia a um miss de
  // identidade (api-key B recebia ACCOUNT_A pelo fallback).
  it('miss num caminho de asset vindo de fetch rejeita — nunca a copia estatica; hit e assets de markup seguem', async () => {
    const FONTE = 'https://origin';
    const idA = identidadeDeRequisicao('GET', `${FONTE}/account`, Buffer.alloc(0), { 'api-key': 'A' });
    const { manifesto, arquivos } = montarReplay(new Map([[idA, [envelopeDe('ACCOUNT_A')]]]), new Map());
    const mock = async (u) => { const s = u instanceof Request ? u.url : String(u); const a = arquivos.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'STATIC COPY'); };
    const { w } = sandbox(manifesto, mock, { entryPath: 'index.html', origemFonte: FONTE, href: `${ORIGEM}/api/runtime/tok/index.html`, caminhosDeFetch: ['account'] });
    await expect(w.fetch(`${ORIGEM}/api/runtime/tok/account`, { headers: { 'api-key': 'B' } })).rejects.toThrow('Failed to fetch');
    expect(await (await w.fetch(`${ORIGEM}/api/runtime/tok/account`, { headers: { 'api-key': 'A' } })).text()).toBe('ACCOUNT_A');
    // Astra B56: o atalho do multipart tambem passa pela guarda — B com cabecalho multipart rejeita
    let chamadas = 0;
    const { w: wm } = sandbox(manifesto, async (u) => { chamadas += 1; return mock(u); }, { entryPath: 'index.html', origemFonte: FONTE, href: `${ORIGEM}/api/runtime/tok/index.html`, caminhosDeFetch: ['account'] });
    await expect(wm.fetch(`${ORIGEM}/api/runtime/tok/account`, { headers: { 'api-key': 'B', 'content-type': 'multipart/form-data' } })).rejects.toThrow('Failed to fetch');
    expect(chamadas).toBe(0);
    // asset que NAO veio de fetch (markup): o miss segue para o arquivo estatico
    expect(await (await w.fetch(`${ORIGEM}/api/runtime/tok/logo.png`)).text()).toBe('STATIC COPY');
  });

  // Astra B58: captura so de XHR => manifesto vazio => sem remendo => a copia estatica
  // respondia a um fetch de outra identidade.
  it('manifesto vazio com caminho protegido: fetch com outra identidade rejeita, nunca a copia estatica', async () => {
    let n = 0;
    const { w } = sandbox({}, async () => { n += 1; return new Response('ACCOUNT_A (estatico)'); }, { entryPath: 'index.html', origemFonte: 'https://origin', href: `${ORIGEM}/api/runtime/tok/index.html`, caminhosDeFetch: ['account'] });
    await expect(w.fetch(`${ORIGEM}/api/runtime/tok/account`, { headers: { 'api-key': 'B' } })).rejects.toThrow('Failed to fetch');
    expect(n).toBe(0);
    // asset nao protegido segue caindo no estatico
    expect(await (await w.fetch(`${ORIGEM}/api/runtime/tok/logo.png`)).text()).toBe('ACCOUNT_A (estatico)');
  });

  // Astra B59: a URL de diretorio da raiz (sufixo vazio) e o alias da entrada no gateway;
  // a protecao nao a reconhecia e a entrada protegida respondia a outra identidade.
  it('a entrada protegida tambem rejeita outra identidade pelo alias de diretorio', async () => {
    const FONTE = 'https://origin';
    const idA = identidadeDeRequisicao('GET', `${FONTE}/`, Buffer.alloc(0), { 'api-key': 'A' });
    const { manifesto, arquivos } = montarReplay(new Map([[idA, [envelopeDe('ENTRY_A')]]]), new Map());
    let chamadas = 0;
    const mock = async (u) => { chamadas += 1; const s = u instanceof Request ? u.url : String(u); const a = arquivos.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'ENTRY_A (estatico)'); };
    const { w } = sandbox(manifesto, mock, { entryPath: 'index.html', origemFonte: FONTE, href: `${ORIGEM}/api/runtime/tok/index.html`, caminhosDeFetch: ['index.html'] });
    await expect(w.fetch(`${ORIGEM}/api/runtime/tok/index.html`, { headers: { 'api-key': 'B' } })).rejects.toThrow('Failed to fetch');
    await expect(w.fetch(`${ORIGEM}/api/runtime/tok/`, { headers: { 'api-key': 'B' } })).rejects.toThrow('Failed to fetch');
    await expect(w.fetch(`${ORIGEM}/api/runtime/tok/?x=1`, { headers: { 'api-key': 'B' } })).rejects.toThrow('Failed to fetch');
    expect(chamadas).toBe(0);
    expect(await (await w.fetch(`${ORIGEM}/api/runtime/tok/`, { headers: { 'api-key': 'A' } })).text()).toBe('ENTRY_A');
  });

  // Astra B60: o servidor canonicaliza a barra final por redirect e o fetch nativo o segue
  // sem voltar ao remendo — `index.html/` alcancava a copia estatica protegida.
  it('a barra final (canonicalizada pelo servidor) tambem e resolvida antes da guarda', async () => {
    const FONTE = 'https://origin';
    const idA = identidadeDeRequisicao('GET', `${FONTE}/`, Buffer.alloc(0), { 'api-key': 'A' });
    const { manifesto, arquivos } = montarReplay(new Map([[idA, [envelopeDe('ENTRY_A')]]]), new Map());
    let chamadas = 0;
    const mock = async (u) => { chamadas += 1; const s = u instanceof Request ? u.url : String(u); const a = arquivos.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'ESTATICO'); };
    const { w } = sandbox(manifesto, mock, { entryPath: 'index.html', origemFonte: FONTE, href: `${ORIGEM}/api/runtime/tok/index.html`, caminhosDeFetch: ['index.html', 'account'] });
    await expect(w.fetch(`${ORIGEM}/api/runtime/tok/index.html/`, { headers: { 'api-key': 'B' } })).rejects.toThrow('Failed to fetch');
    await expect(w.fetch(`${ORIGEM}/api/runtime/tok/index.html/?x=1`, { headers: { 'api-key': 'B' } })).rejects.toThrow('Failed to fetch');
    await expect(w.fetch(`${ORIGEM}/api/runtime/tok/account/`, { headers: { 'api-key': 'B' } })).rejects.toThrow('Failed to fetch');
    expect(chamadas).toBe(0);
    // a ocorrencia de A segue intacta
    expect(await (await w.fetch(`${ORIGEM}/api/runtime/tok/`, { headers: { 'api-key': 'A' } })).text()).toBe('ENTRY_A');
    // asset nao protegido com barra final segue ao original (o servidor decide o redirect)
    expect(await (await w.fetch(`${ORIGEM}/api/runtime/tok/logo.png/`)).text()).toBe('ESTATICO');
  });

  // Astra B61: o Next colapsa barras repetidas no pathname inteiro por redirect, seguido pelo
  // fetch nativo sem voltar ao remendo — `//account`, `account//` e `runtime//tok` alcancavam
  // a copia estatica protegida.
  it('barras repetidas (no prefixo ou no asset) sao colapsadas antes da guarda; a identidade segue crua', async () => {
    const FONTE = 'https://origin';
    const idA = identidadeDeRequisicao('GET', `${FONTE}/account`, Buffer.alloc(0), { 'api-key': 'A' });
    const { manifesto, arquivos } = montarReplay(new Map([[idA, [envelopeDe('ACCOUNT_A')]]]), new Map());
    let chamadas = 0;
    const mock = async (u) => { chamadas += 1; const s = u instanceof Request ? u.url : String(u); const a = arquivos.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'ESTATICO'); };
    const { w } = sandbox(manifesto, mock, { entryPath: 'index.html', origemFonte: FONTE, href: `${ORIGEM}/api/runtime/tok/index.html`, caminhosDeFetch: ['account', 'index.html'] });
    for (const alias of ['/api/runtime/tok//account', '/api/runtime/tok/account//', '/api/runtime//tok/account', '/api//runtime/tok//account//', '/api/runtime/tok//account?x=1', '/api/runtime/tok///']) {
      await expect(w.fetch(`${ORIGEM}${alias}`, { headers: { 'api-key': 'B' } }), alias).rejects.toThrow('Failed to fetch');
    }
    expect(chamadas).toBe(0);
    // a identidade NAO colapsa (B51): `//account` com A e OUTRO pedido na fonte — miss protegido, sem consumir
    await expect(w.fetch(`${ORIGEM}/api/runtime/tok//account`, { headers: { 'api-key': 'A' } })).rejects.toThrow('Failed to fetch');
    expect(chamadas).toBe(0);
    // a ocorrencia de A segue intacta no caminho canonico
    expect(await (await w.fetch(`${ORIGEM}/api/runtime/tok/account`, { headers: { 'api-key': 'A' } })).text()).toBe('ACCOUNT_A');
    // asset nao protegido com barras repetidas segue ao original
    expect(await (await w.fetch(`${ORIGEM}/api/runtime/tok//logo.png`)).text()).toBe('ESTATICO');
  });

  // Astra B62: a mesma classe sobre a PROVENIENCIA — alias com barras repetidas/barra final de
  // um asset `_ext/` capturado so por markup nao era classificado como externo, ia ao fetch
  // original NA ORIGEM DO CLONE, o redirect do Next entregava a copia local LEGIVEL (B41 reaberto).
  it('aliases de um asset _ext/ (so markup) sao externos: rede pela origem externa, nunca a copia local; identidade crua, ocorrencia canonica intacta', async () => {
    const FONTE = 'https://origin';
    const idX = identidadeDeRequisicao('GET', 'https://cdn.example/avatar.png', Buffer.alloc(0), {});
    const { manifesto, arquivos } = montarReplay(new Map([[idX, [envelopeDe('AVATAR')]]]), new Map());
    const chamadas = [];
    const mock = async (u) => { const s = u instanceof Request ? u.url : String(u); chamadas.push(s); const a = arquivos.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'COPIA LOCAL'); };
    const { w } = sandbox(manifesto, mock, { entryPath: 'index.html', origemFonte: FONTE, href: `${ORIGEM}/api/runtime/tok/index.html`, proveniencias: { '_ext/cdn.example/avatar.png': idX } });
    const aliases = ['/api/runtime/tok//_ext/cdn.example/avatar.png', '/api/runtime//tok/_ext/cdn.example/avatar.png', '/api/runtime/tok/_ext/cdn.example/avatar.png/', '/api//runtime/tok/_ext//cdn.example//avatar.png'];
    for (const alias of aliases) {
      await w.fetch(`${ORIGEM}${alias}`, { mode: 'no-cors' });
      // a chamada a rede saiu pela ORIGEM EXTERNA (o mock so distingue pela URL), nunca pela origem do clone
      expect(chamadas[chamadas.length - 1], alias).toMatch(/^https:\/\/cdn\.example\//);
    }
    expect(chamadas.length).toBe(aliases.length);
    // 'same-origin' para os aliases falha como falha o canonico (B16/B41)
    for (const alias of aliases) await expect(w.fetch(`${ORIGEM}${alias}`, { mode: 'same-origin' }), alias).rejects.toThrow('Failed to fetch');
    expect(chamadas.length).toBe(aliases.length);
    // a ocorrencia CANONICA nao foi consumida pelos aliases: o caminho canonico recebe o envelope
    expect(await (await w.fetch(`${ORIGEM}/api/runtime/tok/_ext/cdn.example/avatar.png`)).text()).toBe('AVATAR');
  });

  // Astra B63: alias de caminho localizado SAME-ORIGIN (nome transformado) nao era "conhecido"
  // e caia na URL reconstruida — ficticia — que podia casar o envelope de OUTRO pedido real
  // da fonte e consumir a ocorrencia dele (B48 reaberto).
  it('alias de caminho localizado conhecido e miss sem consumir: nunca casa o envelope de outro pedido pela URL reconstruida', async () => {
    const FONTE = 'https://origin';
    const idF = identidadeDeRequisicao('GET', `${FONTE}/avatar.png?v=1`, Buffer.alloc(0), {});
    const idO = identidadeDeRequisicao('GET', `${FONTE}/avatar.258c7611.png/`, Buffer.alloc(0), {});
    const { manifesto, arquivos } = montarReplay(new Map([[idF, [envelopeDe('FIRST')]], [idO, [envelopeDe('OTHER')]]]), new Map());
    let chamadas = 0;
    const mock = async (u) => { chamadas += 1; const s = u instanceof Request ? u.url : String(u); const a = arquivos.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'ESTATICO'); };
    const { w } = sandbox(manifesto, mock, { entryPath: 'index.html', origemFonte: FONTE, href: `${ORIGEM}/api/runtime/tok/index.html`, proveniencias: { 'avatar.258c7611.png': idF } });
    // o alias com barra final e um caminho conhecido: miss (asset de markup => estatico), nunca OTHER
    expect(await (await w.fetch(`${ORIGEM}/api/runtime/tok/avatar.258c7611.png/`)).text()).toBe('ESTATICO');
    expect(await (await w.fetch(`${ORIGEM}/api/runtime/tok//avatar.258c7611.png`)).text()).toBe('ESTATICO');
    expect(chamadas).toBe(2);
    // nenhuma ocorrencia consumida: o canonico recebe FIRST e o pedido real da fonte recebe OTHER
    expect(await (await w.fetch(`${ORIGEM}/api/runtime/tok/avatar.258c7611.png`)).text()).toBe('FIRST');
    expect(await (await w.fetch(`${FONTE}/avatar.258c7611.png/`)).text()).toBe('OTHER');
  });

  // Astra B64: o caminho reservado era classificado pelo sufixo CRU — '%5freplay/<id>' (que o
  // gateway serve como '_replay/<id>') virava URL da fonte reconstruida e casava o envelope de
  // um pedido real 'https://origin/%5freplay/<id>', consumindo a ocorrencia dele.
  it('alias codificado de caminho reservado e arquivo do pacote: nunca casa envelope da fonte nem consome ocorrencia', async () => {
    const FONTE = 'https://origin';
    const idF = identidadeDeRequisicao('GET', `${FONTE}/dados`, Buffer.alloc(0), {});
    const idO = identidadeDeRequisicao('GET', `${FONTE}/%5freplay/${idF}`, Buffer.alloc(0), {});
    const { manifesto, arquivos } = montarReplay(new Map([[idF, [envelopeDe('FIRST')]], [idO, [envelopeDe('OTHER')]]]), new Map());
    const chamadas = [];
    const mock = async (u) => { const s = u instanceof Request ? u.url : String(u); chamadas.push(s); const a = arquivos.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'ESTATICO'); };
    const { w } = sandbox(manifesto, mock, { entryPath: 'index.html', origemFonte: FONTE, href: `${ORIGEM}/api/runtime/tok/index.html` });
    for (const alias of [`/api/runtime/tok/%5freplay/${idF}`, `/api/runtime/tok//_replay/${idF}`, `/api/runtime/tok/_replay%2f${idF}`]) {
      const texto = await (await w.fetch(`${ORIGEM}${alias}`)).text();
      expect(texto, alias).not.toBe('OTHER');
      expect(chamadas[chamadas.length - 1], alias).toMatch(new RegExp('^' + ORIGEM.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/'));   // foi ao pacote, nao a fonte
    }
    // a ocorrencia de OTHER segue disponivel para o pedido REAL da fonte
    expect(await (await w.fetch(`${FONTE}/%5freplay/${idF}`)).text()).toBe('OTHER');
  });

  // Astra B65: barras repetidas no PREFIXO ('runtime//tok/_replay/<id>') faziam o sufixo cru
  // sair nulo, a checagem de reservado nunca rodava e o fallback reconstruia
  // 'https://origin/api/runtime//tok/_replay/<id>' — que casava o envelope de um pedido real.
  it('alias com barras repetidas no prefixo de um caminho reservado e arquivo do pacote: nunca casa envelope da fonte', async () => {
    const FONTE = 'https://origin';
    const idF = identidadeDeRequisicao('GET', `${FONTE}/dados`, Buffer.alloc(0), {});
    const idO = identidadeDeRequisicao('GET', `${FONTE}/api/runtime//tok/_replay/${idF}`, Buffer.alloc(0), {});
    const { manifesto, arquivos } = montarReplay(new Map([[idF, [envelopeDe('FIRST')]], [idO, [envelopeDe('OTHER')]]]), new Map());
    const chamadas = [];
    const mock = async (u) => { const s = u instanceof Request ? u.url : String(u); chamadas.push(s); const a = arquivos.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'ESTATICO'); };
    const { w } = sandbox(manifesto, mock, { entryPath: 'index.html', origemFonte: FONTE, href: `${ORIGEM}/api/runtime/tok/index.html` });
    const texto = await (await w.fetch(`${ORIGEM}/api/runtime//tok/_replay/${idF}`)).text();
    expect(texto).not.toBe('OTHER');
    expect(chamadas.length).toBe(1);
    expect(chamadas[0].startsWith(`${ORIGEM}/`)).toBe(true);   // foi ao pacote, nao a fonte
    expect(await (await w.fetch(`${FONTE}/api/runtime//tok/_replay/${idF}`)).text()).toBe('OTHER');
  });

  // Astra B75: 'no-cors' com redirect 'manual'/'error' para OUTRA origem rejeita no nativo antes
  // de criar pedido algum (medido em Chromium) — a captura nem anuncia, logo nao ha ocorrencia
  // para essa chamada; o remendo alocava a ocorrencia ANTES de decidir e consumia o MAIN da
  // chamada legitima seguinte.
  it("'no-cors' com redirect != 'follow' para outra origem rejeita SEM consumir ocorrencia; a chamada legitima seguinte recebe o envelope", async () => {
    const U = 'https://cdn.example/api';
    const idU = identidadeDeRequisicao('GET', U, Buffer.alloc(0), {});
    const { manifesto, arquivos } = montarReplay(new Map([[idU, [envelopeDe('MAIN')]]]), new Map());
    let chamadas = 0;
    const mock = async (u) => { chamadas += 1; const s = u instanceof Request ? u.url : String(u); const a = arquivos.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'LIVE NETWORK'); };
    const { w } = sandbox(manifesto, mock, { entryPath: 'index.html', origemFonte: 'https://origin', href: `${ORIGEM}/api/runtime/tok/index.html` });
    await expect(w.fetch(U, { mode: 'no-cors', redirect: 'manual' })).rejects.toThrow();
    await expect(w.fetch(U, { mode: 'no-cors', redirect: 'error' })).rejects.toThrow();
    expect(chamadas).toBe(0);   // nada foi ao original
    expect(await (await w.fetch(U)).text()).toBe('MAIN');   // a ocorrencia nao foi consumida
  });

  // Astra B76: a captura hasheia a URL SEM fragmento (o Playwright o tira); no navegador
  // Request.url o mantem e a URL alheia passava intacta a identidade — 'U#first' era miss
  // sem consumir e a chamada seguinte a 'U' recebia FIRST em vez de SECOND.
  it('fragmento nao entra na identidade: U#first e U consomem [FIRST, SECOND] na ordem, sem rede', async () => {
    const U = 'https://cdn.example/api?q=1&x=%23';
    const idU = identidadeDeRequisicao('GET', U, Buffer.alloc(0), {});
    const { manifesto, arquivos } = montarReplay(new Map([[idU, [envelopeDe('FIRST'), envelopeDe('SECOND')]]]), new Map());
    const chamadas = [];
    const mock = async (u) => { const s = u instanceof Request ? u.url : String(u); chamadas.push(s); const a = arquivos.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'LIVE NETWORK'); };
    const { w } = sandbox(manifesto, mock, { entryPath: 'index.html', origemFonte: 'https://origin', href: `${ORIGEM}/api/runtime/tok/index.html` });
    expect(await (await w.fetch(`${U}#first`)).text()).toBe('FIRST');
    expect(await (await w.fetch(U)).text()).toBe('SECOND');
    // o original so foi chamado para LER os envelopes do pacote — nunca a rede viva
    expect(chamadas.every((s) => s.includes('/_replay/'))).toBe(true);
    expect(chamadas.length).toBe(2);
    // same-origin sob a raiz tambem (a query com '%23' codificado fica intacta)
    const idV = identidadeDeRequisicao('GET', 'https://origin/dados?x=%23', Buffer.alloc(0), {});
    const { manifesto: m2, arquivos: a2 } = montarReplay(new Map([[idV, [envelopeDe('V')]]]), new Map());
    const { w: w2 } = sandbox(m2, async (u) => { const s = u instanceof Request ? u.url : String(u); const a = a2.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'LIVE NETWORK'); }, { entryPath: 'index.html', origemFonte: 'https://origin', href: `${ORIGEM}/api/runtime/tok/index.html` });
    expect(await (await w2.fetch(`${ORIGEM}/api/runtime/tok/dados?x=%23#frag`)).text()).toBe('V');
  });

  // Astra B77: a RELOCACAO muda o que e "mesma origem" — uma URL ABSOLUTA da fonte construida
  // em codigo (sobrevive a reescrita) era same-origin na fonte e e cross-origin no clone. As
  // rejeicoes pre-despacho ('same-origin', 'no-cors'+redirect) tem que seguir a semantica da
  // FONTE (foi la que a captura decidiu se havia ocorrencia); so a rede fisica olha o clone.
  it('URL absoluta da fonte com mode same-origin replaya a ocorrencia (semantica da fonte), e a seguinte recebe a sua', async () => {
    const FONTE = 'https://origin';
    const U = `${FONTE}/api`;
    const idU = identidadeDeRequisicao('GET', U, Buffer.alloc(0), {});
    // a captura anuncia o modo (Astra B131): o same-origin tem identidade propria
    const idSO = identidadeDeRequisicao('GET', U, Buffer.alloc(0), {}, { mode: 'same-origin' });
    const { manifesto, arquivos } = montarReplay(new Map([[idSO, [envelopeDe('FIRST')]], [idU, [envelopeDe('SECOND')]]]), new Map());
    const chamadas = [];
    const mock = async (u) => { const s = u instanceof Request ? u.url : String(u); chamadas.push(s); const a = arquivos.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'LIVE NETWORK'); };
    const { w } = sandbox(manifesto, mock, { entryPath: 'index.html', origemFonte: FONTE, href: `${ORIGEM}/api/runtime/tok/index.html` });
    expect(await (await w.fetch(U, { mode: 'same-origin' })).text()).toBe('FIRST');
    expect(await (await w.fetch(U)).text()).toBe('SECOND');
    expect(chamadas.every((s) => s.includes('/_replay/'))).toBe(true);
    // e uma origem REALMENTE alheia com mode same-origin segue rejeitando sem consumir (B16)
    const idX = identidadeDeRequisicao('GET', 'https://cdn.example/x', Buffer.alloc(0), {});
    const { manifesto: m2, arquivos: a2 } = montarReplay(new Map([[idX, [envelopeDe('X')]]]), new Map());
    const { w: w2 } = sandbox(m2, async (u) => { const s = u instanceof Request ? u.url : String(u); const a = a2.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'LIVE NETWORK'); }, { entryPath: 'index.html', origemFonte: FONTE, href: `${ORIGEM}/api/runtime/tok/index.html` });
    await expect(w2.fetch('https://cdn.example/x', { mode: 'same-origin' })).rejects.toThrow('Failed to fetch');
    expect(await (await w2.fetch('https://cdn.example/x')).text()).toBe('X');
  });

  // Astra B78: asset de OUTRO ESQUEMA no mesmo host (pagina http, imagem https) ganhava caminho
  // natural sem proveniencia; o remendo reconstruia `http://host/avatar.png` e servia (e consumia)
  // o envelope de um pedido REAL http com esse pathname.
  it('asset https numa pagina http nunca recebe nem consome o envelope do pedido http de mesmo pathname', async () => {
    const FONTE = 'http://origin.example';
    const HTTPS = 'https://origin.example/avatar.png';
    const HTTP = 'http://origin.example/avatar.png';
    const idHttps = identidadeDeRequisicao('GET', HTTPS, Buffer.alloc(0), {});
    const idHttp = identidadeDeRequisicao('GET', HTTP, Buffer.alloc(0), {});
    const { manifesto, arquivos } = montarReplay(new Map([
      [idHttps, [{ opaco: true, url: HTTPS, status: 200, statusText: '', headers: {}, contentType: '', bytes: Buffer.alloc(0) }]],
      [idHttp, [envelopeDe('HTTP_ONLY')]],
    ]), new Map());
    const chamadas = [];
    const mock = async (u) => { const s = u instanceof Request ? u.url : String(u); chamadas.push(s); const a = arquivos.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'ESTATICO'); };
    const proveniencias = mapaDeProveniencias(new Map([[HTTPS, 'avatar.png']]), FONTE);
    const { w } = sandbox(manifesto, mock, { entryPath: 'index.html', origemFonte: FONTE, href: `${ORIGEM}/api/runtime/tok/index.html`, proveniencias });
    const r1 = await w.fetch(`${ORIGEM}/api/runtime/tok/avatar.png`, { mode: 'no-cors' });
    expect(await r1.text()).not.toBe('HTTP_ONLY');   // ocorrencia opaca => miss (estatico), nunca o envelope http
    expect(await (await w.fetch(HTTP)).text()).toBe('HTTP_ONLY');   // o pedido http REAL ainda tem a sua ocorrencia
  });

  // Astra B79: asset de OUTRA origem com caminho natural, capturado SO por markup (sem envelope,
  // sem caminho de fetch): o miss lia a copia local LEGIVEL do que ao vivo era opaco (no-cors)
  // ou recusado (same-origin). A marca de origem alheia classifica-o como externo.
  it('asset de outra origem com caminho natural, so markup: no-cors vai a rede pela URL ORIGINAL (nunca a copia local); same-origin rejeita', async () => {
    const FONTE = 'http://origin.example';
    const HTTPS = 'https://origin.example/avatar.png';
    const mapa = new Map([[HTTPS, 'avatar.png']]);
    const chamadas = [];
    const mock = async (u) => { const s = u instanceof Request ? u.url : String(u); chamadas.push(s); return new Response('HTTPS_IMAGE_BYTES'); };
    const opts = { entryPath: 'index.html', origemFonte: FONTE, href: `${ORIGEM}/api/runtime/tok/index.html`, proveniencias: mapaDeProveniencias(mapa, FONTE), origensAlheias: origensAlheias(mapa, FONTE) };
    expect(Object.keys(opts.origensAlheias)).toEqual(['avatar.png']);
    expect(runtimeFetchShim({}, { origensAlheias: opts.origensAlheias })).toContain('data-uncraft-runtime-fetch-map');   // emite mesmo sem envelope
    const { w } = sandbox({}, mock, opts);
    await w.fetch(`${ORIGEM}/api/runtime/tok/avatar.png`, { mode: 'no-cors' });
    expect(chamadas).toEqual([HTTPS]);   // a rede foi a URL ORIGINAL (https), nunca a copia local do clone
    await expect(w.fetch(`${ORIGEM}/api/runtime/tok/avatar.png`, { mode: 'same-origin' })).rejects.toThrow('Failed to fetch');
    expect(chamadas.length).toBe(1);
    // e com query no pedido do clone, a rede vai a URL original com ESSA query (outra URL, B45)
    await w.fetch(`${ORIGEM}/api/runtime/tok/avatar.png?v=2`, { mode: 'no-cors' });
    expect(chamadas[1]).toBe(`${HTTPS}?v=2`);
  });

  // Astra B90: trim() Unicode fazia 'A\u00a0' casar o envelope de 'A' — falso hit que ainda
  // consumia a ocorrencia. So espaco HTTP e aparado, nos dois lados.
  it('NBSP no cabecalho e outra identidade: nao recebe nem consome o envelope de A; espaco HTTP nas pontas ainda casa', async () => {
    const FONTE = 'https://origin';
    const idA = identidadeDeRequisicao('GET', `${FONTE}/account`, Buffer.alloc(0), { 'api-key': 'A' });
    const { manifesto, arquivos } = montarReplay(new Map([[idA, [envelopeDe('ACCOUNT_A')]]]), new Map());
    const mock = async (u) => { const s = u instanceof Request ? u.url : String(u); const a = arquivos.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'ESTATICO'); };
    const { w } = sandbox(manifesto, mock, { entryPath: 'index.html', origemFonte: FONTE, href: `${ORIGEM}/api/runtime/tok/index.html`, caminhosDeFetch: ['account'] });
    await expect(w.fetch(`${ORIGEM}/api/runtime/tok/account`, { headers: { 'api-key': 'A\u00a0' } })).rejects.toThrow('Failed to fetch');
    expect(await (await w.fetch(`${ORIGEM}/api/runtime/tok/account`, { headers: { 'api-key': ' A\t' } })).text()).toBe('ACCOUNT_A');   // espaco HTTP aparado: e A
  });

  // Astra B91: Access-Control-Expose-Headers com um elemento MALFORMADO (NBSP no fim) — o
  // Chromium rejeita a lista inteira e nao expoe nada alem do safelisted; o filtro apagava o
  // NBSP com trim() Unicode e publicava o cabecalho escondido.
  it('lista de exposicao malformada nao expoe nada; lista valida expoe; nomes sao tokens HTTP', async () => {
    const base = { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*', 'X-Secret': 'HIDDEN_TOKEN' };
    expect(cabecalhosDeReplay({ ...base, 'Access-Control-Expose-Headers': 'X-Secret\u00a0' }, { mesmaOrigem: false })['x-secret']).toBeUndefined();
    expect(cabecalhosDeReplay({ ...base, 'Access-Control-Expose-Headers': 'X-Secret, Bad Name' }, { mesmaOrigem: false })['x-secret']).toBeUndefined();
    expect(cabecalhosDeReplay({ ...base, 'Access-Control-Expose-Headers': ' X-Secret ,' }, { mesmaOrigem: false })['x-secret']).toBe('HIDDEN_TOKEN');   // espaco HTTP e elemento vazio sao tolerados
    // nativo-vs-replay: a Response construida pelo remendo tambem nao carrega o cabecalho
    const U = 'https://cdn.example/secret';
    const idU = identidadeDeRequisicao('GET', U, Buffer.alloc(0), {});
    const ruim = { ...envelopeDe('S'), headers: cabecalhosDeReplay({ ...base, 'Access-Control-Expose-Headers': 'X-Secret\u00a0' }, { mesmaOrigem: false }), externo: true };
    const bom = { ...envelopeDe('S'), headers: cabecalhosDeReplay({ ...base, 'Access-Control-Expose-Headers': 'X-Secret' }, { mesmaOrigem: false }), externo: true };
    const { manifesto, arquivos } = montarReplay(new Map([[idU, [ruim, bom]]]), new Map());
    const mock = async (u) => { const s = u instanceof Request ? u.url : String(u); const a = arquivos.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'LIVE'); };
    const { w } = sandbox(manifesto, mock, { entryPath: 'index.html', origemFonte: 'https://origin', href: `${ORIGEM}/api/runtime/tok/index.html` });
    expect((await w.fetch(U)).headers.get('x-secret')).toBeNull();
    expect((await w.fetch(U)).headers.get('x-secret')).toBe('HIDDEN_TOKEN');
  });

  // Astra B97: o pedido do REPLAY pode exigir um preflight que a captura nunca viu (corpo em
  // fluxo). Permissao do terminal (corsCredenciado) != preflight credenciado verificado.
  it("replay 'include' em fluxo nunca e servido, nem com preflight credenciado verificado; o corpo pronto e", async () => {
    const U = 'https://api.example/post';
    const ct = { 'content-type': 'text/plain' };
    const idU = identidadeDeRequisicao('POST', U, Buffer.alloc(0), ct, 'include');
    const semVerificacao = { ...envelopeDe('PRE_PAYLOAD'), externo: true, corsCredenciado: true };
    const verificado = { ...envelopeDe('PRE_PAYLOAD'), externo: true, corsCredenciado: true, preflightCredenciado: true, preflightCabecalhos: [] };
    const { manifesto, arquivos } = montarReplay(new Map([[idU, [semVerificacao, semVerificacao, verificado]]]), new Map());
    let rede = 0;
    const mock = async (u) => { const s = u instanceof Request ? u.url : String(u); const a = arquivos.find((x) => s.endsWith(x.path)); if (!a) rede += 1; return new Response(a ? a.body : 'LIVE'); };
    const { w } = sandbox(manifesto, mock, { entryPath: 'index.html', origemFonte: 'https://origin', href: `${ORIGEM}/api/runtime/tok/index.html` });
    const fluxo = () => new ReadableStream({ start(c) { c.close(); } });
    // 1a ocorrencia: corpo em fluxo + include, sem verificacao => rejeita SEM consumir? (o nativo rejeita no preflight, antes da rede)
    await expect(w.fetch(U, { method: 'POST', body: fluxo(), duplex: 'half', headers: ct, credentials: 'include' })).rejects.toThrow('Failed to fetch');
    // corpo simples + include: sem preflight => servido (permissao do terminal basta)
    expect(await (await w.fetch(U, { method: 'POST', body: '', headers: ct, credentials: 'include' })).text()).toBe('PRE_PAYLOAD');
    expect(rede).toBe(0);
    // CONTROLE POSITIVO: a mesma chamada em fluxo + include contra a ocorrencia VERIFICADA e servida
    // (prova que a lane de fluxo hasheia e casa — sem isto, "rejeita" seria zero sem controle)
    await expect(w.fetch(U, { method: 'POST', body: fluxo(), duplex: 'half', headers: ct, credentials: 'include' })).rejects.toThrow('Failed to fetch');   // Astra B141: fluxo nunca recebe envelope
    expect(rede).toBe(0);
  });

  // Astra B98: corpo em fluxo HERDADO de um Request de entrada, com init presente mas sem
  // `body` — herda o fluxo, exige preflight, tem que rejeitar sem ler envelope nenhum.
  it('Request de entrada com corpo em fluxo + init sem body: herda o fluxo e rejeita include sem preflight verificado, zero leituras de envelope', async () => {
    const U = 'https://api.example/post';
    const ct = { 'content-type': 'text/plain' };
    const idU = identidadeDeRequisicao('POST', U, Buffer.alloc(0), ct);
    const terminalApenas = { ...envelopeDe('PRE_PAYLOAD'), externo: true, corsCredenciado: true };
    const { manifesto, arquivos } = montarReplay(new Map([[idU, [terminalApenas]]]), new Map());
    const chamadas = [];
    const mock = async (u) => { const s = u instanceof Request ? u.url : String(u); chamadas.push(s); const a = arquivos.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'LIVE'); };
    const { w } = sandbox(manifesto, mock, { entryPath: 'index.html', origemFonte: 'https://origin', href: `${ORIGEM}/api/runtime/tok/index.html` });
    const pedido = new Request(U, { method: 'POST', headers: ct, body: new ReadableStream({ start(c) { c.close(); } }), duplex: 'half', credentials: 'include' });
    await expect(w.fetch(pedido, { credentials: 'include' })).rejects.toThrow('Failed to fetch');
    expect(chamadas).toEqual([]);   // nenhuma leitura de envelope, nenhuma rede
    // `body: null` no init NAO remove o corpo herdado (construtor do Request): o fluxo segue, e rejeita igual
    const pedido2 = new Request(U, { method: 'POST', headers: ct, body: new ReadableStream({ start(c) { c.close(); } }), duplex: 'half', credentials: 'include' });
    await expect(w.fetch(pedido2, { credentials: 'include', body: null })).rejects.toThrow('Failed to fetch');
    expect(chamadas).toEqual([]);
    // Astra B99: a proveniencia do corpo e anotada NA conversao que constroi o Request; o init
    // do chamador NUNCA e relido depois de a chamada retornar (um getter regista a fase de cada
    // leitura), e mutar init.body depois nao muda a decisao. Nota de instrumento: neste sandbox
    // a decisao do include acontece ainda durante a chamada, entao o remendo ANTERIOR tambem
    // rejeitava esta sequencia — o vermelho da Astra veio de um harness com lacuna assincrona;
    // o que este teste PROVA e a ausencia de leitura tardia, que e a propriedade que fecha a classe.
    let fase = 'durante-a-chamada'; const leituras = [];
    const fluxo2 = new ReadableStream({ start(c) { c.close(); } });
    const init = { method: 'POST', headers: ct, credentials: 'include', duplex: 'half', get body() { leituras.push(fase); return fase === 'durante-a-chamada' ? fluxo2 : ''; } };
    const pendente = w.fetch(U, init);
    fase = 'depois-do-retorno';
    await expect(pendente).rejects.toThrow('Failed to fetch');
    expect(chamadas).toEqual([]);
    expect(leituras.length).toBeGreaterThan(0);
    expect(leituras.every((f) => f === 'durante-a-chamada')).toBe(true);   // nenhuma releitura tardia do init
  });

  // Astra B100: init CALLABLE (funcao com propriedades) e um dicionario valido para o Request;
  // sem o Proxy sobre funcoes a proveniencia nao era anotada e o replay em fluxo era servido.
  it('init como funcao com propriedades: proveniencia anotada — fluxo + include nunca e servido', async () => {
    const U = 'https://api.example/post';
    const ct = { 'content-type': 'text/plain' };
    const idU = identidadeDeRequisicao('POST', U, Buffer.alloc(0), ct, 'include');
    const terminalApenas = { ...envelopeDe('PRE_PAYLOAD'), externo: true, corsCredenciado: true };
    const verificado = { ...envelopeDe('PRE_PAYLOAD'), externo: true, corsCredenciado: true, preflightCredenciado: true, preflightCabecalhos: [] };
    const { manifesto, arquivos } = montarReplay(new Map([[idU, [terminalApenas, verificado]]]), new Map());
    const chamadas = [];
    const mock = async (u) => { const s = u instanceof Request ? u.url : String(u); chamadas.push(s); const a = arquivos.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'LIVE'); };
    const { w } = sandbox(manifesto, mock, { entryPath: 'index.html', origemFonte: 'https://origin', href: `${ORIGEM}/api/runtime/tok/index.html` });
    const initFn = () => Object.assign(function () {}, { method: 'POST', body: new ReadableStream({ start(c) { c.close(); } }), duplex: 'half', headers: ct, credentials: 'include' });
    await expect(w.fetch(U, initFn())).rejects.toThrow('Failed to fetch');   // 1a ocorrencia so-terminal: rejeita sem consumir? o nativo rejeita no preflight
    expect(chamadas).toEqual([]);
    // controle positivo: o mesmo init-funcao contra a ocorrencia verificada e servido
    // (a 1a ocorrencia nao foi consumida pela rejeicao pre-rede? se foi, a 2a e a verificada)
    await expect(w.fetch(U, initFn())).rejects.toThrow('Failed to fetch');   // Astra B141: fluxo nunca recebe envelope
  });

  // Astra B101: entrada.body e sombreavel — um Request em fluxo com body redefinido como null
  // escondia o corpo herdado. A presenca do corpo herdado e lida no Request NOVO, pelo getter
  // intrinseco do prototipo.
  it('Request de entrada com body sombreado (null) mas corpo em fluxo herdado: nunca e servido', async () => {
    const U = 'https://api.example/post';
    const ct = { 'content-type': 'text/plain' };
    const idU = identidadeDeRequisicao('POST', U, Buffer.alloc(0), ct, 'include');
    const terminalApenas = { ...envelopeDe('PRE_PAYLOAD'), externo: true, corsCredenciado: true };
    const verificado = { ...envelopeDe('PRE_PAYLOAD'), externo: true, corsCredenciado: true, preflightCredenciado: true, preflightCabecalhos: [] };
    const { manifesto, arquivos } = montarReplay(new Map([[idU, [terminalApenas, verificado]]]), new Map());
    const chamadas = [];
    const mock = async (u) => { const s = u instanceof Request ? u.url : String(u); chamadas.push(s); const a = arquivos.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'LIVE'); };
    const { w } = sandbox(manifesto, mock, { entryPath: 'index.html', origemFonte: 'https://origin', href: `${ORIGEM}/api/runtime/tok/index.html` });
    const sombreado = () => { const rq = new Request(U, { method: 'POST', body: new ReadableStream({ start(c) { c.close(); } }), duplex: 'half', headers: ct, credentials: 'include' }); Object.defineProperty(rq, 'body', { value: null }); return rq; };
    await expect(w.fetch(sombreado(), { credentials: 'include' })).rejects.toThrow('Failed to fetch');
    expect(chamadas).toEqual([]);
    await expect(w.fetch(sombreado(), { credentials: 'include' })).rejects.toThrow('Failed to fetch');   // Astra B141: fluxo nunca recebe envelope
  });

  // Astra B103: o preflight exigido pelo REPLAY vale em qualquer modo de credenciais —
  // permissao do terminal nao autoriza fluxo em omit/same-origin sem preflight verificado.
  it('replay em fluxo nunca e servido em omit, same-origin nem include; corpo pronto e', async () => {
    const U = 'https://api.example/post';
    const ct = { 'content-type': 'text/plain' };
    const idU = identidadeDeRequisicao('POST', U, Buffer.alloc(0), ct);
    const terminal = { ...envelopeDe('FIRST'), externo: true };
    const verificado = { ...envelopeDe('FIRST'), externo: true, preflightVerificado: true, preflightCabecalhos: [] };
    const fluxo = () => new ReadableStream({ start(c) { c.close(); } });
    for (const cred of ['omit', 'same-origin']) {
      const idC = identidadeDeRequisicao('POST', U, Buffer.alloc(0), ct, cred);
      const { manifesto, arquivos } = montarReplay(new Map([[idC, [terminal, verificado]]]), new Map());
      const chamadas = [];
      const mock = async (u) => { const s = u instanceof Request ? u.url : String(u); chamadas.push(s); const a = arquivos.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'LIVE'); };
      const { w } = sandbox(manifesto, mock, { entryPath: 'index.html', origemFonte: 'https://origin', href: `${ORIGEM}/api/runtime/tok/index.html` });
      await expect(w.fetch(U, { method: 'POST', body: fluxo(), duplex: 'half', headers: ct, credentials: cred }), cred).rejects.toThrow('Failed to fetch');
      expect(chamadas, cred).toEqual([]);
      await expect(w.fetch(U, { method: 'POST', body: fluxo(), duplex: 'half', headers: ct, credentials: cred }), cred).rejects.toThrow('Failed to fetch');   // Astra B141: fluxo nunca recebe envelope
    }
    // corpo simples (sem preflight) segue servido pelo terminal em omit
    const { manifesto, arquivos } = montarReplay(new Map([[identidadeDeRequisicao('POST', U, Buffer.alloc(0), ct, 'omit'), [terminal]]]), new Map());
    const { w } = sandbox(manifesto, async (u) => { const s = u instanceof Request ? u.url : String(u); const a = arquivos.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'LIVE'); }, { entryPath: 'index.html', origemFonte: 'https://origin', href: `${ORIGEM}/api/runtime/tok/index.html` });
    expect(await (await w.fetch(U, { method: 'POST', body: '', headers: ct, credentials: 'omit' })).text()).toBe('FIRST');
  });

  // Astra B106: corpo em fluxo atravessando um redirect nao-303 e erro de rede nativo.
  it('replay em fluxo de envelope com redirect (307/308/303) nunca e servido; corpo string e', async () => {
    const U = 'https://origin/relay';
    const ct = { 'content-type': 'text/plain' };
    const idU = identidadeDeRequisicao('POST', U, Buffer.from('x'), ct);
    const fluxo = () => new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('x')); c.close(); } });
    const via = (flag) => ({ ...envelopeDe('CAPTURED_FINAL'), redirecionou: true, ...(flag ? { redirectRejeitaFluxo: true } : {}) });
    for (const [nome, env, esperaFluxo] of [['307', via(true), 'rejeita'], ['303', via(false), 'serve']]) {
      const { manifesto, arquivos } = montarReplay(new Map([[idU, [env, env]]]), new Map());
      const mock = async (u) => { const s = u instanceof Request ? u.url : String(u); const a = arquivos.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'LIVE'); };
      const { w } = sandbox(manifesto, mock, { entryPath: 'index.html', origemFonte: 'https://origin', href: `${ORIGEM}/api/runtime/tok/index.html` });
      const pFluxo = w.fetch(`${ORIGEM}/api/runtime/tok/relay`, { method: 'POST', body: fluxo(), duplex: 'half', headers: ct });
      // Astra B141: fluxo nunca recebe envelope, em nenhum tipo de redirect (esperaFluxo era a guarda antiga)
      void esperaFluxo;
      expect(await pFluxo.then((r) => r.text(), (e) => e.name), nome).not.toBe('CAPTURED_FINAL');
      expect(await (await w.fetch(`${ORIGEM}/api/runtime/tok/relay`, { method: 'POST', body: 'x', headers: ct })).text(), nome + ' string').toBe('CAPTURED_FINAL');
    }
  });

  // Astra B108: o preflight capturado autorizou um conjunto de cabecalhos; um cabecalho inseguro
  // a mais no replay (mesmo fora da identidade) exige outra autorizacao.
  it('replay com cabecalho inseguro nao autorizado pelo preflight capturado rejeita; o identico e servido', async () => {
    const U = 'https://api.example/conta';
    const idU = identidadeDeRequisicao('GET', U, Buffer.alloc(0), { 'api-key': 'k' }, 'include');
    const env = { ...envelopeDe('CAPTURED_PAYLOAD'), externo: true, corsCredenciado: true, preflightVerificado: true, preflightCredenciado: true, preflightCabecalhos: ['api-key'] };
    const { manifesto, arquivos } = montarReplay(new Map([[idU, [env, env]]]), new Map());
    const chamadas = [];
    const mock = async (u) => { const s = u instanceof Request ? u.url : String(u); chamadas.push(s); const a = arquivos.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'LIVE'); };
    const { w } = sandbox(manifesto, mock, { entryPath: 'index.html', origemFonte: 'https://origin', href: `${ORIGEM}/api/runtime/tok/index.html` });
    // com cache-control a mais o pedido e OUTRO (Astra B128: todo cabecalho do script entra na identidade) — miss, nunca o envelope
    const extra = await w.fetch(U, { headers: { 'api-key': 'k', 'cache-control': 'no-cache' }, credentials: 'include' }).then((r) => r.text(), (e) => 'ERRO ' + e.message);
    expect(extra).not.toBe('CAPTURED_PAYLOAD');
    expect(chamadas.some((s) => s.includes('/_replay/'))).toBe(false);
    expect(await (await w.fetch(U, { headers: { 'api-key': 'k' }, credentials: 'include' })).text()).toBe('CAPTURED_PAYLOAD');
  });

  // Astra B109: keepalive com corpo acima de 64 KiB e erro de rede nativo — nao pode consumir.
  it('keepalive com corpo > 64 KiB rejeita sem ler envelope; o POST comum seguinte recebe a 1a ocorrencia', async () => {
    const U = 'https://origin/beacon';
    const corpo = 'x'.repeat(65537);
    const ct = { 'content-type': 'text/plain;charset=UTF-8' };
    const idU = identidadeDeRequisicao('POST', U, Buffer.from(corpo), ct);
    const { manifesto, arquivos } = montarReplay(new Map([[idU, [envelopeDe('CAPTURED_PAYLOAD')]]]), new Map());
    const chamadas = [];
    const mock = async (u) => { const s = u instanceof Request ? u.url : String(u); chamadas.push(s); const a = arquivos.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'LIVE'); };
    const { w } = sandbox(manifesto, mock, { entryPath: 'index.html', origemFonte: 'https://origin', href: `${ORIGEM}/api/runtime/tok/index.html` });
    await expect(w.fetch(`${ORIGEM}/api/runtime/tok/beacon`, { method: 'POST', body: corpo, keepalive: true })).rejects.toThrow('Failed to fetch');
    expect(chamadas).toEqual([]);
    expect(await (await w.fetch(`${ORIGEM}/api/runtime/tok/beacon`, { method: 'POST', body: corpo })).text()).toBe('CAPTURED_PAYLOAD');
  });

  // Astra B110: range descendente acima de 2^53 exige preflight no replay tambem.
  it('Range descendente acima de 2^53 exige preflight: include sem preflight verificado rejeita sem ler envelope', async () => {
    const U = 'https://api.example/arquivo';
    const rg = 'bytes=9007199254740993-9007199254740992';
    const idU = identidadeDeRequisicao('GET', U, Buffer.alloc(0), { range: rg }, 'include');
    const env = { ...envelopeDe('CAPTURED_PAYLOAD'), externo: true, corsCredenciado: true };
    const { manifesto, arquivos } = montarReplay(new Map([[idU, [env]]]), new Map());
    const chamadas = [];
    const mock = async (u) => { const s = u instanceof Request ? u.url : String(u); chamadas.push(s); const a = arquivos.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'LIVE'); };
    const { w } = sandbox(manifesto, mock, { entryPath: 'index.html', origemFonte: 'https://origin', href: `${ORIGEM}/api/runtime/tok/index.html` });
    await expect(w.fetch(U, { headers: { range: rg }, credentials: 'include' })).rejects.toThrow('Failed to fetch');
    expect(chamadas).toEqual([]);
  });

  // Astra B114: Range com extremo >= INT64_MAX exige preflight tambem no replay.
  it('Range com extremo >= INT64_MAX exige preflight: include sem preflight verificado rejeita sem ler envelope', async () => {
    const U = 'https://api.example/arquivo2';
    const rg = 'bytes=0-9223372036854775808';
    const idU = identidadeDeRequisicao('GET', U, Buffer.alloc(0), { range: rg }, 'include');
    const env = { ...envelopeDe('CAPTURED_PAYLOAD'), externo: true, corsCredenciado: true };
    const { manifesto, arquivos } = montarReplay(new Map([[idU, [env]]]), new Map());
    const chamadas = [];
    const mock = async (u) => { const s = u instanceof Request ? u.url : String(u); chamadas.push(s); const a = arquivos.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'LIVE'); };
    const { w } = sandbox(manifesto, mock, { entryPath: 'index.html', origemFonte: 'https://origin', href: `${ORIGEM}/api/runtime/tok/index.html` });
    await expect(w.fetch(U, { headers: { range: rg }, credentials: 'include' })).rejects.toThrow('Failed to fetch');
    expect(chamadas).toEqual([]);
  });

  // Astra B123: only-if-cached nao e servido pelo envelope (cache vazio) e nao consome.
  it("cache 'only-if-cached' rejeita sem ler envelope; o fetch normal seguinte recebe a sua ocorrencia", async () => {
    const FONTE = 'https://origin';
    const idU = identidadeDeRequisicao('GET', `${FONTE}/api`, Buffer.alloc(0), {});
    const { manifesto, arquivos } = montarReplay(new Map([[idU, [envelopeDe('CAPTURED')]]]), new Map());
    const chamadas = [];
    const mock = async (u) => { const s = u instanceof Request ? u.url : String(u); chamadas.push(s); const a = arquivos.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'LIVE'); };
    const { w } = sandbox(manifesto, mock, { entryPath: 'index.html', origemFonte: FONTE, href: `${ORIGEM}/api/runtime/tok/index.html` });
    await expect(w.fetch(`${ORIGEM}/api/runtime/tok/api`, { mode: 'same-origin', cache: 'only-if-cached' })).rejects.toThrow('Failed to fetch');
    expect(chamadas).toEqual([]);
    expect(await (await w.fetch(`${ORIGEM}/api/runtime/tok/api`)).text()).toBe('CAPTURED');
  });

  // Astra B125: um GET abortado DEPOIS de entrar consome a sua ocorrencia (a captura guardou a
  // vaga dele) — as chamadas seguintes recebem as suas, sem deslocar.
  it('abort depois da entrada tira o grupo do replay: as seguintes nunca recebem a ocorrencia de outra chamada', async () => {
    const FONTE = 'https://origin';
    const idU = identidadeDeRequisicao('GET', `${FONTE}/lista`, Buffer.alloc(0), {});
    const { manifesto, arquivos } = montarReplay(new Map([[idU, [{ perdido: true }, envelopeDe('SECOND'), envelopeDe('THIRD')]]]), new Map());
    const mock = async (u) => { const s = u instanceof Request ? u.url : String(u); const a = arquivos.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'LIVE'); };
    const { w } = sandbox(manifesto, mock, { entryPath: 'index.html', origemFonte: FONTE, href: `${ORIGEM}/api/runtime/tok/index.html` });
    const ac = new AbortController();
    const p1 = w.fetch(`${ORIGEM}/api/runtime/tok/lista`, { signal: ac.signal });
    ac.abort();
    await expect(p1).rejects.toMatchObject({ name: 'AbortError' });
    const r2 = await w.fetch(`${ORIGEM}/api/runtime/tok/lista`).then((r) => r.text(), (e) => 'ERRO ' + e.message);
    const r3 = await w.fetch(`${ORIGEM}/api/runtime/tok/lista`).then((r) => r.text(), (e) => 'ERRO ' + e.message);
    expect(r2).not.toBe('SECOND');   // a de SECOND pode nao ser a sua (ordem inobservavel) — miss
    expect(r3).not.toBe('SECOND');   // o deslocamento da Astra: a 3a recebia SECOND
    // controle: um pedido ja abortado na ENTRADA nao envenena o grupo
    const { manifesto: m2, arquivos: a2 } = montarReplay(new Map([[idU, [envelopeDe('ONE')]]]), new Map());
    const { w: w2 } = sandbox(m2, async (u) => { const s = u instanceof Request ? u.url : String(u); const a = a2.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'LIVE'); }, { entryPath: 'index.html', origemFonte: FONTE, href: `${ORIGEM}/api/runtime/tok/index.html` });
    const ac2 = new AbortController(); ac2.abort();
    await expect(w2.fetch(`${ORIGEM}/api/runtime/tok/lista`, { signal: ac2.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(await (await w2.fetch(`${ORIGEM}/api/runtime/tok/lista`)).text()).toBe('ONE');
  });

  // Astra B126: alias localizado e URL original caem no MESMO grupo de desalinhamento.
  it('desalinhar pelo alias localizado tira tambem a URL original (e vice-versa)', async () => {
    const FONTE = 'https://origin';
    const orig = `${FONTE}/api?v=1`;
    const idO = identidadeDeRequisicao('GET', orig, Buffer.alloc(0), {});
    const mapa = new Map([[orig, 'api.abc123']]);
    for (const ordem of [['alias', 'orig'], ['orig', 'alias']]) {
      const { manifesto, arquivos } = montarReplay(new Map([[idO, [{ perdido: true }, envelopeDe('SECOND'), envelopeDe('THIRD')]]]), new Map());
      const mock = async (u) => { const s = u instanceof Request ? u.url : String(u); const a = arquivos.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'LIVE'); };
      const { w } = sandbox(manifesto, mock, { entryPath: 'index.html', origemFonte: FONTE, href: `${ORIGEM}/api/runtime/tok/index.html`, proveniencias: mapaDeProveniencias(mapa, FONTE), gruposDeProveniencia: gruposDeProveniencia(mapa) });
      const url = { alias: `${ORIGEM}/api/runtime/tok/api.abc123`, orig };
      const ac = new AbortController();
      const p1 = w.fetch(url[ordem[0]], { signal: ac.signal }); ac.abort();
      await expect(p1, ordem.join('>')).rejects.toMatchObject({ name: 'AbortError' });
      const r2 = await w.fetch(url[ordem[1]]).then((r) => r.text(), (e) => 'ERRO ' + e.message);
      const r3 = await w.fetch(url[ordem[1]]).then((r) => r.text(), (e) => 'ERRO ' + e.message);
      expect([r2, r3], ordem.join('>')).not.toContain('SECOND');
      expect([r2, r3], ordem.join('>')).not.toContain('THIRD');
    }
  });

  // Astra B127: o hash emitido e de GET — POST por alias natural e por URL original cai no grupo POST.
  it('POST por caminho natural e pela URL original caem no mesmo grupo de desalinhamento (as duas direcoes)', async () => {
    const FONTE = 'https://origin';
    const orig = `${FONTE}/api`;
    const idP = identidadeDeRequisicao('POST', orig, Buffer.from('x'), { 'content-type': 'text/plain;charset=UTF-8' });
    const mapa = new Map([[orig, 'api']]);
    for (const ordem of [['alias', 'orig'], ['orig', 'alias']]) {
      const { manifesto, arquivos } = montarReplay(new Map([[idP, [{ perdido: true }, envelopeDe('SECOND'), envelopeDe('THIRD')]]]), new Map());
      const mock = async (u) => { const s = u instanceof Request ? u.url : String(u); const a = arquivos.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'LIVE'); };
      const { w } = sandbox(manifesto, mock, { entryPath: 'index.html', origemFonte: FONTE, href: `${ORIGEM}/api/runtime/tok/index.html`, proveniencias: mapaDeProveniencias(mapa, FONTE), gruposDeProveniencia: gruposDeProveniencia(mapa) });
      const url = { alias: `${ORIGEM}/api/runtime/tok/api`, orig };
      const ac = new AbortController();
      const p1 = w.fetch(url[ordem[0]], { method: 'POST', body: 'x', signal: ac.signal }); ac.abort();
      await expect(p1, ordem.join('>')).rejects.toMatchObject({ name: 'AbortError' });
      const r2 = await w.fetch(url[ordem[1]], { method: 'POST', body: 'x' }).then((r) => r.text(), (e) => 'ERRO ' + e.message);
      const r3 = await w.fetch(url[ordem[1]], { method: 'POST', body: 'x' }).then((r) => r.text(), (e) => 'ERRO ' + e.message);
      expect([r2, r3], ordem.join('>')).not.toContain('SECOND');
      expect([r2, r3], ordem.join('>')).not.toContain('THIRD');
    }
  });

  // Astra B128: Accept-Language explicito distingue — fr nao recebe nem consome o envelope de en.
  it('Accept-Language explicito: fr nao recebe nem consome o envelope de en', async () => {
    const FONTE = 'https://origin';
    const idEn = identidadeDeRequisicao('GET', `${FONTE}/saudacao`, Buffer.alloc(0), { 'accept-language': 'en' });
    const { manifesto, arquivos } = montarReplay(new Map([[idEn, [envelopeDe('Hello')]]]), new Map());
    const mock = async (u) => { const s = u instanceof Request ? u.url : String(u); const a = arquivos.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'LIVE'); };
    const { w } = sandbox(manifesto, mock, { entryPath: 'index.html', origemFonte: FONTE, href: `${ORIGEM}/api/runtime/tok/index.html` });
    expect(await w.fetch(`${ORIGEM}/api/runtime/tok/saudacao`, { headers: { 'accept-language': 'fr' } }).then((r) => r.text(), (e) => e.name)).toBe('TypeError');   // miss com cabecalho servido do pacote: recusa (Astra B143)
    expect(await (await w.fetch(`${ORIGEM}/api/runtime/tok/saudacao`, { headers: { 'accept-language': 'en' } })).text()).toBe('Hello');
  });

  // Astra B130: um cabecalho chamado "credentials" nao colide com o modo de credenciais.
  it('cabecalho "credentials: omit" (modo default) nao colide com o modo omit', async () => {
    const FONTE = 'https://origin';
    const idHdr = identidadeDeRequisicao('GET', `${FONTE}/account`, Buffer.alloc(0), { accept: 'application/json', credentials: 'omit' });
    const idModo = identidadeDeRequisicao('GET', `${FONTE}/account`, Buffer.alloc(0), { accept: 'application/json' }, 'omit');
    expect(idHdr).not.toBe(idModo);
    const { manifesto, arquivos } = montarReplay(new Map([[idHdr, [envelopeDe('PRIVATE')]]]), new Map());
    const mock = async (u) => { const s = u instanceof Request ? u.url : String(u); const a = arquivos.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'LIVE'); };
    const { w } = sandbox(manifesto, mock, { entryPath: 'index.html', origemFonte: FONTE, href: `${ORIGEM}/api/runtime/tok/index.html` });
    expect(await w.fetch(`${ORIGEM}/api/runtime/tok/account`, { credentials: 'omit', headers: { accept: 'application/json' } }).then((r) => r.text(), (e) => e.name)).toBe('TypeError');   // Astra B143
    expect(await (await w.fetch(`${ORIGEM}/api/runtime/tok/account`, { headers: { accept: 'application/json', credentials: 'omit' } })).text()).toBe('PRIVATE');
  });

  // Astra B131: TODO atributo do pedido que o script escolhe entra na identidade (o servidor
  // ve Sec-Fetch-Mode, cookie, Cache-Control, Referer...). Um pedido com atributo diferente do
  // capturado e miss e NAO consome a ocorrencia do pedido que casa.
  for (const [nome, init] of [
    ['mode no-cors', { mode: 'no-cors' }], ['cache no-store', { cache: 'no-store' }],
    ['referrerPolicy no-referrer', { referrerPolicy: 'no-referrer' }], ['referrer vazio', { referrer: '' }],
  ]) {
    it(`atributo ${nome} diferente do capturado nao recebe nem consome a resposta`, async () => {
      const FONTE = 'https://origin';
      const idPadrao = identidadeDeRequisicao('GET', `${FONTE}/api`, Buffer.alloc(0), {});
      const { manifesto, arquivos } = montarReplay(new Map([[idPadrao, [envelopeDe('PRIVATE')]]]), new Map());
      const mock = async (u) => { const s = u instanceof Request ? u.url : String(u); const a = arquivos.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'LIVE'); };
      const { w } = sandbox(manifesto, mock, { entryPath: 'index.html', origemFonte: FONTE, href: `${ORIGEM}/api/runtime/tok/index.html` });
      const r = await w.fetch(`${ORIGEM}/api/runtime/tok/api`, init).then((x) => x.text(), () => 'REJEITADO');
      expect(r).not.toBe('PRIVATE');
      expect(await (await w.fetch(`${ORIGEM}/api/runtime/tok/api`)).text()).toBe('PRIVATE');
    });
  }
  it('atributos capturados iguais aos do replay casam (mode no-cors + cache no-store)', async () => {
    const FONTE = 'https://origin';
    const id = identidadeDeRequisicao('GET', `${FONTE}/api`, Buffer.alloc(0), {}, { mode: 'no-cors', cache: 'no-store', credentials: 'same-origin' });
    expect(id).not.toBe(identidadeDeRequisicao('GET', `${FONTE}/api`, Buffer.alloc(0), {}));
    const { manifesto, arquivos } = montarReplay(new Map([[id, [envelopeDe('PRIVATE')]]]), new Map());
    const mock = async (u) => { const s = u instanceof Request ? u.url : String(u); const a = arquivos.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'LIVE'); };
    const { w } = sandbox(manifesto, mock, { entryPath: 'index.html', origemFonte: FONTE, href: `${ORIGEM}/api/runtime/tok/index.html` });
    expect(await (await w.fetch(`${ORIGEM}/api/runtime/tok/api`, { cache: 'no-store' })).text()).not.toBe('PRIVATE');
    expect(await (await w.fetch(`${ORIGEM}/api/runtime/tok/api`, { mode: 'no-cors', cache: 'no-store' })).text()).toBe('PRIVATE');
  });
  it('marca de atributos: string legada = credenciais; default nao muda identidade', () => {
    const base = identidadeDeRequisicao('GET', 'https://o/x', Buffer.alloc(0), {});
    expect(identidadeDeRequisicao('GET', 'https://o/x', Buffer.alloc(0), {}, { mode: 'cors', cache: 'default', referrer: 'about:client', keepalive: false })).toBe(base);
    expect(identidadeDeRequisicao('GET', 'https://o/x', Buffer.alloc(0), {}, 'include')).toBe(identidadeDeRequisicao('GET', 'https://o/x', Buffer.alloc(0), {}, { credentials: 'include' }));
  });

  // Astra B133: o BURACO tambem carrega o documento. Capturadas duas chamadas da entrada (a 1a
  // falhou, a 2a deu SECOND); no clone uma chamada de /public vem antes: nao pode consumir o
  // buraco, senao a 1a chamada da entrada receberia o SECOND da 2a.
  it('buraco com documento: chamada de outro documento nao o consome nem desloca as seguintes', async () => {
    const FONTE = 'https://origin';
    const hEntrada = (await import('node:crypto')).createHash('sha256').update('').digest('hex');
    const id = identidadeDeRequisicao('GET', `${FONTE}/api`, Buffer.alloc(0), {});
    const { manifesto, arquivos } = montarReplay(new Map([[id, [{ perdido: true, documento: hEntrada }, { ...envelopeDe('SECOND'), documento: hEntrada }]]]), new Map());
    expect(manifesto[id][0]).toEqual({ perdido: true, documento: hEntrada });
    const mock = async (u) => { const s = u instanceof Request ? u.url : String(u); const a = arquivos.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'LIVE'); };
    const entrada = `${ORIGEM}/api/runtime/tok/index.html`;
    const { w } = sandbox(manifesto, mock, { entryPath: 'index.html', origemFonte: FONTE, href: entrada });
    w.location.href = `${ORIGEM}/api/runtime/tok/public`;
    expect(await (await w.fetch(`${ORIGEM}/api/runtime/tok/api`)).text()).not.toBe('SECOND');
    w.location.href = entrada;
    expect(await (await w.fetch(`${ORIGEM}/api/runtime/tok/api`)).text()).toBe('LIVE');     // o buraco: miss
    expect(await (await w.fetch(`${ORIGEM}/api/runtime/tok/api`)).text()).toBe('SECOND');
  });

  // Astra B134: fora de POST/PUT, corpo ausente (sem Content-Length) e corpo vazio presente
  // (Content-Length: 0) sao pedidos diferentes com os mesmos bytes.
  it('DELETE com corpo vazio presente nao recebe nem consome o capturado sem corpo; a rede recebe o corpo presente', async () => {
    const FONTE = 'https://origin';
    const idAus = identidadeDeRequisicao('DELETE', `${FONTE}/api`, Buffer.alloc(0), {});
    expect(identidadeDeRequisicao('DELETE', `${FONTE}/api`, Buffer.alloc(0), {}, { corpoPresente: true })).not.toBe(idAus);
    // em POST/PUT o navegador manda Content-Length 0 nos dois casos: mesma identidade
    expect(identidadeDeRequisicao('POST', `${FONTE}/api`, Buffer.alloc(0), {}, { corpoPresente: true })).toBe(identidadeDeRequisicao('POST', `${FONTE}/api`, Buffer.alloc(0), {}));
    const { manifesto, arquivos } = montarReplay(new Map([[idAus, [envelopeDe('ABSENT')]]]), new Map());
    const vistos = [];
    const mock = async (u) => { const s = u instanceof Request ? u.url : String(u); const a = arquivos.find((x) => s.endsWith(x.path)); if (a) return new Response(a.body); vistos.push(u instanceof Request ? u.body !== null : null); return new Response('LIVE'); };
    const { w } = sandbox(manifesto, mock, { entryPath: 'index.html', origemFonte: FONTE, href: `${ORIGEM}/api/runtime/tok/index.html` });
    expect(await (await w.fetch(`${ORIGEM}/api/runtime/tok/api`, { method: 'DELETE', body: new Uint8Array(0) })).text()).toBe('LIVE');
    expect(vistos).toEqual([true]);   // o passthrough manteve o corpo presente
    expect(await (await w.fetch(`${ORIGEM}/api/runtime/tok/api`, { method: 'DELETE' })).text()).toBe('ABSENT');
  });

  // Astra B141: um upload em FLUXO same-origin, com os mesmos bytes de um corpo pronto capturado,
  // nunca recebe esse envelope nem o consome (a captura nunca guarda fluxo).
  it('fluxo same-origin com os mesmos bytes do corpo pronto capturado vai pelo miss sem consumir', async () => {
    const FONTE = 'https://origin';
    const ct = { 'content-type': 'text/plain' };
    const id = identidadeDeRequisicao('POST', `${FONTE}/api`, Buffer.from('x'), ct);
    const { manifesto, arquivos } = montarReplay(new Map([[id, [envelopeDe('PRIVATE')]]]), new Map());
    const mock = async (u) => { const x = u instanceof Request ? u.url : String(u); const a = arquivos.find((f) => x.endsWith(f.path)); return new Response(a ? a.body : 'LIVE'); };
    const { w } = sandbox(manifesto, mock, { entryPath: 'index.html', origemFonte: FONTE, href: `${ORIGEM}/api/runtime/tok/index.html` });
    const fluxo = new ReadableStream({ start(c) { c.enqueue(new Uint8Array([0x78])); c.close(); } });
    expect(await (await w.fetch(`${ORIGEM}/api/runtime/tok/api`, { method: 'POST', body: fluxo, duplex: 'half', headers: ct })).text()).toBe('LIVE');
    expect(await (await w.fetch(`${ORIGEM}/api/runtime/tok/api`, { method: 'POST', body: 'x', headers: ct })).text()).toBe('PRIVATE');
  });

  // Astra B102: fluxo de OUTRO realm (iframe same-origin) falha instanceof mas o construtor
  // nativo o aceita. Simulado com prototipo trocado (mesmo efeito: instanceof falso, slot
  // interno presente). A marca intrinseca (getter de locked) o reconhece.
  it('fluxo de outro realm (instanceof falso): reconhecido como fluxo e nunca servido', async () => {
    const U = 'https://api.example/post';
    const ct = { 'content-type': 'text/plain' };
    const idU = identidadeDeRequisicao('POST', U, Buffer.alloc(0), ct, 'include');
    const terminalApenas = { ...envelopeDe('PRE_PAYLOAD'), externo: true, corsCredenciado: true };
    const verificado = { ...envelopeDe('PRE_PAYLOAD'), externo: true, corsCredenciado: true, preflightCredenciado: true, preflightCabecalhos: [] };
    const { manifesto, arquivos } = montarReplay(new Map([[idU, [terminalApenas, verificado]]]), new Map());
    const chamadas = [];
    const mock = async (u) => { const s = u instanceof Request ? u.url : String(u); chamadas.push(s); const a = arquivos.find((x) => s.endsWith(x.path)); return new Response(a ? a.body : 'LIVE'); };
    const { w } = sandbox(manifesto, mock, { entryPath: 'index.html', origemFonte: 'https://origin', href: `${ORIGEM}/api/runtime/tok/index.html` });
    // prototipo de "outro realm": copia dos metodos, sem ligacao com ReadableStream.prototype
    const protoAlheio = Object.create(Object.prototype, Object.getOwnPropertyDescriptors(ReadableStream.prototype));
    const alheio = () => { const s = new ReadableStream({ start(c) { c.close(); } }); Object.setPrototypeOf(s, protoAlheio); return s; };
    expect(alheio() instanceof ReadableStream).toBe(false);   // o cenario exercita o furo
    await expect(w.fetch(U, { method: 'POST', body: alheio(), duplex: 'half', headers: ct, credentials: 'include' })).rejects.toThrow('Failed to fetch');
    expect(chamadas).toEqual([]);
    await expect(w.fetch(U, { method: 'POST', body: alheio(), duplex: 'half', headers: ct, credentials: 'include' })).rejects.toThrow('Failed to fetch');   // Astra B141: fluxo nunca recebe envelope
  });

  it('o marcador do pacote vira a origem real so no envelope reescrito', async () => {
    const id = identidadeDeRequisicao('GET', 'https://origin/api.json', Buffer.alloc(0));
    const mapa = new Map([['https://origin/m/f.png', 'm/f.png']]);
    const env = { url: 'https://origin/api.json', status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, contentType: 'application/json', bytes: Buffer.from('{"foto":"https://origin/m/f.png"}') };
    const { manifesto, arquivos } = montarReplay(new Map([[id, [env]]]), mapa, { marcador: '__M_x1__' });
    const { w } = sandbox(manifesto, async () => new Response(arquivos[0].body), { marcador: '__M_x1__' });
    const r = await w.fetch('https://origin/api.json');
    expect((await r.json()).foto).toBe(`${ORIGEM}/m/f.png`);
  });
});
