// COMBINACAO VERIFICADA (Astra: a regra "a ficha declarada vence" trocava uma observacao MELHOR por
// uma declaracao pior — medido no gsap.com: declarado + observacao 0,689 contra observacao 0,715).
// Cada elemento fica com a fonte que reproduz o SITE melhor, medido contra uma gravacao do site que
// NAO e a usada para dar a nota final (escolha na referencia B, nota na A — senao a escolha se
// avaliaria a si mesma).
//   node scripts/escolher-por-elemento.mjs --canonico <assets> --declarado motion.decl.json
//        --observado motion.leitura.json --referencia ref-b.json --saida motion.escolhido.json
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { comparar, medirCanonico } from './regua-trajetoria.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const dono = (alvo) => alvo.slice(1);

// fichas que nao sao de movimento de elemento (sequencia de canvas, Lottie) vem uma vez so
const extras = (fs) => fs.filter((f) => f.tipo);

// UNIDADE de escolha = a LINHA DE TEMPO inteira (ou a ficha avulsa). Astra r2: tirar um membro de uma
// linha encurta a linha (uma linha arrastada de 2 s vira 1 s e o membro que fica corre no dobro da
// velocidade), entao o programa montado deixava de ser o que foi medido. A linha fica INTEIRA se, na
// media dos seus alvos, reproduz o site pelo menos tao bem quanto a observacao; senao sai inteira e
// todos os seus alvos voltam para a observacao.
export function escolher({ declarado, observado, notasDecl, notasObs, margem = 0 }) {
  const rel = { unidades: 0, unidadesDeclaradas: 0, elementosDeclarados: 0, ficaramDeclarados: 0, voltaramParaObservacao: 0 };
  const unidades = new Map();
  for (const f of declarado.fichas.filter((x) => !x.tipo)) { const u = f.linha || f.id; if (!unidades.has(u)) unidades.set(u, { fichas: [], alvos: new Set() }); const U = unidades.get(u); U.fichas.push(f); [].concat(f.alvo).forEach((a) => U.alvos.add(dono(a))); }
  const media = (l) => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : null);
  const ficam = [];
  for (const [, U] of unidades) {
    rel.unidades += 1;
    const comNota = [...U.alvos].filter((d) => notasDecl[d] !== undefined || notasObs[d] !== undefined);
    const md = media(comNota.map((d) => notasDecl[d] ?? 0)); const mo = media(comNota.map((d) => notasObs[d] ?? 0));
    // sem nota (ninguem move os alvos nas duas medidas) = empate: fica o declarado (a intencao do autor)
    if (md === null || md + margem >= mo) { ficam.push(U); rel.unidadesDeclaradas += 1; }
  }
  const todosDecl = new Set([...unidades.values()].flatMap((U) => [...U.alvos]));
  const tocadosDecl = new Set(ficam.flatMap((U) => [...U.alvos]));
  rel.elementosDeclarados = todosDecl.size; rel.ficaramDeclarados = tocadosDecl.size; rel.voltaramParaObservacao = todosDecl.size - tocadosDecl.size;
  const fichas = [...ficam.flatMap((U) => U.fichas), ...observado.fichas.filter((f) => !f.tipo && ![].concat(f.alvo).some((a) => tocadosDecl.has(dono(a))))];
  const vistos = new Set();
  for (const f of [...extras(declarado.fichas), ...extras(observado.fichas)]) if (!vistos.has(f.id)) { vistos.add(f.id); fichas.push(f); }
  return { programa: { versao: 0, fichas }, relatorio: rel };
}

if (process.argv[1] && process.argv[1].endsWith('escolher-por-elemento.mjs')) {
  const canonico = arg('--canonico'); const ref = JSON.parse(await readFile(arg('--referencia'), 'utf8'));
  const decl = arg('--declarado'); const obs = arg('--observado');
  const ys = ref.amostras.map((s) => s.y);
  const notas = async (programa) => comparar(ref, await medirCanonico(canonico, ys, { programa }), { notas: true }).notasPorDono;
  const t0 = Date.now();
  const notasDecl = await notas(decl); const notasObs = await notas(obs);
  const r = escolher({ declarado: JSON.parse(await readFile(decl, 'utf8')), observado: JSON.parse(await readFile(obs, 'utf8')), notasDecl, notasObs });
  await writeFile(arg('--saida', path.join(canonico, 'motion.escolhido.json')), JSON.stringify(r.programa, null, 1));
  console.log(JSON.stringify({ ...r.relatorio, fichas: r.programa.fichas.length, segundos: Math.round((Date.now() - t0) / 1000) }));
}
