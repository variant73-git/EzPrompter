// O preview animado tem TRÊS guardas e cada uma precisa de caso próprio —
// a do Console (regra de produto), a do bundle sem vídeo (fallback) e a de
// fora-da-tela (perf, lição 148b). Testa-se a decisão, que é onde mora o risco.
import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { usePreviewMode, PREVIEW_MODE_EVENT, PREVIEW_MODE_KEY } from '../lib/use-preview-mode.js';

// A decisão do node, isolada — mesma expressão booleana do CanvasNode.
function decidir({ showThumb, previewMode, previewVideoUrl, offscreenParked }) {
  return showThumb && previewMode === 'video' && !!previewVideoUrl && !offscreenParked;
}
const base = { showThumb: true, previewMode: 'video', previewVideoUrl: '/api/native-clone/b/_uncraft/preview.webm', offscreenParked: false };

describe('quando o node mostra vídeo', () => {
  it('mostra com as três condições satisfeitas', () => {
    expect(decidir(base)).toBe(true);
  });
  it('Console em static desliga (a regra de produto vence)', () => {
    expect(decidir({ ...base, previewMode: 'static' })).toBe(false);
  });
  it('bundle sem vídeo cai no PNG', () => {
    expect(decidir({ ...base, previewVideoUrl: null })).toBe(false);
  });
  it('fora da tela NUNCA decodifica (guarda de performance)', () => {
    expect(decidir({ ...base, offscreenParked: true })).toBe(false);
  });
  it('sem thumb (editando/preview de versão) o iframe manda', () => {
    expect(decidir({ ...base, showThumb: false })).toBe(false);
  });
});

function Sonda() {
  const mode = usePreviewMode();
  return <span data-testid="modo">{mode}</span>;
}

describe('usePreviewMode', () => {
  it('lê o localStorage e reage à troca no Console sem reload', async () => {
    localStorage.setItem(PREVIEW_MODE_KEY, 'static');
    render(<Sonda />);
    await act(async () => {});
    expect(screen.getByTestId('modo').textContent).toBe('static');
    await act(async () => {
      window.dispatchEvent(new CustomEvent(PREVIEW_MODE_EVENT, { detail: 'video' }));
    });
    expect(screen.getByTestId('modo').textContent).toBe('video');
  });
  it('valor corrompido no storage cai no default', async () => {
    localStorage.setItem(PREVIEW_MODE_KEY, 'gif-animado');
    render(<Sonda />);
    await act(async () => {});
    expect(screen.getByTestId('modo').textContent).toBe('video');
  });
});
