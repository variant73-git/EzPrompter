import { describe, expect, it } from 'vitest';
import { bundlePathForUrl, srcsetCandidateUrls, avaliarCadeiaCors, identidadeDeRequisicao, acaoLiberaLeitura, elegivelCorsCredenciado, precisaPreflight } from './capture-bundle.js';
import { readFileSync } from 'node:fs';

describe('srcsetCandidateUrls (defect 1b, 2026-08-20)', () => {
  // The capture only saved the srcset candidate the browser happened to pick
  // at the capture viewport; the others stayed absolute in the HTML and the
  // gateway CSP (img-src 'self') blocks them forever. The closing pass loads
  // every candidate inside the page, so they enter the normal interception
  // (SSRF guard + limits + report) — this parser feeds that pass.
  it('parses candidates with width and density descriptors', () => {
    expect(srcsetCandidateUrls('https://a/x.avif 500w, ./y.avif 1542w')).toEqual([
      'https://a/x.avif', './y.avif',
    ]);
    expect(srcsetCandidateUrls('img/a.png 1x, img/b.png 2x')).toEqual(['img/a.png', 'img/b.png']);
  });

  it('parses bare candidates without descriptors', () => {
    expect(srcsetCandidateUrls('https://a/only.webp')).toEqual(['https://a/only.webp']);
  });

  it('does not split data URLs on their commas', () => {
    expect(srcsetCandidateUrls('data:image/png;base64,AAA 1x, https://a/z.png 2x')).toEqual([
      'data:image/png;base64,AAA', 'https://a/z.png',
    ]);
  });

  it('parses a first candidate with NO descriptor (the comma is the separator)', () => {
    // `srcset="a.png, a_2x.png 2x"` is ordinary markup (Apple uses it across a
    // whole page). The greedy scan swallowed the separating comma as part of
    // the first token and treated the rest as its descriptor, so every later
    // candidate was lost — and those images end up unreachable in the clone.
    expect(srcsetCandidateUrls('/a/m.png, /a/m_2x.png 2x')).toEqual(['/a/m.png', '/a/m_2x.png']);
    expect(srcsetCandidateUrls('x.png, y.png 2x, z.png 3x')).toEqual(['x.png', 'y.png', 'z.png']);
  });

  it('tolerates whitespace-heavy and empty input', () => {
    expect(srcsetCandidateUrls('')).toEqual([]);
    expect(srcsetCandidateUrls(null)).toEqual([]);
    expect(srcsetCandidateUrls('  https://a/x.png   2x  ,   https://a/y.png 3x  ')).toEqual([
      'https://a/x.png', 'https://a/y.png',
    ]);
  });
});

describe('bundlePathForUrl', () => {
  it('keeps host separation and sanitizes characters', () => {
    expect(bundlePathForUrl('https://cdn.test/img/a%20b.svg', 'https://site.test/')).toBe('_ext/cdn.test/img/a_20b.svg');
  });
});

// ⭐ Medido no clone real: 3 imagens ficaram de fora com "corpo nao chegou" e,
// como o carrossel as repete, 7 quadros do site aparecem vazios. A coleta ja'
// pede o `src` simples — o que faltou foi a resposta chegar naquela passagem.
describe('a captura tenta de novo antes de desistir', () => {
  const fonte = readFileSync('lib/native-clone/capture-bundle.js', 'utf8');

  // ⚠️ A repescagem procura RESERVAS NULAS (`filter(([, v]) => !v)`). Se o
  // caminho de "corpo nao chegou" apagar a reserva, `faltantes` nasce sempre
  // vazio e a repescagem vira codigo morto — foi o que aconteceu: medido no
  // site real, a etapa `retrying` nunca disparava e os dois videos ficavam de
  // fora do bundle. Quem apaga e' o purgo DEPOIS da repescagem, nao antes.
  it('nao apaga a reserva de quem devia ter corpo, que e o que a repescagem procura', () => {
    const interceptacao = fonte.slice(fonte.indexOf("page.on('response'"), fonte.indexOf("onProgress({ etapa: 'navigating' })"));
    const semCorpo = interceptacao.slice(interceptacao.indexOf('if (!bytes)'), interceptacao.indexOf('const bilhete ='));
    // redirect/204/304 nao tem corpo por natureza: esses SIM liberam a vaga
    // Libera a vaga so' quem nao e' conteudo (204/304) ou redirecionou DE FATO
    // (Location presente); 3xx sem destino fica nulo para a repescagem tentar.
    expect(semCorpo).toMatch(/status >= 300 && status < 400 && Boolean\(res\.request\(\)\.redirectedTo\(\)\)/);
    expect(semCorpo).toMatch(/status === 204 \|\| status === 304 \|\| redirecionou[\s\S]{0,60}recursos\.delete\(u\)/);
    // e o resto fica NULO para a repescagem achar
    expect(semCorpo).not.toMatch(/descartados\.push/);
    const depois = semCorpo.replace(/status === 204 \|\| status === 304 \|\| redirecionou[^\n]*\n/, '');
    expect(depois).not.toMatch(/recursos\.delete\(u\)/);
  });

  // ⚠️ `has` + `set` so' e' atomico se NAO houver espera entre os dois: com um
  // `await` no meio, duas respostas simultaneas da mesma URL passam pelo `has`
  // antes de qualquer uma reservar, e ai' o mesmo corpo e' contabilizado duas
  // vezes. Midia pedida por FAIXAS produz exatamente respostas simultaneas da
  // mesma URL (Sol). Isto testa a ORDEM, que e' onde a garantia mora.
  it('reserva a vaga da URL antes de qualquer espera', () => {
    const ouvinte = fonte.slice(fonte.indexOf("page.on('response'"), fonte.indexOf("emVoo.add(tarefa)"));
    const inicio = ouvinte.indexOf('recursos.has(u)) return;');
    const janela = ouvinte.slice(inicio, ouvinte.indexOf('recursos.set(u, null);', inicio))
      .replace(/\/\/[^\n]*/g, '');   // comentario que MENCIONA await nao e' espera
    expect(janela).not.toMatch(/\bawait\b/);
    // e o host segue verificado — depois da reserva, liberando a vaga se recusar
    expect(ouvinte).toMatch(/recursos\.set\(u, null\);[\s\S]{0,200}hostEhPublico[\s\S]{0,120}recursos\.delete\(u\)/);
  });

  // ⚠️ Um 206 PARCIAL com corpo legivel existe — medido no site real
  // (bytes=622592- chegou legivel com 2,3MB de um arquivo de 2,9MB). Guardar
  // esse corpo como o arquivo inteiro poe um PEDACO DO MEIO do video no lugar
  // do video. So' se guarda 206 cujo Content-Range cobre o arquivo inteiro e
  // cujo corpo tem exatamente esse tamanho; o resto fica nulo e a repescagem
  // busca o arquivo completo, sem Range.
  // Astra B19: o ramo do fetch cross-origin (envelope, nunca asset) guardava corpo sem
  // passar pelo livro-razao nem pelo teto de contagem — 61 × 4 MiB = 244 MiB com o
  // razao em zero. O ramo tem que reservar+confirmar e contar ANTES de registrar.
  it('o ramo do fetch cross-origin passa pelo livro-razao e pelo teto antes de registrar o envelope', () => {
    const inicio = fonte.indexOf('if (!ehHop(res) && fetchCrossOrigin(req, u)) {');
    const ramo = fonte.slice(inicio, fonte.indexOf('const bilhete = bytes.byteLength > MAX_ASSET_BYTES', inicio));
    const registro = ramo.indexOf('registrarEnvelope(req, res, u, bytes)');
    expect(registro).toBeGreaterThan(-1);
    for (const guarda of ['conta.reservar(', 'conta.confirmar(', 'envelopesRepetidos >= MAX_ENVELOPES_REPETIDOS', 'envelopesRepetidos += 1']) {
      const i = ramo.indexOf(guarda);
      expect(i, guarda).toBeGreaterThan(-1);
      expect(i, `${guarda} antes do registro`).toBeLessThan(registro);
    }
    // e a recusa deixa buraco nomeado, nunca silencio
    expect(ramo).toMatch(/orcamento esgotado/);
    expect(ramo).toMatch(/limite de envelopes/);
  });

  it('nunca guarda corpo de 206 parcial como arquivo inteiro', () => {
    const ouvinte = fonte.slice(fonte.indexOf("page.on('response'"), fonte.indexOf("emVoo.add(tarefa)"));
    const guarda = ouvinte.slice(ouvinte.indexOf('res.status() === 206'), ouvinte.indexOf('const bilhete'));
    expect(guarda).toMatch(/parseContentRange/);
    expect(guarda).toMatch(/inicio === 0/);
    expect(guarda).toMatch(/fim === cobertura\.total - 1/);
    expect(guarda).toMatch(/bytes\.byteLength === cobertura\.total/);
    // parcial NAO descarta: deixa a reserva nula para a repescagem achar
    expect(guarda).not.toMatch(/descartados\.push/);
    expect(guarda).not.toMatch(/recursos\.delete/);
  });

  // ⚠️ Midia e' o caso onde content-length mentir DOI: video de dezenas de MB
  // bufferizado inteiro pelo body() so para ser recusado. E body() de midia
  // costuma falhar de toda forma (206/streaming). Regra: midia NUNCA passa
  // pelo body() da interceptacao — reserva fica nula e a repescagem, que tem
  // teto DURANTE a leitura, busca o arquivo inteiro.
  it('midia vai direto para a repescagem, sem bufferizar na interceptacao', () => {
    const ouvinte = fonte.slice(fonte.indexOf("page.on('response'"), fonte.indexOf("emVoo.add(tarefa)"));
    // ordem: reserva ANTES do desvio de midia, desvio ANTES do body()
    const iReserva = ouvinte.indexOf('recursos.set(u, null)');
    const iMidia = ouvinte.indexOf("resourceType() === 'media'");
    const iBody = ouvinte.indexOf('await res.body()');
    expect(iReserva).toBeGreaterThan(-1);
    expect(iMidia).toBeGreaterThan(iReserva);
    // e vale tambem para video servido por fetch/XHR: o desvio olha o
    // content-type da RESPOSTA, nao so quem iniciou o pedido
    expect(ouvinte).toMatch(/\^\(\?:video\|audio\)\\\//);
    expect(iBody).toBeGreaterThan(iMidia);
    // e o desvio sai sem apagar a reserva de MIDIA — a unica excecao (Astra B85) e o salto de
    // uma cadeia de FETCH, que nunca e asset: esse solta a reserva para a repescagem nao
    // re-buscar a URL do salto e guardar o corpo terminal como asset.
    const bloco = ouvinte.slice(iMidia, ouvinte.indexOf('return;', iMidia) + 'return;'.length);
    expect(bloco).toMatch(/if \(ehHop\(res\) && ehChamadaDeFetch\(req\)\) recursos\.delete\(u\);\s*return;/);
    expect(bloco.replace(/if \(ehHop\(res\) && ehChamadaDeFetch\(req\)\) recursos\.delete\(u\);/, '')).not.toContain('recursos.delete(u)');
  });

  it('mede o recebido ANTES de materializar, mesmo sem content-length', () => {
    const ouvinte = fonte.slice(fonte.indexOf("page.on('response'"), fonte.indexOf("emVoo.add(tarefa)"));
    const iSizes = ouvinte.indexOf('sizes()');
    const iBody = ouvinte.indexOf('await res.body()');
    expect(iSizes).toBeGreaterThan(-1);
    expect(iSizes).toBeLessThan(iBody);
    expect(ouvinte).toMatch(/responseBodySize/);
    expect(ouvinte).toMatch(/grande demais \(recebido\)/);
  });

  it('refaz o pedido com leitura em fluxo', () => {
    expect(fonte).toMatch(/etapa: 'retrying'/);
    expect(fonte).toMatch(/resposta\.body\.getReader\(\)/);
  });

  // ⚠️ Seguir redirect sozinho valida so' o PRIMEIRO host: um 302 de host
  // publico para link-local passaria por cima da guarda. Cada salto e' validado.
  it('valida CADA salto de redirect, e nao segue sozinho', () => {
        expect(fonte).toMatch(/retrying[\s\S]{0,1800}hostEhPublico\(new URL\(alvo\)/);
    expect(fonte).toMatch(/redirect: 'manual'/);
    expect(fonte).toMatch(/RETRY_MAX_SALTOS/);
  });

  // Teto conferido no CABECALHO antes de materializar o corpo — senao um
  // arquivo enorme entra inteiro na memoria para so' entao ser recusado.
  // ⚠️ Um teto conferido DEPOIS do download limita o que se ACEITA, nunca a
  // memoria nem os bytes trafegados. Aqui os bytes sao contados enquanto chegam
  // e a conexao e' CORTADA no limite (Sol).
  it('conta os bytes enquanto chegam e ABORTA no limite', () => {
    expect(fonte).toMatch(/lidos \+= value\.byteLength/);
    expect(fonte).toMatch(/if \(lidos > MAX_ASSET_BYTES \|\| orcamento < 0 \|\| !bilhete\)[\s\S]{0,220}leitor\.cancel\(\)/);
    expect(fonte).toMatch(/parada\.abort\(\)/);
    expect(fonte).toMatch(/RETRY_ORCAMENTO_BYTES/);
    // O orcamento e' debitado do que TRAFEGOU, nao do que foi aceito: senao
    // varias respostas grandes recusadas puxariam bytes sem limite.
    expect(fonte).toMatch(/orcamento -= value\.byteLength/);
    // ⚠️ Viva, a repescagem tem que respeitar o teto GLOBAL e somar ao total:
    // orcamento proprio de 60MB + 220MB ja' gastos = pacote de 280MB, e o
    // relatorio omitindo tudo que ela trouxe.
    // Os dois caminhos reservam pela MESMA contabilidade (byte-ledger.js), que
    // e' onde o comportamento esta' testado. Aqui so' se fixa o uso.
    expect(fonte).toMatch(/criarContabilidade\(MAX_BYTES_TOTAL\)/);
    expect(fonte).toMatch(/Math\.min\(RETRY_ORCAMENTO_BYTES, conta\.restante\(\)\)/);
    expect(fonte).toMatch(/const bilhete = conta\.reservar\(value\.byteLength\)/);
    expect(fonte).toMatch(/if \(!aceita\) for \(const b of bilhetes\) conta\.devolver\(b\)/);
    expect(fonte).toMatch(/conta\.fechar\(\)[\s\S]{0,200}congelados/);
    expect(fonte).toMatch(/orcamento < 0/);
  });

  it('tem concorrencia limitada e teto de arquivos', () => {
    expect(fonte).toMatch(/RETRY_CONCORRENCIA/);
    expect(fonte).toMatch(/RETRY_MAX_ARQUIVOS/);
  });

  it('o que continuar faltando segue nomeado no relatorio', () => {
    expect(fonte).toMatch(/retrying[\s\S]{0,9000}motivo: 'corpo nao chegou'/);
  });
});


// Astra B83: a checagem CORS de uma cadeia usa a origem SERIALIZADA do pedido, que vira `null`
// a partir do primeiro salto que muda de origem, e toda resposta apos a cadeia ficar "cors"
// e checada — inclusive um terminal que voltou a origem da pagina.
describe('avaliarCadeiaCors', () => {
  const A = 'https://a.example'; const B = 'https://b.example';
  const resp = (url, headers = {}) => ({ url, headers });
  it('direto cross-origin: ACAO da pagina le; com ACAC true credencia', () => {
    expect(avaliarCadeiaCors(A, [resp(`${B}/x`, { 'access-control-allow-origin': A })])).toEqual({ legivel: true, credenciado: false });
    expect(avaliarCadeiaCors(A, [resp(`${B}/x`, { 'access-control-allow-origin': A, 'access-control-allow-credentials': 'true' })])).toEqual({ legivel: true, credenciado: true });
    expect(avaliarCadeiaCors(A, [resp(`${B}/x`, { 'access-control-allow-origin': '*', 'access-control-allow-credentials': 'true' })])).toEqual({ legivel: true, credenciado: false });
  });
  it('same-origin sem saltos: nada e checado', () => {
    expect(avaliarCadeiaCors(A, [resp(`${A}/x`)])).toEqual({ legivel: true, credenciado: true });
  });
  it('A -> B -> A com ACAO A em tudo: a origem serializada e null depois do salto, o terminal FALHA', () => {
    const cadeia = [resp(`${A}/relay`), resp(`${B}/back`, { 'access-control-allow-origin': A }), resp(`${A}/secret`, { 'access-control-allow-origin': A })];
    expect(avaliarCadeiaCors(A, cadeia).legivel).toBe(false);
  });
  it('A -> B -> A com * em B e null no terminal: legivel; A+ACAC em B e null+ACAC no terminal credencia', () => {
    const base = [resp(`${A}/relay`), resp(`${B}/back`, { 'access-control-allow-origin': '*' })];
    expect(avaliarCadeiaCors(A, [...base, resp(`${A}/secret`, { 'access-control-allow-origin': 'null' })])).toEqual({ legivel: true, credenciado: false });
    expect(avaliarCadeiaCors(A, [...base, resp(`${A}/secret`, { 'access-control-allow-origin': '*' })])).toEqual({ legivel: true, credenciado: false });
    // Astra B84: em B a origem serializada ainda e A (A -> B nao tinge); so B -> A tinge.
    expect(avaliarCadeiaCors(A, [resp(`${A}/relay`), resp(`${B}/back`, { 'access-control-allow-origin': A, 'access-control-allow-credentials': 'true' }), resp(`${A}/secret`, { 'access-control-allow-origin': 'null', 'access-control-allow-credentials': 'true' })])).toEqual({ legivel: true, credenciado: true });
    expect(avaliarCadeiaCors(A, [resp(`${A}/relay`), resp(`${B}/back`, { 'access-control-allow-origin': 'null', 'access-control-allow-credentials': 'true' }), resp(`${A}/secret`, { 'access-control-allow-origin': 'null', 'access-control-allow-credentials': 'true' })]).legivel).toBe(false);
  });
  it('A -> B (salto same-origin em A, terminal em B): B e checado contra A — ACAO A le e credencia, ACAO null NAO (Astra B84)', () => {
    expect(avaliarCadeiaCors(A, [resp(`${A}/relay`), resp(`${B}/x`, { 'access-control-allow-origin': A, 'access-control-allow-credentials': 'true' })])).toEqual({ legivel: true, credenciado: true });
    expect(avaliarCadeiaCors(A, [resp(`${A}/relay`), resp(`${B}/x`, { 'access-control-allow-origin': 'null', 'access-control-allow-credentials': 'true' })])).toEqual({ legivel: false, credenciado: false });
  });
  it('B -> C (salto cross-origin fora do documento): tinge — C e checado contra null', () => {
    const C = 'https://c.example';
    expect(avaliarCadeiaCors(A, [resp(`${B}/relay`, { 'access-control-allow-origin': '*' }), resp(`${C}/x`, { 'access-control-allow-origin': A })]).legivel).toBe(false);
    expect(avaliarCadeiaCors(A, [resp(`${B}/relay`, { 'access-control-allow-origin': '*' }), resp(`${C}/x`, { 'access-control-allow-origin': 'null' })]).legivel).toBe(true);
  });
  it('B/relay (302, *) -> B/final (A + ACAC true): legivel, NAO credenciado (Astra B80)', () => {
    expect(avaliarCadeiaCors(A, [resp(`${B}/relay`, { 'access-control-allow-origin': '*' }), resp(`${B}/final`, { 'access-control-allow-origin': A, 'access-control-allow-credentials': 'true' })])).toEqual({ legivel: true, credenciado: false });
  });
  it('B/relay (302 sem ACAO) -> B/ok (*): NAO legivel (Astra B81)', () => {
    expect(avaliarCadeiaCors(A, [resp(`${B}/relay`), resp(`${B}/ok`, { 'access-control-allow-origin': '*' })]).legivel).toBe(false);
  });
});


// Astra B90: so espaco HTTP e aparado — NBSP faz parte do valor e distingue identidades.
describe('identidade de cabecalho: espaco HTTP vs Unicode', () => {
  const U = 'https://origin/account';
  it('NBSP no valor e OUTRA identidade; espaco HTTP nas pontas nao e', () => {
    const a = identidadeDeRequisicao('GET', U, Buffer.alloc(0), { 'api-key': 'A' });
    expect(identidadeDeRequisicao('GET', U, Buffer.alloc(0), { 'api-key': 'A\u00a0' })).not.toBe(a);
    expect(identidadeDeRequisicao('GET', U, Buffer.alloc(0), { 'api-key': ' A\t' })).toBe(a);
    expect(identidadeDeRequisicao('GET', U, Buffer.alloc(0), { accept: '*/*\u00a0' })).not.toBe(identidadeDeRequisicao('GET', U, Buffer.alloc(0), {}));
  });
});


// Astra B92: NBSP no fim de ACAO/ACAC nao e espaco HTTP — o nativo nao aceita; o trim()
// Unicode aceitava e o corpo entrava legivel (e ate credenciado).
describe('CORS: ACAO/ACAC com NBSP nao valem', () => {
  const A = 'https://a.example'; const B = 'https://b.example';
  it('acaoLiberaLeitura e elegivelCorsCredenciado rejeitam NBSP; espaco HTTP e tolerado', () => {
    expect(acaoLiberaLeitura({ 'access-control-allow-origin': '*\u00a0' }, A)).toBe(false);
    expect(acaoLiberaLeitura({ 'access-control-allow-origin': `${A}\u00a0` }, A)).toBe(false);
    expect(acaoLiberaLeitura({ 'access-control-allow-origin': ` ${A}\t` }, A)).toBe(true);
    expect(elegivelCorsCredenciado({ 'access-control-allow-origin': A, 'access-control-allow-credentials': 'true\u00a0' }, A)).toBe(false);
    expect(elegivelCorsCredenciado({ 'access-control-allow-origin': A, 'access-control-allow-credentials': ' true ' }, A)).toBe(true);
  });
  it('avaliarCadeiaCors: NBSP no terminal ou num salto derruba legibilidade/credencial', () => {
    const resp = (url, headers = {}) => ({ url, headers });
    expect(avaliarCadeiaCors(A, [resp(`${B}/x`, { 'access-control-allow-origin': '*\u00a0' })])).toEqual({ legivel: false, credenciado: false });
    expect(avaliarCadeiaCors(A, [resp(`${B}/x`, { 'access-control-allow-origin': A, 'access-control-allow-credentials': 'true\u00a0' })])).toEqual({ legivel: true, credenciado: false });
    expect(avaliarCadeiaCors(A, [resp(`${B}/relay`, { 'access-control-allow-origin': '*\u00a0' }), resp(`${B}/ok`, { 'access-control-allow-origin': '*' })]).legivel).toBe(false);
    expect(avaliarCadeiaCors(A, [resp(`${B}/relay`, { 'access-control-allow-origin': '*' }), resp(`${B}/ok`, { 'access-control-allow-origin': '*' })]).legivel).toBe(true);
  });
});


// Astra B93: quando ha preflight, o OPTIONS (invisivel ao Playwright) decide as credenciais.
describe('precisaPreflight', () => {
  it('metodo fora de GET/HEAD/POST ou cabecalho fora do safelist exige preflight', () => {
    expect(precisaPreflight('GET', {})).toBe(false);
    expect(precisaPreflight('PUT', {})).toBe(true);
    expect(precisaPreflight('GET', { 'api-key': 'k' })).toBe(true);
    expect(precisaPreflight('POST', { 'content-type': 'text/plain' })).toBe(false);
    expect(precisaPreflight('POST', { 'content-type': 'application/json' })).toBe(true);
    expect(precisaPreflight('GET', { accept: 'text/csv', 'accept-language': 'pt' })).toBe(false);
    // Astra B95: a entrada sao os cabecalhos do SCRIPT (do Request construido) — TODOS contam,
    // inclusive os que ficam fora da identidade por o navegador tambem os por sozinho.
    expect(precisaPreflight('GET', { 'cache-control': 'no-cache' })).toBe(true);
    expect(precisaPreflight('GET', { pragma: 'no-cache' })).toBe(true);
  });
  // Astra B94: as restricoes de VALOR do safelist tambem obrigam preflight
  it('valor > 128 bytes, byte CORS-inseguro ou lingua fora do alfabeto exigem preflight', () => {
    expect(precisaPreflight('GET', { accept: 'a'.repeat(129) })).toBe(true);
    expect(precisaPreflight('GET', { accept: 'a'.repeat(128) })).toBe(false);
    expect(precisaPreflight('GET', { accept: 'text/"csv"' })).toBe(true);
    expect(precisaPreflight('GET', { accept: 'text/csv, */*;q=0.1' })).toBe(false);
    expect(precisaPreflight('GET', { 'accept-language': 'pt-BR,pt;q=0.9' })).toBe(false);
    expect(precisaPreflight('GET', { 'accept-language': 'pt(BR)' })).toBe(true);
    expect(precisaPreflight('POST', { 'content-type': 'text/plain; charset="utf-8"' })).toBe(true);
    expect(precisaPreflight('POST', { 'content-type': 'text/plain; charset=utf-8' })).toBe(false);
    // Astra B96: todo byte de controle exceto TAB e CORS-inseguro (0x0B, 0x0C, 0x0E, 0x0F sobrevivem ao Request)
    for (const b of ['\x0B', '\x0C', '\x0E', '\x0F', '\x01', '\x1F']) expect(precisaPreflight('GET', { accept: `text/plain${b}` }), JSON.stringify(b)).toBe(true);
    expect(precisaPreflight('GET', { accept: 'text/plain\t' })).toBe(false);
    // Astra B104: range simples e safelisted; qualquer outra forma exige preflight
    expect(precisaPreflight('POST', { range: 'bytes=0-0', 'content-type': 'text/plain' })).toBe(false);
    // Astra B105: espaco antes do ';' — a essencia MIME e aparada
    expect(precisaPreflight('POST', { 'content-type': 'text/plain ;charset=utf-8' })).toBe(false);
    expect(precisaPreflight('POST', { 'content-type': 'text/plain\t;charset=utf-8' })).toBe(false);
    expect(precisaPreflight('GET', { range: 'bytes=10-' })).toBe(false);
    for (const v of ['bytes=-5', 'bytes=5-1', 'bytes=0-1,2-3', 'bytes= 0-1', 'items=0-1']) expect(precisaPreflight('GET', { range: v }), v).toBe(true);
    // Astra B110: acima de 2^53 a comparacao e exata (Number arredondaria os dois para o mesmo valor)
    expect(precisaPreflight('GET', { range: 'bytes=9007199254740993-9007199254740992' })).toBe(true);
    expect(precisaPreflight('GET', { range: 'bytes=9007199254740992-9007199254740993' })).toBe(false);
    expect(precisaPreflight('GET', { range: 'bytes=007-10' })).toBe(false);
    // Astra B114: extremos >= INT64_MAX saem do safelist (Chromium)
    expect(precisaPreflight('GET', { range: 'bytes=0-9223372036854775808' })).toBe(true);
    expect(precisaPreflight('GET', { range: 'bytes=0-9223372036854775807' })).toBe(true);
    expect(precisaPreflight('GET', { range: 'bytes=0-9223372036854775806' })).toBe(false);
    expect(precisaPreflight('GET', { range: 'bytes=9223372036854775807-' })).toBe(true);
  });
});

// Astra B145: Vary por cabecalho de PEDIDO protege o asset contra o fallback estatico do fetch.
describe('variaPorPedido', () => {
  it('so Accept-Encoding (transporte) nao conta; qualquer outro cabecalho ou * conta', async () => {
    const { variaPorPedido } = await import('./capture-bundle.js');
    expect(variaPorPedido(undefined)).toBe(false);
    expect(variaPorPedido('')).toBe(false);
    expect(variaPorPedido('Accept-Encoding')).toBe(false);
    expect(variaPorPedido(' accept-encoding , Accept-Encoding ')).toBe(false);
    expect(variaPorPedido('Accept')).toBe(true);
    expect(variaPorPedido('accept-encoding, Origin')).toBe(true);
    expect(variaPorPedido('*')).toBe(true);
  });
});

// Revisao Claude (2026-09-30): rastreio (id aleatorio por pedido) fica fora da identidade.
describe('cabecalhos de rastreio fora da identidade', () => {
  it('sentry-trace/baggage/traceparent diferentes dao a mesma identidade; outro cabecalho nao', () => {
    const a = identidadeDeRequisicao('GET', 'https://o/anim.json', Buffer.alloc(0), { 'sentry-trace': 'a-1', baggage: 'x', traceparent: '00-a' });
    const b = identidadeDeRequisicao('GET', 'https://o/anim.json', Buffer.alloc(0), { 'Sentry-Trace': 'b-2', baggage: 'y', traceparent: '00-b' });
    expect(a).toBe(b);
    expect(a).toBe(identidadeDeRequisicao('GET', 'https://o/anim.json', Buffer.alloc(0), {}));
    expect(identidadeDeRequisicao('GET', 'https://o/anim.json', Buffer.alloc(0), { 'x-k': 'v' })).not.toBe(a);
  });
});
