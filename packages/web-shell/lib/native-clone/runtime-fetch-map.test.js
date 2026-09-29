import { describe, expect, it } from 'vitest';
import { runtimeFetchMap, runtimeFetchShim } from './runtime-fetch-map.js';

describe('mapa de fetch do runtime', () => {
  it('mapeia SÓ respostas de fetch/xhr que entraram no pacote', () => {
    const congelados = new Map([
      ['https://site/api/dados', { tipo: 'fetch' }],
      ['https://site/api/xhr', { tipo: 'xhr' }],
      ['https://site/hero.png', { tipo: 'image' }],     // asset comum: a reescrita estática já alcança
      ['https://site/api/sem-caminho', { tipo: 'fetch' }], // capturado mas fora do pacote
      ['https://site/doc', { tipo: 'document' }],
    ]);
    const caminhos = new Map([
      ['https://site/api/dados', 'api/dados.json'],
      ['https://site/api/xhr', 'api/xhr.json'],
      ['https://site/hero.png', 'hero.png'],
      ['https://site/doc', 'index.html'],
    ]);
    expect(runtimeFetchMap(congelados, caminhos)).toEqual({
      'https://site/api/dados': './api/dados.json',
      'https://site/api/xhr': './api/xhr.json',
    });
  });

  it('não injeta nada quando não há chamada de runtime', () => {
    expect(runtimeFetchShim({})).toBe('');
    expect(runtimeFetchShim(null)).toBe('');
  });

  it('o script não pode fechar a própria tag nem carregar separador de linha cru', () => {
    // Uma URL com `</script` dentro viraria fim de tag e o resto do documento
    // passaria a ser tratado como marcação.
    const shim = runtimeFetchShim({ 'https://site/a</script><b>': './a.json' });
    expect(shim).toContain('<script data-uncraft-runtime-fetch-map>');
    expect(shim.slice(shim.indexOf('>') + 1)).not.toContain('</script><b>');
    expect(shim).toContain('\\u003c/script');
    expect(shim).not.toContain('\u2028');
    expect(shim).not.toContain('\u2029');
  });

  // ⚠️ Achado do Astra: a 1a versao dizia no comentario que "Request com corpo passa
  // intacto" e era FALSO — a guarda existia so no ramo do objeto Request, enquanto a
  // forma comum `fetch(url, { method: 'POST', body })` passa a URL como STRING e era
  // traduzida. Metodo e corpo colapsavam num arquivo estatico, e converter outra
  // origem em mesma origem remove a fronteira CORS.
  it('só traduz GET/HEAD sem corpo, lendo o método do init E do Request', () => {
    const shim = runtimeFetchShim({ 'https://site/api': './api.json' });
    expect(shim).toContain("m === 'GET' || m === 'HEAD'");
    expect(shim).toContain('init && init.method');       // o init vence, como na plataforma
    expect(shim).toContain('init && init.body != null'); // corpo no init tambem barra
    expect(shim).toContain('seguro(metodo)');            // XHR usa a mesma regra
    // Nao forca mais mode/credentials: mexer nisso muda semantica observavel.
    expect(shim).not.toContain("mode: 'same-origin'");
    expect(shim).not.toContain("credentials: 'same-origin'");
  });

  it('resolve o caminho local contra a URL do documento, não contra <base href>', () => {
    const shim = runtimeFetchShim({ 'https://site/api': './api.json' });
    expect(shim).toContain('new URL(M[abs], location.href).href');
  });

  it('o script é idempotente e protege a página de si mesmo', () => {
    const shim = runtimeFetchShim({ 'https://site/api': './api.json' });
    expect(shim).toContain('__uncraftFetchMapped');          // não remenda duas vezes
    expect(shim).toContain('XMLHttpRequest.prototype.open'); // XHR também
    expect(shim).toContain('catch (e)');                     // nunca derruba a página
  });
});
