// USO: node scripts/bateria-offline-clone.mjs <nodeId>   (dev server na 3030)
//
// A REGRA que eu mesmo escrevi: independência só se declara com as
// dependências necessárias zeradas E a bateria offline repetida com paridade
// de função. Isto é a segunda metade.
//
// Desenho: dois braços do MESMO clone — online (referência) e "sem internet"
// (toda rede fora do gateway local é cortada; o gateway é nossa
// infraestrutura, não o site copiado). Paridade = mesmos números nos dois:
// altura, imagens carregadas, vídeo tocando E buscando quadro, relógio de
// animação andando, coreografia (SSIM por parada entre os braços).
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
}
const { chromium } = await import('playwright-core');
const { neon } = await import('@neondatabase/serverless');
const { createToken } = await import('../lib/auth.js');
const sql = neon(process.env.DATABASE_URL);
const [u] = await sql`SELECT id, email FROM users ORDER BY created_at LIMIT 1`;
const h = { 'content-type': 'application/json', cookie: `uncraft_sess=${createToken({ id: u.id, email: u.email })}` };
const VIEW = { width: 1440, height: 1200 };
const FRACOES = [0, 0.25, 0.5, 0.75, 0.98];
mkdirSync('_bateria/offline', { recursive: true });
const ssim = (a, c) => { let t = '';
  try { t = execFileSync('sh', ['-c', `ffmpeg -hide_banner -i '${a}' -i '${c}' -lavfi ssim -f null - 2>&1`], { encoding: 'utf8' }); }
  catch (e) { t = String(e.stdout || '') + String(e.stderr || ''); }
  const m = t.match(/All:\s*([0-9.]+)/); return m ? Number(m[1]) : null; };
const b = await chromium.launch({ headless: true });

async function braco(nome, { offline }) {
  // Sessão NOVA por braço (o token vive no caminho; reusar poluiria a medida
  // com cache do braço anterior).
  const s = await (await fetch(`http://localhost:3030/api/nodes/${process.argv[2]}/runtime-session`, { method: 'POST', headers: h })).json();
  const ctx = await b.newContext({ viewport: VIEW });
  const p = await ctx.newPage();
  const externosTentados = new Set();
  // ⚠️ O CSP do portão bloqueia script externo ANTES da rede — o route nunca
  // vê esses. `requestfailed` vê (ERR_BLOCKED_BY_CSP) e é a medida honesta do
  // que a página TENTOU, nos dois braços.
  const falharam = new Set();
  p.on('requestfailed', (r) => { const u2 = r.url();
    if (!/localhost|127\.0\.0\.1/.test(u2)) falharam.add(`${u2.split('?')[0].slice(-58)} [${r.failure()?.errorText || ''}]`); });
  if (offline) {
    // corta TODA rede que não é o gateway local — antes de qualquer pedido
    await ctx.route('**/*', (r) => {
      const url = r.request().url();
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(url)) return r.continue();
      externosTentados.add(url.split('?')[0].slice(-70));
      return r.abort('internetdisconnected');
    });
  }
  await p.route('http://localhost:3030/__b', (r) => r.fulfill({ status: 200, headers: { 'content-type': 'text/html' },
    body: `<!doctype html><style>html,body{margin:0;height:100%;overflow:hidden}iframe{border:0;width:100%;height:100%}</style><iframe sandbox="allow-scripts allow-pointer-lock" src="${s.runtime.url}"></iframe>` }));
  await p.goto('http://localhost:3030/__b', { waitUntil: 'load', timeout: 90000 });
  await p.waitForTimeout(6000);
  const f = p.frames().find((x) => x.url().includes('/api/runtime/'));
  const alt0 = await f.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < alt0; y += 600) { await f.evaluate((v) => scrollTo(0, v), y); await p.waitForTimeout(90); }
  await f.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(2500);

  // FUNÇÃO, não só pixels:
  const altura = await f.evaluate(() => document.documentElement.scrollHeight);
  // ⚠️ Contagem igual não prova conjunto igual (Sol): identidade POR IMAGEM,
  // com a chave sem o token da sessão (cada braço tem o seu), estado e
  // geometria — oculta (carrossel, slide desligado) explica não-carregada.
  const imgs = await f.evaluate(() => {
    const semToken = (u) => { try { const p2 = new URL(u).pathname; const m2 = p2.match(/\/api\/runtime\/[^/]+\/(.*)$/); return m2 ? m2[1] : p2; } catch { return u; } };
    // Posição ESTRUTURAL de cada elemento: o caminho no DOM (tag + posição em
    // cada nível). ⚠️ Entre dois carregamentos independentes NÃO existe
    // identidade persistente de elemento — o que se compara é posição
    // estrutural + campos medidos, e a conclusão se limita a isso (Sol):
    // "as mesmas posições estruturais, com os mesmos campos". Reordenação por
    // script apareceria como divergência de caminho; substituição por um
    // gêmeo exato (mesma posição, mesma chave, mesmo estado) é indistinguível
    // por construção. A conclusão desta linha é paridade DOS CAMPOS
    // OBSERVADOS. Listeners, navegação e estados interativos ficam FORA da
    // bateria inteira — as outras linhas cobrem altura, relógio de animação,
    // gatilhos de rolagem, vídeo (tocar/buscar) e coreografia, só isso.
    const caminhoDom = (el) => {
      const partes = [];
      for (let e = el; e && e !== document.body; e = e.parentElement) {
        let k = 1; for (let s2 = e.previousElementSibling; s2; s2 = s2.previousElementSibling) if (s2.tagName === e.tagName) k += 1;
        partes.unshift(`${e.tagName.toLowerCase()}:${k}`);
      }
      return partes.join('>');
    };
    const lista = [...document.images].map((x) => {
      const r = x.getBoundingClientRect();
      const cs = getComputedStyle(x);
      const oculta = r.width < 2 || r.height < 2 || cs.display === 'none' || cs.visibility === 'hidden'
        || (() => { for (let e = x.parentElement; e; e = e.parentElement) { const c2 = getComputedStyle(e); if (c2.display === 'none' || c2.visibility === 'hidden') return true; } return false; })();
      return { chave: semToken(x.currentSrc || x.src || '(sem src)'), carregada: x.complete && x.naturalWidth > 0,
               lazy: x.getAttribute('loading') === 'lazy', oculta, dom: caminhoDom(x) };
    });
    return { total: lista.length, ok: lista.filter((x) => x.carregada).length, lista };
  });
  const relogio1 = await f.evaluate(() => window.gsap?.globalTimeline?.time?.() ?? null);
  await p.waitForTimeout(1500);
  const relogio2 = await f.evaluate(() => window.gsap?.globalTimeline?.time?.() ?? null);
  const st = await f.evaluate(() => (window.ScrollTrigger?.getAll?.() || []).length);
  const video = await f.evaluate(async () => {
    const v = [...document.querySelectorAll('video')].find((x) => (x.currentSrc || '').includes('farm_main'));
    if (!v) return null;
    try { v.muted = true; await v.play(); } catch (_) {}
    await new Promise((r) => setTimeout(r, 1200));
    const tocou = v.currentTime > 0.3;
    v.pause(); v.currentTime = 2;                    // BUSCA — exige faixa de bytes
    await new Promise((r) => setTimeout(r, 1200));
    return { tocou, buscou: Math.abs(v.currentTime - 2) < 0.5, t: v.currentTime };
  });

  const fotos = [];
  for (const fr of FRACOES) {
    await f.evaluate((v) => scrollTo(0, v), Math.round((altura - VIEW.height) * fr));
    await p.waitForTimeout(1800);
    const arq = `_bateria/offline/${nome}-${Math.round(fr * 100)}.png`;
    await p.screenshot({ path: arq }); fotos.push(arq);
  }
  await ctx.close();
  return { nome, altura, imgs, relogioAnda: relogio1 != null && relogio2 > relogio1, st, video, fotos,
           externosTentados: [...externosTentados], falharam: [...falharam] };
}

const on = await braco('online', { offline: false });
const off = await braco('semrede', { offline: true });

// Braço do site VIVO: prova que as não-carregadas são comportamento do site,
// não perda do clone (comparadas por NOME DE ARQUIVO — namespaces diferem).
const ctxV = await b.newContext({ viewport: VIEW });
const pv = await ctxV.newPage();
await pv.goto('https://www.farmminerals.com/promo', { waitUntil: 'load', timeout: 90000 });
await pv.waitForTimeout(6000);
const altV = await pv.evaluate(() => document.documentElement.scrollHeight);
for (let y = 0; y < altV; y += 600) { await pv.evaluate((v) => scrollTo(0, v), y); await pv.waitForTimeout(90); }
await pv.evaluate(() => scrollTo(0, 0)); await pv.waitForTimeout(2500);
const vivoImgs = await pv.evaluate(() => [...document.images].map((x) => ({
  nome: (() => { try { return new URL(x.currentSrc || x.src).pathname.split('/').pop(); } catch { return x.src; } })(),
  carregada: x.complete && x.naturalWidth > 0 })));
await ctxV.close();
await b.close();

console.log('BATERIA OFFLINE DO PRESERVADO — paridade de função\n');
const linha = (rotulo, a, c, igual) => console.log(`  ${rotulo.padEnd(26)} ${String(a).padEnd(22)} ${String(c).padEnd(22)} ${igual ? '✓' : '✗ DIFERE'}`);
console.log(`  ${'critério'.padEnd(26)} ${'online'.padEnd(22)} ${'SEM INTERNET'.padEnd(22)}`);
linha('altura', on.altura, off.altura, on.altura === off.altura);
{
  // ⚠️ Conjunto perde MULTIPLICIDADE e posição ([A,A,B] vs [A,B,B] têm o
  // mesmo Set) — a paridade honesta é ÍNDICE A ÍNDICE, na ordem do DOM, que é
  // a mesma nos dois braços porque o HTML servido é o mesmo (Sol).
  const A = on.imgs.lista, B = off.imgs.lista;
  // Comprimentos diferentes E divergências no trecho comum contam juntos —
  // senão listas de tamanhos distintos reportariam só a diferença de tamanho.
  const comum = Math.min(A.length, B.length);
  const divergem = Math.abs(A.length - B.length)
    + A.slice(0, comum).filter((x, i) => x.dom !== B[i].dom || x.chave !== B[i].chave || x.carregada !== B[i].carregada || x.oculta !== B[i].oculta).length;
  linha('imagens carregadas', `${on.imgs.ok}/${on.imgs.total}`, `${off.imgs.ok}/${off.imgs.total}`,
    on.imgs.total === off.imgs.total && divergem === 0);
  linha('…paridade elemento a elemento', `${A.length} elementos`, `${divergem} divergem`, divergem === 0);
  // (a identidade comparada por índice inclui o CAMINHO NO DOM de cada
  // elemento — se um script reordenasse, o caminho divergiria e contaria)
  const naoOcultas = off.imgs.lista.filter((x) => !x.carregada && !x.oculta);
  console.log(`  não-carregadas VISÍVEIS no braço sem-rede: ${naoOcultas.length}${naoOcultas.length ? ' ✗ ' + naoOcultas.map((x) => x.chave.slice(-40)).join(', ') : ' (todas ocultas: carrossel/slide desligado)'}`);
  const naoOff = new Set(off.imgs.lista.filter((x) => !x.carregada).map((x) => x.chave));
  const nomesNao = new Set([...naoOff].map((k) => k.split('/').pop()));
  const vivoNao = new Set(vivoImgs.filter((x) => !x.carregada).map((x) => x.nome));
  const soNoClone = [...nomesNao].filter((n2) => !vivoNao.has(n2));
  console.log(`  não-carregadas no vivo: ${vivoNao.size} · não-carregadas SÓ no clone: ${soNoClone.length}${soNoClone.length ? ' ✗ ' + soNoClone.slice(0, 5).join(', ') : ' ✓'}`);
}
linha('relógio de animação anda', on.relogioAnda, off.relogioAnda, on.relogioAnda === off.relogioAnda);
linha('gatilhos de rolagem', on.st, off.st, on.st === off.st);
linha('vídeo tocou', on.video?.tocou, off.video?.tocou, on.video?.tocou === off.video?.tocou);
linha('vídeo buscou t=2', `${on.video?.buscou} (t=${on.video?.t?.toFixed(1)})`, `${off.video?.buscou} (t=${off.video?.t?.toFixed(1)})`, on.video?.buscou === off.video?.buscou);
const vals = FRACOES.map((_, i) => ssim(on.fotos[i], off.fotos[i]));
const media = vals.filter(Boolean).reduce((a, c) => a + c, 0) / vals.filter(Boolean).length;
console.log(`\n  coreografia online × sem-rede (SSIM por parada): ${vals.map((v) => v?.toFixed(3)).join('  ')}  média ${media.toFixed(3)}`);
console.log(`\n  chegou à REDE externa no braço sem-rede: ${off.externosTentados.length}`);
for (const e of off.externosTentados.slice(0, 6)) console.log(`    ${e}`);
console.log(`  bloqueados/falhados (CSP conta aqui) — online ${on.falharam.length} × sem-rede ${off.falharam.length}`);
for (const e of off.falharam.slice(0, 6)) console.log(`    ${e}`);
writeFileSync('_bateria/offline/relatorio.json', JSON.stringify({ on, off, ssim: vals, media }, null, 2));
