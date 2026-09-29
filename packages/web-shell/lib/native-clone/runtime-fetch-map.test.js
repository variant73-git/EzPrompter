import { webcrypto } from 'node:crypto';
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
