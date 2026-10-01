// O PORTÃO VERBATIM — a etapa 7 da receita (docs/clone-verbatim/CLONE_PROMPT.md),
// executável e independente de motor. Ele NÃO constrói clone nenhum: ele julga
// um artefato pronto contra a régua, e serve igualmente para native, remake,
// iter9 ou o motor novo. Foi construído ANTES do motor de propósito — sem ele,
// "é bom" é opinião (a lição de 2026-08: quatro réguas mediram alinhamento e
// foram lidas como qualidade).
//
// Desenho endurecido pela auditoria do Astra (2026-09-28):
//
//  • INDEPENDÊNCIA A FRIO. O bloqueio é instalado ANTES de navegar, e só a
//    origem que serve o artefato passa. Um harness que carrega a página e
//    DEPOIS desliga a rede não prova independência — prova cache quente.
//    Contam-se TENTATIVAS externas (o que a página quis buscar) separadas de
//    SUCESSOS: uma tentativa abortada continua sendo dependência externa.
//    Service workers ficam bloqueados no contexto (interceptação comum tem
//    buraco para eles).
//  • ARQUIVOS REAIS. Serve-se o diretório do bundle como está, por um servidor
//    local de verdade. NADA de traduzir URL em tempo de teste: uma reescrita
//    que só existe no harness faz um pacote quebrado passar.
//    ⚠️ 127.0.0.1 de propósito: origem http fora de localhost NÃO é contexto
//    seguro — `crypto.randomUUID` some, o script do site morre no início
//    (medido em lib/clone-similarity.js: 3 tweens em vez de 138, preloader
//    eterno, SSIM 0,57 "parecendo funcionar").
//  • UMA TRAJETÓRIA REPRODUZÍVEL. Replica-se a mesma SEQUÊNCIA DE ENTRADA
//    (mesmos alvos em px, mesmos tempos) em referência e candidato. Os alvos
//    saem da REFERÊNCIA, nunca da altura própria de cada candidato: esticar
//    cada um pela própria porcentagem esconde justamente a distância de scroll
//    que falta. O scrollY observado é diagnóstico, não o critério.
//  • ⭐ O SSIM NÃO SE LÊ SEM AUTOCONTROLE (2026-09-29). Medido: a referência
//    comparada com ELA MESMA (duas execuções do mesmo site vivo, mesma
//    trajetória) dá piso 0,8864. Dois clones do mesmo site deram 0,934 e 0,924 —
//    ou seja AMBOS melhores que o site contra si próprio, e a diferença entre
//    eles está muito dentro da auto-variância. Antes deste controle eu vinha
//    lendo 0,834 → 0,892 → 0,934 como progressão de fidelidade; não era.
//    REGRA: rodar a referência DUAS vezes e comparar uma com a outra ANTES de
//    atribuir significado a qualquer piso de SSIM de candidato. O comando é o
//    mesmo: `--compare <ref1> <ref2>`.
//  • DIMENSÕES INDEPENDENTES. Altura, alcance de scroll, cobertura de texto e
//    de seções, requisições externas, recursos ausentes, erros de console e
//    SSIM por quadro são reportados SEPARADAMENTE e nunca viram uma média —
//    altura igual se fabrica com espaço vazio, e um SSIM médio alto esconde um
//    objeto ausente. Medida que faltou é FALHA, não vira lacuna silenciosa.
//
// USO
//   node scripts/verbatim-gate.mjs --reference https://site/  --out _verbatim/ref
//   node scripts/verbatim-gate.mjs --candidate bundle:<dir>   --out _verbatim/native --trajectory _verbatim/ref/trajectory.json
//   node scripts/verbatim-gate.mjs --candidate file:<x.html>  --out _verbatim/remake --trajectory _verbatim/ref/trajectory.json
//   node scripts/verbatim-gate.mjs --compare _verbatim/ref _verbatim/native

import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { computeSsimRgb } from '../lib/clone-similarity.js';

const VIEWPORT = { width: 1440, height: 1200 };   // a receita: 1440x1200, DPR 1, zoom 100%
const SETTLE_MS = 3500;      // deixa o preloader e a animação de entrada terminarem
const DWELL_MS = 450;        // parada em cada ponto, igual para todos
// ⭐ CADÊNCIA FIXA (2026-09-28). A primeira versão replicava os mesmos ALVOS EM
// PIXELS o mais rápido que a máquina permitisse, e o custo do instrumento entra
// no tempo decorrido: a referência (página viva, mais pesada) gastava ~1,3 s
// mais por parada que o candidato, e ao longo de 24 paradas isso acumulava 31 s
// de deriva MÉDIA (63 s no pior ponto). Numa página cuja animação é dirigida
// pela rolagem, parar no mesmo PIXEL em instantes diferentes compara estados de
// animação diferentes — era isso, e não infidelidade, que segurava o piso do
// SSIM. Agora a parada i acontece em t0 + i*PASSO_MS nos dois lados: quem
// termina antes espera, e quem estoura o orçamento é DECLARADO atrasado, nunca
// silenciosamente dessincronizado.
// O orçamento por parada tem que caber o custo do instrumento nos DOIS lados, senão a
// cadência atua num só. Medido: custo médio 3,5 s (referência) e 6,1 s (candidato),
// com picos de 16 s — 6 s era apertado demais.
const PASSO_MS = Math.max(1500, Number(process.env.UNCRAFT_GATE_PASSO_MS) || 11000);
const HOLD_MS = 2500;        // permanência no fim, para o rodapé animar
const STEP_PX = 900;         // passo do scroll único e contínuo
const MAX_STEPS = 40;        // teto de segurança

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.avif': 'image/avif', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
};

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// Servidor estático sobre os arquivos REAIS do artefato. Sidecars de metadados
// (.uncraft-meta.json) não são servidos, mas dão o content-type gravado na
// captura — melhor que adivinhar pela extensão.
async function serveDirectory(root, { onRequest }) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (rel === '') rel = 'index.html';
    const full = path.resolve(root, rel);
    if (!full.startsWith(path.resolve(root))) { res.writeHead(403).end(); return; }
    if (rel.endsWith('.uncraft-meta.json')) { res.writeHead(404).end(); onRequest?.(rel, 404); return; }
    try {
      const body = await readFile(full);
      let type = MIME[path.extname(full).toLowerCase()];
      try {
        const meta = JSON.parse(await readFile(`${full}.uncraft-meta.json`, 'utf8'));
        if (meta?.contentType) type = meta.contentType;
      } catch { /* sem sidecar: extensão basta */ }
      res.writeHead(200, { 'content-type': type || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
      onRequest?.(rel, 200);
    } catch {
      res.writeHead(404).end();
      onRequest?.(rel, 404);   // recurso do PRÓPRIO pacote que falta = achado
    }
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

// A TERCEIRA DIMENSÃO: editabilidade, medida no próprio artefato.
//
// Sem ela o portão elege o vencedor errado — uma cópia preservada é fiel e
// independente, e mesmo assim reproduz toda a bagunça do site original
// (pointer-events:none em texto animado, wordmark decorativo cobrindo seções,
// texto fatiado em spans por letra). Era isso que justificava o custo do
// método verbatim: reconstruir nas NOSSAS regras para os painéis funcionarem.
// "Documento único com estilo embutido não implica editabilidade" (Astra).
//
// Mede-se a propriedade do ARTEFATO, não a esperteza do nosso editor: um texto
// é "alcançável" quando um clique no meio dele resolve nele mesmo, SEM precisar
// das heurísticas que o bridge aplica. Quanto mais texto obstruído ou
// bloqueado, mais imprevisível é editar aquele clone.
function editabilityProbe() {
  const TEXT_BLOCK = 'h1,h2,h3,h4,h5,h6,p,blockquote,a,button,label,li,figcaption,dt,dd';
  const directText = (el) => Array.from(el.childNodes)
    .filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ').trim();
  const all = Array.from(document.querySelectorAll('body *')).filter((el) => directText(el).length > 0);
  let reachable = 0; let peBlocked = 0; let obstructed = 0; let inViewport = 0; let semantic = 0;
  for (const el of all) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.width < 2 || r.height < 2) continue;
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.05) continue;
    if (r.bottom < 0 || r.top > window.innerHeight) continue;
    inViewport += 1;
    if (el.matches(TEXT_BLOCK)) semantic += 1;
    let blocked = false; let p = el;
    while (p && p !== document.documentElement) {
      if (getComputedStyle(p).pointerEvents === 'none') { blocked = true; break; }
      p = p.parentElement;
    }
    const cx = Math.max(1, Math.min(window.innerWidth - 1, r.left + Math.min(8, r.width / 2)));
    const cy = Math.max(1, Math.min(window.innerHeight - 1, r.top + r.height / 2));
    const hit = document.elementFromPoint(cx, cy);
    const lands = hit && (hit === el || el.contains(hit));
    if (blocked) peBlocked += 1;
    else if (!lands) obstructed += 1;
    else reachable += 1;
  }
  return {
    inViewport,
    reachable,
    peBlocked,
    obstructed,
    semantic,
    splitFragments: document.querySelectorAll('.char,.word,.line,[data-split-text],[text-split]').length,
    scripts: document.scripts.length,
    remoteStylesheets: document.querySelectorAll('link[rel="stylesheet"]').length,
    inlineStyleBlocks: document.querySelectorAll('style').length,
  };
}

// TRILHA DE MOVIMENTO — o controle do candidato CONGELADO.
//
// Os 23 quadros de aceitação são tirados PARADOS (450ms de espera em cada
// ponto): um clone com a animação morta passa em todos eles. A receita pede o
// vídeo justamente para julgar coreografia; mas vídeo é formato ERRADO para a
// métrica — H.264 é com perda e duas gravações do mesmo conteúdo já diferem por
// ruído de codec, e alinhar dois vídeos com tempos distintos é problema por si
// só. Então: rajada curta em cada parada, reduzida a UM número por ponto.
// Custo: kilobytes (nada vai para disco) contra megabytes de MP4.
//
// energia = diferença média por pixel entre quadros consecutivos, medida em
// miniatura (a redução mata ruído de antialiasing e barateia a conta). Onde a
// referência tem energia e o candidato tem ~0, a animação morreu ali.
//
// ⭐ O DENOMINADOR É MEDIDO, não suposto (correção de 2026-09-28). A primeira
// versão esperava BURST_GAP_MS entre quadros e dividia só pelo NÚMERO de pares,
// como se o intervalo fosse aquele. Não era: o intervalo real é dominado pela
// latência de `page.screenshot`, e a medição mostrou o intervalo entre quadros
// da trajetória variando de 1,3 s a 36,4 s na MESMA execução. Diferença por par
// sem dividir pelo tempo decorrido não é energia — é um número cujo valor
// depende de quanto a máquina demorou. Foi isso que produziu 55,8 / 9,6 / 75,8
// no MESMO ponto de três execuções, e o falso "congelado" que daí saiu.
//
// Agora cada captura é cronometrada e a energia sai em unidade física:
// mudança média por canal de pixel POR SEGUNDO. Fica também o intervalo real de
// cada par, e o ponto é marcado `impreciso` quando o intervalo estourou o
// limite em que "por segundo" ainda descreve a animação — num intervalo longo o
// tween pode ter terminado no meio, e aí a taxa subestima. Subestimar SABENDO
// é aceitável; dividir por um número inventado não.
const BURST_FRAMES = 3;
const BURST_GAP_MS = 120;
// Intervalo que uma rajada precisa alcançar para ser comparável. Acima disso o
// par deixa de descrever "quanto a página mudou num instante" e passa a
// descrever quanto a máquina demorou.
const GAP_ALVO_MS = 400;
// ⭐ LIMIARES CALIBRADOS POR MEDIÇÃO (2026-09-29). Os anteriores eram os números da
// unidade antiga reaplicados a outra grandeza, o que tornou "congelado"
// inalcançável sem que nada no JSON avisasse.
//
// PISO DE RUÍDO = ZERO, medido: 24 rajadas sobre três quadros reais servidos como
// imagem estática, sem script, deram energia 0 em TODAS. Conteúdo idêntico produz
// bytes idênticos, então o caminho de medição não introduz ruído. Consequência
// direta: qualquer energia diferente de zero é movimento REAL, e "congelado" é
// exatamente zero — não uma vizinhança de limiar.
//
// ESCALA, medida deslocando o quadro inteiro por um número conhecido de pixels:
//   0px -> 0      1px -> 0,52    2px -> 1,00    4px -> 1,87    8px -> 3,35
//   16px -> 4,94  32px -> 7,04   64px -> 8,57   128px -> 11,46
// A curva é SUBLINEAR (energia ~ 0,52 * px^0,66), o que importa para ler a razão.
const PISO_CALIBRADO = true;
// Abaixo disto a referência se moveu menos que UM PIXEL equivalente de quadro
// inteiro — perguntar sobre paridade ali não é pergunta significativa.
const PISO_REFERENCIA = 0.5;
// Zero exato. Não há vizinhança a tolerar porque não há ruído; a margem é só
// contra imprecisão de ponto flutuante.
const PISO_MORTO = 0.0001;
// Como a curva é sublinear, razão de ENERGIA subestima a falta de DISTÂNCIA: 0,25
// de energia corresponde ao candidato percorrer ~13% do caminho da referência.
// Ou seja o rótulo "fraco" só dispara em déficit grande — conservador de propósito.
const RAZAO_FRACA = 0.25;
// Pontos conclusivos necessários para a trilha de movimento emitir veredito.
const MINIMO_CONCLUSIVOS = 3;
// ENERGIA POR REGIAO (Astra B1 #1). O piso de ruido do caminho de medicao e ZERO (acima),
// entao qualquer pixel com diferenca >= 1 mudou de verdade. Abaixo de AREA_MIN_PX pixels
// (no mapa de 240 px de largura) a referencia nao se moveu o bastante para a pergunta de
// paridade fazer sentido — um botao de 200x50 deslocando 8 px na tela de 1440 cobre dezenas.
const AREA_MIN_PX = 4;
function decodificarMapa(m) {
  if (!m || typeof m.dados !== 'string' || !m.w || !m.h) return null;
  const b = Buffer.from(m.dados, 'base64');
  return b.length === m.w * m.h ? b : null;
}
// Energia media DENTRO da mascara da referencia, nos dois lados. null quando algum lado
// nao tem mapa (relatorio antigo) ou as dimensoes diferem: o chamador cai no quadro inteiro.
// POR COMPONENTE, em CAIXA AMPLIADA (revisao Claude 2026-10-01, sobre a 1a versao): a
// mascara de um objeto solido em movimento sao so as BORDAS — medir o candidato pixel a
// pixel nela punia POSICAO e FASE (um clone deslocado 12 px, ou flagrado noutro instante,
// dava "congelado" vivo); e uma mascara unica juntava video e botao, e o video escondia o
// botao congelado (a diluicao voltava). Agora: a mascara da referencia (dilatada 1 px contra
// o serrilhado do JPEG e agrupada por proximidade, ver RAIO_GRUPO) vira COMPONENTES conexos; cada um com area >= AREA_MIN_PX e medido
// numa caixa envolvente AMPLIADA (metade do maior lado, minimo MARGEM_MIN_PX) — a mesma caixa
// nos dois lados, energia media por pixel. O ponto vale o PIOR componente.
const MARGEM_MIN_PX = 4;
// Agrupamento por PROXIMIDADE: as duas bordas de um mesmo objeto solido em movimento ficam
// separadas pela largura dele; dilatar RAIO_GRUPO px de mapa (~36 px de tela) antes de rotular
// as junta num componente cuja caixa cobre o objeto inteiro — e a fase/posicao do candidato
// dentro dele deixa de importar.
const RAIO_GRUPO = 6;
// Um componente so DECIDE o ponto se carregar energia media >= ENERGIA_MIN_COMPONENTE nos
// proprios pixels mudados (2a revisao Claude): um cursor de texto ou um decode tardio de
// imagem nao pode, sozinho, virar "congelado".
const ENERGIA_MIN_COMPONENTE = 2;
function componentes(a, w, h) {
  const m = new Uint8Array(a.length);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    if (a[y * w + x] < 1) continue;
    for (let dy = -RAIO_GRUPO; dy <= RAIO_GRUPO; dy += 1) for (let dx = -RAIO_GRUPO; dx <= RAIO_GRUPO; dx += 1) {
      const yy = y + dy; const xx = x + dx;
      if (yy >= 0 && yy < h && xx >= 0 && xx < w) m[yy * w + xx] = 1;
    }
  }
  const vis = new Uint8Array(a.length); const out = [];
  for (let k = 0; k < m.length; k += 1) {
    if (!m[k] || vis[k]) continue;
    const fila = [k]; vis[k] = 1; let area = 0; let soma = 0; let x0 = w; let y0 = h; let x1 = 0; let y1 = 0;
    while (fila.length) {
      const q = fila.pop(); const x = q % w; const y = (q - x) / w;
      if (a[q] >= 1) { area += 1; soma += a[q]; }
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const n of [q - 1, q + 1, q - w, q + w]) {
        if (n < 0 || n >= m.length || vis[n] || !m[n]) continue;
        if ((n === q - 1 && x === 0) || (n === q + 1 && x === w - 1)) continue;
        vis[n] = 1; fila.push(n);
      }
    }
    out.push({ area, media: area ? soma / area : 0, x0, y0, x1, y1 });
  }
  return out;
}
function mediaNaCaixa(b, w, h, c) {
  const mg = Math.max(MARGEM_MIN_PX, Math.ceil(Math.max(c.x1 - c.x0 + 1, c.y1 - c.y0 + 1) / 2));
  const x0 = Math.max(0, c.x0 - mg); const x1 = Math.min(w - 1, c.x1 + mg);
  const y0 = Math.max(0, c.y0 - mg); const y1 = Math.min(h - 1, c.y1 + mg);
  let s = 0; let n = 0;
  for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) { s += b[y * w + x]; n += 1; }
  return n ? s / n : 0;
}
// null quando algum lado nao tem mapa (relatorio antigo) ou as dimensoes diferem: o
// chamador cai no quadro inteiro.
function energiaPorRegiao(mapaRef, mapaCand) {
  const a = decodificarMapa(mapaRef); const b = decodificarMapa(mapaCand);
  if (!a || !b || mapaRef.w !== mapaCand.w || mapaRef.h !== mapaCand.h) return null;
  const w = mapaRef.w; const h = mapaRef.h;
  let areaTotal = 0; for (let k = 0; k < a.length; k += 1) if (a[k] >= 1) areaTotal += 1;
  const comps = componentes(a, w, h).filter((c) => c.area >= AREA_MIN_PX && c.media >= ENERGIA_MIN_COMPONENTE).map((c) => {
    const ref = mediaNaCaixa(a, w, h, c); const cand = mediaNaCaixa(b, w, h, c);
    // Caixa que cobre >= metade do quadro: a regiao virou quadro inteiro e a diluicao volta —
    // declarado no ponto, nunca escondido sob metodo 'regiao' (2a revisao Claude, P2).
    const quaseQuadro = ((c.x1 - c.x0 + 1) * (c.y1 - c.y0 + 1)) >= 0.5 * w * h;
    return { area: c.area, caixa: [c.x0, c.y0, c.x1, c.y1], ref: Number(ref.toFixed(3)), cand: Number(cand.toFixed(3)), razao: ref ? Number((cand / ref).toFixed(3)) : null, ...(quaseQuadro ? { quaseQuadroInteiro: true } : {}) };
  }).sort((p, q) => (p.razao ?? 0) - (q.razao ?? 0));
  return { areaPx: areaTotal, areaFracao: Number((areaTotal / a.length).toFixed(5)), componentes: comps, pior: comps[0] || null };
}
export { energiaPorRegiao, decodificarMapa, AREA_MIN_PX };
// ⚠️ DUAS, não três. Medido em gsap.com: com três tentativas o candidato re-fazia a
// rajada em 8 de 13 paradas e o custo médio do instrumento subiu para 6,1 s contra
// 3,5 s da referência — a cadência então atuou só num lado e o portão de regime
// (corretamente) recusou a comparação. Repetir é útil (às vezes a 2a passa), mas
// repetir três vezes numa página consistentemente lenta só queima orçamento e
// falha igual: melhor declarar não-comparável e seguir.
const TENTATIVAS_RAJADA = 2;

// ⭐ POR QUE NÃO SE DIVIDE PELO TEMPO (correção de 2026-09-28, 2ª rodada).
//
// A 1ª versão dividia a diferença entre quadros só pelo NÚMERO de pares, como
// se o intervalo fosse o nominal de 120 ms. Não era: medido, o intervalo real
// ia de 160 ms a 18 s, então o número era função da lentidão da máquina.
//
// A 2ª versão passou a dividir pelo intervalo MEDIDO, e a auditoria mostrou que
// isso troca um erro por outro, pior porque parece física: um tween de amplitude
// limitada que TERMINA dentro da janela faz a diferença SATURAR, e aí a "taxa"
// fica proporcional a 1/intervalo — ou seja quem manda no veredito volta a ser
// quem estava lento, agora com sinal invertido. Medido no mesmo par: num ponto
// a razão crua dizia que o candidato se movia 10x MAIS e a razão por segundo
// dizia 0,33; em outro a crua dizia 0,64 (candidato movendo MENOS) e a por
// segundo dizia 2,05. Falso verde e falso vermelho na mesma execução.
//
// A saída não é achar o divisor certo: é RECUSAR o par cujo intervalo não serve.
// A rajada é repetida até os intervalos caírem numa faixa estreita; o que não
// conseguir sai marcado como não-comparável, e comparação de não-comparável é
// INCONCLUSIVO — nunca um número convertido. Custa cobertura e devolve verdade.
// ⭐ A RAJADA CAPTURA POR CDP, NÃO PELA VIA DO PLAYWRIGHT (2026-09-29).
// Medido nos mesmos alvos: `page.screenshot` levou 80–300 ms por quadro e
// `Page.captureScreenshot` cru levou ~30 ms. Com a via caríssima, o intervalo real
// da rajada estourava o alvo em 11 de 13 paradas e a trilha de movimento ficava com
// ZERO pontos conclusivos — o instrumento não conseguia medir movimento porque
// media a si mesmo. O CDP devolve base64 direto, sem Buffer no meio.
// Fail-open: sem sessão CDP, cai na via do Playwright (mais lenta, mas funciona).
// ⚠️ Os dois caminhos NÃO são semanticamente equivalentes (Astra B1 #4): o Playwright
// esconde o cursor de texto por padrão, o CDP cru não; e uma falha de `cdp.send` no
// meio da rajada não era fallback — virava rajada nula. Regras: (1) o BACKEND de cada
// rajada é registrado (`captureMode`) e o `compare` recusa comparar rajadas de
// backends diferentes; (2) se o CDP falhar, a rajada INTEIRA é refeita no Playwright,
// nunca misturando amostras; (3) `caret: 'hide'` nos dois, para o cursor não virar
// "movimento" num lado só.
async function capturaRapida(page, cdp) {
  if (cdp) {
    const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 60 });
    return r.data;
  }
  // Com teto (revisao Claude 2026-10-01): sem ele a rajada esperava a mesma fonte travada.
  return (await page.screenshot({ type: 'jpeg', quality: 60, caret: 'hide', timeout: 30000 })).toString('base64');
}

async function motionEnergy(page, probe, cdp) {
  let ultima = null;
  let backend = cdp ? 'cdp' : 'playwright';
  for (let tentativa = 1; tentativa <= TENTATIVAS_RAJADA; tentativa += 1) {
    const shots = [];
    const stamps = [];
    try {
      for (let i = 0; i < BURST_FRAMES; i += 1) {
        if (i) await page.waitForTimeout(BURST_GAP_MS);
        // Carimbo LOGO ANTES: interessa o instante em que o quadro foi pedido.
        stamps.push(Date.now());
        shots.push(await capturaRapida(page, backend === 'cdp' ? cdp : null));
      }
    } catch (_) {
      // CDP falhou no meio: refaz a rajada inteira no outro backend (consistente),
      // e a rajada fica marcada com o backend que de fato a produziu.
      if (backend === 'cdp') { backend = 'playwright'; tentativa -= 1; continue; }
      throw _;
    }
    const gaps = stamps.slice(1).map((t, i) => t - stamps[i]);
    const gapMaxMs = Math.max(...gaps);
    const medida = await probe.evaluate(async (frames) => {
      const SMALL = 240;
      const draw = (img) => {
        const c = document.createElement('canvas');
        c.width = SMALL; c.height = Math.max(1, Math.round(SMALL * img.naturalHeight / img.naturalWidth));
        const x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(img, 0, 0, c.width, c.height);
        return x.getImageData(0, 0, c.width, c.height).data;
      };
      const load = (b64) => new Promise((res, rej) => {
        const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = `data:image/jpeg;base64,${b64}`;
      });
      const imgs = await Promise.all(frames.map(load));
      const data = imgs.map(draw);
      const out = [];
      // MAPA POR PIXEL (Astra B1 #1): energia media por pixel ao longo dos pares, na
      // mesma resolucao do escalar. Guardado para a comparacao medir o candidato SO
      // onde a referencia se move — o escalar de quadro inteiro diluia um botao pequeno
      // e deixava um video alheio dar energia a uma animacao congelada.
      const W = SMALL; const H = Math.max(1, Math.round(SMALL * imgs[0].naturalHeight / imgs[0].naturalWidth));
      const acc = new Float32Array(W * H);
      for (let k = 1; k < data.length; k += 1) {
        const a = data[k - 1]; const b = data[k];
        let sum = 0; let n = 0;
        for (let q = 0; q < a.length; q += 4) {
          const d = Math.abs(a[q] - b[q]) + Math.abs(a[q + 1] - b[q + 1]) + Math.abs(a[q + 2] - b[q + 2]);
          sum += d; n += 3;
          if (a.length === W * H * 4) acc[q / 4] += d / 3;
        }
        out.push(sum / n);
      }
      const pares = Math.max(1, data.length - 1);
      const bytes = new Uint8Array(W * H);
      for (let k = 0; k < bytes.length; k += 1) bytes[k] = Math.min(255, Math.round(acc[k] / pares));
      let bin = ''; for (let k = 0; k < bytes.length; k += 1) bin += String.fromCharCode(bytes[k]);
      return { porPar: out, mapa: { w: W, h: H, dados: btoa(bin) } };
    }, shots);
    const porPar = medida.porPar;
    ultima = {
      // Diferença média por canal de pixel entre quadros CONSECUTIVOS, sem
      // normalização temporal — só vale comparada a outra medida de intervalo
      // equivalente, e é isso que `comparavel` + a checagem de par garantem.
      bruto: porPar.length ? Number((porPar.reduce((a, b) => a + b, 0) / porPar.length).toFixed(4)) : 0,
      intervalosMs: gaps,
      gapMaxMs,
      comparavel: gapMaxMs <= GAP_ALVO_MS,
      tentativas: tentativa,
      captureMode: backend,
      mapa: medida.mapa,
      viewport: { width: VIEWPORT.width, height: VIEWPORT.height, dpr: 1 },
    };
    if (ultima.comparavel) return ultima;
  }
  return ultima;
}

// Percorre a MESMA sequência de entrada e devolve as dimensões + os quadros.
async function runTrajectory(page, { targets, outDir, allowNetwork, probe, cdp }) {
  const frames = [];
  // Três relógios, porque eles respondem perguntas diferentes:
  //   tNav  — desde a navegação: inclui o tempo de carga, que é legitimamente
  //           diferente entre a rede e um servidor local, e por isso NÃO serve
  //           de base para comparar estado de animação.
  //   t0    — desde o fim do assentamento: é a base comparável, porque é o
  //           instante em que os dois lados estão nominalmente prontos.
  // A diferença entre eles é a deriva que explica SSIM diferente no mesmo
  // ponto de scroll: numa página dirigida por rolagem, parar no mesmo PIXEL em
  // instantes diferentes compara estados de animação diferentes.
  const tNav = Date.now();
  await page.waitForLoadState('load').catch(() => {});
  const loadMs = Date.now() - tNav;
  await page.waitForTimeout(SETTLE_MS);
  const t0 = Date.now();

  // Agregado ao longo da trajetória: o conteúdo aparece progressivamente, então
  // uma única amostra no topo não representa a página.
  const edit = {
    inViewport: 0, reachable: 0, peBlocked: 0, obstructed: 0, semantic: 0,
    splitFragments: 0, scripts: 0, remoteStylesheets: 0, inlineStyleBlocks: 0,
  };
  const accumulate = async () => {
    const e = await page.evaluate(editabilityProbe).catch(() => null);
    if (!e) return;
    edit.inViewport += e.inViewport; edit.reachable += e.reachable;
    edit.peBlocked += e.peBlocked; edit.obstructed += e.obstructed; edit.semantic += e.semantic;
    // Estruturais: valem para o documento, não se somam — fica o último visto.
    edit.splitFragments = e.splitFragments; edit.scripts = e.scripts;
    edit.remoteStylesheets = e.remoteStylesheets; edit.inlineStyleBlocks = e.inlineStyleBlocks;
  };

  const shoot = async (index, target, atrasoMs = 0, esperou = false) => {
    const observed = await page.evaluate(() => Math.round(window.scrollY));
    const file = path.join(outDir, `frame-${String(index).padStart(3, '0')}.png`);
    // ⭐ O CARIMBO É DO QUADRO, não do fim da parada (correção de 2026-09-28).
    // `atMs` era medido DEPOIS da sonda de editabilidade e da rajada, ou seja
    // incluía o custo do instrumento — que é justamente a grandeza assimétrica
    // entre referência e candidato. O bloco de deriva existe para dizer "o piso
    // do SSIM mede dessincronia"; calculá-la sobre um instante que não é o do
    // PNG comparado media outra coisa. O custo fica em campo próprio.
    let captureAtMs = Date.now() - t0;
    // Um web font que nunca termina de carregar segura `page.screenshot` ("waiting
    // for fonts to load") até o timeout e derrubava a execução INTEIRA — medido na
    // referência viva do farmminerals, transitório (as 7 fontes carregam em ~1 s numa
    // sondagem seguinte). Uma parada perdida vira quadro NOMEADO, não abandono de
    // 10 minutos de percurso; o compare o conta como ausente.
    // O carimbo e o da tentativa que VALEU (revisao Claude 2026-10-01): a 2a tentativa mostra
    // a pagina ate 30 s depois do carimbo da 1a, e a deriva seria medida do instante errado.
    let capturaFalhou = null; let tentativas = 0;
    for (let tentativa = 0; tentativa < 2; tentativa += 1) {
      tentativas += 1; captureAtMs = Date.now() - t0;
      try { await page.screenshot({ path: file, type: 'png', timeout: 30000 }); capturaFalhou = null; break; }
      catch (e) { capturaFalhou = String(e && e.message ? e.message : e).split('\n')[0]; }
    }
    await accumulate();
    const motion = probe ? await motionEnergy(page, probe, cdp).catch(() => null) : null;
    frames.push({
      index, target, observed,
      captureAtMs,
      fimDaParadaMs: Date.now() - t0,
      custoInstrumentoMs: Date.now() - t0 - captureAtMs,
      atrasoAcumuladoMs: atrasoMs,
      esperou,
      tentativas, file: capturaFalhou ? null : path.basename(file), motion,
      ...(capturaFalhou ? { capturaFalhou } : {}),
    });
  };

  // Espera até o instante combinado para a ROLAGEM desta parada.
  //
  // ⚠️ A ordem importa e a primeira versão tinha errado: ela esperava a cadência
  // DEPOIS de rolar, então o lado rápido rolava e ficava parado vários segundos
  // antes de fotografar, enquanto o lado lento fotografava logo após rolar.
  // Numa página dirigida por rolagem o estado da animação depende de "quanto
  // tempo passou DESDE a rolagem" — igualar o relógio absoluto ao custo de
  // desigualar esse intervalo piora a comparação em vez de melhorar. Agora a
  // ROLAGEM é agendada e o intervalo rolagem→foto é sempre DWELL_MS nos dois
  // lados.
  //
  // Devolve o déficit ACUMULADO (não "o atraso desta parada"): o alvo é
  // absoluto, então uma parada lenta injeta um déficit que todas as seguintes
  // herdam. Chamá-lo de atraso da parada fazia o relatório dizer "23 de 24
  // paradas estouraram" quando ~2 estouraram.
  let esperas = 0;
  const aguardarCadencia = async (i) => {
    const alvoMs = i * PASSO_MS;
    const agora = Date.now() - t0;
    if (agora < alvoMs) { await page.waitForTimeout(alvoMs - agora); esperas += 1; return { deficit: 0, esperou: true }; }
    return { deficit: agora - alvoMs, esperou: false };
  };

  await shoot(0, 0, 0, false);
  for (let i = 0; i < targets.length; i += 1) {
    const target = targets[i];
    const { deficit, esperou } = await aguardarCadencia(i + 1);
    await page.evaluate((y) => window.scrollTo(0, y), target);
    await page.waitForTimeout(DWELL_MS);
    await shoot(i + 1, target, deficit, esperou);
  }
  // Permanência no fim, para o rodapé animar. Sem cadência aqui: a fórmula
  // anterior (`round(HOLD_MS / PASSO_MS)`) só fechava para uma faixa de
  // PASSO_MS — com o piso de 1500 ms ela pedia um índice dois passos à frente e
  // esperava ~2 s além do hold, sobre uma espera de hold já cumprida.
  await page.waitForTimeout(HOLD_MS);
  await shoot(targets.length + 1, targets.at(-1) ?? 0, 0, false);

  const geometry = await page.evaluate(() => ({
    pageHeight: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
    maxScroll: Math.max(0, Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) - window.innerHeight),
    reachedScrollY: Math.round(window.scrollY),
    textChars: (document.body.innerText || '').replace(/\s+/g, ' ').trim().length,
    sections: document.querySelectorAll('section, [class*="section" i]').length,
    images: document.images.length,
    imagesDecoded: [...document.images].filter((i) => i.complete && i.naturalWidth > 0).length,
  }));
  return {
    frames, geometry, editability: edit, allowNetwork,
    timing: {
      loadMs, settleMs: SETTLE_MS, dwellMs: DWELL_MS, holdMs: HOLD_MS, passoMs: PASSO_MS,
      percursoMs: Date.now() - t0,
      // ⭐ Quantas paradas a cadência REALMENTE segurou. Sem este número quem lê
      // o relatório não tem como saber se o mecanismo atuou: numa execução em
      // que todas as paradas estouram o orçamento, `aguardarCadencia` nunca
      // espera e a cadência é INERTE, com `passoMs` no JSON parecendo vigente.
      paradasQueEsperaram: esperas,
      paradasTotais: frames.length,
      deficitFinalMs: Math.max(0, ...frames.map((f) => f.atrasoAcumuladoMs || 0)),
      custoInstrumentoMedioMs: Math.round(
        frames.reduce((a, f) => a + (f.custoInstrumentoMs || 0), 0) / Math.max(1, frames.length),
      ),
    },
  };
}

async function measure({ label, outDir, url, serveRoot, trajectory }) {
  await mkdir(outDir, { recursive: true });
  let served = null;
  const ownOriginMisses = [];
  if (serveRoot) served = await serveDirectory(serveRoot, { onRequest: (rel, code) => { if (code === 404) ownOriginMisses.push(rel); } });
  const target = serveRoot ? `${served.origin}/index.html` : url;
  const allowPrefix = serveRoot ? served.origin : null;

  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  // Service workers bloqueados: a interceptação comum tem buraco para eles.
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, serviceWorkers: 'block' });

  const externalAttempts = [];
  const externalSucceeded = [];
  const consoleErrors = [];
  const pageErrors = [];

  // ⭐ BLOQUEIO ANTES DE NAVEGAR. Só a origem que serve o artefato passa.
  if (allowPrefix) {
    await context.route('**/*', async (route, request) => {
      const u = request.url();
      if (u.startsWith(allowPrefix) || u.startsWith('data:') || u.startsWith('blob:') || u === 'about:blank') {
        await route.continue();
        return;
      }
      externalAttempts.push(u);
      await route.abort();
    });
  }

  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => pageErrors.push(String(e?.message || e).slice(0, 200)));
  page.on('response', (r) => {
    const u = r.url();
    if (allowPrefix ? !u.startsWith(allowPrefix) && !u.startsWith('data:') : false) externalSucceeded.push(u);
  });

  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 120000 }).catch((e) => {
    pageErrors.push(`navigation: ${String(e?.message || e).slice(0, 160)}`);
  });

  let targets = trajectory?.targets;
  let trajetoriaInfo = trajectory ? { herdadaDe: 'trajectory.json' } : null;
  if (!targets) {
    const maxScroll = await page.evaluate(() => Math.max(0, Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) - window.innerHeight));
    targets = [];
    for (let y = STEP_PX; y <= maxScroll && targets.length < MAX_STEPS; y += STEP_PX) targets.push(y);
    // O passo fixo para no último múltiplo de STEP_PX que caiba — no
    // farmminerals isso deixava 842 px do rodapé NUNCA visitados (18900 de
    // 19742), e o rodapé é justamente onde mora a animação de saída.
    //
    // ⚠️ O fim absoluto entra SEMPRE, e a primeira versão desta correção não
    // garantia isso: ela pendurava o acréscimo em `targets.length < MAX_STEPS`,
    // então numa página acima de ~36.000 px o teto já teria sido consumido e o
    // fim ficaria de fora — em silêncio, com o comentário afirmando o
    // contrário. A cobaia escondia a classe (19.742 px nunca chega ao teto).
    // Quando o teto morde, o último alvo é SUBSTITUÍDO pelo fim em vez de
    // acrescentado, e a substituição é declarada no relatório.
    let trajetoriaTruncada = false;
    if (maxScroll > 0 && (targets.at(-1) ?? 0) < maxScroll) {
      if (targets.length < MAX_STEPS) targets.push(maxScroll);
      else { targets[targets.length - 1] = maxScroll; trajetoriaTruncada = true; }
    }
    if (!targets.length) targets = [0];
    trajetoriaInfo = { passoPx: STEP_PX, tetoPassos: MAX_STEPS, trajetoriaTruncada, fimAlcancado: targets.at(-1) === maxScroll };
  }

  // Página-sonda para a matemática de imagem da trilha de movimento. Fica em
  // about:blank no MESMO browser — nada dela toca a página julgada.
  const probe = await context.newPage();
  await probe.goto('about:blank');

  // Sessão CDP na página julgada, só para a rajada de movimento (ver capturaRapida).
  const cdp = await context.newCDPSession(page).catch(() => null);
  const run = await runTrajectory(page, { targets, outDir, allowNetwork: !allowPrefix, probe, cdp });
  const hosts = (list) => [...new Set(list.map((u) => { try { return new URL(u).host; } catch { return u.slice(0, 40); } }))];

  const report = {
    label,
    target,
    viewport: VIEWPORT,
    trajectoryTargets: targets,
    trajetoria: trajetoriaInfo,
    geometry: run.geometry,
    editability: run.editability,
    timing: run.timing,
    frames: run.frames,
    independence: {
      blockedBeforeNavigation: Boolean(allowPrefix),
      externalAttempts: externalAttempts.length,
      externalAttemptHosts: hosts(externalAttempts).slice(0, 20),
      externalSucceeded: externalSucceeded.length,
      ownPackageMisses: ownOriginMisses.length,
      ownPackageMissSample: ownOriginMisses.slice(0, 10),
    },
    errors: { console: consoleErrors.length, page: pageErrors.length, sample: [...consoleErrors, ...pageErrors].slice(0, 6) },
  };
  await writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  await writeFile(path.join(outDir, 'trajectory.json'), JSON.stringify({ targets, viewport: VIEWPORT }, null, 2));

  await context.close(); await browser.close();
  if (served) await new Promise((d) => served.server.close(d));
  return report;
}

// SSIM quadro a quadro, com o instrumento JÁ VALIDADO do produto
// (computeSsimRgb, cruzado contra o ffmpeg com delta <= 0,0002).
async function compare(refDir, candDir) {
  const ref = JSON.parse(await readFile(path.join(refDir, 'report.json'), 'utf8'));
  const cand = JSON.parse(await readFile(path.join(candDir, 'report.json'), 'utf8'));
  // ⭐ PORTÃO DE REGIME, antes de qualquer número (2026-09-28). A doutrina deste
  // arquivo é "medida que faltou é FALHA, não vira lacuna silenciosa", e o
  // `compare` a violava: ele subtraía os tempos dos dois lados sem exigir que os
  // dois tivessem rodado sob a MESMA cadência, viewport e trajetória. Medido: um
  // relatório com `passoMs: 6000` foi comparado com outro sem cadência alguma
  // (`null`), e o único aviso emitido falava de magnitude de deriva — dois
  // regimes diferentes produzindo uma tabela com cara de resultado.
  const falhasDeRegime = [];
  const mesmo = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  if (!mesmo(ref.viewport, cand.viewport)) falhasDeRegime.push(`viewport diferente: ${JSON.stringify(ref.viewport)} vs ${JSON.stringify(cand.viewport)}`);
  if (!mesmo(ref.trajectoryTargets, cand.trajectoryTargets)) falhasDeRegime.push('trajetória diferente: o candidato não percorreu os mesmos alvos da referência');
  if (ref.timing?.passoMs == null || cand.timing?.passoMs == null) falhasDeRegime.push(`cadência ausente num dos lados (referência ${ref.timing?.passoMs ?? 'ausente'}, candidato ${cand.timing?.passoMs ?? 'ausente'}) — relatório de versão anterior do portão`);
  else if (ref.timing.passoMs !== cand.timing.passoMs) falhasDeRegime.push(`cadência diferente: ${ref.timing.passoMs} vs ${cand.timing.passoMs}`);
  // ⚠️ Cadência igual no PAPEL não é cadência igual de FATO. Medido em gsap.com: os
  // dois lados com `passoMs: 6000`, a referência esperou em 5 paradas e o candidato
  // em ZERO — ou seja de um lado o relógio governou o percurso e do outro governou o
  // custo do instrumento. Comparar assim é comparar trajetórias diferentes, e o
  // número só aparecia como enfeite no relatório.
  const esperas = (r) => r.timing?.paradasQueEsperaram;
  if (esperas(ref) == null || esperas(cand) == null) falhasDeRegime.push('contador de esperas ausente num dos lados — relatório de versão anterior do portão');
  else if ((esperas(ref) === 0) !== (esperas(cand) === 0)) falhasDeRegime.push(`cadência atuou em um lado só (referência esperou ${esperas(ref)} paradas, candidato ${esperas(cand)}) — as duas trajetórias não são a mesma sequência de entrada`);
  const semCarimbo = (r) => r.frames.filter((f) => typeof f.captureAtMs !== 'number').length;
  if (semCarimbo(ref) || semCarimbo(cand)) falhasDeRegime.push(`quadros sem carimbo de captura (referência ${semCarimbo(ref)}, candidato ${semCarimbo(cand)}) — relatório de versão anterior do portão`);
  if (falhasDeRegime.length) {
    console.log(JSON.stringify({ reference: ref.label, candidate: cand.label, falhasDeRegime, veredito: 'COMPARACAO RECUSADA — os dois lados nao rodaram o mesmo regime' }, null, 2));
    process.exitCode = 1;
    return { falhasDeRegime };
  }

  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage();
  await page.addScriptTag({ content: `window.__ssim = ${computeSsimRgb.toString()};` });

  // ⭐ DERIVA É JULGADA POR PONTO, NÃO POR EXECUÇÃO (2026-09-29). Medido: uma execução
  // com deriva média de 17,9 s emitiu "MOVIMENTO MAIS FRACO" e a nota ao lado dizia
  // que o piso não era veredito — quem lê o veredito não lê a nota. A re-execução deu
  // média de 331 ms com UM ponto a 3,4 s: recusar a execução inteira pelo máximo
  // jogaria fora doze pontos bons por um ruim. Então cada quadro cuja deriva estoura
  // o limite sai do SSIM e do movimento como INCONCLUSIVO; o veredito fica sobre os
  // que sobram, e só vale se sobrar a maioria.
  const DERIVA_MAX_MS = 2000;
  const derivaDoQuadro = new Map();
  for (const rf of ref.frames) {
    const cf = cand.frames.find((f) => f.index === rf.index);
    if (cf && typeof rf.captureAtMs === 'number' && typeof cf.captureAtMs === 'number') derivaDoQuadro.set(rf.index, cf.captureAtMs - rf.captureAtMs);
  }
  const foraDeSincronia = (index) => Math.abs(derivaDoQuadro.get(index) ?? 0) > DERIVA_MAX_MS;

  const perFrame = [];
  for (const rf of ref.frames) {
    const cf = cand.frames.find((f) => f.index === rf.index);
    const a = rf.file ? path.join(refDir, rf.file) : null;
    const b = cf && cf.file ? path.join(candDir, cf.file) : null;
    if (!a || !existsSync(a)) { perFrame.push({ index: rf.index, target: rf.target, ssim: null, note: `quadro ausente na referencia${rf.capturaFalhou ? ` (${rf.capturaFalhou})` : ''}` }); continue; }
    if (!b || !existsSync(b)) { perFrame.push({ index: rf.index, target: rf.target, ssim: null, note: `quadro ausente no candidato${cf && cf.capturaFalhou ? ` (${cf.capturaFalhou})` : ''}` }); continue; }
    const [da, db] = await Promise.all([readFile(a), readFile(b)]);
    const ssim = await page.evaluate(async ([aB64, bB64]) => {
      const load = (b64) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = `data:image/png;base64,${b64}`; });
      const [ia, ib] = await Promise.all([load(aB64), load(bB64)]);
      const w = Math.min(ia.naturalWidth, ib.naturalWidth), h = Math.min(ia.naturalHeight, ib.naturalHeight);
      const grab = (img) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h).data; };
      return window.__ssim(grab(ia), grab(ib), w, h);
    }, [da.toString('base64'), db.toString('base64')]);
    perFrame.push({
      index: rf.index, target: rf.target, refObserved: rf.observed, candObserved: cf.observed, ssim: Number(ssim.toFixed(4)),
      ...(foraDeSincronia(rf.index) ? { excluido: true, note: `inconclusivo — deriva ${derivaDoQuadro.get(rf.index)} ms` } : {}),
    });
  }
  await browser.close();

  const measured = perFrame.filter((f) => typeof f.ssim === 'number' && !f.excluido);
  const missing = perFrame.filter((f) => typeof f.ssim !== 'number').length;
  const excluidosPorDeriva = perFrame.filter((f) => f.excluido).length;
  const out = {
    reference: ref.label, candidate: cand.label,
    // Quando os dois lados são execuções de REFERÊNCIA, esta comparação é o
    // AUTOCONTROLE: o piso que o instrumento alcança com o site contra si mesmo.
    // Nenhum piso de candidato tem significado sem ele.
    autoControle: /^reference /.test(String(ref.label)) && /^reference /.test(String(cand.label)),
    // Dimensões INDEPENDENTES — nunca uma nota única.
    pageHeight: { reference: ref.geometry.pageHeight, candidate: cand.geometry.pageHeight, coverage: `${Math.round(100 * cand.geometry.pageHeight / (ref.geometry.pageHeight || 1))}%` },
    scrollReach: { reference: ref.geometry.maxScroll, candidate: cand.geometry.maxScroll },
    textChars: { reference: ref.geometry.textChars, candidate: cand.geometry.textChars },
    images: { reference: `${ref.geometry.imagesDecoded}/${ref.geometry.images}`, candidate: `${cand.geometry.imagesDecoded}/${cand.geometry.images}` },
    independence: cand.independence,
    // Terceira dimensão: quão previsível é EDITAR este artefato. Reportada
    // separada de propósito — um clone pode ser fiel e independente e ainda
    // ser péssimo de editar, que é exatamente o caso do site preservado.
    editability: {
      reference: ref.editability, candidate: cand.editability,
      candidateReachablePct: cand.editability?.inViewport
        ? `${Math.round(100 * cand.editability.reachable / cand.editability.inViewport)}%` : null,
      referenceReachablePct: ref.editability?.inViewport
        ? `${Math.round(100 * ref.editability.reachable / ref.editability.inViewport)}%` : null,
    },
    errors: cand.errors,
    ssim: {
      perFrame,
      min: measured.length ? Math.min(...measured.map((f) => f.ssim)) : null,
      framesMissing: missing,
      quadrosExcluidosPorDeriva: excluidosPorDeriva,
      quadrosNoVeredito: measured.length,
    },
    // DERIVA DE TEMPO — reportada ANTES do SSIM ser lido como fidelidade.
    // Numa página dirigida por rolagem, o mesmo alvo em px alcançado em
    // instantes diferentes compara estados de animação diferentes. Enquanto a
    // deriva for grande, o piso do SSIM mede dessincronia, não infidelidade —
    // e dizer isso é obrigação do instrumento, não nota de rodapé.
    timing: (() => {
      const porPonto = ref.frames.map((rf) => {
        const cf = cand.frames.find((f) => f.index === rf.index);
        return {
          index: rf.index,
          target: rf.target,
          referenciaMs: rf.captureAtMs,
          candidatoMs: cf ? cf.captureAtMs : null,
          derivaMs: cf && typeof rf.captureAtMs === 'number' && typeof cf.captureAtMs === 'number' ? cf.captureAtMs - rf.captureAtMs : null,
        };
      });
      const derivas = porPonto.map((p) => p.derivaMs).filter((d) => typeof d === 'number').map(Math.abs);
      return {
        carga: { referencia: ref.timing?.loadMs ?? null, candidato: cand.timing?.loadMs ?? null },
        percurso: { referencia: ref.timing?.percursoMs ?? null, candidato: cand.timing?.percursoMs ?? null },
        derivaAbsolutaMs: derivas.length ? { min: Math.min(...derivas), max: Math.max(...derivas), media: Math.round(derivas.reduce((a, b) => a + b, 0) / derivas.length) } : null,
        cadencia: {
          passoMs: ref.timing.passoMs,
          // Se isto é zero, a cadência NÃO atuou — o percurso foi ditado pelo
          // custo do instrumento, e nenhum número temporal abaixo é sincronia.
          paradasQueEsperaram: { referencia: ref.timing?.paradasQueEsperaram ?? null, candidato: cand.timing?.paradasQueEsperaram ?? null },
          deficitFinalMs: { referencia: ref.timing?.deficitFinalMs ?? null, candidato: cand.timing?.deficitFinalMs ?? null },
          custoInstrumentoMedioMs: { referencia: ref.timing?.custoInstrumentoMedioMs ?? null, candidato: cand.timing?.custoInstrumentoMedioMs ?? null },
        },
        nota: derivas.length && Math.max(...derivas) > 2000
          ? 'deriva acima de 2s: o piso do SSIM nao e veredito de fidelidade nesta execucao'
          : 'deriva dentro de 2s',
        porPonto,
      };
    })(),
    // Contrato de MOVIMENTO. Ele responde UMA pergunta: onde a referência se
    // move, o candidato também se move?
    //
    // Três correções sobre a versão anterior, todas de achados reproduzidos:
    //  • Amostra NÃO-COMPARÁVEL não recebe faixa. Antes o instrumento calculava
    //    "preciso" e atribuía faixa de qualquer jeito, então um intervalo de
    //    36 s entrava na contagem de manchete como "vivo" ou "congelado" —
    //    contradizendo a doutrina escrita no cabeçalho deste arquivo.
    //  • Os dois lados precisam ter intervalos SEMELHANTES entre si. Dois pares
    //    ambos dentro do alvo mas um 4x mais longo que o outro não se comparam.
    //  • Os limiares são MEDIDOS, não herdados. Os anteriores eram os números da
    //    unidade antiga reaplicados a outra grandeza, o que tornou "congelado"
    //    praticamente inalcançável — e o `congelado: 0` que eu tratei como prova
    //    de conserto era artefato do limiar.
    motion: (() => {
      const leitura = (m) => {
        if (m == null) return null;
        // Formato antigo (número solto) não tem intervalo registrado: sem o
        // intervalo não há como saber se a medida vale. Não se converte.
        if (typeof m === 'number') return { formatoAntigo: true };
        if (typeof m === 'object' && typeof m.bruto === 'number') return m;
        return null;
      };
      const FATOR_GAP = 1.8;   // quanto os intervalos dos dois lados podem diferir
      const pontos = ref.frames.map((rf) => {
        const cf = cand.frames.find((f) => f.index === rf.index);
        const r = leitura(rf.motion); const c = cf ? leitura(cf.motion) : null;
        const base = {
          index: rf.index, target: rf.target,
          referencia: r?.bruto ?? null, candidato: c?.bruto ?? null,
          gapRefMs: r?.gapMaxMs ?? null, gapCandMs: c?.gapMaxMs ?? null,
        };
        if (!r || !c) return { ...base, faixa: 'sem-medida' };
        if (r.formatoAntigo || c.formatoAntigo) return { ...base, faixa: 'formato-antigo' };
        // Backends de captura diferentes não se comparam (cursor de texto, política de
        // captura): não é "um pouco de ruído", é outra medida (Astra B1 #4).
        if (r.captureMode && c.captureMode && r.captureMode !== c.captureMode) return { ...base, faixa: 'inconclusivo-backend', backends: `${r.captureMode} vs ${c.captureMode}` };
        if (foraDeSincronia(rf.index)) {
          // ⚠️ Ponto fora de sincronia onde a REFERÊNCIA se move NÃO some do
          // denominador: sumir seria censura seletiva — os quadros caros (os que
          // animam) são justamente os que atrasam, e excluí-los deixa só as cenas
          // fáceis (Astra B1 #2). Ele fica marcado como ponto móvel perdido, e a
          // trilha inteira vira inconclusiva se houver algum.
          // Movel pela REGIAO quando ha mapa (revisao Claude 2026-10-01): pelo quadro inteiro, um
          // ponto em que so um botao pequeno se move (~0,05) saia do denominador ao desalinhar —
          // a censura seletiva do B1 #2 exatamente no caso que a regiao veio cobrir.
          const regRef = energiaPorRegiao(r.mapa, r.mapa);
          const movelPerdido = regRef ? Boolean(regRef.pior) : r.bruto >= PISO_REFERENCIA;
          return { ...base, faixa: movelPerdido ? 'inconclusivo-deriva-em-ponto-movel' : 'inconclusivo-deriva', derivaMs: derivaDoQuadro.get(rf.index) };
        }
        if (!r.comparavel || !c.comparavel) return { ...base, faixa: 'inconclusivo-intervalo-longo' };
        const maior = Math.max(r.gapMaxMs, c.gapMaxMs); const menor = Math.max(1, Math.min(r.gapMaxMs, c.gapMaxMs));
        if (maior / menor > FATOR_GAP) return { ...base, faixa: 'inconclusivo-intervalos-desiguais', fatorGap: Number((maior / menor).toFixed(2)) };
        // POR REGIAO quando os dois lados trazem o mapa (Astra B1 #1): a mascara sao os
        // pixels onde a REFERENCIA mudou; o candidato e medido so dentro dela.
        const reg = energiaPorRegiao(r.mapa, c.mapa);
        if (reg) {
          const comReg = { ...base, metodo: 'regiao', areaPx: reg.areaPx, areaFracao: reg.areaFracao, componentes: reg.componentes.slice(0, 6) };
          if (!reg.pior) return { ...comReg, faixa: 'referencia-parada' };
          const p = reg.pior;
          const faixa = p.cand <= PISO_MORTO ? 'congelado' : (p.razao < RAZAO_FRACA ? 'fraco' : 'vivo');
          return { ...comReg, razao: p.razao, referenciaRegiao: p.ref, candidatoRegiao: p.cand, ...(reg.componentes.some((q) => q.quaseQuadroInteiro) ? { regiaoQuaseQuadroInteiro: true } : {}), faixa };
        }
        if (r.bruto < PISO_REFERENCIA) return { ...base, metodo: 'quadro-inteiro', faixa: 'referencia-parada' };
        const razao = Number((c.bruto / r.bruto).toFixed(3));
        const faixa = c.bruto <= PISO_MORTO ? 'congelado' : (razao < RAZAO_FRACA ? 'fraco' : 'vivo');
        return { ...base, metodo: 'quadro-inteiro', razao, faixa };
      });

      const conta = (f) => pontos.filter((p) => p.faixa === f).length;
      const conclusivos = conta('vivo') + conta('fraco') + conta('congelado');
      // Onde a referência se move E a medida vale: é sobre isto que o contrato
      // fala. Se for pequeno, o instrumento não julgou a página — e dizer isso é
      // obrigação dele, não nota de rodapé.
      const inconclusivos = conta('sem-medida') + conta('formato-antigo')
        + conta('inconclusivo-intervalo-longo') + conta('inconclusivo-intervalos-desiguais') + conta('inconclusivo-deriva')
        + conta('inconclusivo-deriva-em-ponto-movel') + conta('inconclusivo-backend');
      const pontosMoveisPerdidos = conta('inconclusivo-deriva-em-ponto-movel');
      // Quantos pontos MÓVEIS a referência tem ao todo (conclusivos + perdidos): é o
      // escopo real do veredito. Uma página com 1 ponto móvel recebe veredito LIMITADO
      // a esse ponto, não um "inconclusivo" eterno (Astra B1 #5).
      const pontosMoveisNaReferencia = conclusivos + pontosMoveisPerdidos;
      return {
        unidade: 'diferenca media por canal de pixel entre quadros consecutivos, em intervalos VERIFICADOS como comparaveis (sem normalizacao temporal); por REGIAO (mascara da referencia) quando os dois lados trazem mapa, senao do quadro inteiro',
        metodos: { regiao: pontos.filter((p) => p.metodo === 'regiao').length, quadroInteiro: pontos.filter((p) => p.metodo === 'quadro-inteiro').length },
        // Mistura de metodos na mesma comparacao (mapa faltando num lado) fica DECLARADA.
        metodoMisto: pontos.some((p) => p.metodo === 'regiao') && pontos.some((p) => p.metodo === 'quadro-inteiro'),
        limiares: { pisoReferencia: PISO_REFERENCIA, pisoMorto: PISO_MORTO, razaoFraca: RAZAO_FRACA, gapAlvoMs: GAP_ALVO_MS, fatorGap: FATOR_GAP },
        origemDosLimiares: PISO_CALIBRADO
          ? 'piso de ruido MEDIDO em 0 (24 rajadas sobre quadros reais servidos como imagem estatica, sem script); escala medida deslocando o quadro inteiro por N pixels: 1px=0,52 2px=1,00 8px=3,35 32px=7,04'
          : 'NAO CALIBRADOS — provisorios; a trilha de movimento nao e veredito',
        vivo: conta('vivo'), fraco: conta('fraco'), congelado: conta('congelado'),
        referenciaParada: conta('referencia-parada'),
        inconclusivos,
        detalheInconclusivos: {
          semMedida: conta('sem-medida'),
          formatoAntigo: conta('formato-antigo'),
          intervaloLongo: conta('inconclusivo-intervalo-longo'),
          intervalosDesiguais: conta('inconclusivo-intervalos-desiguais'),
          deriva: conta('inconclusivo-deriva'),
          derivaEmPontoMovel: pontosMoveisPerdidos,
          backend: conta('inconclusivo-backend'),
        },
        pontosMoveisNaReferencia,
        pontosConclusivos: conclusivos,
        // ⚠️ MÍNIMO DE PONTOS. Medido: duas execuções do MESMO pacote, com 2 pontos
        // conclusivos cada, deram "MAIS FRACO" numa e "PRESENTE" na outra. Veredito
        // sobre 2 pontos é moeda. Abaixo de MINIMO_CONCLUSIVOS a trilha diz que não
        // sabe — e diz por quê — em vez de sortear.
        // ⚠️ Escopo, não mínimo absoluto (Astra B1 #5): se a página tem menos pontos
        // móveis que MINIMO_CONCLUSIVOS, o veredito sai LIMITADO a eles; o que torna a
        // trilha inconclusiva é perder ponto móvel por deriva (censura), não a página
        // ser pouco animada. E a instabilidade entre execuções em poucos pontos é
        // declarada no escopo, não escondida.
        veredito: !PISO_CALIBRADO ? 'NAO CALIBRADO'
          : pontosMoveisPerdidos > 0 ? `INCONCLUSIVO — ${pontosMoveisPerdidos} ponto(s) MOVEL(is) da referencia perdido(s) por deriva; excluir seria censurar justamente onde anima. Repetir sem outra carga na maquina`
          : conclusivos === 0 ? 'INCONCLUSIVO — nenhum ponto com medida valida e referencia em movimento'
          : conclusivos < MINIMO_CONCLUSIVOS && pontosMoveisNaReferencia < MINIMO_CONCLUSIVOS ? (
            conta('congelado') > 0 ? `CONGELAMENTO DETECTADO (escopo LIMITADO a ${conclusivos} ponto(s) movel(is) — a pagina nao tem mais)`
            : conta('fraco') > 0 ? `MOVIMENTO MAIS FRACO QUE A REFERENCIA (escopo LIMITADO a ${conclusivos} ponto(s) movel(is))`
            : `MOVIMENTO PRESENTE (escopo LIMITADO a ${conclusivos} ponto(s) movel(is) — a pagina nao tem mais; veredito em poucos pontos e instavel entre execucoes)`)
          : conclusivos < MINIMO_CONCLUSIVOS ? `INCONCLUSIVO — so ${conclusivos} de ${pontosMoveisNaReferencia} ponto(s) movel(is) conclusivo(s); o minimo e ${MINIMO_CONCLUSIVOS}. Muitas paradas fora de sincronia`
          // CORROBORACAO (2a revisao Claude): um ponto congelado ISOLADO pode ser um componente
          // espurio da referencia (cursor, decode tardio, video que nao comecou); o veredito
          // de congelamento exige >= 2 pontos.
          : conta('congelado') >= 2 ? 'CONGELAMENTO DETECTADO'
          : conta('congelado') === 1 ? 'INCONCLUSIVO — 1 ponto congelado ISOLADO (pode ser componente espurio da referencia); exige corroboracao em outro ponto'
          : conta('fraco') > 0 ? 'MOVIMENTO MAIS FRACO QUE A REFERENCIA'
          : 'MOVIMENTO PRESENTE nos pontos conclusivos',
        congelados: pontos.filter((p) => p.faixa === 'congelado').map((p) => ({ target: p.target, referencia: p.referencia, candidato: p.candidato })).slice(0, 8),
        fracos: pontos.filter((p) => p.faixa === 'fraco').map((p) => ({ target: p.target, referencia: p.referencia, candidato: p.candidato, razao: p.razao })).slice(0, 8),
        porPonto: pontos,
      };
    })(),
  };
  // Validade cruzada: maioria dos quadros em sincronia E nenhum ponto MÓVEL da
  // referência perdido — maioria global sozinha deixa passar a censura seletiva dos
  // quadros que animam (Astra B1 #2).
  const moveisPerdidosSsim = out.motion?.detalheInconclusivos?.derivaEmPontoMovel || 0;
  // Quadro AUSENTE tambem invalida (revisao Claude 2026-10-01): ele sai do minimo e o
  // denominador encolhe — a mesma censura seletiva da deriva (a parada que trava e
  // justamente a que renderiza pior).
  out.comparacaoCruzadaValida = excluidosPorDeriva * 2 < perFrame.length && moveisPerdidosSsim === 0 && missing === 0;
  if (!out.comparacaoCruzadaValida) {
    const motivo = missing > 0
      ? `INCONCLUSIVO — ${missing} quadro(s) ausente(s) (captura falhou); o SSIM minimo sobre os restantes seria seletivo`
      : moveisPerdidosSsim > 0
      ? `INCONCLUSIVO — ${moveisPerdidosSsim} ponto(s) MOVEL(is) da referencia fora de sincronia; o SSIM minimo sobre os restantes seria seletivo. Repetir sem outra carga na maquina`
      : `INCONCLUSIVO — ${excluidosPorDeriva} de ${perFrame.length} quadros fora de sincronia (> ${DERIVA_MAX_MS} ms); repetir sem outra carga na maquina`;
    out.ssim = { ...out.ssim, veredito: motivo };
    out.motion = { ...out.motion, veredito: motivo };
    process.exitCode = 2;
  }
  console.log(JSON.stringify(out, null, 2));
  return out;
}

async function main() {
  const out = arg('--out', '_verbatim/run');
  const reference = arg('--reference');
  const candidate = arg('--candidate');
  const trajPath = arg('--trajectory');
  const cmp = process.argv.indexOf('--compare');

  if (cmp > -1) { await compare(process.argv[cmp + 1], process.argv[cmp + 2]); return; }

  // ⚠️ `--trajectory` apontando para arquivo INEXISTENTE era lacuna silenciosa: o run
  // seguia com a própria trajetória e os relatórios saíam INCOMPARÁVEIS sem ninguém
  // avisar. Medido: a referência A estourou o timeout do site, e B, verbatim e native
  // rodaram cada um com alvos próprios "herdados" de um arquivo que não existia.
  if (trajPath && !existsSync(trajPath)) {
    console.error(`trajetória não encontrada: ${trajPath} — o run de referência que a produziria falhou? abortando em vez de seguir incomparável`);
    process.exit(3);
  }
  const trajectory = trajPath ? JSON.parse(await readFile(trajPath, 'utf8')) : null;

  if (reference) {
    const r = await measure({ label: `reference ${reference}`, outDir: out, url: reference, trajectory });
    console.log(JSON.stringify({ label: r.label, geometry: r.geometry, errors: r.errors, frames: r.frames.length }, null, 2));
    return;
  }
  if (candidate) {
    const [kind, ...rest] = candidate.split(':');
    const value = rest.join(':');
    if (kind === 'bundle') {
      const root = path.resolve(value);
      const assets = existsSync(path.join(root, 'assets')) ? path.join(root, 'assets') : root;
      if (!(await stat(assets).catch(() => null))) throw new Error(`bundle não encontrado: ${assets}`);
      const r = await measure({ label: `candidate bundle ${path.basename(root)}`, outDir: out, serveRoot: assets, trajectory });
      console.log(JSON.stringify({ label: r.label, geometry: r.geometry, independence: r.independence, errors: r.errors }, null, 2));
      return;
    }
    if (kind === 'file') {
      const file = path.resolve(value);
      const r = await measure({ label: `candidate file ${path.basename(file)}`, outDir: out, serveRoot: path.dirname(file), trajectory });
      console.log(JSON.stringify({ label: r.label, geometry: r.geometry, independence: r.independence, errors: r.errors }, null, 2));
      return;
    }
    throw new Error('--candidate precisa ser bundle:<dir> ou file:<arquivo.html>');
  }
  console.log('Use --reference <url> | --candidate bundle:<dir>|file:<html> | --compare <refDir> <candDir>');
}

// So roda como CLI; importado (testes da energia por regiao) nao dispara o portao.
let ehCli = false;
try { ehCli = Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { ehCli = false; }
if (ehCli) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
