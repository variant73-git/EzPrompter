import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { montarReplay, runtimeFetchShim } from './runtime-fetch-map.js';
import { cabecalhosDeReplay, identidadeDeRequisicao, metodoCanonico } from './capture-bundle.js';

// A formula do NAVEGADOR, transcrita do remendo, rodando sobre o SubtleCrypto do Node.
// `metodo` chega como a plataforma o entrega em `req.method` (ja normalizado).
async function identidadeNoNavegador(metodo, url, corpo, headers = {}) {
  const subtle = webcrypto.subtle;
  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const h = await subtle.digest('SHA-256', corpo);
  const pares = [];
  new Headers(headers).forEach((valor, nome) => {
    const n = nome.toLowerCase();
    if (n === 'content-type' || n === 'authorization' || n.startsWith('x-')) pares.push(`${n}:${String(valor).trim()}`);
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
  it('Authorization, Content-Type e x-* distinguem; Accept/Cookie (do navegador) nao', () => {
    const url = 'https://site/api'; const c = Buffer.from('q');
    const base = identidadeDeRequisicao('POST', url, c, { 'content-type': 'application/json' });
    expect(identidadeDeRequisicao('POST', url, c, { 'content-type': 'application/json', authorization: 'Bearer a' })).not.toBe(base);
    expect(identidadeDeRequisicao('POST', url, c, { 'content-type': 'text/plain' })).not.toBe(base);
    expect(identidadeDeRequisicao('POST', url, c, { 'content-type': 'application/json', 'x-tenant': 't2' })).not.toBe(base);
    // O que o navegador acrescenta sozinho nao entra (o objeto Request nao o ve).
    expect(identidadeDeRequisicao('POST', url, c, { 'Content-Type': 'application/json', accept: '*/*', cookie: 'a=b', 'sec-fetch-mode': 'cors' })).toBe(base);
  });

  it('so os seis metodos que o Fetch normaliza vao a maiusculas: patch != PATCH', () => {
    expect(metodoCanonico('post')).toBe('POST');
    expect(metodoCanonico('delete')).toBe('DELETE');
    expect(metodoCanonico('patch')).toBe('patch');
    expect(metodoCanonico('PATCH')).toBe('PATCH');
    expect(identidadeDeRequisicao('patch', 'https://s/a', Buffer.alloc(0))).not.toBe(identidadeDeRequisicao('PATCH', 'https://s/a', Buffer.alloc(0)));
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

  it('sem envelope nao injeta nada', () => {
    expect(runtimeFetchShim({})).toBe('');
    expect(runtimeFetchShim(null)).toBe('');
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
  function sandbox(manifesto, fetchOriginal, { marcador } = {}) {
    const shim = runtimeFetchShim(manifesto, { marcador });
    const js = shim.slice(shim.indexOf('>') + 1, shim.lastIndexOf('</script>'));
    const location = { href: `${ORIGEM}/`, origin: ORIGEM };
    const ctx = {
      window: { crypto: webcrypto, fetch: fetchOriginal }, Request, Response, Headers, TextEncoder, TextDecoder, Uint8Array, URL,
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
    const fd = new FormData(); fd.append('a', 'b');
    await expect(w.fetch('https://origin/api', { method: 'POST', body: fd })).rejects.toThrow('Failed to fetch');
    expect(n).toBe(0);
  });

  it('GET a outra origem sem envelope passa UMA vez e a falha de rede chega ao site', async () => {
    let n = 0;
    const { w } = sandbox(manifestoVazio, async () => { n += 1; throw new TypeError('network down'); });
    await expect(w.fetch('https://origin/outra')).rejects.toThrow('network down');
    expect(n).toBe(1);
  });

  it('POST a MESMA origem (o servidor do clone) passa intacto, corpo ainda utilizavel', async () => {
    let recebido = null;
    const { w } = sandbox(manifestoVazio, async (entrada) => { recebido = entrada; return new Response('ok'); });
    const req = new Request(`${ORIGEM}/api`, { method: 'POST', body: 'abc' });
    const r = await w.fetch(req);
    expect(await r.text()).toBe('ok');
    expect(recebido).toBe(req);
    expect(req.bodyUsed).toBe(false);
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
