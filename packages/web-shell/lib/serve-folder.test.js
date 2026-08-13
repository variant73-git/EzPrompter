import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, mkdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { connect } from 'node:net';
import { serveFolder } from './serve-folder.js';

// ⚠️ `fetch` NORMALIZA o caminho antes de mandar: `/../x` e ate' `/%2e%2e/x`
// viram `/x`, entao a guarda nunca era alcancada e o teste dava 404 achando que
// estava provando alguma coisa. Um pedido por soquete cru manda o caminho
// LITERAL, que e' o que um atacante faria.
function pedidoCru(porta, caminho) {
  return new Promise((resolve, reject) => {
    const meia = connect(porta, '127.0.0.1', () => {
      meia.write(`GET ${caminho} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
    });
    let bruto = '';
    meia.on('data', (pedaco) => { bruto += pedaco; });
    meia.on('end', () => resolve({
      status: Number((bruto.match(/^HTTP\/1\.1 (\d+)/) || [])[1]),
      corpo: bruto.slice(bruto.indexOf('\r\n\r\n') + 4),
    }));
    meia.on('error', reject);
  });
}

// A página medida roda na MESMA origem deste servidor: o que ele entrega, ela lê
// e pode mandar embora. Achado crítico da auditoria (Codex): a contenção por
// `startsWith(raiz)` cru deixa passar uma pasta IRMÃ cujo nome começa igual.
describe('serveFolder', () => {
  let base;
  let servidor;

  beforeAll(async () => {
    base = await mkdtemp(path.join(tmpdir(), 'serve-folder-'));
    await mkdir(path.join(base, 'site'));
    await mkdir(path.join(base, 'site-secreto'));
    await writeFile(path.join(base, 'site', 'index.html'), '<!doctype html><p>ok</p>');
    await writeFile(path.join(base, 'site', 'estilo.css'), 'body{color:#123456}');
    await writeFile(path.join(base, 'site-secreto', 'chave.txt'), 'SEGREDO');
    await writeFile(path.join(base, 'fora.txt'), 'FORA');
    await symlink(path.join(base, 'fora.txt'), path.join(base, 'site', 'atalho.txt'));
    servidor = await serveFolder(path.join(base, 'site'));
  });

  afterAll(async () => {
    await servidor?.fechar();
    await rm(base, { recursive: true, force: true });
  });

  it('serves what is inside the folder', async () => {
    const resposta = await fetch(`${servidor.origem}/index.html`);
    expect(resposta.status).toBe(200);
    expect(resposta.headers.get('content-type')).toContain('text/html');
    expect(await resposta.text()).toContain('ok');
  });

  // controle de sensibilidade: o mesmo instrumento, com caminho de dentro,
  // precisa entregar 200 — senao um 403 nao prova guarda nenhuma
  it('the raw request works at all (control)', async () => {
    const resposta = await pedidoCru(servidor.porta, '/estilo.css');
    expect(resposta.status).toBe(200);
    expect(resposta.corpo).toContain('#123456');
  });

  it('refuses a sibling folder whose name merely starts the same', async () => {
    const resposta = await pedidoCru(servidor.porta, '/../site-secreto/chave.txt');
    expect(resposta.status).toBe(403);
    expect(resposta.corpo).not.toContain('SEGREDO');
  });

  it('refuses the same escape when the path is percent-encoded', async () => {
    const resposta = await pedidoCru(servidor.porta, '/%2e%2e/site-secreto/chave.txt');
    expect(resposta.status).toBe(403);
    expect(resposta.corpo).not.toContain('SEGREDO');
  });

  it('refuses a symlink that points outside the folder', async () => {
    const resposta = await fetch(`${servidor.origem}/atalho.txt`);
    expect(resposta.status).toBe(403);
    expect(await resposta.text()).not.toContain('FORA');
  });

  it('answers 400 instead of dying on a broken percent-encoding', async () => {
    const resposta = await fetch(`${servidor.origem}/%E0%A4%A`);
    expect(resposta.status).toBe(400);
  });

  it('answers 404 for something that is not there', async () => {
    expect((await fetch(`${servidor.origem}/nao-existe.css`)).status).toBe(404);
  });
});
