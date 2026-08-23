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
    expect(fonte).toMatch(/if \(lidos > MAX_ASSET_BYTES \|\| orcamento < 0\)[\s\S]{0,140}leitor\.cancel\(\)/);
    expect(fonte).toMatch(/parada\.abort\(\)/);
    expect(fonte).toMatch(/RETRY_ORCAMENTO_BYTES/);
    // O orcamento e' debitado do que TRAFEGOU, nao do que foi aceito: senao
    // varias respostas grandes recusadas puxariam bytes sem limite.
    expect(fonte).toMatch(/orcamento -= value\.byteLength/);
    expect(fonte).toMatch(/orcamento < 0/);
  });

  it('tem concorrencia limitada e teto de arquivos', () => {
    expect(fonte).toMatch(/RETRY_CONCORRENCIA/);
    expect(fonte).toMatch(/RETRY_MAX_ARQUIVOS/);
  });

  it('o que continuar faltando segue nomeado no relatorio', () => {
    expect(fonte).toMatch(/retrying[\s\S]{0,3600}motivo: 'corpo nao chegou'/);
  });
});
