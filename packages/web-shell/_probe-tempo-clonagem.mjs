// PROBE — quanto tempo custa cada método de clonagem?
//
// Preocupação do Adilson com o método do Sol: o tempo de clonagem. Este probe
// mede as partes que EXISTEM hoje, na mesma máquina, nos mesmos sites.
//
// ⚠️ O que NÃO dá pra medir: a etapa de COMPILAR não existe. Então isto não é
// "método A × método B" — é "o que temos hoje" × "o que temos hoje + o que o
// método do Sol acrescenta de OBSERVAÇÃO e VERIFICAÇÃO". A compilação em si
// entra como incógnita declarada, nunca como zero.
//
// Partes medidas:
//   A) captura de hoje       — `captureSnapshot` real, o caminho estático
//   B) traces de observação  — percorrer a página como o protocolo do Sol pede
//   C) verificação           — a régua de reversibilidade (ida-e-volta + ruído)
//
// Uso: node _probe-tempo-clonagem.mjs <url> [<url>...]
import { chromium } from 'playwright-core';
import { captureSnapshot } from './lib/snapshot.js';

const urls = process.argv.slice(2);
if (!urls.length) { console.error('uso: node _probe-tempo-clonagem.mjs <url>...'); process.exit(2); }

const agora = () => Number(process.hrtime.bigint() / 1000000n);

async function tempoCaptura(url) {
  const t0 = agora();
  try {
    const r = await captureSnapshot(url, { viewport: { width: 1440, height: 900 } });
    return { ms: agora() - t0, bytes: (r?.html || '').length };
  } catch (e) {
    return { ms: agora() - t0, erro: String(e).slice(0, 70) };
  }
}

// Protocolo de observação do Sol, reduzido ao que ele chama de essencial:
// carga estabilizada + rolagem completa ida e volta em posições fixas + seek em
// posições determinadas. Sem as 3 repetições e sem o segundo viewport — logo
// este número é PISO do custo, não o custo cheio.
async function tempoTraces(url) {
  const t0 = agora();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(2500);
    const altura = await page.evaluate(() => document.body.scrollHeight);
    for (let y = 0; y < altura; y += 700) {
      await page.evaluate((v) => window.scrollTo(0, v), y);
      await page.waitForTimeout(140);
    }
    for (let y = altura; y > 0; y -= 700) {
      await page.evaluate((v) => window.scrollTo(0, v), y);
      await page.waitForTimeout(140);
    }
    for (const f of [0.25, 0.5, 0.75]) {
      await page.evaluate((v) => window.scrollTo(0, v), Math.round(altura * f));
      await page.waitForTimeout(400);
    }
    return { ms: agora() - t0, altura };
  } catch (e) {
    return { ms: agora() - t0, erro: String(e).slice(0, 70) };
  } finally { await browser.close(); }
}

async function tempoVerificacao(url) {
  const t0 = agora();
  const { execSync } = await import('node:child_process');
  try {
    execSync(`node _probe-reversibilidade-rolagem.mjs ${JSON.stringify(url)}`, { stdio: 'pipe', timeout: 150000 });
  } catch (_) {}
  return { ms: agora() - t0 };
}

const linhas = [];
for (const url of urls) {
  const a = await tempoCaptura(url);
  const b = await tempoTraces(url);
  const c = await tempoVerificacao(url);
  linhas.push({ url, captura: a, traces: b, verificacao: c });
  const s = (x) => (x.ms / 1000).toFixed(1) + 's';
  console.log(`${url.slice(0, 40).padEnd(42)} captura=${s(a).padEnd(7)} traces=${s(b).padEnd(7)} verificacao=${s(c).padEnd(7)} | hoje=${s(a)} → com observacao+verificacao=${((a.ms + b.ms + c.ms) / 1000).toFixed(1)}s${a.erro ? '  ERRO captura: ' + a.erro : ''}`);
}

const soma = (k) => linhas.reduce((t, l) => t + l[k].ms, 0) / linhas.length / 1000;
console.log(`\nmedia por site: captura ${soma('captura').toFixed(1)}s | traces ${soma('traces').toFixed(1)}s | verificacao ${soma('verificacao').toFixed(1)}s`);
console.log(`hoje: ${soma('captura').toFixed(1)}s  →  com o que o metodo do Sol ACRESCENTA: ${(soma('captura') + soma('traces') + soma('verificacao')).toFixed(1)}s`);
console.log('⚠️ a etapa de COMPILAR nao existe e NAO esta nesta conta; e piso, nao custo cheio (sem 3 repeticoes, sem 2o viewport).');
