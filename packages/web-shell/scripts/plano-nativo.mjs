// ANALISE do plano visual nativo (opcao b, 2026-10-05): roda o nativo em MODO PLANO (so canvas, fundo
// transparente) com a PLACA DE VIDEO real e mede o que ele pinta. `back` quando o plano cobre a maior
// parte da tela (cena de fundo, landonorris); `front` quando pinta pedacos (gilhuybrecht). As caixas
// VAZIAS da canonica pintadas pelo plano sao as ancoras da cena: o editor trava o layout delas (decisao 1).
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { servir } from './inventario-conteudo.mjs';
import { mapaDaCaptura, arquivoCapturado } from './mapa-da-captura.mjs';
import { injetarModoPlano } from '../lib/native-plane/plane-mode.js';

export const GPU = { channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] };

export async function analisarPlano({ captura, canonica, excluirCanvas = [], ys = null }) {
  const html = await readFile(path.join(captura, 'index.html'), 'utf8');
  const porUrl = mapaDaCaptura(html);
  const { srv, origem } = await servir(path.resolve(captura));
  const canon = await servir(path.resolve(canonica));
  const b = await chromium.launch(GPU);
  try {
    const p = await b.newPage({ viewport: { width: 1440, height: 1200 } });
    let externosAbortados = 0;
    // ORIGEM EXATA (Astra r1: o prefixo "127.0.0.1" deixava passar qualquer porta local e "127.0.0.1.x.com").
    // Toda pagina HTML do nativo entra em modo plano — uma navegacao nao escapa para a pagina inteira.
    await p.route('**/*', async (r) => {
      const req = r.request(); let u; try { u = new URL(req.url()); } catch { return r.abort(); }
      if (u.protocol === 'data:' || u.protocol === 'blob:') return r.continue();
      if (u.origin === origem) {
        if (req.resourceType() !== 'document') return r.continue();
        const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html'; const arq = path.resolve(captura, rel);
        if (!arq.startsWith(path.resolve(captura)) || !existsSync(arq)) return r.continue();
        return r.fulfill({ contentType: 'text/html', body: injetarModoPlano(await readFile(arq, 'utf8'), { excluirCanvas }) });
      }
      const l = arquivoCapturado(porUrl, req.url()); if (!l || !existsSync(path.join(captura, l))) { externosAbortados += 1; return r.abort(); }
      return r.fulfill({ path: path.join(captura, l) });
    });
    const t0 = Date.now();
    // o proprio topo recebe o pronto (parent === window); quem escuta entra ANTES da pagina
    await p.addInitScript(() => { addEventListener('message', (e) => { if (e.data && e.data.tipo === 'u-plano-pronto') window.__uPronto = e.data; }); });
    await p.goto(`${origem}/index.html`, { waitUntil: 'load', timeout: 60000 });
    const anuncio = await p.waitForFunction(() => window.__uPronto, null, { timeout: 15000 }).then((h) => h.jsonValue()).catch(() => null);
    const prontoMs = Date.now() - t0;
    if (!anuncio) return null;
    // "pronto" e o documento carregado; a CENA (texturas, primeiros quadros do WebGL) vem depois — medido no
    // gilhuybrecht: fotografar logo apos o pronto dava cobertura 0 e a analise dizia "sem plano"
    await p.waitForTimeout(ys ? 300 : 3000);
    // o canvas pode nascer DEPOIS do load (o WebGL do gilhuybrecht e criado pelo codigo): conta-se agora
    const nCanvas = await p.evaluate(() => Array.from(document.getElementsByTagName('canvas')).filter((c) => !c.hasAttribute('data-u-plano-fora') && c.getBoundingClientRect().width > 0).length);
    if (!nCanvas) return null;
    const altura = await p.evaluate(() => document.documentElement.scrollHeight);
    const maxY = Math.max(0, altura - 1200);
    const posicoes = ys || [...new Set(Array.from({ length: 6 }, (_, i) => Math.round((maxY * i) / 5)))];
    // canonica numa segunda pagina, nas mesmas posicoes: caixas vazias candidatas a ancora
    const pc = await b.newPage({ viewport: { width: 1440, height: 1200 } });
    await pc.route('**/*', (r) => { let o = null; try { o = new URL(r.request().url()).origin; } catch { o = null; } return o === canon.origem || /^(data|blob):/.test(r.request().url()) ? r.continue() : r.abort(); });
    await pc.goto(`${canon.origem}/index.html`, { waitUntil: 'load' });
    let somaCobertura = 0; const acopladas = new Set();
    for (const y of posicoes) {
      await p.evaluate((yy) => window.scrollTo({ top: yy, behavior: 'instant' }), y); await pc.evaluate((yy) => window.scrollTo({ top: yy, behavior: 'instant' }), y);
      await p.waitForTimeout(ys ? 600 : 1500);
      const png = await p.screenshot({ omitBackground: true });
      const mascara = await pc.evaluate(async (b64) => {
        const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height).data; let pintados = 0;
        const pintado = (x, y) => d[(y * c.width + x) * 4 + 3] > 8;
        for (let y = 0; y < c.height; y += 4) for (let x = 0; x < c.width; x += 4) if (pintado(x, y)) pintados += 1;
        const cobertura = pintados / (Math.ceil(c.height / 4) * Math.ceil(c.width / 4));
        const ancoras = [];
        for (const e of document.body.querySelectorAll('[id^="u-"]')) {
          if (e.textContent.trim() || e.querySelector('img,svg,video') || /^(IMG|SVG|VIDEO|CANVAS)$/i.test(e.tagName)) continue;
          // INTEIRO na tela (Astra r1: area inteira de um lado, fracao pintada so da parte visivel do outro)
          const r = e.getBoundingClientRect(); if (r.width * r.height < 2000 || r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth) continue;
          let dentro = 0; let total = 0;
          for (let y = Math.max(0, Math.floor(r.top)); y < Math.min(c.height, r.bottom); y += 4) for (let x = Math.max(0, Math.floor(r.left)); x < Math.min(c.width, r.right); x += 4) { total += 1; if (pintado(x, y)) dentro += 1; }
          if (total && dentro / total >= 0.5) ancoras.push(e.id);
        }
        return { cobertura, ancoras };
      }, png.toString('base64'));
      somaCobertura += mascara.cobertura; for (const id of mascara.ancoras) acopladas.add(id);
    }
    const cobertura = somaCobertura / posicoes.length;
    // canvas que existe mas nao pinta (300x150 nunca inicializado, cena que falhou): nao ha plano
    if (cobertura < 0.001) return null;
    const colocacao = cobertura >= 0.6 ? 'back' : 'front';
    // cena de fundo pinta tudo: "ancora" ali e so coincidencia — o acoplamento e com a tela
    // so o MAIS INTERNO: caixa que so contem outras ancoras (a grade inteira) nao e ancora (Astra r1)
    const internas = colocacao === 'back' ? [] : await pc.evaluate((ids) => ids.filter((id) => { const e = document.getElementById(id); return e && !ids.some((o) => o !== id && e.contains(document.getElementById(o))); }), [...acopladas]);
    const lista = internas.sort();
    // QUEM MOVE CADA ANCORA decide o que trava (Astra r1 #4: a secao mais proxima, sem limite, travava a pagina
    // inteira no bleibtgleich). No FLUXO, os irmaos a deslocam: a regiao e a secao/cartao que a contem, desde que
    // JUSTO (<= 4x a area da ancora); senao o pai, se justo; senao nenhuma. ABSOLUTA tambem ganha regiao: presa
    // por bottom/right ou em %, ela anda quando um irmao faz o cartao crescer (Astra r5). FIXA na tela (sem
    // ancestral que vire bloco de contencao): nem irmaos nem pais a movem — so ela trava ('fixa' nao prende
    // quem a contem).
    const { regioes, fixas } = !lista.length ? { regioes: [], fixas: [] } : await pc.evaluate((ids) => {
      const area = (x) => { const q = x.getBoundingClientRect(); return q.width * q.height; };
      const fixaNaTela = (e) => {
        if (getComputedStyle(e).position !== 'fixed') return false;
        for (let a = e.parentElement; a && a !== document.documentElement; a = a.parentElement) {
          const cs = getComputedStyle(a);
          // qualquer criador de bloco de contencao para fixed (Astra r3: translate/rotate/scale avulsos tambem)
          if (cs.transform !== 'none' || cs.translate !== 'none' || cs.rotate !== 'none' || cs.scale !== 'none'
            || cs.filter !== 'none' || cs.perspective !== 'none' || cs.backdropFilter !== 'none' || cs.transformStyle === 'preserve-3d'
            || /paint|layout|strict|content/.test(cs.contain) || (cs.containerType && cs.containerType !== 'normal')
            || (cs.contentVisibility && cs.contentVisibility !== 'visible')
            || /transform|translate|rotate|scale|filter|perspective|contain/.test(cs.willChange)) return false;
        }
        return true;
      };
      const reg = new Set(); const fix = [];
      for (const id of ids) {
        const e = document.getElementById(id); const p = e && e.parentElement; if (!p) continue;
        if (fixaNaTela(e)) { fix.push(id); continue; }
        const limite = 4 * Math.max(1, area(e));
        const justa = (r) => r && r !== document.body && r !== document.documentElement && area(r) <= limite;
        const sem = p.closest('section,header,footer,nav,article,aside');
        const r = justa(sem) ? sem : (justa(p) ? p : null);
        if (r && r.id && !ids.includes(r.id)) reg.add(r.id);
      }
      return { regioes: [...reg].sort(), fixas: fix.sort() };
    }, lista);
    return { versao: 1, colocacao, cobertura: Math.round(cobertura * 1000) / 1000, canvas: nCanvas, excluirCanvas, acoplamento: lista.length ? 'ancoras' : 'viewport', acopladas: lista, regioes, fixas, prontoMs, externosAbortados };
  } finally { await b.close(); srv.close(); canon.srv.close(); }
}
