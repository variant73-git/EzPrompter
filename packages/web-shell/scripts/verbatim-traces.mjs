// VERBATIM etapa 6 — EXTRATOR DETERMINÍSTICO de vestígios.
//
// Por que ele existe antes de qualquer chamada ao JEV: a correção central do Astra ao
// plano foi "centenas de ocorrências NÃO são centenas de julgamentos". Namespace
// conhecido, diretiva de source-map, caminho de máquina, metadado de build e
// referência que casa exatamente com o manifesto do pacote resolvem-se por REGRA. Só
// o resíduo semanticamente ambíguo é que justificaria um modelo.
//
// Este script mede essa divisão. Ele NÃO decide remoção, NÃO chama modelo nenhum e
// NÃO altera o pacote — emite a lista de ocorrências com contexto, dizendo qual regra
// resolveu cada uma e o que sobrou sem regra. O número que interessa é o resíduo.
//
// ⚠️ Desenho seguindo a auditoria:
//  • Ocorrência tem IDENTIDADE estável (arquivo + posição + hash do trecho), porque o
//    mesmo literal em dois lugares são DUAS ocorrências.
//  • O extrator não usa janela fixa de 200 caracteres como prova de nada: ela serve de
//    contexto para leitura humana, não de evidência de dispensabilidade.
//  • Nada aqui conta como "dormente". Ausência num percurso não é inalcançabilidade.
//
// SEGUNDA PASSADA (--dom): O NAVEGADOR COMO PARSER.
//
// Boa parte do resíduo é LINK de navegação, e "é link" é fato sintático, não
// julgamento. Mas o tokenizador varre `src|href|poster` sem saber em que ELEMENTO o
// atributo está — regex não distingue `<a href>` de `<link href>`, e inferir isso por
// regex é a classe proibida neste repo (lições 163/164). Então a classificação por
// elemento vem do DOM REAL: serve-se o pacote, carrega-se no Chromium e pergunta-se a
// cada nó. Elemento é fato; a partir dele a obrigação da receita é tabela, não modelo.
//
// USO
//   node scripts/verbatim-traces.mjs --bundle _verbatim/cobaia4 [--dom] [--json saida.json]

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { chromium } from 'playwright-core';

const TEXTO = /\.(html?|css|js|mjs|json|svg|php|txt|map)$/i;
const CONTEXTO = 90;

function arg(nome, padrao = null) {
  const i = process.argv.indexOf(nome);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
}

// Namespaces técnicos: EXIGIDOS pelo formato, nunca vestígio. Lista fechada.
const NAMESPACE_TECNICO = [
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/1999/xlink',
  'http://www.w3.org/1999/xhtml',
  'http://www.w3.org/XML/1998/namespace',
  'http://www.w3.org/2000/xmlns/',
];

// Padrões de vestígio, cada um com o que o encontra. Determinístico por construção.
const PADROES = [
  { classe: 'url-absoluta', re: /https?:\\?\/\\?\/[^\s"'`<>)\\]{4,}/g },
  { classe: 'url-sem-esquema', re: /(?<![:\w])\/\/[a-z0-9.-]+\.[a-z]{2,}\/[^\s"'`<>)]*/gi },
  { classe: 'source-map', re: /\/\/[#@]\s*sourceMappingURL=[^\s*]+/g },
  { classe: 'caminho-de-maquina', re: /(?:\/Users\/|\/home\/|[A-Z]:\\\\)[^\s"'`<>)]{4,}/g },
  { classe: 'atributo-de-plataforma', re: /\bdata-(?:wf-[a-z-]+|w-id)\s*=\s*(["'])[^"']*\1/gi },
  { classe: 'metadado-de-build', re: /Last Published:[^<"\n]{0,80}/gi },
];

// Regras determinísticas. A primeira que casar decide; `null` = sem regra (resíduo).
function regraDeterministica(o, indice) {
  if (o.classe === 'source-map') return 'source-map: diretiva de build, removível por regra';
  if (o.classe === 'caminho-de-maquina') return 'caminho de máquina: nunca pertence ao produto';
  if (o.classe === 'metadado-de-build') return 'metadado de publicação: vestígio por definição';
  if (o.classe === 'url-absoluta' || o.classe === 'url-sem-esquema') {
    const limpa = o.texto.replace(/\\\//g, '/');
    if (NAMESPACE_TECNICO.some((n) => limpa.startsWith(n))) return 'namespace técnico: exigido pelo formato';
    // Casa exatamente uma resposta que ENTROU no pacote? Então é referência de asset e
    // a reescrita determinística por posição já é o remédio — não há julgamento aqui.
    if (indice.has(limpa)) return 'casa asset do pacote: reescrita por posição resolve';
    if (indice.has(limpa.replace(/[?#].*$/, ''))) return 'casa asset do pacote (sem query)';
    // Gramática/DTD do W3C é exigência de FORMATO, como namespace — um SVG legado
    // carrega `!DOCTYPE svg PUBLIC ... svg10.dtd` e isso não é vestígio de origem.
    if (/^https?:\/\/www\.w3\.org\/(TR|Graphics|Math)\//.test(limpa)) return 'gramática do W3C: exigida pelo formato';
    // ⚠️ AVISO LEGAL: preservar por padrão. O Astra foi explícito — remover licença
    // não é classificação técnica comum, e um conflito entre a regra de limpeza e uma
    // exigência de licença ESCALA para decisão humana, nunca vai para um modelo.
    if (/\b(licen[sc]e|licenca|copyright|mit-license|gpl|apache)\b/i.test(limpa)) return 'aviso legal: preservar por padrão (conflito escala)';
  }
  if (o.classe === 'atributo-de-plataforma') {
    // `data-w-id` e `data-wf-page/site` são LIDOS pelo runtime do Webflow; `data-wf-domain`
    // é proveniência. A distinção é por NOME, que é fato, não julgamento.
    if (/data-wf-domain/i.test(o.texto)) return 'proveniência de domínio: removível por regra';
    if (/data-(?:w-id|wf-page|wf-site)/i.test(o.texto)) return 'lido pelo runtime: preservar por regra';
  }
  return null;
}

// Classifica URLs pelo ELEMENTO que as referencia, lendo o DOM montado.
const MIME = { '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.php':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.svg':'image/svg+xml','.webp':'image/webp','.avif':'image/avif','.ico':'image/x-icon','.mp4':'video/mp4','.m4v':'video/mp4','.webm':'video/webm','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.otf':'font/otf' };

async function papeisPeloDom(base) {
  const server = createServer(async (req, res) => {
    let rel = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname).replace(/^\/+/, '') || 'index.html';
    if (rel.endsWith('.uncraft-meta.json')) { res.writeHead(404).end(); return; }
    try {
      const full = path.resolve(base, rel);
      const body = await readFile(full);
      let tipo = MIME[path.extname(rel).toLowerCase()];
      try { const m = JSON.parse(await readFile(`${full}.uncraft-meta.json`, 'utf8')); if (m?.contentType) tipo = m.contentType; } catch { /* extensão basta */ }
      res.writeHead(200, { 'content-type': tipo || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((d) => server.listen(0, '127.0.0.1', d));
  const origem = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const contexto = await browser.newContext({ viewport: { width: 1440, height: 1200 }, serviceWorkers: 'block' });
  // Rede desligada: a classificação é do DOCUMENTO servido, não do que ele buscaria.
  await contexto.route('**/*', async (rota, req) => {
    const u = req.url();
    if (u.startsWith(origem) || u.startsWith('data:') || u.startsWith('blob:')) { await rota.continue(); return; }
    await rota.abort();
  });
  const pagina = await contexto.newPage();
  await pagina.goto(`${origem}/index.html`, { waitUntil: 'load', timeout: 120000 }).catch(() => {});
  await pagina.waitForTimeout(2500);
  const bruto = await pagina.evaluate(() => {
    const papeis = {};
    const anota = (url, papel) => {
      if (!url || /^(data|blob|javascript|about|mailto|tel):/i.test(url)) return;
      (papeis[url] = papeis[url] || []).push(papel);
    };
    for (const a of document.querySelectorAll('a[href]')) anota(a.href, 'navegacao');
    for (const l of document.querySelectorAll('link[href]')) anota(l.href, `recurso:link[${(l.getAttribute('rel') || '?').toLowerCase()}]`);
    for (const s of document.querySelectorAll('script[src]')) anota(s.src, 'recurso:script');
    for (const i of document.querySelectorAll('img[src]')) anota(i.src, 'recurso:img');
    for (const v of document.querySelectorAll('video[src],video[poster],source[src],audio[src]')) {
      anota(v.src || '', 'recurso:midia'); anota(v.poster || '', 'recurso:poster');
    }
    for (const f of document.querySelectorAll('iframe[src],embed[src],object[data]')) anota(f.src || f.data || '', 'recurso:moldura');
    for (const m of document.querySelectorAll('meta[content]')) {
      const chave = (m.getAttribute('property') || m.getAttribute('name') || '').toLowerCase();
      const v = m.getAttribute('content') || '';
      if (/^https?:/i.test(v)) anota(new URL(v, location.href).href, `metadado:${chave || '?'}`);
    }
    for (const f of document.querySelectorAll('form[action]')) anota(f.action, 'envio:form');
    return papeis;
  }).catch(() => ({}));
  await browser.close();
  await new Promise((d) => server.close(d));
  // O DOM resolve contra a origem local; a chave útil é a URL ORIGINAL, então
  // guarda-se também a forma sem a origem local para casar por sufixo.
  const papeis = new Map();
  for (const [url, lista] of Object.entries(bruto)) papeis.set(url, [...new Set(lista)]);
  return { papeis, origem };
}

// Da lista de papéis para a obrigação da receita. TABELA, não julgamento.
function obrigacao(papeis) {
  if (!papeis || !papeis.length) return null;
  const unicos = [...new Set(papeis.map((p) => p.split(':')[0]))];
  if (unicos.length > 1) return null;                                    // mais de um papel = ambíguo de verdade
  if (unicos[0] === 'navegacao') return 'navegação: neutralizar ação, manter o texto';
  if (unicos[0] === 'metadado') return 'metadado de compartilhamento: proveniência, removível';
  if (unicos[0] === 'envio') return 'envio de formulário: neutralizar (endpoint externo)';
  if (unicos[0] === 'recurso') return 'recurso: reescrita por posição resolve (ou falta na captura)';
  return null;
}

async function main() {
  const bundleArg = arg('--bundle');
  if (!bundleArg) { console.error('uso: --bundle <dir> [--json <arquivo>]'); process.exit(2); }
  const raiz = path.resolve(bundleArg);
  const assets = path.join(raiz, 'assets');
  const base = await readdir(assets).then(() => assets).catch(() => raiz);

  const arquivos = (await readdir(base, { recursive: true }))
    .map((f) => String(f).split(path.sep).join('/'))
    .filter((f) => !f.endsWith('.uncraft-meta.json'));

  // Índice do pacote: caminho local -> presente. Serve para decidir "casa asset".
  const indiceLocal = new Set(arquivos);
  // Índice por URL de origem não existe no pacote (a reescrita apagou), então o
  // casamento é pelo SUFIXO do caminho, que é como a convenção de captura grava.
  const casaPacote = (url) => {
    try {
      const u = new URL(url);
      const semBarra = `${u.host}${u.pathname}`.replace(/^\/+/, '');
      return indiceLocal.has(`_ext/${semBarra}`) || indiceLocal.has(u.pathname.replace(/^\/+/, ''));
    } catch { return false; }
  };
  const indice = { has: (url) => casaPacote(url) };

  const ocorrencias = [];
  for (const rel of arquivos) {
    if (!TEXTO.test(rel)) continue;
    const corpo = await readFile(path.join(base, rel), 'utf8').catch(() => null);
    if (corpo == null) continue;
    for (const { classe, re } of PADROES) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(corpo))) {
        const texto = m[0];
        const de = Math.max(0, m.index - CONTEXTO);
        ocorrencias.push({
          // Identidade estável: mesmo literal em dois lugares = duas ocorrências.
          id: createHash('sha1').update(`${rel}:${m.index}:${texto}`).digest('hex').slice(0, 12),
          arquivo: rel, posicao: m.index, classe, texto: texto.slice(0, 200),
          contexto: corpo.slice(de, Math.min(corpo.length, m.index + texto.length + CONTEXTO)).replace(/\s+/g, ' '),
        });
      }
    }
  }

  for (const o of ocorrencias) o.regra = regraDeterministica(o, indice);

  // Segunda passada: o que sobrou pode ser resolvido pelo ELEMENTO que o referencia.
  if (process.argv.includes('--dom')) {
    const { papeis } = await papeisPeloDom(base);
    for (const o of ocorrencias) {
      if (o.regra) continue;
      const limpa = o.texto.replace(/\\\//g, '/');
      const lista = papeis.get(limpa);
      const decidido = obrigacao(lista);
      if (decidido) { o.regra = `${decidido} [elemento: ${lista.join(', ')}]`; o.porDom = true; }
      else if (lista) o.papeisNoDom = lista;
    }
  }

  const resolvidas = ocorrencias.filter((o) => o.regra);
  const residuo = ocorrencias.filter((o) => !o.regra);
  const porRegra = {};
  for (const o of resolvidas) porRegra[o.regra] = (porRegra[o.regra] || 0) + 1;
  const residuoPorClasse = {};
  for (const o of residuo) residuoPorClasse[o.classe] = (residuoPorClasse[o.classe] || 0) + 1;
  const residuoPorHost = {};
  for (const o of residuo) {
    try { const h = new URL(o.texto.replace(/\\\//g, '/')).host; residuoPorHost[h] = (residuoPorHost[h] || 0) + 1; } catch { /* sem host */ }
  }

  const relatorio = {
    pacote: raiz,
    arquivosDeTexto: arquivos.filter((f) => TEXTO.test(f)).length,
    ocorrencias: ocorrencias.length,
    resolvidasDeterministicamente: resolvidas.length,
    residuoParaJulgamento: residuo.length,
    // O número que decide se vale um modelo: proporção que sobra.
    proporcaoDoResiduo: ocorrencias.length ? `${Math.round((100 * residuo.length) / ocorrencias.length)}%` : '0%',
    porRegra,
    residuoPorClasse,
    residuoPorHost,
    amostraDoResiduo: residuo.slice(0, 12).map((o) => ({ arquivo: o.arquivo, classe: o.classe, texto: o.texto.slice(0, 110) })),
  };
  const saida = arg('--json');
  if (saida) await writeFile(saida, JSON.stringify({ ...relatorio, residuo }, null, 2));
  console.log(JSON.stringify(relatorio, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
