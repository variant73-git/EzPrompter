// REGUA DE TRAJETORIA: o portao (verbatim-gate) compara 24 PARADAS; esta compara o CAMINHO entre
// elas. A gravacao do site (normalizar-clone --movimento grava `gravacao-nativa.json`: o estado
// proprio de cada elemento, por id canonico, a cada `passo` px) e confrontada com o clone canonico
// tocando o seu programa de movimento, na MESMA rolagem e no MESMO instante apos parar (1100 ms).
//
// So entra elemento que o SITE move (em alguma parada o estado dele difere do estado no topo), e
// dele entram TODAS as paradas — inclusive as em repouso. A 1a versao contava so as paradas em que
// o site ja tinha se mexido, e um programa VAZIO ganhava nota cheia nas revelacoes (a canonica e
// assada com o estado revelado; revisao Claude #1). Contar o repouso pune quem nao esconde.
// ⚠️ Medir num grade DIFERENTE da que gerou o caminho 1 (revisao Claude #2): o gravador poe cada
// quadro exatamente nos y da gravacao — corrigido ali, ele e exato por construcao. Use uma gravacao
// do site independente, com `--deslocamento` (normalizar-clone), como referencia.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { servir } from './inventario-conteudo.mjs';
import { medirProprio, difere } from './gravar-trajetoria.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };

// nome do arquivo do quadro (o site pede o endereco de origem, a canonica o caminho local)
export const nomeDoQuadro = (u) => { try { return decodeURIComponent(String(u).split(/[?#]/)[0].split('/').pop()); } catch { return String(u); } };
// diferenca para a REGUA: ausencia/display:none (null) e um estado; o quadro do canvas tambem
// visibilidade EFETIVA tambem: `difere` (do gravador) compara a propria, e escondido-por-heranca de um
// lado contra visivel do outro passava como igual
export function difereRegua(nat, can) { return canalQueDifere(nat, can) !== null; }
// o 1o canal em que os dois estados diferem (para o relatorio dizer O QUE erra), ou null
export function canalQueDifere(p, q) {
  if (p == null || q == null) return (p == null) !== (q == null) ? 'presenca' : null;
  if ((p.vef ?? 1) !== (q.vef ?? 1)) return 'visibilidade';
  if (p.vef === 0) return null;   // os dois escondidos: iguais para quem ve
  if ((p.quadro !== undefined || q.quadro !== undefined) && p.quadro !== q.quadro) return 'quadro';   // nos dois sentidos (Astra r2 #1)
  if (!difere(p, q)) return null;
  if (Math.abs(p.x - q.x) > 1 || Math.abs(p.y - q.y) > 1) return 'posicao';
  if (Math.abs(p.op - q.op) > 0.01) return 'opacidade';
  if (Math.abs(p.sx - q.sx) > 0.005 || Math.abs(p.sy - q.sy) > 0.005) return 'escala';
  if (Math.abs(p.r - q.r) > 0.5) return 'rotacao';
  if (p.clip !== q.clip) return 'recorte';
  if (p.vis !== q.vis) return 'visibilidadePropria';
  const nm = Object.keys(p.css || {}).find((k) => q.css && k in q.css && p.css[k] !== q.css[k]);
  return nm ? 'css:' + nm : 'outro';
}

// NOTA (Astra r1 #1): entra todo elemento que o SITE move OU que o CLONE move — movimento que o site
// nao tem e erro, nao neutro. Cada elemento e julgado em duas FASES: repouso (o site igual ao topo) e
// movido (o site diferente do topo); a nota dele e a media das fases que existem. Sem isso, uma
// revelacao que muda na 2a parada e fica revelada por 100 paradas dava 0,99 a um clone parado.
// O topo (y=0) entra. `fracao` (todos os pares) segue no relatorio, mas a nota e `balanceada`.
// NOTA (Astra r1 #1, r2 #1/#2). Entra todo id que o SITE move ou que o CLONE move (inclusive id que
// so existe no clone, como a parte de um texto que so o clone corta). Cada parada cai numa FASE:
//   M = o site se moveu (difere do seu 1o estado);  R = os dois em repouso;  F = o site em repouso e
//   o clone movido (movimento que o site nao tem).
// A nota do elemento e a media das fases presentes — uma excursao espuria de UMA parada entre cem
// derruba a nota para 0,5, e uma revelacao que o clone nao faz tambem. Canal CSS que so o clone
// escreve (o site nunca o animou) conta como movimento do clone. Texto cortado em PARTES vale como
// UM elemento (media das suas partes), senao um titulo de 124 letras pesava 124 vezes.
// `excluir`: donos que NAO se julgam por trajetoria — os que duas gravacoes do PROPRIO site ja
// discordam (lacos, tempo: a fase muda de uma carga para outra, e um laco certo fora de fase perdia
// para um laco parado). Esses se julgam pela energia de movimento do portao, nao aqui.
export function comparar(gravacao, medida, { excluir = null, notas: devolverNotas = false } = {}) {
  const N = gravacao.amostras.length;
  const ids = new Set(); gravacao.amostras.forEach((s) => Object.keys(s.b).forEach((k) => ids.add(k)));
  medida.forEach((m) => Object.keys(m || {}).forEach((k) => ids.add(k)));
  const primeiro = (serie) => serie.find((v) => v !== undefined);
  let pares = 0; let certos = 0; let erroPx = 0; let nPx = 0;
  const porDono = new Map(); const errosPorCanal = {}; const fases = { M: [0, 0], R: [0, 0], F: [0, 0] };
  let soNoClone = 0; let notaSoNoClone = 0; let telas = 0; let telasCertas = 0;
  for (const id of ids) {
    if (excluir && excluir.has(id.includes('--') ? id.split('--')[0] : id)) continue;
    const nat = gravacao.amostras.map((s) => (id in s.b ? s.b[id] : undefined));
    const can = Array.from({ length: N }, (_, i) => (medida[i] && id in medida[i] ? medida[i][id] : undefined));
    const nRef = primeiro(nat); const cRef = primeiro(can);
    const temNat = nat.some((v) => v !== undefined);
    // canais CSS que so o clone tem (o site nunca os escreveu): mudanca neles e movimento do clone
    const cssNat = new Set(); nat.forEach((v) => v && v.css && Object.keys(v.css).forEach((k) => cssNat.add(k)));
    const cssSoClone = new Set(); can.forEach((v) => v && v.css && Object.keys(v.css).forEach((k) => { if (!cssNat.has(k)) cssSoClone.add(k); }));
    const cssMudou = (v) => v && cRef && [...cssSoClone].some((k) => v.css && cRef.css && v.css[k] !== cRef.css[k]);
    const cloneMovido = (v) => v !== undefined && (difereRegua(v, cRef) || cssMudou(v));
    const natMovido = (v) => v !== undefined && difereRegua(v, nRef);
    const natMove = nat.some(natMovido); const canMove = can.some(cloneMovido);
    if (!natMove && !canMove) continue;   // ninguem move: qualquer programa acerta de graca
    const f = { M: [0, 0], R: [0, 0], F: [0, 0] };
    for (let i = 0; i < N; i += 1) {
      const v = nat[i]; const c = can[i];
      if (!temNat) {   // id so do clone: a verdade e o site PARADO
        if (c === undefined) continue;
        const ok = !cloneMovido(c); const fa = ok ? 'R' : 'F';
        f[fa][0] += 1; if (ok) f[fa][1] += 1; else errosPorCanal.soNoClone = (errosPorCanal.soNoClone || 0) + 1;
        continue;
      }
      if (v === undefined) continue;   // o site nao tinha o elemento nesta parada
      let canal = c === undefined ? 'ausenteNoClone' : canalQueDifere(v, c);
      if (canal === null && cssMudou(c) && !natMovido(v)) canal = 'cssSoNoClone';
      const ok = canal === null;
      const fa = natMovido(v) ? 'M' : cloneMovido(c) ? 'F' : 'R';
      f[fa][0] += 1; if (ok) f[fa][1] += 1; else errosPorCanal[canal] = (errosPorCanal[canal] || 0) + 1;
      pares += 1; if (ok) certos += 1;
      if (v && c) { erroPx += Math.hypot(v.x - c.x, v.y - c.y); nPx += 1; }
      if (v && v.quadro !== undefined) { telas += 1; if (ok) telasCertas += 1; }
    }
    for (const k of Object.keys(f)) { fases[k][0] += f[k][0]; fases[k][1] += f[k][1]; }
    const ps = Object.values(f).filter(([n]) => n).map(([n, c]) => c / n);
    if (!ps.length) continue;
    const nota = ps.reduce((a, b) => a + b, 0) / ps.length;
    const dono = id.includes('--') ? id.split('--')[0] : id;
    if (!porDono.has(dono)) porDono.set(dono, { texto: false, notas: [] });
    const d = porDono.get(dono); d.notas.push(nota); if (id.includes('--')) d.texto = true;
    if (!natMove) { soNoClone += 1; notaSoNoClone += nota; }
  }
  const r3 = (x) => Number(x.toFixed(3));
  const media = (l) => (l.length ? r3(l.reduce((a, b) => a + b, 0) / l.length) : null);
  const donos = [...porDono.entries()].map(([dono, d]) => ({ dono, texto: d.texto, nota: d.notas.reduce((a, b) => a + b, 0) / d.notas.length }));
  const el = donos.filter((d) => !d.texto).map((d) => d.nota); const tx = donos.filter((d) => d.texto).map((d) => d.nota);
  return {
    balanceada: media(donos.map((d) => d.nota)),
    porTipo: { elementos: { n: el.length, balanceada: media(el) }, textosEmPartes: { n: tx.length, balanceada: media(tx) } },
    fases: Object.fromEntries(Object.entries(fases).map(([k, [n, c]]) => [k, { paradas: n, certas: c }])),
    fracao: pares ? r3(certos / pares) : null, paresComparados: pares, paresCertos: certos,
    elementosJulgados: donos.length, elementosFieis80: donos.filter((d) => d.nota >= 0.8).length,
    movimentoSoNoClone: soNoClone, notaMediaSoNoClone: soNoClone ? r3(notaSoNoClone / soNoClone) : null,
    quadrosDeCanvas: telas, quadrosCertos: telasCertas, errosPorCanal,
    erroMedioDeslocamentoPx: nPx ? Number((erroPx / nPx).toFixed(1)) : null,
    ...(devolverNotas ? { notasPorDono: Object.fromEntries(donos.map((d) => [d.dono, d.nota])) } : {}),
  };
}
// donos em que o site discorda de si mesmo (nota < limiar entre duas gravacoes dele)
export function instaveisDoSite(refA, refB, limiar = 0.9) {
  const r = comparar(refA, refB.amostras.map((s) => s.b), { notas: true });
  return new Set(Object.entries(r.notasPorDono).filter(([, n]) => n < limiar).map(([d]) => d));
}

// `forcar`: id -> propriedades CSS que o SITE animou (inline). No clone elas sao lidas sempre: um
// programa que nao anima a altura nunca a escreve inline, e a leitura so-inline deixaria de
// compara-la — premiaria o programa que faz MENOS.
// os GEMEOS sao os mesmos? (r2 #1c) — a referencia vem de outra normalizacao; um elemento a mais ou
// a menos desloca os sufixos -2/-3 e a regua compararia elementos trocados
// so o CORPO: o cabecalho da canonica tem <style id="u-fontes"> e <style id="u-estilo"> (r3 #1 — a
// versao que lia o documento inteiro recusava TODA comparacao)
// Cada id leva a marca DEFINICAO PURA: svg sem area que nenhum <use> da pagina usa (a biblioteca de icones do
// Framer muda de tamanho entre cargas — o uptechsoft era recusado por 6 desenhos que ninguem ve). A conferencia
// casa os comuns independente da marca e so dispensa a definicao pura que sobra de UM lado (Astra: descartar por
// area antes de casar recusava gemeo certo e escondia ausencia real). Gemeo de mapasDaPagina (normalizar-clone).
export function idsDoCorpo() {
  const usados = new Set(Array.from(document.querySelectorAll('use')).map((u) => (u.getAttribute('href') || u.getAttribute('xlink:href') || '').replace(/^#/, '')));
  const pura = (e) => e.tagName.toLowerCase() === 'svg' && !usados.has(e.id) && (() => { const r = e.getBoundingClientRect(); return r.width === 0 || r.height === 0; })();
  return Array.from(document.body.querySelectorAll('[id]')).filter((e) => !/^(STYLE|SCRIPT)$/.test(e.tagName)).map((e) => [e.id, e.tagName.toLowerCase(), pura(e)]);
}
export function conferirIds(idsRef, idsCanon) {
  const c = new Map(idsCanon.map(([id, t]) => [id, t])); const r = new Map(idsRef.map(([id, t]) => [id, t]));
  const faltam = idsRef.filter(([id, , pura]) => !c.has(id) && pura !== true).map(([id]) => id);
  const sobram = idsCanon.filter(([id, , pura]) => /^u-/.test(id) && !r.has(id) && pura !== true).map(([id]) => id);
  const outraTag = idsRef.filter(([id, t]) => c.has(id) && c.get(id) !== t).map(([id]) => id);
  return { ok: !faltam.length && !sobram.length && !outraTag.length, faltam, sobram, outraTag };
}

export async function medirCanonico(pasta, ys, { atributo = 'id', espera = 1100, forcar = {}, programa = null } = {}) {
  const { srv, origem } = await servir(path.resolve(pasta));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    // --programa (Astra r1 #3): o tocador so le motion.json; a regua serve o programa pedido no lugar
    if (programa) { const corpo = await readFile(programa); await page.route(/\/motion\.json(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: corpo })); }
    // o que cada <canvas> desenhou por ultimo (Astra r1 #2: um canvas parado no quadro errado era
    // indistinguivel da sequencia certa)
    await page.addInitScript(() => {
      const ult = (window.__uUlt = new WeakMap()); const orig = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function (img, ...a) { try { if (img && img.tagName === 'IMG') ult.set(this.canvas, img.currentSrc || img.src); } catch (e) { /* medir nao derruba */ } return orig.call(this, img, ...a); };
    });
    await page.goto(`${origem}/index.html`, { waitUntil: 'load', timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(3000);
    await page.evaluate((pi) => { window.__uPropsInline = pi; }, (await import('./gravar-trajetoria.mjs')).PROPS_INLINE);
    const out = [];
    const idsCanon = await page.evaluate(idsDoCorpo);
    out.idsCanon = idsCanon;
    const ler = ([attr, fz]) => { const o = {}; for (const [id, props] of Object.entries(fz)) { const el = document.querySelector(`[${attr}="${CSS.escape(id)}"]`); if (!el) continue; const cs = getComputedStyle(el); o[id] = Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)])); } return o; };
    for (const y of ys) {
      // mesmo ritmo da gravacao: uma leitura (descartada) aos 300 ms, a que vale ~800 ms depois
      await page.evaluate((v) => window.scrollTo(0, v), y); await page.waitForTimeout(300); await page.evaluate(medirProprio, atributo); await page.waitForTimeout(Math.max(0, espera - 300));
      // partes de texto cortado pelo tocador (`data-u-parte` = id--n), na mesma chave das do site
      const m = { ...(await page.evaluate(medirProprio, 'data-u-parte')), ...(await page.evaluate(medirProprio, atributo)) }; const css = await page.evaluate(ler, [atributo, forcar]);
      for (const [id, c] of Object.entries(css)) if (m[id]) m[id].css = { ...(m[id].css || {}), ...c };
      const qs = await page.evaluate((attr) => Array.from(document.querySelectorAll(`canvas[${attr}]`)).map((c) => [c.getAttribute(attr), window.__uUlt && window.__uUlt.get(c)]).filter(([, u]) => u), atributo);
      for (const [id, u] of qs) if (m[id]) m[id].quadro = nomeDoQuadro(u);
      out.push(m);
    }
    return out;
  } finally { await browser.close(); srv.close(); }
}

if (process.argv[1] && process.argv[1].endsWith('regua-trajetoria.mjs')) {
  const gravacao = JSON.parse(await readFile(arg('--gravacao'), 'utf8'));
  const t0 = Date.now();
  const forcar = {}; for (const s of gravacao.amostras) for (const [id, v] of Object.entries(s.b)) if (v && v.css) for (const p of Object.keys(v.css)) (forcar[id] ||= new Set()).add(p);
  const programa = arg('--programa', null);
  const medida = await medirCanonico(arg('--canonico'), gravacao.amostras.map((s) => s.y), { programa, forcar: Object.fromEntries(Object.entries(forcar).map(([k, v]) => [k, [...v]])) });
  const prog = programa || path.join(arg('--canonico'), 'motion.json');
  const hashProg = (await import('node:crypto')).createHash('sha1').update(await readFile(prog)).digest('hex').slice(0, 12);
  const ids = gravacao.ids ? conferirIds(gravacao.ids, medida.idsCanon) : { ok: false, faltam: ['referencia sem lista de ids'] };
  // UNCRAFT_REGUA_TOLERAR_IDS=<n> (2026-10-07, bateria custo x qualidade): site cuja estrutura varia um pouco
  // entre cargas (uptechsoft: um texto <p> numa, <span> na outra) — aceita ate n nomes divergentes e julga o
  // que existe nos dois; elemento da referencia ausente no clone conta como ERRO (nunca some da conta)
  const tolerar = Number(process.env.UNCRAFT_REGUA_TOLERAR_IDS) || 0;
  const divergentes = ids.ok ? 0 : ids.faltam.length + ids.sobram.length + ids.outraTag.length;
  if (!ids.ok && divergentes <= tolerar) { ids.ok = true; ids.tolerados = divergentes; }
  if (!ids.ok) { console.log(JSON.stringify({ veredito: 'RECUSADA: os ids da referencia nao sao os do clone', faltam: ids.faltam.slice(0, 10), sobram: ids.sobram.slice(0, 10), outraTag: ids.outraTag.slice(0, 10), contagem: [ids.faltam.length, ids.sobram.length, ids.outraTag.length] }, null, 1)); process.exit(2); }
  if (arg('--salvar')) await (await import('node:fs/promises')).writeFile(arg('--salvar'), JSON.stringify(medida));
  console.log(JSON.stringify({ programa: path.basename(prog), hashPrograma: hashProg, ...comparar(gravacao, medida), deslocamento: gravacao.deslocamento ?? 0, ...(ids.tolerados ? { idsToleradas: ids.tolerados } : {}), segundos: Math.round((Date.now() - t0) / 1000) }, null, 1));
}
