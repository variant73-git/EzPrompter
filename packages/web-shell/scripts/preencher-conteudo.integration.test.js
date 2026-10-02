// Preenchimento de conteudo (separacao de papeis): cada vaga recebe o conteudo REAL da captura,
// os arquivos sao copiados, e o relatorio aponta chave inexistente, tipo errado e o que sobrou.
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { preencher } from './preencher-conteudo.mjs';

describe('preencher-conteudo', () => {
  it('preenche texto, imagem, fundo, video, svg, lottie e fontes, e reporta o que falta', async () => {
    const raiz = await mkdtemp(path.join(os.tmpdir(), 'preencher-'));
    const cap = path.join(raiz, 'cap'); const can = path.join(raiz, 'can');
    await mkdir(path.join(cap, '_ext/cdn'), { recursive: true }); await mkdir(can, { recursive: true });
    for (const f of ['_ext/cdn/foto.png', '_ext/cdn/fundo.jpg', '_ext/cdn/v.mp4', '_ext/cdn/capa.jpg', '_ext/cdn/anim.json', '_ext/cdn/f.woff2']) await writeFile(path.join(cap, f), 'x');
    const inv = {
      textos: [{ chave: 't-0001', texto: 'CropTab™ — titulo real', visivel: true }, { chave: 't-0002', texto: 'sobra visivel', visivel: true }, { chave: 't-0003', texto: 'menu oculto', visivel: false }],
      imagens: [{ chave: 'i-0001', arquivo: '_ext/cdn/foto.png', alt: 'Foto' }],
      fundos: [{ chave: 'b-0001', arquivo: '_ext/cdn/fundo.jpg' }],
      videos: [{ chave: 'v-0001', arquivo: '_ext/cdn/v.mp4', capa: '_ext/cdn/capa.jpg' }],
      svgs: [{ chave: 's-0001', markup: '<svg id="logo-real" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>' }],
      lotties: [{ chave: 'l-0001', arquivo: '_ext/cdn/anim.json' }],
      fontes: [{ chave: 'f-0001', familia: 'Aeonik', peso: '400', estilo: 'normal', arquivos: ['_ext/cdn/f.woff2'] }],
    };
    await writeFile(path.join(raiz, 'inv.json'), JSON.stringify(inv));
    await writeFile(path.join(can, 'index.html'), `<!doctype html><html><head><title>c</title></head><body>
<h1 id="u-hero-titulo" data-u-conteudo="t-0001">PLACEHOLDER</h1>
<img id="u-hero-foto" data-u-conteudo="i-0001">
<section id="u-sec-fundo" data-u-conteudo="b-0001" style="height:10px"></section>
<video id="u-sec-video" data-u-conteudo="v-0001" muted loop></video>
<div id="u-logo" data-u-conteudo="s-0001"></div>
<div id="u-anim" data-u-conteudo="l-0001"></div>
<p id="u-sem-chave" data-u-conteudo="t-9999">x</p>
<div id="u-tipo-errado" data-u-conteudo="i-0001"></div>
<script src="vendor/uncraft-motion.js"></script></body></html>`);
    await writeFile(path.join(can, 'motion.json'), JSON.stringify({ versao: 0, fichas: [{ id: 'm-anim', tipo: 'lottie', alvo: '#u-anim', src: 'l-0001', motor: { tipo: 'carga' } }] }));
    const r = await preencher({ canonico: can, inventario: path.join(raiz, 'inv.json'), captura: cap });
    const html = await readFile(path.join(can, 'index.html'), 'utf8');
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('>CropTab™ — titulo real</h1>');
    expect(html).toMatch(/<img id="u-hero-foto"[^>]*src="conteudo\/_ext\/cdn\/foto\.png"/);
    expect(html).toContain('alt="Foto"');
    expect(html).toContain('background-image: url(&quot;conteudo/_ext/cdn/fundo.jpg&quot;)');
    expect(html).toMatch(/<video[^>]*src="conteudo\/_ext\/cdn\/v\.mp4"[^>]*poster="conteudo\/_ext\/cdn\/capa\.jpg"/);
    expect(html).toContain('<svg id="logo-real"');
    expect(html).toContain('@font-face{font-family:"Aeonik";font-weight:400');
    expect(html).toContain('<script src="vendor/uncraft-motion.js"></script>');   // scripts intactos, nunca executados
    const prog = JSON.parse(await readFile(path.join(can, 'motion.json'), 'utf8'));
    expect(prog.fichas[0].src).toBe('conteudo/_ext/cdn/anim.json');
    for (const f of ['foto.png', 'fundo.jpg', 'v.mp4', 'capa.jpg', 'anim.json', 'f.woff2']) expect(existsSync(path.join(can, 'conteudo/_ext/cdn', f)), f).toBe(true);
    expect(r.chavesInexistentes).toEqual(['t-9999']);
    expect(r.tipoErrado).toEqual(['i-0001@DIV']);
    expect(r.semLugar.textosVisiveis).toBe(1);
    expect(r.semLugar.textosOcultos).toBe(1);
    expect(r.arquivosFaltando).toEqual([]);
  }, 60000);
  it('vaga aninhada, texto com quebra, fundo com varias camadas e segunda passada', async () => {
    const raiz = await mkdtemp(path.join(os.tmpdir(), 'preencher2-'));
    const cap = path.join(raiz, 'cap'); const can = path.join(raiz, 'can');
    await mkdir(path.join(cap, 'img'), { recursive: true }); await mkdir(can, { recursive: true });
    for (const f of ['img/a.png', 'img/b.png', 'f.woff2']) await writeFile(path.join(cap, f), 'x');
    const inv = {
      textos: [{ chave: 't-0001', texto: 'Linha um\nLinha dois', visivel: true }, { chave: 't-0002', texto: 'de fora', visivel: true }, { chave: 't-0003', texto: 'de dentro', visivel: true }],
      fundos: [{ chave: 'b-0001', arquivo: 'img/a.png', arquivos: [{ url: 'http://x/img/a.png', arquivo: 'img/a.png' }, { url: 'http://x/img/b.png', arquivo: 'img/b.png' }], valor: 'linear-gradient(red, blue), url("http://x/img/a.png"), url("http://x/img/b.png")' }],
      fontes: [{ chave: 'f-0001', familia: 'Sub', peso: '400', estilo: 'normal', descritores: { 'font-weight': '400', 'unicode-range': 'U+0000-00FF' }, arquivos: ['f.woff2'] }],
    };
    await writeFile(path.join(raiz, 'inv.json'), JSON.stringify(inv));
    await writeFile(path.join(can, 'index.html'), '<!doctype html><html><head></head><body><p id="u-quebra" data-u-conteudo="t-0001"></p><p id="u-fora" data-u-conteudo="t-0002"><em id="u-dentro" data-u-conteudo="t-0003"></em></p><div id="u-fundo" data-u-conteudo="b-0001"></div></body></html>');
    const r1 = await preencher({ canonico: can, inventario: path.join(raiz, 'inv.json'), captura: cap });
    await preencher({ canonico: can, inventario: path.join(raiz, 'inv.json'), captura: cap });
    const html = await readFile(path.join(can, 'index.html'), 'utf8');
    expect(html).toContain('>Linha um<br>Linha dois</p>');
    expect(r1.tipoErrado).toEqual(['t-0002:vaga-aninhada']);
    expect(html).toContain('>de dentro</em>');
    expect(html).toContain('linear-gradient(red, blue), url(&quot;conteudo/img/a.png&quot;), url(&quot;conteudo/img/b.png&quot;)');
    expect(html).toContain('unicode-range:U+0000-00FF');
    expect(html.match(/id="u-fontes"/g).length).toBe(1);   // segunda passada nao duplica
  }, 60000);
});

