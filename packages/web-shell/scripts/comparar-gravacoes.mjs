// COMPARA DUAS GRAVACOES do mesmo site (2026-10-06, encurtar a gravacao sem perder fidelidade). Rodar duas
// vezes o MESMO codigo da a variacao natural (animacoes vivas nunca dao identico); uma mudanca de codigo so e
// aceita se a diferenca contra a referencia ficar dentro dela. Compara TUDO o que decide o resultado (Astra +
// Codex: comparar so alvo/janela das fichas deixava passar animacoes radicalmente diferentes):
//   - fichas (assets/motion.json): CADA valor de de/para/quadros/duracao/curva/motor/imagens, com tolerancia
//     numerica pelo nome do canal (px 1, opacidade 0,01, escala 0,005, rotacao 0,5 grau);
//   - rastro (UNCRAFT_RASTRO): as DUAS leituras (a e b) por parada e id, o que cada canvas mostrava nelas,
//     os lacos confirmados e o historico de desenho dos canvas;
//   - a pagina canonica montada (assets/index.html), linha a linha.
//   node scripts/comparar-gravacoes.mjs <pastaA> <pastaB>   (cada pasta: assets/, rastro.json)
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { difere } from './gravar-trajetoria.mjs';

// tolerancia SO onde o canal e medido em pixels ou e uma medida visual continua; todo o resto (duracao, inicio,
// fim, contagens...) e EXATO (Astra r3: um padrao de 1 deixava duracao 0,2 x 1,2 passar como igual)
const PX = ['x', 'y', 'z', 'top', 'left', 'right', 'bottom', 'width', 'height', 'maxWidth', 'maxHeight', 'letterSpacing', 'borderRadius', 'backgroundPositionX', 'backgroundPositionY'];
const TOL = { opacity: 0.01, autoAlpha: 0.01, scale: 0.005, scaleX: 0.005, scaleY: 0.005, rotation: 0.5, rotate: 0.5, ...Object.fromEntries(PX.map((k) => [k, 1])) };
const numeroPx = /^-?[\d.]+px$/;
// diferenca entre dois valores de ficha (null = iguais dentro da tolerancia). A tolerancia vale pelo CAMINHO,
// nao pelo nome (Astra r4: um `x` de ponto de curva ganharia 1 px): so dentro dos VALORES ANIMADOS (de, para,
// quadros) um canal medido em pixel ou visual continuo tem folga; fora deles, tudo exato.
const VALORES = new Set(['de', 'para', 'quadros']);
export function diferencaDeValor(u, v, nome = '', emValores = false) {
  const tol = emValores ? (TOL[nome] ?? 1e-9) : 1e-9;
  if (typeof u === 'number' && typeof v === 'number') return Math.abs(u - v) <= tol ? null : `${nome}: ${u} x ${v}`;
  if (emValores && typeof u === 'string' && typeof v === 'string' && numeroPx.test(u) && numeroPx.test(v)) return Math.abs(parseFloat(u) - parseFloat(v)) <= 1 ? null : `${nome}: ${u} x ${v}`;
  if (Array.isArray(u) || Array.isArray(v)) {
    if (!Array.isArray(u) || !Array.isArray(v) || u.length !== v.length) return `${nome}: tamanho ${u && u.length} x ${v && v.length}`;
    for (let i = 0; i < u.length; i += 1) { const d = diferencaDeValor(u[i], v[i], nome, emValores); if (d) return `${nome}[${i}] ${d}`; }
    return null;
  }
  if (u && v && typeof u === 'object' && typeof v === 'object') {
    for (const k of new Set([...Object.keys(u), ...Object.keys(v)])) {
      if (k === 'id' && !emValores) continue;   // numeracao da ficha (m-leit-NNN) — a ordem ja entra na chave
      const d = diferencaDeValor(u[k], v[k], k, emValores || VALORES.has(k)); if (d) return d;
    }
    return null;
  }
  return u === v ? null : `${nome}: ${JSON.stringify(u)} x ${JSON.stringify(v)}`;
}

const chave = (f) => [f.tipo || 'elemento', [].concat(f.alvo).join(','), f.motor && f.motor.tipo, f.motor && f.motor.inicio, f.motor && f.motor.fim].join('|');

export function compararFichas(fa, fb) {
  const r = { fichasA: fa.length, fichasB: fb.length, soA: [], soB: [], valoresDiferentes: [] };
  const resto = fb.map((f) => ({ f, k: chave(f) }));
  for (const f of fa) {
    const k = chave(f); const i = resto.findIndex((x) => x.k === k);
    if (i < 0) { r.soA.push(k); continue; }
    const d = diferencaDeValor(f, resto[i].f); if (d) r.valoresDiferentes.push(`${k} -> ${d}`);
    resto.splice(i, 1);
  }
  r.soB = resto.map((x) => x.k);
  return r;
}

// o servidor local da captura muda de porta a cada rodada: o endereco do quadro so vale do caminho em diante
const semOrigem = (x) => JSON.stringify(x ?? null).replace(/https?:\/\/(127\.0\.0\.1|localhost):\d+/g, '');
export function compararRastros(A, B) {
  const r = { paradasA: A.amostras.length, paradasB: B.amostras.length, pares: 0, aDiferente: 0, bDiferente: 0, soNumLado: 0, telasDiferentes: 0, elementosDiferentes: new Set() };
  const porY = new Map(B.amostras.map((s) => [s.y, s]));
  for (const s of A.amostras) {
    const o = porY.get(s.y); if (!o) { r.soNumLado += Object.keys(s.b).length; continue; }
    for (const leitura of ['a', 'b']) {
      const p = s[leitura] || {}; const q = o[leitura] || {};
      for (const id of new Set([...Object.keys(p), ...Object.keys(q)])) {
        if (id.startsWith('rec:')) continue;   // sem id na canonica: nome provisorio, muda entre rodadas, nao vira ficha
        if (!(id in p) || !(id in q)) { r.soNumLado += 1; continue; }
        if (leitura === 'b') r.pares += 1;
        if (difere(p[id], q[id])) { r[leitura === 'a' ? 'aDiferente' : 'bDiferente'] += 1; r.elementosDiferentes.add(id); }
      }
    }
    for (const t of ['telasA', 'telas']) if (semOrigem(s[t] || {}) !== semOrigem(o[t] || {})) r.telasDiferentes += 1;
  }
  r.lacosIguais = JSON.stringify(A.lacos) === JSON.stringify(B.lacos);
  r.lacosA = A.lacos.length; r.lacosB = B.lacos.length;
  const seq = (R) => semOrigem((R.sequencias || []).map((q) => [q.rec, q.ordem, q.outros, q.ultimo]).sort());
  r.sequenciasIguais = seq(A) === seq(B);
  r.elementosDiferentes = [...r.elementosDiferentes];
  return r;
}

export function compararPaginas(ha, hb) {
  const la = ha.split('\n'); const lb = hb.split('\n'); let dif = Math.abs(la.length - lb.length);
  for (let i = 0; i < Math.min(la.length, lb.length); i += 1) if (la[i] !== lb[i]) dif += 1;
  return { identica: ha === hb, linhasDiferentes: dif };
}

if (process.argv[1] && process.argv[1].endsWith('comparar-gravacoes.mjs')) {
  const [da, db] = process.argv.slice(2);
  const json = (d, f) => JSON.parse(readFileSync(path.join(d, f), 'utf8'));
  const fichas = compararFichas(json(da, 'assets/motion.json').fichas, json(db, 'assets/motion.json').fichas);
  const out = { fichas: { ...fichas, soA: fichas.soA.slice(0, 6), soB: fichas.soB.slice(0, 6), nSoA: fichas.soA.length, nSoB: fichas.soB.length, nValores: fichas.valoresDiferentes.length, valoresDiferentes: fichas.valoresDiferentes.slice(0, 6) } };
  if (existsSync(path.join(da, 'rastro.json')) && existsSync(path.join(db, 'rastro.json'))) {
    const r = compararRastros(json(da, 'rastro.json'), json(db, 'rastro.json'));
    out.rastro = { ...r, nElementos: r.elementosDiferentes.length, elementosDiferentes: r.elementosDiferentes.slice(0, 8) };
  }
  out.pagina = compararPaginas(readFileSync(path.join(da, 'assets/index.html'), 'utf8'), readFileSync(path.join(db, 'assets/index.html'), 'utf8'));
  console.log(JSON.stringify(out));
}
