'use client';
// Modo de preview do node (Video | Static), escolhido no Console.
// Vive no localStorage (preferência da MÁQUINA, não do usuário no banco) e
// propaga por evento para os nodes já montados trocarem sem reload.
import { useEffect, useState } from 'react';
import { resolvePreviewMode, DEFAULT_PREVIEW_MODE } from './preview-video.js';

export const PREVIEW_MODE_EVENT = 'uncraft-preview-mode';
export const PREVIEW_MODE_KEY = 'uncraft-preview-mode';

export function usePreviewMode() {
  // Começa no default e corrige no efeito: ler localStorage no primeiro render
  // divergiria do HTML do servidor (hidratação).
  const [mode, setMode] = useState(DEFAULT_PREVIEW_MODE);
  useEffect(() => {
    try { setMode(resolvePreviewMode(localStorage.getItem(PREVIEW_MODE_KEY))); } catch {}
    const aoTrocar = (e) => setMode(resolvePreviewMode(e?.detail));
    window.addEventListener(PREVIEW_MODE_EVENT, aoTrocar);
    return () => window.removeEventListener(PREVIEW_MODE_EVENT, aoTrocar);
  }, []);
  return mode;
}
