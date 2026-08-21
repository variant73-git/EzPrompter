import { describe, it, expect } from 'vitest';
import {
  PREVIEW_VIDEO_PATH, resolvePreviewMode, previewCaptureEnabled, previewVideoUrl,
} from './preview-video.js';

describe('resolvePreviewMode', () => {
  it('aceita os dois modos e cai no default fora deles', () => {
    expect(resolvePreviewMode('static')).toBe('static');
    expect(resolvePreviewMode('video')).toBe('video');
    expect(resolvePreviewMode('gif')).toBe('video');
    expect(resolvePreviewMode(null)).toBe('video');
  });
});

describe('previewCaptureEnabled', () => {
  it('ligado por padrão; off desliga', () => {
    expect(previewCaptureEnabled({})).toBe(true);
    expect(previewCaptureEnabled({ UNCRAFT_PREVIEW_VIDEO: 'off' })).toBe(false);
    expect(previewCaptureEnabled({ UNCRAFT_PREVIEW_VIDEO: 'OFF' })).toBe(false);
    expect(previewCaptureEnabled({ UNCRAFT_PREVIEW_VIDEO: 'on' })).toBe(true);
  });
});

describe('previewVideoUrl', () => {
  it('aponta para a rota POR NODE — nunca para a do laboratório local', () => {
    const d = { bundleId: 'b-1', assetIndex: [{ path: 'index.html' }, { path: PREVIEW_VIDEO_PATH }] };
    expect(previewVideoUrl(d, 'node-9')).toBe('/api/nodes/node-9/preview-video');
    // Regressão do achado: /api/native-clone é rota de laboratório (503 em
    // produção, ignora o bundleId) — o preview nunca pode voltar para lá.
    expect(previewVideoUrl(d, 'node-9')).not.toContain('native-clone');
  });
  it('null quando o bundle NÃO declara o preview (node cai no PNG)', () => {
    expect(previewVideoUrl({ bundleId: 'b-1', assetIndex: [{ path: 'index.html' }] }, 'n1')).toBe(null);
    expect(previewVideoUrl(null, 'n1')).toBe(null);
  });
  it('null sem nodeId — sem node não há rota autorizada', () => {
    expect(previewVideoUrl({ assetIndex: [{ path: PREVIEW_VIDEO_PATH }] }, null)).toBe(null);
  });
});
