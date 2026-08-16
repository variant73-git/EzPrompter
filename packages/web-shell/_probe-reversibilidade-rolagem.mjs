// PROBE — as reações da rolagem MACHUCAM, ou são inofensivas?
//
// O censo (`_probe-censo-movimento.mjs`) mostrou que 52% dos sites-alvo reagem
// quando a régua rola. Ele NÃO disse se isso importa: uma reação que só atualiza
// uma barra de progresso é inofensiva; uma que lança animação ou consome um
// gatilho de uma vez só estraga o que o designer está julgando.
//
// A pergunta de produto, na forma exata: **quando a régua volta para a mesma
// posição, o designer vê a mesma coisa?**
//
// DESENHO
//   A1 = estado na posição P, assentado
//   A2 = estado na MESMA posição P, sem sair, depois do mesmo tempo
//        → diferença(A1,A2) é o RUÍDO PRÓPRIO do site (vídeo tocando, loop
//          ocioso, animação infinita). Não é reação à régua.
//   B  = estado em P depois de SAIR e VOLTAR
//        → diferença(A2,B) acima do ruído é o efeito da régua.
//
// ⚠️ Sem o braço de ruído, todo site com um vídeo ou um marquee daria "reação
// enorme" e o número não significaria nada. É a mesma calibração que o Sol
// exigiu para o experimento grande: comparar contra o ruído medido, nunca
// contra um limiar arbitrário.
//
// A impressão digital é do DOM, não de pixels: classe, opacidade, caixa e
// transform de cada elemento visível. Isso ignora de graça o conteúdo interno de
// vídeo e canvas — que muda sempre e não é reação à régua.
//
// Uso: node _probe-reversibilidade-rolagem.mjs <url>
import { chromium } from 'playwright-core';

const url = process.argv[2];
if (!url) { console.error('uso: node _probe-reversibilidade-rolagem.mjs <url>'); process.exit(2); }

const ASSENTAR = 1200; // mesmo tempo em TODAS as fases — senão a comparação é injusta

const IMPRESSAO = () => {
  const alt = window.innerHeight;
  const mapa = new Map();
  let n = 0;
  for (const el of document.querySelectorAll('body *')) {
    if (n >= 1200) break;
    const r = el.getBoundingClientRect();
    if (r.bottom < -alt || r.top > alt * 2 || (r.width === 0 && r.height === 0)) continue;
    const cs = getComputedStyle(el);
    const chave = [
      el.tagName,
      el.className && typeof el.className === 'string' ? el.className.trim() : '',
      Math.round(parseFloat(cs.opacity) * 100),
      Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height),
      cs.transform === 'none' ? '' : cs.transform.replace(/[\d.-]+/g, (m) => Math.round(parseFloat(m))),
      cs.visibility,
    ].join('|');
    mapa.set(chave, (mapa.get(chave) || 0) + 1);
    n += 1;
  }
  return { entradas: [...mapa.entries()], total: n };
};

// Diferença de multiconjunto: some |contagemA - contagemB| por chave. Não usa
// índice de documento — um elemento inserido no topo deslocaria TODOS os índices
// e forjaria uma diferença gigante que não existe.
function diferenca(a, b) {
  const ma = new Map(a.entradas); const mb = new Map(b.entradas);
  let d = 0;
  for (const [k, v] of ma) d += Math.abs(v - (mb.get(k) || 0));
  for (const [k, v] of mb) if (!ma.has(k)) d += v;
  return d;
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const resultado = { url };

try {
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(2500);

  const altura = await page.evaluate(() => document.body.scrollHeight);
  // Percorre a página inteira uma vez: muita animação só NASCE ao ser vista, e
  // medir antes disso compararia dois estados igualmente vazios.
  for (let y = 0; y < altura; y += 700) {
    await page.evaluate((v) => window.scrollTo(0, v), y);
    await page.waitForTimeout(140);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1500);

  const P = Math.round(altura * 0.5);

  await page.evaluate((y) => window.scrollTo(0, y), P);
  await page.waitForTimeout(ASSENTAR);
  const scrollA = await page.evaluate(() => Math.round(window.scrollY));
  const A1 = await page.evaluate(IMPRESSAO);

  // BRAÇO DE RUÍDO: mesma posição, mesmo tempo, sem sair. TRÊS amostras, e o
  // piso é o MAIOR par — um único par pode calhar de pegar o site num momento
  // quieto, subestimar o ruído e transformar respiração normal em "dano",
  // condenando o caminho herdado por falso positivo.
  await page.waitForTimeout(ASSENTAR);
  const A2 = await page.evaluate(IMPRESSAO);
  await page.waitForTimeout(ASSENTAR);
  const A3 = await page.evaluate(IMPRESSAO);
  const ruido = Math.max(diferenca(A1, A2), diferenca(A2, A3), diferenca(A1, A3));

  // BRAÇO DA RÉGUA: sair e voltar.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  await page.evaluate((h) => window.scrollTo(0, h), altura);
  await page.waitForTimeout(500);
  await page.evaluate((y) => window.scrollTo(0, y), P);
  await page.waitForTimeout(ASSENTAR);
  const scrollB = await page.evaluate(() => Math.round(window.scrollY));
  const B = await page.evaluate(IMPRESSAO);
  // Compara contra A3, a amostra de ruído mais recente antes de sair.
  const idaEVolta = diferenca(A3, B);

  Object.assign(resultado, {
    elementos: A1.total,
    P, scrollA, scrollB,
    // ⚠️ Se a página não parou no MESMO lugar (âncora, snap, scroll suave), a
    // comparação é entre posições diferentes e não significa nada.
    mesmaPosicao: Math.abs(scrollA - scrollB) <= 2,
    ruido,
    idaEVolta,
    // Só é efeito da régua o que EXCEDE o ruído próprio do site.
    excedente: Math.max(0, idaEVolta - ruido),
    razao: ruido > 0 ? Number((idaEVolta / ruido).toFixed(2)) : (idaEVolta > 0 ? null : 1),
  });
} catch (e) {
  resultado.falhou = String(e).slice(0, 120);
}

await browser.close();
console.log(JSON.stringify(resultado));
