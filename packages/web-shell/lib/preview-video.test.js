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
  it('monta a URL quando o bundle traz o arquivo', () => {
    const d = { bundleId: 'b-1', assetIndex: [{ path: 'index.html' }, { path: PREVIEW_VIDEO_PATH }] };
    expect(previewVideoUrl(d)).toBe(`/api/native-clone/b-1/${PREVIEW_VIDEO_PATH}`);
  });
  it('null quando o bundle NÃO tem preview (node cai no PNG)', () => {
    expect(previewVideoUrl({ bundleId: 'b-1', assetIndex: [{ path: 'index.html' }] })).toBe(null);
    expect(previewVideoUrl(null)).toBe(null);
    expect(previewVideoUrl({ assetIndex: [{ path: PREVIEW_VIDEO_PATH }] })).toBe(null);
  });
});
