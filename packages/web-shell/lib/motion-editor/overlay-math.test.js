// Contas da camada de alças e guias — paridade com packages/editor-core/src/editor.js (spec 2026-10-20 §5).
import { describe, expect, it } from 'vitest';
import * as M from './overlay-math.js';

const start = { width: 200, height: 100, marginLeft: 10, marginTop: 5, left: 0, top: 0, position: 'static' };
describe('redimensionar (editor.js 10738-10830)', () => {
  it('leste aumenta a largura e grava as duas medidas', () => {
    expect(M.resizeChanges({ dir: 'e', dx: 30, dy: 0, start })).toEqual([
      { alvo: 'self', property: 'width', value: '230px' }, { alvo: 'self', property: 'height', value: '100px' }]);
  });
  it('oeste compensa na margem (elemento não posicionado) e mantém o lado direito', () => {
    expect(M.resizeChanges({ dir: 'w', dx: 30, dy: 0, start })).toContainEqual({ alvo: 'self', property: 'margin-left', value: '40px' });
  });
  it('norte compensa no top quando posicionado', () => {
    expect(M.resizeChanges({ dir: 'n', dx: 0, dy: 20, start: { ...start, position: 'relative', top: 8 } })).toContainEqual({ alvo: 'self', property: 'top', value: '28px' });
  });
  it('mínimo de 20 px', () => {
    expect(M.resizeChanges({ dir: 'se', dx: -500, dy: -500, start })[0]).toEqual({ alvo: 'self', property: 'width', value: '20px' });
  });
});
describe('destravar (editor.js 10671-10736)', () => {
  const computed = { maxWidth: '300px', maxHeight: 'none', minWidth: '50px', minHeight: '0px', width: '200px', height: '100px', flexGrow: '1', boxSizing: 'content-box' };
  it('tira os limites, zera o mínimo no eixo, solta o flex-grow, conta a borda e libera o corte do pai', () => {
    expect(M.unlockChanges({ dir: 'e', computed, rect: { width: 200, height: 100 }, parent: { display: 'flex', overflow: 'hidden' } })).toEqual([
      { alvo: 'self', property: 'max-width', value: 'none' },
      { alvo: 'self', property: 'min-width', value: '0' },
      { alvo: 'self', property: 'flex-grow', value: '0' },
      { alvo: 'self', property: 'box-sizing', value: 'border-box' },
      { alvo: 'parent', property: 'overflow', value: 'visible' },
    ]);
  });
  it('nada a destravar → lista vazia', () => {
    expect(M.unlockChanges({ dir: 's', computed: { ...computed, maxWidth: 'none', minWidth: '0px', flexGrow: '0', boxSizing: 'border-box' }, rect: { width: 1, height: 1 }, parent: null })).toEqual([]);
  });
});
describe('guias (editor.js 9035-9157)', () => {
  const initial = { mt: 8, mr: 8, mb: 8, ml: 8, pt: 4, pr: 4, pb: 4, pl: 4 };
  it('margem de baixo cresce para baixo; Cmd encaixa de 8', () => {
    expect(M.guideChanges({ key: 'mb', start: 8, dx: 0, dy: 13, axis: 'y', mods: {}, initial }).value).toBe(21);
    expect(M.guideChanges({ key: 'mb', start: 8, dx: 0, dy: 13, axis: 'y', mods: { meta: true }, initial }).value).toBe(24);
  });
  it('Shift muda os 4 lados; Alt espelha', () => {
    expect(M.guideChanges({ key: 'pt', start: 4, dx: 0, dy: 6, axis: 'y', mods: { shift: true }, initial }).changes.map((c) => c.property))
      .toEqual(['padding-top', 'padding-right', 'padding-bottom', 'padding-left']);
    expect(M.guideChanges({ key: 'ml', start: 8, dx: -4, dy: 0, axis: 'x', mods: { alt: true }, initial }).changes)
      .toEqual([{ alvo: 'self', property: 'margin-left', value: '12px' }, { alvo: 'self', property: 'margin-right', value: '12px' }]);
  });
  it('nunca abaixo de zero; gap escreve só o longhand do eixo e mexe no pai', () => {
    expect(M.guideChanges({ key: 'pt', start: 4, dx: 0, dy: -50, axis: 'y', mods: {}, initial }).value).toBe(0);
    expect(M.guideChanges({ key: 'gap', start: 10, dx: 5, dy: 0, axis: 'x', mods: {}, initial }).changes).toEqual([{ alvo: 'parent', property: 'column-gap', value: '15px' }]);
    expect(M.guideChanges({ key: 'gap', start: 10, dx: 0, dy: 5, axis: 'y', mods: {}, initial }).changes).toEqual([{ alvo: 'parent', property: 'row-gap', value: '15px' }]);
  });
  it('eixo do gap pelo flex-direction do pai', () => {
    expect(M.guideAxis('gap', 'row-reverse')).toBe('x'); expect(M.guideAxis('gap', 'column')).toBe('y'); expect(M.guideAxis('ml', 'column')).toBe('x');
  });
});
describe('cantos (editor.js 9160-9220)', () => {
  it('sudeste muda margem de baixo e direita, com encaixe de 8', () => {
    expect(M.cornerChanges({ corner: 'se', start: { marginTop: 0, marginRight: 4, marginBottom: 4, marginLeft: 0 }, dx: 5, dy: 13, mods: { ctrl: true } })).toEqual([
      { alvo: 'self', property: 'margin-bottom', value: '16px' }, { alvo: 'self', property: 'margin-right', value: '8px' }]);
  });
});
describe('campo de digitar (editor.js 8963-9033)', () => {
  const base = { current: 12, rootFontSize: 16, fontSize: 20, parentWidth: 400 };
  it.each([['20', 20], ['20px', 20], ['1.5rem', 24], ['2em', 40], ['10%', 40], ['+5', 17], ['-3', 9], ['-50', 0], ['abc', null], ['', null]])('%s → %s', (text, esperado) => {
    expect(M.parseGuideInput({ ...base, text })).toBe(esperado);
  });
  // Astra (Task 3): a camada passa o tamanho de fonte CALCULADO, que vem como texto ("16px")
  it('aceita os tamanhos de fonte como o estilo calculado devolve ("16px")', () => {
    expect(M.parseGuideInput({ ...base, rootFontSize: '16px', fontSize: '20px', text: '1.5rem' })).toBe(24);
    expect(M.parseGuideInput({ ...base, rootFontSize: '16px', fontSize: '20px', text: '2em' })).toBe(40);
  });
});
describe('setas (editor.js 10493-10529)', () => {
  it('seta para baixo na margem de baixo aumenta 1; Shift 10; Cmd 8; seta do outro eixo não faz nada', () => {
    expect(M.nudgeValue({ key: 'mb', arrow: 'ArrowDown', axis: 'y', mods: {}, current: 4 })).toBe(5);
    expect(M.nudgeValue({ key: 'mb', arrow: 'ArrowDown', axis: 'y', mods: { shift: true }, current: 4 })).toBe(14);
    expect(M.nudgeValue({ key: 'mt', arrow: 'ArrowDown', axis: 'y', mods: { meta: true }, current: 4 })).toBe(0);
    expect(M.nudgeValue({ key: 'mb', arrow: 'ArrowLeft', axis: 'y', mods: {}, current: 4 })).toBeNull();
  });
});
describe('perto da borda (Astra r1 #7)', () => {
  it('rótulo vai para dentro e alças ficam inteiras quando a caixa encosta no topo/esquerda', () => {
    const r = M.placeControls({ box: { x: 0, y: 0, width: 300, height: 120 }, viewport: { width: 1280, height: 800 }, handle: 12, label: { width: 60, height: 18 } });
    expect(r.label.inside).toBe(true);
    expect(r.handles.nw).toEqual({ x: 0, y: 0 });
    expect(r.handles.se).toEqual({ x: 294, y: 114 });
  });
  // Astra (Task 3): elemento parcialmente acima da tela — o rótulo não pode sumir
  it('rótulo continua dentro da janela com o elemento parcialmente rolado para cima', () => {
    const r = M.placeControls({ box: { x: 100, y: -50, width: 300, height: 200 }, viewport: { width: 1280, height: 800 }, handle: 12, label: { width: 60, height: 18 } });
    expect(r.label.y).toBeGreaterThanOrEqual(0);
    expect(r.label.y).toBeLessThanOrEqual(800 - 18);
  });
  it('longe da borda: paridade (alça a −6 px, rótulo acima)', () => {
    const r = M.placeControls({ box: { x: 100, y: 100, width: 300, height: 120 }, viewport: { width: 1280, height: 800 }, handle: 12, label: { width: 60, height: 18 } });
    expect(r.handles.nw).toEqual({ x: 94, y: 94 });
    expect(r.label.inside).toBe(false);
  });
});
describe('serializável', () => {
  it('cada função funciona recriada só do texto (sem nada de fora)', () => {
    for (const [nome, fn] of Object.entries(M)) {
      if (typeof fn !== 'function') continue;
      const recriada = new Function(`return (${fn.toString()})`)();
      expect(typeof recriada, nome).toBe('function');
    }
    const r = new Function(`return (${M.resizeChanges.toString()})`)()({ dir: 'e', dx: 30, dy: 0, start });
    expect(r[0].value).toBe('230px');
  });
});
