// O relatório da comparação: uma página para ABRIR, não um relatório para ler.
//
//   node scripts/relatorio-gosto-e-banco.mjs --pasta _comparacao-gosto-banco
//
// Ordem deliberada (advise do Sol): primeiro a GALERIA CEGA — as páginas
// embaralhadas, sem dizer qual condição é qual, para que a escolha seja pela
// página e não pelo rótulo. A revelação vem depois, na mesma página, com as
// ordens que cada uma quebrou.
//
// O verificador é diagnóstico, não veredito: contagem de violações NÃO é nota.
// Ele diz o que a página deixou de seguir; se isso a torna melhor ou pior é
// julgamento do dono.
import { chromium } from 'playwright-core';
import { runDesignEvalOnPage } from '@uncraft/design-eval';
import { serveFolder } from '../lib/serve-folder.js';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

function arg(nome, padrao = null) {
  const i = process.argv.indexOf(`--${nome}`);
  if (i === -1) return padrao;
  const v = process.argv[i + 1];
  return v == null || v.startsWith('--') ? padrao : v;
}

const pasta = path.resolve(arg('pasta', '_comparacao-gosto-banco'));
const manifesto = JSON.parse(await readFile(path.join(pasta, 'manifesto.json'), 'utf8'));
const geracoes = manifesto.geracoes.filter((g) => g.codigo === 0);
if (!geracoes.length) {
  console.error('nenhuma geracao bem-sucedida no manifesto');
  process.exit(2);
}

const servidor = await serveFolder(pasta);
const navegador = await chromium.launch({ headless: true });
const medidas = [];
try {
  for (const g of geracoes) {
    const nome = path.basename(g.arquivo);
    const pagina = await navegador.newPage({ viewport: { width: 1280, height: 900 } });
    const resposta = await pagina.goto(`${servidor.origem}/${encodeURIComponent(nome)}`, { waitUntil: 'load', timeout: 60000 });
    const bytes = resposta && resposta.ok() ? await resposta.text() : null;
    await pagina.waitForTimeout(500);
    const veredito = await runDesignEvalOnPage(pagina, {}, bytes ? { source: bytes } : {});
    const retrato = `${nome.replace(/\.html$/, '')}-desktop.png`;
    await pagina.screenshot({ path: path.join(pasta, retrato), fullPage: false });
    await pagina.setViewportSize({ width: 390, height: 844 });
    await pagina.waitForTimeout(300);
    const retratoMovel = `${nome.replace(/\.html$/, '')}-mobile.png`;
    await pagina.screenshot({ path: path.join(pasta, retratoMovel), fullPage: false });
    await pagina.close();
    const porId = new Map((veredito.results || []).map((r) => [r.id, r]));
    medidas.push({
      ...g,
      condicao: g.nome, // `nome` vira o do arquivo logo abaixo; o rotulo da condicao se perderia
      nome,
      retrato,
      retratoMovel,
      quebradas: veredito.violations.map((id) => porId.get(id) || { id }),
      naoJulgadas: veredito.unjudged.length,
      nadaEncontrado: veredito.notDetected.length,
      artefatoQuebrado: (veredito.integrity?.failed || []).map((r) => r.id),
    });
    console.log(`  ${nome}: ${veredito.violations.length} ordens quebradas`);
  }
} finally {
  await navegador.close();
  await servidor.fechar();
}

// A galeria cega embaralha SEM olhar a condição — e a legenda só aparece depois.
const cega = medidas
  .map((m, i) => ({ m, ordem: (i * 40503) % 65536 }))
  .sort((a, b) => a.ordem - b.ordem)
  .map((x, i) => ({ ...x.m, apelido: String.fromCharCode(97 + i).toUpperCase() }));

const esc = (t) => String(t).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Regras de gosto × banco de referências</title>
<style>
  :root { color-scheme: dark; --tinta:#e8e6e1; --fundo:#0d0d0c; --linha:#2a2a27; --calmo:#8f8d86; }
  body { margin:0; background:var(--fundo); color:var(--tinta); font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
  main { max-width:1180px; margin:0 auto; padding:48px 24px 96px; }
  h1 { font-size:30px; margin:0 0 6px; letter-spacing:-.02em; }
  h2 { font-size:20px; margin:56px 0 8px; letter-spacing:-.01em; }
  p.calmo { color:var(--calmo); margin:0 0 24px; max-width:70ch; }
  .grade { display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:20px; }
  figure { margin:0; border:1px solid var(--linha); border-radius:10px; overflow:hidden; background:#151513; }
  figure img { display:block; width:100%; height:auto; }
  figcaption { padding:10px 12px; font-size:14px; color:var(--calmo); display:flex; justify-content:space-between; gap:8px; }
  .apelido { font-weight:600; color:var(--tinta); }
  table { width:100%; border-collapse:collapse; margin-top:12px; font-size:14px; }
  th,td { text-align:left; padding:10px 12px; border-bottom:1px solid var(--linha); vertical-align:top; }
  th { color:var(--calmo); font-weight:500; }
  code { font-size:13px; color:#cfd8b5; }
  .aviso { border-left:2px solid #6b6a63; padding:8px 0 8px 14px; color:var(--calmo); max-width:70ch; }
  a { color:#a9c46c; }
</style></head><body><main>

<h1>Regras de gosto × banco de referências</h1>
<p class="calmo">Mesmo pedido, quatro combinações, ${manifesto.k} ${manifesto.k === 1 ? 'geração' : 'gerações'} de cada.
Modelo: ${esc(manifesto.modelo)}. ${manifesto.plano ? `Referências do plano: ${manifesto.plano.referencias.map((r) => esc(r.title)).join(' · ')}.` : ''}</p>

<h2>Primeiro, sem saber qual é qual</h2>
<p class="calmo">Escolha pela página. A legenda está mais abaixo — de propósito.</p>
<div class="grade">
${cega.map((m) => `  <figure>
    <a href="${esc(m.nome)}" target="_blank"><img src="${esc(m.retrato)}" alt="página ${m.apelido}"></a>
    <figcaption><span class="apelido">${m.apelido}</span><span><a href="${esc(m.nome)}" target="_blank">abrir</a></span></figcaption>
  </figure>`).join('\n')}
</div>

<h2>No celular</h2>
<div class="grade">
${cega.map((m) => `  <figure><img src="${esc(m.retratoMovel)}" alt="página ${m.apelido} no celular"><figcaption><span class="apelido">${m.apelido}</span></figcaption></figure>`).join('\n')}
</div>

<h2>Agora sim: qual era qual</h2>
<table>
  <tr><th>&nbsp;</th><th>condição</th><th>regras de gosto</th><th>banco</th><th>ordens quebradas</th></tr>
${cega.map((m) => `  <tr>
    <td class="apelido">${m.apelido}</td>
    <td>${esc(m.condicao)} <span class="calmo">(${esc(m.celula)}-${m.repeticao})</span></td>
    <td>${m.estado?.regras === 'on' ? 'ligadas' : 'desligadas'}</td>
    <td>${m.estado?.banco === 'on' ? 'ligado' : 'desligado'}</td>
    <td>${m.quebradas.length ? m.quebradas.map((q) => `<code>${esc(q.id)}</code>`).join(', ') : '<span class="calmo">nenhuma encontrada</span>'}</td>
  </tr>`).join('\n')}
</table>

<p class="aviso">O verificador é diagnóstico, não veredito. Ele diz o que a página deixou de seguir —
não se ela ficou melhor. Nenhum critério tem cobertura completa, então "nenhuma encontrada"
não é aprovação${medidas.some((m) => m.naoJulgadas) ? `; ${medidas[0].naoJulgadas} ordens ficaram sem julgamento por falta de chão de verdade` : ''}.</p>

</main></body></html>`;

const destino = path.join(pasta, 'relatorio.html');
await writeFile(destino, html);
console.log(`\nrelatorio: ${destino}`);
