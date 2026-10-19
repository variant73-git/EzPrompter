// As telas em que a cópia editável é gravada (2026-10-19). A montagem serializa o estilo CALCULADO de cada
// elemento, então a cópia só fica certa na tela em que foi gravada. As três do editor vêm da MESMA tabela que o
// editor usa — se o desktop do editor mudar de tamanho, a cópia acompanha. A referência (1440 × 1200) é a tela
// histórica das medições do clone (bateria, régua) e o padrão de quem não pede outra.
import { MOTION_EDITOR_DEVICES } from '../motion-editor/devices.js';

const doEditor = (id) => Object.freeze({ id, width: MOTION_EDITOR_DEVICES[id].width, height: MOTION_EDITOR_DEVICES[id].height });

export const SCREEN_PROFILES = Object.freeze({
  desktop: doEditor('desktop'),
  tablet: doEditor('tablet'),
  mobile: doEditor('mobile'),
  reference: Object.freeze({ id: 'reference', width: 1440, height: 1200 }),
});

export const DEFAULT_SCREEN = 'reference';

// Nome desconhecido é erro: trocar em silêncio por outra tela gravaria uma cópia que não cabe onde é mostrada.
export function screenProfile(name = DEFAULT_SCREEN) {
  if (typeof name !== 'string' || !Object.hasOwn(SCREEN_PROFILES, name)) throw new Error(`tela desconhecida: ${String(name)}`);
  return SCREEN_PROFILES[name];
}
