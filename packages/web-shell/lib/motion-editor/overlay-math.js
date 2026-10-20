// Contas da camada de alças e guias (spec 2026-10-20 §5), portadas do editor antigo
// (packages/editor-core/src/editor.js). ⚠️ Cada função é AUTOSSUFICIENTE: a ponte as serializa com toString() e injeta
// na página; uma referência a algo de fora quebraria só lá dentro (o teste "serializável" pega).

export const GUIAS = Object.freeze({
  props: { mt: 'margin-top', mr: 'margin-right', mb: 'margin-bottom', ml: 'margin-left', pt: 'padding-top', pr: 'padding-right', pb: 'padding-bottom', pl: 'padding-left' },
  eixo: { mt: 'y', mb: 'y', pt: 'y', pb: 'y', ml: 'x', mr: 'x', pl: 'x', pr: 'x', gap: 'auto' },
  sentido: { mt: -1, mb: 1, pt: 1, pb: -1, ml: -1, mr: 1, pl: 1, pr: -1, gap: 1 },
  espelho: { mt: 'mb', mb: 'mt', ml: 'mr', mr: 'ml', pt: 'pb', pb: 'pt', pl: 'pr', pr: 'pl' },
});

export function resizeChanges({ dir, dx, dy, start }) {
  let w = start.width; let h = start.height;
  if (dir.indexOf('e') !== -1) w += dx;
  if (dir.indexOf('w') !== -1) w -= dx;
  if (dir.indexOf('s') !== -1) h += dy;
  if (dir.indexOf('n') !== -1) h -= dy;
  const newW = Math.max(20, Math.round(w)); const newH = Math.max(20, Math.round(h));
  const usesCoords = ['absolute', 'fixed', 'sticky', 'relative'].indexOf(start.position) !== -1;
  const out = [{ alvo: 'self', property: 'width', value: `${newW}px` }, { alvo: 'self', property: 'height', value: `${newH}px` }];
  if (dir.indexOf('w') !== -1) out.push(usesCoords
    ? { alvo: 'self', property: 'left', value: `${Math.round(start.left + (start.width - newW))}px` }
    : { alvo: 'self', property: 'margin-left', value: `${Math.round(start.marginLeft + (start.width - newW))}px` });
  if (dir.indexOf('n') !== -1) out.push(usesCoords
    ? { alvo: 'self', property: 'top', value: `${Math.round(start.top + (start.height - newH))}px` }
    : { alvo: 'self', property: 'margin-top', value: `${Math.round(start.marginTop + (start.height - newH))}px` });
  return out;
}

export function unlockChanges({ dir, computed, rect, parent }) {
  const out = [];
  if (computed.maxWidth !== 'none' && computed.maxWidth !== '0px') out.push({ alvo: 'self', property: 'max-width', value: 'none' });
  if (computed.maxHeight !== 'none' && computed.maxHeight !== '0px') out.push({ alvo: 'self', property: 'max-height', value: 'none' });
  if ((dir.indexOf('w') !== -1 || dir.indexOf('e') !== -1) && computed.minWidth && computed.minWidth !== '0px') out.push({ alvo: 'self', property: 'min-width', value: '0' });
  if ((dir.indexOf('n') !== -1 || dir.indexOf('s') !== -1) && computed.minHeight && computed.minHeight !== '0px') out.push({ alvo: 'self', property: 'min-height', value: '0' });
  if (computed.width === 'auto' || String(computed.width).indexOf('%') !== -1) out.push({ alvo: 'self', property: 'width', value: `${Math.round(rect.width)}px` });
  if (computed.height === 'auto' || String(computed.height).indexOf('%') !== -1) out.push({ alvo: 'self', property: 'height', value: `${Math.round(rect.height)}px` });
  const paiFlex = parent && (parent.display === 'flex' || parent.display === 'inline-flex');
  if (paiFlex && (parseFloat(computed.flexGrow) || 0) > 0) out.push({ alvo: 'self', property: 'flex-grow', value: '0' });
  if (computed.boxSizing !== 'border-box') out.push({ alvo: 'self', property: 'box-sizing', value: 'border-box' });
  if (parent && parent.overflow === 'hidden') out.push({ alvo: 'parent', property: 'overflow', value: 'visible' });
  return out;
}

export function guideAxis(key, parentFlexDirection) {
  const eixo = { mt: 'y', mb: 'y', pt: 'y', pb: 'y', ml: 'x', mr: 'x', pl: 'x', pr: 'x', gap: 'auto' }[key];
  if (eixo !== 'auto') return eixo;
  return parentFlexDirection === 'row' || parentFlexDirection === 'row-reverse' ? 'x' : 'y';
}

export function guideChanges({ key, start, dx, dy, axis, mods }) {
  const props = { mt: 'margin-top', mr: 'margin-right', mb: 'margin-bottom', ml: 'margin-left', pt: 'padding-top', pr: 'padding-right', pb: 'padding-bottom', pl: 'padding-left' };
  const sentido = { mt: -1, mb: 1, pt: 1, pb: -1, ml: -1, mr: 1, pl: 1, pr: -1, gap: 1 }[key];
  const espelho = { mt: 'mb', mb: 'mt', ml: 'mr', mr: 'ml', pt: 'pb', pb: 'pt', pl: 'pr', pr: 'pl' }[key];
  const grupo = ['mt', 'mr', 'mb', 'ml'].indexOf(key) !== -1 ? ['mt', 'mr', 'mb', 'ml'] : ['pt', 'pr', 'pb', 'pl'].indexOf(key) !== -1 ? ['pt', 'pr', 'pb', 'pl'] : null;
  const delta = (axis === 'x' ? dx : dy) * sentido;
  let value = Math.max(0, Math.round(start + delta));
  if (mods && (mods.meta || mods.ctrl)) value = Math.round(value / 8) * 8;
  const px = `${value}px`;
  if (key === 'gap') return { value, changes: [{ alvo: 'parent', property: axis === 'x' ? 'column-gap' : 'row-gap', value: px }] };
  if (mods && mods.shift && grupo) return { value, changes: grupo.map((k) => ({ alvo: 'self', property: props[k], value: px })) };
  if (mods && mods.alt && espelho) return { value, changes: [{ alvo: 'self', property: props[key], value: px }, { alvo: 'self', property: props[espelho], value: px }] };
  return { value, changes: [{ alvo: 'self', property: props[key], value: px }] };
}

export function cornerChanges({ corner, start, dx, dy, mods }) {
  const cfg = {
    nw: { props: ['margin-top', 'margin-left'], y: 'marginTop', x: 'marginLeft', signY: -1, signX: -1 },
    ne: { props: ['margin-top', 'margin-right'], y: 'marginTop', x: 'marginRight', signY: -1, signX: 1 },
    se: { props: ['margin-bottom', 'margin-right'], y: 'marginBottom', x: 'marginRight', signY: 1, signX: 1 },
    sw: { props: ['margin-bottom', 'margin-left'], y: 'marginBottom', x: 'marginLeft', signY: 1, signX: -1 },
  }[corner];
  let ny = Math.max(0, Math.round(start[cfg.y] + dy * cfg.signY));
  let nx = Math.max(0, Math.round(start[cfg.x] + dx * cfg.signX));
  if (mods && (mods.meta || mods.ctrl)) { ny = Math.round(ny / 8) * 8; nx = Math.round(nx / 8) * 8; }
  return [{ alvo: 'self', property: cfg.props[0], value: `${ny}px` }, { alvo: 'self', property: cfg.props[1], value: `${nx}px` }];
}

export function parseGuideInput({ text, current, rootFontSize, fontSize, parentWidth }) {
  const v = String(text || '').trim();
  let num = null;
  if (/^[+-]\s*[0-9.]+$/.test(v)) { const d = parseFloat(v.replace(/\s+/g, '')); num = Number.isNaN(d) ? null : current + d; }
  else {
    const m = v.match(/^([0-9.]+)\s*(px|rem|em|%)?$/i);
    if (m) {
      const n = parseFloat(m[1]); const unit = (m[2] || 'px').toLowerCase();
      // tamanhos de fonte chegam como o estilo calculado devolve ("16px"): parseFloat, como o antigo (Astra, Task 3)
      if (!Number.isNaN(n)) num = unit === 'px' ? n : unit === 'rem' ? n * (parseFloat(rootFontSize) || 16) : unit === 'em' ? n * (parseFloat(fontSize) || 16) : (n / 100) * (parseFloat(parentWidth) || 0);
    }
  }
  return num == null ? null : Math.max(0, Math.round(num));
}

export function nudgeValue({ key, arrow, axis, mods, current }) {
  const sentido = { mt: -1, mb: 1, pt: 1, pb: -1, ml: -1, mr: 1, pl: 1, pr: -1, gap: 1 }[key];
  const tela = axis === 'y' ? (arrow === 'ArrowDown' ? 1 : arrow === 'ArrowUp' ? -1 : 0) : (arrow === 'ArrowRight' ? 1 : arrow === 'ArrowLeft' ? -1 : 0);
  if (!tela) return null;
  const passo = mods && mods.shift ? 10 : (mods && (mods.meta || mods.ctrl)) ? 8 : 1;
  return Math.max(0, current + tela * sentido * passo);
}

export function placeControls({ box, viewport, handle, label }) {
  const meio = handle / 2;
  const prender = (v, min, max) => Math.min(Math.max(v, min), Math.max(min, max));
  const pos = (cx, cy) => ({ x: Math.round(prender(cx - meio, 0, viewport.width - handle)), y: Math.round(prender(cy - meio, 0, viewport.height - handle)) });
  const l = box.x; const t = box.y; const r = box.x + box.width; const b = box.y + box.height; const mx = box.x + box.width / 2; const my = box.y + box.height / 2;
  const handles = { nw: pos(l, t), n: pos(mx, t), ne: pos(r, t), e: pos(r, my), se: pos(r, b), s: pos(mx, b), sw: pos(l, b), w: pos(l, my) };
  const inside = t - label.height - 4 < 0;
  // o Y final também fica dentro da janela: elemento parcialmente rolado para cima não perde o rótulo (Astra, Task 3)
  const y = prender(inside ? t + 4 : t - label.height - 4, 0, viewport.height - label.height);
  return { handles, label: { x: Math.round(prender(l, 0, viewport.width - label.width)), y: Math.round(y), inside } };
}
