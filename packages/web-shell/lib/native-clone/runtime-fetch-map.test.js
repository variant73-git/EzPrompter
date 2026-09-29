import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { montarReplay, runtimeFetchShim } from './runtime-fetch-map.js';
import { cabecalhosDeReplay, identidadeDeRequisicao } from './capture-bundle.js';

// A formula do NAVEGADOR, transcrita do remendo, rodando sobre o SubtleCrypto do Node.
async function identidadeNoNavegador(metodo, url, corpo) {
  const subtle = webcrypto.subtle;
  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const h = await subtle.digest('SHA-256', corpo);
  const texto = `${String(metodo || 'GET').toUpperCase()}\n${url}\n${hex(h)}`;
  return hex(await subtle.digest('SHA-256', new TextEncoder().encode(texto)));
}

describe('identidade de requisição', () => {
  it('a formula do Node e a do navegador dao o MESMO id (paridade)', async () => {
    const corpo = Buffer.from('{"query":"{core{me{photo}}}"}', 'utf8');
    const url = 'https://site/community/index.php?app=x&controller=api';
    const node = identidadeDeRequisicao('post', url, corpo);
    const pagina = await identidadeNoNavegador('POST', url, new Uint8Array(corpo));
    expect(node).toBe(pagina);
    // GET sem corpo tambem.
    expect(identidadeDeRequisicao('GET', url, Buffer.alloc(0))).toBe(await identidadeNoNavegador('GET', url, new Uint8Array(0)));
  });

  it('corpo diferente na mesma URL = identidade diferente (o que o mapa por URL nao sabia)', () => {
    const url = 'https://site/api';
    expect(identidadeDeRequisicao('POST', url, Buffer.from('a'))).not.toBe(identidadeDeRequisicao('POST', url, Buffer.from('b')));
    expect(identidadeDeRequisicao('POST', url, Buffer.from('a'))).not.toBe(identidadeDeRequisicao('GET', url, Buffer.from('a')));
  });

  it('cabeçalhos de segredo e de transporte ficam fora; os de conteudo entram', () => {
    const h = cabecalhosDeReplay({ 'Content-Type': 'application/json', 'Set-Cookie': 'a=b', 'X-Csrf-Token': 't', 'Content-Length': '9', 'Content-Encoding': 'br' });
    expect(h).toEqual({ 'content-type': 'application/json', 'x-csrf-token': 't' });
  });
});

describe('montarReplay + remendo', () => {
  const envelopes = () => new Map([
    ['id1', [
      { metodo: 'POST', url: 'https://site/api', status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, contentType: 'application/json', bytes: Buffer.from('{"foto":"https://site/media/f.png"}') },
      { metodo: 'POST', url: 'https://site/api', status: 201, statusText: 'Created', headers: {}, contentType: 'application/json', bytes: Buffer.from('{"n":2}') },
    ]],
    ['id2', [{ metodo: 'GET', url: 'https://site/dados', status: 200, statusText: '', headers: {}, contentType: 'text/plain', bytes: Buffer.from('ola') }]],
  ]);
  const mapa = new Map([['https://site/media/f.png', 'media/f.png']]);

  it('cada envelope vira um arquivo, a mesma identidade repetida numera', () => {
    const { arquivos, manifesto } = montarReplay(envelopes(), mapa);
    expect(arquivos.map((a) => a.path)).toEqual(['_replay/id1', '_replay/id1.1', '_replay/id2']);
    expect(manifesto.id1.map((e) => e.status)).toEqual([200, 201]);
    expect(manifesto.id1[1].path).toBe('./_replay/id1.1');
  });

  it('corpo JSON do envelope sai REESCRITO (e o que faz img.src ficar local)', () => {
    const { arquivos } = montarReplay(envelopes(), mapa);
    expect(JSON.parse(Buffer.from(arquivos[0].body).toString('utf8')).foto).toBe('__UNCRAFT_ORIGIN__/media/f.png');
    expect(Buffer.from(arquivos[2].body).toString('utf8')).toBe('ola');   // texto nao-JSON intacto
  });

  it('GET sem corpo entra no indice sincrono do XHR; POST nao', () => {
    const { porUrlGet } = montarReplay(envelopes(), mapa);
    expect(porUrlGet).toEqual({ 'https://site/dados': './_replay/id2' });
  });

  // O XHR recebe o arquivo CRU; um envelope JSON reescrito carrega o marcador de
  // origem que so o caminho do fetch resolve. Servir isso por XHR seria replay ERRADO.
  it('envelope JSON com marcador de origem fica FORA do indice do XHR', () => {
    const env = new Map([['idg', [{ metodo: 'GET', url: 'https://site/api.json', status: 200, statusText: '', headers: {}, contentType: 'application/json', bytes: Buffer.from('{"foto":"https://site/media/f.png"}') }]]]);
    const { porUrlGet, arquivos } = montarReplay(env, mapa);
    expect(Buffer.from(arquivos[0].body).toString('utf8')).toContain('__UNCRAFT_ORIGIN__');
    expect(porUrlGet).toEqual({});
  });

  it('sem envelope nao injeta nada', () => {
    expect(runtimeFetchShim({})).toBe('');
    expect(runtimeFetchShim(null)).toBe('');
  });

  it('o script nao fecha a propria tag e reconstroi a Response com status e cabecalhos', () => {
    const { manifesto } = montarReplay(new Map([['x', [{ metodo: 'POST', url: 'https://s/a</script><b>', status: 418, statusText: 'teapot', headers: { 'x-k': 'v' }, contentType: 'text/plain', bytes: Buffer.from('') }]]]), new Map());
    const shim = runtimeFetchShim(manifesto);
    expect(shim.slice(shim.indexOf('>') + 1)).not.toContain('</script><b>');
    expect(shim).toContain("split('__UNCRAFT_ORIGIN__').join(location.origin)");
    expect(shim).toContain('new Response(saida, { status: env.status');
    expect(shim).toContain('multipart');                 // FormData passa intacto
    expect(shim).toContain("m === 'GET' || m === 'HEAD'"); // XHR so sem corpo
  });
});

// ⚠️ A sonda do Astra, reproduzida: o remendo rodando numa sandbox com um fetch
// original que FALHA na rede. A 1a versao chamava o original DUAS vezes (o catch
// envolvia o proprio passthrough) — para um POST real, envio duplo.
describe('o remendo rodando de verdade (sandbox)', () => {
  function sandbox(manifesto, fetchOriginal) {
    const shim = runtimeFetchShim(manifesto);
    const js = shim.slice(shim.indexOf('>') + 1, shim.lastIndexOf('</script>'));
    function XHR() {} XHR.prototype.open = function () {};
    const ctx = {
      window: { crypto: webcrypto, fetch: fetchOriginal }, Request, Response, TextEncoder, Uint8Array, URL,
      document: { baseURI: 'https://clone/' }, location: { href: 'https://clone/', origin: 'https://clone' }, XMLHttpRequest: XHR,
    };
    ctx.window.window = ctx.window; ctx.window.document = ctx.document; ctx.window.location = ctx.location; ctx.window.XMLHttpRequest = XHR;
    vm.runInNewContext(js, ctx);
    return ctx.window;
  }
  const manifesto = { x: [{ path: './x', status: 200, statusText: 'OK', headers: {}, texto: false }] };

  it('chamada NAO mapeada que falha na rede: o original e chamado UMA vez e a falha chega ao site', async () => {
    let n = 0;
    const w = sandbox(manifesto, async () => { n += 1; throw new TypeError('network down'); });
    await expect(w.fetch('https://origin/api', { method: 'POST', body: 'x' })).rejects.toThrow('network down');
    expect(n).toBe(1);
  });

  it('Request COM corpo nao mapeado passa intacto, com o corpo ainda utilizavel', async () => {
    let recebido = null;
    const w = sandbox(manifesto, async (entrada) => { recebido = entrada; return new Response('ok'); });
    const req = new Request('https://origin/api', { method: 'POST', body: 'abc' });
    const r = await w.fetch(req);
    expect(await r.text()).toBe('ok');
    expect(recebido).toBe(req);            // o MESMO objeto, nao uma copia
    expect(req.bodyUsed).toBe(false);      // e o corpo nao foi consumido pelo remendo
  });

  it('chamada MAPEADA: o original e chamado so para o envelope LOCAL, uma vez', async () => {
    const chamadas = [];
    const w = sandbox(manifesto, async (u) => { chamadas.push(String(u instanceof Request ? u.url : u)); return new Response(new Uint8Array([1, 2, 3])); });
    // identidade 'x' e falsa de proposito; o que se testa aqui e que uma identidade
    // NAO encontrada nao gera duas chamadas — a mapeada de verdade e testada no
    // navegador (gsap.com), onde o hash e calculado dos dois lados.
    await w.fetch('https://origin/outra');
    expect(chamadas).toEqual(['https://origin/outra']);
  });
});
