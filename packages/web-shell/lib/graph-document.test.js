import { describe, it, expect } from 'vitest';
import { toModelDocument, restoreModelDocument, mergeDocumentAssets } from './graph-document.js';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='.repeat(3);

describe('o documento que vai para o modelo', () => {
  it('tira os pixels e deixa a estrutura', () => {
    const html = `<img src="data:image/png;base64,${PNG}" alt="hero"><h1>Título</h1>`;
    const { text, assets, removedBytes } = toModelDocument(html);
    expect(text).toContain('<h1>Título</h1>');
    expect(text).toContain('alt="hero"');
    expect(text).not.toContain(PNG);
    expect(text).toMatch(/uncraft-asset:[a-z0-9]+;image\/png/);
    expect(assets.size).toBe(1);
    expect(removedBytes).toBeGreaterThan(PNG.length);
  });

  it('devolve os bytes ao que o modelo escreveu', () => {
    const html = `<img src="data:image/png;base64,${PNG}">`;
    const { text, assets } = toModelDocument(html);
    expect(restoreModelDocument(text, assets)).toBe(html);
  });

  // O mesmo sprite repetido 40 vezes numa pagina e' o caso comum; se cada
  // ocorrencia virasse etiqueta propria, o mapa pesaria 40x o necessario.
  it('a mesma imagem repetida vira UMA etiqueta', () => {
    const html = `<img src="data:image/png;base64,${PNG}"><img src="data:image/png;base64,${PNG}">`;
    const { text, assets } = toModelDocument(html);
    expect(assets.size).toBe(1);
    expect((text.match(/uncraft-asset:/g) || []).length).toBe(2);
    expect(restoreModelDocument(text, assets)).toBe(html);
  });

  // O marcador precisa ser URL valida para sobreviver a src, srcset e url() de
  // CSS — senao ele quebra o parsing de quem ler o documento depois.
  it('o marcador sobrevive a srcset e a url() de CSS', () => {
    const html = `<img srcset="data:image/webp;base64,${PNG} 2x"><style>a{background:url(data:image/gif;base64,${PNG})}</style>`;
    const { text, assets } = toModelDocument(html);
    expect(text).toMatch(/srcset="uncraft-asset:[a-z0-9]+;image\/webp 2x"/);
    expect(text).toMatch(/url\(uncraft-asset:[a-z0-9]+;image\/gif\)/);
    expect(restoreModelDocument(text, assets)).toBe(html);
  });

  it('nao toca em documento sem pixel embutido', () => {
    const html = '<h1>oi</h1><img src="https://cdn.test/a.png">';
    const { text, assets, removedBytes } = toModelDocument(html);
    expect(text).toBe(html);
    expect(assets.size).toBe(0);
    expect(removedBytes).toBe(0);
  });

  // Marcador que o modelo inventou nao pode virar undefined no documento.
  it('marcador desconhecido fica como esta', () => {
    const saida = restoreModelDocument('<img src="uncraft-asset:zzz;image/png">', new Map());
    expect(saida).toContain('uncraft-asset:zzz;image/png');
  });

  it('une mapas de varias fontes sem duplicar', () => {
    const a = new Map([['x', 'data:1'], ['y', 'data:2']]);
    const b = new Map([['y', 'outro'], ['z', 'data:3']]);
    const u = mergeDocumentAssets(a, b, null);
    expect(u.get('y')).toBe('data:2');
    expect([...u.keys()].sort()).toEqual(['x', 'y', 'z']);
  });
});
