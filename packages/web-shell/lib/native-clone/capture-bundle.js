/**
 * PRODUTOR DE CLONE NATIVO — a peça que faltava.
 *
 * O plano da frente (2026-07-26, l.332) pedia: "Extend deferred reconstruction
 * with an explicit native result kind. Keep the current Iter9 result path
 * unchanged." O lado que RECEBE foi construído (`register-bundle.js`,
 * `bundle-store.js`, a rota `/api/native-clone`); o lado que PRODUZ nunca foi.
 * Sem ele, `reconstructSiteNode` só tem `reconstructPage`, que devolve HTML de
 * visão — e esse HTML **descarta o movimento** (medido: zero ocorrências de
 * gsap/@keyframes/animation na saída).
 *
 * Este produtor faz o oposto do iter9: em vez de reconstruir a aparência por
 * visão, ele **preserva o site** — baixa cada recurso que a página pediu,
 * reescreve as referências para caminhos do bundle e mantém os scripts vivos.
 * É o mesmo princípio do clone que já provou fidelidade neste projeto
 * (`Clone/`, SSIM 0,96, altura exata, 369 assets).
 *
 * O que ele NÃO faz, e não finge fazer: não grava vídeo de referência, não
 * documenta inventário de animação e não roda QA offline. Essas três etapas da
 * receita original continuam fora. Aqui está a base — a página independente do
 * domínio, com o runtime do site preservado, no formato que o editor consome.
 */
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { chromium as chromiumPadrao } from 'playwright-core';
import { measureBundleSimilarity } from '../clone-similarity.js';
import { ChallengeRequiredError, detectChallengePage } from '../snapshot.js';
import { criarContabilidade } from './byte-ledger.js';
import { parseContentRange } from './byte-range.js';
import { referenceKindFor, rewriteDocumentReferences } from './rewrite-references.js';

/**
 * SSRF — o produtor GRAVA o corpo de cada resposta num bundle que o usuário vê.
 * Sem este bloqueio, uma página pública pode pedir `169.254.169.254` ou um
 * serviço interno e o conteúdo sai do outro lado. É diferente de só buscar a
 * URL: aqui há EXFILTRAÇÃO. Achado P0 do Sol.
 */
const FAIXAS_PROIBIDAS = [
  /^127\./, /^10\./, /^169\.254\./, /^192\.168\./, /^0\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];
function ipEhPrivado(ip) {
  if (!ip) return true;
  if (isIP(ip) === 6) {
    const n = ip.toLowerCase();
    return n === '::1' || n === '::' || n.startsWith('fc') || n.startsWith('fd')
      || n.startsWith('fe80') || n.startsWith('::ffff:127.') || n.startsWith('::ffff:10.')
      || n.startsWith('::ffff:169.254.') || n.startsWith('::ffff:192.168.');
  }
  return FAIXAS_PROIBIDAS.some((r) => r.test(ip));
}
const cacheHost = new Map();
export async function hostEhPublico(hostname) {
  if (cacheHost.has(hostname)) return cacheHost.get(hostname);
  let ok = false;
  try {
    if (isIP(hostname)) ok = !ipEhPrivado(hostname);
    else {
      const enderecos = await lookup(hostname, { all: true });
      // TODOS precisam ser públicos: um nome que resolve para público E privado
      // é o vetor clássico de rebind.
      ok = enderecos.length > 0 && enderecos.every((e) => !ipEhPrivado(e.address));
    }
  } catch (_) { ok = false; }
  cacheHost.set(hostname, ok);
  return ok;
}

/**
 * Mesma política de navegador do caminho de captura já existente: usa o
 * Browserbase quando há chave, senão um Chromium local. Sem isto o produtor
 * funcionaria no laboratório e falharia no servidor, que é o modo de falha que
 * separou o editor do produto até agora.
 */
async function abrirNavegador(launcher) {
  const chromium = launcher || chromiumPadrao;
  if (!launcher && process.env.BROWSERBASE_API_KEY) {
    return chromium.connectOverCDP(`wss://connect.browserbase.com?apiKey=${encodeURIComponent(process.env.BROWSERBASE_API_KEY)}`);
  }
  return chromium.launch({ headless: true });
}

const MAX_ASSETS = 1200;
const MAX_BYTES_TOTAL = 220 * 1024 * 1024;
const MAX_ASSET_BYTES = 40 * 1024 * 1024;
// Tetos da SEGUNDA tentativa. Ela existe para recuperar o caso comum (a
// resposta não chegou naquela passagem), não para virar um segundo download da
// internet inteira.
const RETRY_MAX_ARQUIVOS = 120;
const RETRY_CONCORRENCIA = 6;
const RETRY_MAX_SALTOS = 3;
const RETRY_ORCAMENTO_BYTES = 60 * 1024 * 1024;
// Página com altura absurda mantinha o navegador rolando por horas (P0 do Sol).
const MAX_ALTURA_PX = 120000;
// Teto da espera pelos corpos em voo na etapa 'collecting' (ver lá). Bem
// abaixo do prazo de 90s da rota; corpos já recebidos resolvem na hora. O env
// existe para o teste de corrida (resposta tardia × repescagem) rodar em
// segundos; fora de teste fica o padrão.
const COLETA_TETO_MS = Math.max(200, Number(process.env.UNCRAFT_CAPTURE_COLLECT_CAP_MS) || 20_000);
// Quanto tempo uma interstitial de challenge tem para se limpar sozinha antes
// de ser recusada (ver o detector na captura).
const CHALLENGE_TOLERANCIA_MS = 5_000;

const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

/**
 * Caminho de bundle a partir de uma URL absoluta. Determinístico e sem colisão
 * entre hosts: o host entra no caminho, então dois CDNs com `/main.js` não se
 * sobrescrevem.
 */
export function bundlePathForUrl(rawUrl, entryUrl) {
  const url = new URL(rawUrl);
  const entry = new URL(entryUrl);
  const mesmoHost = url.host === entry.host;
  let caminho = url.pathname.replace(/^\/+/, '');
  if (!caminho || caminho.endsWith('/')) caminho += 'index.html';
  // A query faz parte da identidade do recurso: `?v=2` costuma ser outro
  // arquivo. Sem isso, duas versões colidiriam e uma sumiria em silêncio.
  if (url.search) {
    const marca = createHash('sha1').update(url.search).digest('hex').slice(0, 8);
    caminho = caminho.replace(/(\.[^./]+)$/, `.${marca}$1`) || `${caminho}.${marca}`;
    if (!/\.[^./]+$/.test(caminho)) caminho += `.${marca}`;
  }
  const prefixo = mesmoHost ? '' : `_ext/${url.host}/`;
  return `${prefixo}${caminho}`
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/[^A-Za-z0-9._/-]/g, '_');
}

/**
 * Candidatos de um valor de `srcset` (defeito 1b, 2026-08-20). A captura só
 * salvava o candidato que o browser escolheu no viewport da captura; os outros
 * ficavam absolutos no HTML e a CSP do gateway (img-src 'self') os bloqueia
 * para sempre. Split cru por vírgula é proibido — data URLs contêm vírgula.
 * Algoritmo (WHATWG simplificado): um candidato é um token sem whitespace
 * seguido de descriptor opcional; a vírgula separadora vem DEPOIS do
 * descriptor (ou do token). Limitação documentada: uma URL com vírgula crua
 * seguida de espaço quebra — o formato exige que URLs assim sejam escapadas.
 */
export function srcsetCandidateUrls(value) {
  if (typeof value !== 'string' || !value.trim()) return [];
  const urls = [];
  let rest = value.trim();
  while (rest) {
    rest = rest.replace(/^[,\s]+/, '');
    if (!rest) break;
    // A candidate runs to the next whitespace. Per the HTML spec the comma is
    // only a separator: if the token ENDS with commas, this candidate has no
    // descriptor and the next one starts right after. Scanning greedily past
    // the comma (the old `\S*`) swallowed the separator and turned every
    // later candidate into a "descriptor" — `srcset="a.png, a_2x.png 2x"`
    // yielded ONE url, and the rest became unreachable images in the clone
    // (measured on a real site, 2026-08-21). Commas inside a data: URL are
    // safe because they never sit at the end of the token.
    const token = /^\S+/.exec(rest)[0];
    rest = rest.slice(token.length);
    const url = token.replace(/,+$/, '');
    if (url) urls.push(url);
    if (token.endsWith(',')) continue;
    // Otherwise skip this candidate's descriptor, up to the separating comma.
    let depth = 0;
    let i = 0;
    while (i < rest.length) {
      const ch = rest[i];
      if (ch === '(') depth += 1;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      else if (ch === ',' && depth === 0) break;
      i += 1;
    }
    rest = rest.slice(i);
  }
  return urls;
}


/**
 * Captura uma URL como bundle nativo.
 *
 * @param {string} url
 * @param {object} opts
 * @param {(estado: object) => void} [opts.onProgress]
 * @param {object} [opts.browser] navegador já aberto (para teste)
 * @returns {Promise<{kind:'native', bundle:object, relatorio:object}>}
 */
// Adaptador: a resposta do `context.request.fetch` (Playwright) com a MESMA
// forma que a repescagem lê do `fetch` do Node — status, headers.get, ok e um
// body com getReader() de um pedaço só. `maxRedirects: 0` devolve o 3xx para
// o salto ser validado aqui, como no caminho do Node.
async function pedirPeloNavegador(context, alvo) {
  const r = await context.request.fetch(alvo, { maxRedirects: 0, timeout: 12000 });
  const h = r.headers();
  const status = r.status();
  const ok = r.ok();
  const get = (k) => (h[String(k).toLowerCase()] ?? null);
  // Redirect: devolve o 3xx para o salto ser validado pelo chamador; a
  // resposta não carrega corpo, mas ainda ocupa memória no processo do
  // Playwright até `dispose()` — libera já.
  if (status >= 300 && status < 400) {
    await r.dispose().catch(() => {});
    return { status, ok, headers: { get }, body: null };
  }
  // ⚠️ `context.request` BUFFERIZA o corpo inteiro antes de devolver (não há
  // leitura em fluxo por esta API), então o teto de tamanho tem que morder
  // ANTES da alocação: content-length acima do teto por-arquivo = recusa sem
  // baixar (Astra 2026-09-08 #4). Cabeçalho ausente/mentiroso no site honesto
  // do modelo de ameaça é o resíduo já aceito da interceptação.
  const declarado = Number(get('content-length') || 0);
  if (!ok || declarado > MAX_ASSET_BYTES) {
    await r.dispose().catch(() => {});
    return { status, ok, headers: { get }, body: null };
  }
  const bytes = await r.body();
  // O corpo já está em mão: descarta o handle do vendor para não acumular
  // respostas não liberadas até o fim da captura (Astra #4).
  await r.dispose().catch(() => {});
  return {
    status,
    ok,
    headers: { get },
    body: {
      getReader() {
        let entregue = false;
        return {
          async read() {
            if (entregue) return { done: true, value: undefined };
            entregue = true;
            return { done: false, value: new Uint8Array(bytes) };
          },
          async cancel() { /* corpo já bufferizado e handle já liberado */ },
        };
      },
    },
  };
}

export async function captureNativeBundle(url, opts = {}) {
  const {
    onProgress = () => {}, viewport = { width: 1440, height: 900 }, chromium, signal,
    // Sessão EMPRESTADA (spec 2026-09-08 §4.4): navegador/contexto/página já
    // verificados por outro (o job de challenge). O produtor usa a página
    // dada — a liberação da verificação vive nela — e NÃO fecha o que não é
    // dele. Sem `session`, comportamento idêntico ao de sempre.
    session = null,
    challengeToleranceMs = CHALLENGE_TOLERANCIA_MS,
  } = opts;
  const emprestada = Boolean(session && session.page);

  // A URL de ENTRADA passa pelo mesmo bloqueio dos subrecursos.
  const alvo = new URL(url);
  if (!/^https?:$/.test(alvo.protocol) || !(await hostEhPublico(alvo.hostname))) {
    throw Object.assign(new Error('native_bundle_blocked_host'), { code: 'blocked_host' });
  }

  onProgress({ etapa: 'launching' });
  const browser = emprestada ? session.browser : await abrirNavegador(chromium);
  const fecharSePropria = async () => { if (!emprestada) await browser.close().catch(() => {}); };
  const recursos = new Map();   // url absoluta -> { bytes, contentType }
  // UMA porta para os bytes: interceptação e repescagem reservam pela mesma
  // contabilidade, então o teto global não pode ser furado por corrida entre
  // as duas (achado do Sol).
  const conta = criarContabilidade(MAX_BYTES_TOTAL);
  const descartados = [];
  // ⚠️ Os handlers de `response` são assíncronos e ninguém os aguardava: a
  // montagem do bundle podia rodar com corpos ainda em leitura, e eles sumiam
  // sem sequer entrar em `descartados`. Achado P1 do Sol.
  const emVoo = new Set();
  // URL de cada corpo ainda em leitura: quem estiver aqui quando o teto da
  // coleta morder é "não terminou", e a repescagem NÃO deve gastar mais 12s
  // re-pedindo exatamente o que acabou de travar (Claude review r1 #3).
  const lendo = new Map(); // url -> quantos handlers ainda leem (refcount: Astra r2 #3)
  // Geração do documento principal por URL (ver o handler): recarregar a
  // mesma URL substitui o documento anterior mesmo com o corpo dele em voo.
  const geracao = new Map();
  // ⚠️ O `Promise.race` de fora rejeita, mas nada cancelava a captura — o
  // navegador seguia rolando por horas numa página gigante. Achado P0 do Sol.
  let cancelado = false;
  const aoCancelar = () => { cancelado = true; fecharSePropria(); };
  if (signal) {
    if (signal.aborted) { await fecharSePropria(); throw Object.assign(new Error('native_bundle_aborted'), { code: 'aborted' }); }
    signal.addEventListener('abort', aoCancelar, { once: true });
  }

  try {
    const context = emprestada ? session.context : await browser.newContext({ viewport });
    const page = emprestada ? session.page : await context.newPage();
    if (emprestada) await page.setViewportSize(viewport).catch(() => {});

    page.on('response', (res) => {
      const tarefa = (async () => {
        const u = res.url();
        let registrei = false;
        try {
          if (cancelado || !/^https?:/i.test(u)) return;
          // Documento PRINCIPAL recarregado na MESMA URL substitui o anterior
          // (Astra r1 #1, 2026-09-06): uma interstitial de challenge que limpa
          // e recarrega U deixaria o dedup por URL descartar o documento REAL,
          // o detector veria a página boa e o pacote sairia com a interstitial.
          // O último documento navegado é o que o navegador está mostrando.
          // Os bytes do anterior ficam contados na contabilidade — sobra
          // conservadora, nunca fura o teto.
          const req = res.request();
          const documentoPrincipal = req.resourceType() === 'document' && req.isNavigationRequest() && req.frame() === page.mainFrame();
          if (recursos.has(u) && !documentoPrincipal) return;
          // GERAÇÃO por URL: o recarregamento pode chegar enquanto o handler da
          // interstitial ainda lê o corpo (vaga ainda nula) — substituir "só
          // vaga preenchida" descartava o documento real por timing (oscilou
          // no teste). O último documento navegado é o dono; depois de esperar,
          // quem não for mais o dono sai calado.
          const geracaoMinha = (geracao.get(u) || 0) + 1;
          geracao.set(u, geracaoMinha);
          // Só quem REGISTROU desregistra, e por contagem: uma resposta
          // duplicada que sai cedo (ou uma geração antiga terminando) não
          // pode apagar o marcador de quem ainda lê (Astra r2 #3).
          lendo.set(u, (lendo.get(u) || 0) + 1);
          registrei = true;
          // ⚠️ RESERVA ANTES DE QUALQUER `await`. É o que torna a dupla
          // `has` + `set` atômica: em JavaScript nada intercala entre as duas
          // se não houver espera no meio. A checagem de host estava aqui e
          // furava a guarda — duas respostas simultâneas da mesma URL passavam
          // pelo `has` antes de qualquer uma reservar, e mídia pedida por
          // FAIXAS é exatamente o caso que produz respostas simultâneas da
          // mesma URL (Sol). Medir zero duplicações num clone não prova
          // impedimento: prova que a corrida não aconteceu naquela execução.
          if (recursos.size >= MAX_ASSETS) { descartados.push({ u, motivo: 'limite de arquivos' }); return; }
          recursos.set(u, null);
          if (!(await hostEhPublico(new URL(u).hostname))) {
            recursos.delete(u); descartados.push({ u, motivo: 'host nao publico' }); return;
          }
          // ⚠️ MÍDIA NÃO PASSA PELO `body()`. É o caso onde cabeçalho mentir
          // DÓI de verdade — vídeo de dezenas de MB bufferizado inteiro só
          // para ser recusado — e o `body()` de mídia costuma falhar de toda
          // forma (faixas 206, buffer que o Chromium não guarda). A reserva
          // fica NULA e a repescagem, que tem teto DURANTE a leitura, busca o
          // arquivo completo. Fecha o grosso do residual de memória.
          // Duas leituras somadas: `resourceType` classifica quem INICIOU o
          // pedido (o <video>), e um vídeo baixado por fetch/XHR chega como
          // 'fetch' — só o content-type da RESPOSTA o entrega (Sol).
          const tipoResposta = (res.headers()['content-type'] || '').split(';')[0].trim();
          if (res.request().resourceType() === 'media' || /^(?:video|audio)\//i.test(tipoResposta)) return;
          // ⚠️ REJEIÇÃO ANTECIPADA, não proteção de memória. `content-length` é
          // opcional, pode mentir e pode vir comprimido — quando falta ou está
          // errado, `res.body()` carrega o arquivo inteiro do mesmo jeito, e a
          // API de interceptação do Playwright não oferece leitura em fluxo.
          //
          // Ou seja: o cabeçalho poupa memória no caso comum (servidor honesto
          // anunciando arquivo grande) e não poupa nada no caso adversário. O
          // teto DEPOIS da leitura continua valendo, e é ele que garante que o
          // arquivo não entre no pacote. Quem tem limite de verdade durante a
          // leitura é a repescagem, que usa `fetch` com `getReader()` (Sol).
          //
          // Residual assumido, agora estreito: pico de memória de UM corpo
          // NÃO-mídia com cabeçalho ausente ou mentiroso — limitado ao que o
          // navegador já baixou, num site que o modelo de ameaça assume
          // honesto (decisão de 2026-08-09).
          const declarado = Number(res.headers()['content-length'] || 0);
          if (declarado > MAX_ASSET_BYTES || (declarado && declarado > conta.restante())) {
            recursos.delete(u); descartados.push({ u, motivo: 'grande demais (declarado)' }); return;
          }
          // SEGUNDA BARREIRA (Sol): sem content-length ainda dá para saber o
          // tamanho ANTES de materializar — `finished()` + `sizes()` entrega
          // os bytes RECEBIDOS (codificados). Rejeitar aqui evita o body() de
          // um corpo grande sem cabeçalho. Conservador com compressão: o
          // decodificado pode ser maior; o teto DEPOIS do body() segue sendo
          // a autoridade final.
          await res.finished().catch(() => {});
          const medidos = await res.request().sizes().then((t) => t.responseBodySize, () => null);
          if (Number.isFinite(medidos) && (medidos > MAX_ASSET_BYTES || medidos > conta.restante())) {
            recursos.delete(u); descartados.push({ u, motivo: 'grande demais (recebido)' }); return;
          }
          const bytes = await res.body().catch(() => null);
          // ⚠️ DEPOIS de esperar, a reserva pode não ser mais minha (Astra r1
          // #3): com a coleta limitada, uma resposta original que só termina
          // depois do teto encontra a vaga já PREENCHIDA pela repescagem — ou
          // já PURGADA. Mexer nela apagaria um asset bom (`delete` no ramo de
          // teto) ou o contaria duas vezes (`confirmar` + `set`). Só quem ainda
          // segura a reserva nula decide; os outros saem calados.
          if (recursos.get(u) !== null || geracao.get(u) !== geracaoMinha) return;
          if (!bytes) {
            const status = res.status();
            // 204/304 não têm corpo por natureza. Redirect PODE ter corpo
            // (uma página "Moved") — mas esse corpo nunca é conteúdo: o
            // navegador não o renderiza, segue para o destino, e o destino
            // chega como resposta PRÓPRIA, com URL própria, capturada por si.
            // Guardar a vaga faria a repescagem buscar a URL do redirect e
            // duplicar o destino sob outro nome.
            //
            // Mas "redirecionou de fato" é veredito do NAVEGADOR, não
            // inferência por cabeçalho: `Location` presente não prova que foi
            // seguido (um 300 carrega Location e o navegador fica). O fato é
            // `request().redirectedTo()` — medido no ponto exato desta
            // decisão: 301 seguido aponta o sucessor, 300 parado vem nulo.
            // Quem não redirecionou fica como reserva nula: a repescagem
            // tenta, e se também não conseguir, a URL entra NOMEADA no
            // relatório em vez de sumir calada (Sol, 4 rodadas até aqui).
            const redirecionou = status >= 300 && status < 400 && Boolean(res.request().redirectedTo());
            if (status === 204 || status === 304 || redirecionou) { recursos.delete(u); return; }
            // ⚠️ O RESTO FICA COMO RESERVA NULA — é exatamente isso que a
            // repescagem procura (`filter(([, v]) => !v)`). Apagar aqui fazia
            // `faltantes` nascer sempre vazio e a repescagem virar código
            // morto: medido no site real, a etapa `retrying` nunca disparava e
            // os dois vídeos ficavam de fora. Quem apaga e nomeia no relatório
            // é o purgo DEPOIS da repescagem.
            //
            // É o caso comum de mídia: vídeo é pedido por FAIXAS de bytes, e o
            // corpo dessas respostas não é legível pela interceptação.
            return;
          }
          // ⚠️ 206 PARCIAL com corpo legível EXISTE — medido no site real
          // (`bytes=622592-` chegou legível com 2,3MB de um arquivo de 2,9MB).
          // Guardá-lo como o arquivo inteiro poria um pedaço do MEIO do vídeo
          // no lugar do vídeo; hoje a ordem das respostas salva, e ordem não é
          // garantia. Só entra 206 cujo Content-Range cobre o arquivo inteiro
          // E cujo corpo tem exatamente esse tamanho; o resto fica como
          // reserva nula, e a repescagem busca o arquivo completo, sem Range.
          if (res.status() === 206) {
            const cobertura = parseContentRange(res.headers()['content-range']);
            const completo = cobertura
              && cobertura.inicio === 0
              && cobertura.fim === cobertura.total - 1
              && bytes.byteLength === cobertura.total;
            if (!completo) return;
          }
          const bilhete = bytes.byteLength > MAX_ASSET_BYTES ? null : conta.reservar(bytes.byteLength);
          if (!bilhete) {
            // Contabilidade FECHADA não é "grande demais": é corpo que chegou
            // depois da montagem (a página viva ainda pede coisas entre o
            // fechamento e o retorno). O rótulo fabricado ia parar no
            // relatório do usuário (Claude review r1 #1).
            recursos.delete(u);
            descartados.push({ u, motivo: conta.estaFechada() ? 'chegou apos a montagem' : 'grande demais' });
            return;
          }
          // O corpo já está em mão: confirma na hora.
          conta.confirmar(bilhete);
          recursos.set(u, { bytes, contentType: (res.headers()['content-type'] || '').split(';')[0].trim() });
        } catch (_) { /* resposta sem corpo (redirect, 204, 304) não é falha */ }
        finally {
          if (registrei) {
            const n = (lendo.get(u) || 1) - 1;
            if (n <= 0) lendo.delete(u); else lendo.set(u, n);
          }
        }
      })();
      emVoo.add(tarefa);
      tarefa.finally(() => emVoo.delete(tarefa));
    });

    onProgress({ etapa: 'navigating' });
    await page.goto(url, { waitUntil: 'load', timeout: 90000 });
    await page.waitForTimeout(2500);

    // Interstitial de bot-protection (Cloudflare "Just a moment…", hCaptcha,
    // Akamai, PerimeterX): a captura de referência já recusa e entrega o
    // handoff humano; este produtor NÃO recusava e empacotaria a interstitial
    // COMO o site (medido no amigosecreto, 2026-09-06). Mesmo detector, mesmo
    // erro tipado — a rota devolve 409 e a UI reaproveita o fluxo do modal.
    //
    // Com TOLERÂNCIA: uma interstitial pode se limpar sozinha e recarregar a
    // mesma URL (é o que a "managed challenge" faz num navegador comum), e o
    // veredito tem que ser sobre o documento ESTÁVEL — medido no teste: o
    // recarregamento já tinha sido servido e o detector ainda via a
    // interstitial porque o navegador não tinha trocado o documento. Re-checa
    // por até CHALLENGE_TOLERANCIA_MS; só recusa o que PERSISTE (o site real
    // medido persistiu 45s+ — recusa em 5s em vez de estourar 90s).
    //
    // ⚠️ O detector é FAIL-OPEN (exceção → null): um contexto destruído por
    // navegação NO MEIO da re-checagem viraria "limpou" (Astra r2 #1). Por
    // isso o veredito que libera é sempre o de um documento CARREGADO — depois
    // de qualquer null, espera o load e checa de novo dentro do prazo.
    // Modo ESTRITO: `null` = olhei e está limpo (libera); objeto = challenge;
    // `undefined` = não consegui olhar (NÃO libera — segue tentando no prazo).
    let veredito = await detectChallengePage(page, { strict: true });
    if (veredito !== null) {
      const limite = Date.now() + challengeToleranceMs;
      let ultimo = veredito || null;
      for (;;) {
        if (Date.now() >= limite || cancelado) {
          const k = ultimo || { kind: 'generic_challenge', signals: ['uninspectable'] };
          throw new ChallengeRequiredError(k.kind, url, k.signals);
        }
        await page.waitForTimeout(500);
        // Documento que não terminou de carregar também é "não consegui
        // olhar" — um veredito limpo só vale sobre documento carregado
        // (Astra r3; defesa em profundidade, site hostil está fora do modelo).
        const carregou = await page.waitForLoadState('load', { timeout: 2000 }).then(() => true, () => false);
        veredito = carregou ? await detectChallengePage(page, { strict: true }) : undefined;
        if (veredito === null) break;
        if (veredito) ultimo = veredito;
      }
    }

    // Percorre a página inteira: recurso preguiçoso só é pedido quando entra na
    // tela, e sem isso o bundle sairia sem metade das imagens.
    onProgress({ etapa: 'scrolling' });
    const altura = Math.min(await page.evaluate(() => document.body.scrollHeight), MAX_ALTURA_PX);
    for (let y = 0; y < altura && !cancelado; y += 700) {
      await page.evaluate((v) => window.scrollTo(0, v), y);
      await page.waitForTimeout(160);
    }
    if (cancelado) throw Object.assign(new Error('native_bundle_aborted'), { code: 'aborted' });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1200);

    // A referência do SSIM permanente: o site VIVO, topo, assentado — tirada
    // AQUI porque depois desta linha a página ainda muda (fechamento dispara
    // buscas) e o browser fecha antes de qualquer medição externa. Fail-open.
    let screenshotVivo = null;
    try {
      const png = await page.screenshot({ type: 'png' });
      screenshotVivo = `data:image/png;base64,${png.toString('base64')}`;
    } catch (_) { /* sem referência = sem medida, nunca sem clone */ }

    // FECHAMENTO DE REFERÊNCIAS (defeito 1b, 2026-08-20): o browser só pediu o
    // candidato de `srcset` que o viewport da captura escolheu e os backgrounds
    // de regras CSS que algum elemento casou. Tudo que ficar de fora permanece
    // ABSOLUTO no HTML/CSS gravado e a CSP do gateway (img-src 'self') bloqueia
    // para sempre. Duas fases DE PROPÓSITO (achado P0 do Sol, 2026-08-20):
    // (1) coletar os candidatos na página; (2) filtrar no Node com
    // `hostEhPublico` ANTES de carregar — a guarda do handler de response só
    // roda depois que o pedido já saiu. Isto checa a URL INICIAL dos GETs que
    // NÓS iniciamos; NÃO é política de egress completa: um 3xx para endereço
    // privado escapa (Sol r2 #1), e rebind DNS idem (lookup aqui, o browser
    // re-resolve — mesmo resíduo da rota from-url, 182). Ambos exigem site
    // adversarial, que está FORA do modelo de ameaça por decisão registrada
    // (178/171, mesmos 7 gatilhos); a guarda de EXFILTRAÇÃO (persistir corpo)
    // segue no handler de response, que era o P0 original do 179. Egress por
    // request (route interception por hop) é a re-arquitetura deferida.
    // Os aprovados carregam via `new Image()` (sem CORS) e entram pela
    // interceptação normal — limites e relatório se aplicam por construção.
    onProgress({ etapa: 'closing-refs' });
    const candidatosBrutos = await page.evaluate((cap) => {
      // Parser duplicado de srcsetCandidateUrls DE PROPÓSITO: page.evaluate
      // não serializa closures do Node; o teste unitário cobre o exportado.
      const parseSrcset = (value) => {
        if (typeof value !== 'string' || !value.trim()) return [];
        const urls = [];
        let rest = value.trim();
        while (rest) {
          rest = rest.replace(/^[,\s]+/, '');
          if (!rest) break;
          const token = /^\S+/.exec(rest)[0];
          rest = rest.slice(token.length);
          const url = token.replace(/,+$/, '');
          if (url) urls.push(url);
          if (token.endsWith(',')) continue;
          let depth = 0;
          let i = 0;
          while (i < rest.length) {
            const ch = rest[i];
            if (ch === '(') depth += 1;
            else if (ch === ')') depth = Math.max(0, depth - 1);
            else if (ch === ',' && depth === 0) break;
            i += 1;
          }
          rest = rest.slice(i);
        }
        return urls;
      };
      const seen = new Set();
      const candidatos = [];
      const push = (u, base) => {
        let abs = null;
        try { abs = new URL(u, base || document.baseURI).href; } catch { return; }
        if (!/^https?:/i.test(abs) || seen.has(abs)) return;
        seen.add(abs);
        candidatos.push(abs);
      };
      // `querySelectorAll` does not enter <template>, whose content is a
      // separate fragment — markup that a site clones into the page later
      // (Sol). Collect the roots first and query each of them.
      const raizes = [document];
      const filaTpl = [...document.querySelectorAll('template')];
      while (filaTpl.length && raizes.length < 500) {
        const tpl = filaTpl.shift();
        if (!tpl.content) continue;
        raizes.push(tpl.content);
        filaTpl.push(...tpl.content.querySelectorAll('template'));
      }
      const buscarTodos = (sel) => raizes.flatMap((raiz) => [...raiz.querySelectorAll(sel)]);
      for (const el of buscarTodos('img[srcset], source[srcset]')) {
        for (const u of parseSrcset(el.getAttribute('srcset'))) push(u);
      }
      // The plain `src` is skipped by the browser whenever a srcset candidate
      // wins, so it never reaches the interception — and then the rewriter has
      // nowhere to point it, leaving a broken fallback (measured 2026-08-21).
      for (const el of buscarTodos('img[src], source[src], video[src], audio[src], video[poster]')) {
        const raw = el.getAttribute('src') || el.getAttribute('poster');
        if (raw) push(raw);
      }
      for (const el of buscarTodos('[data-srcset]')) {
        for (const u of parseSrcset(el.getAttribute('data-srcset'))) push(u);
      }
      for (const el of buscarTodos('link[imagesrcset]')) {
        for (const u of parseSrcset(el.getAttribute('imagesrcset'))) push(u);
      }
      // Icons: the browser fetches at most the one it picks for the tab, so
      // the alternates stay uncaptured and their references end up blocked.
      for (const el of buscarTodos('link[rel*="icon"][href], link[rel="apple-touch-icon"][href]')) {
        push(el.getAttribute('href'));
      }
      const urlRe = () => /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
      for (const sheet of document.styleSheets) {
        let rules;
        try { rules = sheet.cssRules; } catch { continue; }
        const base = sheet.href || document.baseURI;
        for (const rule of rules) {
          const text = rule.cssText || '';
          const re = urlRe();
          let m;
          while ((m = re.exec(text))) push(m[2], base);
        }
      }
      for (const el of buscarTodos('[style*="url("]')) {
        const re = urlRe();
        let m;
        const text = el.getAttribute('style') || '';
        while ((m = re.exec(text))) push(m[2]);
      }
      return candidatos.slice(0, cap);
      // Sanity ceiling only. The REAL budget is applied on the Node side,
      // after dropping candidates already captured — cutting here would let
      // already-present URLs at the head of the list eat the whole budget and
      // hide the missing ones behind them (Sol).
    }, 5000).catch(() => []);
    const aprovados = [];
    const orcamento = Math.max(0, MAX_ASSETS - recursos.size);
    for (const u of candidatosBrutos) {
      if (cancelado || aprovados.length >= orcamento) break;
      if (recursos.has(u)) continue;   // já capturado: não gasta orçamento
      try {
        if (await hostEhPublico(new URL(u).hostname)) aprovados.push(u);
        else descartados.push({ u, motivo: 'host nao publico' });
      } catch (_) { /* URL inválida não carrega */ }
    }
    const refsExtras = aprovados.length === 0 ? 0 : await page.evaluate(async (urls) => {
      await Promise.all(urls.map((u) => new Promise((done) => {
        const img = new Image();
        img.onload = done;
        img.onerror = done;
        setTimeout(done, 8000);
        img.src = u;
      })));
      return urls.length;
    }, aprovados).catch(() => 0);
    if (cancelado) throw Object.assign(new Error('native_bundle_aborted'), { code: 'aborted' });
    // Respostas dos candidatos ainda podem estar em voo; o allSettled do
    // 'collecting' logo abaixo as espera junto com todo o resto.

    // DESIGN.MD typography — computed-style measurement of the LIVE page
    // (same probe as lib/snapshot.js), run BEFORE the collection settles ON
    // PURPOSE: getComputedStyle can trigger late font fetches, and a response
    // arriving after the purge loop would crash the destructure or mutate the
    // supposedly immutable assets/contentHash (Sol review, reproduced). Inside
    // the interception window, anything it triggers is collected normally.
    // Best-effort by construction: failure yields null, capture untouched.
    // page (same probe as lib/snapshot.js). Best-effort by construction: any
    // failure yields null and the capture proceeds untouched. The value rides
    // the producer OUTPUT as a sibling of `bundle` — NEVER inside it — so the
    // bundle's content hash, runtime fingerprint, and every existing clone
    // stay byte-identical (no price to pay).
    const typeSample = await page.evaluate(() => {
      const pick = (selectors) => {
        for (const sel of selectors) {
          let el = null;
          try { el = [...document.querySelectorAll(sel)].find((cand) => { const r = cand.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (cand.textContent || '').trim().length > 2; }); } catch { /* bad selector */ }
          if (el) {
            const cs = getComputedStyle(el);
            const family = (cs.fontFamily.split(',')[0] || '').replace(/["']/g, '').trim();
            const size = Math.round(parseFloat(cs.fontSize) || 0);
            if (family && size > 0) return { family, size, weight: Number(cs.fontWeight) || 400 };
          }
        }
        return null;
      };
      const display = pick(['h1', 'h2', '[class*="hero"] *']);
      const body = pick(['main p', 'p', 'body']);
      return (display || body) ? { display, body } : null;
    }).catch(() => null);

    onProgress({ etapa: 'collecting' });
    // Espera os corpos que ainda estavam sendo lidos ANTES de montar o bundle —
    // COM TETO. Medido em site real (amigosecreto, 2026-09-06): um beacon da
    // Cloudflare (`fetch` 204) cujo `finished()` NUNCA resolvia segurou esta
    // espera por 45s+, o prazo de 90s da rota estourou e a captura inteira
    // virou 504 + reembolso, com a página já toda em mãos. Uma resposta que
    // não termina não pode ser refém da coleta: passado o teto, o que ainda
    // está em voo fica como reserva nula e o purgo abaixo o NOMEIA no
    // relatório ('corpo nao chegou'). Um corpo já recebido resolve na hora,
    // então o teto só morde quem de fato não terminou.
    await Promise.race([
      Promise.allSettled([...emVoo]),
      new Promise((resolve) => setTimeout(resolve, COLETA_TETO_MS)),
    ]);
    // Quem ainda estava lendo quando o teto mordeu NÃO vai à repescagem: o
    // navegador não terminou em COLETA_TETO_MS, e pedir de novo pelo Node
    // custaria mais 12s por arquivo em cima do mesmo endpoint travado. Fica
    // como reserva nula e o purgo o nomeia ('corpo nao chegou').
    const presos = new Set(lendo.keys());

    // ⭐ UMA SEGUNDA TENTATIVA, pelo servidor, antes de desistir.
    //
    // Medido no clone real: 3 imagens ficaram de fora com "corpo nao chegou", e
    // como o carrossel as repete, 7 quadros do site aparecem vazios. Não é
    // lacuna de desenho — a coleta já pede o `src` simples; é a resposta que não
    // chegou a tempo naquela passagem. Uma tentativa pelo contexto da página
    // (mesmos cookies e cabeçalhos) recupera o caso comum, e o que continuar
    // faltando segue nomeado no relatório.
    const faltantes = [...recursos].filter(([u, v]) => !v && !presos.has(u)).map(([u]) => u);
    if (faltantes.length) {
      onProgress({ etapa: 'retrying', quantos: faltantes.length });
      const fila = faltantes.slice(0, RETRY_MAX_ARQUIVOS);
      // ⚠️ O orçamento da repescagem é o dela, mas cada byte passa pela MESMA
      // contabilidade da interceptação — que segue viva enquanto isto roda. Um
      // orçamento próprio calculado uma vez gastaria o mesmo espaço livre duas
      // vezes (Sol).
      let orcamento = Math.min(RETRY_ORCAMENTO_BYTES, conta.restante());
      const buscarUmaVez = async (u) => {
        // Geração no INÍCIO da repescagem: se o navegador recarregar U no meio
        // (documento principal → geração nova, vaga nula nova), os bytes
        // antigos desta repescagem não podem vencer o documento mais novo
        // (Astra r2 #2). Exige-se a mesma geração ao confirmar e ao publicar.
        const geracaoNoInicio = geracao.get(u) || 0;
        // ⚠️ REDIRECT MANUAL, com cada salto validado. Seguir sozinho valida só
        // o primeiro host — um 302 de host público para link-local passaria por
        // cima da guarda (mesma classe do achado de 2026-08-14).
        //
        // ⚠️ E LEITURA EM FLUXO, com aborto. `page.request.fetch` já baixa a
        // resposta inteira antes de devolver, e `content-length` pode estar
        // ausente ou mentir — um teto conferido depois disso limita o que se
        // ACEITA, nunca a memória nem os bytes trafegados (Sol). Aqui os bytes
        // são contados enquanto chegam e a conexão é cortada no limite.
        let alvo = u;
        for (let salto = 0; salto <= RETRY_MAX_SALTOS; salto += 1) {
          if (!(await hostEhPublico(new URL(alvo).hostname))) return null;
          const parada = new AbortController();
          const relogio = setTimeout(() => parada.abort(), 12000);
          try {
            // Com sessão emprestada a repescagem usa o JAR de cookies da
            // sessão verificada (`context.request` compartilha os cookies do
            // contexto) — o fetch do Node não os tem. ⚠️ RESÍDUO NOMEADO
            // (Astra 2026-09-08 #2): `context.request` roda no processo LOCAL
            // do Playwright, NÃO pelo egress do navegador remoto; um
            // cf_clearance amarrado ao IP da sessão NÃO valida nesta
            // repescagem. A captura PRIMÁRIA (os pedidos do navegador real)
            // não é afetada; um asset atrás de challenge que faltou na 1ª
            // passagem fica NOMEADO como ausente, nunca corrompe. Sem
            // streaming aqui: `body()` bufferiza, então o adaptador rejeita
            // ANTES pelo content-length e a resposta é sempre descartada.
            const resposta = emprestada
              ? await pedirPeloNavegador(context, alvo)
              : await fetch(alvo, { redirect: 'manual', signal: parada.signal });
            const status = resposta.status;
            if (status >= 300 && status < 400) {
              const destino = resposta.headers.get('location');
              if (!destino) return null;
              alvo = new URL(destino, alvo).toString();
              continue;
            }
            if (!resposta.ok || !resposta.body) return null;
            const pedacos = [];
            let lidos = 0;
            // ⚠️ Reserva feita e NÃO aceita tem que voltar em TODO caminho de
            // saída, não só no ramo de estouro: se `read()` rejeitar no meio
            // (timeout, aborto, erro de rede), o que já foi reservado ficaria
            // preso e o teto encolheria para sempre (Sol).
            const bilhetes = [];
            let aceita = false;
            try {
            const leitor = resposta.body.getReader();
            for (;;) {
              const { done, value } = await leitor.read();
              if (done) break;
              lidos += value.byteLength;
              // ⚠️ O orçamento é debitado do que TRAFEGOU, não do que foi
              // aceito: senão várias respostas grandes recusadas puxariam bytes
              // sem limite, e o orçamento agregado não limitaria nada (Sol).
              orcamento -= value.byteLength;
              // E a reserva é feita na contabilidade compartilhada, pedaço a
              // pedaço: é ela que impede os dois caminhos de estourar o teto.
              const bilhete = conta.reservar(value.byteLength);
              if (lidos > MAX_ASSET_BYTES || orcamento < 0 || !bilhete) {
                if (bilhete) conta.devolver(bilhete);
                await leitor.cancel().catch(() => {});
                parada.abort();
                return null;
              }
              bilhetes.push(bilhete);
              pedacos.push(value);
            }
            if (!lidos) return null;
            // A vaga ainda é minha? A resposta ORIGINAL pode ter terminado
            // enquanto eu lia (a coleta agora tem teto) e já preenchido a
            // vaga — confirmar aqui contaria o mesmo corpo duas vezes e o
            // `set` de fora sobrescreveria um asset bom (Claude review r1 #4).
            if (recursos.get(u) !== null || (geracao.get(u) || 0) !== geracaoNoInicio) return null;
            // Só agora o corpo entra no pacote: pendente vira confirmado.
            for (const b of bilhetes) conta.confirmar(b);
            aceita = true;
            return {
              bytes: Buffer.concat(pedacos.map((p) => Buffer.from(p))),
              contentType: resposta.headers.get('content-type') || 'application/octet-stream',
              // Quem publica confere de novo: entre este `return` e o `set`
              // de fora há um microtask, e a geração pode virar nele.
              geracao: geracaoNoInicio,
            };
            } finally {
              // Vale para TODO caminho de saída, não só o ramo de estouro: se
              // `read()` rejeitar no meio, o pendente volta aqui. Depois do
              // fechamento não há o que devolver — `fechar()` já descartou o
              // que estava em voo (Sol).
              if (!aceita) for (const b of bilhetes) conta.devolver(b);
            }
          } finally {
            clearTimeout(relogio);
          }
        }
        return null;
      };
      // Concorrência limitada: disparar tudo de uma vez é rajada de rede e pico
      // de memória proporcional à quantidade que faltou.
      const pendentes = [...fila];
      await Promise.allSettled(Array.from({ length: RETRY_CONCORRENCIA }, async () => {
        for (;;) {
          const u = pendentes.shift();
          // `cancelado`: o prazo da rota já estourou e reembolsou — a
          // repescagem (até 120 arquivos × 12s em 6 filas) não pode seguir
          // trabalhando à toa depois disso (Astra r1 #2).
          if (!u || orcamento <= 0 || cancelado) return;
          try {
            const valor = await buscarUmaVez(u);
            // Já reservado pedaço a pedaço durante a leitura — somar aqui
            // contaria os mesmos bytes duas vezes.
            // Publicar exige a vaga ainda nula E a mesma geração (Astra r3:
            // o `await` acima é um microtask — a checagem de dentro não basta).
            if (valor && recursos.get(u) === null && (geracao.get(u) || 0) === valor.geracao) {
              recursos.set(u, { bytes: valor.bytes, contentType: valor.contentType });
            }
          } catch { /* segue faltando, e o relatório dirá */ }
        }
      }));
    }

    for (const [u, v] of [...recursos]) if (!v) { recursos.delete(u); descartados.push({ u, motivo: 'corpo nao chegou' }); }
    // SNAPSHOT IMUTÁVEL (Sol r2 #2, 2026-08-20): daqui em diante `mapa`,
    // reescrita e montagem leem o MESMO congelado de entradas completas. Uma
    // resposta tardia (mais lenta que o timeout do closing-refs) que chegue
    // após o purge muta `recursos` vivo — se ela entrasse no `mapa`, os
    // textos seriam reescritos para um caminho cujo asset nunca entra no
    // bundle: referência local quebrada em silêncio, pior que o crash.
    // ⚠️ Daqui em diante nada mais entra no pacote. Fechar a contabilidade
    // impede que uma resposta atrasada some bytes que NUNCA serão empacotados —
    // o relatório passaria a contar o que não existe (Sol).
    conta.fechar();
    const congelados = new Map([...recursos].filter(([, v]) => v));
    const engines = await page.evaluate(() => ({
      gsap: Boolean(window.gsap),
      scrollTrigger: Boolean(window.ScrollTrigger || (window.gsap && window.gsap.plugins && window.gsap.plugins.ScrollTrigger)),
      lenis: Boolean(window.lenis),
      lottie: Boolean(window.lottie || window.bodymovin),
      browserAnimations: typeof document.getAnimations === 'function' ? document.getAnimations().length : 0,
    }));

    // ⚠️ O HTML do bundle é o DOM SERVIDO, não o serializado do DOM vivo. Um DOM
    // vivo já mutado pelos scripts, servido de novo COM os scripts, seria
    // processado duas vezes — animação de entrada partindo do estado final,
    // elementos duplicados. Preservar significa entregar o documento original.
    // Respostas nunca carregam fragmento, mas `page.url()` pode — e depois de um
    // redirect a URL original também não serve. Compara-se SEM fragmento dos
    // dois lados, tentando a final antes da pedida. Achado P1 do Sol.
    const semHash = (u) => u.split('#')[0];
    const finalUrl = semHash(page.url());
    const entradaOriginal = [...congelados.keys()].find((u) => semHash(u) === finalUrl)
      || [...congelados.keys()].find((u) => semHash(u) === semHash(url));
    if (!entradaOriginal) throw new Error('native_bundle_entry_not_captured');

    // ⚠️ Caminhos podem COLIDIR (`/a%20b.js` e `/a_20b.js` normalizam igual; o
    // macOS ainda trata `A.js` e `a.js` como o mesmo arquivo). Sem desempate, o
    // registrador aborta o clone inteiro. Desempata-se por conteúdo. Achado P1.
    const mapa = new Map();
    const usados = new Set();
    for (const u of congelados.keys()) {
      let caminho = bundlePathForUrl(u, page.url());
      const chave = caminho.toLowerCase();
      if (usados.has(chave)) {
        const marca = createHash('sha1').update(u).digest('hex').slice(0, 10);
        caminho = /\.[^./]+$/.test(caminho)
          ? caminho.replace(/(\.[^./]+)$/, `.${marca}$1`)
          : `${caminho}.${marca}`;
      }
      usados.add(caminho.toLowerCase());
      mapa.set(u, caminho);
    }
    // ⚠️ Uma URL como `/promo` vira o caminho `promo`, SEM extensão — e qualquer
    // servidor estático entrega isso como binário, então a página nunca abre.
    // Renomeia-se a entrada ANTES de reescrever, para que toda referência a ela
    // aponte para o nome novo.
    const entradaBruta = mapa.get(entradaOriginal);
    if (!/\.html?$/i.test(entradaBruta)) {
      const dir = entradaBruta.includes('/') ? entradaBruta.slice(0, entradaBruta.lastIndexOf('/') + 1) : '';
      mapa.set(entradaOriginal, `${dir}index.html`);
    }
    const entryPath = mapa.get(entradaOriginal);

    const assets = [];
    for (const [u, valor] of congelados) {
      // Cinto extra sobre o snapshot congelado (Claude review 2026-08-20 #2):
      // entrada sem corpo é descarte nomeado, nunca crash de destructuring.
      if (!valor || !mapa.has(u)) {
        descartados.push({ u, motivo: !valor ? 'corpo nao chegou' : 'chegou apos a montagem' });
        continue;
      }
      const { bytes, contentType } = valor;
      const caminho = mapa.get(u);
      let corpo = bytes;
      // Rewriting is per CONTENT TYPE and by URL position now: a stylesheet
      // resolves its own relative URLs against ITSELF, and script bodies are
      // never touched (see rewrite-references.js). The old blind pass only
      // closed absolute URLs, so `src="/hero.png"` — a file on the site's own
      // root — stayed unreachable behind the runtime gateway.
      const kind = referenceKindFor(caminho, contentType);
      if (kind) {
        let texto = rewriteDocumentReferences({
          text: bytes.toString('utf8'),
          kind,
          resourceUrl: u,
          assetPath: caminho,
          map: mapa,
        });
        // ⚠️ Reescrever o conteúdo invalida o hash de `integrity=`, e o browser
        // passa a BLOQUEAR o próprio arquivo que acabamos de preservar — a
        // página abriria sem script nenhum. Achado P1 do Sol.
        if (/\.html?$/i.test(caminho)) texto = texto.replace(/\s+integrity=(["'])[^"']*\1/gi, '');
        corpo = Buffer.from(texto, 'utf8');
      }
      assets.push({ path: caminho, body: new Uint8Array(corpo), contentType: contentType || undefined });
    }

    if (!emprestada) await context.close();
    onProgress({ etapa: 'finalizing' });

    // SSIM do clone recém-montado contra o vivo (pedido antigo: tracking
    // permanente). Fail-open: falha vira null e loga; nunca derruba o clone.
    let similarity = null;
    // Com sessão emprestada não se abre página nova no navegador de outrem:
    // a similaridade fica null (fail-open já existente).
    if (screenshotVivo && !emprestada) {
      try {
        similarity = await measureBundleSimilarity({
          browser, assets, entryPath, screenshotDataUrl: screenshotVivo, signal,
        });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`[native-clone] similarity falhou: ${String(e?.message || e).slice(0, 120)}`);
      }
    }

    return {
      kind: 'native',
      // Sibling of `bundle` ON PURPOSE — see the measurement note above:
      // anything added inside `bundle` would change contentHash/fingerprint.
      ...(typeSample ? { typeSample } : {}),
      bundle: {
        entryPath,
        assets,
        runtimeFingerprint: sha256(Buffer.from(assets.map((a) => a.path).sort().join('\n'))),
        reconstructionCapabilities: {
          detectedEngines: Object.entries(engines).filter(([, v]) => v).map(([k]) => k),
          candidateControls: [],
        },
      },
      // O relatório viaja com o resultado: sem ele o snapshot fica 'pronto'
      // mesmo faltando script ou fonte, e a falta some. Achado P1 do Sol.
      relatorio: {
        arquivos: assets.length,
        similarity,
        // ⚠️ DUAS quantidades, não uma. `bytes` é o que chegou da rede (é
        // sobre ele que os tetos de memória e de tráfego decidem);
        // `bytesNoPacote` é o que ficou guardado, e é menor porque a reescrita
        // de referências encurta HTML/CSS/JS. Com um nome só, a diferença
        // aparecia como erro de contabilidade e não como o que é.
        bytes: conta.gasto(),
        bytesNoPacote: assets.reduce((total, a) => total + a.body.byteLength, 0),
        entryPath,
        engines,
        // Quantos candidatos de srcset/CSS o fechamento carregou de propósito.
        refsExtras,
        // Nada some em silêncio: o que não coube é nomeado.
        descartados: descartados.slice(0, 40),
        totalDescartados: descartados.length,
        // ⭐ Contagem sobre a lista INTEIRA, antes do corte da amostra. Sem
        // ela, quem lê contaria os 40 guardados e apresentaria "100 perdidos:
        // 40× limite de arquivos" como se fosse a explicação completa — uma
        // amostra truncada com cara de diagnóstico fechado (Sol).
        motivosDescartados: descartados.reduce((acc, d) => {
          if (d?.motivo) acc[d.motivo] = (acc[d.motivo] || 0) + 1;
          return acc;
        }, {}),
      },
    };
  } finally {
    await fecharSePropria();
  }
}
