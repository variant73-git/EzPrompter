// REGRAS DE GOSTO x BANCO DE REFERÊNCIAS — o experimento.
//
// A pergunta do dono: as duas fontes de orientação se somam ou se anulam?
// Só dá para responder gerando a MESMA página nas quatro combinações e olhando.
//
//   node scripts/comparar-gosto-e-banco.mjs --brief-file brief.txt --k 3
//   node scripts/comparar-gosto-e-banco.mjs --brief-file brief.txt --seco   (sem gastar)
//   node scripts/comparar-gosto-e-banco.mjs --brief-file brief.txt --k 1 --so-uma
//
// DESENHO (endurecido no advise do Sol, 2026-08-13):
//
// - São QUATRO combinações, não duas: regras ligadas/desligadas x banco
//   ligado/desligado. Comparar só regras on/off não responde a pergunta.
// - "Regras desligadas" usa `guardrails-off`, NUNCA `off`: o `off` leva junto o
//   bloco ABSORB, que é a doutrina de referência — os dois lados passariam a
//   diferir também em COMO usar uma referência (medido em 13/08).
// - `k` repetições por combinação porque o modelo não é determinístico. Com uma
//   de cada, uma diferença pode ser sorte. O verificador é determinístico, então
//   toda a variação vem da geração.
// - ORDEM EMBARALHADA: as 4k gerações saem fora de ordem, para que deriva do
//   provedor ao longo do tempo não se alinhe com uma combinação.
// - Cada geração roda em PROCESSO PRÓPRIO (o estado dos interruptores é lido na
//   importação) e parte do MESMO alvo vazio — nenhuma herda a página anterior.
// - O plano de referências é escolhido UMA vez e congelado em arquivo; nenhuma
//   célula consulta o banco ao vivo.
// - NADA é escrito no banco de dados. O registro é um manifesto local.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

function arg(nome, padrao = null) {
  const i = process.argv.indexOf(`--${nome}`);
  if (i === -1) return padrao;
  const v = process.argv[i + 1];
  return v == null || v.startsWith('--') ? padrao : v;
}

const briefFile = arg('brief-file');
const k = Math.max(1, Number(arg('k', '3')) || 3);
const modelo = arg('model', 'gemini-3.1-pro-preview');
const seco = process.argv.includes('--seco');
const soUma = process.argv.includes('--so-uma');
const pasta = arg('out', path.resolve('_comparacao-gosto-banco'));
if (!briefFile) {
  console.error('uso: node scripts/comparar-gosto-e-banco.mjs --brief-file brief.txt [--k 3] [--model ...] [--seco] [--so-uma]');
  process.exit(2);
}

const CELULAS = [
  { id: 'A', regras: 'on', banco: 'on', nome: 'regras + banco' },
  { id: 'B', regras: 'on', banco: 'off', nome: 'so regras' },
  { id: 'C', regras: 'guardrails-off', banco: 'on', nome: 'so banco' },
  { id: 'D', regras: 'guardrails-off', banco: 'off', nome: 'nenhum dos dois' },
];

await mkdir(pasta, { recursive: true });
const brief = await readFile(briefFile, 'utf8');

// ---- o plano de referências, escolhido UMA vez e congelado ----
const planoArquivo = path.join(pasta, 'plano-de-referencias.json');
let plano = null;
if (seco) {
  // A rodada a seco tambem precisa de um plano — de mentira, mas com a forma
  // certa. Sem ele o braco do banco aparece zerado nas QUATRO celulas, e a
  // rodada nao prova nada justamente sobre a peca nova: um zero sem
  // oportunidade de nao-ser-zero.
  plano = {
    schemaVersion: 3,
    rule: 'One contextual scale owner.',
    selectedReferences: [{
      id: 'seco-1', title: 'Referencia de mentira', url: 'https://exemplo.invalido',
      influence: 'scale-owner', scaleOwner: true,
      owns: 'page-wide type and media scale', reasons: ['rodada a seco'],
    }],
    composition: { preserve: ['section topology and reading order'], adapt: [], replace: ['brand identity'] },
    warnings: [],
  };
  await writeFile(planoArquivo, JSON.stringify(plano, null, 2));
} else {
  const { createReferencePlan } = await import('../lib/reference-planner.js');
  const { getReviewedPlanningCandidates } = await import('../lib/reference-bank-store.js');
  const dono = arg('user-id');
  const candidatos = await getReviewedPlanningCandidates(dono, { includePrivate: true });
  const resultado = createReferencePlan({ brief, candidates: candidatos, maxReferences: 3 });
  if (!resultado.ok) {
    console.error(`o banco nao consegue planejar: ${resultado.error}`);
    process.exit(2);
  }
  plano = resultado.plan;
  await writeFile(planoArquivo, JSON.stringify(plano, null, 2));
  console.log(`plano congelado: ${plano.selectedReferences.map((r) => r.title).join(' · ')}`);
}

// ---- a fila, embaralhada ----
const fila = [];
CELULAS.forEach((celula) => {
  for (let repeticao = 1; repeticao <= k; repeticao += 1) fila.push({ celula, repeticao });
});
const embaralhada = fila
  .map((item, indice) => ({ item, ordem: (indice * 2654435761) % 4294967296 }))
  .sort((a, b) => a.ordem - b.ordem)
  .map((x) => x.item);
const aRodar = soUma ? embaralhada.slice(0, 1) : embaralhada;

console.log(`${aRodar.length} geracoes${seco ? ' (a seco, sem chamar o modelo)' : ''}\n`);

function gerar({ celula, repeticao }) {
  const arquivo = path.join(pasta, `${celula.id}-${repeticao}.html`);
  const argumentos = ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', path.resolve('scripts/gerar-uma-pagina.mjs'),
    '--brief-file', path.resolve(briefFile), '--out', arquivo, '--model', modelo];
  if (plano) argumentos.push('--plan-file', planoArquivo);
  if (seco) argumentos.push('--seco');
  return new Promise((resolve) => {
    const filho = spawn('node', argumentos, {
      env: { ...process.env, UNCRAFT_HOUSESTYLE: celula.regras === 'on' ? '' : celula.regras, UNCRAFT_REFERENCES: celula.banco },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let saida = ''; let erro = '';
    filho.stdout.on('data', (d) => { saida += d; });
    filho.stderr.on('data', (d) => { erro += d; });
    filho.on('close', (codigo) => resolve({
      celula: celula.id, nome: celula.nome, repeticao, arquivo, codigo,
      estado: (() => { try { return JSON.parse(saida.trim().split('\n').pop()); } catch { return null; } })(),
      erro: codigo === 0 ? null : erro.slice(-400),
    }));
  });
}

const registros = [];
for (const trabalho of aRodar) {
  const r = await gerar(trabalho);
  registros.push(r);
  const e = r.estado;
  console.log(`  ${r.celula}-${r.repeticao} ${r.nome.padEnd(18)} ${r.codigo === 0
    ? `ok  regras=${e?.regras} banco=${e?.banco} chars(regras)=${e?.charsDeRegras} chars(ref)=${e?.charsDeReferencia}${e?.segundos ? ` ${e.segundos}s` : ''}`
    : `FALHOU ${r.erro}`}`);
}

const manifesto = {
  quando: new Date().toISOString(),
  brief: brief.slice(0, 400),
  k, modelo, seco,
  celulas: CELULAS,
  plano: plano ? { referencias: plano.selectedReferences.map((r) => ({ id: r.id, title: r.title, url: r.url, papel: r.influence })) } : null,
  geracoes: registros,
};
await writeFile(path.join(pasta, 'manifesto.json'), JSON.stringify(manifesto, null, 2));
console.log(`\nmanifesto: ${path.join(pasta, 'manifesto.json')}`);
console.log('proximo passo: node scripts/relatorio-gosto-e-banco.mjs --pasta ' + pasta);
