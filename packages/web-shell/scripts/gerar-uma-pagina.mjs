// Gera UMA página, com os dois interruptores no estado que o ambiente pedir.
//
// Roda em processo PRÓPRIO de propósito: `HOUSE_STYLE` é constante de módulo,
// lida na importação. No mesmo processo, a segunda célula herdaria o estado da
// primeira e as quatro sairiam iguais sem ninguém perceber.
//
//   UNCRAFT_HOUSESTYLE=guardrails-off UNCRAFT_REFERENCES=off \
//     node scripts/gerar-uma-pagina.mjs --brief-file b.txt --plan-file p.json --out pagina.html
//
// `--seco` percorre tudo sem chamar o modelo: prova o encanamento sem gastar.
import { readFile, writeFile } from 'node:fs/promises';

function arg(nome, padrao = null) {
  const i = process.argv.indexOf(`--${nome}`);
  if (i === -1) return padrao;
  const v = process.argv[i + 1];
  return v == null || v.startsWith('--') ? padrao : v;
}

const briefFile = arg('brief-file');
const planFile = arg('plan-file');
const saida = arg('out');
const modelo = arg('model', 'gemini-3.1-pro-preview');
const seco = process.argv.includes('--seco');
if (!briefFile || !saida) {
  console.error('faltou --brief-file ou --out');
  process.exit(2);
}

const brief = await readFile(briefFile, 'utf8');
const plano = planFile ? JSON.parse(await readFile(planFile, 'utf8')) : null;

const { houseStyleMode, HOUSE_STYLE } = await import('../lib/design/house-style.js');
const { referencesMode, buildReferenceDirective } = await import('../lib/design/reference-directive.js');

const estado = {
  regras: houseStyleMode(),
  banco: referencesMode(),
  charsDeRegras: HOUSE_STYLE.length,
  charsDeReferencia: plano && referencesMode() === 'on' ? buildReferenceDirective(plano).length : 0,
  modelo,
};

// O alvo é o MESMO em todas as células: um esqueleto vazio. Sem isso a
// comparação mediria também a diferença entre alvos.
const alvo = {
  kind: 'site',
  current_html: '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Página</title></head><body></body></html>',
};

if (seco) {
  await writeFile(saida, `<!doctype html><html><body><h1>seco</h1><pre>${JSON.stringify(estado, null, 2)}</pre></body></html>`);
  console.log(JSON.stringify({ ...estado, seco: true }));
  process.exit(0);
}

const { runCompose } = await import('../lib/run-flow.js');
const comecou = Date.now();
const resultado = await runCompose({
  target: alvo,
  sources: [{ kind: 'prompt', meta: { prompt: brief } }],
  model: modelo,
  referencePlan: plano,
});
await writeFile(saida, resultado.html);
console.log(JSON.stringify({
  ...estado,
  segundos: Math.round((Date.now() - comecou) / 1000),
  bytes: resultado.html.length,
  usage: resultado.usage || null,
}));
