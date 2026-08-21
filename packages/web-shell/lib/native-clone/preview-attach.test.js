// A anexação do preview é fail-open por contrato: nenhum problema com o vídeo
// pode derrubar um clone que deu certo. Cada modo de falha tem seu caso.
import { describe, it, expect } from 'vitest';
import { anexarPreviewAoBundle } from './capture-bundle.js';
import { PREVIEW_VIDEO_PATH, PREVIEW_VIDEO_MAX_BYTES } from '../preview-video.js';

const gravacaoFake = (caminho) => ({ path: async () => caminho });
// `stat` falso padrão: tamanho dentro do teto, para os casos que não são sobre teto.
const medirOk = async () => ({ size: 1024 });

describe('anexarPreviewAoBundle', () => {
  it('anexa o vídeo como asset webm do bundle', async () => {
    const assets = []; const descartados = [];
    const out = await anexarPreviewAoBundle({
      assets, descartados, gravacao: gravacaoFake('/tmp/x.webm'), medir: medirOk,
      ler: async () => Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]),
    });
    expect(out.path).toBe(PREVIEW_VIDEO_PATH);
    expect(assets).toHaveLength(1);
    expect(assets[0].contentType).toBe('video/webm');
    expect(assets[0].body).toBeInstanceOf(Uint8Array);
    expect(descartados).toHaveLength(0);
  });

  it('sem gravação (preview desligado) não toca no bundle', async () => {
    const assets = []; const descartados = [];
    expect(await anexarPreviewAoBundle({ assets, descartados, gravacao: null })).toBe(null);
    expect(assets).toHaveLength(0);
    expect(descartados).toHaveLength(0);
  });

  it('acima do teto é descartado SEM ler o arquivo (teto antes do buffer)', async () => {
    const assets = []; const descartados = [];
    let leu = false;
    await anexarPreviewAoBundle({
      assets, descartados, gravacao: gravacaoFake('/tmp/x.webm'),
      medir: async () => ({ size: PREVIEW_VIDEO_MAX_BYTES + 1 }),
      ler: async () => { leu = true; return Buffer.alloc(PREVIEW_VIDEO_MAX_BYTES + 1); },
    });
    expect(assets).toHaveLength(0);
    expect(descartados[0].motivo).toMatch(/grande demais/);
    // O ponto do achado: o arquivo gigante NUNCA entra na memória.
    expect(leu, 'não pode bufferizar antes de checar o tamanho').toBe(false);
  });

  it('arquivo vazio ou ausente vira descarte, não exceção', async () => {
    for (const [gr, ler] of [
      [gravacaoFake('/tmp/x.webm'), async () => Buffer.alloc(0)],
      [gravacaoFake(null), async () => Buffer.from([1])],
    ]) {
      const assets = []; const descartados = [];
      await anexarPreviewAoBundle({ assets, descartados, gravacao: gr, ler, medir: medirOk });
      expect(assets).toHaveLength(0);
      expect(descartados).toHaveLength(1);
    }
  });

  it('leitura que EXPLODE não derruba o clone (fail-open)', async () => {
    const assets = []; const descartados = [];
    const out = await anexarPreviewAoBundle({
      assets, descartados, gravacao: gravacaoFake('/tmp/x.webm'), medir: medirOk,
      ler: async () => { throw new Error('EACCES disco'); },
    });
    expect(out).toBe(null);
    expect(assets).toHaveLength(0);
    expect(descartados[0].motivo).toMatch(/EACCES/);
  });
});
