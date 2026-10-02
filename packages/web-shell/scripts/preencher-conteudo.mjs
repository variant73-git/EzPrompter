#!/usr/bin/env node
// PREENCHIMENTO DE CONTEÚDO, sem IA (separação de papéis, plano §164).
//
// O agente entrega a estrutura canônica com VAGAS (`data-u-conteudo="<chave>"`) e as fichas de
// movimento; este passo põe o conteúdo REAL da captura nativa em cada vaga, byte a byte:
//   t-  texto            -> textContent
//   i-  imagem           -> <img src>
//   b-  fundo com imagem -> background-image do próprio nó
//   v-  vídeo            -> <video src/poster>
//   s-  SVG desenhado    -> markup dentro do nó
//   l-  Lottie           -> `src` da ficha tipo lottie em motion.json (e data-u-lottie no nó)
//   fontes               -> @font-face de TODAS as fontes do inventário, arquivos copiados
// Os arquivos usados são copiados para assets/conteudo/. O relatório diz o que foi preenchido,
// que chaves não existem e que conteúdo do inventário ficou SEM lugar.
// Uso: node scripts/preencher-conteudo.mjs --canonico <pasta-assets> --inventario <json> --captura <pasta-assets-nativa>
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };

export async function preencher({ canonico, inventario, captura }) {
  const inv = JSON.parse(await readFile(inventario, 'utf8'));
  const porChave = new Map();
  for (const lista of ['textos', 'imagens', 'fundos', 'videos', 'svgs', 'lotties']) for (const x of inv[lista] || []) porChave.set(x.chave, x);
  const html = await readFile(path.join(canonico, 'index.html'), 'utf8');
  const copiar = new Set();
  const destino = (arq) => { copiar.add(arq); return 'conteudo/' + arq.split('/').map(encodeURIComponent).join('/'); };

  // Sem JavaScript: o DOM é só LIDO e alterado como documento, nunca executado.
  const browser = await chromium.launch();
  let saida; let rel;
  try {
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const page = await ctx.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    const itens = Object.fromEntries(porChave);
    for (const x of Object.values(itens)) {
      if (x.arquivo) x.destino = destino(x.arquivo);
      if (x.capa) x.destinoCapa = destino(x.capa);
      if (Array.isArray(x.arquivos)) x.arquivos = x.arquivos.map((a) => (typeof a === 'string' ? a : { ...a, destino: destino(a.arquivo) }));
    }
    rel = await page.evaluate((I) => {
      const r = { preenchidas: 0, chavesInexistentes: [], tipoErrado: [], usadas: [] };
      for (const el of document.querySelectorAll('[data-u-conteudo]')) {
        const k = el.getAttribute('data-u-conteudo'); const x = I[k];
        if (!x) { r.chavesInexistentes.push(k); continue; }
        const p = k.slice(0, 1); const tag = el.tagName;
        // Vaga de texto/svg com outra vaga DENTRO: preencher apagaria a de dentro (revisao Claude).
        if ((p === 't' || p === 's') && el.querySelector('[data-u-conteudo]')) { r.tipoErrado.push(k + ':vaga-aninhada'); continue; }
        if (p === 't') {
          // quebra de linha do original (br) volta como br; o resto e texto
          el.textContent = '';
          x.texto.split('\n').forEach((linha, i) => { if (i) el.appendChild(document.createElement('br')); el.appendChild(document.createTextNode(linha)); });
        }
        else if (p === 'i') { if (tag !== 'IMG') { r.tipoErrado.push(k + '@' + tag); continue; } el.removeAttribute('srcset'); el.setAttribute('src', x.destino); if (x.alt && !el.getAttribute('alt')) el.setAttribute('alt', x.alt); }
        else if (p === 'b') {
          // TODAS as camadas do original, cada url trocada pelo arquivo copiado
          let v = x.valor || `url("${x.destino}")`;
          for (const a of (x.arquivos || [])) if (a && a.url) v = v.split(a.url).join(a.destino);
          el.style.backgroundImage = v;
        }
        else if (p === 'v') { if (tag !== 'VIDEO') { r.tipoErrado.push(k + '@' + tag); continue; } el.setAttribute('src', x.destino); if (x.destinoCapa) el.setAttribute('poster', x.destinoCapa); }
        else if (p === 's') { if (!x.markup) { r.tipoErrado.push(k + ':svg-grande-demais'); continue; } el.innerHTML = x.markup; }
        else if (p === 'l') el.setAttribute('data-u-lottie', x.destino);
        r.preenchidas += 1; r.usadas.push(k);
      }
      return r;
    }, itens);
    // Fontes: @font-face de todas as do inventário, antes de qualquer outro estilo.
    // Com TODOS os descritores do original (unicode-range, font-stretch...).
    const regras = (inv.fontes || []).map((f) => {
      const d = Object.entries(f.descritores || { 'font-weight': f.peso, 'font-style': f.estilo }).map(([k, v]) => `${k}:${v}`).join(';');
      return `@font-face{font-family:"${f.familia}";${d};${/font-display/.test(d) ? '' : 'font-display:swap;'}src:${f.arquivos.map((a) => `url("${destino(a)}")`).join(',')}}`;
    }).join('\n');
    // Idempotente: uma segunda passada substitui, nunca duplica.
    await page.evaluate((css) => { const v = document.getElementById('u-fontes'); if (v) v.remove(); const s = document.createElement('style'); s.id = 'u-fontes'; s.textContent = css; document.head.prepend(s); }, regras);
    saida = '<!doctype html>\n' + await page.evaluate(() => document.documentElement.outerHTML);
  } finally { await browser.close(); }

  // Lottie: a ficha aponta para a chave; troca pelo arquivo copiado.
  const mpath = path.join(canonico, 'motion.json');
  if (existsSync(mpath)) {
    const prog = JSON.parse(await readFile(mpath, 'utf8'));
    for (const f of prog.fichas || []) {
      if (f.tipo !== 'lottie' || typeof f.src !== 'string') continue;
      if (porChave.has(f.src)) { const x = porChave.get(f.src); f.src = destino(x.arquivo); rel.usadas.push(x.chave); rel.preenchidas += 1; }
      else if (/^l-\d+$/.test(f.src)) rel.chavesInexistentes.push(f.src);
      else { const x = (inv.lotties || []).find((l) => destino(l.arquivo) === f.src); if (x) { copiar.add(x.arquivo); rel.usadas.push(x.chave); } }   // ja preenchido antes
    }
    await writeFile(mpath, JSON.stringify(prog, null, 1));
  }
  await writeFile(path.join(canonico, 'index.html'), saida);
  let copiados = 0; const faltando = [];
  for (const a of copiar) {
    const de = path.join(captura, a); const para = path.join(canonico, 'conteudo', a);
    if (!existsSync(de)) { faltando.push(a); continue; }
    await mkdir(path.dirname(para), { recursive: true }); await copyFile(de, para); copiados += 1;
  }
  const usadas = new Set(rel.usadas);
  const semLugar = (lista) => (inv[lista] || []).filter((x) => !usadas.has(x.chave));
  return {
    preenchidas: rel.preenchidas, chavesInexistentes: rel.chavesInexistentes, tipoErrado: rel.tipoErrado,
    arquivosCopiados: copiados, arquivosFaltando: faltando,
    semLugar: {
      textosVisiveis: semLugar('textos').filter((t) => t.visivel).length, textosOcultos: semLugar('textos').filter((t) => !t.visivel).length,
      imagens: semLugar('imagens').length, fundos: semLugar('fundos').length, videos: semLugar('videos').length, svgs: semLugar('svgs').length, lotties: semLugar('lotties').length,
      amostraTextosVisiveis: semLugar('textos').filter((t) => t.visivel).slice(0, 10).map((t) => `${t.chave}: ${t.texto.slice(0, 50)}`),
    },
  };
}

if (process.argv[1] && process.argv[1].endsWith('preencher-conteudo.mjs')) {
  const r = await preencher({ canonico: arg('--canonico'), inventario: arg('--inventario'), captura: arg('--captura') });
  console.log(JSON.stringify(r, null, 1));
}
