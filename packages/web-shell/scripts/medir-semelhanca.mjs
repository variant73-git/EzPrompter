// SEMELHANÇA entre duas imagens (SSIM, −1 a 1) — o instrumento que faltava.
//
// O verificador de regras mede obediência ao house-style; NADA no produto media
// "o clone ficou parecido com o original". O SSIM já existia, mas só dentro da
// pasta Clone/ (QA offline do farmminerals) — pedido antigo do Adilson que ele
// virasse acompanhamento permanente. Este script é a primeira peça: a medida,
// utilizável de qualquer lugar. O acompanhamento por clone vem depois.
//
//   node scripts/medir-semelhanca.mjs original.png clone.png
//   node scripts/medir-semelhanca.mjs original.png clone.png --area-comum
//   node scripts/medir-semelhanca.mjs original.png clone.png --json
//
// Validado contra a implementação independente do QA do Clone/: reproduz os
// números registrados casa por casa (0.9562/0.956194, 0.8424/0.842376…),
// identidade = 1.0000, fatias diferentes = 0.5402, e imagem uniforme dispara o
// aviso de área lisa.
//
// ⚠️ O QUE ESTE NÚMERO NÃO DIZ: SSIM compara pixels alinhados. Um clone perfeito
// deslocado 20px pontua MAL; um clone vazio da mesma cor de fundo pontua BEM.
// A escala vai a −1 (a negação da imagem sai ~−0,5): não é porcentagem. Ler
// sempre junto com o olho — o número acusa deriva, não substitui julgamento.
//
// ⚠️ DIMENSÕES DIFERENTES SÃO RECUSADAS por padrão (achado da auditoria): o
// recorte automático media só o pedaço coincidente e devolvia "1.0000" para um
// clone com 20% da página — número certo da pergunta errada. `--area-comum`
// liga o recorte EXPLICITAMENTE, e aí a cobertura de cada imagem sai junto do
// número, para que ninguém leia semelhança-do-trecho como semelhança-do-clone.
// Largura diferente segue desaconselhada mesmo com a flag: reflow responsivo
// desalinha o conteúdo e o canto superior esquerdo deixa de corresponder.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

function rodar(comando, args) {
  return new Promise((resolve, reject) => {
    let saida = '';
    const filho = spawn(comando, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    filho.stdout.on('data', (d) => { saida += d; });
    filho.stderr.on('data', (d) => { saida += d; });
    filho.on('error', reject);
    filho.on('exit', (codigo) => (codigo === 0 ? resolve(saida) : reject(new Error(`${comando} saiu com ${codigo}\n${saida.slice(-400)}`))));
  });
}

async function dimensoes(arquivo) {
  const s = await rodar('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0', arquivo]);
  const [w, h] = s.trim().split(',').map(Number);
  return { w, h };
}

// Faixa de luminância (YHIGH−YLOW) do recorte: quase zero = área lisa, e fundo
// comparado com fundo pontua alto sem significar nada (lição das réguas do 179).
// O ffmpeg emite `lavfi.signalstats.YLOW=51` — com SINAL DE IGUAL. A primeira
// versão procurava `YLOW:` e nunca casava: o aviso anunciado no cabeçalho estava
// silenciosamente desativado (achado da auditoria; guarda sem teste nasce morta).
async function faixaDeLuminancia(arquivo, w, h) {
  const s = await rodar('ffmpeg', ['-v', 'info', '-i', arquivo,
    '-vf', `crop=${w}:${h}:0:0,signalstats,metadata=print`, '-f', 'null', '-']);
  const lo = s.match(/lavfi\.signalstats\.YLOW=([\d.]+)/);
  const hi = s.match(/lavfi\.signalstats\.YHIGH=([\d.]+)/);
  if (!lo || !hi) return null;
  return Number(hi[1]) - Number(lo[1]);
}

const json = process.argv.includes('--json');
const areaComum = process.argv.includes('--area-comum');
const [a, b] = [process.argv[2], process.argv[3]];
if (!a || !b || !existsSync(a) || !existsSync(b)) {
  console.error('uso: node scripts/medir-semelhanca.mjs original.png clone.png [--area-comum] [--json]');
  process.exit(2);
}

const da = await dimensoes(a);
const db = await dimensoes(b);
const iguais = da.w === db.w && da.h === db.h;
if (!iguais && !areaComum) {
  console.error(`as imagens têm tamanhos diferentes (${da.w}×${da.h} vs ${db.w}×${db.h}).`);
  console.error('comparar só o pedaço coincidente responde OUTRA pergunta — se é isso mesmo,');
  console.error('repita com --area-comum, e a cobertura de cada imagem sai junto do número.');
  process.exit(2);
}
const w = Math.min(da.w, db.w);
const h = Math.min(da.h, db.h);

const s = await rodar('ffmpeg', ['-v', 'info', '-i', a, '-i', b,
  '-lavfi', `[0:v]crop=${w}:${h}:0:0[a];[1:v]crop=${w}:${h}:0:0[b];[a][b]ssim`,
  '-f', 'null', '-']);
// O SSIM vai a NEGATIVO (a negação da imagem sai ~−0,5) — o padrão aceita sinal,
// senão um resultado válido viraria "o ffmpeg não devolveu SSIM" (auditoria).
const m = s.match(/All:\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/);
if (!m) { console.error('ffmpeg nao devolveu SSIM\n' + s.slice(-300)); process.exit(2); }
const ssim = Number(m[1]);
const faixa = await faixaDeLuminancia(a, w, h).catch(() => null);
const lisa = faixa != null && faixa < 24;
const cobertura = {
  daPrimeira: (w * h) / (da.w * da.h),
  daSegunda: (w * h) / (db.w * db.h),
};

if (json) {
  console.log(JSON.stringify({ ssim, areaComparada: { w, h }, cobertura, faixaDeLuminancia: faixa, areaLisa: lisa }));
} else {
  console.log(`SSIM ${ssim.toFixed(4)}  (área comparada ${w}×${h})`);
  if (!iguais) {
    console.log(`⚠️ área comum: cobre ${(cobertura.daPrimeira * 100).toFixed(0)}% da primeira imagem e ${(cobertura.daSegunda * 100).toFixed(0)}% da segunda — o número fala SÓ desse trecho`);
    if (da.w !== db.w) console.log('⚠️ larguras diferentes: reflow responsivo desalinha o conteúdo; este número é pouco confiável');
  }
  if (lisa) console.log('⚠️ a área comparada é quase lisa — fundo contra fundo pontua alto sem significar nada');
}
