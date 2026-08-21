/**
 * Testemunha do preview animado (item 1, 2026-08-21).
 *
 * Responde DUAS perguntas com medida, não com opinião:
 *   1. o vídeo é realmente gravado e entregue no bundle? (bytes + assinatura)
 *   2. QUANTO custa gravá-lo? (mesma URL, com e sem, tempos lado a lado)
 *
 * A regra de produto do Adilson é "se sacrificar performance, volta pro
 * estático" — então o custo precisa ser um NÚMERO, medido no produtor real.
 *
 * Uso: node scripts/witness-preview-video.mjs [url] [repeticoes]
 */
import { captureNativeBundle } from '../lib/native-clone/capture-bundle.js';
import { PREVIEW_VIDEO_PATH } from '../lib/preview-video.js';

const URL_ALVO = process.argv[2] || 'https://www.farmminerals.com/promo';
const N = Number(process.argv[3] || 2);

async function rodada(preview) {
  const t = Date.now();
  const out = await captureNativeBundle(URL_ALVO, { preview });
  const ms = Date.now() - t;
  const v = out.bundle.assets.find((a) => a.path === PREVIEW_VIDEO_PATH);
  return { ms, assets: out.bundle.assets.length, video: v || null };
}

const comV = []; const semV = [];
for (let i = 0; i < N; i += 1) {
  // Alterna a ordem: rede e cache não podem favorecer sempre o mesmo braço.
  const primeiro = i % 2 === 0;
  if (primeiro) { comV.push(await rodada(true)); semV.push(await rodada(false)); }
  else { semV.push(await rodada(false)); comV.push(await rodada(true)); }
  console.log(`rodada ${i + 1}/${N} ok`);
}

const media = (xs) => Math.round(xs.reduce((s, x) => s + x.ms, 0) / xs.length);
const v = comV.find((r) => r.video)?.video;
console.log('\n── PREVIEW ANIMADO — testemunha ──');
console.log('url            :', URL_ALVO);
console.log('vídeo presente :', v ? 'SIM' : 'NÃO');
if (v) {
  console.log('bytes          :', v.body.byteLength, `(${(v.body.byteLength / 1024 / 1024).toFixed(2)}MB)`);
  console.log('assinatura     :', [...v.body.slice(0, 4)].map((b) => b.toString(16)).join(' '),
    '(esperado: 1a 45 df a3 = container WebM)');
}
console.log('com preview    :', media(comV) + 'ms', comV.map((r) => r.ms).join('/'));
console.log('sem preview    :', media(semV) + 'ms', semV.map((r) => r.ms).join('/'));
const delta = media(comV) - media(semV);
console.log('CUSTO          :', `${delta > 0 ? '+' : ''}${delta}ms`,
  `(${((delta / media(semV)) * 100).toFixed(1)}% sobre a captura)`);
console.log('assets com/sem :', comV[0].assets, '/', semV[0].assets, '(esperado: com = sem + 1)');
