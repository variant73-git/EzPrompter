import { describe, expect, it } from 'vitest';
import { CANONICAL_SCREENS, DESKTOP_ONLY_NOTICE, canonicalCopyMeta, copyScreens, mergeCanonicalCopies, viewportChoicesForNode } from './copy-screens.js';

const A = '22222222-2222-5222-8222-222222222222';
const B = '33333333-3333-5333-8333-333333333333';
const NATIVO = '44444444-4444-5444-8444-444444444444';
const comCopia = (extra = {}) => ({ id: 'n1', width: 1280, current_native_bundle_id: A, meta: canonicalCopyMeta(A), ...extra });
const HTML_DA_COPIA = '<!doctype html>\n<html lang="en" data-u-tela="desktop"><head><meta charset="utf-8">';

describe('telas da cópia editável que o node mostra', () => {
  it('a cópia de hoje tem só o desktop, marcada pelo pacote', () => {
    expect(CANONICAL_SCREENS).toEqual(['desktop']);
    expect(canonicalCopyMeta(A)).toEqual({ canonicalCopies: { [A]: { screens: ['desktop'] } } });
  });

  it('a marca vale enquanto o node mostra AQUELE pacote', () => {
    expect(copyScreens(comCopia())).toEqual(['desktop']);
    // Reset para o clone original troca o pacote: o original se adapta a qualquer tela, nada fica travado
    expect(copyScreens(comCopia({ current_native_bundle_id: NATIVO }))).toBeNull();
    expect(copyScreens({ ...comCopia(), current_native_bundle_id: null })).toBeNull();
  });

  // Astra r2 #1: restaurar uma cópia ANTIGA depois de preparar outra não pode perder a trava
  it('cada cópia publicada guarda a sua marca; restaurar a antiga continua travado', () => {
    const meta = { canonicalCopies: mergeCanonicalCopies(canonicalCopyMeta(A), canonicalCopyMeta(B).canonicalCopies) };
    expect(copyScreens({ current_native_bundle_id: A, meta })).toEqual(['desktop']);
    expect(copyScreens({ current_native_bundle_id: B, meta })).toEqual(['desktop']);
    expect(copyScreens({ current_native_bundle_id: NATIVO, meta })).toBeNull();
  });

  // Astra r2 #2: duplicar vira uma página comum (sem pacote) com o HTML da cópia — a página declara a tela
  it('página com o HTML da cópia trava pela tela que ela declara', () => {
    expect(copyScreens({ current_native_bundle_id: null, current_html: HTML_DA_COPIA, meta: {} })).toEqual(['desktop']);
    expect(copyScreens({ current_html: '<!doctype html><html lang="en"><body data-u-tela="desktop">', meta: {} })).toBeNull();
    expect(copyScreens({ current_html: '<p>oi</p>', meta: {} })).toBeNull();
  });

  it('node sem a marca não tem restrição (clone original, cópias antigas)', () => {
    expect(copyScreens({ current_native_bundle_id: A, meta: {} })).toBeNull();
    expect(copyScreens({ current_native_bundle_id: A, meta: { canonicalJobId: 'j1' } })).toBeNull();
    expect(copyScreens({ current_native_bundle_id: A })).toBeNull();
    expect(copyScreens(null)).toBeNull();
  });

  it('marca malformada não trava nada nem derruba', () => {
    expect(copyScreens({ current_native_bundle_id: A, meta: { canonicalCopies: { [A]: { screens: [] } } } })).toBeNull();
    expect(copyScreens({ current_native_bundle_id: A, meta: { canonicalCopies: { [A]: { screens: 'desktop' } } } })).toBeNull();
    expect(copyScreens({ current_native_bundle_id: A, meta: { canonicalCopies: 'x' } })).toBeNull();
    expect(copyScreens({ current_native_bundle_id: 'toString', meta: { canonicalCopies: {} } })).toBeNull();
  });

  it('juntar marcas mantém as anteriores e tolera lixo', () => {
    expect(mergeCanonicalCopies({ canonicalCopies: { [A]: { screens: ['desktop'] } } }, { [B]: { screens: ['desktop'] } }))
      .toEqual({ [A]: { screens: ['desktop'] }, [B]: { screens: ['desktop'] } });
    expect(mergeCanonicalCopies({ canonicalCopies: 'x' }, { [B]: { screens: ['desktop'] } })).toEqual({ [B]: { screens: ['desktop'] } });
    expect(mergeCanonicalCopies(null, { [B]: { screens: ['desktop'] } })).toEqual({ [B]: { screens: ['desktop'] } });
  });
});

describe('botões de tela do node', () => {
  it('três telas do editor, todas livres num node sem cópia', () => {
    const escolhas = viewportChoicesForNode({ width: 768, meta: {} });
    expect(escolhas.map((e) => [e.label, e.width, e.height, e.allowed, e.active])).toEqual([
      ['Desktop', 1280, 800, true, false],
      ['Tablet', 768, 920, true, true],
      ['Mobile', 390, 844, true, false],
    ]);
    expect(escolhas[1].title).toBe('Tablet · 768px');
  });

  it('com a cópia só de desktop, Tablet e Mobile ficam desligados com o motivo', () => {
    const escolhas = viewportChoicesForNode(comCopia());
    expect(escolhas.map((e) => [e.label, e.allowed])).toEqual([['Desktop', true], ['Tablet', false], ['Mobile', false]]);
    expect(escolhas[1].title).toBe(`Tablet — ${DESKTOP_ONLY_NOTICE}`);
    expect(escolhas[0].title).toBe('Desktop · 1280px');
  });
});
