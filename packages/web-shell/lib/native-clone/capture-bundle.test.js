import { describe, expect, it } from 'vitest';
import { bundlePathForUrl, srcsetCandidateUrls } from './capture-bundle.js';
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
    // e o desvio e' um return SECO na mesma linha: sai sem apagar a reserva
    expect(ouvinte.slice(iMidia, ouvinte.indexOf('\n', iMidia))).toMatch(/return;/);
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
    expect(fonte).toMatch(/retrying[\s\S]{0,7000}motivo: 'corpo nao chegou'/);
  });
});
