// AS REGRAS DE GOSTO — acionador do verificador, dentro do Uncraft.
//
// Aponta o verificador para uma pagina (arquivo ou endereco), sobe um Chromium
// de verdade e diz quais das ordens de construcao do house-style ela NAO seguiu.
// Sem IA, custo zero por pagina.
//
//   node scripts/check-house-style.mjs pagina.html
//   node scripts/check-house-style.mjs https://exemplo.com
//   node scripts/check-house-style.mjs pagina.html --palette "#c8ff3d,#1a1a18" --italic 0 --mono nao
//   node scripts/check-house-style.mjs pagina.html --json
//
// Codigos de saida: 0 nada encontrado · 1 ordem quebrada ou artefato quebrado ·
// 2 nao deu para medir (argumento invalido, pagina inalcancavel, resposta que
// nao e' HTML). O 2 existe para que "nao mediu" nunca passe por "passou".
//
// ⚠️ ARQUIVO LOCAL E' SERVIDO POR HTTP, nao aberto por `file://` nem injetado
// como string. `setContent` deixa o documento em `about:blank`, e ai' uma folha
// de estilo externa vira cross-origin: `cssRules` lanca e TODOS os checks de CSS
// voltam `unjudged` — cegos, mas com cara de silencio. Por isso o servidorzinho
// abaixo, com raiz na PASTA do arquivo, para que folha e imagens relativas
// resolvam como resolvem de verdade.
//
// ⚠️ OS BYTES CONFERIDOS SAO OS DA PROPRIA NAVEGACAO (`response.text()`), nunca
// um `fetch` a parte: duas requisicoes podem trazer artefatos diferentes, e a
// integridade estaria julgando um HTML enquanto as regras medem outro. E nunca
// `page.content()`, que devolve o DOM ja consertado pelo parser e apaga
// exatamente a evidencia de truncamento que o check procura.
import { chromium } from 'playwright-core';
import { runDesignEvalOnPage, COVERAGE } from '@uncraft/design-eval';
import { serveFolder } from '../lib/serve-folder.js';
import { realpath } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

function morrer(mensagem) {
  console.error(mensagem);
  process.exit(2);
}

function argumento(nome, padrao = null) {
  const i = process.argv.indexOf(`--${nome}`);
  if (i === -1) return padrao;
  const valor = process.argv[i + 1];
  // `--mono --json` daria `--json` como valor: tratar como ausente, nunca como
  // resposta. Chao de verdade inventado e' pior do que chao de verdade ausente.
  return valor == null || valor.startsWith('--') ? padrao : valor;
}

const alvo = process.argv[2];
if (!alvo || alvo.startsWith('--')) {
  morrer('uso: node scripts/check-house-style.mjs <arquivo.html | http://...> [--palette "#hex,#hex"] [--italic N] [--mono sim|nao] [--fonts "Aeonik,Inter"] [--json]');
}

// Chao de verdade: ausente e' ausente. Um campo vazio ou mal escrito NAO pode
// virar afirmacao — `[]` faria o verificador julgar contra uma paleta
// inexistente, e um `--mono` sem valor afirmaria "nao ha monoespacada na fonte".
const chao = {};
const paleta = (argumento('palette') || '').split(',').map((c) => c.trim()).filter(Boolean);
if (paleta.length) chao.palette = paleta;
const fontes = (argumento('fonts') || '').split(',').map((f) => f.trim()).filter(Boolean);
if (fontes.length) chao.explicitFonts = fontes;
const italico = argumento('italic');
if (italico != null) {
  const n = Number(italico);
  if (!Number.isInteger(n) || n < 0) morrer(`--italic precisa de um inteiro >= 0 (recebi "${italico}")`);
  chao.italicCount = n;
}
const mono = argumento('mono');
if (mono != null) {
  if (/^(sim|yes|true|1)$/i.test(mono)) chao.monoInSource = true;
  else if (/^(nao|não|no|false|0)$/i.test(mono)) chao.monoInSource = false;
  else morrer(`--mono aceita sim|nao (recebi "${mono}")`);
}

const ehEndereco = /^https?:\/\//i.test(alvo);
let servidor = null;
let navegador = null;
let endereco = alvo;

if (!ehEndereco) {
  if (!existsSync(alvo) || !statSync(alvo).isFile()) morrer(`arquivo nao encontrado: ${alvo}`);
  const absoluto = await realpath(path.resolve(alvo));
  servidor = await serveFolder(path.dirname(absoluto));
  endereco = `${servidor.origem}/${encodeURIComponent(path.basename(absoluto))}`;
}

let veredito;
let bytes = null;
let falha = null;
try {
  navegador = await chromium.launch({ headless: true });
  const pagina = await navegador.newPage({ viewport: { width: 1280, height: 800 } });
  const resposta = await pagina.goto(endereco, { waitUntil: 'load', timeout: 60000 });
  // `goto` NAO lanca em 404/500: sem esta checagem uma pagina de erro passaria
  // pelo verificador e sairia com codigo 0, ou seja, "sem problemas".
  if (!resposta) falha = `sem resposta ao abrir ${alvo}`;
  else if (!resposta.ok()) falha = `${alvo} respondeu ${resposta.status()}`;
  else if (!/html/i.test(resposta.headers()['content-type'] || '')) {
    falha = `${alvo} nao devolveu HTML (content-type: ${resposta.headers()['content-type'] || 'ausente'})`;
  }
  if (!falha) {
    try { bytes = await resposta.text(); } catch (_) { bytes = null; }
    await pagina.waitForTimeout(600); // fontes e folhas assentarem
    veredito = await runDesignEvalOnPage(pagina, chao, bytes == null ? {} : { source: bytes });
  }
} catch (erro) {
  falha = `nao consegui medir ${alvo}: ${erro.message}`;
} finally {
  // Cada recurso fecha por conta propria: se o navegador rejeitar ao fechar, o
  // servidor ainda tem que cair.
  await Promise.allSettled([
    navegador ? navegador.close() : Promise.resolve(),
    servidor ? servidor.fechar() : Promise.resolve(),
  ]);
}

if (falha) morrer(falha);

const integridade = veredito.integrity?.failed || [];
// `process.exitCode` em vez de `process.exit`: sair na hora pode cortar o
// stdout no meio quando a saida e' grande e esta redirecionada — e ai' o JSON
// chega invalido justamente no caso em que ele e' grande.
process.exitCode = (veredito.violations.length || integridade.length) ? 1 : 0;

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ alvo, chao, veredito }, null, 2));
} else {
  // `violations`/`unjudged`/`notDetected` sao listas de IDs; o detalhe vive em
  // `results`. Ler as listas como se fossem objetos imprime `undefined` sem erro.
  const porId = new Map((veredito.results || []).map((r) => [r.id, r]));
  const detalhes = (ids) => ids.map((id) => porId.get(id) || { id });
  const rotulo = (r) => `${r.id}${r.covers === 'partial' ? ' (cobertura parcial)' : ''}`;

  console.log(`\n  ${alvo}\n`);

  if (veredito.violations.length) {
    console.log(`  ORDENS NAO SEGUIDAS (${veredito.violations.length})`);
    detalhes(veredito.violations).forEach((r) => {
      console.log(`    x ${rotulo(r)}`);
      if (r.detail) console.log(`      ${r.detail}`);
      if (r.remedy) console.log(`      conserto: ${r.remedy === 'substitute' ? 'trocar (existe substituto mecanico)' : 'proibido — nao ha substituto'}`);
    });
  } else {
    console.log('  ORDENS NAO SEGUIDAS: nenhuma encontrada por este leitor');
  }

  if (integridade.length) {
    console.log(`\n  ARTEFATO QUEBRADO (${integridade.length})`);
    integridade.forEach((r) => console.log(`    x ${r.id}${r.detail ? ` — ${r.detail}` : ''}`));
  }

  if (veredito.unjudged.length) {
    console.log(`\n  NAO DEU PARA JULGAR (${veredito.unjudged.length}) — faltou entrada, nao e' aprovacao`);
    detalhes(veredito.unjudged).forEach((r) => console.log(`    ? ${rotulo(r)}${r.detail ? ` — ${r.detail}` : ''}`));
  }

  const parciais = detalhes(veredito.notDetected).filter((r) => COVERAGE[r.criterion]).length;
  console.log(`\n  NADA ENCONTRADO em ${veredito.notDetected.length} ordens — ⚠️ isto NAO e' aprovacao.`);
  console.log(`  Nenhum criterio tem cobertura completa${parciais ? `; ${parciais} destes sao de cobertura declaradamente parcial` : ''}.`);
  console.log('');
}
