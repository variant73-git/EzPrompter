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
  // Caminho na captura; URL vazia resolveria para o proprio index.html (revisao Claude) — nunca.
  const rel = (u) => { if (!u || !String(u).trim() || /^data:/i.test(u)) return null; try { const x = new URL(u, location.href); if (x.origin !== origem) return null; const p = decodeURIComponent(x.pathname.replace(/^\//, '')); return p && p !== 'index.html' ? p : null; } catch { return null; } };
  // Secoes de VERDADE: section/header/footer/nav de nivel mais alto (o site costuma embrulhar a
  // pagina inteira num unico bloco, e os filhos do body davam uma secao so).
  const cand = Array.from(document.querySelectorAll('section, header, footer, nav')).filter((e) => !e.parentElement.closest('section, header, footer, nav') && e.getBoundingClientRect().height > 40);
  const secoes = cand.length >= 2 ? cand : Array.from(document.body.children).filter((e) => e.getBoundingClientRect().height > 40);
  const secaoDe = (el) => { const i = secoes.findIndex((s) => s === el || s.contains(el)); return i; };
  const caixa = (el) => { const r = el.getBoundingClientRect(); return { y: Math.round(r.top + scrollY), x: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) }; };
  // So espaco ASCII colapsa: NBSP e o texto do autor (revisao Claude).
  const colapsar = (t) => t.replace(/[ \t\n\r\f]+/g, ' ').trim();
  const textoDireto = (el) => colapsar(Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join(''));
  // Partes de texto dividido: spans OU divs inline (o SplitText usa div por padrao).
  const ehParteCurta = (c) => (c.tagName === 'SPAN' || (c.tagName === 'DIV' && /inline/.test(getComputedStyle(c).display))) && c.textContent.trim().length <= 24 && !c.querySelector('img,svg,video');
  const dividido = (el) => el.children.length > 0 && !textoDireto(el) && Array.from(el.children).every(ehParteCurta) && el.textContent.trim();
  // Bloco com texto MISTO (texto + em/strong/a/br inline): UMA unidade com o texto inteiro na
  // ordem — antes "Farm <em>minerals</em> rock" virava "Farm rock" + "minerals" (revisao Claude).
  const INLINE = /^(EM|STRONG|B|I|U|SPAN|A|SMALL|SUP|SUB|MARK|CODE|ABBR|BR|S|DEL|INS|Q|CITE|TIME)$/;
  const misto = (el) => textoDireto(el) && el.children.length > 0 && Array.from(el.children).every((c) => INLINE.test(c.tagName) && !c.querySelector('img,svg,video,div,p'));
  const textoMisto = (el) => { const partes = []; const andar = (n) => { for (const c of n.childNodes) { if (c.nodeType === 3) partes.push(c.textContent); else if (c.tagName === 'BR') partes.push('\n'); else andar(c); } }; andar(el); return partes.join('').replace(/[ \t\r\f]+/g, ' ').replace(/ *\n */g, '\n').trim(); };
  const out = { textos: [], imagens: [], fundos: [], videos: [], svgs: [], fontes: [], lotties: [] };
  const vistos = new Set();
  let n = { t: 0, i: 0, b: 0, v: 0, s: 0 };
  const chave = (p) => `${p}-${String(++n[p]).padStart(4, '0')}`;
  for (const el of document.body.querySelectorAll('*')) {
    if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(el.tagName)) continue;
    if (el.parentElement && el.parentElement.closest('svg')) continue;   // dentro de SVG (inclui svg aninhado)
    if (el.parentElement && dividido(el.parentElement)) continue;
    if (el.parentElement && el.parentElement.closest('*') && (() => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) if (misto(p)) return true; return false; })()) continue;   // dentro de bloco misto
    const cs = getComputedStyle(el);
    const t = dividido(el) ? colapsar(el.textContent) : (misto(el) ? textoMisto(el) : textoDireto(el));
    if (t) {
      out.textos.push({ chave: chave('t'), texto: t, tag: el.tagName.toLowerCase(), secao: secaoDe(el), ...caixa(el), fonte: cs.fontFamily.split(',')[0].replace(/["']/g, '').trim(), tamanho: cs.fontSize, peso: cs.fontWeight, cor: cs.color, visivel: cs.display !== 'none' && cs.visibility !== 'hidden' });
    }
    if (el.tagName === 'IMG') {
      const p = rel(el.currentSrc || el.getAttribute('src') || el.getAttribute('data-src'));
      if (p && !vistos.has('i:' + p + caixa(el).y)) { vistos.add('i:' + p + caixa(el).y); out.imagens.push({ chave: chave('i'), arquivo: p, alt: el.alt || '', larguraNatural: el.naturalWidth, alturaNatural: el.naturalHeight, secao: secaoDe(el), ...caixa(el) }); }
    }
    if (el.tagName === 'VIDEO') {
      const src = el.currentSrc || el.getAttribute('src') || el.getAttribute('data-src') || (el.querySelector('source') && (el.querySelector('source').getAttribute('src') || el.querySelector('source').getAttribute('data-src')));
      if (!rel(src)) continue;
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
      // TODAS as camadas (gradiente + url, varias urls): o valor inteiro, com cada url mapeada.
      const arquivos = []; const re = /url\((["']?)(.*?)\1\)/g; let m;
      while ((m = re.exec(bg))) { const p = rel(m[2]); if (p) arquivos.push({ url: m[2], arquivo: p }); }
      if (arquivos.length) out.fundos.push({ chave: chave('b'), arquivo: arquivos[0].arquivo, arquivos, valor: bg, tamanho: cs.backgroundSize, posicao: cs.backgroundPosition, secao: secaoDe(el), ...caixa(el) });
    }
  }
  // Fontes: regras @font-face das folhas que o documento carrega (CSSOM, sem regex no CSS).
  // Fontes: @font-face de todas as folhas, INCLUSIVE dentro de @media/@supports e de @import;
  // guarda os descritores (unicode-range, font-stretch...) — sem eles, subconjuntos do mesmo
  // nome se sobrescrevem e glifos somem (revisao Claude).
  let nf = 0;
  const visitar = (regras, base) => {
    for (const r of Array.from(regras || [])) {
      if (r.type === 3 && r.styleSheet) { let rr; try { rr = r.styleSheet.cssRules; } catch { rr = null; } visitar(rr, r.styleSheet.href || base); continue; }
      if (r.cssRules && r.type !== 5) { visitar(r.cssRules, base); continue; }
      if (r.type !== 5) continue;   // CSSFontFaceRule
      const fam = r.style.getPropertyValue('font-family').replace(/["']/g, '').trim();
      const src = r.style.getPropertyValue('src'); const urls = []; const re = /url\((["']?)(.*?)\1\)/g; let m;
      while ((m = re.exec(src))) { const p = rel(new URL(m[2], base || location.href).href); if (p) urls.push(p); }
      const descritores = {};
      for (let i = 0; i < r.style.length; i += 1) { const k = r.style[i]; if (k !== 'src' && k !== 'font-family') descritores[k] = r.style.getPropertyValue(k); }
      if (fam && urls.length) out.fontes.push({ chave: `f-${String(++nf).padStart(4, '0')}`, familia: fam, peso: r.style.getPropertyValue('font-weight') || '400', estilo: r.style.getPropertyValue('font-style') || 'normal', descritores, arquivos: urls });
    }
  };
  for (const sheet of Array.from(document.styleSheets)) { let regras; try { regras = sheet.cssRules; } catch { continue; } visitar(regras, sheet.href || location.href); }
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
