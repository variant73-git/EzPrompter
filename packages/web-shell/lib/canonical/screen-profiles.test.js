import { describe, expect, it } from 'vitest';
import { MOTION_EDITOR_DEVICES } from '../motion-editor/devices.js';
import { DEFAULT_SCREEN, screenProfile } from './screen-profiles.js';

describe('telas da cópia editável', () => {
  it('as três telas do editor saem da tabela do próprio editor', () => {
    for (const id of ['desktop', 'tablet', 'mobile']) {
      expect(screenProfile(id)).toEqual({ id, width: MOTION_EDITOR_DEVICES[id].width, height: MOTION_EDITOR_DEVICES[id].height });
    }
    expect(screenProfile('desktop')).toEqual({ id: 'desktop', width: 1280, height: 800 });
  });

  it('a referência das medições é 1440 × 1200 e é o padrão de quem não pede outra', () => {
    expect(DEFAULT_SCREEN).toBe('reference');
    expect(screenProfile()).toEqual({ id: 'reference', width: 1440, height: 1200 });
  });

  it('tela desconhecida é recusada, nunca trocada em silêncio por outra', () => {
    expect(() => screenProfile('celular')).toThrow(/tela desconhecida/);
    expect(() => screenProfile('toString')).toThrow(/tela desconhecida/);
    expect(() => screenProfile('')).toThrow(/tela desconhecida/);
    expect(() => screenProfile(null)).toThrow(/tela desconhecida/);
  });
});
