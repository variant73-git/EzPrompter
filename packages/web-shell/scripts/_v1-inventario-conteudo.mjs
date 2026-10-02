#!/usr/bin/env node
// INVENTÁRIO DE CONTEÚDO de uma captura nativa (separação de papéis, plano §164).
//
// Lista, SEM IA, cada peça de conteúdo da captura com uma CHAVE estável: textos (t-), imagens
// (i-), fundos com imagem (b-), vídeos (v-), SVG desenhado no HTML (s-), fontes (f-) e Lottie
// (l-). O agente escreve a estrutura canônica com VAGAS (`data-u-conteudo="t-0007"`) apontando
// para as chaves; `preencher-conteudo.mjs` põe o conteúdo real, byte a byte, da captura.
// Uso: node scripts/inventario-conteudo.mjs --captura <pasta-assets> --saida <inventario.json>
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm' };

export async function servir(pasta) {
  const srv = createServer(async (req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
    try { const b = await readFile(path.join(pasta, p)); res.writeHead(200, { 'content-type': TIPOS[path.extname(p).toLowerCase()] || 'application/octet-stream' }); res.end(b); } catch { res.writeHead(404); res.end(); }
  });
  await new Promise((d) => srv.listen(0, '127.0.0.1', d));
  return { srv, origem: `http://127.0.0.1:${srv.address().port}` };
}

// Roda NO NAVEGADOR sobre a captura viva. Devolve o inventário com caminhos relativos à pasta.
function coletar(origem) {
  const rel = (u) => { try { const x = new URL(u, location.href); return x.origin === origem ? decodeURIComponent(x.pathname.replace(/^\//, '')) : null; } catch { return null; } };
  // Secoes de VERDADE: section/header/footer/nav de nivel mais alto (o site costuma embrulhar a
  // pagina inteira num unico bloco, e os filhos do body davam uma secao so).
  const cand = Array.from(document.querySelectorAll('section, header, footer, nav')).filter((e) => !e.parentElement.closest('section, header, footer, nav') && e.getBoundingClientRect().height > 40);
  const secoes = cand.length >= 2 ? cand : Array.from(document.body.children).filter((e) => e.getBoundingClientRect().height > 40);
  const secaoDe = (el) => { const i = secoes.findIndex((s) => s === el || s.contains(el)); return i; };
  const caixa = (el) => { const r = el.getBoundingClientRect(); return { y: Math.round(r.top + scrollY), x: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) }; };
  const textoDireto = (el) => Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').replace(/\s+/g, ' ').trim();
  const ehParteCurta = (c) => c.tagName === 'SPAN' && c.textContent.trim().length <= 24 && !c.querySelector('img,svg,video');
  const dividido = (el) => el.children.length > 0 && !textoDireto(el) && Array.from(el.children).every(ehParteCurta) && el.textContent.trim();
  const out = { textos: [], imagens: [], fundos: [], videos: [], svgs: [], fontes: [], lotties: [] };
  const vistos = new Set();
  let n = { t: 0, i: 0, b: 0, v: 0, s: 0 };
  const chave = (p) => `${p}-${String(++n[p]).padStart(4, '0')}`;
  for (const el of document.body.querySelectorAll('*')) {
    if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(el.tagName)) continue;
    if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;
    if (el.parentElement && dividido(el.parentElement)) continue;
    const cs = getComputedStyle(el);
    const t = dividido(el) ? el.textContent.replace(/\s+/g, ' ').trim() : textoDireto(el);
    if (t && !(el.closest('[aria-hidden="true"]') && dividido(el.parentElement || el))) {
      out.textos.push({ chave: chave('t'), texto: t, tag: el.tagName.toLowerCase(), secao: secaoDe(el), ...caixa(el), fonte: cs.fontFamily.split(',')[0].replace(/["']/g, '').trim(), tamanho: cs.fontSize, peso: cs.fontWeight, cor: cs.color, visivel: cs.display !== 'none' && cs.visibility !== 'hidden' });
    }
    if (el.tagName === 'IMG') {
      const p = rel(el.currentSrc || el.src);
      if (p && !vistos.has('i:' + p + caixa(el).y)) { vistos.add('i:' + p + caixa(el).y); out.imagens.push({ chave: chave('i'), arquivo: p, alt: el.alt || '', larguraNatural: el.naturalWidth, alturaNatural: el.naturalHeight, secao: secaoDe(el), ...caixa(el) }); }
    }
    if (el.tagName === 'VIDEO') {
      const src = el.currentSrc || el.src || (el.querySelector('source') && el.querySelector('source').src);
      out.videos.push({ chave: chave('v'), arquivo: rel(src), capa: el.poster ? rel(el.poster) : null, laco: el.loop, mudo: el.muted, autoplay: el.autoplay, secao: secaoDe(el), ...caixa(el) });
    }
    if (el.tagName.toLowerCase() === 'svg' && el.getBoundingClientRect().width > 4) {
      out.svgs.push({ chave: chave('s'), markup: el.outerHTML.length < 60000 ? el.outerHTML : null, secao: secaoDe(el), ...caixa(el) });
    }
    const ds = el.getAttribute('data-src') || el.getAttribute('data-animation-path') || '';
    if (/\.json(\?|$)/i.test(ds)) {
      const p = rel(ds);
      if (p) out.lotties.push({ chave: `l-${String(out.lotties.length + 1).padStart(4, '0')}`, arquivo: p, laco: el.getAttribute('data-loop') !== '0' && el.getAttribute('data-loop') !== 'false', secao: secaoDe(el), ...caixa(el) });
    }
    const bg = cs.backgroundImage;
    if (bg && bg !== 'none' && /url\(/.test(bg)) {
      const m = /url\(["']?([^"')]+)["']?\)/.exec(bg); const p = m && rel(m[1]);
      if (p) out.fundos.push({ chave: chave('b'), arquivo: p, tamanho: cs.backgroundSize, posicao: cs.backgroundPosition, secao: secaoDe(el), ...caixa(el) });
    }
  }
  // Fontes: regras @font-face das folhas que o documento carrega (CSSOM, sem regex no CSS).
  let nf = 0;
  for (const sheet of Array.from(document.styleSheets)) {
    let regras; try { regras = sheet.cssRules; } catch { continue; }
    for (const r of Array.from(regras || [])) {
      if (r.type !== 5) continue;   // CSSFontFaceRule
      const fam = r.style.getPropertyValue('font-family').replace(/["']/g, '').trim();
      const src = r.style.getPropertyValue('src'); const urls = []; const re = /url\(["']?([^"')]+)["']?\)/g; let m;
      while ((m = re.exec(src))) { const p = rel(new URL(m[1], sheet.href || location.href).href); if (p) urls.push(p); }
      if (fam && urls.length) out.fontes.push({ chave: `f-${String(++nf).padStart(4, '0')}`, familia: fam, peso: r.style.getPropertyValue('font-weight') || '400', estilo: r.style.getPropertyValue('font-style') || 'normal', arquivos: urls });
    }
  }
  return out;
}

export async function inventariar(pasta) {
  const { srv, origem } = await servir(path.resolve(pasta));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    await page.goto(`${origem}/index.html`, { waitUntil: 'load', timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(3000);
    // Rola tudo para o conteúdo preguiçoso aparecer; volta ao topo para as caixas serem da página.
    const max = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < max; y += 900) { await page.evaluate((v) => window.scrollTo(0, v), y); await page.waitForTimeout(250); }
    await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(800);
    const inv = await page.evaluate(coletar, origem);
    inv.pagina = await page.evaluate(() => ({ altura: document.documentElement.scrollHeight, titulo: document.title, lang: document.documentElement.lang }));
    return inv;
  } finally { await browser.close(); srv.close(); }
}

if (process.argv[1] && process.argv[1].endsWith('inventario-conteudo.mjs')) {
  const pasta = arg('--captura'); const saida = arg('--saida');
  const inv = await inventariar(pasta);
  await writeFile(saida, JSON.stringify(inv, null, 1));
  console.log(JSON.stringify({ textos: inv.textos.length, imagens: inv.imagens.length, fundos: inv.fundos.length, videos: inv.videos.length, svgs: inv.svgs.length, fontes: inv.fontes.length, lotties: inv.lotties.length, pagina: inv.pagina }));
}
